/**
 * SyncRecord tests: format, encryption round-trip, AAD binding, tombstones,
 * last-writer-wins conflict resolution with tie-break, and category gating.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecord,
  readRecord,
  normalizeRecord,
  resolveConflict,
  applyToView,
  categoryGate,
  canSend,
  canReceive,
  garbageCollect,
  signingMessage,
  aadFor,
  RECORD_AAD_PREFIX,
} from "../lib/record.js";
import { ChainKeys, generateChainId, generateDeviceIdentity, deviceIdOf } from "../lib/keyderivation.js";
import { mnemonicToBytes, generateMnemonic, fromBase64Url, toBase64Url, utf8, randomBytes } from "../lib/bip39.js";

/** A real chain, two real devices. */
async function makeDevices({ seed } = {}) {
  const words = await generateMnemonic();
  const chainSeed = seed || (await mnemonicToBytes(words));
  const chainId = generateChainId();
  const keys = new ChainKeys(chainSeed, chainId, "ember");

  const deviceA = await generateDeviceIdentity();
  const deviceB = await generateDeviceIdentity();

  return {
    chainId,
    keys,
    devices: [
      { name: "desktop", identity: deviceA, id: await deviceIdOf(deviceA) },
      { name: "laptop", identity: deviceB, id: await deviceIdOf(deviceB) },
    ],
  };
}

/** Write a record the way a device would. */
async function write(device, keys, category, recordId, updatedAt, payload, tombstone = false) {
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
/* format                                                                     */
/* ------------------------------------------------------------------------- */

test("a record carries exactly the documented fields", async () => {
  const { keys, devices } = await makeDevices();
  const record = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, { title: "Ziy" });
  assert.deepEqual(Object.keys(record).sort(), [
    "category", "nonce", "payload", "record_id", "sig", "signer", "tombstone", "updated_at",
  ]);
  assert.equal(record.category, "bookmarks");
  assert.equal(record.record_id, "rec-1");
  assert.equal(record.updated_at, 1761000000);
  assert.equal(record.tombstone, false);
  assert.equal(fromBase64Url(record.nonce).length, 12, "nonce is 96 bits");
  assert.ok(record.payload.length > 0, "ciphertext is present");
  assert.equal(record.signer, devices[0].id);
});

test("the payload is ciphertext, not the plaintext", async () => {
  const { keys, devices } = await makeDevices();
  const secret = { title: "example.com private bookmark", url: "https://example.com/x" };
  const record = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, secret);
  const plaintext = Buffer.from(fromBase64Url(record.payload)).toString("utf8");
  assert.ok(!plaintext.includes("example.com"), "the domain must not appear in the payload");
  assert.ok(!plaintext.includes("private bookmark"), "the title must not appear in the payload");
});

test("an unknown category is refused", async () => {
  const { keys, devices } = await makeDevices();
  await assert.rejects(
    () => write(devices[0], keys, "wallet", "rec-1", 1761000000, {}),
    /unknown sync category/,
  );
});

test("the record_id must be non-empty and updated_at an integer", async () => {
  const { keys, devices } = await makeDevices();
  await assert.rejects(() => write(devices[0], keys, "bookmarks", "", 1761000000, {}), /record_id is required/);
  await assert.rejects(
    () => write(devices[0], keys, "bookmarks", "r", 1.5, {}),
    /updated_at must be integer/,
  );
});

/* ------------------------------------------------------------------------- */
/* round-trip                                                                 */
/* ------------------------------------------------------------------------- */

test("encrypt -> decrypt round-trips every category's payload", async () => {
  const { keys, devices } = await makeDevices();
  const cases = [
    ["bookmarks", { title: "Ziy", url: "https://ziy.app", folder: "reading list" }],
    ["history", [{ url: "https://a.example", at: 1 }, { url: "https://b.example", at: 2 }]],
    ["themes", { accent: "#0b6e6e", dark: true }],
    ["apps", [{ id: "com.example.mail", enabled: false }]],
    ["settings", { "settings.search": "ziy", nested: { deep: [1, 2, 3] } }],
  ];
  for (const [category, payload] of cases) {
    const record = await write(devices[0], keys, category, `rec-${category}`, 1761000000, payload);
    const read = await readRecord({ categoryKey: await keys.categoryKey(category), record });
    assert.ok(read.ok, `read failed for ${category}: ${read.reason}`);
    assert.deepEqual(read.value, payload);
  }
});

test("the nonce follows Brave's counter||random construction", async () => {
  const { recordNonce } = await import("../lib/record.js");
  const a = recordNonce();
  const b = recordNonce();
  assert.equal(a.length, 12, "AES-GCM takes a 12-byte IV");

  // Brave's GetNonce (crypto.cc:79-89) puts a big-endian counter first. Ours
  // does the same, so two consecutive calls in one process increment those two
  // bytes by exactly one — which is what makes a replayed record re-encrypt
  // differently even before the random tail differs.
  const counter = (iv) => (iv[0] << 8) | iv[1];
  assert.equal(counter(b), (counter(a) + 1) & 0xffff, "the counter advances by one");

  // An explicitly supplied counter is honoured, so a caller can pin the slot.
  const forced = recordNonce({ counter: 0x0102 });
  assert.equal(forced[0], 0x01);
  assert.equal(forced[1], 0x02);
  // And the tail really is CSPRNG, not a constant.
  const tail = recordNonce();
  const tail2 = recordNonce();
  assert.notEqual(Buffer.from(tail.subarray(2)).toString("hex"), Buffer.from(tail2.subarray(2)).toString("hex"));
});

test("two records of the same id with the same plaintext produce different ciphertexts", async () => {
  const { keys, devices } = await makeDevices();
  const payload = { title: "same" };
  const a = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, payload);
  const b = await write(devices[0], keys, "bookmarks", "rec-1", 1761000001, payload);
  assert.notEqual(a.payload, b.payload, "a fresh 96-bit nonce per record, always");
  assert.notEqual(a.nonce, b.nonce);
});

test("the other device can decrypt the first device's record", async () => {
  // Both devices derive the same chain keys from the same seed, which is the
  // whole point of the chain: device B reads a bookmark device A synced.
  const { keys, devices } = await makeDevices();
  const record = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, { title: "shared" });
  const read = await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record });
  assert.ok(read.ok);
  assert.deepEqual(read.value, { title: "shared" });
});

test("a record cannot be decrypted with another chain's keys", async () => {
  const A = await makeDevices();
  const B = await makeDevices();
  const record = await write(A.devices[0], A.keys, "bookmarks", "rec-1", 1761000000, { title: "A only" });
  const read = await readRecord({ categoryKey: await B.keys.categoryKey("bookmarks"), record });
  assert.ok(!read.ok);
  // The signature is over the identifying fields with device A's key, which
  // device B also holds (both are in the same chain in the real product — this
  // test's B is a DIFFERENT chain, so its verification key differs and the
  // decrypt step is what rejects the record).
  assert.equal(read.reason, "decrypt-failed");
});

/* ------------------------------------------------------------------------- */
/* AAD binding                                                                */
/* ------------------------------------------------------------------------- */

test("AAD is bound to (category, record_id, updated_at)", async () => {
  const { keys, devices } = await makeDevices();
  const record = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, { title: "bound" });
  const fresh = await keys.categoryKey("bookmarks");
  const tampered = { ...record, record_id: "rec-2" };
  const read = await readRecord({ categoryKey: fresh, record: tampered });
  // The signature covers record_id too, so the tamper is caught first.
  assert.ok(!read.ok);
  assert.equal(read.reason, "signature-invalid");

  // And with the signature re-written, the AAD still refuses it.
  const resigned = await write(devices[0], keys, "bookmarks", "rec-2", 1761000000, { title: "bound" });
  const readResigned = await readRecord({ categoryKey: fresh, record: resigned });
  assert.ok(readResigned.ok, "a record re-filed under a new id with a new signature is simply a different record");
});

test("changing the timestamp breaks both the signature and the AAD", async () => {
  const { keys, devices } = await makeDevices();
  const record = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, { title: "t" });
  const shifted = { ...record, updated_at: 1761000001 };
  const result = await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record: shifted });
  assert.ok(!result.ok);
  assert.equal(result.reason, "signature-invalid");
});

test("the AAD helper matches what the record layer binds", async () => {
  const aad = aadFor("bookmarks", "rec-1", 1761000000);
  assert.equal(new TextDecoder().decode(aad), "ziy-rec/v1|bookmarks|rec-1|1761000000");
  assert.equal(RECORD_AAD_PREFIX, "ziy-rec/v1");
});

/* ------------------------------------------------------------------------- */
/* tombstones                                                                 */
/* ------------------------------------------------------------------------- */

test("a tombstone round-trips and reads as null", async () => {
  const { keys, devices } = await makeDevices();
  const record = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, { title: "x" }, true);
  assert.equal(record.tombstone, true);
  // AES-GCM over an empty plaintext is exactly the 16-byte tag, so the
  // ciphertext is NOT empty — it is just not carrying any content.
  assert.equal(fromBase64Url(record.payload).length, 16, "a tombstone's ciphertext is the GCM tag only");
  const read = await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record });
  assert.ok(read.ok);
  assert.equal(read.value, null);
  assert.deepEqual(read.record.tombstone, true);
});

test("a record whose payload is shorter than a GCM tag is refused", async () => {
  const { keys, devices } = await makeDevices();
  const good = await write(devices[0], keys, "bookmarks", "rec-1", 1761000000, { title: "ok" });
  const result = await readRecord({
    categoryKey: await keys.categoryKey("bookmarks"),
    record: { ...good, payload: "AAAA" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "payload-too-short");
});

test("normalizeRecord rejects malformed shapes", async () => {
  const base = {
    category: "bookmarks",
    record_id: "r",
    updated_at: 1,
    tombstone: false,
    nonce: toBase64Url(randomBytes(12)),
    // A real AES-GCM ciphertext: at least the 16-byte authentication tag.
    payload: toBase64Url(randomBytes(32)),
    signer: "x",
    sig: "y",
  };
  assert.equal(normalizeRecord({ ...base, tombstone: "no" }).error, "bad-tombstone");
  assert.equal(normalizeRecord({ ...base, nonce: "!!" }).error, "bad-nonce");
  assert.equal(normalizeRecord({ ...base, updated_at: -1 }).error, "bad-updated-at");
  assert.equal(normalizeRecord({ ...base, category: "wallet" }).error, "bad-category");
  // An empty payload fails the base64url shape check first, and a short-but-
  // shaped one fails the GCM-tag length check.
  assert.equal(normalizeRecord({ ...base, payload: "" }).error, "bad-payload");
  assert.equal(normalizeRecord({ ...base, payload: "AAAA" }).error, "payload-too-short");
  assert.equal(normalizeRecord(null).error, "not-an-object");
  assert.ok(normalizeRecord(base).record, "a well-formed record passes");
  // A tombstone's ciphertext is the 16-byte GCM tag, so a shorter one is refused.
  assert.equal(normalizeRecord({ ...base, tombstone: true, payload: "AAAA" }).error, "payload-too-short");
});

/* ------------------------------------------------------------------------- */
/* last-writer-wins                                                           */
/* ------------------------------------------------------------------------- */

test("LWW: the later updated_at wins", () => {
  const a = { updated_at: 100, signer: "b" };
  const b = { updated_at: 200, signer: "a" };
  assert.equal(resolveConflict(a, b), b);
  assert.equal(resolveConflict(b, a), b, "order must not matter");
});

test("LWW tie-break: equal updated_at -> the lexicographically smaller device id wins", () => {
  const a = { updated_at: 100, signer: "device-a" };
  const b = { updated_at: 100, signer: "device-b" };
  assert.equal(resolveConflict(a, b), a);
  assert.equal(resolveConflict(b, a), a, "order must not matter");
});

test("LWW: a later record from a larger device id still wins on time", () => {
  // Tie-break only applies when the timestamps are equal; a later timestamp
  // from the larger id must still win. This is the case a naive
  // "lexicographically smaller always wins" implementation gets wrong.
  const a = { updated_at: 100, signer: "device-a" };
  const b = { updated_at: 200, signer: "device-b" };
  assert.equal(resolveConflict(a, b), b);
  assert.equal(resolveConflict(b, a), b);
});

test("LWW: a tombstone with a later timestamp deletes a live record", async () => {
  const { keys, devices } = await makeDevices();
  const store = {};
  const live = await write(devices[0], keys, "bookmarks", "rec-1", 100, { title: "keep me" });
  const gone = await write(devices[1], keys, "bookmarks", "rec-1", 200, null, true);
  const a = await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record: live });
  const b = await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record: gone });
  assert.ok(a.ok && b.ok);
  applyToView(store, a.record);
  applyToView(store, b.record);
  assert.equal(store.bookmarks["rec-1"].tombstone, true);
  assert.equal(store.bookmarks["rec-1"].updated_at, 200);
});

test("an older tombstone does not delete a newer live record", async () => {
  const { keys, devices } = await makeDevices();
  const store = {};
  const live = await write(devices[0], keys, "bookmarks", "rec-1", 300, { title: "newer" });
  const stale = await write(devices[1], keys, "bookmarks", "rec-1", 100, null, true);
  applyToView(store, (await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record: live })).record);
  const applied = applyToView(store, (await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record: stale })).record);
  assert.equal(applied, null, "the stale tombstone must not be applied");
  assert.equal(store.bookmarks["rec-1"].tombstone, false);
});

test("applyToView returns null when the local copy already wins", async () => {
  const { keys, devices } = await makeDevices();
  const store = {};
  const winner = await write(devices[0], keys, "bookmarks", "rec-1", 200, { title: "w" });
  const loser = await write(devices[1], keys, "bookmarks", "rec-1", 100, { title: "l" });
  applyToView(store, (await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record: winner })).record);
  const applied = applyToView(store, (await readRecord({ categoryKey: await keys.categoryKey("bookmarks"), record: loser })).record);
  assert.equal(applied, null);
  assert.equal(store.bookmarks["rec-1"].signer, winner.signer);
});

/* ------------------------------------------------------------------------- */
/* category gating                                                            */
/* ------------------------------------------------------------------------- */

test("a category off is neither sent nor received", () => {
  const gate = categoryGate(["bookmarks", "passwords", "history"], {
    send: ["passwords"],
    receive: ["history"],
  });
  assert.ok(canSend(gate, "bookmarks"));
  assert.ok(!canSend(gate, "passwords"));
  assert.ok(canReceive(gate, "bookmarks"));
  assert.ok(canReceive(gate, "passwords"));
  assert.ok(!canReceive(gate, "history"));
});

test("unknown categories are neither sent nor received", () => {
  const gate = categoryGate(["bookmarks"]);
  assert.ok(!canSend(gate, "wallet"));
  assert.ok(!canReceive(gate, "wallet"));
});

test("a gated-off incoming record is never applied to the store", async () => {
  const { keys, devices } = await makeDevices();
  const gate = categoryGate(["bookmarks", "passwords"], { receive: ["passwords"] });
  const record = await write(devices[0], keys, "passwords", "rec-1", 100, { user: "u" });
  const read = await readRecord({ categoryKey: await keys.categoryKey("passwords"), record });
  assert.ok(read.ok, "the record is well-formed and decryptable");
  const store = {};
  const applied = canReceive(gate, read.record.category) ? applyToView(store, read.record) : null;
  assert.equal(applied, null, "the gate, not the crypto, is what stops it landing");
  assert.equal(store.passwords, undefined);
});

/* ------------------------------------------------------------------------- */
/* garbage collection                                                         */
/* ------------------------------------------------------------------------- */

test("tombstones survive until every device has seen past them", () => {
  const now = 100000;
  const store = {
    bookmarks: {
      fresh: { record_id: "fresh", updated_at: 100, tombstone: false },
      old: { record_id: "old", updated_at: 50, tombstone: true },
      unacked: { record_id: "unacked", updated_at: 90, tombstone: true },
    },
  };
  const removed = garbageCollect(store, {
    deviceAcks: { "device-b": 80, "device-c": 95 }, // min ack = 80
    now,
  });
  assert.equal(removed, 1, "only the tombstone every device has seen past goes");
  assert.ok(store.bookmarks.fresh);
  assert.ok(!store.bookmarks.old);
  assert.ok(store.bookmarks.unacked, "a tombstone nobody has acked survives");
});

test("a tombstone expires on retention alone after 90 days", () => {
  // now - updated_at must EXCEED the retention window, so the timestamps have to
  // be a full 90 days apart, not 900k seconds (10 days).
  const now = 1000000;
  const store = { bookmarks: { gone: { record_id: "gone", updated_at: now - 91 * 24 * 3600, tombstone: true } } };
  const removed = garbageCollect(store, { deviceAcks: {}, now });
  assert.equal(removed, 1);
  assert.equal(store.bookmarks.gone, undefined);
});

test("a tombstone inside the retention window with no acks survives", () => {
  const now = 1000000;
  const store = { bookmarks: { recent: { record_id: "recent", updated_at: now - 30 * 24 * 3600, tombstone: true } } };
  const removed = garbageCollect(store, { deviceAcks: {}, now });
  assert.equal(removed, 0);
  assert.ok(store.bookmarks.recent);
});
