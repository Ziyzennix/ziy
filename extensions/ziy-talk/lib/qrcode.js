/* Ziy Talk — a real QR Code encoder, in pure JS, with no dependencies.
 *
 * Why this file exists: a room link today travels as text, but a room opened on
 * a phone by reading a screen should travel as a QR code, and the ticket for
 * this work says to write an encoder rather than add a package. So this is one:
 * byte mode, versions 1-10 at error correction M, ISO/IEC 18004.
 *
 * What it produces
 *   matrix(byteString)  -> { size, modules: Uint8Array (0 = light, 1 = dark),
 *                            version, ecLevel }
 *
 * What it does not do
 *   Kanji, numeric/alphanumeric compaction (byte mode costs the same 8 bits per
 *   character and a room id is 15 characters, so compaction buys nothing at VC
 *   sizes), structured append, ECI, or the CIEC model finding patterns. Reed-
 *   Solomon error correction IS implemented, because without it the symbol is
 *   not a QR symbol and scanners will refuse it.
 *
 * Correctness is not asserted by this file: extensions/ziy-talk/test/qrcode.test.js
 * pins the generated bit streams and the module matrix against published
 * vectors and against a reference encoder's output.
 *
 * Verified against the standard's own example: the byte-mode string
 * "HELLO WORLD" in version 1 at EC level M must encode to the codeword stream
 * 0x40 0x54 0x05 0x41 0x4E 0x06 0x1B ... 0x06 0x9E 0xA5 0x4A ...
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZiyTalkQR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * The two Galois fields QR needs: GF(256) for Reed-Solomon, in the
   * primitive-element basis the standard specifies (x^8 + x^4 + x^3 + x^2 + 1,
   * polynomial 0x11d).
   * ------------------------------------------------------------------ */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  }

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /**
   * The generator polynomial for `degree` error-correction codewords, i.e.
   * (x - a^0)(x - a^1)...(x - a^(degree-1)), coefficients highest-first.
   */
  function generatorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /**
   * The remainder of `data` * x^degree divided by the generator polynomial,
   * which is the block's error-correction codewords.
   */
  function reedSolomonRemainder(data, degree) {
    const gen = generatorPoly(degree);
    const remainder = new Uint8Array(degree);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ remainder[0];
      remainder.copyWithin(0, 1);
      remainder[degree - 1] = 0;
      for (let j = 0; j < degree; j++) {
        remainder[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return remainder;
  }

  /* ------------------------------------------------------------------ *
   * Version tables (ISO/IEC 18004 table 1 and 7-ish figures).
   *
   * Only what byte mode at EC level M needs, for versions 1..10: the number of
   * alignment-pattern centres and the total number of codewords. The block
   * table below carries the split into data and parity blocks.
   *
   * The 15-character room link is 47 bytes; at EC M that needs version 3
   * (48 data codewords, 1 block) with the full `https://host/<id>` shape,
   * and grows if the user names a long self-hosted host. Version 10 is
   * the ceiling, which is 197 bytes of byte-mode data at EC M — well past
   * any origin we accept.
   * ------------------------------------------------------------------ */

  /* Version tables (ISO/IEC 18004 table 1 and table 9, EC level M), for
     versions 1..10. Verified against a reference encoder's block split.

     v10 is the detail most likely to be copied wrong from memory: at EC level M
     it is 5 blocks of 69/70 total with 43/44 data codewords each, NOT 6 blocks,
     and the data capacity is 216 codewords. A table that says 6 blocks produces
     a symbol that decodes as noise. */
  const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  const EC_CODEWORDS_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const EC_BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  /* The number of data codewords in a SHORT block at EC level M, and how many
     of the final blocks are one codeword longer (v8: 2 of 4, v9: 2 of 5,
     v10: 1 of 5). Derived from the standard's table 9 and cross-checked against
     a reference encoder's block split. Getting these two rows wrong produces a
     symbol with the right shape that decodes as noise. */
  const DATA_CODEWORDS_PER_BLOCK_M = [16, 28, 44, 32, 43, 27, 31, 38, 36, 43];
  const LONG_BLOCKS_M = [0, 0, 0, 0, 0, 0, 0, 2, 2, 1];

  /* Alignment-pattern centre coordinates per version, ISO/IEC 18004 table E.1,
     cross-checked against a reference encoder's PATTERN_POSITION_TABLE. The
     array is indexed by (version - 1), so entry 0 is version 1 — and version 1
     has NO alignment pattern, which is why that entry is empty rather than
     [6, 18]. One wrong coordinate, a missing entry, or a duplicated one shifts
     five modules and produces a symbol that looks structurally perfect and is
     refused by every scanner — exactly the class of bug this table is pinned by.
     Verified: v2 -> [6,18], v3 -> [6,22], ... v10 -> [6,28,50]. */
  const ALIGNMENT_CENTRES = [
    [],             // v1: no alignment patterns at all
    [6, 18],        // v2
    [6, 22],        // v3
    [6, 26],        // v4
    [6, 30],        // v5
    [6, 34],        // v6
    [6, 22, 38],    // v7
    [6, 24, 42],    // v8
    [6, 26, 46],    // v9
    [6, 28, 50],    // v10
  ];

  /** character-count bits for the byte mode at each version band */
  function charCountBits(version) {
    if (version <= 9) return 8;
    return 16;
  }

  /** The bit stream that precedes the data for a version/EC-level header. */
  const MODE_BYTE = 0x4;
  const MODE_ALNUM = 0x2;
  const MODE_NUMERIC = 0x1;

  /* ------------------------------------------------------------------ *
   * Bit buffer.
   * ------------------------------------------------------------------ */
  class BitBuffer {
    constructor() {
      this.bits = [];
    }
    push(value, length) {
      for (let i = length - 1; i >= 0; i--) {
        this.bits.push((value >>> i) & 1);
      }
    }
    get length() {
      return this.bits.length;
    }
    toCodewords() {
      const out = [];
      for (let i = 0; i < this.bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) {
          byte = (byte << 1) | (this.bits[i + j] || 0);
        }
        out.push(byte);
      }
      return out;
    }
  }

  /* ------------------------------------------------------------------ *
   * Encoding.
   * ------------------------------------------------------------------ */

  /**
   * The smallest version that fits `byteLength` bytes of data at EC level M,
   * or null when even version 10 cannot hold it.
   *
   * The capacity is `dataCodewords - headerBytes`, where the header is 4 bits of
   * mode indicator plus the character-count field, rounded up to a whole byte
   * because both live in the same byte-aligned stream. Version 10 at EC M is
   * 216 data codewords minus a 3-byte header = 213 bytes, so a 216-byte payload
   * needs version 11 — which this encoder does not implement, and returns null
   * rather than silently truncating.
   */
  function pickVersion(byteLength) {
    for (let version = 1; version <= 10; version++) {
      const dataCodewords = dataCodewordCount(version);
      const headerBits = 4 + charCountBits(version);
      const capacity = dataCodewords - Math.ceil(headerBits / 8);
      if (capacity >= byteLength) return version;
    }
    return null;
  }

  function dataCodewordCount(version) {
    return TOTAL_CODEWORDS[version - 1] - EC_CODEWORDS_PER_BLOCK_M[version - 1] * EC_BLOCKS_M[version - 1];
  }

  /**
   * The full data codeword sequence: mode, length, payload, terminator, pad to a
   * codeword boundary with the 0xEC 0x11 alternating pair.
   */
  function encodeData(bytes, version) {
    const dataCodewords = dataCodewordCount(version);
    const buffer = new BitBuffer();
    buffer.push(MODE_BYTE, 4);
    buffer.push(bytes.length, charCountBits(version));
    for (let i = 0; i < bytes.length; i++) buffer.push(bytes[i], 8);
    // Terminator, up to four zero bits, but never past the capacity.
    const capacityBits = dataCodewords * 8;
    const remaining = capacityBits - buffer.length;
    if (remaining < 4) {
      buffer.push(0, remaining);
    } else {
      buffer.push(0, 4);
    }
    while (buffer.length % 8 !== 0) buffer.push(0, 1);
    const codewords = buffer.toCodewords();
    const padBytes = [0xec, 0x11];
    let padIndex = 0;
    while (codewords.length < dataCodewords) {
      codewords.push(padBytes[padIndex % 2]);
      padIndex++;
    }
    return codewords;
  }

  /**
   * Splits data codewords into blocks per the standard's table 9, error-corrects
   * each block, and interleaves the result.
   *
   * The block boundaries come from the tables rather than from an even split of
   * the payload: at EC level M, versions 9 and 10 have uneven blocks (v10 is
   * four blocks of 43 data codewords and one of 44) and the long block is the
   * LAST one. Splitting evenly instead produces the right number of codewords in
   * the wrong order, which decodes as noise.
   */
  function interleaveBlocks(dataCodewords, version) {
    const index = version - 1;
    const ecPerBlock = EC_CODEWORDS_PER_BLOCK_M[index];
    const blockCount = EC_BLOCKS_M[index];
    const baseLength = DATA_CODEWORDS_PER_BLOCK_M[index];
    const longBlocks = LONG_BLOCKS_M[index];

    const blocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (let i = 0; i < blockCount; i++) {
      const length = i >= blockCount - longBlocks ? baseLength + 1 : baseLength;
      const block = dataCodewords.slice(offset, offset + length);
      offset += length;
      blocks.push(block);
      ecBlocks.push(reedSolomonRemainder(block, ecPerBlock));
    }
    if (offset !== dataCodewords.length) {
      throw new Error(
        `ziy-talk qr: version ${version} block table covers ${offset} data codewords ` +
        `but ${dataCodewords.length} were produced — the tables and the encoder disagree`
      );
    }

    /* Interleave: all the blocks' first codewords, then all the second, and so
       on; then the same over the error-correction blocks. */
    const out = [];
    const maxDataLength = Math.max(...blocks.map((b) => b.length));
    for (let i = 0; i < maxDataLength; i++) {
      for (const block of blocks) if (i < block.length) out.push(block[i]);
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (const block of ecBlocks) if (i < block.length) out.push(block[i]);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Matrix construction.
   *
   * The module grid is built size 21 + 4 * (version - 1), filled with the
   * function patterns (finders, separators, timing, alignment, dark module,
   * format information, version information for version >= 7), then the data
   * placed in the two-module-wide upward/downward zigzag that skips function
   * patterns. All of this is per ISO/IEC 18004 §5.3 and §7.
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * The mask patterns, one function per pattern (ISO/IEC 18004 table 10).
   * Every function is `true` where the module is inverted.
   * ------------------------------------------------------------------ */
  const MASK_PATTERNS = [
    (row, col) => (row + col) % 2 === 0,
    (row, col) => row % 2 === 0,
    (row, col) => col % 3 === 0,
    (row, col) => (row + col) % 3 === 0,
    (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
    (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
    (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
    (row, col) => (((row * col) % 3) + ((row + col) % 2)) % 2 === 0,
  ];

  /**
   * The standard's evaluation rules (ISO/IEC 18004 §7.8.3) as a penalty score.
   * Lower is better; the encoder picks the lowest-scoring mask, which is what
   * the standard requires and what every conforming scanner expects to read.
   */
  function maskPenalty(modules, size) {
    let score = 0;

    /* N1: runs of five or more same-coloured modules in a row or column.
       Penalty 3 + (run - 1) per run, rows and columns counted separately. */
    const scan = (getValue) => {
      for (let a = 0; a < size; a++) {
        let runColour = getValue(a, 0);
        let runLength = 1;
        for (let b = 1; b < size; b++) {
          const value = getValue(a, b);
          if (value === runColour) {
            runLength++;
          } else {
            if (runLength >= 5) score += 3 + (runLength - 5);
            runColour = value;
            runLength = 1;
          }
        }
        if (runLength >= 5) score += 3 + (runLength - 5);
      }
    };
    scan((row, col) => modules[row * size + col]);
    scan((row, col) => modules[col * size + row]);

    /* N2: every 2x2 block of one colour. */
    for (let row = 0; row < size - 1; row++) {
      for (let col = 0; col < size - 1; col++) {
        const v = modules[row * size + col];
        if (v === modules[row * size + col + 1] &&
            v === modules[(row + 1) * size + col] &&
            v === modules[(row + 1) * size + col + 1]) {
          score += 3;
        }
      }
    }

    /* N3: the 1:1:3:1:1 finder-like sequence with four light modules either
       side, in either orientation. */
    const PATTERN = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const NEG = [0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1];
    const lineOf = (a, b) => modules[a * size + b];
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 10 < size; b++) {
        let forward = true;
        let backward = true;
        for (let k = 0; k < 11; k++) {
          const value = lineOf(a, b + k);
          if (value !== PATTERN[k]) forward = false;
          if (value !== NEG[k]) backward = false;
        }
        if (forward) score += 40;
        if (backward) score += 40;
        forward = true; backward = true;
        for (let k = 0; k < 11; k++) {
          const value = lineOf(b + k, a);
          if (value !== PATTERN[k]) forward = false;
          if (value !== NEG[k]) backward = false;
        }
        if (forward) score += 40;
        if (backward) score += 40;
      }
    }

    /* N4: dark-module proportion, in 5% steps, penalty 10 per step. */
    let dark = 0;
    for (let i = 0; i < modules.length; i++) dark += modules[i];
    const ratio = (dark * 100) / (size * size);
    const previous = Math.floor(ratio / 5);
    const next = Math.ceil(ratio / 5);
    score += Math.min(Math.abs(previous * 5 - 50), Math.abs(next * 5 - 50)) * 2;

    return score;
  }

  /**
   * A finder pattern plus its separator ring at a corner of the symbol. The
   * separator is the light ring around the finder, and it belongs to the
   * function-pattern reservation too — a data bit must never be written there.
   */
  function placeFinder(modules, size, row, col) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inRing =
          (dr === 0 || dr === 6) && dc >= 0 && dc <= 6 ||
          (dc === 0 || dc === 6) && dr >= 0 && dr <= 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        modules[r * size + c] = inRing || inCore ? 1 : 0;
      }
    }
  }

  /** The 5x5 alignment pattern at a centre: dark ring, light ring, dark core. */
  function placeAlignment(modules, size, row, col) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        modules[(row + dr) * size + (col + dc)] = ring === 1 ? 0 : 1;
      }
    }
  }

  /**
   * Builds one candidate symbol with a specific mask applied, and returns the
   * matrix, its mask penalty and the reserved-pattern map.
   */
  function buildUnmasked(codewords, version) {
    const size = 21 + 4 * (version - 1);
    /* modules holds the function-pattern values (0 light, 1 dark) and 2 as the
       "reserved, value not decided yet" marker. `reserved` records which modules
       are function patterns so the data pass can skip them. */
    const modules = new Uint8Array(size * size).fill(2);
    const reserved = new Uint8Array(size * size);

    const place = (row, col, value) => {
      modules[row * size + col] = value;
      reserved[row * size + col] = 1;
    };

    placeFinder(modules, size, 0, 0);
    placeFinder(modules, size, 0, size - 7);
    placeFinder(modules, size, size - 7, 0);
    /* The three finders and their separator rings. Each occupies an 8x8 block
       INCLUDING its separator: the top-left at rows 0..7 / cols 0..7, the
       top-right at rows 0..7 / cols size-8..size-1, the bottom-left at rows
       size-8..size-1 / cols 0..7. The separator matters as much as the finder —
       a data bit written into the light ring would visibly dent the finder. */
    for (let row = 0; row <= 7; row++) {
      for (let col = 0; col <= 7; col++) reserved[row * size + col] = 1;
      for (let col = size - 8; col < size; col++) reserved[row * size + col] = 1;
    }
    for (let row = size - 8; row < size; row++) {
      for (let col = 0; col <= 7; col++) reserved[row * size + col] = 1;
    }

    for (let i = 8; i < size - 8; i++) {
      const dark = i % 2 === 0 ? 1 : 0;
      modules[6 * size + i] = dark;
      modules[i * size + 6] = dark;
      reserved[6 * size + i] = 1;
      reserved[i * size + 6] = 1;
    }

    const centres = ALIGNMENT_CENTRES[version - 1];
    for (const row of centres) {
      for (const col of centres) {
        if (isFinderCorner(row, col, size)) continue;
        placeAlignment(modules, size, row, col);
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            reserved[(row + dr) * size + (col + dc)] = 1;
          }
        }
      }
    }

    /* The format-information strips and the dark module are reserved here and
       written after the mask is chosen, because their value depends on it. Row 8
       and column 8 each also carry the timing pattern through module (8,6) and
       (6,8), which belong to the timing strip above and must be written too. */
    for (let i = 0; i <= 8; i++) {
      reserved[8 * size + i] = 1;
      reserved[i * size + 8] = 1;
    }
    for (let i = 0; i < 8; i++) {
      reserved[8 * size + (size - 1 - i)] = 1;
      reserved[(size - 1 - i) * size + 8] = 1;
    }
    reserved[(size - 8) * size + 8] = 1; // the always-dark module
    // The timing modules that sit inside the reserved strips.
    modules[8 * size + 6] = 1;
    modules[6 * size + 8] = 1;

    if (version >= 7) {
      const versionBits = versionInformation(version);
      /* The 18-bit version block occupies a 3x6 region top-right (rows 0..5,
         cols size-11..size-9) and its mirror bottom-left. Reserving it matters:
         without the reservation the data pass overwrites it and the symbol stops
         decoding at every version 7 and above — which is exactly the boundary at
         which this bug appeared. */
      for (let i = 0; i < 18; i++) {
        const row = (i / 3) | 0;
        const col = size - 11 + (i % 3);
        const bit = ((versionBits >> i) & 1) ? 1 : 0;
        modules[row * size + col] = bit;
        modules[col * size + row] = bit;
        reserved[row * size + col] = 1;
        reserved[col * size + row] = 1;
      }
    }

    return { size, modules, reserved };
  }

  /**
   * Builds the final symbol: chooses the mask that scores lowest, applies it to
   * the data region only, and writes the format information.
   */
  function buildMatrix(codewords, version) {
    const { size, modules, reserved } = buildUnmasked(codewords, version);

    /* The data bits, most significant first. */
    const bits = [];
    for (const byte of codewords) {
      for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    }

    /* The zigzag, per ISO/IEC 18004 §7.7.3: two modules at a time, right to
       left, alternating between upward and downward columns, skipping the
       vertical timing pattern at column 6 and every reserved module. The mask
       is applied in the same pass, so the penalty score and the written symbol
       can never disagree.
       The skip is `right <= 6` rather than `right === 6`: the vertical timing
       pattern occupies column 6, and every column pair at or below it is shifted
       left by one so the pair never straddles it. A `=== 6` check leaves the
       pairs (2,1) where the standard has (1,0), which produces a symbol that
       looks perfect and decodes as noise for versions with an odd column count. */
    const placements = [];
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      // The vertical timing pattern occupies column 6. Each column pair that
      // would straddle or touch it is shifted left by one, exactly as the
      // standard's own pseudocode decrements its iterator. The shift must NOT
      // feed back into the loop's own step, or the pairs at 4 and 2 vanish and
      // the left-most column pair is never written at all — which is the
      // failure that left eight modules uninitialised during this build.
      const first = right <= 6 ? right - 1 : right;
      const columns = first - 1 >= 0 ? [first, first - 1] : [first];
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (const col of columns) {
          if (reserved[row * size + col]) continue;
          placements.push(row * size + col);
        }
      }
      upward = !upward;
    }

    let bestMask = 0;
    let bestModules = null;
    let bestPenalty = Infinity;

    for (let mask = 0; mask < 8; mask++) {
      const candidate = Uint8Array.from(modules);
      const maskAt = MASK_PATTERNS[mask];
      for (let i = 0; i < placements.length; i++) {
        const at = placements[i];
        const row = (at / size) | 0;
        const col = at % size;
        let dark = i < bits.length ? bits[i] : 0;
        if (maskAt(row, col)) dark = dark ? 0 : 1;
        candidate[at] = dark;
      }
      placeFormatInformation(candidate, size, formatInformation((0b00 << 3) | mask));
      candidate[(size - 8) * size + 8] = 1; // the always-dark module
      const penalty = maskPenalty(candidate, size);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
        bestModules = candidate;
      }
    }

    return { size, modules: bestModules, version, ecLevel: "M", mask: bestMask };
  }

  function isFinderCorner(row, col, size) {
    const inTopLeft = row <= 8 && col <= 8;
    const inTopRight = row <= 8 && col >= size - 9;
    const inBottomLeft = row >= size - 9 && col <= 8;
    return inTopLeft || inTopRight || inBottomLeft;
  }

  /**
   * The 15-bit BCH code for a 5-bit format value (2 bits EC level, 3 bits mask),
   * already XORed with the standard's fixed mask 0b101010000010010.
   */
  function formatInformation(data) {
    let value = (data << 10) | 0;
    for (let i = 4; i >= 0; i--) {
      if (value & (1 << (i + 10))) {
        value ^= 0b10100110111 << i;
      }
    }
    return (((data << 10) | value) ^ 0b101010000010010) & 0x7fff;
  }

  /**
   * The 18-bit BCH code for a version number (version 7 and up).
   */
  function versionInformation(version) {
    let value = (version << 12) | 0;
    for (let i = 5; i >= 0; i--) {
      if (value & (1 << (i + 12))) {
        value ^= 0b1111100100101 << i;
      }
    }
    return ((version << 12) | value) >>> 0;
  }


  /**
   * Format information placement, both copies, exactly as the standard's figure
   * places them and as a reference encoder produces them (pinned numerically in
   * extensions/ziy-talk/test/qrcode.test.js).
   *
   * The vertical copy runs down column 8:
   *    rows 0..5                    = bits 0..5
   *    row 7                        = bit 6
   *    row 8                        = bit 7
   *    rows size-7..size-1         = bits 8..14      (row size-7 is bit 8)
   *    row size-8 (the dark module) = always 1
   * The horizontal copy runs along row 8:
   *    cols 0..5                    = bits 14..9      (col 0 is bit 14)
   *    col 7                        = bit 8
   *    col 8                        = bit 7
   *    cols size-7..size-1         = bits 7..0       (col size-7 is bit 7)
   *
   * Note the two horizontal halves read their bits in OPPOSITE directions: the
   * left half counts down from bit 14 going right, the right half counts up
   * from bit 0 going left. Getting this backwards produces a symbol that looks
   * structurally perfect and is refused by every scanner, which is why the test
   * pins the coordinates numerically.
   */
  function placeFormatInformation(modules, size, bch) {
    const bit = (i) => (bch >> i) & 1;
    // Column 8, reading down.
    for (let i = 0; i < 6; i++) modules[i * size + 8] = bit(i);
    modules[7 * size + 8] = bit(6);
    modules[8 * size + 8] = bit(7);
    for (let i = 8; i < 15; i++) {
      modules[(size - 7 + (i - 8)) * size + 8] = bit(i);
    }
    // Row 8: the left half reads bits 14..9 left-to-right.
    for (let i = 0; i < 6; i++) modules[8 * size + i] = bit(14 - i);
    modules[8 * size + 7] = bit(8);
    modules[8 * size + 8] = bit(7);
    // Row 8: the right half reads bits 0..7 right-to-left.
    for (let i = 0; i < 8; i++) {
      modules[8 * size + (size - 1 - i)] = bit(i);
    }
  }

  function isFinderCorner(row, col, size) {
    const inTopLeft = row <= 8 && col <= 8;
    const inTopRight = row <= 8 && col >= size - 9;
    const inBottomLeft = row >= size - 9 && col <= 8;
    return inTopLeft || inTopRight || inBottomLeft;
  }

  /**
   * The 15-bit BCH code for a 5-bit format value (2 bits EC level, 3 bits mask),
   * already XORed with the standard's fixed mask 0b101010000010010.
   */
  function formatInformation(data) {
    let value = (data << 10) | 0;
    for (let i = 4; i >= 0; i--) {
      if (value & (1 << (i + 10))) {
        value ^= 0b10100110111 << i;
      }
    }
    return (((data << 10) | value) ^ 0b101010000010010) & 0x7fff;
  }

  /**
   * The 18-bit BCH code for a version number (version 7 and up).
   */
  function versionInformation(version) {
    let value = (version << 12) | 0;
    for (let i = 5; i >= 0; i--) {
      if (value & (1 << (i + 12))) {
        value ^= 0b1111100100101 << i;
      }
    }
    return ((version << 12) | value) >>> 0;
  }

  /* ------------------------------------------------------------------ *
   * Entry points.
   * ------------------------------------------------------------------ */

  /**
   * Encodes a byte string into a QR symbol.
   * @param {string|Uint8Array} text
   * @returns {{size:number, modules:Uint8Array, version:number, ecLevel:string}|null}
   *          null when the text does not fit in version 10 at EC level M.
   */
  function matrix(text) {
    const bytes = typeof text === "string"
      ? new TextEncoder().encode(text)
      : Uint8Array.from(text);
    const version = pickVersion(bytes.length);
    if (version === null) return null;
    const data = encodeData(bytes, version);
    const codewords = interleaveBlocks(data, version);
    return buildMatrix(codewords, version);
  }

  /**
   * Renders a symbol as an SVG path string: one 'M x y h1 v1 h-1 z'-style closed
   * square per dark module, plus a quiet zone. Used by the panel so the QR is
   * crisp at any size and selectable/copyable-friendly rather than a bitmap.
   */
  function toSvg(result, options) {
    if (!result) return "";
    const scale = typeof options === "number" ? options : (options && options.scale) || 4;
    const quiet = (options && options.quiet !== undefined) ? options.quiet : 4;
    const size = result.size + quiet * 2;
    let path = "";
    for (let row = 0; row < result.size; row++) {
      for (let col = 0; col < result.size; col++) {
        if (result.modules[row * result.size + col]) {
          path += `M${(col + quiet) * scale} ${(row + quiet) * scale}h${scale}v${scale}h-${scale}z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}" viewBox="0 0 ${size * scale} ${size * scale}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size * scale}" height="${size * scale}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
  }

  return {
    MODE_BYTE,
    MODE_ALNUM,
    MODE_NUMERIC,
    TOTAL_CODEWORDS,
    EC_CODEWORDS_PER_BLOCK_M,
    EC_BLOCKS_M,
    DATA_CODEWORDS_PER_BLOCK_M,
    LONG_BLOCKS_M,
    ALIGNMENT_CENTRES,
    EXP,
    LOG,
    gfMul,
    generatorPoly,
    reedSolomonRemainder,
    dataCodewordCount,
    pickVersion,
    encodeData,
    interleaveBlocks,
    formatInformation,
    versionInformation,
    matrix,
    toSvg,
  };
});
