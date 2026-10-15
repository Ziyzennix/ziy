/* Ziy Desktop — the suite for lib/desktop.js. Pure logic, no browser APIs.
 *
 * These tests are the evidence for the slice's claims: the bookmark parsers
 * read real files from other browsers, the export round-trips, the
 * default-browser status never fakes a state, and the shortcut advisory names
 * the keys the engine keeps.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktop = require('../lib/desktop.js');

/* ---------------------------------------------------------------- *
 * Fixtures — real-world export shapes, written here rather than
 * fetched so the suite is hermetic and deterministic.
 * ---------------------------------------------------------------- */

const NESTED_FIREFOX_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700003600">Work</H3>
    <DL><p>
        <DT><A HREF="https://example.com/docs" ADD_DATE="1700000100">Docs &amp; Guides</A>
        <DT><A HREF="https://mail.example.com/" ADD_DATE="1700000200">Mail &lt;work&gt;</A>
    </DL><p>
    <DT><H3 ADD_DATE="1700000300">Personal</H3>
    <DL><p>
        <DT><A HREF="https://example.org/">Home</A>
    </DL><p>
</DL><p>
`;

const CHROME_JSON = JSON.stringify({
  checksum: 'x',
  roots: {
    bookmark_bar: {
      children: [
        { name: 'Docs', type: 'url', url: 'https://example.com/docs', date_added: '13000000000000000' },
        { name: 'Media', type: 'folder', date_added: '13000000001000000', children: [
          { name: 'Video', type: 'url', url: 'https://video.example.com/watch?v=1', date_added: '13000000002000000' },
        ] },
      ],
      type: 'folder',
    },
    other: { children: [], type: 'folder' },
    sync_transaction_version: '1',
  },
});

test('the HTML parser reads a nested export', () => {
  const { root, stats } = desktop.parseHtmlBookmarks(NESTED_FIREFOX_HTML);
  assert.equal(root.kind, 'folder');
  assert.equal(root.children.length, 2, 'two top-level folders');
  const work = root.children[0];
  assert.equal(work.title, 'Work');
  assert.equal(work.children.length, 2);
  assert.equal(work.children[0].url, 'https://example.com/docs');
  assert.equal(work.children[0].title, 'Docs & Guides', 'HTML entities are decoded in titles');
  assert.equal(work.children[1].title, 'Mail <work>', 'angle entities survive');
  assert.equal(root.children[1].children[0].title, 'Home');
  assert.equal(stats.bookmarks, 3);
  assert.equal(stats.folders, 2);
});

test('the HTML parser rejects a file that is not a bookmark file', () => {
  assert.throws(
    () => desktop.parseHtmlBookmarks('<html><body>hello</body></html>'),
    /not a bookmark file/,
  );
});

test('the HTML export round-trips through the parser', () => {
  const { root } = desktop.parseHtmlBookmarks(NESTED_FIREFOX_HTML);
  const html = desktop.toHtmlBookmarks(root, 1700000000 * 1000);
  assert.match(html, /<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
  assert.match(html, /<META HTTP-EQUIV="Content-Type" CONTENT="text\/html; charset=UTF-8">/);
  const again = desktop.parseHtmlBookmarks(html);
  assert.deepEqual(
    again.root.children.map((c) => c.title),
    root.children.map((c) => c.title),
  );
  assert.equal(again.stats.bookmarks, 3);
  assert.equal(again.stats.folders, 2);
});

test('the export writes a well-formed bookmark for a single bookmark tree', () => {
  const tree = { kind: 'folder', title: 'Bookmarks', children: [
    { kind: 'bookmark', title: 'Ziy', url: 'https://ziy.example/' },
  ] };
  const html = desktop.toHtmlBookmarks(tree, 1700000000 * 1000);
  assert.match(html, /<A HREF="https:\/\/ziy\.example\/" ADD_DATE="1700000000">Ziy<\/A>/);
  assert.doesNotMatch(html, /undefined/);
});

test('the Chromium parser reads a real Chrome bookmarks export', () => {
  const { root, stats } = desktop.parseChromiumBookmarks(CHROME_JSON);
  // Chromium's roots (bookmark_bar / other) are pseudo-folders in its own UI;
  // the flattened tree is the same shape the HTML path yields, with no
  // invented "bookmark_bar" folder the user never had.
  assert.equal(stats.bookmarks, 2);
  assert.equal(stats.folders, 1);
  assert.equal(root.children[0].kind, 'bookmark');
  assert.equal(root.children[0].url, 'https://example.com/docs');
  assert.equal(root.children[0].added, 13000000000000000 / 1e6, 'Chrome\'s microsecond timestamps become seconds');
  const media = root.children[1];
  assert.equal(media.kind, 'folder');
  assert.equal(media.title, 'Media');
  assert.equal(media.children[0].url, 'https://video.example.com/watch?v=1');
});

test('the Chromium parser refuses a JSON file that is not Chrome bookmarks', () => {
  assert.throws(() => desktop.parseChromiumBookmarks('{"format":"ziy-settings-snapshot"}'), /no "roots" object/);
});

test('sniffing picks the right parser and refuses anything else', () => {
  assert.deepEqual(desktop.sniffBookmarkSource(NESTED_FIREFOX_HTML, 'bookmarks.html'), { kind: 'html' });
  assert.deepEqual(desktop.sniffBookmarkSource(CHROME_JSON, 'Bookmarks'), { kind: 'chromium-json' });
  assert.deepEqual(desktop.sniffBookmarkSource('{"format":"ziy-settings-snapshot"}', 'ziy-settings.json'), { kind: 'ziy-snapshot' });
  assert.throws(() => desktop.sniffBookmarkSource('{"a":1}', 'thing.json'), /not a Ziy snapshot/);
  assert.throws(() => desktop.sniffBookmarkSource('hello', 'notes.txt'), /not a bookmark file/);
});

/* ---------------------------------------------------------------- *
 * Snapshot
 * ---------------------------------------------------------------- */

test('a snapshot carries a version and its categories', () => {
  const snap = desktop.buildSnapshot({ shell: { a: 1 } }, { product: 'Ziy' });
  assert.equal(snap.format, 'ziy-settings-snapshot');
  assert.equal(snap.version, desktop.SNAPSHOT_VERSION);
  assert.equal(snap.product, 'Ziy');
  assert.deepEqual(Object.keys(snap.categories).sort(),
    ['desktop', 'news', 'ntp', 'playlist', 'shell', 'shields', 'talk']);
  assert.deepEqual(snap.categories.shell, { a: 1 });
});

test('a snapshot survives an export/import round trip', () => {
  const snap = desktop.buildSnapshot({ ntp: { clock: '24' } }, {});
  const back = desktop.readSnapshot(JSON.stringify(snap));
  assert.equal(back.version, desktop.SNAPSHOT_VERSION);
  assert.deepEqual(back.categories.ntp, { clock: '24' });
});

test('a newer snapshot is refused rather than half-read', () => {
  const snap = desktop.buildSnapshot({}, {});
  snap.version = desktop.SNAPSHOT_VERSION + 1;
  assert.throws(() => desktop.readSnapshot(JSON.stringify(snap)), /refused rather than half-read/);
});

test('a file that is not JSON is refused with the parse reason', () => {
  assert.throws(() => desktop.readSnapshot('<html>'), /not valid JSON/);
});

test('a JSON object that is not a snapshot is refused', () => {
  assert.throws(() => desktop.readSnapshot('{"hello":1}'), /no "format"/);
});

/* ---------------------------------------------------------------- *
 * Default browser — never faked
 * ---------------------------------------------------------------- */

test('the default-browser state is read, not assumed', () => {
  assert.equal(desktop.parseDefaultBrowser('ziy.desktop').state, 'ziy');
  assert.equal(desktop.parseDefaultBrowser('firefox.desktop').state, 'other');
  assert.equal(desktop.parseDefaultBrowser('brave-origin.desktop').state, 'other');
  assert.equal(desktop.parseDefaultBrowser('').state, 'unknown');
  assert.equal(desktop.parseDefaultBrowser('   ').state, 'unknown');
});

test('an error from xdg-settings is unknown, not "another browser"', () => {
  const parsed = desktop.parseDefaultBrowser('xdg-settings: could not find a desktop session');
  assert.equal(parsed.state, 'unknown');
});

test('a non-desktop-id reply is unknown', () => {
  assert.equal(desktop.parseDefaultBrowser('org.gnome.Shell').state, 'unknown');
});

test('each state gets honest guidance', () => {
  const ziy = desktop.defaultBrowserGuidance('ziy', {});
  assert.equal(ziy.action, null);
  assert.match(ziy.headline, /Ziy is your default browser/);

  const other = desktop.defaultBrowserGuidance('other', { current: 'firefox.desktop' });
  assert.equal(!!other.action, true);
  assert.equal(other.action.command, 'xdg-settings set default-web-browser ziy.desktop');
  assert.match(other.body, /cannot change this from inside the browser/);

  const unknown = desktop.defaultBrowserGuidance('unknown', {});
  assert.equal(unknown.action.command, 'xdg-settings get default-web-browser');
  assert.match(unknown.headline, /unknown/);
});

/* ---------------------------------------------------------------- *
 * Profiles
 * ---------------------------------------------------------------- */

test('the profile listing puts the current profile first', () => {
  const described = desktop.describeProfiles(['work', 'default', 'test'], 'work');
  assert.equal(described.current, 'work');
  assert.deepEqual(described.rows.map((r) => [r.name, r.current]), [
    ['work', true], ['default', false], ['test', false],
  ]);
});

test('the switch command names the launcher, because that is the mechanism', () => {
  assert.equal(desktop.profileSwitchCommand('work'), 'tools/ziy --profile work');
});

/* ---------------------------------------------------------------- *
 * Zoom
 * ---------------------------------------------------------------- */

test('zoom is clamped to the engine range', () => {
  assert.equal(desktop.clampZoom(5), 3.0);
  assert.equal(desktop.clampZoom(0.01), 0.3);
  assert.equal(desktop.clampZoom(1), 1);
  assert.equal(desktop.clampZoom(Number.NaN), 1);
});

test('a zoom step is the multiplicative ladder and stays in range', () => {
  assert.equal(desktop.zoomStep(1, 1), 1.1);
  assert.equal(desktop.zoomStep(1, -1), 0.9);
  assert.equal(desktop.zoomStep(3.0, 1), 3.0);
  assert.equal(desktop.clampZoom(desktop.zoomStep(0.3, -1)), 0.3);
});

test('reset is 100 percent and the label is formatted', () => {
  assert.equal(desktop.zoomResetValue(), 1);
  assert.equal(desktop.formatZoom(1), '100%');
  assert.equal(desktop.formatZoom(1.25), '125%');
  assert.equal(desktop.formatZoom(0.9), '90%');
});

/* ---------------------------------------------------------------- *
 * Shortcuts — the honest advisory
 * ---------------------------------------------------------------- */

test('the reserved list contains the keys Gecko keeps', () => {
  for (const key of ['Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+P', 'Ctrl+F', 'Ctrl+Shift+A']) {
    assert.equal(desktop.isEngineReserved(key), true, key);
  }
  assert.equal(desktop.isEngineReserved('Ctrl+Alt+Shift+Y'), false);
  assert.equal(desktop.isEngineReserved(''), false);
});

test('the conflict advisory names every declared key the engine keeps', () => {
  const conflicts = desktop.shortcutConflicts({
    'ziy-new-tab': { suggested_key: { default: 'Ctrl+T' } },
    'ziy-menu': { suggested_key: { default: 'Alt+F' } },
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].command, 'ziy-new-tab');
  assert.equal(conflicts[0].key, 'Ctrl+T');
});

/* ---------------------------------------------------------------- *
 * The manifest itself — a manifest is a contract, so assert it
 * ---------------------------------------------------------------- */

test('the shipped manifest declares every capability this slice claims', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.browser_specific_settings.gecko.id, 'ziy-desktop@ziy.app');
  assert.equal(manifest.background.service_worker, undefined, 'Gecko 156 runs background.scripts, not a service worker');
  assert.ok(Array.isArray(manifest.background.scripts));
  // The permissions the surfaces really need, and nothing more.
  for (const p of ['storage', 'tabs', 'bookmarks', 'downloads', 'find']) {
    assert.ok(manifest.permissions.includes(p), p);
  }
  // No host permission: nothing here needs to read a page.
  assert.deepEqual(manifest.host_permissions, []);
  // A popup for the Ziy menu.
  assert.equal(manifest.action.default_popup, 'ui/popup.html');
});

test('every suggested key passes the engine\'s own ShortcutUtils regex', () => {
  // Read straight out of the shipped engine, not from MDN: an invalid key in
  // the manifest makes the WHOLE ADD-ON fail schema validation, so this is a
  // build-time gate, not a style check.
  //
  // Source: modules/ShortcutUtils.sys.mjs validate(), inside build/ziy/omni.ja.
  //   BASIC_KEYS      = /^([A-Z0-9]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/
  //   FUNCTION_KEYS   = /^(F[1-9]|F1[0-2])$/   (extension manifests: F1-F12 only)
  //   MEDIA_KEYS      = /^(MediaNextTrack|MediaPlayPause|MediaPrevTrack|MediaStop)$/
  //   modifiers: at most 2, primary mandatory (Shift alone needs a function key)
  //
  // Note there is NO '+' or '-' key: "Ctrl+Plus" and "Ctrl+Minus" are not valid
  // extension-manifest shortcuts on this engine, and declaring one would make
  // the add-on be rejected entirely. The zoom commands therefore ship without
  // suggested keys and are reachable from the menu and about:addons' shortcut
  // editor, where the user can bind whatever the engine allows.
  const BASIC = /^([A-Z0-9]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/;
  const FN = /^(F[1-9]|F1[0-2])$/;
  const MEDIA = /^(MediaNextTrack|MediaPlayPause|MediaPrevTrack|MediaStop)$/;
  const MODS = ['Ctrl', 'Alt', 'Command', 'MacCtrl', 'Shift'];

  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  for (const [name, spec] of Object.entries(manifest.commands)) {
    const key = spec && spec.suggested_key && spec.suggested_key.default;
    if (!key) continue;
    const parts = key.split('+').map((s) => s.trim());
    const last = parts.pop();
    assert.ok(
      BASIC.test(last) || FN.test(last) || MEDIA.test(last),
      `${name}: "${key}" — the key "${last}" is not in the engine's accepted set`,
    );
    assert.ok(parts.length >= 1, `${name}: "${key}" needs a primary modifier`);
    assert.ok(parts.length <= 2, `${name}: "${key}" has more than two modifiers`);
    for (const mod of parts) {
      assert.ok(MODS.includes(mod), `${name}: "${key}" — "${mod}" is not a modifier`);
    }
    if (parts.length === 1 && parts[0] === 'Shift') {
      assert.ok(FN.test(last), `${name}: "${key}" — Shift alone needs a function key`);
    }
    if (parts.length === 2) {
      assert.notEqual(parts[0], parts[1], `${name}: "${key}" repeats a modifier`);
    }
  }
});

test('the reserved-keys list does not contradict the engine\'s validator', () => {
  // Every key the suite says the engine reserves must be a key the engine's
  // own validator would even accept for an extension, or the advisory would be
  // naming keys no extension could ever have bound.
  const BASIC = /^([A-Z0-9]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/;
  const FN = /^(F[1-9]|F1[0-2])$/;
  const MODS = ['Ctrl', 'Alt', 'Command', 'MacCtrl', 'Shift'];
  for (const key of desktop.ENGINE_RESERVED) {
    const parts = key.split('+').map((s) => s.trim());
    const last = parts.pop();
    const okKey = BASIC.test(last) || FN.test(last);
    const okMods = parts.length >= 1 && parts.length <= 2 && parts.every((m) => MODS.includes(m));
    assert.ok(okKey && okMods, `reserved list holds "${key}", which the engine's validator would not accept for an extension`);
  }
});


test('every UI file the manifest names exists', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const ui = path.join(__dirname, '..', 'ui');
  for (const p of [manifest.action.default_popup, manifest.options_ui.page]) {
    assert.ok(fs.existsSync(path.join(ui, path.basename(p))), p);
  }
  assert.ok(fs.existsSync(path.join(ui, 'popup.js')));
  assert.ok(fs.existsSync(path.join(ui, 'options.js')));
  assert.ok(fs.existsSync(path.join(ui, 'tokens.css')));
  assert.ok(fs.existsSync(path.join(ui, 'menu.css')));
  assert.ok(fs.existsSync(path.join(ui, 'options.css')));
});
