/* Ziy shields — the alignment with replica/re-deep-shields.md.
 *
 * The source records Brave's own Shields vocabulary precisely. Ziy's row names
 * are its own (they are the panel's labels and the storage keys), so the point
 * of these tests is not to copy their names — it is to prove the SHAPE matches
 * and that the mapping table is honest:
 *
 *   - every Ziy row has a source row and a source value enum,
 *   - the ads row maps to TWO source settings, which is why the row is
 *     three-valued and not a toggle,
 *   - the 19 farbling targets are present and each maps to an RFP target or to
 *     null (never to a made-up name the engine's schema would reject),
 *   - the granularOverride target string is built from the mapped names only.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../lib/engine/precedence.js');
const A = require('../lib/engine/alignment.js');

test('every Ziy row has an entry in the alignment table', () => {
  for (const row of P.ROWS) {
    const entry = A.ROW_ALIGNMENT[row.key];
    assert.ok(entry, `no alignment entry for the row ${row.key}`);
    assert.ok(entry.source && entry.source.length > 0, `${row.key} names its source`);
    assert.ok(entry.sourceValue && entry.sourceValue.length > 0, `${row.key} names its source values`);
    assert.ok(entry.note && entry.note.length > 0, `${row.key} carries the note`);
  }
});

test('the alignment table covers no row Ziy does not have', () => {
  // `enabled` is the Shields-up row: it is not in ROWS (which lists the
  // protection rows the panel renders) but it is a real resolved row, so the
  // table may contain it and only it beyond ROWS' keys.
  const own = new Set(P.ROWS.map(r => r.key).concat('enabled'));
  for (const key of Object.keys(A.ROW_ALIGNMENT)) {
    assert.ok(own.has(key), `alignment table has an unused row ${key}`);
  }
});

test('the ads row aligns to TWO source settings, which is why it is three-valued', () => {
  const entry = A.ROW_ALIGNMENT.adsTrackers;
  // One row, two settings in the source: the block/allow one and the cosmetic one.
  assert.match(entry.source, /shieldsAds/);
  assert.match(entry.source, /trackers/);
  assert.match(entry.source, /cosmeticFilteringV2/);
  assert.match(entry.sourceValue, /AGGRESSIVE/);
  assert.match(entry.sourceValue, /STANDARD/);
  assert.match(entry.sourceValue, /ALLOW/);
  // The note records that the mode selects the LIST, not a row flag.
  assert.match(entry.note, /list/i);
});

test('the row value enums align position for position with Ziy\'s', () => {
  assert.deepEqual(A.ROW_ALIGNMENT.scripts.sourceValue.split(' | '), ['allow', 'block']);
  // The names live inside a "CookieBlockMode {A, B, C}" wrapper, so match the
  // ALL-CAPS run inside the braces rather than the whole string.
  const enumOf = (row) => row.sourceValue.match(/\{([^}]*)\}/)[1]
    .split(',').map(s => s.trim());
  assert.deepEqual(enumOf(A.ROW_ALIGNMENT.cookies),
    ['CROSS_SITE_BLOCKED', 'BLOCKED', 'ALLOW']);
  assert.deepEqual(enumOf(A.ROW_ALIGNMENT.httpsUpgrade),
    ['STRICT_MODE', 'STANDARD_MODE', 'DISABLED_MODE']);
});

test('the 19 farbling targets are all present, in the source\'s order', () => {
  assert.equal(A.FARBLING_TARGETS.length, 19);
  for (const t of A.FARBLING_TARGETS) {
    assert.ok(t.key && t.source && t.label, 'each target has a key, source name and label');
    assert.ok(t.balanced && t.maximum, 'each target records both behaviour levels');
  }
  // The sentinel is last and is the source's "global default level".
  assert.equal(A.FARBLING_TARGETS[18].key, 'fpSentinel');
  assert.match(A.FARBLING_TARGETS[18].source, /brave-webcompat-none/);
});

test('every farbling target maps to an RFP target or to null, never to a guess', () => {
  const mapped = A.FARBLING_TARGETS.filter(t => t.rfpTarget !== null);
  const unmapped = A.FARBLING_TARGETS.filter(t => t.rfpTarget === null);
  // The ones Gecko cannot express are the pool-budget mechanisms and the USB
  // serial (engine work in the source, and DNR/RFP have no counterpart).
  const unmappedKeys = unmapped.map(t => t.key);
  for (const k of ['fpEventSourcePool', 'fpWebSocketsPool', 'fpUsbSerial', 'fpSentinel']) {
    assert.ok(unmappedKeys.includes(k), `${k} is correctly unmapped`);
  }
  for (const t of mapped) {
    // An RFP target name is CamelCase letters and digits only.
    assert.match(t.rfpTarget, /^[A-Za-z][A-Za-z0-9]*$/, `${t.key} -> ${t.rfpTarget}`);
    assert.ok(A.FP_KEY_TO_TARGET[t.key] === t.rfpTarget);
  }
});

test('the sub-toggle keys are exactly the 19 targets', () => {
  assert.equal(P.FP_SUBTOGGLES.length, 19);
  assert.deepEqual([...P.FP_SUBTOGGLES].sort(), [...A.FP_SUBTOGGLE_SOURCES].sort());
});

test('Ziy\'s own key names are used, not the source\'s setting names', () => {
  // The point of the alignment table: internal vocabulary stays ours.
  for (const key of P.FP_SUBTOGGLES) {
    assert.ok(key.startsWith('fp'), `${key} is Ziy's key shape`);
    assert.ok(!key.startsWith('brave-webcompat-'), `${key} must not be the source setting name`);
  }
  assert.ok(!('fpCanvas' in A.ROW_ALIGNMENT), 'the alignment table is rows, not targets');
});

test('the granularOverride string uses the mapped RFP names only', () => {
  const subs = [['fpCanvas', 'off'], ['fpUserAgent', 'off'], ['fpLanguage', 'off']];
  const entry = P.buildGranularOverride('a.example', true, subs);
  assert.equal(entry.firstPartyDomain, 'a.example');
  // The target string always starts with the baseline
  // '+AllTargets,-CSSPrefersColorScheme'; the exclusions that follow it come
  // only from the sub-toggles.
  const names = entry.overrides.split(',')
    .filter(p => p.startsWith('-') && p !== '-CSSPrefersColorScheme');
  assert.equal(names.length, 3, 'one exclusion per sub-toggle that is off');
  for (const name of names) {
    const target = name.slice(1);
    assert.ok(Object.values(A.FP_KEY_TO_TARGET).includes(target),
      `${target} is a mapped RFP target, not an invented name`);
  }
});

test('a sub-toggle with no RFP counterpart contributes nothing to the string', () => {
  // The pool-budget mechanisms have no Gecko counterpart; writing a name the
  // engine's JSON schema would reject is worse than omitting the target.
  const entry = P.buildGranularOverride('a.example', true, [
    ['fpEventSourcePool', 'off'], ['fpCanvas', 'off'],
  ]);
  const names = entry.overrides.split(',')
    .filter(p => p.startsWith('-') && p !== '-CSSPrefersColorScheme');
  assert.equal(names.length, 1, 'only the expressible target is named');
});

test('a granularOverride for all 19 toggles lists every expressible target', () => {
  const subs = P.FP_SUBTOGGLES.map(k => [k, 'off']);
  const entry = P.buildGranularOverride('a.example', true, subs);
  const excluded = new Set(entry.overrides.split(',')
    .filter(p => p.startsWith('-') && p !== '-CSSPrefersColorScheme').map(p => p.slice(1)));
  const expected = new Set(Object.values(A.FP_KEY_TO_TARGET));
  assert.deepEqual([...excluded].sort(), [...expected].sort(),
    'exactly the mapped targets appear, and no others');
});

test('the fingerprinting row keeps its compound shape after the expansion', () => {
  const row = P.ROWS.find(r => r.key === 'fingerprinting');
  assert.ok(Array.isArray(row.subToggles));
  assert.equal(row.subToggles.length, 19);
  assert.ok(row.subToggles.every(k => P.FP_SUBTOGGLES.includes(k)));
});
