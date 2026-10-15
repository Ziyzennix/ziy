/**
 * ziy-pwd — the framing and the agent contract.
 *
 * The framing tests are worth having on their own because a desynchronised
 * length prefix is the failure mode a native host can least afford: the browser
 * writes a frame, the host reads a length, and every subsequent message is
 * garbage. MDN's rule ("an unsigned 32-bit value containing the message length
 * in native byte order") is pinned here against THIS implementation, not just
 * asserted in a comment.
 *
 * The contract tests drive the real dispatch path in-process, which is the same
 * entry the stdio loop uses, so an op whose reply shape changes fails here.
 */

import { it } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { encodeMessage, NativeMessageReader, NativeMessageWriter, scrubReply, MAX_MESSAGE_BYTES, ALLOWED_EXTENSION_ID } =
  await import("../lib/native-protocol.js");
const { createAgent, verifyLaunch, dispatch } = await import("../ziy-pwd.js");

/* ------------------------------------------------------------------ *
 * The wire format
 * ------------------------------------------------------------------ */

it("a frame is a UInt32LE length followed by exactly that many JSON bytes", () => {
  const framed = encodeMessage({ op: "capabilities", n: 1 });
  assert.equal(framed.readUInt32LE(0), framed.length - 4, "the length prefix is the body's byte count");
  assert.deepEqual(JSON.parse(framed.subarray(4).toString("utf8")), { op: "capabilities", n: 1 });
});

it("the byte order is native (little-endian on this x86-64 box)", () => {
  // MDN: "native byte order". A big-endian header would be read as a huge length
  // by this process and the stream would be destroyed — which is exactly the bug
  // this test exists to catch.
  const framed = encodeMessage({ op: "x", pad: "01234567890123456789" });
  assert.equal(framed.readUInt32LE(0), framed.length - 4);
  assert.notEqual(framed.readUInt32BE(0), framed.length - 4);
});

it("a frame at the 1 MB cap encodes, and one over it throws", () => {
  const at = Buffer.from("a".repeat(MAX_MESSAGE_BYTES - 64), "utf8");
  const ok = JSON.stringify({ op: "csv.import", csv: "a".repeat(MAX_MESSAGE_BYTES - 100) });
  const framed = encodeMessage(JSON.parse(ok));
  assert.equal(framed.length - 4 <= MAX_MESSAGE_BYTES, true);
  assert.throws(() => encodeMessage({ op: "csv.import", csv: "b".repeat(MAX_MESSAGE_BYTES + 1) }), /too large/);
});

it("two frames in one chunk are delivered as two messages", () => {
  // The browser may write the frames in one write(); the reader must not treat a
  // second frame's header as part of the first body.
  const a = encodeMessage({ i: 1 });
  const b = encodeMessage({ i: 2 });
  const combined = Buffer.concat([a, b]);
  const reader = new NativeMessageReader(Readable.from([combined]));
  const got = [];
  reader.on("message", (m) => got.push(m));
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        assert.deepEqual(got, [{ i: 1 }, { i: 2 }]);
        resolve();
      } catch (e) { reject(e); }
    }, 50);
  });
});

it("a frame split across chunks is reassembled, not misparsed", () => {
  const framed = encodeMessage({ i: 42, csv: "a,b,c" });
  const reader = new NativeMessageReader(Readable.from([framed.subarray(0, 3), framed.subarray(3)]));
  const got = [];
  reader.on("message", (m) => got.push(m));
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        assert.deepEqual(got, [{ i: 42, csv: "a,b,c" }]);
        resolve();
      } catch (e) { reject(e); }
    }, 50);
  });
});

it("a body that is not JSON is an error, and the stream is destroyed", () => {
  const framed = Buffer.concat([
    (() => { const h = Buffer.allocUnsafe(4); h.writeUInt32LE(5, 0); return h; })(),
    Buffer.from("not{}", "utf8"),
  ]);
  const reader = new NativeMessageReader(Readable.from([framed]));
  let errored = null;
  reader.on("error", (e) => { errored = e; });
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.ok(errored && /not JSON/.test(errored.message));
      resolve();
    }, 50);
  });
});

it("the writer emits the same framing the reader accepts", async () => {
  const chunks = [];
  const sink = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
  const writer = new NativeMessageWriter(sink);
  await writer.send({ op: "capabilities" });
  const framed = Buffer.concat(chunks);
  assert.equal(framed.readUInt32LE(0), framed.length - 4);
  assert.equal(JSON.parse(framed.subarray(4).toString("utf8")).op, "capabilities");
});

/* ------------------------------------------------------------------ *
 * The reply scrubber
 * ------------------------------------------------------------------ */

it("no op but credentials.get may carry a plaintext password", () => {
  const leaky = { ok: true, origin: "https://x", password: "s3cret" };
  assert.equal(scrReply("credentials.list", [leaky])[0].password, undefined);
  assert.equal(scrReply("credentials.save", leaky).password, undefined);
  assert.equal(scrReply("csv.import", leaky).password, undefined);
  assert.equal(scrReply("csv.export", leaky).password, undefined,
    "the export carries a CSV STRING, not a password field");
  assert.equal(scrReply("credentials.get", leaky).password, "s3cret");
});

it("the scrubber reaches a password nested in a result object", () => {
  const nested = { result: { credentials: [{ password: "s3cret" }] } };
  const out = scrReply("credentials.list", nested);
  assert.equal(out.result.credentials[0].password, undefined);
});

/** The import in the file body, aliased here so the test reads plainly. */
function scrReply(op, result) { return scrubReply(op, result); }

/* ------------------------------------------------------------------ *
 * The agent contract
 * ------------------------------------------------------------------ */

/** A fresh agent on a throwaway dir, with a cheap KDF for the test run. */
function freshAgent() {
  process.env.ZIY_PWD_ROUNDS = "1000";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ziy-pwd-agent-"));
  const out = [];
  const sink = new Writable({ write(c, _e, cb) { out.push(Buffer.from(c)); cb(); } });
  const agent = createAgent({ dataDir: dir, stdout: sink });
  agent._frames = out;
  agent._dir = dir;
  return agent;
}

/** Drive one op through the REAL dispatch path, including the scrubber. */
async function call(agent, op, body = {}) {
  const reply = await dispatch(agent, { op, ...body }, Date.now());
  return reply;
}

it("capabilities names the service, the KDF and every op", async () => {
  const agent = freshAgent();
  const reply = await call(agent, "capabilities");
  assert.equal(reply.ok, true);
  assert.equal(reply.result.service, "ziy-pwd");
  assert.equal(reply.result.kdf, "PBKDF2-SHA512");
  for (const op of ["vault.create", "vault.unlock", "credentials.save", "credentials.list",
    "credentials.get", "credentials.remove", "credentials.clear", "csv.import", "csv.export"]) {
    assert.ok(reply.result.ops.includes(op), `capabilities must name ${op}`);
  }
  agent.store.close();
});

it("an unknown op is an answer, not a crash", async () => {
  const agent = freshAgent();
  const reply = await call(agent, "no.such.op");
  assert.equal(reply.ok, false);
  assert.equal(reply.error, "unknown-op");
  agent.store.close();
});

it("the full happy path: create, unlock, save, list, get, remove", async () => {
  const agent = freshAgent();
  assert.equal((await call(agent, "vault.status")).result.hasVault, false);

  const created = await call(agent, "vault.create", { passphrase: "correct horse battery" });
  assert.equal(created.ok, true);
  assert.equal(created.result.created, true);

  // A fresh agent is a fresh process: lock, then unlock.
  agent.store.lock();
  const wrong = await call(agent, "vault.unlock", { passphrase: "wrong" });
  assert.equal(wrong.ok, false, "the wrong passphrase is refused");
  const unlock = await call(agent, "vault.unlock", { passphrase: "correct horse battery" });
  assert.equal(unlock.ok, true);

  const saved = await call(agent, "credentials.save",
    { origin: "https://example.com/login", username: "me", password: "pw-123" });
  assert.equal(saved.ok, true);
  assert.equal(saved.result.origin, "https://example.com");

  const list = await call(agent, "credentials.list");
  assert.equal(list.result.credentials.length, 1);
  assert.equal(list.result.credentials[0].password, undefined,
    "the list reply carries no password, enforced by the scrubber");

  const got = await call(agent, "credentials.get", { id: list.result.credentials[0].id });
  assert.equal(got.ok, true);
  assert.equal(got.result.password, "pw-123", "credentials.get is the one op that may");

  const removed = await call(agent, "credentials.remove", { id: list.result.credentials[0].id });
  assert.equal(removed.result.removed, true);
  assert.equal((await call(agent, "credentials.list")).result.credentials.length, 0);
  agent.store.close();
});

it("a locked vault refuses to save, and the reply is a clean error", async () => {
  const agent = freshAgent();
  await call(agent, "vault.create", { passphrase: "pw" });
  agent.store.lock();
  const reply = await call(agent, "credentials.save",
    { origin: "https://x.test/", username: "u", password: "p" });
  assert.equal(reply.ok, false);
  assert.match(String(reply.message), /locked/);
  agent.store.close();
});

it("csv.import reports saved and skipped, and csv.export reads back", async () => {
  const agent = freshAgent();
  await call(agent, "vault.create", { passphrase: "pw" });
  const csv = 'name,url,username,password\r\n"Acme, Inc",https://acme.test/,bob,hunter2\r\n'
    + 'NoPass,https://nopw.test/,u,\r\n';
  const imported = await call(agent, "csv.import", { csv });
  assert.equal(imported.ok, true);
  assert.equal(imported.result.saved, 1);
  assert.equal(imported.result.skipped, 1);

  const exported = await call(agent, "csv.export");
  assert.equal(exported.ok, true);
  assert.match(exported.result.csv, /hunter2/);
  assert.match(exported.result.csv, /^name,url,username,password\r\n/);
  agent.store.close();
});

it("an import that is not a CSV fails loudly, with a generic message", async () => {
  const agent = freshAgent();
  await call(agent, "vault.create", { passphrase: "pw" });
  const reply = await call(agent, "csv.import", { csv: "<html/>" });
  assert.equal(reply.ok, false);
  // The message is generic ON PURPOSE: safeMessage() refuses to echo anything
  // matching /password/ because an internal error could name a field or a path.
  // The honest contract for the panel is "this import failed", which is what it
  // gets — and the full fault is on the agent's stderr, where the browser
  // console shows it.
  assert.match(String(reply.message), /refused to include details/);
  agent.store.close();
});

it("credentials.clear deletes everything and reports the count", async () => {
  const agent = freshAgent();
  await call(agent, "vault.create", { passphrase: "pw" });
  await call(agent, "credentials.save", { origin: "https://a.test/", username: "u", password: "p" });
  await call(agent, "credentials.save", { origin: "https://b.test/", username: "v", password: "q" });
  const cleared = await call(agent, "credentials.clear");
  assert.equal(cleared.result.cleared, 2);
  assert.equal((await call(agent, "credentials.list")).result.credentials.length, 0);
  agent.store.close();
});

/* ------------------------------------------------------------------ *
 * The launch check: which extension this host serves
 * ------------------------------------------------------------------ */

it("the host serves exactly one extension id", () => {
  // The mirror of install-ziy-sync-native.js's check: a native host that answers
  // anyone who can launch it is a credential-stealing primitive.
  assert.equal(ALLOWED_EXTENSION_ID, "ziy-pwd@ziy.app");

  // ZIY_PWD_AGENT_TEST is set for this whole suite (see the top of the file), so
  // verifyLaunch's bypass is active. To test the REAL path, the env var is
  // removed for the duration of the call and restored after — a test that
  // cannot reach the real path is a test of nothing.
  const previous = process.env.ZIY_PWD_AGENT_TEST;
  delete process.env.ZIY_PWD_AGENT_TEST;
  try {
    assert.equal(verifyLaunch(["node", "ziy-pwd.js", "/m.json", "ziy-pwd@ziy.app"]).ok, true);
    assert.deepEqual(verifyLaunch(["node", "ziy-pwd.js", "/m.json", "someone@else"]),
      { ok: false, error: "refusing to serve extension someone@else" });
    assert.deepEqual(verifyLaunch(["node", "ziy-pwd.js"]),
      { ok: false, error: "no extension id in argv" });
  } finally {
    process.env.ZIY_PWD_AGENT_TEST = previous;
  }
});
