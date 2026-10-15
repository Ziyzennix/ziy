/**
 * The credential store's crypto: one passphrase -> one key, one key -> the
 * whole vault.
 *
 * WHAT IT IS FOR
 * ---------------
 * The engine exposes no password-manager write API to extensions, which is why
 * Ziy's password manager lives where the sync chain's material already lives:
 * out of the browser, in a native helper. The helper owns this file's output —
 * an encrypted vault — and the browser holds no key material at any point.
 *
 * THE DECISION, AND WHERE IT COMES FROM
 * -------------------------------------
 * replica/architecture.md §2.3 cuts the crypto wallet but records the pattern
 * it would have used, and replica/proofs-sync.md §1 pins the same rule for the
 * sync chain: "WebCrypto everywhere, no external crypto dependency — which is
 * exactly what a privacy-posture product wants (one primitive set, one audit
 * surface)."
 *
 * Following that, and following the shape of ziy-sync-agent/lib/ziy-crypto.js
 * (which the native agent and the server both import from
 * extensions/ziy-sync/lib/), the primitive choice here is:
 *
 *   KDF     PBKDF2-SHA512, 600 000 rounds, 32-byte key
 *   AEAD    AES-256-GCM with a random 12-byte IV per write
 *   MAC     GCM's own 16-byte tag, plus the record's own id as AAD
 *
 * WHY PBKDF2-SHA512 AND NOT ARGON2ID
 * ----------------------------------
 * The ticket named both. The deciding fact is measurable on this box: Argon2 is
 * NOT in node:crypto, and the decision is not to add a dependency to the
 * product's only credential store. `crypto.getHashes()` on this box's Node
 * 26 lists sha512 and does not list argon2; `scrypt` is present. So the honest
 * choice between an undocumented dependency and a documented primitive is the
 * documented primitive, at the parameter OWASP currently recommends for
 * PBKDF2-HMAC-SHA512 (600 000 iterations,
 * https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
 * which the constant below names explicitly rather than burying in a number.
 *
 * This is recorded as a divergence, not hidden: Argon2id is the stronger
 * memory-hard KDF and the right upgrade path if the product ever accepts a
 * native dependency. What ships is the strongest primitive the runtime
 * provides without one.
 *
 * WHAT IS NEVER DONE HERE
 * -----------------------
 * - The passphrase is never persisted, logged, or echoed in an error. A wrong
 *   passphrase produces "decryption failed", because a message that leaks
 *   which byte was wrong helps an attacker more than it helps a user.
 * - The vault key is never written to a file: it is derived on demand and
 *   dropped when the store locks, exactly as ziy-sync-agent's rehydrate()
 *   keeps the seed only for as long as the process needs it.
 */

import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** OWASP's current PBKDF2-HMAC-SHA512 recommendation, named not hidden. */
export const PBKDF2_ROUNDS = 600_000;
export const KEY_BYTES = 32;
export const IV_BYTES = 12;      // GCM's standard nonce size
export const TAG_BYTES = 16;     // GCM's tag
export const SALT_BYTES = 16;

/**
 * Derives the vault key from the passphrase and the salt.
 *
 * Randomness lives in the SALT, not the passphrase: a per-vault salt is what
 * makes one precomputed table useless against two users, and it is why the
 * vault file records the salt alongside the ciphertext.
 *
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @returns {Buffer} 32 bytes
 */
export function deriveVaultKey(passphrase, salt) {
  return pbkdf2Sync(
    Buffer.from(String(passphrase), "utf8"),
    Buffer.from(salt),
    PBKDF2_ROUNDS,
    KEY_BYTES,
    "sha512",
  );
}

/**
 * Encrypts one value under the vault key.
 *
 * @param {Buffer} key   the derived vault key
 * @param {Buffer} plaintext
 * @param {Buffer} [aad] additional authenticated data (the record's own id)
 * @returns {{iv: string, tag: string, ciphertext: string}} base64, each field
 */
export function encryptJson(key, plaintext, aad) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  if (aad && aad.length) cipher.setAAD(aad, { plaintextLength: plaintext.length });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: Buffer.concat([body]).toString("base64"),
  };
}

/**
 * Decrypts one value. A wrong passphrase, a tampered ciphertext, or a record
 * whose AAD no longer matches all surface as the same thrown Error: the store
 * is unusable, and nothing about which field failed is revealed.
 *
 * @param {Buffer} key
 * @param {{iv: string, tag: string, ciphertext: string}} envelope
 * @param {Buffer} [aad]
 * @returns {Buffer} the plaintext
 */
export function decryptJson(key, envelope, aad) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"), {
      authTagLength: TAG_BYTES,
    });
    if (aad && aad.length) decipher.setAAD(aad, { plaintextLength: envelope.ciphertext.length });
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
  } catch {
    throw new Error("vault decryption failed");
  }
}

/** A fresh random salt for a new vault. */
export function newSalt() {
  return randomBytes(SALT_BYTES);
}
