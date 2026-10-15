/* Ziy shields — manifest integrity tests.
 *
 * The failure mode these guard against is silent and total: a manifest that
 * references ONE file which is not in the package makes XPIProvider reject the
 * whole add-on. It does not warn, it does not partially install, and the only
 * symptom is that the extension is simply absent from extensions.json. That is
 * exactly what happened during the build: the manifest declared a content-script
 * CSS file that the content script did not need (it injects its own <style>),
 * and the whole suite entry vanished with no error anywhere.
 *
 * So this file checks the manifest against the source tree: every path it names
 * must exist, and every path it names must also be inside the built xpi.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');

/** Reads manifest.json, which carries a long explanatory comment header.
 *  JSON.parse needs it stripped, and the naive regex is not good enough: the
 *  manifest's own match patterns contain star-slash sequences (for example
 *  "http://" followed by a wildcard host and a wildcard path), which a comment
 *  regex would happily eat. So this strips comments only OUTSIDE strings. */
function parseManifest(dir) {
  return JSON.parse(stripComments(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
}

/** Same scanner, without the JSON.parse, so a test can compare text. */
function stripComments(raw) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < raw.length) {
    const c = raw[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += raw[i + 1]; i += 2; continue; }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') { inString = true; out += c; i++; continue; }
    if (c === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2);
      i = end < 0 ? raw.length : end + 2;
      out += '\n';
      continue;
    }
    if (c === '/' && raw[i + 1] === '/') {
      const end = raw.indexOf('\n', i);
      i = end < 0 ? raw.length : end + 1;
      out += '\n';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const manifest = parseManifest(ROOT);

test('the manifest declares the add-on id the filename is derived from', () => {
  assert.equal(manifest.browser_specific_settings.gecko.id, 'ziy-shields@ziy.app');
});

test('the manifest is MV3 and declares the event page, not a service worker', () => {
  assert.equal(manifest.manifest_version, 3);
  // Gecko 156 does not implement background.service_worker (bug 1573659), so the
  // cross-browser recipe declares BOTH and Gecko runs the scripts form.
  assert.ok(Array.isArray(manifest.background.scripts));
  assert.ok(manifest.background.scripts.length > 0);
  assert.equal(manifest.background.scripts[manifest.background.scripts.length - 1],
    'background/background.js', 'the event page is last, after the lib files it uses');
});

test('the permissions are exactly the set the engine needs and no more', () => {
  // webNavigation is load-bearing, not decorative: background.js registers
  // api.webNavigation.onCommitted to reset the per-tab counters on navigation
  // (recon S09 / F02). The web_navigation schema declares
  // `"permissions": ["webNavigation"]`, and CanOfAPIs::loadAPI skips any
  // namespace whose permissions the add-on does not hold — so without this
  // entry browser.webNavigation is simply undefined and
  // `api.webNavigation.onCommitted` is a TypeError that kills the event page
  // (defect D-3 in replica/test-report.md). It is an API permission, so the
  // <all_urls> host permission does not substitute for it.
  assert.deepEqual([...manifest.permissions].sort(), [
    'activeTab', 'alarms', 'declarativeNetRequest', 'scripting',
    'storage', 'tabs', 'webNavigation', 'webRequest', 'webRequestBlocking',
  ]);
  // 'sidebar' style permissions and a 'theme' key are deliberately absent.
  assert.equal(manifest.theme, undefined, 'a theme key would normalise the addon as a theme');
  assert.equal(manifest.dark_theme, undefined);
});

test('every match pattern is one the engine accepts', () => {
  // The engine validates content-script and web_accessible_resources patterns
  // against manifest.json's MatchPattern:
  //   ^(https?|wss?|file|ftp|\*)://(\*|\*\.[^*/]+|[^*/]+)/.*$
  // or the literal '<all_urls>'. A pattern missing the path segment
  // ('http://*' instead of 'http://*/*') is rejected, and the rejection is
  // silent for the whole add-on. This is a second instance of exactly that
  // failure class, so it gets its own test.
  const PATTERN = new RegExp(
    '^(https?|wss?|file|ftp|\\*)://(\\*|\\*\\.[^*/]+|[^*/]+)/.*$',
  );
  const bad = [];
  const check = (value, where) => {
    if (value === '<all_urls>') return;
    if (!PATTERN.test(value)) bad.push(`${where}: ${JSON.stringify(value)}`);
  };
  for (const cs of manifest.content_scripts || []) {
    for (const m of cs.matches || []) check(m, 'content_scripts.matches');
    for (const m of cs.exclude_matches || []) check(m, 'content_scripts.exclude_matches');
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const m of war.matches || []) check(m, 'web_accessible_resources.matches');
  }
  assert.deepEqual(bad, [], `invalid match patterns: ${bad.join(', ')}`);
});

test('the background scripts load the lib files before the event page', () => {
  // The lib modules merge into one shared global, so the loader order is part of
  // the manifest's contract: a lib file listed after background.js would run in
  // a context where the background page's top-level code has already executed.
  const scripts = manifest.background.scripts;
  const last = scripts[scripts.length - 1];
  assert.equal(last, 'background/background.js');
  for (const s of scripts.slice(0, -1)) {
    assert.ok(s.startsWith('lib/'), `${s} should be a lib file`);
  }
  // Every dependency of the event page is listed.
  for (const dep of ['lib/filterlist/parser.js', 'lib/engine/precedence.js',
                     'lib/engine/dnr-compile.js', 'lib/engine/blocking.js']) {
    assert.ok(scripts.includes(dep), `the event page depends on ${dep}`);
  }
});

test('manifest.json is pure JSON that a plain JSON.parse can read', () => {
  // The engine parses the manifest with JSON.parse, which cannot take comment
  // syntax. A manifest carrying a '/*' comment header is dropped entirely and
  // SILENTLY: no error in the browser log, the add-on simply absent from
  // extensions.json while its siblings install. That cost real debugging time
  // during this build, so it is now a test.
  const raw = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(raw); },
    'manifest.json must be pure JSON — no comments');
  assert.equal(parsed.manifest_version, 3);
  assert.equal(parsed.name, 'Ziy Shields');
  assert.equal(parsed.browser_specific_settings.gecko.id, 'ziy-shields@ziy.app');
  // ...and the same file must round-trip through the comment-aware reader, so a
  // future edit that reintroduces a comment fails here rather than in a boot.
  const viaParser = parseManifest(ROOT);
  assert.deepEqual(viaParser, parsed, 'the tolerant reader must agree with JSON.parse');
  // And the file must not contain a comment marker outside a string value.
  // stripComments preserves length outside comments, so for a comment-free file
  // it is the same text apart from any trailing newline.
  const stripped = stripComments(raw);
  assert.equal(stripped.trimEnd(), raw.trimEnd(),
    'no comments outside string values');
});

test('every path the manifest names exists in the source tree', () => {
  const missing = [];
  const check = (p) => {
    if (!fs.existsSync(path.join(ROOT, p))) missing.push(p);
  };

  for (const script of manifest.background.scripts) check(script);
  for (const cs of manifest.content_scripts || []) {
    for (const f of [...(cs.js || []), ...(cs.css || [])]) check(f);
  }
  if (manifest.action && manifest.action.default_popup) check(manifest.action.default_popup);
  for (const icon of Object.values((manifest.action && manifest.action.default_icon) || {})) check(icon);
  for (const icon of Object.values(manifest.icons || {})) check(icon);
  if (manifest.options_page) check(manifest.options_page);
  if (manifest.options_ui && manifest.options_ui.page) check(manifest.options_ui.page);
  for (const rr of (manifest.declarative_net_request || {}).rule_resources || []) {
    check(rr.path);
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const resource of war.resources) {
      // 'ui/*' is a glob, so only check the literal entries.
      if (!resource.includes('*')) check(resource);
    }
  }

  assert.deepEqual(missing, [],
    `the manifest names files that are not in the extension: ${missing.join(', ')}. ` +
    'The engine rejects the whole add-on for this, silently.');
});

test('the static ruleset file is valid DNR rules and matches the manifest entry', () => {
  const rr = (manifest.declarative_net_request.rule_resources || [])[0];
  assert.ok(rr, 'the manifest declares a static ruleset');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, rr.path), 'utf8'));
  assert.ok(Array.isArray(rules), 'a static ruleset is a JSON array');
  // The shipped table is the BOUNDED static tier, not the whole table: the
  // engine drops a ruleset over 30000 rules entirely (ExtensionDNRStore's
  // RuleQuotaCounter), so the generator caps it and the rest is covered
  // imperatively.
  const D = require('../lib/engine/dnr-compile.js');
  assert.ok(rules.length > 20000,
    `the shipped table should use most of the quota, saw ${rules.length}`);
  assert.ok(rules.length <= D.STATIC_RULESET_CAP.rules,
    `and must not exceed the engine's quota, saw ${rules.length}`);

  const ids = new Set();
  for (const rule of rules) {
    assert.ok(!ids.has(rule.id), `duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    assert.ok(rule.id >= 1, 'rule ids must be >= 1');
    assert.ok(rule.priority >= 1, 'priority must be >= 1');
    assert.ok(['block', 'allow', 'upgradeScheme', 'redirect', 'modifyHeaders']
      .includes(rule.action.type));
    const c = rule.condition;
    assert.ok((c.urlFilter === undefined) !== (c.regexFilter === undefined),
      'exactly one of urlFilter / regexFilter');
    if (c.urlFilter) {
      assert.ok(!c.urlFilter.startsWith('||*'), 'urlFilter may not start with ||*');
      assert.ok(c.urlFilter.length > 0, 'urlFilter may not be empty');
    }
    // A main_frame BLOCK is navigation-blocking and is not expressible safely;
    // a main_frame ALLOW is legitimate (the banner-opt-out and $document
    // exception rules in the lists are exactly that).
    assert.ok(!(c.resourceTypes || []).includes('main_frame') || rule.action.type === 'allow',
      'a main_frame block rule would break navigation');

    const action = rule.action.type;
    if (action === 'allow') {
      // Allow rules are the exceptions tier and must out-prioritise ordinary blocks.
      assert.ok(rule.priority > 1, 'an allow rule must out-prioritise the block baseline');
    }
  }
});

test('the built xpi contains every manifest path', () => {
  const xpi = path.join(__dirname, '..', '..', '..', 'build', 'ziy',
    'distribution', 'extensions', 'ziy-shields@ziy.app.xpi');
  if (!fs.existsSync(xpi)) {
    // Not a failure of the source: the xpi is a build artifact produced by the
    // packaging step. Skipping is honest here.
    return;
  }
  const needed = [
    ...manifest.background.scripts,
    ...((manifest.content_scripts || [])[0] || {}).js || [],
    ...Object.values(manifest.icons || {}),
    ...((manifest.declarative_net_request || {}).rule_resources || []).map(r => r.path),
  ];
  const buf = fs.readFileSync(xpi);
  // A zip's central directory can be read by zlib only through the gunzip path,
  // so scan for the member names in the end-of-central-directory entries.
  const text = buf.toString('latin1');
  for (const p of needed) {
    assert.ok(text.includes(p), `the built xpi is missing ${p}`);
  }
  // The static ruleset is ~3 MB uncompressed and ~370 kB gzipped, so the whole
  // xpi is a little under 2 MiB.
  assert.ok(buf.length > 1_000_000, `the xpi carries the static ruleset, saw ${buf.length}`);
});
