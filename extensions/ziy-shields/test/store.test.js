/* Ziy shields — the store's write path, with a live browser shim.
 *
 * This is the regression test for the persistence defect that shipped: the
 * global shields rule was written ONLY inside the background's onInstalled
 * listener, and the engine can finish installing the add-on before that event
 * page evaluates its listeners, so on a fresh profile nothing at all wrote
 * `shields.global` — storage.local held `shields.lists` (from the list
 * registry's own first write) and the per-site override, but never the global
 * rule. The fix moved that write into one idempotent function called from
 * every lifecycle path (background/background.js, `ensureStoredGlobalRule`).
 *
 * The point of THIS file is to hold that contract in place: the store must
 * survive a flaky storage backend, and the read-modify-write shape must be
 * idempotent, so calling the seed several times cannot lose the user's own
 * rows. Both are the properties whose absence caused the defect.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../lib/engine/store.js');
const P = require('../lib/engine/precedence.js');

/** The one shape the seed writes: the global rule under the global key. */
async function seed() {
  await store.localSet({
    [P.STORAGE_KEY_GLOBAL]: P.normaliseRule(
      await store.localGet(P.STORAGE_KEY_GLOBAL, null), 'global', null),
  });
}

/** A minimal storage.local that records writes in order. */
function makeStorage() {
  const data = new Map();
  const writes = [];
  const state = {
    /** The write that throws when set, like a storage area that is not ready
     *  yet — the state the write path must tolerate. */
    failNext: 0,
  };
  return {
    writes,
    state,
    data,
    get: (key) => {
      if (typeof key === 'string') {
        return data.has(key) ? { [key]: data.get(key) } : {};
      }
      const out = {};
      for (const k of data.keys()) out[k] = data.get(k);
      return out;
    },
    set: (obj) => {
      if (state.failNext > 0) {
        state.failNext -= 1;
        return Promise.reject(new Error('storage.local.set unavailable'));
      }
      writes.push(Object.assign({}, obj));
      // A real storage.local MERGES the keys it is given, it does not replace
      // the area, so the shim does the same — and this is the merge shape the
      // seed relies on.
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

const realBrowser = global.browser;
function withBrowser(api, fn) {
  global.browser = api;
  global.chrome = undefined;
  return fn().finally(() => { global.browser = realBrowser; });
}

test('the seed writes the global rule under the global key', async () => {
  const s = makeStorage();
  await withBrowser({ runtime: { id: 'x' }, storage: { local: s } }, () => seed());

  assert.ok(s.data.has(P.STORAGE_KEY_GLOBAL), 'shields.global was written');
  const written = s.data.get(P.STORAGE_KEY_GLOBAL);
  // The stored record is the whole rule, factory-filled: a later resolve()
  // must not have to guess what an unset row means.
  assert.deepEqual(written, P.FACTORY);
  assert.equal(s.writes.length, 1, 'one write, one key, nothing else touched');
});

test('the seed is idempotent: a second call writes the same value', async () => {
  const s = makeStorage();
  await withBrowser({ runtime: { id: 'x' }, storage: { local: s } }, async () => {
    await seed();
    const first = s.data.get(P.STORAGE_KEY_GLOBAL);
    const afterFirst = s.writes.length;
    await seed();
    await seed();
    assert.deepEqual(s.data.get(P.STORAGE_KEY_GLOBAL), first,
      'the third call left the stored rule exactly as the first wrote it');
    // It still issues the write — the point is that the VALUE does not drift.
    assert.ok(s.writes.length > afterFirst, 're-seeding still writes, harmlessly');
  });
});

test('the seed keeps the user\'s own rows and only fills the missing ones', async () => {
  const s = makeStorage();
  // A user who turned one row off, stored as the compact record the options
  // page writes. The read-then-write shape must survive this.
  s.data.set(P.STORAGE_KEY_GLOBAL, { scripts: 'allow' });
  await withBrowser({ runtime: { id: 'x' }, storage: { local: s } }, () => seed());

  const written = s.data.get(P.STORAGE_KEY_GLOBAL);
  assert.equal(written.scripts, 'allow', 'the user\'s own row was not overwritten');
  assert.equal(written.adsTrackers, P.FACTORY.adsTrackers,
    'the rows the user never set gained the factory default');
});

test('the seed survives a storage area that throws', async () => {
  const s = makeStorage();
  s.state.failNext = 1;        // the first write fails, like a not-yet-ready area
  await withBrowser({ runtime: { id: 'x' }, storage: { local: s } }, async () => {
    // The CALLER (ensureStoredGlobalRule) catches; the store's own contract is
    // only that it propagates rather than swallowing silently, so a later
    // attempt on a working area succeeds.
    await assert.rejects(() => seed(), /unavailable/);

    s.state.failNext = 0;
    await seed();
    assert.ok(s.data.has(P.STORAGE_KEY_GLOBAL),
      'once storage answers again the global rule lands');
  });
});

test('the store tolerates a missing storage area without throwing', async () => {
  // localGet returns the fallback rather than propagating: the pipeline must be
  // able to start with no storage at all and still work from the factory set.
  await withBrowser({ runtime: { id: 'x' } }, async () => {
    const v = await store.localGet(P.STORAGE_KEY_GLOBAL, 'fallback');
    assert.equal(v, 'fallback');
  });
});

test('the seed writes the key the engine actually decodes', async () => {
  // The storage key is asserted by name, because the engine stores it with the
  // letters shifted ('shields.global' is written as 'shields/global' in the
  // profile's IndexedDB). A rename here is the persistence defect again.
  assert.equal(P.STORAGE_KEY_GLOBAL, 'shields.global');
  assert.equal(P.STORAGE_KEY_LISTS, 'shields.lists');
});

/* ------------------------------------------------------------------ *
 * The event page's wiring, which is where the defect actually lived.
 *
 * The bug was NOT in this lib file: it was that the only call to the seed sat
 * inside the onInstalled listener, and the engine can finish installing the
 * add-on before that listener exists. So the structural contract is asserted
 * here against the shipped source: the seed must be reachable from every path
 * that is guaranteed to run, and must not be reachable only from onInstalled.
 * ------------------------------------------------------------------ */

const BG_PATH = path.join(__dirname, '..', 'background', 'background.js');
const BG_SOURCE = fs.readFileSync(BG_PATH, 'utf8');

/** The last top-level statement of the file, by line. Top-level means the line
 *  starts at column 0 with a letter — the event page is a classic script, so
 *  its module-level code lives there. */
function topLevelTail() {
  const lines = BG_SOURCE.split('\n');
  let last = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^[A-Za-z$]/.test(lines[i])) last = i;
  }
  return lines.slice(last).join('\n');
}

test('the global seed is called from every lifecycle path that always runs', () => {
  // onInstalled, onStartup, and the module bootstrap at the bottom of the file.
  // The bootstrap is the one that matters: it is the fallback the file's own
  // comment records for "the manifest installs before this listener chain is
  // registered in some Gecko versions", and before the fix it rebuilt the list
  // registry (writing shields.lists) without ever writing shields.global.
  const calls = BG_SOURCE.match(/ensureStoredGlobalRule\(\)/g) || [];
  assert.ok(calls.length >= 3,
    `the seed must be called from onInstalled, onStartup AND the module ` +
    `bootstrap — found ${calls.length} call(s)`);
  assert.match(topLevelTail(), /initPromise\.then\(\(\) => ensureStoredGlobalRule\(\)/,
    'the module bootstrap must seed the global rule once rebuildAll resolves');
});

test('the bootstrap seeds the rule asynchronously, never before rebuildAll', () => {
  // A synchronous seed at module scope would run before the listeners are wired
  // and would race the very install event that used to be missed. It must hang
  // off initPromise, so the registry write and the rule write are ordered.
  assert.match(BG_SOURCE,
    /initPromise = rebuildAll\(\);\s*\n\s*initPromise\.then\(\(\) => ensureStoredGlobalRule\(\)/);
});

test('the seed cannot throw out of a lifecycle listener', () => {
  // The sibling extensions' convention (ziy-talk background/background.js:326,
  // ziy-playlist background/background.js:375): log and carry on. An unhandled
  // rejection inside an async listener takes the listener chain with it, which
  // is how a partial failure becomes a permanent one.
  assert.match(BG_SOURCE, /async function ensureStoredGlobalRule\(\) \{\s*\n\s*try \{/,
    'the seed must catch its own storage failure');
  assert.match(BG_SOURCE, /console\.error\('ziy-shields: could not seed the global shields rule'/);
});

test('the background writes the global rule no other way', () => {
  // Every writer of shields.global in the event page, by name. The options page
  // writes the key directly (ui/options.js), which is the user editing a row;
  // the event page must funnel through the seed so there is exactly one place
  // where a lifecycle default is applied.
  const bodyWrites = BG_SOURCE.match(/localSet\(\s*\{\s*\[precedence\.STORAGE_KEY_GLOBAL\]/g) || [];
  assert.equal(bodyWrites.length, 1,
    'the event page must write shields.global in exactly one place — the seed');
});
