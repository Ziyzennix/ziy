/**
 * ziy-blocks — the host contract, over the real pipe.
 *
 * THE GATE (replica/native-expansion.md §7.1, T1): this suite boots the REAL
 * built host — `native/ziy-blocks/target/release/ziy-blocks` — as a child
 * process and speaks the REAL native-messaging protocol to it (4-byte UInt32LE
 * length + UTF-8 JSON). Nothing here imports the Rust code or fakes the
 * transport: the process boundary, the launch guard, the framing, the engine
 * load and the verdicts are the shipped paths, not a simulation of them.
 *
 * FIXTURES ARE PINNED TO MEASURED OUTPUT. Every expected verdict below was
 * read off the built engine on this box (the probe transcript is recorded in
 * replica/proofs-native-blocks.md): block for a google-analytics script and a
 * googlesyndication host (easylist), block for a urlhaus entry, pass for a
 * clean URL, allow for a brave-unbreak `@@` exception. If a list or engine
 * change moves one of these, this suite fails and the move gets explained —
 * that is the point of a pinned fixture.
 *
 * The artifacts are built on demand (tools/build-blocks-engine.sh) so a fresh
 * checkout runs this without a separate step; a warm tree skips straight to
 * the assertions.
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_EXTENSION_ID,
  MAX_MESSAGE_BYTES,
  encodeMessage,
  NativeMessageReader,
} from "../lib/native-protocol.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRATE = path.resolve(HERE, "..");
const ROOT = path.resolve(CRATE, "..", "..");
const HOST = path.join(CRATE, "target", "release", "ziy-blocks");
const ENGINE = path.join(CRATE, "dist", "ziy-blocks-engine.dat");

// The host ignores the manifest path on the launch line (the browser passes
// it; the id is what the guard checks), so the test passes a path that need
// not exist.
const MANIFEST_ARG = path.join(CRATE, "dist", "test-manifest.json");

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE)) {
  execFileSync("bash", [path.join(ROOT, "tools", "build-blocks-engine.sh")], {
    stdio: "inherit",
    timeout: 900_000,
  });
}

/** Boot one host over real pipes and expose a request/response helper. */
function connect() {
  const child = spawn(HOST, [MANIFEST_ARG, ALLOWED_EXTENSION_ID], {
    env: { ...process.env, ZIY_BLOCKS_ENGINE: ENGINE },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = new NativeMessageReader(child.stdout);
  const pending = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  // A host that dies mid-test EPIPEs our stdin writes; the pending replies
  // reject via timeout, but an unhandled stream error would take the whole
  // file down before that.
  child.stdin.on("error", () => {});
  reader.on("message", (reply) => {
    const waiter = pending.shift();
    if (waiter) waiter(reply);
  });
  return {
    child,
    stderr: () => stderr,
    send(message) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no reply within 10 s for ${JSON.stringify(message)}`)),
          10_000,
        );
        pending.push((reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
        child.stdin.write(encodeMessage(message));
      });
    },
    close() {
      child.stdin.end();
      child.kill("SIGTERM");
    },
  };
}

/** Resolve with {code, signal} once the child has fully closed. */
function waitClose(child) {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

/** One verdict through a fresh connection — the shape most tests need. */
async function verdictFor(message, t) {
  const host = connect();
  t.after(() => host.close());
  return host.send({ op: "verdict", ...message });
}

// --- the contract -----------------------------------------------------------

it("capabilities names the service, the protocol and both ops", async (t) => {
  const host = connect();
  t.after(() => host.close());
  const reply = await host.send({ op: "capabilities" });
  assert.equal(reply.ok, true);
  assert.equal(reply.op, "capabilities");
  assert.equal(reply.result.service, "ziy-blocks");
  assert.equal(reply.result.protocol, "mdn-native-messaging/uint32le-json");
  assert.deepEqual(reply.result.ops, ["capabilities", "verdict"]);
  // The reported engine is the file on disk — 7.50 MiB, the figure the plan
  // recorded (§6.1) and the reason the host exists.
  assert.equal(reply.result.engine.bytes, fs.statSync(ENGINE).size);
  assert.ok(reply.result.engine.bytes > 7_000_000);
  assert.ok(Number.isInteger(reply.result.engine.load_ms));
});

it("block: a tracker script from the shipped set is blocked", async (t) => {
  const reply = await verdictFor(
    {
      url: "https://www.google-analytics.com/analytics.js",
      initiator: "https://news.example/",
      type: "script",
    },
    t,
  );
  assert.equal(reply.ok, true);
  assert.equal(reply.result.verdict, "block");
  assert.equal(reply.result.important, false);
});

it("block: an ads host from the shipped set is blocked", async (t) => {
  const reply = await verdictFor(
    {
      url: "https://pageads2.googlesyndication.com/bgz/ads?id=1",
      initiator: "https://news.example/",
      type: "script",
    },
    t,
  );
  assert.equal(reply.result.verdict, "block");
});

it("block: a urlhaus entry from the shipped set is blocked", async (t) => {
  const reply = await verdictFor(
    {
      url: "http://acms.saleseos.com/x",
      initiator: "https://news.example/",
      type: "other",
    },
    t,
  );
  assert.equal(reply.result.verdict, "block");
});

it("pass: a clean URL gets no opinion", async (t) => {
  const reply = await verdictFor(
    {
      url: "https://cdn.example.com/app.js",
      initiator: "https://news.example/",
      type: "script",
    },
    t,
  );
  assert.equal(reply.result.verdict, "pass");
  assert.equal(reply.result.filter, null);
  assert.equal(reply.result.exception, null);
});

it("allow: a brave-unbreak `@@` exception decides — and its domain scope holds", async (t) => {
  // brave-unbreak ships
  //   @@||imasdk.googleapis.com/pal/sdkloader/pal.js$domain=southpark.de|...
  // The initiator is the document the rule's $domain scopes it to.
  const allowed = await verdictFor(
    {
      url: "https://imasdk.googleapis.com/pal/sdkloader/pal.js",
      initiator: "https://southpark.de/",
      type: "script",
    },
    t,
  );
  assert.equal(allowed.result.verdict, "allow");

  // From an unrelated document the exception must NOT apply. What remains may
  // be a block from easylist or a pass — either way it is not `allow`, which
  // is the assertion: the scoping is real, not incidental.
  const foreign = await verdictFor(
    {
      url: "https://imasdk.googleapis.com/pal/sdkloader/pal.js",
      initiator: "https://news.example/",
      type: "script",
    },
    t,
  );
  assert.notEqual(foreign.result.verdict, "allow");
});

// --- the protocol contract --------------------------------------------------

it("unknown op is an answer, not a crash — the host keeps serving", async (t) => {
  const host = connect();
  t.after(() => host.close());
  const bad = await host.send({ op: "no.such.op" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "unknown-op");
  // Same connection, next message: still alive.
  const after = await host.send({ op: "capabilities" });
  assert.equal(after.ok, true);
});

it("a verdict without a url is a bad-request answer", async (t) => {
  const host = connect();
  t.after(() => host.close());
  const reply = await host.send({
    op: "verdict",
    initiator: "https://news.example/",
    type: "script",
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.error, "bad-request");
});

it("two pipelined frames are answered in order", async (t) => {
  const host = connect();
  t.after(() => host.close());
  const first = host.send({
    op: "verdict",
    url: "https://www.google-analytics.com/analytics.js",
    initiator: "https://news.example/",
    type: "script",
  });
  const second = host.send({
    op: "verdict",
    url: "https://cdn.example.com/app.js",
    initiator: "https://news.example/",
    type: "script",
  });
  const [replyOne, replyTwo] = await Promise.all([first, second]);
  assert.equal(replyOne.result.verdict, "block");
  assert.equal(replyTwo.result.verdict, "pass");
});

// --- the launch guard -------------------------------------------------------

it("refuses any extension that is not ziy-shields", async () => {
  // The one id in the manifest's allowed_extensions, asserted here so a
  // renamed constant cannot silently drift from the manifest.
  assert.equal(ALLOWED_EXTENSION_ID, "ziy-shields@ziy.app");
  const child = spawn(HOST, [MANIFEST_ARG, "someone@else"], {
    env: { ...process.env, ZIY_BLOCKS_ENGINE: ENGINE },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const { code } = await waitClose(child);
  assert.equal(code, 2);
  assert.match(stderr, /refusing to serve extension someone@else/);
});

it("refuses to serve when the launch line has no extension id", async () => {
  const child = spawn(HOST, [], {
    env: { ...process.env, ZIY_BLOCKS_ENGINE: ENGINE },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const { code } = await waitClose(child);
  assert.equal(code, 2);
  assert.match(stderr, /no extension id in argv/);
});

it("an over-limit length prefix kills the host loudly, not quietly", async () => {
  const child = spawn(HOST, [MANIFEST_ARG, ALLOWED_EXTENSION_ID], {
    env: { ...process.env, ZIY_BLOCKS_ENGINE: ENGINE },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(2 * MAX_MESSAGE_BYTES, 0);
  child.stdin.write(header);
  const { code } = await waitClose(child);
  assert.equal(code, 1);
  assert.match(stderr, /exceeds/);
});

it("the JS protocol module pins the framing the host speaks", () => {
  const framed = encodeMessage({ op: "x" });
  const length = framed.readUInt32LE(0);
  assert.equal(length, framed.length - 4);
  assert.ok(length > 0 && length <= MAX_MESSAGE_BYTES);
});
