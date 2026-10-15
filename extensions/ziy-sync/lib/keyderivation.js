/**
 * Ziy key derivation and device identity.
 *
 * THE HIERARCHY (revised 2026-10-14 against the real Brave Sync source; see
 * replica/re-deep-sync.md §1/§7).
 *
 *   BIP39 mnemonic (24 words, 256-bit entropy)      <- the code, validated by checksum
 *     -> ikm = the 32 raw bytes behind those words  <- NO PBKDF2, NO "seed"
 *     -> master = HKDF-SHA512(ikm, salt=<chain-id>, info="ziy-sync/v1", 32)
 *     -> category key = HKDF-SHA512(master, salt="cat:"+name, info="ziy-sync/v1", 32)
 *     -> record key   = HKDF-SHA512(category key, salt=record-id, info="rec/v1", 32)
 *     -> nonce        = counter(2B BE) || random(20B) || zero(2B), 24 bytes total
 *
 * Two deliberate divergences from Brave, both recorded because they are
 * divergences and not matches:
 *
 *   1. WE keep a per-chain salt (the random 128-bit chain id) where Brave uses a
 *      hard-coded 64-byte constant and identifies the chain by the device pubkey.
 *      Ours is strictly better: one leaked code cannot be replayed to produce a
 *      second chain with the same keys. The cost is that the chain id must be
 *      carried, which is why the chain code is "24 words + chain id".
 *
 *   2. WE encrypt record payloads ourselves with per-category AES-256-GCM keys,
 *      including the plaintext entity NAME. Brave reuses Chromium's Nigori, whose
 *      blobs cover the record's contents but NOT the entity's Name -- the server
 *      sees bookmark titles and folder names in the clear (re-deep-sync.md §3).
 *      Our promise is content blindness, so the name goes inside our ciphertext.
 *
 * HKDF is RFC 5869: an extract-then-expand construction over HMAC. WebCrypto
 * implements it as `HKDF` on importKey/deriveBits/deriveKey — MDN documents the
 * algorithm identifier as exactly that name with a SHA-* hash, and
 * replica/proofs.md fact 10 probed `HKDF OK 32 bytes` on this box's Node.
 *
 * The rotating 25th word is mixed into `info` per architecture.md §4.1:
 *   info = "ziy-sync/v1|rot=" + word
 * That is the whole mechanism — both devices must know today's bucket to derive
 * the same master key, so a leaked 24-word code alone is inert.
 *
 * Device identity is Ed25519 (RFC 8032). WebCrypto supports `Ed25519` as a
 * generateKey/sign/verify algorithm name — MDN's SubtleCrypto pages document it
 * and this box probed it live (see test/crypto-keyderivation.test.mjs, and the
 * smoke test recorded in replica/proofs-sync.md). The public key IS the device
 * id in the chain; the server registers it at chain creation and verifies
 * signatures with it. It CANNOT decrypt payloads, because the payload key never
 * exists on the server.
 */

import { toBase64Url, fromBase64Url, randomBytes, utf8 } from "./bip39.js";

const HKDF_HASH = "SHA-512";        // Brave uses HKDF-SHA512 and only that
                                    // (components/brave_sync/crypto/crypto.cc:31-43:
                                    // BoringSSL HKDF with EVP_sha512). We match.
const KEY_BYTES = 32;               // an AES-256 key, an Ed25519 seed, and
                                    // HKDF-SHA512's output truncated to 32
const INFO = "ziy-sync/v1";

/**
 * HKDF extract+expand, returning raw key bytes. RFC 5869 §2.3 with the given
 * salt, info and output length. The hash is SHA-512, matching Brave's only KDF
 * (components/brave_sync/crypto/crypto.cc:31-43 uses EVP_sha512).
 *
 * The exported name is `hkdfSha512`; `hkdfSha256` remains as an alias so the
 * rest of the tree and the tests keep calling one identifier, but it IS SHA-512
 * now. Anything that genuinely needs SHA-256 (the RFC test vector) uses
 * `hkdfWith` explicitly, so the two can never be silently conflated.
 */
export async function hkdfSha512(ikm, salt, info, lengthBytes = KEY_BYTES) {
  return hkdfWith(ikm, salt, info, lengthBytes, HKDF_HASH);
}

export const hkdfSha256 = hkdfSha512;

/** The general form; only the RFC 5869 vector test uses a non-default hash. */
export async function hkdfWith(ikm, salt, info, lengthBytes, hash = HKDF_HASH) {
  const saltBytes = salt.length ? salt : new Uint8Array(KEY_BYTES); // HKDF zero salt
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const infoBytes = typeof info === "string" ? utf8(info) : info;
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash, salt: saltBytes, info: infoBytes },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/** The chain id binds every derived key to one chain. 128 random bits. */
export function generateChainId() {
  return toBase64Url(randomBytes(16));
}

/**
 * The derivation info string. Deliberately NOT parameterised by the rotating
 * word: Brave's mechanism gates joining and then discards the word, and every
 * device must derive the same keys on every day. An earlier version of this
 * module mixed the word in, which silently made records undecryptable once the
 * day turned over -- recorded in replica/proofs-sync.md as the deviation that
 * was reverted.
 */
function infoWithRotatingWord(depth, rotatingWord) {
  return INFO;
}

/**
 * The full key set for one chain. Everything is derived on demand and nothing
 * but the record ciphertext is ever persisted; the seed lives in the native
 * agent's SQLite (schema.sql's `records`/`chain` tables are its home) or, in
 * the extension, is ephemeral for the length of a session.
 */
export class ChainKeys {
  /**
   * @param {Uint8Array} ikm          32 bytes of raw entropy -- the 24 words
   *                                  reversed back to bytes, NOT a PBKDF2 seed
   * @param {string} chainId          base64url 16-byte chain id (the HKDF salt)
   * @param {string} rotatingWord     kept for the audit trail; derives nothing
   */
  constructor(ikm, chainId, rotatingWord) {
    this.ikm = ikm;
    this.seed = ikm;                  // legacy name, kept so callers that
                                      // passed a BIP-39 seed may pass the same
                                      // 32-byte value they already hold
    this.chainId = chainId;
    this.rotatingWord = rotatingWord;
    this._master = null;
    this._category = new Map();
  }

  async master() {
    if (!this._master) {
      this._master = await hkdfSha256(
        this.ikm,
        fromBase64Url(this.chainId),
        infoWithRotatingWord(0, this.rotatingWord),
      );
    }
    return this._master;
  }

  /** AES-256-GCM key for one category (bookmarks, settings, history, ...). */
  async categoryKey(category) {
    const cached = this._category.get(category);
    if (cached) return cached;
    const master = await this.master();
    const bytes = await hkdfSha256(
      master,
      utf8("cat:" + category),
      infoWithRotatingWord(1, this.rotatingWord),
    );
    const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    this._category.set(category, key);
    return key;
  }
}

/** Any of the entities recon lists as syncable. One word, lowercase. */
export const CATEGORIES = Object.freeze([
  "bookmarks",
  "passwords",
  "autofill",
  "history",
  "tabs",
  "extensions",
  "themes",
  "apps",
  // The recon's `SyncableSetting` entity (profile_id, key, value, synced) is the
  // syncable key-value set — architecture §3.2 puts it under the settings.* bus.
  // It is a category here so it gets its own HKDF key and its own toggle.
  "settings",
]);

export function isValidCategory(name) {
  return CATEGORIES.includes(name);
}

/**
 * Ed25519 device identity.
 *
 * `generateKey({name:'Ed25519'})` is WebCrypto, and MDN documents the Ed25519
 * sign/verify algorithms with that exact identifier. On this engine it works
 * (smoke test: generate + sign 64-byte signature + verify -> true, recorded in
 * replica/proofs-sync.md). The raw public key is 32 bytes and is exported with
 * exportKey("raw", ...) so it can be passed to the server as the device id.
 */
export async function generateDeviceIdentity() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  return pair;
}

export async function exportPublicKey(publicKey) {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));
}

export async function exportPrivateKey(privateKey) {
  // PKCS#8: the only format WebCrypto exports Ed25519 private keys in.
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey)));
}

export async function importPrivateKey(pkcs8Base64Url) {
  return crypto.subtle.importKey(
    "pkcs8",
    fromBase64Url(pkcs8Base64Url),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

export async function importPublicKey(rawBase64Url) {
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(rawBase64Url),
    { name: "Ed25519" },
    false, // not extractable: the server must never be handed a copy it can re-export
    ["verify"],
  );
}

/**
 * Sign with Ed25519. WebCrypto's Ed25519 signs the exact message with no
 * pre-hashing (RFC 8032 PureEdDSA), so the message is passed straight through.
 */
export async function sign(privateKey, message) {
  const messageBytes = typeof message === "string" ? utf8(message) : message;
  return toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, messageBytes)));
}

export async function verify(publicKey, signatureBase64Url, message) {
  const messageBytes = typeof message === "string" ? utf8(message) : message;
  return crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    fromBase64Url(signatureBase64Url),
    messageBytes,
  );
}

/** Verify against an imported-from-base64url public key. */
export async function verifyWithRawKey(publicKeyBase64Url, signatureBase64Url, message) {
  const key = await importPublicKey(publicKeyBase64Url);
  return verify(key, signatureBase64Url, message);
}

/** The canonical device-id string: the base64url Ed25519 public key. */
export async function deviceIdOf(identity) {
  return exportPublicKey(identity.publicKey);
}
