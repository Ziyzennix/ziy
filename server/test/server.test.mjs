/**
 * The blind-storage server tests.
 *
 * These build REAL clients — the same libs the extension uses — and exercise the
 * real HTTP surface, then assert what the server did and did not learn. That is
 * the only honest way to test a blind store: if a test could construct records
 * the server would never see, it would prove nothing about the protocol.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlindStore, verifyEd25519 } from "../src/store.js";
import { createServer } from "../src/server.js";
import { ChainKeys, generateChainId, generateDeviceIdentity, deviceIdOf, sign } from "../../extensions/ziy-sync/lib/keyderivation.js";
import { mnemonicToBytes, generateMnemonic } from "../../extensions/ziy-sync/lib/bip39.js";
import { createRecord } from "../../extensions/ziy-sync/lib/record.js";

/* ------------------------------------------------------------------------- */
/* harness                                                                    */
/* ------------------------------------------------------------------------- */

let nextPort = 18700;

/** Start a real server on a real port with a real SQLite file. */
async function startServer(store) {
  const port = nextPort++;
  const server = createServer({ store });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${port}`;
  const close = () => new Promise((resolve) => server.close(resolve));
  return { server, store, base, close };
}

function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ziy-sync-test-${name}-`));
  return dir;
}

/** A complete device, ready to authenticate. */
async function makeDevice(keys, name) {
  const identity = await generateDeviceIdentity();
  const id = await deviceIdOf(identity);
  return { name, identity, id, raw: new Uint8Array(await crypto.subtle.exportKey("raw", identity.publicKey)) };
}

async function register(client, chainId, device) {
  const response = await fetch(`${client.base}/v1/chains`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chain_id: chainId,
      device_pubkey: device.id,
      device_name: device.name,
      device_type: "desktop",
    }),
  });
  assert.equal(response.status, 200, "registration must succeed");
  const body = await response.json();
  const signature = await sign(device.identity.privateKey, body.challenge);
  const session = await fetch(`${client.base}/v1/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_id: body.device_id, challenge: body.challenge, signature }),
  });
  assert.equal(session.status, 200, "challenge must be answered");
  const sessionBody = await session.json();
  return sessionBody.token;
}

/** Full chain: keys, two devices, a chain id. */
async function makeChain(name) {
  const words = await generateMnemonic();
  const ikm = await mnemonicToBytes(words);   // the words ARE the entropy
  const chainId = generateChainId();
  const keys = new ChainKeys(ikm, chainId, "ember");
  const devices = [await makeDevice(keys, "desktop"), await makeDevice(keys, "laptop")];
  return { words, ikm, chainId, keys, devices };
}

async function pushRecord(client, chainId, token, record) {
  const response = await fetch(`${client.base}/v1/chains/${chainId}/records`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify([record]),
  });
  assert.equal(response.status, 200);
  return response.json();
}

/** Device A writes a real encrypted record. */
async function writeRecord(keys, device, category, recordId, updatedAt, payload, tombstone = false) {
  return createRecord({
    categoryKey: await keys.categoryKey(category),
    privateKey: device.identity.privateKey,
    publicKeyB64: device.id,
    category,
    recordId,
    updatedAt,
    payload,
    tombstone,
  });
}

/* ------------------------------------------------------------------------- */
/* protocol                                                                   */
/* ------------------------------------------------------------------------- */

test("healthz answers without auth", async (t) => {
  const dir = tempDir("healthz");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const response = await fetch(`${client.base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "ziy-sync-server", api: "v1" });
});

test("register -> challenge -> token, and an unauthenticated read is refused", async (t) => {
  const dir = tempDir("auth");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);

  const chain = await makeChain("auth");
  const token = await register(client, chain.chainId, chain.devices[0]);
  assert.ok(token, "a token must be issued");

  const noToken = await fetch(`${client.base}/v1/chains/${chain.chainId}/records`);
  assert.equal(noToken.status, 401);
  assert.equal((await noToken.json()).error, "no-token");

  const wrongChain = await fetch(`${client.base}/v1/chains/someotherchainid/records`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(wrongChain.status, 403, "a token for one chain must not read another");
  assert.equal((await wrongChain.json()).error, "chain-mismatch");

  const ok = await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(body.records, []);
  assert.ok(typeof body.server_time === "number");
});

test("a wrong signature cannot answer a challenge", async (t) => {
  const dir = tempDir("badsig");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("badsig");

  const registered = await fetch(`${client.base}/v1/chains`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain_id: chain.chainId, device_pubkey: chain.devices[0].id }),
  });
  const challenge = (await registered.json()).challenge;
  const badSignature = await sign(chain.devices[1].identity.privateKey, challenge);
  const session = await fetch(`${client.base}/v1/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_id: chain.devices[0].id,
      challenge,
      signature: badSignature,
    }),
  });
  assert.equal(session.status, 403);
  assert.match((await session.json()).error, /bad-signature/);
});

test("a used challenge is refused", async (t) => {
  const dir = tempDir("used");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("used");
  const device = chain.devices[0];

  const registered = await fetch(`${client.base}/v1/chains`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain_id: chain.chainId, device_pubkey: device.id }),
  });
  const challenge = (await registered.json()).challenge;
  const signature = await sign(device.identity.privateKey, challenge);
  const body = JSON.stringify({ device_id: device.id, challenge, signature });

  const first = await fetch(`${client.base}/v1/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(first.status, 200);

  const replay = await fetch(`${client.base}/v1/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(replay.status, 403, "a challenge is single-use");
});

test("a record forged under another device's key is refused", async (t) => {
  const dir = tempDir("forged");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("forged");
  const token = await register(client, chain.chainId, chain.devices[0]);

  // Device B signs, but the record's `signer` claims device B while the chain
  // only knows device A. One device cannot plant blobs under another's name.
  const forged = await writeRecord(chain.keys, chain.devices[1], "bookmarks", "forged", 1761000000, { title: "x" });
  const response = await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify([forged]),
  });
  assert.equal(response.status, 200, "the request itself is accepted; the record is rejected in the body");
  const body = await response.json();
  assert.deepEqual(body.accepted, []);
  assert.equal(body.rejected[0].reason, "signer-not-in-chain");
});

test("node:crypto verifies the signature a WebCrypto client made (cross-boundary)", async () => {
  const chain = await makeChain("crossboundary");
  const device = chain.devices[0];
  const record = await writeRecord(chain.keys, device, "bookmarks", "rec-1", 1761000000, { title: "t" });
  const message = [
    "ziy-rec/v1", record.category, record.record_id, String(record.updated_at),
    record.tombstone ? "tombstone" : "live", record.nonce, record.payload,
  ].join("|");
  const ok = verifyEd25519(device.raw, message, record.sig);
  assert.ok(ok, "the server's node:crypto verifier must accept a WebCrypto signature");
});

/* ------------------------------------------------------------------------- */
/* what the server learned                                                   */
/* ------------------------------------------------------------------------- */

test("THE BLINDNESS PROOF: after a sync, nothing in the DB reveals the payload", async (t) => {
  const dir = tempDir("blindness");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("blindness");
  const token = await register(client, chain.chainId, chain.devices[0]);

  const secretDomain = "supersecret-private-site.example";
  const secretTitle = "a bookmark nobody should ever see on a server";
  const record = await writeRecord(chain.keys, chain.devices[0], "bookmarks", "rec-1", 1761000000, {
    title: secretTitle,
    url: `https://${secretDomain}/path`,
    folder: "private",
  });
  const pushed = await pushRecord(client, chain.chainId, token, record);
  assert.deepEqual(pushed.accepted, ["rec-1"]);

  // Read the server's database the way an attacker with the file would.
  const raw = fs.readFileSync(path.join(dir, "b.sqlite"));
  const text = raw.toString("utf8");
  for (const forbidden of [secretDomain, secretTitle, "private", "example.com", "supersecret"]) {
    assert.ok(!text.includes(forbidden), `the database must not contain "${forbidden}"`);
  }

  // And the JSON the server would hand to a device contains the ciphertext only.
  const pulled = await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await pulled.json();
  const wire = body.records[0];
  assert.deepEqual(Object.keys(wire).sort(), [
    "category", "nonce", "payload", "record_id", "sig", "signer", "size_bytes", "tombstone", "updated_at",
  ]);
  // The `category` is a routing label, not a secret: it names the bucket. It is
  // the only piece of plaintext semantics the server stores, and it is stated.
  assert.equal(wire.category, "bookmarks");
  assert.equal(wire.record_id, "rec-1");
  assert.equal(wire.updated_at, 1761000000);
  assert.equal(wire.tombstone, false);
  assert.equal(wire.signer, chain.devices[0].id);
  assert.ok(wire.payload.length > 16);
  // The device's id and its chain never appear as a pair anywhere in the words.
  const chainIdAndWords = chain.chainId + chain.words.join(" ");
  assert.ok(!text.includes(chainIdAndWords));

  // What it CAN see, stated once so it is never mis-remembered.
  const visible = {
    chain_id: "yes (bucket key)",
    record_id: "yes (blob key)",
    updated_at: "yes",
    tombstone: "yes",
    category: "yes (routing label, not a secret)",
    payload: "ciphertext only",
    signer: "yes (the device's public key)",
    sig: "yes",
    size_bytes: "yes",
    words: "NO",
    seed: "NO",
    keys: "NO",
    plaintext: "NO",
  };
  t.diagnostic("server visibility: " + JSON.stringify(visible, null, 2));
});

test("no plaintext leaks into the server's own code path either", async (t) => {
  const dir = tempDir("noplaintext");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("noplaintext");
  const token = await register(client, chain.chainId, chain.devices[0]);

  const payload = { title: "secret-title-123", url: "https://secret-host-456.example/" };
  const record = await writeRecord(chain.keys, chain.devices[0], "bookmarks", "r1", 1761000000, payload);
  await pushRecord(client, chain.chainId, token, record);

  const db = store.db;
  const rows = db.prepare("select * from blobs").all();
  assert.equal(rows.length, 1);
  for (const row of rows) {
    const asText = JSON.stringify(row);
    for (const needle of ["secret-title-123", "secret-host-456", "example.com"]) {
      assert.ok(!asText.includes(needle), `the blob row must not contain ${needle}`);
    }
  }
});

/* ------------------------------------------------------------------------- */
/* last-writer-wins on the server                                             */
/* ------------------------------------------------------------------------- */

test("the server rejects a stale record (backwards updated_at)", async (t) => {
  const dir = tempDir("stale");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("stale");
  const token = await register(client, chain.chainId, chain.devices[0]);

  const newer = await writeRecord(chain.keys, chain.devices[0], "bookmarks", "r1", 200, { v: 2 });
  const older = await writeRecord(chain.keys, chain.devices[0], "bookmarks", "r1", 100, { v: 1 });

  assert.deepEqual((await pushRecord(client, chain.chainId, token, newer)).accepted, ["r1"]);
  const rejected = await pushRecord(client, chain.chainId, token, older);
  assert.deepEqual(rejected.accepted, []);
  assert.equal(rejected.rejected[0].reason, "stale");

  const pulled = await (await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  assert.equal(pulled.records[0].updated_at, 200, "the newer record survived");
  assert.equal(pulled.records[0].payload, newer.payload);
});

test("the server's tie-break matches the client's (smaller signer wins)", async (t) => {
  const dir = tempDir("tiebreak");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("tiebreak");
  const token = await register(client, chain.chainId, chain.devices[0]);

  // Both write at the same second; whichever device has the lexicographically
  // smaller public key wins. We do not know in advance which that is, so the
  // test computes it and asserts the server agrees with the client's rule.
  const at = 1761000000;
  const a = await writeRecord(chain.keys, chain.devices[0], "bookmarks", "r1", at, { from: "a" });
  const b = await writeRecord(chain.keys, chain.devices[1], "bookmarks", "r1", at, { from: "b" });
  await register(client, chain.chainId, chain.devices[1]);

  const expectedWinner = a.signer <= b.signer ? a : b;
  await pushRecord(client, chain.chainId, token, a);
  await pushRecord(client, chain.chainId, token, b);

  const pulled = await (await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  assert.equal(pulled.records[0].sig, expectedWinner.sig, "server and client resolve ties identically");
});

/* ------------------------------------------------------------------------- */
/* deltas, pagination                                                         */
/* ------------------------------------------------------------------------- */

test("since= returns only newer records, and pagination covers everything", async (t) => {
  const dir = tempDir("delta");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("delta");
  const token = await register(client, chain.chainId, chain.devices[0]);

  for (let i = 1; i <= 7; i++) {
    const record = await writeRecord(chain.keys, chain.devices[0], "bookmarks", `r${i}`, 100 + i, { i });
    assert.ok((await pushRecord(client, chain.chainId, token, record)).accepted.includes(`r${i}`));
  }
  const token2 = await register(client, chain.chainId, chain.devices[1]);

  const since = await (await fetch(`${client.base}/v1/chains/${chain.chainId}/records?since=104`, {
    headers: { authorization: `Bearer ${token2}` },
  })).json();
  assert.equal(since.records.length, 3, "only 105,106,107");

  let cursor = null;
  const seen = [];
  for (;;) {
    const url = `${client.base}/v1/chains/${chain.chainId}/records?page=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = await (await fetch(url, { headers: { authorization: `Bearer ${token2}` } })).json();
    seen.push(...body.records.map((r) => r.record_id));
    if (!body.next_cursor) break;
    cursor = body.next_cursor;
  }
  assert.deepEqual(seen.sort(), ["r1", "r2", "r3", "r4", "r5", "r6", "r7"], "pagination must cover every record exactly once");
});

/* ------------------------------------------------------------------------- */
/* leave / wipe                                                               */
/* ------------------------------------------------------------------------- */

test("leaving the chain deletes the server's blob cache", async (t) => {
  const dir = tempDir("leave");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("leave");
  const token = await register(client, chain.chainId, chain.devices[0]);

  const record = await writeRecord(chain.keys, chain.devices[0], "bookmarks", "r1", 100, { v: 1 });
  await pushRecord(client, chain.chainId, token, record);
  assert.equal(store.db.prepare("select count(*) as n from blobs").get().n, 1);

  const other = await register(client, chain.chainId, chain.devices[1]);
  const leave = await fetch(`${client.base}/v1/chains/${chain.chainId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${other}` },
  });
  assert.equal(leave.status, 200);
  const leaveBody = await leave.json();
  assert.equal(leaveBody.blobs_deleted, 1);

  // The other device's token is now useless: no chain, no session, no blobs.
  assert.equal(store.db.prepare("select count(*) as n from blobs").get().n, 0);
  assert.equal(store.db.prepare("select count(*) as n from devices").get().n, 0);
  const after = await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    headers: { authorization: `Bearer ${other}` },
  });
  assert.equal(after.status, 401, "the session is gone with the chain");
});

test("tombstones are garbage-collected once every device has seen past them", async (t) => {
  const dir = tempDir("gc");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  t.after(() => store.close());
  const chain = await makeChain("gc");

  store.registerDevice({ chainId: chain.chainId, deviceId: chain.devices[0].id, publicKey: chain.devices[0].raw, deviceName: "a" });
  store.registerDevice({ chainId: chain.chainId, deviceId: chain.devices[1].id, publicKey: chain.devices[1].raw, deviceName: "b" });
  // Both devices have synced recently (now), so an old tombstone is seen by both.
  const now = Math.floor(Date.now() / 1000);

  // A tombstone that every device has seen past: its updated_at is below the
  // oldest last_seen.
  const seen = await writeRecord(chain.keys, chain.devices[1], "bookmarks", "gone", now - 3600, null, true);
  store.putBlob({ chain_id: chain.chainId, ...seen });
  // One nobody has seen past: it is newer than the oldest last_seen.
  const fresh = await writeRecord(chain.keys, chain.devices[1], "bookmarks", "kept", now + 60, null, true);
  store.putBlob({ chain_id: chain.chainId, ...fresh });

  const removed = store.gcTombstones();
  assert.equal(removed.removed, 1);
  const rows = store.db.prepare("select record_id from blobs").all();
  assert.deepEqual(rows.map((r) => r.record_id), ["kept"]);
});

/* ------------------------------------------------------------------------- */
/* input validation                                                           */
/* ------------------------------------------------------------------------- */

test("malformed records are rejected with a reason, not a crash", async (t) => {
  const dir = tempDir("validation");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("validation");
  const token = await register(client, chain.chainId, chain.devices[0]);

  const bad = [
    { reason: "bad-category", record: null },
  ];
  const response = await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(bad),
  });
  assert.equal(response.status, 200, "a bad record is reported, never a 500");
  const body = await response.json();
  assert.equal(body.rejected.length, 1);
  assert.match(body.rejected[0].reason, /bad-category|not-an-object/);
});

test("an over-large request body is refused with 413", async (t) => {
  const dir = tempDir("toobig");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("toobig");
  const token = await register(client, chain.chainId, chain.devices[0]);

  const huge = "x".repeat(5 * 1024 * 1024);
  const response = await fetch(`${client.base}/v1/chains/${chain.chainId}/records`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify([{ junk: huge }]),
  });
  assert.equal(response.status, 413);
});

test("the store's SCHEMA declares user_version 1", () => {
  const store = new BlindStore(":memory:");
  const version = store.db.prepare("pragma user_version").get();
  assert.equal(version.user_version, 1);
  store.close();
});
