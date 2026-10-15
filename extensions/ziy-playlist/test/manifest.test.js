/* Ziy Playlist — manifest integrity tests.
 *
 * The failure mode these guard against is silent and total, and it has
 * already cost this suite two debugging passes on the shields module
 * (replica/proofs-shields.md §7.2): a manifest that is not pure JSON, or
 * that names ONE path which is not in the package, makes XPIProvider reject
 * the whole add-on. There is no warning, no partial install — the extension
 * is simply absent from extensions.json while its siblings load.
 *
 * So this file checks the manifest against the source tree: JSON.parse must
 * read it, every path it names must exist, and every match pattern must be
 * one the engine accepts.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('the manifest declares the add-on id the filename is derived from', () => {
  assert.equal(manifest.browser_specific_settings.gecko.id, 'ziy-playlist@ziy.app');
  assert.ok(manifest.browser_specific_settings.gecko.strict_min_version.length > 0);
});

test('the manifest is pure JSON a plain JSON.parse can read', () => {
  // This is the whole test: the engine's XPIInstall parse is JSON.parse, and
  // a comment header is fatal and invisible. Read raw so no tolerant parser
  // can hide a comment that was reintroduced.
  const raw = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
  assert.doesNotThrow(() => { JSON.parse(raw); }, 'manifest.json must not contain comments');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Ziy Playlist');
});

test('the background is an event page, not a service worker', () => {
  // Gecko 156 does not implement background.service_worker (bug 1573659),
  // so the cross-browser recipe is background.scripts and that is what ships.
  assert.ok(Array.isArray(manifest.background.scripts));
  assert.equal(manifest.background.service_worker, undefined);
  // The event page is LAST, after every lib file it uses, because the libs
  // merge into one shared global scope and the event page runs immediately.
  const scripts = manifest.background.scripts;
  assert.equal(scripts[scripts.length - 1], 'background/background.js');
  for (const script of scripts.slice(0, -1)) {
    assert.ok(script.startsWith('lib/'), `${script} is a lib file`);
  }
  // Every dependency the event page names at its top level.
  for (const dep of ['lib/model.js', 'lib/classify.js', 'lib/settings.js',
                     'lib/sleep.js', 'lib/position.js', 'lib/store.js']) {
    assert.ok(scripts.includes(dep), `the event page depends on ${dep}`);
  }
});

test('the permissions are exactly the set the engine needs', () => {
  // storage+tabs for the queue; webRequest+webRequestBlocking for the HLS
  // loader's request plumbing; scripting for the programmatic injection.
  assert.deepEqual([...manifest.permissions].sort(),
    ['scripting', 'storage', 'tabs', 'webRequest', 'webRequestBlocking']);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>'],
    'the host permission is what lets a media element in the panel read ' +
    'another origin (MDN, host_permissions); without it, cross-origin media ' +
    'is a CORS failure');
});

test('every match pattern is one the engine accepts', () => {
  // The engine validates content-script and web_accessible_resources
  // patterns against its own MatchPattern, which requires a host AND a path:
  // 'http://*' is rejected, 'http://*/*' is correct.
  const PATTERN = new RegExp('^(https?|wss?|file|ftp|\\*)://(\\*|\\*\\.[^*/]+|[^*/]+)/.*$');
  const bad = [];
  const check = (value, where) => {
    if (value === '<all_urls>') return;
    if (!PATTERN.test(value)) bad.push(`${where}: ${JSON.stringify(value)}`);
  };
  for (const cs of manifest.content_scripts || []) {
    assert.deepEqual(cs.matches, ['https://*/*', 'http://*/*'],
      'the capture script runs on http and https documents only');
    for (const m of cs.matches || []) check(m, 'content_scripts.matches');
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const m of war.matches || []) check(m, 'web_accessible_resources.matches');
  }
  assert.deepEqual(bad, [], `invalid match patterns: ${bad.join(', ')}`);
});

test('every path the manifest names exists on disk', () => {
  const missing = [];
  const check = (p) => {
    if (!fs.existsSync(path.join(ROOT, p))) missing.push(p);
  };
  for (const script of manifest.background.scripts) check(script);
  for (const cs of manifest.content_scripts || []) {
    for (const f of [...(cs.js || []), ...(cs.css || [])]) check(f);
  }
  for (const icon of Object.values(manifest.icons || {})) check(icon);
  for (const icon of Object.values((manifest.action || {}).default_icon || {})) check(icon);
  if (manifest.options_ui && manifest.options_ui.page) check(manifest.options_ui.page);
  if (manifest.sidebar_action && manifest.sidebar_action.default_panel) {
    check(manifest.sidebar_action.default_panel);
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const resource of war.resources) {
      if (!resource.includes('*')) check(resource);
    }
  }
  assert.deepEqual(missing, [],
    `the manifest names files that are not in the extension: ${missing.join(', ')}`);
});

test('the icons the manifest names are real PNGs at the sizes they claim', () => {
  const files = Object.entries(manifest.icons);
  assert.ok(files.length >= 2, 'a panel with no icons is unusable in the sidebar');
  for (const [size, relative] of files) {
    const bytes = fs.readFileSync(path.join(ROOT, relative));
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(bytes.subarray(0, 8).equals(signature), `${relative} is a PNG`);
    // PNG IHDR carries the width and height as the first two big-endian words.
    assert.equal(bytes.readUInt32BE(16), Number(size), `${relative} is ${size}px wide`);
  }
});

test('the extension page CSP keeps the panel able to play its own media', () => {
  // The panel plays a remote URL, so media-src must not be 'none'; and the
  // extension pages must not be allowed to load remote code.
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /media-src 'self'/,
    'a remote media URL is not an extension page resource, so the panel ' +
    'plays it through the media element rather than through the CSP');
  assert.doesNotMatch(csp, /script-src[^;]*https?:/,
    'no remote script source is allowed');
});

test('the panel and options pages name the libs they load', () => {
  for (const page of ['ui/panel.html', 'ui/options.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const sources = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    assert.ok(sources.length > 0, `${page} loads a script`);
    for (const src of sources) {
      const resolved = path.resolve(path.join(ROOT, page), '..', src);
      assert.ok(fs.existsSync(resolved), `${page} loads ${src}, which exists`);
    }
  }
  // The panel must load the model before the libs that consume it.
  const panel = fs.readFileSync(path.join(ROOT, 'ui/panel.html'), 'utf8');
  const order = [...panel.matchAll(/<script src="\.\.\/(lib\/[^"]+)"><\/script>/g)]
    .map((m) => m[1]);
  assert.ok(order.indexOf('lib/model.js') < order.indexOf('lib/classify.js'),
    'lib/model.js loads before lib/classify.js, which depends on it');
  assert.ok(panel.includes('<script src="panel.js"></script>'),
    'panel.js is loaded after the libs');
});

test('the built xpi, when present, carries every manifest path', () => {
  const xpi = path.join(ROOT, '..', '..', 'build', 'ziy', 'distribution',
    'extensions', 'ziy-playlist@ziy.app.xpi');
  if (!fs.existsSync(xpi)) {
    // Not a failure of the source: the xpi is a build artifact.
    return;
  }
  const needed = [
    ...manifest.background.scripts,
    ...((manifest.content_scripts || [])[0] || {}).js || [],
    ...Object.values(manifest.icons || {}),
    'ui/panel.html', 'ui/options.html',
  ];
  const text = fs.readFileSync(xpi).toString('latin1');
  for (const p of needed) {
    assert.ok(text.includes(p), `the built xpi is missing ${p}`);
  }
  // The packer prunes test/ and tools/ by rule, so a fixture must not be in
  // the shipped package.
  assert.ok(!text.includes('test/fixtures/tiny.mp4'),
    'a test fixture must never ship in the xpi');
});
