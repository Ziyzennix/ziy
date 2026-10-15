/* Ziy passwords — the extension's tests.
 *
 * What is proven here: the browser-side half of the contract. The native half
 * has its own suite (native/ziy-pwd/test/), and the two suites pin the SAME
 * shapes from opposite sides, which is the only way a cross-process contract
 * stays honest: a change to a message field fails one of the two.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'lib', 'pwd-client.js'));

/* ------------------------------------------------------------------ *
 * Origin normalisation, and why it is the same code as the helper's
 * ------------------------------------------------------------------ */

test('an origin is scheme + host + non-default port, with no path', () => {
  assert.equal(P.normaliseOrigin('https://example.com'), 'https://example.com');
  assert.equal(P.normaliseOrigin('https://Example.com/login?next=1'), 'https://example.com');
  assert.equal(P.normaliseOrigin('https://example.com:443/x'), 'https://example.com');
  assert.equal(P.normaliseOrigin('https://example.com:8443/x'), 'https://example.com:8443');
  assert.equal(P.normaliseOrigin('http://example.com:80/x'), 'http://example.com');
  assert.equal(P.normaliseOrigin('http://example.com:8080/x'), 'http://example.com:8080');
});

test('a bare host is rejected, because a fill cannot tell what it applies to', () => {
  // The docstring is the design: a credential must belong to a scheme a page can
  // be served over. A bare host is refused rather than defaulted to https,
  // because defaulting would attach a credential to an http origin it was never
  // saved for.
  assert.equal(P.normaliseOrigin(''), null);
  assert.equal(P.normaliseOrigin(null), null);
  assert.equal(P.normaliseOrigin('about:blank'), null, 'a non-http(s) scheme is not an origin');
  assert.equal(P.normaliseOrigin('moz-extension://abc/ui/'), null);
  assert.equal(P.normaliseOrigin('javascript:void(0)'), null);
});

test('the origin a credential belongs to must match the page exactly', () => {
  assert.equal(P.originMatchesPage('https://example.com', 'https://example.com/login'), true);
  assert.equal(P.originMatchesPage('https://example.com', 'https://www.example.com/'), false,
    'a credential for one host is not a credential for a different host');
  assert.equal(P.originMatchesPage('https://example.com', 'http://example.com/'), false,
    'the scheme is part of the origin');
  assert.equal(P.originMatchesPage('https://example.com', 'https://evil.test/'), false);
  assert.equal(P.originMatchesPage(null, 'https://example.com/'), false);
});

/* ------------------------------------------------------------------ *
 * The CSV, both directions
 * ------------------------------------------------------------------ */

test('the CSV the product writes has the header a browser reads back', () => {
  const csv = P.toCsv([
    { name: 'Example', origin: 'https://example.com', username: 'me', password: 'pw' },
  ]);
  assert.equal(csv, 'name,url,username,password\r\nExample,https://example.com,me,pw\r\n');
});

test('a password containing a comma, a quote or a newline survives the round trip', () => {
  // RFC 4180 is the whole reason a password cannot simply be split on commas.
  const credentials = [
    { name: 'Comma, Inc', origin: 'https://example.com', username: 'me@example.com', password: 'p,a,s,s' },
    { name: 'Quote"Co', origin: 'https://example.com', username: 'q', password: 'he said "hi"' },
    { name: 'Newline', origin: 'https://example.com', username: 'n', password: 'line1\nline2' },
  ];
  const csv = P.toCsv(credentials);
  const back = P.credentialsFromCsv(csv);
  assert.equal(back.error, null);
  assert.equal(back.credentials.length, 3);
  assert.equal(back.credentials[0].password, 'p,a,s,s');
  assert.equal(back.credentials[1].password, 'he said "hi"');
  assert.equal(back.credentials[2].password, 'line1\nline2');
  assert.equal(back.credentials[0].name, 'Comma, Inc');
});

test('the importer reads the column order a browser wrote, not the one it expects', () => {
  // A Chrome export is name,url,username,password; some tools reorder. The
  // lookup is by header name.
  const csv = 'url,name,password,username\r\nhttps://example.com,Example,pw,me\r\n';
  const out = P.credentialsFromCsv(csv);
  assert.equal(out.error, null);
  assert.equal(out.credentials[0].origin, 'https://example.com');
  assert.equal(out.credentials[0].username, 'me');
  assert.equal(out.credentials[0].password, 'pw');
});

test('a file that is not a password CSV is rejected, not guessed at', () => {
  // Importing a bookmark export as passwords would produce nonsense rows that
  // are hard to find and delete.
  assert.equal(P.credentialsFromCsv('a,b,c\r\n1,2,3\r\n').credentials.length, 0);
  assert.equal(P.credentialsFromCsv('<html></html>').error, 'not a password CSV');
  assert.equal(P.credentialsFromCsv('').error, 'not a password CSV');
});

test('an unusable row is counted as skipped, not stored silently', () => {
  const csv = 'name,url,username,password\r\nGood,https://ok.test/,user,pw\r\n'
    + 'NoPass,https://nopw.test/,user,\r\nNoSite,,user,pw\r\n';
  const out = P.credentialsFromCsv(csv);
  assert.equal(out.credentials.length, 1);
  assert.equal(out.credentials[0].origin, 'https://ok.test/');
  assert.equal(out.skipped, 2);
});

test('the CRLF line endings are what a browser writes', () => {
  const csv = P.toCsv([{ name: 'A', origin: 'https://a.test/', username: 'b', password: 'c' }]);
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(csv.split('\r\n').length === 3, 'header + one row + the trailing empty string');
});

/* ------------------------------------------------------------------ *
 * The state the panel renders
 * ------------------------------------------------------------------ */

test('a state is unknown until the helper answers, never "unlocked"', () => {
  // The panel's badge is driven by hasVault/unlocked, both of which start false
  // and are set by the bus's reply. A fresh panel therefore shows the locked
  // state, not an unlocked one.
  const s = P.defaultState;
  assert.equal(s.unlocked, false);
  assert.equal(s.hasVault, false);
  assert.equal(s.error, null);
});

test('no part of the default state can hold key material', () => {
  // The one design rule this product is built on: the browser holds no key, no
  // passphrase, and no credential plaintext. If a field is ever added that
  // could hold one, this test is where it is caught.
  const json = JSON.stringify(P.defaultState);
  assert.ok(!/passphrase|password|key|secret|salt/i.test(json),
    `the panel state must not be able to carry secret material: ${json}`);
});

test('an error is kept until a later op clears it', () => {
  const failed = P.augment(P.defaultState, { error: 'helper did not answer' });
  assert.equal(failed.error, 'helper did not answer');
  assert.equal(failed.busy, false);
  const recovered = P.augment(failed, { count: 3 });
  assert.equal(recovered.error, null, 'the next success clears the error');
  assert.equal(recovered.count, 3);
  const kept = P.augment(failed, { keepError: true });
  assert.equal(kept.error, 'helper did not answer');
});

/* ------------------------------------------------------------------ *
 * The manifest, against the engine's rules
 * ------------------------------------------------------------------ */

function parseManifest(dir) {
  return JSON.parse(stripComments(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
}

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
    if (c === '"') inString = true; out += c; i++; continue;
    if (c === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2);
      i = end < 0 ? raw.length : end + 2;
      out += '\n';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const manifest = parseManifest(ROOT);

test('the add-on id is the one the native host serves', () => {
  // tools/install-ziy-sync-native.js's ALLOWED_EXTENSION_ID check is the mirror
  // of this: a mismatch is a helper that refuses every request.
  assert.equal(manifest.browser_specific_settings.gecko.id, 'ziy-pwd@ziy.app');
});

test('the manifest is MV3 with an EVENT PAGE, not a service worker', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(Array.isArray(manifest.background.scripts));
  // Gecko 156 has no background.service_worker (bug 1573659); declaring both is
  // the cross-browser recipe and Gecko runs the scripts form.
  assert.equal(manifest.background.service_worker, undefined);
  assert.equal(manifest.background.type, 'classic');
});

test('the lib file is loaded before the background page', () => {
  // Both share one classic-script global scope. A lib listed after the event
  // page is a lib the event page cannot read at evaluation time.
  assert.deepEqual(manifest.background.scripts, ['lib/pwd-client.js', 'background/background.js']);
});

test('the permissions are exactly what the vault needs, and no more', () => {
  // nativeMessaging is the whole reason this extension exists; the others are
  // the panel's own surfaces. No host permission is requested, because the
  // helper is launched by the browser, not by a page.
  assert.deepEqual([...manifest.permissions].sort(),
    ['activeTab', 'nativeMessaging', 'storage', 'tabs']);
  assert.deepEqual(manifest.host_permissions, []);
});

test('every path the manifest names exists in the package', () => {
  const need = [
    ...manifest.background.scripts,
    ...Object.values(manifest.icons || {}),
    manifest.action.default_popup,
  ];
  for (const p of need) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `missing ${p}`);
  }
});

test('every script the popup loads exists', () => {
  const html = fs.readFileSync(path.join(ROOT, 'ui', 'popup.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
    // The srcs are relative to the page (ui/), so resolve from there.
    const resolved = path.join(ROOT, 'ui', m[1]);
    assert.ok(fs.existsSync(resolved),
      `popup.html loads ${m[1]} which is not in the package`);
  }
});

test('the popup ships no form-fill control, because the feature does not exist', () => {
  // The ticket's own instruction: a fill button that does nothing is worse than
  // no button. The panel says so in words instead. The check is for a CONTROL or
  // an autofill handler, not for the word "fill" appearing in a comment — the
  // save form legitimately *prefills* its site field from the active tab.
  const js = fs.readFileSync(path.join(ROOT, 'ui', 'popup.js'), 'utf8');
  assert.ok(!/id="[^"]*fill/i.test(js), 'no fill control in the popup');
  assert.ok(!/fillForm|fillLogin|fillCredentials|autofill/i.test(js),
    'no autofill handler in the popup');
  const html = fs.readFileSync(path.join(ROOT, 'ui', 'popup.html'), 'utf8');
  assert.ok(!/id="[^"]*fill/i.test(html), 'no fill control in the markup');
  // The absence is asserted positively too: the panel SAYS it, so a user is not
  // left looking for a button that was never there.
  assert.ok(/[Ff]orm filling is not part of this build/.test(html),
    'the popup must state the absence in words');
});
