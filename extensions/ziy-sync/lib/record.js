/**
 * Ziy SyncRecord: format, encryption, conflict resolution and category gating.
 *
 * This module is transport-agnostic. It is imported by the extension (WebCrypto
 * in a page context), by the native agent (Node webcrypto) and by the server's
 * tests. Same code, same primitives, one audit surface.
 *
 * Record shape (recon entity `SyncRecord`; architecture §4.3):
 *
 *   { "category": "bookmarks",
 *     "record_id": "3f2a…",          // uuid, stable per logical record
 *     "updated_at": 1761000000,      // unix seconds, UTC
 *     "tombstone": false,
 *     "nonce": "<base64url 12 bytes>",
 *     "payload": "<base64url AES-256-GCM ciphertext>",
 *     "signer": "<base64url 32-byte Ed25519 public key>",
 *     "sig": "<base64url 64 bytes>" }
 *
 * The AAD binds the ciphertext to everything that identifies it, so a record
 * cannot be re-filed under another id, another category, or another timestamp
 * without the key that produced it:
 *
 *   AAD = "ziy-rec/v1|" + category + "|" + record_id + "|" + updated_at
 *
 * WHAT THE SERVER CAN SEE: category (it is the storage bucket), record_id (the
 * blob key), updated_at, tombstone, nonce, payload, signer, sig, and the blob's
 * byte length. It CANNOT see the contents of the payload, the domain or title
 * behind a bookmark, which device produced a logical record beyond the public
 * key that signed it, or any key material. It cannot verify the AAD binding
 * either — it does not hold the record key.
 */

import { fromBase64Url, toBase64Url, utf8, randomBytes, toBase64, fromBase64 } from "./bip39.js";
import { sign, verifyWithRawKey, isValidCategory } from "./keyderivation.js";

export const RECORD_AAD_PREFIX = "ziy-rec/v1";

/**
 * Brave's nonce construction, adapted to AES-GCM's 12-byte IV.
 *
 * `components/brave_sync/crypto/crypto.cc:79-89` `GetNonce` builds 24 bytes:
 *   counter(2B big-endian) || random(20B) || implied zero(2B)
 * with a per-interval counter as a partial replay defence (crypto.h: "increments
 * every time interval T (TBD) to partially defend against replay attacks").
 * XSalsa20-Poly1305 in secretbox form takes a 24-byte nonce and NO additional
 * data; AES-GCM takes a 12-byte IV and DOES take AAD. So the construction is
 * kept in spirit — counter first, randomness after — and the sizes are AES-GCM's.
 *
 * The leading 2 bytes are a per-process monotonic counter, so writing the same
 * record twice in one process yields different ciphertexts even before the
 * random bytes differ; the remaining 10 bytes are CSPRNG, so the IV stays
 * unpredictable to anyone watching. 12 bytes is collision-safe at the batch
 * sizes this product allows.
 *
 * Brave cannot use AAD (secretbox takes none); AES-GCM gives it to us for free,
 * so we do: see aadFor, which binds the ciphertext to its own identity.
 */
export function recordNonce(options = {}) {
  const counter = options.counter ?? (nonceCounter = (nonceCounter + 1) & 0xffff);
  const iv = new Uint8Array(12);
  iv[0] = (counter >> 8) & 0xff;
  iv[1] = counter & 0xff;
  crypto.getRandomValues(iv.subarray(2));
  return iv;
}

/** Where the counter starts: random, so a fresh device's first nonce is not the
 *  all-zero counter slot, and a device that restarts does not resume a counter
 *  an observer may already have seen. */
let nonceCounter = (crypto.getRandomValues(new Uint32Array(1))[0] & 0xffff) || 1;

/** The AAD is canonical and typed, so its bytes are reproducible everywhere. */
export function aadFor(category, recordId, updatedAt) {
  return utf8(`${RECORD_AAD_PREFIX}|${category}|${recordId}|${updatedAt}`);
}

/**
 * Encrypt a payload into the wire form.
 *
 * @param {object}   opts
 * @param {CryptoKey} opts.privateKey   Ed25519 private key of the writing device
 * @param {string}   opts.publicKeyB64  base64url Ed25519 public key = device id
 * @param {string}   opts.category      one of CATEGORIES
 * @param {string}   opts.recordId      stable uuid for this logical record
 * @param {number}   opts.updatedAt     unix seconds (UTC), when the change happened
 * @param {*}        opts.payload       any JSON-able value
 * @param {boolean}  opts.tombstone     true for a deletion
 * @returns {Promise<object>} the record as it goes on the wire
 */
export async function createRecord({
  categoryKey,
  privateKey,
  publicKeyB64,
  category,
  recordId,
  updatedAt,
  payload,
  tombstone = false,
}) {
  if (!isValidCategory(category)) throw new Error(`unknown sync category "${category}"`);
  if (!recordId) throw new Error("record_id is required");
  if (!Number.isInteger(updatedAt)) throw new Error("updated_at must be integer unix seconds");
  if (typeof publicKeyB64 !== "string" || !/^[A-Za-z0-9_-]+$/.test(publicKeyB64)) {
    // The record's `signer` is the device id and it must be the public key that
    // actually signed. Taking it as an explicit argument keeps this module free
    // of any opinion about where a caller keeps its key pair.
    throw new Error("createRecord: publicKeyB64 (the device id) is required");
  }

  // A tombstone carries no payload; a live record always carries one.
  const plaintext = tombstone ? new Uint8Array(0) : utf8(JSON.stringify(payload ?? null));
  const nonce = recordNonce();
  const aad = aadFor(category, recordId, updatedAt);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
      categoryKey,
      plaintext,
    ),
  );

  const body = {
    category,
    record_id: recordId,
    updated_at: updatedAt,
    tombstone: tombstone,
    nonce: toBase64Url(nonce),
    payload: toBase64Url(ciphertext),
  };

  // Signature covers every identifying field, in the same canonical order the
  // server and the other devices will rebuild it from.
  const signed = signingMessage(body);
  body.signer = publicKeyB64;
  body.sig = await sign(privateKey, signed);

  return body;
}

/** Canonical signing message: every field that identifies the record. */
export function signingMessage(body) {
  return utf8(
    [
      RECORD_AAD_PREFIX,
      body.category,
      body.record_id,
      String(body.updated_at),
      body.tombstone ? "tombstone" : "live",
      body.nonce,
      body.payload,
    ].join("|"),
  );
}

/**
 * Decrypt a record received from the server, verifying its signature and its
 * AAD binding first.
 *
 * Returns {ok: true, record, value} on success. On failure returns
 * {ok: false, reason} — never throws — because a caller pulling a delta must be
 * able to skip one bad record and keep the rest.
 */
export async function readRecord({
  categoryKey,
  record,
  expectedSigner = null,
  now = null,
  maxFutureSkewSeconds = 300,
}) {
  const normalized = normalizeRecord(record);
  if (normalized.error) {
    return { ok: false, reason: normalized.error, record: null };
  }
  const body = normalized.record;

  // 1. Signature over the identifying fields, with the registered public key.
  let keyOk = false;
  try {
    keyOk = await verifyWithRawKey(body.signer, body.sig, signingMessage(body));
  } catch {
    return { ok: false, reason: "signer-key-unreadable", record: body };
  }
  if (!keyOk) return { ok: false, reason: "signature-invalid", record: body };
  if (expectedSigner && body.signer !== expectedSigner) {
    return { ok: false, reason: "signer-not-permitted", record: body };
  }

  // 2. Clock sanity: a record stamped far in the future would win every LWW
  //    comparison forever. We report it rather than silently trust it.
  if (now !== null && body.updated_at > now + maxFutureSkewSeconds) {
    return { ok: false, reason: "timestamp-in-future", record: body };
  }

  // 3. Decrypt with the AAD binding. A tampered id/category/timestamp makes the
  //    tag check fail, which is exactly the property the AAD exists for.
  let plaintext;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64Url(body.nonce),
          additionalData: aadFor(body.category, body.record_id, body.updated_at),
          tagLength: 128,
        },
        categoryKey,
        fromBase64Url(body.payload),
      ),
    );
  } catch {
    return { ok: false, reason: "decrypt-failed", record: body };
  }

  if (body.tombstone) {
    return { ok: true, record: body, value: null };
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return { ok: false, reason: "payload-not-json", record: body };
  }
  return { ok: true, record: body, value };
}

/**
 * Normalise a record as it arrives off the wire. Field shapes, not field
 * semantics: the semantic checks (signature, AAD, tombstone/payload coherence)
 * happen in readRecord.
 */
export function normalizeRecord(record) {
  if (!record || typeof record !== "object") return { error: "not-an-object" };
  const { category, record_id, updated_at, tombstone, nonce, payload, signer, sig } = record;
  if (typeof category !== "string" || !isValidCategory(category)) {
    return { error: "bad-category", category };
  }
  if (typeof record_id !== "string" || record_id.length === 0) {
    return { error: "bad-record-id" };
  }
  if (!Number.isInteger(updated_at) || updated_at < 0) {
    return { error: "bad-updated-at" };
  }
  if (typeof tombstone !== "boolean") return { error: "bad-tombstone" };
  for (const [name, value] of [["nonce", nonce], ["payload", payload], ["signer", signer], ["sig", sig]]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
      return { error: `bad-${name}` };
    }
  }
  if (fromBase64Url(nonce).length !== 12) return { error: "bad-nonce-length" };
  // AES-GCM of an empty plaintext is a 16-byte authentication tag and nothing
  // else, so "empty ciphertext" and "empty plaintext" are different lengths. A
  // tombstone is stored as that tag-only blob and must be recognised by its
  // `tombstone` flag, never by the payload being zero characters. Every record,
  // tombstone or live, therefore needs at least the tag's 16 bytes: anything
  // shorter is not a ciphertext at all.
  if (fromBase64Url(payload).length < 16) return { error: "payload-too-short" };
  return { record: { category, record_id, updated_at, tombstone, nonce, payload, signer, sig } };
}

/**
 * Last-writer-wins conflict resolution, exactly as architecture §4.3 states it:
 *
 *   "enforce that updated_at is monotonic (last-write-wins on the *encrypted*
 *    record — a clock skew only affects ordering, never content)"
 *
 * Tie-break, from the ticket: same updated_at -> the lexicographically smaller
 * device_id (signer public key) wins. Deterministic, and no device can move the
 * result by re-sending.
 */
export function resolveConflict(a, b) {
  if (a.updated_at !== b.updated_at) {
    return a.updated_at > b.updated_at ? a : b;
  }
  // Equal timestamps: lexicographic comparison of the device id. The winner is
  // the smaller string, so the rule is stable regardless of arrival order.
  return a.signer <= b.signer ? a : b;
}

/**
 * Apply one record to a local map of {category} -> {record_id} -> record.
 * `existing` is the current local view (already decrypted or not; only the
 * wire fields are compared). Returns the new stored record, or null when the
 * incoming record loses and nothing changed.
 *
 * A tombstone replaces a live record and then is eligible for garbage
 * collection once every known device has acknowledged past it (server-side, per
 * architecture §4.5) — this function only decides the local view.
 */
export function applyToView(store, incoming) {
  const bucket = (store[incoming.category] ??= Object.create(null));
  const current = bucket[incoming.record_id];
  if (current) {
    const winner = resolveConflict(current, incoming);
    if (winner === current) return null; // local copy already won
  }
  bucket[incoming.record_id] = incoming;
  return incoming;
}

/**
 * A device's per-category send/receive gate. A category that is off must
 * neither send nor receive — architecture §4.4's whole point: the toggle is
 * enforced on the device, not the server, so a toggle can never be used to
 * read another device's data, and the server's ignorance of categories is the
 * privacy claim.
 */
export function categoryGate(categories, { send = [], receive = [] } = {}) {
  const gates = Object.create(null);
  for (const category of categories) {
    gates[category] = {
      send: !send.includes(category),
      receive: !receive.includes(category),
    };
  }
  return gates;
}

/** The reconciliation of a pushed record against a category gate. */
export function canSend(gate, category) {
  const entry = gate[category];
  return Boolean(entry && entry.send);
}

export function canReceive(gate, category) {
  const entry = gate[category];
  return Boolean(entry && entry.receive);
}

/**
 * Compact a local record store: drop tombstones older than `retentionSeconds`
 * that every device is known to have seen. `deviceAcks` maps device_id ->
 * last_sync_at epoch seconds; a tombstone whose updated_at is <= the minimum
 * ack across all non-local devices has been seen everywhere and can go.
 */
export function garbageCollect(store, { deviceAcks = {}, retentionSeconds = 30 * 24 * 3600, now }) {
  const ackValues = Object.values(deviceAcks).filter((v) => Number.isFinite(v));
  const minAck = ackValues.length ? Math.min(...ackValues) : null;
  let removed = 0;
  for (const category of Object.keys(store)) {
    const bucket = store[category];
    for (const recordId of Object.keys(bucket)) {
      const record = bucket[recordId];
      if (!record.tombstone) continue;
      const seenEverywhere = minAck !== null && record.updated_at <= minAck;
      const expired = now - record.updated_at > retentionSeconds;
      if (seenEverywhere || expired) {
        delete bucket[recordId];
        removed++;
      }
    }
  }
  return removed;
}

/**
 * Serialise a local record store for the wire: base64 payload field is already
 * base64url, so the store is JSON-able as-is. Provided so callers do not
 * hand-roll it and drift.
 */
export function encodeStore(store) {
  return JSON.stringify(store);
}

export function decodeStore(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("store must be an object");
  return parsed;
}

/** Convert between base64/base64url for callers that hold raw binary forms. */
export { toBase64, fromBase64 };
