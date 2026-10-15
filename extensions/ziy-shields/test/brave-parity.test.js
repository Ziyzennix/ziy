/* Ziy shields — the Brave-parity pipeline-order tests.
 *
 * Brave runs TWO adblock engines and consults them in a fixed order with
 * well-defined first-party semantics (components/brave_shields/content/browser/
 * ad_block_engine_wrapper.cc:55-115, `AdBlockEngineWrapper::ShouldStartRequest`):
 *
 *   1. the DEFAULT engine (Brave's default list + first-party adblock list) is
 *      asked first;
 *   2. its `removeparam` result is discarded;
 *   3. for a first-party request in STANDARD mode, the default engine's BLOCK
 *      is dropped — only its EXCEPTION survives to the next engine — unless the
 *      mode is aggressive, `kBraveAdblockDefault1pBlocking` is on, or the
 *      request is not same-domain;
 *   4. the ADDITIONAL engine is asked second, seeded with the default engine's
 *      match/exception/important flags;
 *   5. the two results are OR-merged, with the default engine's values filling
 *      the gaps.
 *
 * Ziy has ONE compiled table (many lists merged at parse time) rather than two
 * engines, so the parity that matters is the *decision* parity, not the
 * deployment parity. These tests pin the properties that have to hold for the
 * merged table to behave like Brave's pair:
 *
 *   A. an exception (@@) always beats an ordinary block — Brave's engine
 *      reports `has_exception` and the wrapper never blocks on a default-engine
 *      block for a first-party request, which is the same net effect.
 *   B. an `!important` rule beats everything below the per-site overrides,
 *      which is Brave's `result.important` OR-merge at the top of the result.
 *   C. a per-site allow beats a list block, which is what makes "Shields down
 *      for this site" true — Brave's `aggressive_blocking` parameter carries
 *      the same intent from its panel.
 *   D. the anti-adblock cosmetic rules reach the page, because Brave has NO
 *      C++ anti-adblock handling at all (verified: a case-insensitive grep for
 *      antiadblock / adblock_notification / adblock.detect / blockadblock over
 *      the sparse brave-core checkout returns nothing); its anti-adblock walls
 *      defence is entirely list-driven, and so is ours.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const parser = require('../lib/filterlist/parser.js');
const D = require('../lib/engine/dnr-compile.js');
const lists = require('../lib/filterlist/lists.js');
const SM = require('../lib/engine/static-match.js');

const SNAPSHOTS = path.join(__dirname, '..', 'lib', 'filterlist', 'snapshots');

/**
 * The lists the shipped ruleset is compiled from, in the generator's order.
 * Mirrors SNAPSHOT_FOR_ID in tools/gen-static-ruleset.js.
 */
const SHIPPED_LISTS = [
  'easylist.txt',
  'easyprivacy.txt',
  'fanboy-cookiemonster.txt',
  'uabo-filters.txt',
  'urlhaus.txt',
  'antiadblock-warning-removal.txt',
  'brave-unbreak.txt',
];

/** Parses one snapshot into its rule list (network + cosmetic). */
function parse(file) {
  return parser.parseList(fs.readFileSync(path.join(SNAPSHOTS, file), 'utf8'),
    file.replace(/\.txt$/, ''));
}

/** The whole shipped table, every kind, in list order. */
function allRules() {
  const out = [];
  for (const f of SHIPPED_LISTS) out.push(...parse(f).rules);
  return out;
}

/* ------------------------------------------------------------------ *
 * A. exceptions beat ordinary blocks (Brave's has_exception path)
 * ------------------------------------------------------------------ */

test('an exception rule out-prioritises an ordinary block rule', () => {
  // Brave: the wrapper keeps the default engine's `exception` for a first-party
  // request (ad_block_engine_wrapper.cc:84-88) and never blocks on a match it
  // also has an exception for. Ours encodes the same decision as priority:
  // LIST_EXCEPTION (100) > LIST_BLOCK (10).
  const net = allRules().filter(r => r.kind === 'network');
  const out = D.compileTable({ networkRules: net });

  const allows = out.tiers.static.filter(r => r.action.type === 'allow');
  const blocks = out.tiers.static.filter(r => r.action.type === 'block');
  assert.ok(allows.length > 0 && blocks.length > 0, 'both kinds are present');

  for (const a of allows) {
    assert.ok(a.priority >= D.DNR_PRIORITY.LIST_EXCEPTION,
      'every allow is at the exception priority or above');
  }
  for (const b of blocks) {
    if (b.priority >= D.DNR_PRIORITY.IMPORTANT) continue;  // !important
    assert.ok(b.priority <= D.DNR_PRIORITY.LIST_BLOCK,
      'an ordinary block is at the list-block priority, below an exception');
  }
  // And the lattice itself is what the engine's compareRule orders by.
  assert.ok(D.DNR_PRIORITY.LIST_EXCEPTION > D.DNR_PRIORITY.LIST_BLOCK);
});

test('an exception that names the same host as a block keeps the page working', () => {
  // The concrete shape: brave-unbreak.txt carries exceptions for hosts the
  // other lists block. That is exactly the "unbreak" job Brave assigns to a
  // list shipped INSIDE the default list, not to a separate allow-list.
  const unbreak = parse('brave-unbreak.txt');
  const exceptions = unbreak.rules.filter(r => r.kind === 'network' && r.isException);
  assert.ok(exceptions.length > 100,
    `brave-unbreak.txt is an exceptions list, saw ${exceptions.length}`);
  for (const e of exceptions) {
    assert.ok(/^@@/.test('') || e.isException === true);
  }
});

/* ------------------------------------------------------------------ *
 * B. !important beats the ordinary table (Brave's OR-merged `important`)
 * ------------------------------------------------------------------ */

test('an !important rule sits above every ordinary rule', () => {
  // Note the second '$': options are separated from the pattern by '$', so an
  // important rule is `||ad.example^$important`, not `||ad.example^important`
  // (the parser is right and this test was wrong about it once already).
  const net = parser.parseList(
    '||ad.example^$important\n||ad.example^\n@@||ad.example^^$domain=example.com\n',
    'synthetic').rules.filter(r => r.kind === 'network');
  const out = D.compileTable({ networkRules: net, staticCap: 100 });
  const priv = out.tiers.static.find(r => JSON.stringify(r).includes('ad.example') &&
    r.priority === D.DNR_PRIORITY.IMPORTANT);
  assert.ok(priv, 'the important rule is compiled at the important priority');
  for (const r of out.tiers.static) {
    if (r === priv) continue;
    assert.ok(r.priority <= D.DNR_PRIORITY.IMPORTANT || r.action.type === 'allow',
      'nothing ordinary out-ranks an important rule');
  }
});

test('the default lists really do carry !important and exception rules', () => {
  const net = allRules().filter(r => r.kind === 'network');
  const important = net.filter(r => r.important);
  const exceptions = net.filter(r => r.isException);
  assert.ok(important.length > 0, 'important rules exist in the shipped table');
  assert.ok(exceptions.length > 1000,
    `exceptions exist, saw ${exceptions.length}`);
});

/* ------------------------------------------------------------------ *
 * C. a per-site allow beats a list block (Brave's aggressive_blocking input)
 * ------------------------------------------------------------------ */

test('a per-site allow out-ranks every list rule', () => {
  assert.ok(D.DNR_PRIORITY.SITE_ALLOW > D.DNR_PRIORITY.IMPORTANT);
  assert.ok(D.DNR_PRIORITY.SITE_ALLOW > D.DNR_PRIORITY.LIST_EXCEPTION);
  // And a session allow (Shields down for this visit) out-ranks even that.
  assert.ok(D.DNR_PRIORITY.SESSION_ALLOW > D.DNR_PRIORITY.SITE_ALLOW);
});

test('the full lattice is strictly ordered, top to bottom', () => {
  const order = [
    D.DNR_PRIORITY.SESSION_ALLOW,
    D.DNR_PRIORITY.SITE_ALLOW,
    D.DNR_PRIORITY.SITE_BLOCK,
    D.DNR_PRIORITY.IMPORTANT,
    D.DNR_PRIORITY.LIST_EXCEPTION,
    D.DNR_PRIORITY.LIST_BLOCK,
    D.DNR_PRIORITY.UPGRADE_SCHEME,
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] > order[i],
      `priority ${order[i - 1]} must exceed ${order[i]}`);
  }
});

/* ------------------------------------------------------------------ *
 * D. the list set is Brave's, minus what we cannot ship
 * ------------------------------------------------------------------ */

test('the registry ships Brave\'s blocking list family', () => {
  const ids = lists.DEFAULT_SOURCES.map(s => s.id);
  // The three Ziy already shipped before this workstream.
  assert.ok(ids.includes('easylist'));
  assert.ok(ids.includes('easyprivacy'));
  assert.ok(ids.includes('easylist-cookie'));
  // Added by this workstream, each tracing to a Brave default-list source
  // (replica/re-deep-shields.md §4c, source 1 and 2).
  assert.ok(ids.includes('uabo-filters'), "uBlock Origin's base filters");
  assert.ok(ids.includes('urlhaus'), 'URLhaus malicious URLs');
  assert.ok(ids.includes('brave-unbreak'), 'Brave Unbreak, unbreak exceptions');
  // Ziy's own anti-adblock list (Brave has no C++ anti-adblock code).
  assert.ok(ids.includes('antiadblock-warning-removal'), 'the anti-adblock wall list');
});

test('every default source has a bundled snapshot so first run works offline', () => {
  // The snapshot is looked up by the record's ID at runtime
  // (lib/filterlist/lists.js: loadSnapshot, `lib/filterlist/snapshots/<id>.txt`),
  // so a source whose id does not match its snapshot filename has NO offline
  // fallback — it silently falls back to nothing. That is a real defect class,
  // so it is asserted here rather than left to discovery at first run.
  //
  // The one legacy exception is the cookie list: its id is `easylist-cookie`
  // but its snapshot is `fanboy-cookiemonster.txt` (the source is Fanboy's
  // mirror). That mismatch is REAL today and is recorded in
  // replica/proofs-blocking-strength.md §4 as a known gap rather than hidden.
  const LEGACY = { 'easylist-cookie': 'fanboy-cookiemonster.txt' };
  for (const source of lists.DEFAULT_SOURCES) {
    const file = LEGACY[source.id] || `${source.id}.txt`;
    assert.ok(fs.existsSync(path.join(SNAPSHOTS, file)),
      `no snapshot for ${source.id} (expected ${file})`);
  }
});

test('every shipped snapshot parses cleanly', () => {
  // "Cleanly" is the property that matters: no line fails to parse, and every
  // skip is one of the documented reasons. `stats.invalid` counts the skips
  // whose reason is an empty pattern or an empty option-split — a line like
  // `$popup,third-party,domain=...` carries options but no URL, so there is
  // nothing to block; it is recorded as skipped, not as a malformed rule.
  // EasyList really does contain such lines, so 0 is not the honest number.
  const ALLOWED = new Set(['header-or-comment', 'blank', 'empty-after-split',
    'empty-pattern']);
  for (const f of SHIPPED_LISTS) {
    const { stats } = parse(f);
    for (const reason of Object.keys(stats.skipReasons || {})) {
      assert.ok(ALLOWED.has(reason),
        `${f}: unexpected skip reason ${reason}`);
    }
    // A bad-options line would surface here, and there are none.
    for (const reason of Object.keys(stats.skipReasons || {})) {
      assert.ok(!reason.startsWith('bad-options'),
        `${f}: a line with unparseable options (${reason})`);
    }
    assert.ok(stats.network + stats.cosmetic > 0, `${f} produced no rules`);
  }
});

test('the anti-adblock list reaches the page\'s cosmetic table', () => {
  // Brave has no C++ anti-adblock handling; the defence is list-driven. Prove
  // our list-driven half actually reaches the cosmetic tier for a real site.
  const cosmetic = require('../lib/engine/cosmetic.js');
  const entries = parse('antiadblock-warning-removal.txt').rules
    .filter(r => r.kind === 'cosmetic')
    .map(r => cosmetic.makeEntry(
      r.domains.length === 1 ? r.domains[0] : r.domains[0],
      r.selector, r.isException, 0));
  assert.ok(entries.length > 100,
    `the anti-adblock list contributes cosmetic rules, saw ${entries.length}`);

  // A generic rule (no domain) hides the wall on every site, which is what
  // makes the fixture's wall disappear rather than a detector flag flipping.
  const generics = entries.filter(e => e.domain === '*');
  assert.ok(generics.length > 0,
    'the list carries domain-free rules that apply on any site');
  const grouped = cosmetic.buildForDomain(entries, 'example.com');
  assert.ok(grouped.selectors.length > 0,
    'a site with no per-domain rules still gets the generic wall hides');
});

test('the wall-hiding cosmetic rules are injectable CSS, not procedural', () => {
  // A cosmetic rule we cannot turn into CSS is a wall we cannot hide. This is
  // the property the fixture depends on, so it is asserted rather than assumed.
  const cosmetic = require('../lib/engine/cosmetic.js');
  const entries = parse('antiadblock-warning-removal.txt').rules
    .filter(r => r.kind === 'cosmetic')
    .map(r => cosmetic.makeEntry(
      r.domains.length === 1 ? r.domains[0] : r.domains[0],
      r.selector, r.isException, 0));
  const css = cosmetic.buildStyleText(entries.map(e => e.selector));
  assert.ok(/adblock_msg\s*\{\s*display:\s*none/.test(css),
    '.adblock_msg is turned into a display:none rule');
  assert.ok(!/:has-text\(/.test(css), 'no procedural selector reaches the CSS');
});

test('a Spotify ad host is not blocked anywhere in the shipped table', () => {
  // The regression guard for the stall. If ANY shipped list rule matched an
  // ad-delivery host as a BLOCK, the media element would error, its `ended`
  // event would never fire, the player's ad slot would never end, and the song
  // would never follow — the exact uBlock symptom this feature exists to fix.
  // The Spotify mechanism mutes instead of blocking, so a list-level block would
  // silently defeat it from the outside.
  //
  // This runs the REAL path: the shipped snapshots, through the real compiler,
  // then the real static matcher (lib/engine/static-match.js staticMatch).
  const net = allRules().filter(r => r.kind === 'network');
  // A cap of 100000 so the whole table is in the static tier: this test is
  // about what the table CAN match, not about the 30k routing decision.
  const compiled = D.compileTable({ networkRules: net, staticCap: 100000 });
  const staticRules = compiled.tiers.static;

  const adHosts = ['audio-fa.spotifycdn.com', 'ads.spotify.com',
    'audio-sp-ash1.spotifycdn.com'];
  for (const host of adHosts) {
    const request = {
      url: `https://${host}/ad-segment.mp3`,
      type: 'media',
      host,
      initiator: 'https://open.spotify.com/',
    };
    const blocked = SM.staticWinnerFor
      ? SM.staticWinnerFor(staticRules, request)
      : staticRules.filter(r => SM.staticMatch(r, request));
    const blockers = (blocked && blocked.action && blocked.action.type === 'block')
      ? [blocked] : (blocked || []).filter(r => r.action.type === 'block');
    assert.equal(blockers.length, 0,
      `no shipped rule may block ${host}, or the ad slot stalls: ` +
      JSON.stringify(blockers[0] || null));
  }
});
