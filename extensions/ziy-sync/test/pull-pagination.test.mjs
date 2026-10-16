/**
 * handlePull pagination tests: a delta larger than one page must be delivered
 * completely, or fail loudly. Never silently truncated.
 *
 * WHY: `getBlobs` serves DEFAULT_PAGE (500) records and returns a `next_cursor`
 * for the remainder; `handlePull` issued exactly ONE request and folded whatever
 * came back in, so a 501st record was dropped with no error — and `touchSync`
 * then advanced this device's cursor past it, permanently. The server's strict
 * `updated_at > since` filter (pinned by server/test/server.test.mjs) makes the
 * lost record unfetchable afterwards, so this is silent data loss, not a delay.
 *
 * These tests drive the real server over HTTP (server/src/server.js) and the
 * real shared client protocol (extensions/ziy-sync/lib/client.js). Records are
 * constructed honestly with createRecord from the shared record format, exactly
 * as server/test/server.test.mjs does, so this proves the real protocol rather
 * than a mock of it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncClient } from "../lib/client.js";
import { ChainKeys, generateChainId, generateDeviceIdentity, deviceIdOf, sign } from "../lib/keyderivation.js";
import { mnemonicToBytes, generateMnemonic } from "../lib/bip39.js";
import { createRecord } from "../lib/record.js";
import { BlindStore, DEFAULT_PAGE } from "../../../server/src/store.js";
import { createServer } from "../../../server/src/server.js";

/* ------------------------------------------------------------------------- */
/* harness — the same shape as server/test/server.test.mjs                    */
/* ------------------------------------------------------------------------- */

let nextPort = 18800;

async function startServer(store) {
  const port = nextPort++;
  const server = createServer({ store, log: null });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${port}`;
  const close = () => new Promise((resolve) => server.close(resolve));
  return { server, store, base, close };
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ziy-pull-page-${name}-`));
}

async function makeDevice(keys, name) {
  const identity = await generateDeviceIdentity();
  const id = await deviceIdOf(identity);
  return { name, identity, id, raw: new Uint8Array(await crypto.subtle.exportKey("raw", identity.publicKey)) };
}

async function makeChain(name) {
  const words = await generateMnemonic();
  const ikm = await mnemonicToBytes(words);   // the words ARE the entropy
  const chainId = generateChainId();
  const keys = new ChainKeys(ikm, chainId, "ember");
  const devices = [await makeDevice(keys, "desktop"), await makeDevice(keys, "laptop")];
  return { words, ikm, chainId, keys, devices };
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
  return (await session.json()).token;
}

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

async function pushRecord(client, chainId, token, record) {
  const response = await fetch(`${client.base}/v1/chains/${chainId}/records`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify([record]),
  });
  assert.equal(response.status, 200);
  return response.json();
}

/** A SyncClient bound to one device of the chain. */
function clientFor(chain, device, client) {
  return new SyncClient({
    baseUrl: client.base,
    keys: chain.keys,
    device: {
      publicKeyB64: device.id,
      privateKey: device.identity.privateKey,
      deviceId: device.id,
      deviceName: device.name,
      deviceType: "desktop",
    },
    fetch: (url, init) => fetch(url, init),
  });
}

/**
 * Push `count` records and return the last-written id. Every record is a real
 * encrypted, signed blob the server accepts, so what gets pulled back is the
 * real protocol answer.
 */
async function seedRecords(client, chain, count) {
  const token = await register(client, chain.chainId, chain.devices[0]);
  const base = 1_000_000;
  for (let i = 1; i <= count; i++) {
    const record = await writeRecord(
      chain.keys,
      chain.devices[0],
      "bookmarks",
      `r${i}`,
      base + i,
      { i, title: `record ${i}` },
    );
    const pushed = await pushRecord(client, chain.chainId, token, record);
    assert.ok(pushed.accepted.includes(`r${i}`), `record r${i} must be accepted`);
  }
  return token;
}

/* ------------------------------------------------------------------------- */
/* the tests                                                                  */
/* ------------------------------------------------------------------------- */

test("the default page is 500, so the >500 case is one record past the boundary", () => {
  assert.equal(DEFAULT_PAGE, 500);
});

test("a delta larger than DEFAULT_PAGE is delivered to SyncClient.pull completely", async (t) => {
  const dir = tempDir("big");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("big");

  // One past the boundary: DEFAULT_PAGE + 1. The first page alone cannot hold
  // it, so this test cannot pass unless the client paginates.
  const count = DEFAULT_PAGE + 1;
  await seedRecords(client, chain, count);

  // Device B is a second device of the same chain, with a fresh cursor — the
  // same situation as a device that syncs after a long absence.
  await register(client, chain.chainId, chain.devices[1]);
  const sync = clientFor(chain, chain.devices[1], client);
  await sync.connect();

  const storeView = {};
  const results = await sync.pull(storeView);

  const acceptedIds = results.accepted.map((r) => r.record_id).sort();
  assert.equal(acceptedIds.length, count, `all ${count} records must be accepted, got ${acceptedIds.length}`);
  const expected = [];
  for (let i = 1; i <= count; i++) expected.push(`r${i}`);
  assert.deepEqual(acceptedIds, expected.sort(), "every record id, exactly once, no gaps");
  assert.equal(results.rejected.length, 0, "nothing may be rejected");
  // Every record must also have landed in the local view, which is the point
  // of the pull: a decrypt failure would leave the view short.
  assert.equal(Object.keys(storeView.bookmarks || {}).length, count, "every record must decrypt into the local view");
});

test(">1.5 pages of delta is delivered completely across real page boundaries", async (t) => {
  const dir = tempDir("pages");
  const store = new BlindStore(path.join(dir, "b.sqlite"));
  const client = await startServer(store);
  t.after(client.close);
  const chain = await makeChain("pages");

  // Well past two pages, so the cursor chain is exercised more than once.
  const count = DEFAULT_PAGE * 2 + 3;
  await seedRecords(client, chain, count);

  await register(client, chain.chainId, chain.devices[1]);
  const sync = clientFor(chain, chain.devices[1], client);
  await sync.connect();

  const storeView = {};
  const results = await sync.pull(storeView);
  assert.equal(results.accepted.length, count, `all ${count} records must arrive`);
  assert.equal(results.rejected.length, 0, "nothing may be rejected");
  assert.equal(Object.keys(storeView.bookmarks || {}).length, count, "the local view must hold every record");
});
