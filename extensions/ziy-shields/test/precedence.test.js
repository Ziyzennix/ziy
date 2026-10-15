/* Ziy shields — the precedence resolver tests (architecture §5.3).
 *
 * The matrix that matters, all of it exercised:
 *   global only                        -> everything inherits global
 *   global + a per-site override       -> the override wins, absolutely
 *   global + a tri-state sub-toggle    -> 'global' inherits, 'on'/'off' override
 *   a LATER global change              -> does NOT rewrite the per-site rule
 *   session override                   -> beats the per-site rule for that visit
 *   fingerprinting master switch off    -> sub-toggle values are irrelevant
 *   the granularOverrides serialisation  -> a JSON array of objects, never a
 *                                           bare string (proofs-shell §1.6)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../lib/engine/precedence.js');

const GLOBAL = Object.freeze({
  adsTrackers: 'standard',
  httpsUpgrade: 'auto',
  scripts: 'block',
  cookies: 'block_3p',
  fingerprinting: true,
  fpSub: 'global',
  fpCanvas: 'global', fpFont: 'global', fpLanguage: 'global',
  fpHardware: 'global', fpScreen: 'global', fpKeyboard: 'global',
  forgetMeOnClose: false,
  enabled: true,
});

/* ------------------------------------------------------------------ *
 * The §5.3 truth table, cell by cell.
 *
 * These are the cells the product is defined by. Each one states the input and
 * the expected (value, layer) so a regression names the cell it broke.
 * ------------------------------------------------------------------ */

const G = Object.freeze({
  adsTrackers: 'standard', httpsUpgrade: 'auto', scripts: 'block',
  cookies: 'block_3p', fingerprinting: true,
  fpSub: 'global',
  fpCanvas: 'global', fpFont: 'global', fpLanguage: 'global',
  fpHardware: 'global', fpScreen: 'global', fpKeyboard: 'global',
  forgetMeOnClose: false, enabled: true,
});

function res(siteRule, globalRule, session) {
  return P.resolve({ globalRule: globalRule || G, siteRule: siteRule || null, session: session || null });
}

/* --- cell 4: no layer mentions the row -> the factory default --------------- */
test('truth table cell 4: an empty global record resolves every row to the factory default', () => {
  const { rule, layers } = res(null, {});
  assert.equal(rule.adsTrackers, P.FACTORY.adsTrackers);
  assert.equal(rule.httpsUpgrade, P.FACTORY.httpsUpgrade);
  assert.equal(rule.scripts, P.FACTORY.scripts);
  assert.equal(rule.cookies, P.FACTORY.cookies);
  assert.equal(rule.fingerprinting, P.FACTORY.fingerprinting);
  assert.equal(rule.forgetMeOnClose, P.FACTORY.forgetMeOnClose);
  for (const key of ['adsTrackers', 'httpsUpgrade', 'scripts', 'cookies']) {
    assert.equal(layers[key], 'global', `${key} came from the global (factory-filled) layer`);
  }
});

test('truth table cell 4: a global row set to a non-factory value is used', () => {
  assert.equal(res(null, { ...G, scripts: 'allow' }).rule.scripts, 'allow');
  assert.equal(res(null, { ...G, cookies: 'allow_all' }).rule.cookies, 'allow_all');
});

/* --- cell 3: the global record alone ---------------------------------------- */
test('truth table cell 3: global aggressive with no site gives aggressive at the global layer', () => {
  const { rule, layers } = res(null, { ...G, adsTrackers: 'aggressive' });
  assert.equal(rule.adsTrackers, 'aggressive');
  assert.equal(layers.adsTrackers, 'global');
});

test('truth table cell 3: global https strict propagates', () => {
  const { rule, layers } = res(null, { ...G, httpsUpgrade: 'strict' });
  assert.equal(rule.httpsUpgrade, 'strict');
  assert.equal(layers.httpsUpgrade, 'global');
});

/* --- cell 2: the per-site record is ABSOLUTE -------------------------------- */
test('truth table cell 2: global aggressive + site absolute standard -> standard', () => {
  const stored = P.compactRule({ adsTrackers: 'standard' });
  const { rule, layers } = res(stored, { ...G, adsTrackers: 'aggressive' });
  assert.equal(rule.adsTrackers, 'standard');
  assert.equal(layers.adsTrackers, 'site');
});

test('truth table cell 2: global standard + site absolute aggressive -> aggressive', () => {
  const stored = P.compactRule({ adsTrackers: 'aggressive' });
  const { rule, layers } = res(stored, G);
  assert.equal(rule.adsTrackers, 'aggressive');
  assert.equal(layers.adsTrackers, 'site');
});

test('truth table cell 2 (the never-rewritten rule): flip global afterwards and the site MUST stay put', () => {
  const stored = P.compactRule({ adsTrackers: 'standard' });
  const { rule } = res(stored, { ...G, adsTrackers: 'aggressive' });
  assert.equal(rule.adsTrackers, 'standard');

  // The global default changes again, after the override was stored.
  const later = res(stored, { ...G, adsTrackers: 'standard' });
  assert.equal(later.rule.adsTrackers, 'standard');
  assert.equal(later.layers.adsTrackers, 'site', 'still the site layer');

  // And the reverse direction: a site that chose aggressive while global was
  // aggressive keeps aggressive when global moves back to standard.
  const aggressiveSite = P.compactRule({ adsTrackers: 'aggressive' });
  const moved = res(aggressiveSite, G);
  assert.equal(moved.rule.adsTrackers, 'aggressive');
  assert.equal(moved.layers.adsTrackers, 'site');
});

test('truth table cell 2 covers every row: a site may override any row', () => {
  const cases = [
    ['adsTrackers', 'off', 'aggressive'],
    ['httpsUpgrade', 'off', 'strict'],
    ['scripts', 'allow', 'block'],
    ['cookies', 'allow_all', 'block_all'],
    ['forgetMeOnClose', true, false],
  ];
  for (const [key, chosen, globalValue] of cases) {
    const stored = P.compactRule({ [key]: chosen });
    const { rule, layers } = res(stored, { ...G, [key]: globalValue });
    assert.equal(rule[key], chosen, `${key}: the site's choice wins`);
    assert.equal(layers[key], 'site', `${key}: layer is site`);
  }
});

/* --- cell 1: a session override ------------------------------------------- */
test('truth table cell 1: a session value beats an absolute per-site value', () => {
  const stored = P.compactRule({ scripts: 'allow' });
  const { rule, layers } = res(stored, G, { scripts: 'block' });
  assert.equal(rule.scripts, 'block');
  assert.equal(layers.scripts, 'session');
});

test('truth table cell 1: a session Shields-down beats a site that chose up', () => {
  const { rule, provenance } = res(P.compactRule({ enabled: true }), G, { enabled: false });
  assert.equal(rule.enabled, false);
  assert.equal(provenance.enabled, 'session');
});

test('truth table cell 1: a session override never writes into the stored record', () => {
  const stored = P.compactRule({ scripts: 'allow' });
  res(stored, G, { scripts: 'block' });
  assert.equal(stored.scripts, 'allow', 'the stored record is untouched by a session override');
});

/* --- cells 2 and 3 together: an unchosen row inherits ---------------------- */
test('truth table cells 2+3: one chosen row, every other row follows global', () => {
  const stored = P.compactRule({ scripts: 'allow' });
  const globalWithChanges = {
    ...G, adsTrackers: 'aggressive', cookies: 'block_all', httpsUpgrade: 'strict',
  };
  const { rule, layers } = res(stored, globalWithChanges);
  assert.equal(rule.scripts, 'allow');
  assert.equal(layers.scripts, 'site');
  assert.equal(rule.adsTrackers, 'aggressive');
  assert.equal(layers.adsTrackers, 'global');
  assert.equal(rule.cookies, 'block_all');
  assert.equal(rule.httpsUpgrade, 'strict');
  // The stored record still holds only the user's choice.
  assert.equal(stored.adsTrackers, undefined);
});

test('truth table cells 2+3 with an EMPTY global: unchosen rows fall to the factory default', () => {
  const stored = P.compactRule({ scripts: 'allow' });
  const { rule } = res(stored, {});
  assert.equal(rule.scripts, 'allow');
  assert.equal(rule.adsTrackers, P.FACTORY.adsTrackers);
  assert.equal(rule.cookies, P.FACTORY.cookies);
});

/* --- the fingerprinting sub-toggle tri-state table -------------------------- */
test('truth table sub 4: a global sub of global + master on -> the target is protected', () => {
  const { rule } = res(null, G);
  assert.equal(rule.fingerprinting, true);
  assert.equal(rule.fpSub.fpCanvas.value, 'on', "an inheriting sub follows the master switch");
  assert.equal(rule.fpSub.fpCanvas.layer, 'master');
});

test('truth table sub 4: a global sub of global + master OFF -> the target is not protected', () => {
  const { rule } = res(null, { ...G, fingerprinting: false });
  assert.equal(rule.fingerprinting, false);
  assert.equal(rule.fpSub.fpCanvas.value, 'off');
  assert.equal(rule.fpSub.fpCanvas.layer, 'master');
});

test('truth table sub 3: global sub on -> on; global sub off -> off', () => {
  assert.equal(res(null, { ...G, fpCanvas: 'on' }).rule.fpSub.fpCanvas.value, 'on');
  assert.equal(res(null, { ...G, fpCanvas: 'off' }).rule.fpSub.fpCanvas.value, 'off');
  assert.equal(res(null, { ...G, fpCanvas: 'off' }).rule.fpSub.fpCanvas.layer, 'global');
});

test('truth table sub 2: a per-site sub beats a global sub', () => {
  assert.equal(res(P.compactRule({ fpCanvas: 'off' }), { ...G, fpCanvas: 'on' }).rule.fpSub.fpCanvas.value, 'off');
  assert.equal(res(P.compactRule({ fpCanvas: 'on' }), { ...G, fpCanvas: 'off' }).rule.fpSub.fpCanvas.value, 'on');
  assert.equal(res(P.compactRule({ fpCanvas: 'off' }), { ...G, fpCanvas: 'on' }).rule.fpSub.fpCanvas.layer, 'site');
});

test('truth table sub 2: a per-site sub of global does NOT beat the global sub', () => {
  assert.equal(res(P.compactRule({ fpCanvas: 'global' }), { ...G, fpCanvas: 'on' }).rule.fpSub.fpCanvas.value, 'on');
});

test('truth table sub 1: a session sub beats both the site and the global sub', () => {
  const stored = P.compactRule({ fpCanvas: 'off' });
  const out = res(stored, { ...G, fpCanvas: 'on' }, { subs: { fpCanvas: 'on' } });
  assert.equal(out.rule.fpSub.fpCanvas.value, 'on');
  assert.equal(out.rule.fpSub.fpCanvas.layer, 'session');
});

test('truth table sub: a sub of global with no master anywhere follows the factory master', () => {
  const out = res(null, { adsTrackers: 'off' });
  assert.equal(out.rule.fingerprinting, P.FACTORY.fingerprinting);
  assert.equal(out.rule.fpSub.fpCanvas.value, 'on');
});

/* ------------------------------------------------------------------ *
 * Layer 2: per-site override wins over global
 * ------------------------------------------------------------------ */

test('a site with no override inherits every global row', () => {
  const { rule, layers } = P.resolve({ globalRule: GLOBAL, siteRule: null });
  assert.equal(rule.scripts, 'block');
  assert.equal(rule.adsTrackers, 'standard');
  assert.equal(rule.httpsUpgrade, 'auto');
  assert.equal(rule.cookies, 'block_3p');
  assert.equal(rule.fingerprinting, true);
  for (const row of P.ROWS) {
    if (row.key === 'fingerprinting') continue;
    assert.equal(layers[row.key], 'global', `${row.key} came from the global layer`);
  }
});

test('a per-site override beats the global default for exactly one row', () => {
  const { rule, layers } = P.resolve({
    globalRule: GLOBAL,
    siteRule: P.compactRule({ scripts: 'allow' }),
  });
  assert.equal(rule.scripts, 'allow');
  assert.equal(layers.scripts, 'site');
  // and nothing else moved
  assert.equal(rule.adsTrackers, 'standard');
  assert.equal(layers.adsTrackers, 'global');
});

test('a per-site rule is ABSOLUTE: a chosen row never moves, an unchosen one inherits', () => {
  // This is the recon's rule that matters most: the stored record must hold the
  // user's own choices only, so that (a) a chosen row can never be rewritten by
  // a later global change and (b) an unchosen row still inherits rather than
  // freezing the value global happened to have on the day.
  const stored = P.compactRule({ scripts: 'allow' });
  assert.equal(stored.scripts, 'allow');
  assert.equal(stored.adsTrackers, undefined, 'an unchosen row is absent, not frozen');
  assert.equal(stored.cookies, undefined);

  // Now change the GLOBAL default for the rows the site never chose.
  const newGlobal = { ...GLOBAL, adsTrackers: 'aggressive', cookies: 'block_all', httpsUpgrade: 'strict' };
  const { rule, layers } = P.resolve({ globalRule: newGlobal, siteRule: stored });
  // The site's chosen row still holds, and it is still marked 'site'.
  assert.equal(rule.scripts, 'allow');
  assert.equal(layers.scripts, 'site');
  // Unchosen rows follow the NEW global: inheritance, not rewriting.
  assert.equal(rule.adsTrackers, 'aggressive');
  assert.equal(rule.cookies, 'block_all');
  assert.equal(rule.httpsUpgrade, 'strict');
  assert.equal(layers.adsTrackers, 'global');
  // The stored record itself was not mutated by resolving against a new global.
  assert.equal(stored.adsTrackers, undefined);
  assert.equal(stored.scripts, 'allow');
});

test('normaliseRule with a factory fill gives a chosen row the factory default', () => {
  // The EXPANDED form is what a read that needs every field works with.
  const expanded = P.normaliseRule({ scripts: 'allow' }, 'factory');
  assert.equal(expanded.scripts, 'allow');
  assert.equal(expanded.adsTrackers, P.FACTORY.adsTrackers);
  assert.equal(expanded.cookies, P.FACTORY.cookies);
});

test('a stored per-site rule never gains fields when the global changes', () => {
  const stored = P.compactRule({ scripts: 'allow' });
  const keysBefore = Object.keys(stored).sort().join(',');
  P.resolve({ globalRule: { ...GLOBAL, scripts: 'block', cookies: 'allow_all' }, siteRule: stored });
  assert.equal(Object.keys(stored).sort().join(','), keysBefore,
    'resolving against a new global must not write into the stored record');
  assert.equal(stored.cookies, undefined);
});

test('an aggressive site override is preserved across a global switch to standard', () => {
  const stored = P.compactRule({ adsTrackers: 'aggressive' });
  const { rule } = P.resolve({ globalRule: { ...GLOBAL, adsTrackers: 'standard' }, siteRule: stored });
  assert.equal(rule.adsTrackers, 'aggressive');
});

/* ------------------------------------------------------------------ *
 * Layer 1: session override
 * ------------------------------------------------------------------ */

test('a session Shields-down beats a per-site Shields-up record', () => {
  const { rule, provenance } = P.resolve({
    globalRule: GLOBAL,
    siteRule: P.compactRule({ enabled: true }),
    session: { enabled: false },
  });
  assert.equal(rule.enabled, false);
  assert.equal(provenance.enabled, 'session');
});

test('a site that chose Shields down stays down without a session override', () => {
  const { rule, provenance } = P.resolve({
    globalRule: GLOBAL,
    siteRule: P.compactRule({ enabled: false }),
  });
  assert.equal(rule.enabled, false);
  assert.equal(provenance.enabled, 'site');
});

test('a session script-allow beats the global block', () => {
  const { rule, layers } = P.resolve({
    globalRule: GLOBAL,
    siteRule: null,
    session: { scripts: 'allow' },
  });
  assert.equal(rule.scripts, 'allow');
  assert.equal(layers.scripts, 'session');
});

test('a session cookie setting wins', () => {
  const { rule, layers } = P.resolve({
    globalRule: GLOBAL,
    siteRule: null,
    session: { cookies: 'allow_all' },
  });
  assert.equal(rule.cookies, 'allow_all');
  assert.equal(layers.cookies, 'session');
});

/* ------------------------------------------------------------------ *
 * Layer 3: tri-state sub-toggles
 * ------------------------------------------------------------------ */

test("a sub-toggle of 'global' inherits the global sub-toggle", () => {
  const globalWithSubs = { ...GLOBAL, fpCanvas: 'on' };
  const { rule } = P.resolve({ globalRule: globalWithSubs, siteRule: null });
  assert.equal(rule.fpSub.fpCanvas.value, 'on');
  assert.equal(rule.fpSub.fpCanvas.layer, 'global');
});

test("a sub-toggle of 'off' on the site beats a global 'on'", () => {
  const site = P.compactRule({ fingerprinting: true, fpCanvas: 'off' });
  const { rule } = P.resolve({ globalRule: { ...GLOBAL, fpCanvas: 'on' }, siteRule: site });
  assert.equal(rule.fpSub.fpCanvas.value, 'off');
  assert.equal(rule.fpSub.fpCanvas.layer, 'site');
  // and the subs the site never chose inherit the master switch, which is on.
  assert.equal(rule.fpSub.fpFont.value, 'on', 'an unset sub inherits the master switch');
  assert.equal(rule.fpSub.fpFont.layer, 'master');
});

test("a sub-toggle of 'on' on the site beats a global 'global'", () => {
  const site = P.compactRule({ fpKeyboard: 'on' });
  const { rule } = P.resolve({ globalRule: GLOBAL, siteRule: site });
  assert.equal(rule.fpSub.fpKeyboard.value, 'on');
  assert.equal(rule.fpSub.fpKeyboard.layer, 'site');
});

test('a session sub-toggle beats both site and global', () => {
  const site = P.compactRule({ fpScreen: 'off' });
  const { rule } = P.resolve({
    globalRule: { ...GLOBAL, fpScreen: 'on' },
    siteRule: site,
    session: { subs: { fpScreen: 'on' } },
  });
  assert.equal(rule.fpSub.fpScreen.value, 'on');
  assert.equal(rule.fpSub.fpScreen.layer, 'session');
});

/* ------------------------------------------------------------------ *
 * Fingerprinting master switch
 * ------------------------------------------------------------------ */

test('a site with the fingerprinting master off wins over a global on', () => {
  const site = P.compactRule({ fingerprinting: false });
  const { rule, layers } = P.resolve({ globalRule: { ...GLOBAL, fingerprinting: true }, siteRule: site });
  assert.equal(rule.fingerprinting, false);
  assert.equal(layers.fingerprinting, 'site');
});

test('the fingerprinting master off does not lose the sub-toggle state', () => {
  // The sub-toggle record is independent of the master switch; the UI keeps it
  // so turning the master back on restores what the user chose.
  const site = P.compactRule({ fingerprinting: false, fpCanvas: 'off' });
  const { rule } = P.resolve({ globalRule: GLOBAL, siteRule: site });
  assert.equal(rule.fingerprinting, false);
  assert.equal(rule.fpSub.fpCanvas.value, 'off');
});

/* ------------------------------------------------------------------ *
 * granularOverrides: the value shape the shell's service requires
 * ------------------------------------------------------------------ */

test('granularOverrides serialises to a JSON ARRAY of objects, not a string', () => {
  const entries = [
    { firstPartyDomain: '*', overrides: '+AllTargets,-CSSPrefersColorScheme' },
  ];
  const json = P.serialiseGranularOverrides(entries);
  // The parse-proof from proofs-shell §1.6: the engine does JSON.parse(pref)
  // and validates the result against a schema that requires the array.
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed), 'the pref value must be a JSON array');
  assert.equal(parsed[0].firstPartyDomain, '*');
  assert.ok(/^[+-][A-Za-z]+(?:,[+-][A-Za-z]+)*$/.test(parsed[0].overrides),
    'the inner value is the bare RFP target string');
});

test('a granular override entry for a site with one sub-toggle off', () => {
  const entry = P.buildGranularOverride('example.com', true, [['fpCanvas', 'off']]);
  assert.equal(entry.firstPartyDomain, 'example.com');
  assert.match(entry.overrides, /^\+AllTargets,-CSSPrefersColorScheme,-CanvasRandomization$/);
});

test('a granular override with every sub-toggle off lists every target', () => {
  const subs = P.FP_SUBTOGGLES.map(k => [k, 'off']);
  const entry = P.buildGranularOverride('a.example', true, subs);
  for (const target of Object.values(P.FP_TARGETS)) {
    assert.ok(entry.overrides.includes('-' + target), `${target} is excluded`);
  }
});

test('the fingerprinting master off produces NO granular override entry', () => {
  // Turning the master off is not a target string; it is the absence of one.
  const entry = P.buildGranularOverride('a.example', false, [['fpCanvas', 'off']]);
  assert.equal(entry, null);
});

test('a buildGranularOverride for a site with no sub-toggle off is the baseline', () => {
  const entry = P.buildGranularOverride('a.example', true, [['fpCanvas', 'on']]);
  assert.equal(entry.overrides, '+AllTargets,-CSSPrefersColorScheme');
});

/* ------------------------------------------------------------------ *
 * Domain validity
 * ------------------------------------------------------------------ */

test('isDomain accepts and rejects what the store should accept and reject', () => {
  for (const good of ['example.com', 'a.b.example.co.uk', 'localhost', '127.0.0.1']) {
    assert.equal(P.isDomain(good), true, good);
  }
  for (const bad of ['', 'not a domain', '-x.com', 'a..b', 'a b.com']) {
    assert.equal(P.isDomain(bad), false, String(bad));
  }
});

test('siteKey is namespaced per domain', () => {
  assert.equal(P.siteKey('example.com'), 'shields.site.example.com');
});

/* ------------------------------------------------------------------ *
 * normalisation
 * ------------------------------------------------------------------ */

test('normaliseRule fills missing rows from the factory default', () => {
  const r = P.normaliseRule({}, 'factory');
  for (const key of Object.keys(P.FACTORY)) {
    assert.deepEqual(r[key], P.FACTORY[key], key);
  }
});

test('normaliseRule with a bad enum value falls back to the factory value', () => {
  const r = P.normaliseRule({ adsTrackers: 'turn-it-up-to-eleven' }, 'factory');
  assert.equal(r.adsTrackers, P.FACTORY.adsTrackers);
});

test('normaliseRule treats true/false as on/off for sub-toggles', () => {
  const r = P.normaliseRule({ fpCanvas: true, fpFont: false, fpKeyboard: 'on' }, 'factory');
  assert.equal(r.fpCanvas, 'on');
  assert.equal(r.fpKeyboard, 'on');
});

test('the factory default itself satisfies the recon starting state', () => {
  assert.deepEqual(P.FACTORY.adsTrackers, 'standard', 'Standard mode is the factory default');
  assert.equal(P.FACTORY.httpsUpgrade, 'auto');
  assert.equal(P.FACTORY.scripts, 'block');
  assert.equal(P.FACTORY.cookies, 'block_3p');
  assert.equal(P.FACTORY.fingerprinting, true, 'fingerprint protection is on by default');
  assert.equal(P.FACTORY.enabled, true);
});
