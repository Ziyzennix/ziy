/**
 * BIP-39 mnemonic + Ziy seed derivation.
 *
 * Runs identically in the extension (WebCrypto in a normal page context) and in
 * the native agent / server (Node's webcrypto). No npm dependency: PBKDF2 and
 * SHA-256 come from crypto.subtle, which is present in both places
 * (replica/proofs.md fact 10 probed exactly these three on Node 26).
 *
 * BIP-39 spec text we follow (fetched, quoted from
 * https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki):
 *
 *   "First, an initial entropy of ENT bits is generated. A checksum is generated
 *    by taking the first ENT / 32 bits of its SHA256 hash. This checksum is
 *    appended to the end of the initial entropy. Next, these concatenated bits
 *    are split into groups of 11 bits, each encoding a number from 0-2047,
 *    serving as an index into a wordlist."
 *
 *   "To create a binary seed from the mnemonic, we use the PBKDF2 function with
 *    a mnemonic sentence (in UTF-8 NFKD) used as the password and the string
 *    "mnemonic" + passphrase (again in UTF-8 NFKD) used as the salt. The
 *    iteration count is set to 2048 and HMAC-SHA512 is used as the pseudo-random
 *    function. The length of the derived key is 512 bits (= 64 bytes)."
 *
 * Ziy uses the 24-word (ENT=256) row of that table: CS=8, ENT+CS=264, MS=24.
 *
 * WHAT THE SERVER CAN SEE: nothing. The seed never leaves the device. The
 * word code is the user's secret; the chain id (which is what the server sees)
 * is not.
 */

import WORDLIST from "./bip39-wordlist.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PBKDF2_ITERATIONS = 2048;      // BIP-39: "iteration count is set to 2048"
const SEED_BITS = 512;               // BIP-39: "512 bits (= 64 bytes)"
const WORD_COUNT = 24;               // ENT = 256 bits
const ENTROPY_BITS = 256;            // Ziy's chain code is always 24 words

const wordIndex = new Map(WORDLIST.map((w, i) => [w, i]));

/** SHA-256 over arbitrary bytes. */
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** BIP-39 PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic"+passphrase. */
export async function mnemonicToSeed(mnemonic, passphrase = "") {
  // BIP-39 requires UTF-8 NFKD on both the password (the sentence) and the salt.
  // "mnemonic" + passphrase: an absent passphrase is an empty string, so the
  // salt is the literal "mnemonic" — which is what Ziy uses (no passphrase).
  const password = encoder.encode(mnemonic.normalize("NFKD"));
  const salt = encoder.encode(("mnemonic" + passphrase).normalize("NFKD"));
  const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-512" },
    key,
    SEED_BITS,
  );
  return new Uint8Array(bits);
}

/** 256 bits from the platform CSPRNG. Never Math.random. */
function randomEntropy(bits = ENTROPY_BITS) {
  const out = new Uint8Array(bits / 8);
  crypto.getRandomValues(out);
  return out;
}

/** BIP-39: append the first ENT/32 bits of SHA256(entropy) and split into 11-bit groups. */
export async function entropyToMnemonic(entropy) {
  if (entropy.length * 8 !== ENTROPY_BITS) {
    throw new Error(`entropy must be ${ENTROPY_BITS} bits, got ${entropy.length * 8}`);
  }
  const checksum = await sha256(entropy);
  // 2048-round-less: the checksum bits are the leading ENT/32 = 8 bits of the hash.
  const bits = leadingBits(entropy, ENTROPY_BITS);
  const csLen = ENTROPY_BITS / 32;
  const cb = leadingBits(checksum, csLen);
  const concat = new Uint8Array(bits.length + cb.length);
  concat.set(bits);
  concat.set(cb, bits.length);
  const words = [];
  for (let i = 0; i < 24; i++) {
    let value = 0;
    for (let j = 0; j < 11; j++) {
      const bit = concat[i * 11 + j];
      value = (value << 1) | bit;
    }
    words.push(WORDLIST[value]);
  }
  return words;
}

/**
 * Read the first `count` bits of a byte stream, big-endian bit order.
 * BIP-39 uses this for entropy and for the checksum, which takes
 * "the first ENT / 32 bits of its SHA256 hash" — the FIRST bits.
 */
function leadingBits(bytes, count) {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return out;
}

/**
 * Read the LOW `count` bits of a byte stream as one integer, big-endian.
 * BIP-39 uses this to turn a word's 0-2047 index into 11 bits. The index is a
 * value, not a bit-slice: 102 in 11 bits is 00001100110, and it must NOT be
 * read as the leading 11 bits of its 16-byte...its 2-byte form, which is
 * 00000000011 and would decode as 3. This distinction is the single most
 * common BIP-39 bug, so it is spelled out here.
 */
function lowBits(bytes, count) {
  const out = new Uint8Array(count);
  const totalBits = bytes.length * 8;
  const offset = Math.max(0, totalBits - count);
  for (let i = 0; i < count; i++) {
    const bit = offset + i;
    out[i] = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
  }
  return out;
}

function bytesFromBits(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    const byte = i >> 3;
    out[byte] |= (bits[i] & 1) << (7 - (i & 7));
  }
  return out;
}

/** Generate a fresh 24-word Ziy chain code. */
export async function generateMnemonic() {
  return entropyToMnemonic(randomEntropy(ENTROPY_BITS));
}

/**
 * The 24 words' raw 32 bytes: the IKM for HKDF.
 *
 * Brave treats the words AS the entropy and passes the bytes straight to HKDF
 * with no PBKDF2 and no BIP-39 seed step
 * (components/brave_sync/crypto/crypto.cc:145-155, `PassphraseToBytes32`).
 * We match: this is the inverse of `entropyToMnemonic`, so the same bytes come
 * back out that went in.
 *
 * The BIP-39 spec still applies in full to the WORDS -- the checksum is what
 * makes a typo catchable -- it simply is not a KDF input. PBKDF2 exists to
 * slow down a low-entropy password being brute-forced; a 256-bit mnemonic is
 * not one, so 2048 rounds of SHA-512 buys nothing but latency.
 */
export async function mnemonicToBytes(words) {
  const bits = [];
  for (const word of words) {
    const index = wordIndex.get(word);
    if (index === undefined) {
      throw new Error(`"${word}" is not in the BIP-39 word list. Check the spelling.`);
    }
    bits.push(...lowBits(new Uint8Array([index >> 8, index & 0xff]), 11));
  }
  // A plain Uint8Array, never a Node Buffer: crypto.subtle.importKey rejects
  // Buffer even though Buffer is a Uint8Array subclass, and this value is the
  // direct IKM for HKDF.
  const bytes = bytesFromBits(bits.slice(0, ENTROPY_BITS));
  return bytes instanceof Uint8Array && bytes.constructor === Uint8Array
    ? bytes
    : Uint8Array.from(bytes);
}

/**
 * Validate a mnemonic: word count, every word in the wordlist, and the BIP-39
 * checksum. Returns the words array on success, throws on failure — the error
 * message is Ziy-voiced because the UI shows it verbatim.
 */
export async function validateMnemonic(input) {
  const words = String(input ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length !== WORD_COUNT) {
    throw new Error(`A Ziy chain code is ${WORD_COUNT} words. You entered ${words.length}.`);
  }

  let bits = [];
  for (const word of words) {
    const index = wordIndex.get(word);
    if (index === undefined) {
      throw new Error(`"${word}" is not in the BIP-39 word list. Check the spelling.`);
    }
    const group = lowBits(new Uint8Array([index >> 8, index & 0xff]), 11);
    bits.push(...group);
  }

  const entBits = bits.slice(0, ENTROPY_BITS);
  const csBits = bits.slice(ENTROPY_BITS);
  const entropy = bytesFromBits(entBits);

  const expected = leadingBits(await sha256(entropy), ENTROPY_BITS / 32);
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== csBits[i]) {
      throw new Error("That chain code does not match its checksum. Re-enter the words in order.");
    }
  }
  return words;
}

/**
 * The 25th "rotating word". Brave's hardening: the word list a device may join
 * with is time-bucketed, so a leaked 24-word code stops working. Ziy's copy
 * fetches the bucket's word over HTTPS from a Ziy-published URL and falls back
 * to a locally configured word if the network is unavailable — the honest
 * fallback is stated in the UI, never silently applied.
 *
 * The bucket is a UTC day. Both devices must agree on it, so the bucket is
 * derived from the device's clock, and the extension displays which bucket it
 * is using before the user shares a code.
 */
export const ROTATING_WORD_CONFIG = {
  // Ziy publishes this file: one JSON object per UTC day, {"day":"YYYY-MM-DD",
  // "words":[...]}. Configurable in the options page; the default is ours.
  defaultSourceUrl: "https://wordlist.ziy.app/rotating-word.json",
  // Offline fallback: operator-set, shipped in the build config. A join that
  // needed the network and could not reach it says so instead of pretending.
  //
  // The environment variable is the documented way to set one for a device that
  // must work without the network (a developer's box, a CI run, or the e2e
  // proof). When it is absent the fallback is null, the fetch is attempted, and
  // a failure is reported honestly rather than papered over.
  fallbackWord:
    (typeof process !== "undefined" && process.env && process.env.ZIY_SYNC_ROTATING_WORD) || null,
  // UTC day index. One bucket per day; Ziy publishes the next day's word in
  // advance so a device about to cross midnight still agrees.
  bucketKind: "utc-day",
};

export function rotatingWordBucket(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Fetch the rotating word for a bucket. Returns {word, bucket, source, offline}. */
export async function fetchRotatingWord(sourceUrl = ROTATING_WORD_CONFIG.defaultSourceUrl) {
  const bucket = rotatingWordBucket();
  try {
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`rotating-word source answered HTTP ${response.status}`);
    }
    const text = await response.text();
    // One JSON per line ("bucket":"2026-10-14","word":"ember"). We accept both
    // a JSON object and that line form so the published file can be either.
    let word = null;
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      word = typeof parsed === "string" ? parsed : parsed.word;
      if (parsed.bucket && parsed.bucket !== bucket) {
        throw new Error(`bucket mismatch: source says ${parsed.bucket}, this device is on ${bucket}`);
      }
    } else if (/^[a-z]+$/.test(trimmed)) {
      word = trimmed;
    }
    if (!word) throw new Error("rotating-word source returned no word");
    return { word, bucket, source: "network", offline: false };
  } catch (error) {
    if (ROTATING_WORD_CONFIG.fallbackWord) {
      return {
        word: ROTATING_WORD_CONFIG.fallbackWord,
        bucket,
        source: "offline-fallback",
        offline: true,
        error: error.message,
      };
    }
    // No fallback configured: the caller must tell the user, honestly, that the
    // rotating word could not be fetched and a code cannot be made right now.
    throw new Error(
      `Ziy could not fetch today's rotating word (${error.message}). The rotating word is what ` +
        `stops a leaked 24-word code from being useful, so Ziy will not continue without it.`,
    );
  }
}

/**
 * Decode helpers shared by the record layer. base64url without padding, so
 * every encoded value is JSON-safe and URL-safe at once.
 */
export function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(length) {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function utf8(text) {
  return encoder.encode(text);
}

export function fromUtf8(bytes) {
  return decoder.decode(bytes);
}
