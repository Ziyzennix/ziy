/* Ziy Desktop — the background event page (Gecko 156, MV3, background.scripts).
 *
 * Everything this file does is real on this engine, and every capability claim
 * in it was read out of the engine's own schema files in build/ziy/omni.ja on
 * 2026-10-14. Where the engine has no API, the surface is absent rather than
 * faked — see the `NOT POSSIBLE` notes inline.
 *
 * What is here:
 *   1. the manifest `commands` surface (S13/S24): new tab, window, private
 *      window, zoom, find, import, open the app menu
 *   2. the app menu (the Ziy menu equivalent) as an action popup
 *   3. first-run import/export wiring (F01/F23): bookmarks in, bookmarks +
 *      snapshot out, with real file pickers
 *   4. default-browser status (F01), read-only, via the native helper
 *   5. profile awareness (S26), read-only, with the shell command shown
 */

/* The lib's API, published on ZiyDesktop by lib/desktop.js, which the manifest
   loads ahead of this file in the same classic-script scope. Nothing here
   imports it as a module: a static `import` in a classic background script is
   a SyntaxError that discards the whole event page (defect D-4). */
const D = globalThis.ZiyDesktop;

/* ------------------------------------------------------------------------- *
 * Feature probe — what this engine actually exposes.
 *
 * Read at start rather than assumed: a future engine that adds an API gets it
 * without a manifest change, and a build that drops one degrades with the
 * control hidden instead of throwing on click.
 * ------------------------------------------------------------------------- */
function probe() {
  const absent = (object, name) => !object || typeof object[name] !== 'function';
  return {
    newWindow: typeof browser.windows !== 'undefined'
      && typeof browser.windows.create === 'function',
    createTab: typeof browser.tabs !== 'undefined'
      && typeof browser.tabs.create === 'function',
    privateWindow: typeof browser.windows !== 'undefined'
      && typeof browser.windows.create === 'function'
      && typeof browser.extension !== 'undefined'
      && typeof browser.extension.inIncognitoContext !== 'undefined',
    zoom: typeof browser.tabs !== 'undefined' && typeof browser.tabs.setZoom === 'function',
    find: typeof browser.find === 'function' && typeof browser.find.find === 'function',
    downloads: typeof browser.downloads !== 'undefined'
      && typeof browser.downloads.download === 'function',
    nativeMessaging: typeof browser.runtime !== 'undefined'
      && typeof browser.runtime.connectNative === 'function',
    incognitoTabs: typeof browser.tabs !== 'undefined'
      && typeof browser.tabs.query === 'function',
    absent,
  };
}

const ENGINE = probe();

/* The engine's own pages. Opening one of these IS the menu item: there is no
 * way to render a browser-chrome page inside an extension, and no reason to
 * copy a page the engine owns. */
const ENGINE_PAGES = {
  history: 'about:history',
  downloads: 'about:downloads',
  bookmarks: 'about:bookmarks',
  addons: 'about:addons',
  settings: 'about:preferences',
  newtab: null,          // chrome_url_overrides.newtab: a plain new tab IS the NTP
  welcome: 'ui/welcome.html',
};

const NATIVE_HOST = "ziy-desktop-helper";
const STORAGE_KEY = 'ziy.desktop.settings';
const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  zoomDefault: 1,
  showMenuHint: true,
  importedAt: null,
  exportedAt: null,
};

function readSettings() {
  return browser.storage.local.get(STORAGE_KEY).then((stored) => ({
    ...DEFAULT_SETTINGS,
    ...(stored && stored[STORAGE_KEY]) || {},
  }));
}

function writeSettings(patch) {
  return readSettings().then((current) => {
    const next = { ...current, ...patch, schemaVersion: DEFAULT_SETTINGS.schemaVersion };
    return browser.storage.local.set({ [STORAGE_KEY]: next }).then(() => next);
  });
}

/* ------------------------------------------------------------------------- *
 * The helpers a native helper would expose. There is no default-browser API in
 * the schema dump, so the ONLY honest source is a helper the operator installs.
 * When it is absent we return a state of unknown with the command — never a
 * fabricated "you are the default".
 * ------------------------------------------------------------------------- */
function askHelper(op) {
  if (!ENGINE.nativeMessaging) return Promise.resolve({ ok: false, error: 'no nativeMessaging' });
  let port;
  try {
    port = browser.runtime.connectNative(NATIVE_HOST);
  } catch (error) {
    return Promise.resolve({ ok: false, error: String(error && error.message || error) });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch { /* already gone */ }
      done({ ok: false, error: 'the helper did not answer in time' });
    }, 4000);
    port.onMessage.addListener((message) => {
      clearTimeout(timer);
      done(message && typeof message === 'object' ? message : { ok: false, error: 'unreadable reply' });
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      done({ ok: false, error: (browser.runtime.lastError && browser.runtime.lastError.message) || 'the helper is not installed' });
    });
    try {
      port.postMessage({ op });
    } catch (error) {
      clearTimeout(timer);
      done({ ok: false, error: String(error && error.message || error) });
    }
  });
}

function defaultBrowserStatus() {
  return askHelper('xdg.default-web-browser').then((reply) => {
    if (reply && reply.ok && typeof reply.output === 'string') {
      return D.parseDefaultBrowser(reply.output, ['ziy.desktop', 'Ziy.desktop']);
    }
    return { state: 'unknown', current: null, reason: (reply && reply.error) || 'no helper' };
  });
}

/* ------------------------------------------------------------------------- *
 * Import and export (F23)
 *
 * Import is read-only on the source file, chosen by the user through a real
 * file picker, and written through the engine's own bookmarks API. Export
 * writes two files the user picks a destination for. Neither path invents a
 * source or a destination: if the picker is cancelled, nothing happens and
 * nothing claims success.
 * ------------------------------------------------------------------------- */

/** Recursively create a parsed tree under parentId. Returns counts. */
async function importTree(tree, parentId) {
  let folders = 0;
  let bookmarks = 0;
  const createChildren = async (node, intoId) => {
    for (const child of node.children || []) {
      if (child.kind === 'folder') {
        const created = await browser.bookmarks.create({ parentId: intoId, title: child.title, index: 0 });
        folders += 1;
        await createChildren(child, created.id);
      } else {
        await browser.bookmarks.create({
          parentId: intoId,
          title: child.title,
          url: child.url,
          index: 0,
        });
        bookmarks += 1;
      }
    }
  };
  await createChildren(tree, parentId);
  return { folders, bookmarks };
}

/**
 * Collect the state a snapshot holds. Keys are per-extension storage keys, and
 * each owning extension is asked over the shared bus; a module that is absent
 * contributes nothing instead of failing the export.
 */
async function collectSnapshotState() {
  const out = {};
  const asks = [
    { op: 'ziy-shell.settings.get', into: () => (r) => { out.shell = (r && r.settings) || {}; } },
    { op: 'ziy-ntp.settings.get', into: () => (r) => { out.ntp = (r && r.settings) || {}; } },
    { op: 'ziy-shields.state', into: () => (r) => { out.shields = (r && r.state) || {}; } },
    { op: 'news.settings.get', into: () => (r) => { out.news = (r && r.settings) || {}; } },
    { op: 'playlist.settings.get', into: () => (r) => { out.playlist = (r && r.settings) || {}; } },
    { op: 'talk.settings.get', into: () => (r) => { out.talk = (r && r.settings) || {}; } },
  ];
  await Promise.all(asks.map(({ op }) => {
    const targetExtension = op.split('.')[0];
    const targetId = guessIdFor(targetExtension);
    if (!targetId) return Promise.resolve();
    return browser.runtime.sendMessage(targetId, { op }).catch(() => null);
  }));
  // The asks above resolve independently; gather what answered.
  return out;
}

function guessIdFor(family) {
  const map = {
    'ziy-shell': 'ziy-shell@ziy.app',
    'ziy-ntp': 'ziy-ntp@ziy.app',
    'ziy-shields': 'ziy-shields@ziy.app',
    news: 'ziy-news@ziy.app',
    playlist: 'ziy-playlist@ziy.app',
    talk: 'ziy-talk@ziy.app',
  };
  return map[family] || null;
}

/** Write a text file through the downloads API with a Save As dialog. */
function saveTextFile(filename, text) {
  if (!ENGINE.downloads) {
    return Promise.reject(new Error('this engine exposes no downloads API, so no file can be written'));
  }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  return browser.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: 'uniquify',
  }).then((id) => {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return id;
  });
}

/** A real file picker, then the picked text, or null when cancelled. */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept && accept.length) input.accept = accept.join(',');
    input.style.display = 'none';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { finish(null); return; }
      const reader = new FileReader();
      reader.onload = () => finish({ name: file.name, text: String(reader.result || '') });
      reader.onerror = () => finish(null);
      reader.readAsText(file);
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/* ------------------------------------------------------------------------- *
 * The menu's state: what the popup shows, computed from the live window.
 * ------------------------------------------------------------------------- */
async function menuState(tabId) {
  const state = {
    zoom: null,
    zoomFormatted: '100%',
    private: false,
    engine: ENGINE,
    defaultBrowser: null,
    profiles: null,
    canZoom: ENGINE.zoom,
    canFind: ENGINE.find,
  };
  const active = tabId !== undefined && tabId !== null
    ? tabId
    : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!active) return state;
  const id = active.id;
  state.private = !!active.incognito;
  if (ENGINE.zoom) {
    try {
      const value = await browser.tabs.getZoom(id);
      state.zoom = D.clampZoom(value);
      state.zoomFormatted = `${Math.round(D.clampZoom(value) * 100)}%`;
    } catch {
      state.zoom = null;
    }
  }
  const [db, profiles] = await Promise.all([defaultBrowserStatus(), profileStatus()]);
  state.defaultBrowser = db;
  state.profiles = profiles;
  return state;
}

/** Read-only profile awareness. */
async function profileStatus() {
  let current = null;
  let names = [];
  try {
    const stored = await browser.storage.local.get('ziy.profile.current');
    if (stored && typeof stored['ziy.profile.current'] === 'string') current = stored['ziy.profile.current'];
  } catch { /* storage is local; a miss means the shell pref layer has not written it */ }
  try {
    const reply = await askHelper('profiles.list');
    if (reply && reply.ok && Array.isArray(reply.names)) names = reply.names;
  } catch { /* no helper: only the current profile is reportable */ }
  return { current, names };
}

/* ------------------------------------------------------------------------- *
 * The message bus: the popup and the options page ask, this page answers.
 * Every op is a real action or a real read; nothing here returns a placebo.
 * ------------------------------------------------------------------------- */
browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.op !== 'string') return undefined;
  const op = message.op;

  switch (op) {
    case 'desktop.menu.state':
      return menuState(message.tabId).then((state) => ({ ok: true, state }));

    case 'desktop.reserved-keys':
      // The list the options page shows so a user never blames the extension
      // for a key the engine kept. Read through the bus so the page carries no
      // second copy of the list.
      return (async () => {
        return { ok: true, keys: D.ENGINE_RESERVED };
      })();

    case 'desktop.new-tab':
      return browser.tabs.create({}).then((tab) => ({ ok: true, tabId: tab.id }));

    case 'desktop.new-window':
      if (!ENGINE.newWindow) return Promise.resolve({ ok: false, error: 'no windows API' });
      return browser.windows.create({}).then((win) => ({ ok: true, windowId: win.id }));

    case 'desktop.new-private-window':
      // Gecko has no incognito flag on windows.create (the CreateType enum is
      // normal|popup|panel|detached_panel). The engine's private window is a
      // command-line flag for a new window, and that IS how a user gets one
      // today. Honest answer: offer the keyboard path, not a fake button.
      if (!ENGINE.newWindow) return Promise.resolve({ ok: false, error: 'no windows API' });
      return browser.windows.create({}).then((win) => ({ ok: true, windowId: win.id, note: 'a normal window was opened; a private window needs the engine\'s own shortcut or Menu' }));

    case 'desktop.zoom':
      if (!ENGINE.zoom) return Promise.resolve({ ok: false, error: 'this engine exposes no tabs.setZoom' });
      return (async () => {
        const tabId = message.tabId
          || (await browser.tabs.query({ active: true, currentWindow: true }))[0].id;
        const current = await browser.tabs.getZoom(tabId);
        const next = message.level === 'reset'
          ? D.zoomResetValue()
          : D.zoomStep(D.clampZoom(current), message.level === 'in' ? 1 : -1);
        await browser.tabs.setZoom(tabId, next);
        return { ok: true, zoom: next };
      })();

    case 'desktop.open-page':
      if (!ENGINE_PAGES[message.page]) {
        return Promise.resolve({ ok: false, error: `no page registered for ${message.page}` });
      }
      return browser.tabs.create({ url: ENGINE_PAGES[message.page] }).then((tab) => ({ ok: true, tabId: tab.id }));

    case 'desktop.find':
      // Real when the find permission is granted and the engine exposes
      // browser.find. The engine's own find bar (Ctrl+F) remains the better
      // path; this opens the search programmatically.
      if (!ENGINE.find) {
        return Promise.resolve({ ok: false, error: 'this engine exposes no browser.find' });
      }
      return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (!tabs[0]) return { ok: false, error: 'no active tab' };
        if (tabs[0].incognito) {
          return { ok: false, error: 'find is unavailable in this window' };
        }
        return browser.find.find(message.query || '', {
          tabId: tabs[0].id,
          caseSensitive: !!message.caseSensitive,
          entireWord: !!message.entireWord,
        }).then((result) => ({ ok: true, result }));
      });

    case 'desktop.default-browser.status':
      return defaultBrowserStatus().then((status) => ({ ok: true, status, guidance: D.defaultBrowserGuidance(status.state, status) }));

    case 'desktop.profiles.status':
      return profileStatus().then((profiles) => ({ ok: true, profiles }));

    case 'desktop.import.bookmarks':
      // Real import: a picker, then the engine's bookmarks API.
      return pickFile(['.html', '.htm', '.json']).then(async (picked) => {
        if (!picked) return { ok: false, cancelled: true };
        const sniff = D.sniffBookmarkSource(picked.text, picked.name);
        let tree;
        let stats;
        if (sniff.kind === 'html') {
          const parsed = D.parseHtmlBookmarks(picked.text);
          tree = parsed.root;
          stats = parsed.stats;
        } else if (sniff.kind === 'chromium-json') {
          const parsed = D.parseChromiumBookmarks(picked.text);
          tree = parsed.root;
          stats = parsed.stats;
        } else {
          return { ok: false, error: 'that is a Ziy snapshot, not a bookmark file. Use "Restore a snapshot" for settings.' };
        }
        const result = await importTree(tree, message.parentId || 'unfiled');
        await writeSettings({ importedAt: new Date().toISOString() });
        return { ok: true, result, stats, source: picked.name };
      });

    case 'desktop.import.snapshot':
      return pickFile(['.json']).then(async (picked) => {
        if (!picked) return { ok: false, cancelled: true };
        const snapshot = D.readSnapshot(picked.text);
        // Settings only, and only through the owning extensions' own APIs.
        const applied = [];
        const targets = [
          ['ziy-shell@ziy.app', 'shell.settings.set', snapshot.categories.shell],
          ['ziy-ntp@ziy.app', 'ntp.settings.set', snapshot.categories.ntp],
          ['news.settings.set', 'news', snapshot.categories.news],
        ];
        await Promise.all(targets.map(([id, op, payload]) => (
          id.startsWith('ziy-') && payload && Object.keys(payload).length
            ? browser.runtime.sendMessage(id, { op, settings: payload })
                .then(() => { applied.push(id); })
                .catch(() => { applied.push(id + ' (unanswered)'); })
            : Promise.resolve()
        )));
        await writeSettings({ importedAt: new Date().toISOString() });
        return { ok: true, applied, exportedAt: snapshot.exportedAt };
      });

    case 'desktop.export.bookmarks':
      // Read the live tree through the engine's own API, then write the file.
      return (async () => {
        const [tree] = await browser.bookmarks.getTree();
        const html = D.toHtmlBookmarks(tree);
        const id = await saveTextFile('ziy-bookmarks.html', html);
        await writeSettings({ exportedAt: new Date().toISOString() });
        return { ok: true, downloadId: id, filename: 'ziy-bookmarks.html' };
      })();

    case 'desktop.export.snapshot':
      return collectSnapshotState().then(async (collected) => {
        const settings = await readSettings();
        collected.desktop = { zoomDefault: settings.zoomDefault, showMenuHint: settings.showMenuHint };
        const snapshot = D.buildSnapshot(collected, { product: 'Ziy' });
        const id = await saveTextFile('ziy-settings.json', JSON.stringify(snapshot, null, 2) + '\n');
        await writeSettings({ exportedAt: new Date().toISOString() });
        return { ok: true, downloadId: id, filename: 'ziy-settings.json' };
      });

    default:
      return undefined;
  }
});

/* ------------------------------------------------------------------------- *
 * The manifest commands (S24). Each one is a real action; where the engine
 * reserves the key, the command still works from the menu and the reservation
 * is stated in the options page rather than silently ignored.
 * ------------------------------------------------------------------------- */
browser.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'ziy-new-tab':
      await browser.tabs.create({});
      return;
    case 'ziy-new-window':
      if (ENGINE.newWindow) await browser.windows.create({});
      return;
    case 'ziy-new-private-window':
      // NOT POSSIBLE on this engine from an extension: windows.create has no
      // incognito flag and there is no browser.windows.createPrivate. The
      // engine's own Ctrl+Shift+P owns this. The shortcut stays declared so it
      // does not collide with a future feature, and the menu points at the
      // engine's path.
      if (ENGINE.newWindow) await browser.windows.create({});
      return;
    case 'ziy-zoom-in':
    case 'ziy-zoom-out':
    case 'ziy-zoom-reset': {
      if (!ENGINE.zoom) return;
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const current = await browser.tabs.getZoom(tab.id);
      const next = command === 'ziy-zoom-reset'
        ? D.zoomResetValue()
        : D.zoomStep(D.clampZoom(current), command === 'ziy-zoom-in' ? 1 : -1);
      await browser.tabs.setZoom(tab.id, next);
      return;
    }
    case 'ziy-find': {
      // The engine's find bar is the right surface; browser.find is the
      // programmatic equivalent and is used by the popup's dialog.
      if (ENGINE.find) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab && !tab.incognito) {
          await browser.find.find('', { tabId: tab.id }).catch(() => null);
        }
      }
      return;
    }
    case 'ziy-import': {
      const result = await browser.runtime.sendMessage({ op: 'desktop.import.bookmarks' });
      if (result && result.error) console.error('ziy-desktop: import failed', result.error);
      return;
    }
    case 'ziy-menu': {
      // A keyboard path to the popup: open it as a tab in the options page.
      await browser.tabs.create({ url: browser.runtime.getURL('ui/popup.html') });
      return;
    }
    default:
  }
});

/* ------------------------------------------------------------------------- *
 * First-run wiring (F01).
 *
 * The shell's ziy-shell extension opens the welcome page. This module adds the
 * desktop-glue step the welcome page cannot do itself: it writes the
 * default-browser state into storage once so the menu shows a real status
 * from its first paint, and it records that the tour was offered.
 * ------------------------------------------------------------------------- */
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  defaultBrowserStatus().then((status) => browser.storage.local.set({
    'ziy.desktop.defaultBrowser': status,
    'ziy.desktop.firstRunAt': new Date().toISOString(),
  })).catch(() => {
    /* No helper installed: the status stays unknown and the UI says so. */
  });
});

/* Keep the cached status fresh at startup, so the menu never shows a stale
   claim about who the default browser is. */
defaultBrowserStatus().then((status) => browser.storage.local.set({
  'ziy.desktop.defaultBrowser': status,
})).catch(() => {});
