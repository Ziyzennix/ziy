/* Ziy Talk — the room id generator and validator.
 *
 * The observed shape (replica/re-deep-core.md §6, from
 * `browser/ui/sidebar/sidebar_unittest.cc`: `GURL talk("https://talk.brave.com/1Ar1vHfLBWX2sAdi")`)
 * is a 15-character base62 room id appended to the host.
 *
 * The generator is ours, not Brave's. Brave's is server-side and closed
 * (`[UNVERIFIED]` in the recon). This one answers the same shape questions:
 *
 *   - how much entropy?   15 chars over a 62-char alphabet is 15 * log2(62)
 *                        = 89.3 bits, comfortably past the ~80-bit bar for an
 *                        unguessable reference, and the same class as Brave's
 *                        observed ids.
 *   - is it uniform?      yes: each character is drawn independently from the
 *                        full 62-symbol alphabet with rejection sampling, so no
 *                        bias towards or away from any symbol. The naive
 *                        `randomInt % 62` would be biased by up to 2^256 % 62,
 *                        which at 256 bits of input is a measurable skew, so we
 *                        reject instead.
 *   - can it be guessed from a previous id?  no: there is no counter, no clock
 *                        and no seed derived from anything persisted.
 *
 * No DOM, no `browser.*` access, no I/O: this module is pure so the same code
 * runs in the extension pages, in the background event page, and under
 * `node --test`. It is written UMD-style (a plain script that also exports
 * through `module`), which is why a page can load it with a <script> tag and
 * the tests can `require()` it.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZiyTalkRoom = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * The alphabet and the length, chosen and fixed here.
   * ------------------------------------------------------------------ */

  /* base62: A-Za-z0-9, the same character class Brave's observed ids use.
     No ambiguous-looking exclusions: the id is copied, not typed, and the
     recon's observed ids ('1Ar1vHfLBWX2sAdi') contain both 0/O and 1/l
     lookalikes across samples, so removing them would not match the shape. */
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const ALPHABET_SET = new Set(ALPHABET.split(""));

  const ROOM_ID_LENGTH = 15;

  /* Rejection-sampling bound: the largest multiple of 62 that fits in 256
     bits' worth of a single byte-free draw. We draw 8 bytes (64 bits) at a
     time, so the bound must divide `2^64` evenly. 62 does not, so we take the
     largest multiple below 2^64 and reject the remainder. */
  const CHUNK_BITS = 64;
  const CHUNK_BYTES = 8;
  const CHUNK_SPACE = 2n ** BigInt(CHUNK_BITS);
  const ALPHABET_SIZE = BigInt(ALPHABET.length);
  const ACCEPT_LIMIT = CHUNK_SPACE - (CHUNK_SPACE % ALPHABET_SIZE);

  /* Entropy accounting, stated so the tests can pin it: 15 draws of a uniform
     62-symbol alphabet = 15 * log2(62) = 89.31... bits. */
  const ENTROPY_BITS = ROOM_ID_LENGTH * Math.log2(ALPHABET.length);

  /* ------------------------------------------------------------------ *
   * Randomness source.
   *
   * `crypto.getRandomValues` in the extension and in the browser; a
   * `node:crypto` randomBytes substitute under node:test. There is no third
   * fallback and there must never be one: a Math.random() fallback would make
   * rooms predictable while still producing well-shaped ids, which is the
   * worst possible failure mode.
   * ------------------------------------------------------------------ */

  function getRandomValues(buffer) {
    const target = typeof globalThis !== "undefined" ? globalThis : root;
    const webcrypto = target.crypto || {};
    if (typeof webcrypto.getRandomValues === "function") {
      webcrypto.getRandomValues(buffer);
      return buffer;
    }
    // node:test resolves globalThis.crypto only from Node 19 on for the web
    // API; fall through to node:crypto, never to a PRNG.
    if (typeof require === "function") {
      // eslint-disable-next-line global-require
      const crypto = require("node:crypto");
      crypto.randomFillSync(buffer);
      return buffer;
    }
    throw new Error(
      "Ziy Talk found no cryptographic randomness: crypto.getRandomValues and node:crypto are both unavailable"
    );
  }

  /* ------------------------------------------------------------------ *
   * Generation.
   * ------------------------------------------------------------------ */

  /**
   * Draws one unbiased symbol index in [0, 62) by rejection sampling.
   *
   * Reads 8 bytes from the CSPRNG, interprets them as an unsigned 64-bit
   * integer, and takes it modulo 62 — but only when it falls in the accepted
   * range, so every symbol has probability exactly 1/62 rather than a
   * near-but-not-quite 1/62.
   */
  function drawIndex() {
    for (;;) {
      const bytes = getRandomValues(new Uint8Array(CHUNK_BYTES));
      let value = 0n;
      for (let i = 0; i < bytes.length; i++) {
        value = (value << 8n) | BigInt(bytes[i]);
      }
      if (value < ACCEPT_LIMIT) {
        return Number(value % ALPHABET_SIZE);
      }
      // The rejection probability is (2^64 mod 62) / 2^64 ≈ 2.4e-19; the loop
      // is here for correctness, not because it is expected to iterate.
    }
  }

  /**
   * A fresh 15-character base62 room id with ~89 bits of entropy.
   * @returns {string}
   */
  function generateRoomId() {
    let out = "";
    for (let i = 0; i < ROOM_ID_LENGTH; i++) {
      out += ALPHABET[drawIndex()];
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Validation.
   *
   * Join must be exact-charset, because a room id is a credential-adjacent
   * reference: accepting a malformed one (a space, a dash, a homograph) either
   * reaches a different room or reaches nothing, and the user deserves a
   * message rather than a silent failure.
   * ------------------------------------------------------------------ */

  /**
   * @param {string} value
   * @returns {boolean} true only for exactly 15 characters, all base62.
   */
  function isValidRoomId(value) {
    if (typeof value !== "string") return false;
    if (value.length !== ROOM_ID_LENGTH) return false;
    for (let i = 0; i < value.length; i++) {
      if (!ALPHABET_SET.has(value[i])) return false;
    }
    return true;
  }

  /**
   * Why a value is not a valid room id, in words a person can act on.
   * @param {string} value
   * @returns {string|null} null when the value is valid.
   */
  function roomIdError(value) {
    if (typeof value !== "string" || value.length === 0) {
      return "Enter the room code from the invitation.";
    }
    if (value.length !== ROOM_ID_LENGTH) {
      return `A room code is exactly ${ROOM_ID_LENGTH} characters; this one has ${value.length}.`;
    }
    for (let i = 0; i < value.length; i++) {
      if (!ALPHABET_SET.has(value[i])) {
        return `A room code uses letters A-Z, a-z and digits 0-9 only; this one has ${JSON.stringify(value[i])}.`;
      }
    }
    return null;
  }

  /**
   * Extracts a room id from whatever the user pasted: a bare id, a full
   * `https://host/<id>` URL, a `ziy-talk://<id>` URL, or a room link with
   * query or fragment. The character set makes this unambiguous — base62
   * cannot collide with any of the punctuation in a URL.
   * @param {string} input
   * @returns {{roomId: string|null, error: string|null}}
   */
  function parseRoomInput(input) {
    if (typeof input !== "string") return { roomId: null, error: roomIdError(input) };
    const trimmed = input.trim();
    if (trimmed === "") return { roomId: null, error: roomIdError("") };

    // Percent-encoded whitespace around the value is what a link copied out of
    // some email clients looks like; decode first so the charset test sees the
    // room and not the padding.
    try {
      const decoded = decodeURIComponent(trimmed).trim();
      if (isValidRoomId(decoded)) return { roomId: decoded, error: null };
    } catch {
      // Not percent-encoded; the raw form is the only candidate.
    }

    // Last path segment of any URL form, with query/fragment removed.
    const withoutQuery = trimmed.split("?")[0].split("#")[0];
    const match = /([A-Za-z0-9]+)$/.exec(withoutQuery);
    const candidates = [trimmed, withoutQuery, match ? match[1] : trimmed];
    for (const candidate of candidates) {
      if (isValidRoomId(candidate)) return { roomId: candidate, error: null };
    }
    return { roomId: null, error: roomIdError(trimmed) };
  }

  return {
    ALPHABET,
    ALPHABET_SET,
    ROOM_ID_LENGTH,
    ENTROPY_BITS,
    ACCEPT_LIMIT,
    getRandomValues,
    drawIndex,
    generateRoomId,
    isValidRoomId,
    roomIdError,
    parseRoomInput,
  };
});
