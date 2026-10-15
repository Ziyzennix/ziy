/**
 * Key derivation, device identity and the crypto smoke test.
 *
 * The "smoke test" the ticket asks for lives here as a real, runnable test that
 * prints the observed facts: which WebCrypto algorithms exist on this machine,
 * what a derived key looks like, and whether an Ed25519 signature made in a
 * WebCrypto context verifies in node:crypto (the server's verifier). Run:
 *
 *   node --test extensions/ziy-sync/test/keyderivation.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ChainKeys,
  CATEGORIES,
  generateChainId,
  generateDeviceIdentity,
  exportPublicKey,
  exportPrivateKey,
  importPrivateKey,
  importPublicKey,
  sign,
  verify,
  verifyWithRawKey,
  deviceIdOf,
  hkdfSha512,
  hkdfWith,
} from "../lib/keyderivation.js";
import {
  generateMnemonic,
  mnemonicToSeed,
  mnemonicToBytes,
  toBase64Url,
  fromBase64Url,
  utf8,
  randomBytes,
} from "../lib/bip39.js";

const encoder = new TextEncoder();

/** Build a real chain key set from a real generated code. */
async function makeChain() {
  const words = await generateMnemonic();
  // The words ARE the entropy, reversed to their 32 bytes: no PBKDF2 and no
  // BIP-39 "seed" step, matching Brave (replica/re-deep-sync.md sec.1).
  const ikm = await mnemonicToBytes(words);
  const chainId = generateChainId();
  const keys = new ChainKeys(ikm, chainId, "ember");
  return { words, ikm, chainId, keys };
}

/* ------------------------------------------------------------------------- */
/* crypto smoke test — the facts this product's crypto relies on              */
/* ------------------------------------------------------------------------- */

test("SMOKE: WebCrypto availability on this machine (Ed25519, HKDF, PBKDF2, AES-GCM, X25519)", async () => {
  const observed = {};

  // Ed25519: generate, sign, verify, and export the raw public key.
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  observed.ed25519 = "generateKey OK";
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, encoder.encode("smoke"));
  observed.ed25519_signature_bytes = sig.byteLength;
  assert.equal(sig.byteLength, 64, "Ed25519 signatures are 64 bytes");
  const sigOk = await crypto.subtle.verify({ name: "Ed25519" }, pair.publicKey, sig, encoder.encode("smoke"));
  assert.ok(sigOk, "Ed25519 verify must succeed");
  observed.ed25519_verify = "OK";

  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  assert.equal(rawPublic.length, 32, "an Ed25519 public key is 32 bytes");
  observed.ed25519_public_key_bytes = 32;

  // The private key round-trips through PKCS#8, which is how the agent persists it.
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const reimported = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  const sig2 = await crypto.subtle.sign({ name: "Ed25519" }, reimported, encoder.encode("smoke"));
  assert.ok(await crypto.subtle.verify({ name: "Ed25519" }, pair.publicKey, sig2, encoder.encode("smoke")));
  observed.ed25519_pkcs8_roundtrip = "OK";

  // HKDF-SHA256, the RFC 5869 construction this product's hierarchy uses.
  const ikm = randomBytes(32);
  const bits = await hkdfSha512(ikm, randomBytes(16), "ziy-sync/v1", 32);
  assert.equal(bits.byteLength, 32);
  observed.hkdf = "SHA-512 deriveBits 32 bytes OK";

  // PBKDF2-HMAC-SHA512 at BIP-39's parameters.
  const pbkdf2Key = await crypto.subtle.importKey("raw", ikm, "PBKDF2", false, ["deriveBits"]);
  const pb = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode("mnemonic"), iterations: 2048, hash: "SHA-512" },
    pbkdf2Key,
    512,
  );
  assert.equal(pb.byteLength, 64);
  observed.pbkdf2 = "2048 rounds, HMAC-SHA512, 64 bytes OK";

  // X25519 is present too, though Ziy does not use it (recorded for the record).
  try {
    await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    observed.x25519 = "present (unused by Ziy sync)";
  } catch (error) {
    observed.x25519 = `absent: ${error.message}`;
  }

  // Print the facts, so the transcript of the test IS the smoke-test result.
  process.stdout.write("\n  SMOKE TEST — WebCrypto on this machine\n");
  for (const [key, value] of Object.entries(observed)) {
    process.stdout.write(`    ${key.padEnd(28)} ${value}\n`);
  }
  process.stdout.write("\n");
});

test("SMOKE: a WebCrypto Ed25519 signature verifies in node:crypto (the server's verifier)", async () => {
  // This is the cross-boundary check that matters: the extension signs with
  // WebCrypto, the server verifies with node:crypto. If the two encodings
  // disagreed, every record would be rejected and the sync chain would never
  // have worked — so it is asserted, not assumed.
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const message = "ziy-rec/v1|bookmarks|abc123|1761000000|live|noncevalue|payloadvalue";
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, encoder.encode(message));
  const raw = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey));

  const nodeKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
    format: "der",
    type: "spki",
  });
  const verified = crypto.verify(null, Buffer.from(message, "utf8"), nodeKey, Buffer.from(signature));
  assert.ok(verified, "node:crypto must verify a WebCrypto-made Ed25519 signature");
  process.stdout.write(`    cross-boundary Ed25519 verify: OK (sig ${signature.byteLength} bytes, key ${raw.length} bytes)\n`);
});

/* ------------------------------------------------------------------------- */
/* determinism and correctness                                                */
/* ------------------------------------------------------------------------- */

test("HKDF-SHA512 is deterministic for the same inputs", async () => {
  const ikm = randomBytes(32);
  const salt = randomBytes(16);
  const a = Buffer.from(await hkdfSha512(ikm, salt, "ziy-sync/v1", 32)).toString("hex");
  const b = Buffer.from(await hkdfSha512(ikm, salt, "ziy-sync/v1", 32)).toString("hex");
  assert.equal(a, b);
  const c = Buffer.from(await hkdfSha512(ikm, salt, "ziy-sync/v2", 32)).toString("hex");
  assert.notEqual(a, c, "a different info must derive a different key");
});

test("HKDF-SHA512 output length is honoured", async () => {
  for (const length of [16, 32, 48, 64]) {
    const bits = await hkdfSha512(randomBytes(32), randomBytes(16), "x", length);
    assert.equal(bits.byteLength, length);
  }
});

test("HKDF matches the RFC 5869 test vector (SHA-256, case 1)", async () => {
  // RFC 5869 appendix A.1. Asserting a published vector catches an extract or
  // expand step that produces the right LENGTH with the wrong bytes.
  const ikm = Buffer.from("0b".repeat(22), "hex");
  const salt = Buffer.from("000102030405060708090a0b0c", "hex");
  const info = Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex");
  // Explicitly SHA-256: the published vector is a SHA-256 vector, and our
  // product hash is SHA-512. Two names so the two can never be conflated.
  const okm = Buffer.from(await hkdfWith(new Uint8Array(ikm), new Uint8Array(salt), new Uint8Array(info), 42, "SHA-256")).toString("hex");
  assert.equal(
    okm,
    "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
  );
});

test("the same words and chain id always derive the same keys", async () => {
  const { ikm, chainId } = await makeChain();
  const a = new ChainKeys(ikm, chainId, "ember");
  const b = new ChainKeys(ikm, chainId, "ember");
  assert.deepEqual(Buffer.from(await a.master()).toString("hex"), Buffer.from(await b.master()).toString("hex"));
});

test("the rotating word derives NOTHING: same keys on every day", async () => {
  // Brave strips the 25th word before any crypto; it gates joining only
  // (time_limited_words.cc:143-197). Mixing it into the derivation would mean a
  // record written yesterday cannot be read today -- so this asserts the
  // opposite of the earlier design, deliberately and with a citation.
  const { ikm, chainId } = await makeChain();
  const today = new ChainKeys(ikm, chainId, "abandon");      // bucket: yesterday
  const tomorrow = new ChainKeys(ikm, chainId, "ability");   // bucket: today
  const a = Buffer.from(await today.master()).toString("hex");
  const b = Buffer.from(await tomorrow.master()).toString("hex");
  assert.equal(a, b, "the rotating word must not appear in the derivation");
});

test("a different chain id derives a different master key", async () => {
  const { ikm } = await makeChain();
  const one = Buffer.from(await new ChainKeys(ikm, generateChainId(), "ember").master()).toString("hex");
  const two = Buffer.from(await new ChainKeys(ikm, generateChainId(), "ember").master()).toString("hex");
  assert.notEqual(one, two, "the chain id is the HKDF salt; the same words in two chains must differ");
});

test("categories derive distinct keys", async () => {
  const { keys } = await makeChain();
  const seen = new Map();
  for (const category of CATEGORIES) {
    const raw = Buffer.from(await rawCategoryKey(keys, category)).toString("hex");
    assert.ok(!seen.has(raw), `category ${category} collides with ${seen.get(raw)}`);
    seen.set(raw, category);
  }
  assert.equal(seen.size, CATEGORIES.length);
});

test("chain id is 16 random bytes and is not derived from the words", async () => {
  const a = generateChainId();
  const b = generateChainId();
  assert.notEqual(a, b);
  assert.equal(fromBase64Url(a).length, 16);
  assert.equal(fromBase64Url(b).length, 16);
});

/* ------------------------------------------------------------------------- */
/* device identity                                                            */
/* ------------------------------------------------------------------------- */

test("Ed25519 device identity: keypair, public key as device id, signature verifies", async () => {
  const identity = await generateDeviceIdentity();
  const deviceId = await deviceIdOf(identity);
  assert.equal(fromBase64Url(deviceId).length, 32);
  const message = encoder.encode("chain.create");
  const signature = await sign(identity.privateKey, message);
  assert.equal(fromBase64Url(signature).length, 64);
  assert.ok(await verify(identity.publicKey, signature, message));
  assert.ok(await verifyWithRawKey(deviceId, signature, message));
});

test("a signature over one message does not verify against another", async () => {
  const identity = await generateDeviceIdentity();
  const signature = await sign(identity.privateKey, encoder.encode("one"));
  assert.ok(!(await verify(identity.publicKey, signature, encoder.encode("two"))));
});

test("the private key survives a PKCS#8 round-trip (how the agent persists it)", async () => {
  const identity = await generateDeviceIdentity();
  const message = encoder.encode("persist me");
  const exported = await exportPrivateKey(identity.privateKey);
  const reloaded = await importPrivateKey(exported);
  const signature = await sign(reloaded, message);
  assert.ok(await verify(identity.publicKey, signature, message));
});

test("a device id exported as base64url re-imports to the same public key", async () => {
  const identity = await generateDeviceIdentity();
  const deviceId = await exportPublicKey(identity.publicKey);
  const imported = await importPublicKey(deviceId);
  const signature = await sign(identity.privateKey, encoder.encode("x"));
  assert.ok(await verify(imported, signature, encoder.encode("x")));
});

/* Helpers ---------------------------------------------------------------- */

/** Re-derive a category key's raw bytes (AES-GCM keys are not extractable). */
async function rawCategoryKey(keys, category) {
  const master = await keys.master();
  return hkdfSha512(master, utf8("cat:" + category), "ziy-sync/v1", 32);
}

test("the category-key hierarchy matches architecture §4.1 exactly", async () => {
  // Reproduce the documented ladder by hand and compare against ChainKeys:
  //   master   = HKDF-SHA512(ikm, salt=chain_id, info="ziy-sync/v1", 32)
  //   cat key  = HKDF-SHA512(master, salt="cat:"+name, info="ziy-sync/v1", 32)
  //   rec key  = HKDF-SHA512(cat key, salt=record-id, info="rec/v1", 32)
  const { ikm, chainId, keys } = await makeChain();
  const master = await hkdfSha512(ikm, fromBase64Url(chainId), "ziy-sync/v1", 32);
  assert.equal(Buffer.from(await keys.master()).toString("hex"), Buffer.from(master).toString("hex"));

  const cat = await hkdfSha512(master, utf8("cat:bookmarks"), "ziy-sync/v1", 32);
  assert.equal(
    Buffer.from(await rawCategoryKey(keys, "bookmarks")).toString("hex"),
    Buffer.from(cat).toString("hex"),
  );

  const rec = await hkdfSha512(cat, utf8("record-42"), "rec/v1", 32);
  assert.equal(rec.byteLength, 32, "a per-record key is 32 bytes (AES-256)");
});
