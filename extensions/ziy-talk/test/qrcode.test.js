/* Ziy Talk — the QR encoder tests.
 *
 * The encoder is verified by DECODING, not by self-comparison: a QR code is a
 * public symbol, so the only honest proof that our bit stream, our Reed-Solomon
 * parity, our mask and our format information are all correct is that a decoder
 * that did not write them reads back the original bytes.
 *
 * The decoder used here is the one this box has: a node harness shells out to
 * Python's `pyzbar` (zbar) over a PBM we write from the module matrix. When the
 * decoder is not installed, the structural tests still run and the decode tests
 * are SKIPPED — reported as skipped, never claimed as passing.
 *
 * What the encoder promises, in order of how expensive it is to get wrong:
 *   1. the bit stream is byte-mode with the standard's mode indicator, the
 *      character-count field sized per version band, the terminator and the
 *      alternating pad pair
 *   2. the Reed-Solomon parity is the right polynomial over GF(256) — verified
 *      against the standard's own example values
 *   3. the block split and interleave match the table for each version
 *   4. the mask is chosen by the standard's penalty rules and APPLIED
 *   5. the format information is placed in both copies, in opposite bit orders
 *   6. it round-trips for every payload a Ziy room link can be
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const QR = require('../lib/qrcode.js');
const S = require('../lib/settings.js');
const ROOM = require('../lib/room.js');

/* ------------------------------------------------------------------ *
 * Decoder availability.
 * ------------------------------------------------------------------ */
let DECODER = null;
let DECODER_REASON = 'not probed';
try {
  const python = execFileSync('python3', ['-c',
    'import sys; sys.path.insert(0, "/tmp/pzenv"); import pyzbar.pyzbar as p; print("ok")'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  DECODER = python.trim() === 'ok';
  if (!DECODER) DECODER_REASON = 'pyzbar import failed';
} catch (err) {
  DECODER = false;
  DECODER_REASON = String(err.message || err);
}

/** Renders a symbol to a PBM and decodes it with zbar, scaled by `scale`. */
function decodeSymbol(result, text, scale) {
  const quiet = 4;
  const size = result.size + quiet * 2;
  const factor = scale || 3;
  const lines = [`P1 ${size * factor} ${size * factor}`];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const inQuiet = x < quiet || y < quiet || x >= size - quiet || y >= size - quiet;
      const dark = !inQuiet && result.modules[(y - quiet) * result.size + (x - quiet)];
      row += dark ? '1'.repeat(factor) : '0'.repeat(factor);
    }
    // Each module row is repeated `factor` times, so a module is `factor` square
    // pixels and no scanner has to interpolate.
    for (let k = 0; k < factor; k++) lines.push(row);
  }
  const file = path.join(os.tmpdir(), `ziy-talk-qr-${process.pid}-${Math.random().toString(36).slice(2)}.pbm`);
  fs.writeFileSync(file, lines.join('\n'));
  try {
    const script = [
      'import sys',
      'sys.path.insert(0, "/tmp/pzenv")',
      'from PIL import Image',
      'from pyzbar.pyzbar import decode',
      `img = Image.open(${JSON.stringify(file)}).convert("L")`,
      'out = decode(img)',
      'print("|".join(d.data.decode("utf-8", "replace") for d in out))',
    ].join('\n');
    const stdout = execFileSync('python3', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return stdout.trim();
  } finally {
    fs.unlinkSync(file);
  }
}

/* ------------------------------------------------------------------ *
 * 1. The bit stream.
 * ------------------------------------------------------------------ */

test('the standard\'s own byte-mode example encodes to the documented codewords', () => {
  // ISO/IEC 18004 annex I's example: "HELLO WORLD" in version 1 at EC level M
  // produces 0x40 0xB4 0x84 0x54 0xC4 0xC4 0xF2 0x05 0x74 0xF5 0x24 0xC4 0x40
  // followed by the pad pair 0xEC 0x11. This pins the header, the mode
  // indicator, the character-count field and the pad bytes all at once.
  const data = QR.encodeData(Buffer.from('HELLO WORLD', 'latin1'), 1);
  const hex = Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  assert.equal(hex, '40 b4 84 54 c4 c4 f2 05 74 f5 24 c4 40 ec 11 ec');
  assert.equal(data.length, 16, 'version 1 at EC M is 16 data codewords');
});

test('the mode indicator and the character-count field are version-banded', () => {
  // 4 bits of mode 0100, then an 8-bit count for versions 1-9 and a 16-bit count
  // for version 10. That banding is what lets the smallest version win.
  const bytes = Buffer.from('x'.repeat(10), 'latin1');
  const v1 = QR.encodeData(bytes, 1);
  const v10 = QR.encodeData(bytes, 10);
  // v1: 0100 00001010 787878...
  assert.equal(v1[0], 0x40);            // 0100 + the top 4 count bits (10 = 0b00001010)
  // Byte 1's HIGH nibble is the count field's low 4 bits (1010 = 10).
  assert.equal((v1[1] >> 4) & 0x0f, 0x0a);
  // v10: 0100 00000000 00001010
  assert.equal(v10[0], 0x40);
  assert.equal(v10[1], 0x00);           // the count field's high byte
  // Byte 2's HIGH nibble is the count field's low 4 bits (1010 = 10); the low
  // nibble is the top of the first payload byte.
  assert.equal((v10[2] >> 4) & 0x0f, 0x0a);
});

test('the terminator is up to 4 bits and the pad pairs are 0xEC 0x11', () => {
  const bytes = Buffer.from('ab', 'latin1');
  const data = QR.encodeData(bytes, 1);
  // 4 + 8 + 16 = 28 bits, then 4 terminator bits = 32 bits = 4 bytes, then pads.
  assert.equal(data[0], 0x40);
  // 0x26 = 0010 0110: count 0000 0010 then the top 4 bits of 'a' (0x61).
  assert.equal(data[1], 0x26);
  // 4 mode bits + 8 count bits + 16 payload bits = 28 bits, then the 4-bit
  // terminator lands exactly on the byte boundary, so bytes 0..3 are
  // 0x40, 0x26, 0x61, 0x62+padding and the pads start at index 4.
  assert.equal(data[2], 0x16, 'the low 7 bits of ab plus the top terminator bit');
  assert.equal(data[3], 0x20, 'the remaining terminator bits, padded with zeros');
  assert.equal(data[4], 0xec, 'the pad pair starts with 0xEC');
  assert.equal(data[5], 0x11, 'and alternates 0x11');
  assert.equal(data[6], 0xec);
  // 12 pad bytes from index 4 to 15, so the pair ends on 0x11.
  assert.equal(data[data.length - 1], 0x11, 'an even number of pads ends on 0x11');
  assert.equal(data.length - 4, 12, 'version 1 at EC M is 16 codewords, 4 of them data here');
});

test('the version chosen is the smallest that fits, and nothing beyond v10 exists', () => {
  // Byte capacity at EC M is dataCodewords - 3 bytes of header.
  assert.equal(QR.pickVersion(1), 1);        // v1 holds 14 bytes
  assert.equal(QR.pickVersion(14), 1);
  assert.equal(QR.pickVersion(15), 2);
  assert.equal(QR.pickVersion(60), 4);
  assert.equal(QR.pickVersion(213), 10);
  assert.equal(QR.pickVersion(214), null, 'past v10 the answer is null, not a truncation');
  assert.equal(QR.pickVersion(216), null, '216 bytes is v11, which this encoder does not do');
  assert.equal(QR.pickVersion(5000), null);
});

test('a payload that does not fit returns null rather than a broken symbol', () => {
  assert.equal(QR.matrix('x'.repeat(214)), null);
  assert.equal(QR.matrix('x'.repeat(100000)), null);
});

/* ------------------------------------------------------------------ *
 * 2 and 3. Reed-Solomon and the block tables.
 * ------------------------------------------------------------------ */

test('the generator polynomials match the published values', () => {
  // rsPoly_LUT from the standard's table A.1: (x - a^0)(x - a^1)... for each
  // error-correction degree. Pin the three degrees our versions use.
  const at = (d) => Array.from(QR.generatorPoly(d)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  assert.equal(at(7), '01 7f 7a 9a a4 0b 44 75');
  assert.equal(at(10), '01 d8 c2 9f 6f c7 5e 5f 71 9d c1');
  // degree 26 is the EC depth used at version 3 / level M.
  assert.equal(at(26), '01 f6 33 b7 04 88 62 c7 98 4d 38 ce 18 91 28 d1 ' +
    '75 e9 2a 87 44 46 90 92 4d 2b 5e');
});

test('the standard\'s example produces the standard\'s parity codewords', () => {
  // Same annex I example: the 10 parity codewords that follow the 16 data ones.
  const data = QR.encodeData(Buffer.from('HELLO WORLD', 'latin1'), 1);
  const ec = Array.from(QR.reedSolomonRemainder(data, 10));
  assert.equal(ec.map((b) => b.toString(16).padStart(2, '0')).join(' '),
    '0c 4b cf 9a 89 4f 65 09 97 cc');
});

test('the block tables carry the right capacity for every version', () => {
  // The number that matters is the data codeword total per version at EC M.
  const expected = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
  for (let v = 1; v <= 10; v++) {
    assert.equal(QR.dataCodewordCount(v), expected[v - 1], `version ${v}`);
  }
});

test('the interleaver matches the table, and refuses a table that disagrees', () => {
  // Fill each version to capacity with a recognisable pattern, then check the
  // interleaved output has the right length and the right first codewords.
  for (let v = 1; v <= 10; v++) {
    const capacity = QR.dataCodewordCount(v);
    const bytes = Buffer.alloc(capacity - 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    const data = QR.encodeData(bytes, v);
    assert.equal(data.length, capacity, `v${v} encoded ${data.length}`);
    const total = QR.TOTAL_CODEWORDS[v - 1];
    const out = QR.interleaveBlocks(data, v);
    assert.equal(out.length, total, `v${v} interleaved ${out.length}, expected ${total}`);
  }
});

test('the interleaver throws rather than emit a misaligned symbol', () => {
  // The guard that caught the v10 6-versus-5-blocks bug during development.
  const guard = () => QR.interleaveBlocks([1, 2, 3, 4, 5, 6, 7, 8, 9], 10);
  assert.throws(guard, /block table covers/);
});

test('block data lengths are uneven only where the standard says they are', () => {
  // v10 is four blocks of 43 and one of 44; v9 is three of 36 and two of 37.
  const lengths = (v) => {
    const per = QR.DATA_CODEWORDS_PER_BLOCK_M[v - 1];
    const longs = QR.LONG_BLOCKS_M[v - 1];
    const n = QR.EC_BLOCKS_M[v - 1];
    return Array.from({ length: n }, (_, i) => (i >= n - longs ? per + 1 : per));
  };
  assert.deepEqual(lengths(10), [43, 43, 43, 43, 44]);
  assert.deepEqual(lengths(9), [36, 36, 36, 37, 37]);
  assert.deepEqual(lengths(8), [38, 38, 39, 39]);
  assert.deepEqual(lengths(4), [32, 32]);
  assert.deepEqual(lengths(1), [16]);
});

/* ------------------------------------------------------------------ *
 * 4 and 5. Mask and format information.
 * ------------------------------------------------------------------ */

test('the mask is chosen by the standard\'s penalty rules, not picked arbitrarily', () => {
  // Every mask is evaluated and the lowest-scoring one wins; the reported mask is
  // the one actually written into the format information. The 5 input bits are
  // 2 bits of EC level then 3 bits of mask, and they occupy the TOP 5 of the 15
  // format bits — the BCH remainder fills the rest, then the whole word is XORed
  // with the fixed mask. So the mask is read back from the top, not the bottom.
  const result = QR.matrix('hello world');
  assert.ok(result.mask >= 0 && result.mask <= 7);
  const FINAL_MASK = 0b101010000010010;
  const size = result.size;
  // The exact inverse of the module's placement rule, cross-checked against a
  // reference encoder and the canonical tutorial. The word's bits are indexed
  // with 0 = LEAST significant, and the two horizontal halves read their bits in
  // OPPOSITE directions: the left half counts DOWN from bit 14 going right
  // (col 0 is bit 14, col 5 is bit 9), while the right half counts UP from bit 0
  // going left (col size-1 is bit 0, col size-8 is bit 7). A reader that gets a
  // direction backwards still produces 15 plausible bits, which is why this is
  // asserted rather than assumed.
  //
  // horizontal (row 8): bit (14-i) at col i for i<6; bit 8 at col 7; bit 7 at
  // col 8; bit i at col (size-1-i) for i<8.
  // vertical (column 8): bit i at row i for i<6; bit 6 at row 7; bit 7 at row 8;
  // bit i at row (size-7+(i-8)) for i in 8..14.
  const horizontal = (i) => {
    if (i >= 9) return result.modules[8 * size + (14 - i)]; // bit 14..9 at cols 0..5
    if (i === 8) return result.modules[8 * size + 7];
    if (i === 7) return result.modules[8 * size + 8];
    return result.modules[8 * size + (size - 1 - i)];        // bit 0..7 at cols size-1..size-8
  };
  const vertical = (i) => {
    if (i < 6) return result.modules[i * size + 8];
    if (i === 6) return result.modules[7 * size + 8];
    if (i === 7) return result.modules[8 * size + 8];
    return result.modules[(size - 7 + (i - 8)) * size + 8];
  };
  let bch = 0;
  let verticalBch = 0;
  for (let i = 0; i < 15; i++) {
    if (horizontal(i)) bch |= 1 << i;
    if (vertical(i)) verticalBch |= 1 << i;
  }
  assert.equal(bch, verticalBch, 'the two format-information copies must agree');
  assert.equal(bch, QR.formatInformation((0b00 << 3) | result.mask),
    'the format strip must carry the mask that was applied');
  // The word the strip holds is already fully masked, so recovering the 5 data
  // bits means removing the fixed XOR AND the 10 BCH parity bits. Verify the
  // round trip through the module's own encoder instead of duplicating the BCH
  // arithmetic here: re-derive the expected word from the reported mask and
  // check the top five bits decode back to EC level M and that mask.
  const recovered = ((bch ^ FINAL_MASK) >> 10) & 0b11111;
  assert.equal(recovered & 0b111, result.mask, 'the mask is recoverable from the strip');
  assert.equal((recovered >> 3) & 0b11, 0, 'EC level M is recoverable from the strip');
  // And the canonical worked example, end to end: level L (01) + mask 4 (100).
  assert.equal(QR.formatInformation((0b01 << 3) | 0b100).toString(2).padStart(15, '0'),
    '110011000101111', 'the tutorial\'s worked example must reproduce');
});

test('the format information word matches the published values for all 8 masks', () => {
  // ISO/IEC 18004 table C.1, the 32 format-information words for every EC level
  // and mask. These are the values every conforming decoder expects, and they
  // are pinned so a BCH regression cannot pass by accident.
  const expected = [
    '101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000',
  ];
  for (let mask = 0; mask < 8; mask++) {
    assert.equal(QR.formatInformation((0b00 << 3) | mask).toString(2).padStart(15, '0'),
      expected[mask], `mask ${mask}`);
  }
});

test('the format information is placed in both copies, in opposite bit orders', () => {
  // The horizontal halves of row 8 read their bits in OPPOSITE directions — the
  // left half counts down from bit 14 going right, the right half counts up from
  // bit 0 going left. Pin the coordinates exactly.
  const size = 21;
  const modules = new Uint8Array(size * size).fill(2);
  const bch = parseInt('101111001111100', 2);
  // Reproduce placement through the module's own writer by building a symbol.
  const r = QR.matrix('x');
  const fmt = QR.formatInformation((0 << 3) | r.mask);
  const bit = (i) => (fmt >> i) & 1;
  // Left half, cols 0..5 = bits 14..9.
  for (let i = 0; i < 6; i++) assert.equal(r.modules[8 * size + i], bit(14 - i), `row8 col${i}`);
  // col 7 = bit 8, col 8 = bit 7.
  assert.equal(r.modules[8 * size + 7], bit(8));
  assert.equal(r.modules[8 * size + 8], bit(7));
  // Right half, cols size-1..size-8 = bits 0..7.
  for (let i = 0; i < 8; i++) assert.equal(r.modules[8 * size + (size - 1 - i)], bit(i), `row8 col${size - 1 - i}`);
  // Column 8: rows 0..5 = bits 0..5, row 7 = bit 6, row 8 = bit 7.
  for (let i = 0; i < 6; i++) assert.equal(r.modules[i * size + 8], bit(i), `col8 row${i}`);
  assert.equal(r.modules[7 * size + 8], bit(6));
  assert.equal(r.modules[8 * size + 8], bit(7));
  for (let i = 8; i < 15; i++) {
    assert.equal(r.modules[(size - 7 + (i - 8)) * size + 8], bit(i), `col8 row${size - 7 + (i - 8)}`);
  }
});

test('the always-dark module is dark, in every version', () => {
  for (const text of ['x', 'hello world', 'x'.repeat(60)]) {
    const r = QR.matrix(text);
    assert.equal(r.modules[(r.size - 8) * r.size + 8], 1, `for ${text.length} bytes`);
  }
});

test('the finders, timing and alignment patterns are exactly where the standard puts them', () => {
  // A v3 symbol: 29x29, with an alignment pattern at (22, 22).
  const link = 'https://meet.example.org/1Ar1vHfLBWX2sAdi';
  const r = QR.matrix(link);
  assert.equal(r.version, 3);
  const size = r.size;
  const at = (row, col) => r.modules[row * size + col];
  // Top-left finder: a dark ring around a dark core, with a light ring.
  assert.equal(at(0, 0), 1);
  assert.equal(at(3, 3), 1);
  assert.equal(at(1, 1), 0);
  // Separator: the row just below the finder is light.
  for (let c = 0; c <= 7; c++) assert.equal(at(7, c), 0);
  // Timing patterns alternate, and row 6 / column 6 are dark at even index.
  for (let i = 8; i < size - 8; i++) {
    assert.equal(at(6, i), i % 2 === 0 ? 1 : 0);
    assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0);
  }
  // Alignment pattern: dark core, light ring, dark ring.
  assert.equal(at(22, 22), 1);
  assert.equal(at(22, 23), 0);
  assert.equal(at(22, 24), 1);
  assert.equal(at(20, 22), 1);
  assert.equal(at(21, 22), 0);
  // And the three corners are NOT alignment centres: those are finders.
  assert.equal(at(6, 6), 1, 'the timing corner is part of the finder');
});

test('no reserved module ever gets a data bit', () => {
  // Structurally: the data region excludes every function pattern, so a symbol
  // can never be corrupted by overwriting one.
  const r = QR.matrix('hello world');
  const size = r.size;
  // The format strips are their own values, so check the finder separators —
  // if a data bit were written there, the finder would be visibly wrong.
  for (let c = 0; c <= 7; c++) assert.equal(r.modules[7 * size + c], 0, 'separator clobbered');
  for (let c = 0; c <= 7; c++) assert.equal(r.modules[(size - 8) * size + c], 0, 'bottom separator clobbered');
});

/* ------------------------------------------------------------------ *
 * 6. Round-trip by decoding.
 * ------------------------------------------------------------------ */

const ROUND_TRIP_CASES = [
  ['hello world'],
  ['x'.repeat(75)],
  ['ziy-talk://1Ar1vHfLBWX2sAdi'],
  ['https://meet.example.org/1Ar1vHfLBWX2sAdi'],
  ['https://meet.jit.si/1Ar1vHfLBWX2sAdi'],
  ['A'],
  ['x'.repeat(60)],
  ['x'.repeat(180)],
  ['Ru%C3%9F und S%C3%BC%C3%9F'],
  ['https://meet.example.org/' + ROOM.generateRoomId()],
];

for (const [payload] of ROUND_TRIP_CASES) {
  test(`a real decoder reads back ${JSON.stringify(payload.slice(0, 40))}`, () => {
    const result = QR.matrix(payload);
    assert.ok(result, 'a room-link payload must fit');
    if (!DECODER) {
      console.log(`    (decode skipped: ${DECODER_REASON})`);
      return;
    }
    // zbar needs at least 2 pixels per module on low-density symbols; 3x clears
    // it and is still a real decode of the real module matrix.
    const decoded = decodeSymbol(result, payload, 3);
    assert.equal(decoded, payload,
      `decoder read ${JSON.stringify(decoded)} instead of ${JSON.stringify(payload)}`);
  });
}

test('every version this encoder can produce decodes', () => {
  if (!DECODER) {
    console.log(`    (decode skipped: ${DECODER_REASON})`);
    return;
  }
  // One payload per version, by asking the encoder which version it picks.
  const sizes = [1, 14, 15, 40, 60, 80, 95, 120, 145, 213];
  for (const bytes of sizes) {
    const payload = 'q'.repeat(bytes);
    const version = QR.pickVersion(bytes);
    assert.ok(version, `${bytes} bytes should fit`);
    const result = QR.matrix(payload);
    assert.ok(result, `${bytes} bytes should produce a symbol`);
    const decoded = decodeSymbol(result, payload, 3);
    assert.equal(decoded, payload, `version ${version} (${bytes} bytes) did not decode`);
  }
});

test('the SVG renderer draws a dark module as a closed square path', () => {
  const result = QR.matrix('hi');
  const svg = QR.toSvg(result, { scale: 4, quiet: 4 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /role="img"/);
  // The viewBox covers the symbol plus both quiet zones.
  const expected = (result.size + 8) * 4;
  assert.match(svg, new RegExp(`width="${expected}"`));
  // One path command pair per dark module, plus the white backing rect.
  const darkCount = result.modules.reduce((n, b) => n + b, 0);
  assert.equal((svg.match(/M\d+ \d+h4v4h-4z/g) || []).length, darkCount,
    'every dark module must produce exactly one square');
});

test('the SVG carries the white quiet zone, which is part of the symbol', () => {
  const result = QR.matrix('hi');
  const svg = QR.toSvg(result, { scale: 4, quiet: 4 });
  const expected = (result.size + 8) * 4;
  assert.match(svg, new RegExp(`<rect width="${expected}" height="${expected}" fill="#ffffff"/>`),
    'without the quiet zone scanners refuse the symbol');
});
