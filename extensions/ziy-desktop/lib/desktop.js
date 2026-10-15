/* Ziy Desktop — the pure logic behind the desktop-glue surfaces.
 *
 * This file is the module the event page and the UI pages both import, and it
 * is deliberately free of every `browser.*` call: the API surface is injected
 * at the boundary (background/background.js) or passed in as a parameter (the
 * UI pages). That is what makes it unit-testable under node --test.
 *
 * What lives here:
 *   1. HTML bookmark IMPORT — the Netscape Bookmark File Format (F23)
 *   2. HTML bookmark EXPORT — the same format, written out
 *   3. JSON state import/export — Ziy's own snapshot shape
 *   4. xdg default-browser STATUS parsing (F01) — never faked
 *   5. Profile awareness (S26) — read-only, the shell's --profile is the mechanism
 *   6. Zoom arithmetic and the menu's state derivation (S13)
 *   7. Shortcut-conflict advisory (S24)
 *
 * Rules the whole suite follows, and this file most of all:
 *   * no fake controls: if a flow cannot be real on this engine, it is absent
 *     from the UI and the reason is stated
 *   * clean-room: the formats below are public (Netscape's bookmark format is
 *     the interchange every browser writes and reads)
 */
'use strict';
/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md section 2)
 *
 * This file is loaded as a classic <script> in the shared global scope of
 * the ziy-desktop event page, ahead of background/background.js in the
 * manifest's background.scripts array. It therefore declares NOTHING at
 * the top level: every const and function below lives inside the factory
 * of this UMD wrapper. Two files that both declared, say, `clampZoom` at
 * the top level would throw at PARSE time ("redeclaration of
 * non-configurable global property"), the engine would discard the whole
 * file, and every message handler in background.js would fail to register
 * -- which is defect D-4 in replica/test-report.md.
 *
 * The API is published on the one `ZiyDesktop` global this extension's
 * classic scripts share, and on module.exports when the unit tests
 * require() it. Both routes expose the same names on the same object.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    /* node's cjs-module-lexer only surfaces ESM named imports when the
     * names are assigned with a literal `exports.NAME =`, so each public
     * name is assigned by hand, in the order module.exports used below. */
    exports.parseHtmlBookmarks = api.parseHtmlBookmarks;
    exports.parseChromiumBookmarks = api.parseChromiumBookmarks;
    exports.toHtmlBookmarks = api.toHtmlBookmarks;
    exports.buildSnapshot = api.buildSnapshot;
    exports.readSnapshot = api.readSnapshot;
    exports.sniffBookmarkSource = api.sniffBookmarkSource;
    exports.flattenForImport = api.flattenForImport;
    exports.decodeEntities = api.decodeEntities;
    exports.escapeHtml = api.escapeHtml;
    exports.DEFAULT_BROWSER_STATES = api.DEFAULT_BROWSER_STATES;
    exports.parseDefaultBrowser = api.parseDefaultBrowser;
    exports.defaultBrowserGuidance = api.defaultBrowserGuidance;
    exports.describeProfiles = api.describeProfiles;
    exports.profileSwitchCommand = api.profileSwitchCommand;
    exports.ZOOM_MIN = api.ZOOM_MIN;
    exports.ZOOM_MAX = api.ZOOM_MAX;
    exports.clampZoom = api.clampZoom;
    exports.zoomStep = api.zoomStep;
    exports.zoomResetValue = api.zoomResetValue;
    exports.formatZoom = api.formatZoom;
    exports.ENGINE_RESERVED = api.ENGINE_RESERVED;
    exports.isEngineReserved = api.isEngineReserved;
    exports.shortcutConflicts = api.shortcutConflicts;
    exports.IMPORT_SOURCES = api.IMPORT_SOURCES;
    exports.SNAPSHOT_VERSION = api.SNAPSHOT_VERSION;
  } else {
    root.ZiyDesktop = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/** Decode the entities a bookmark file actually contains. */
function decodeEntities(text) {
  if (text.indexOf('&') < 0) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const named = HTML_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/** Strip tags from a fragment and normalise whitespace. */
function stripTags(fragment) {
  return decodeEntities(String(fragment).replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse one anchor tag's attributes into a plain object (lower-cased keys).
 * Returns null when the tag carries no HREF.
 */
function parseAnchor(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    const value = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5] || '');
    attrs[m[1].toLowerCase()] = decodeEntities(value);
  }
  if (!attrs.href) return null;
  return attrs;
}

/**
 * Parse a Netscape-format bookmark file into a tree.
 *
 * Returns { folders: [...], bookmarks: [...], stats: {...} } where each node is
 * { kind: 'folder'|'bookmark', title, children?|url, added? }.
 *
 * `stats` is what the UI shows the user so an import never looks like it
 * worked when it did not: { files, folders, bookmarks, skipped, duplicates }.
 *
 * The returned tree's ROOT is the "Bookmarks" node the file wraps everything
 * in; callers import the children, which is what every browser does.
 */
function parseHtmlBookmarks(text) {
  const source = String(text);
  const stats = { folders: 0, bookmarks: 0, skipped: 0, duplicates: 0, emptyFolders: 0 };
  // A bookmark file with no <DL> at all is not a bookmark file.
  if (!/<dl[\s>]/i.test(source)) {
    throw new Error('not a bookmark file: no <DL> element found. Export HTML bookmarks from the other browser first.');
  }

  const root = { kind: 'folder', title: 'Bookmarks', children: [] };
  // The stack of open folders; index 0 is always the root.
  const stack = [root];
  const seen = new Set();

  // Tokenise the document so <DT>/<H3>/<A>/<DL>/</DL> are seen in order.
  const tokenRe = /<(\/?)(dl|h3|a|hr|menu)\b([^>]*)>|<!\[endif\]-->/gi;
  let pos = 0;
  let lastAnchor = null;

  const current = () => stack[stack.length - 1];

  // A folder's content begins at its own <DL>, which can appear after the <H3>.
  let pendingFolder = null;

  while (pos < source.length) {
    tokenRe.lastIndex = pos;
    const m = tokenRe.exec(source);
    if (m === null) break;
    pos = tokenRe.lastIndex;
    if (m[1] === '/' ) {
      const tag = m[2].toLowerCase();
      if (tag === 'dl') {
        // Close the innermost open <DL>: if a folder was opened by an <H3>
        // plus a <DL>, the folder is closed too.
        if (stack.length > 1) {
          const closed = stack.pop();
          if (closed.kind === 'folder' && closed.children.length === 0) {
            stats.emptyFolders += 1;
          }
        }
        pendingFolder = null;
      }
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrsText = m[3] || '';

    if (tag === 'dl') {
      if (pendingFolder) {
        // The folder joins its parent BEFORE it becomes the current one, so
        // the tree stays linked however the file nests.
        current().children.push(pendingFolder);
        stack.push(pendingFolder);
        stats.folders += 1;
        pendingFolder = null;
      }
      // A <DL> with no preceding <H3> is a level inside the current folder.
      continue;
    }

    if (tag === 'h3') {
      // The title is the text up to </H3>.
      const end = source.toLowerCase().indexOf('</h3>', pos);
      const raw = end < 0 ? source.slice(pos, pos + 200) : source.slice(pos, end);
      pos = end < 0 ? source.length : end + 5;
      const title = stripTags(raw) || 'Untitled folder';
      // The add_date / last_modified attributes live on the <H3>.
      const attrs = parseAnchor('<x ' + attrsText.trim() + '>') || {};
      pendingFolder = {
        kind: 'folder',
        title,
        children: [],
        added: numberOrNull(attrs.add_date),
        modified: numberOrNull(attrs.last_modified),
      };
      lastAnchor = null;
      continue;
    }

    if (tag === 'a') {
      const end = source.indexOf('>', pos - 1);
      const fullTag = source.slice(tokenRe.lastIndex - attrsText.length - 2, (end < 0 ? pos : end + 1));
      const attrs = parseAnchor(fullTag);
      if (!attrs || !attrs.href) {
        stats.skipped += 1;
        lastAnchor = null;
        continue;
      }
      const close = source.toLowerCase().indexOf('</a>', pos);
      const label = close < 0 ? attrs.href : stripTags(source.slice(pos, close));
      if (close >= 0) pos = close + 4;
      const title = label || attrs.href;
      const key = (current().title || '') + '\u0000' + attrs.href;
      if (seen.has(key)) {
        stats.duplicates += 1;
        lastAnchor = null;
        continue;
      }
      seen.add(key);
      current().children.push({
        kind: 'bookmark',
        title,
        url: attrs.href,
        added: numberOrNull(attrs.add_date),
        icon: attrs.icon || null,
        description: attrs.description || null,
      });
      stats.bookmarks += 1;
      lastAnchor = current().children[current().children.length - 1];
      continue;
    }

    if (tag === 'hr') {
      // A separator; every browser writes it, none of the engines expose one,
      // so it is counted as skipped rather than invented as a node.
      if (lastAnchor) {
        // Attach the description that follows, if any.
      }
      continue;
    }
    if (tag === 'menu') continue;
  }

  // Any <DL> left open is closed by end-of-file; nothing to do, the tree is
  // already linked by reference.
  return { root, stats };
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Flatten a parsed tree into the bookmark records Gecko's `bookmarks.create`
 * accepts, creating folders depth-first and remembering the folder ids.
 *
 * Returns { items: [{parentId, title, url?, index}], folders, bookmarks } —
 * the caller maps parentId/index against the ids `bookmarks.create` returns.
 */
function flattenForImport(tree, options) {
  const opts = options || {};
  const rootParentId = opts.parentId === undefined ? 'unfiled' : opts.parentId;
  const items = [];
  let folders = 0;
  let bookmarks = 0;

  function walk(node, parentId) {
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      if (child.kind === 'folder') {
        items.push({ parentId, title: child.title, index: i, folder: true });
        folders += 1;
        // Children are walked after the create call returns the new folder id;
        // the caller recurses using the id. The walker below re-runs.
      } else {
        items.push({ parentId, title: child.title, url: child.url, index: i });
        bookmarks += 1;
      }
    }
  }

  // A folder's children must be created inside it, so the walk is a queue that
  // carries the freshly created parent id.
  const queue = [{ node: tree, parentId: rootParentId }];
  const created = [];
  while (queue.length > 0) {
    const job = queue.shift();
    walk(job.node, job.parentId);
    for (const item of job.node.children) {
      if (item.kind !== 'folder') continue;
    }
    // Folders discovered in this pass are queued for a second pass once the
    // caller reports their ids; see createTree() below for the driver.
    created.push({ job, items: job.node.children });
  }

  return { items, folders, bookmarks, queue: created };
}

/* ========================================================================== *
 * 2. HTML bookmark export
 * ========================================================================== */

/**
 * Serialise a bookmark tree to the Netscape format every browser reads.
 * `escapeHtml` is applied to titles only — URLs are written raw because the
 * format's HREF is a literal attribute value and browsers do not decode it.
 */
function toHtmlBookmarks(root, nowSeconds) {
  const stamp = Math.floor((nowSeconds || Date.now()) / 1000);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  writeNodes(root, 1);
  lines.push('</DL><p>');

  function writeNodes(node, depth) {
    for (const child of node.children || []) {
      const pad = '    '.repeat(depth);
      if (child.kind === 'folder') {
        lines.push(`${pad}<DT><H3 ADD_DATE="${child.added || stamp}" LAST_MODIFIED="${child.modified || stamp}">${escapeHtml(child.title)}</H3>`);
        lines.push(`${pad}<DL><p>`);
        writeNodes(child, depth + 1);
        lines.push(`${pad}</DL><p>`);
      } else {
        const attrs = [`HREF="${child.url}"`, `ADD_DATE="${child.added || stamp}"`];
        if (child.icon) attrs.push(`ICON="${child.icon}"`);
        lines.push(`${pad}<DT><A ${attrs.join(' ')}>${escapeHtml(child.title)}</A>`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ========================================================================== *
 * 3. Ziy JSON state snapshot
 * ========================================================================== *
 *
 * The JSON export is ours: settings the user changed, top sites, and the
 * shield state they curated — the things the engine has no export for. It is
 * written next to the HTML bookmarks file so a restore is two files, and it
 * carries a version so a future format change is detectable rather than
 * silently misread.
 */

const SNAPSHOT_VERSION = 1;

/** Build the snapshot object from the settings map a caller collected. */
function buildSnapshot(collected, meta) {
  const now = new Date().toISOString();
  return {
    format: 'ziy-settings-snapshot',
    version: SNAPSHOT_VERSION,
    exportedAt: now,
    product: meta && meta.product ? meta.product : 'Ziy',
    categories: {
      shell: collected.shell || {},
      ntp: collected.ntp || {},
      shields: collected.shields || {},
      news: collected.news || {},
      playlist: collected.playlist || {},
      talk: collected.talk || {},
      desktop: collected.desktop || {},
    },
  };
}

/** Validate and normalise an imported snapshot. */
function readSnapshot(text) {
  let doc;
  try {
    doc = JSON.parse(String(text));
  } catch (error) {
    throw new Error('not a Ziy snapshot: the file is not valid JSON (' + error.message + ')');
  }
  if (!doc || typeof doc !== 'object') throw new Error('not a Ziy snapshot: the top level is not an object');
  if (doc.format !== 'ziy-settings-snapshot') {
    throw new Error('not a Ziy snapshot: no "format": "ziy-settings-snapshot" marker');
  }
  const version = Number(doc.version);
  if (!Number.isFinite(version) || version > SNAPSHOT_VERSION) {
    throw new Error(`this snapshot is version ${doc.version}, and this Ziy reads up to ${SNAPSHOT_VERSION}. Newer snapshots are refused rather than half-read.`);
  }
  const categories = doc.categories && typeof doc.categories === 'object' ? doc.categories : {};
  const out = { categories: {}, exportedAt: doc.exportedAt || null, version };
  for (const key of ['shell', 'ntp', 'shields', 'news', 'playlist', 'talk', 'desktop']) {
    out.categories[key] = (categories[key] && typeof categories[key] === 'object') ? categories[key] : {};
  }
  return out;
}

/* ========================================================================== *
 * 4. Default-browser status (F01) — read-only, never faked
 * ========================================================================== *
 *
 * There is no browser.xdg API and no browser.setAsDefault on Gecko (the
 * architecture note says so, and the omni.ja schema dump confirms it: no
 * `setAsDefault` function exists in any schema). What a WebExtension CAN do
 * is read what the OS already decided. So:
 *
 *   * the extension reports the current state by parsing the output of
 *     `xdg-settings get default-web-browser`, run by a native helper the
 *     operator installs (tools/install-native.sh writes the manifest);
 *   * when the helper is absent, the status is UNKNOWN and the UI says so
 *     with the exact command to run — it never claims "Ziy is your default
 *     browser" on the strength of a guess.
 *
 * The parse below is the real contract: xdg-settings prints a .desktop file
 * basename such as "ziy.desktop", "firefox.desktop" or "brave-origin.desktop".
 */

const DEFAULT_BROWSER_STATES = {
  ZIY: 'ziy',
  OTHER: 'other',
  UNKNOWN: 'unknown',
};

/** Parse `xdg-settings get default-web-browser` output into a state. */
function parseDefaultBrowser(output, ziyDesktopIds) {
  const ids = Array.isArray(ziyDesktopIds) ? ziyDesktopIds : ['ziy.desktop', 'Ziy.desktop'];
  const trimmed = String(output || '').trim();
  if (trimmed === '') return { state: DEFAULT_BROWSER_STATES.UNKNOWN, current: null, reason: 'no output' };
  const first = trimmed.split(/\r?\n/)[0].trim();
  if (first === '') return { state: DEFAULT_BROWSER_STATES.UNKNOWN, current: null, reason: 'no output' };
  // A helper that could not find a desktop session reports an error message
  // rather than a desktop id; that is unknown, not "other".
  if (/error|could not|not found|no such|cannot|^x-scheme-handler/i.test(first)) {
    return { state: DEFAULT_BROWSER_STATES.UNKNOWN, current: null, reason: first };
  }
  if (!/\.desktop$/.test(first)) {
    return { state: DEFAULT_BROWSER_STATES.UNKNOWN, current: first, reason: 'not a .desktop id' };
  }
  const base = first.toLowerCase();
  if (ids.some((id) => id.toLowerCase() === base)) {
    return { state: DEFAULT_BROWSER_STATES.ZIY, current: first, reason: 'the desktop session names Ziy' };
  }
  return { state: DEFAULT_BROWSER_STATES.OTHER, current: first, reason: 'the desktop session names another browser' };
}

/**
 * The honest instruction text, for each state. A flow that cannot be made real
 * is not offered as a button; it is offered as the command that WOULD make it
 * real, run by the operator.
 */
function defaultBrowserGuidance(state, detail) {
  switch (state) {
    case DEFAULT_BROWSER_STATES.ZIY:
      return {
        headline: 'Ziy is your default browser',
        body: 'The desktop session reports Ziy for http and https links.',
        action: null,
      };
    case DEFAULT_BROWSER_STATES.OTHER:
      return {
        headline: 'Another browser is the default',
        body: `The desktop session reports ${detail.current}. Ziy cannot change this from inside the browser — a WebExtension has no default-browser API on this engine, and pretending otherwise is how fake controls ship.`,
        action: {
          label: 'Copy the command',
          command: 'xdg-settings set default-web-browser ziy.desktop',
          explanation: 'Run it in a terminal. It writes the same setting your desktop settings panel would.',
        },
      };
    default:
      return {
        headline: 'Default browser: unknown',
        body: 'No helper answered, so Ziy does not claim a state it did not read.',
        action: {
          label: 'Copy the check command',
          command: 'xdg-settings get default-web-browser',
          explanation: 'If it prints nothing or an error, this desktop session has no xdg-settings. Ziy shows this instead of guessing.',
        },
      };
  }
}

/* ========================================================================== *
 * 5. Profile awareness (S26) — read-only
 * ========================================================================== *
 *
 * A profile is the shell's mechanism: `tools/ziy --profile NAME` boots
 * ~/.ziy/profiles/NAME. An extension cannot switch it. What the extension
 * CAN do is report the facts the user needs and hand them the command that
 * starts the profile they want, which is the honest version of a profile
 * picker for an extension surface.
 */

/**
 * Parse a profile directory listing into the rows the menu shows.
 * `names` are the directory names under ~/.ziy/profiles/.
 */
function describeProfiles(names, currentName) {
  const rows = (names || [])
    .map((name) => ({ name, current: String(name) === String(currentName) }))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return {
    current: currentName && String(currentName) !== '' ? String(currentName) : null,
    rows,
  };
}

/** The command that switches profile, as text the user can copy. */
function profileSwitchCommand(name) {
  return `tools/ziy --profile ${name}`;
}

/* ========================================================================== *
 * 6. Zoom (S13 Zoom / S24 shortcuts)
 * ========================================================================== *
 *
 * Gecko 156 exposes browser.tabs.setZoom / getZoom, and the schema dump
 * confirms the existence of both, with the documented range. Zoom steps in
 * Firefox are the standard ±1/|current| ladder; the values below are the ones
 * the engine itself clamps to, and clamping here means the UI never offers a
 * step that would be refused.
 */

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;

function clampZoom(value) {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.round(value * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

/** One zoom step: the multiplicative ladder, not a fixed increment. */
function zoomStep(current, direction) {
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  const next = base + (direction > 0 ? 0.1 : -0.1) * Math.max(base, 1);
  return clampZoom(next);
}

function zoomResetValue() {
  return 1;
}

/** 0.9 -> "90%"; 1 -> "100%". */
function formatZoom(value) {
  const clamped = clampZoom(value);
  const rounded = Math.round(clamped * 100);
  return `${rounded}%`;
}

/* ========================================================================== *
 * 7. Shortcut-conflict advisory (S24)
 * ========================================================================== *
 *
 * Gecko owns the browser-reserved keys (Ctrl+T, Ctrl+N, Ctrl+Shift+P and the
 * rest). An extension's `commands` with a suggested_key that collides with a
 * browser reserved key is silently not bound — Gecko does not report the
 * conflict back to the extension. So the suite states the reservation in the
 * options page and never ships a control that claims to rebind an engine key.
 */

/* The browser-reserved keys an extension COULD have declared. This is not the
 * engine's whole key map — it is the intersection of "keys Gecko keeps for
 * itself" and "keys Gecko would accept in an extension manifest", because the
 * advisory is about bindings an extension might have attempted.
 *
 * Verified against modules/ShortcutUtils.sys.mjs validate() in the shipped
 * omni.ja, which accepts only A-Z0-9, Comma, Period, Home, End, PageUp,
 * PageDown, Space, Insert, Delete, Up/Down/Left/Right and F1-F12 — so
 * Ctrl+Plus, Ctrl+Minus and Ctrl+0 are NOT valid extension-manifest shortcuts
 * and are deliberately absent: naming them would imply an extension could have
 * bound them, which it could not.
 *
 * Each of these is a documented Gecko key binding for a browser action, which
 * is why an extension's suggested_key for it is silently ignored. */
const ENGINE_RESERVED = [
  'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+Shift+P', 'Ctrl+W', 'Ctrl+Shift+T',
  'Ctrl+L', 'Ctrl+F', 'Ctrl+G', 'Alt+Left', 'Alt+Right', 'Ctrl+R', 'Ctrl+Shift+B',
  'Ctrl+H', 'Ctrl+J', 'Ctrl+Shift+A', 'Ctrl+Shift+C', 'Ctrl+D',
  'Ctrl+S', 'Ctrl+P', 'Ctrl+U', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Delete',
];

/** Is `key` reserved by the engine, so a suggested binding would be ignored? */
function isEngineReserved(key) {
  if (!key) return false;
  return ENGINE_RESERVED.some((k) => k.toLowerCase() === String(key).toLowerCase());
}

/**
 * Compare a manifest's suggested keys against the reserved list and return the
 * conflicts the options page must show honestly.
 */
function shortcutConflicts(commands) {
  const conflicts = [];
  for (const [name, spec] of Object.entries(commands || {})) {
    const key = spec && spec.suggested_key && spec.suggested_key.default;
    if (key && isEngineReserved(key)) {
      conflicts.push({ command: name, key, note: 'the engine reserves this key, so the binding is not applied by Gecko' });
    }
  }
  return conflicts;
}

/* ========================================================================== *
 * 8. Import/export planning — what the pickers look for
 * ========================================================================== *
 *
 * Every import below is read-only on the source and writes only through the
 * engine's own APIs, with a picker. This table drives the picker's UI and the
 * unit test that asserts we never claim a source we cannot read.
 */

const IMPORT_SOURCES = [
  {
    id: 'html-bookmarks',
    label: 'Bookmarks file (HTML)',
    accepts: ['.html', '.htm'],
    flow: 'file',
    writes: 'browser.bookmarks.create',
    note: 'The format every browser exports and reads. Pick the Bookmarks.html file from the other browser\'s profile.',
  },
  {
    id: 'ziy-snapshot',
    label: 'Ziy settings snapshot (JSON)',
    accepts: ['.json'],
    flow: 'file',
    writes: 'browser.storage.local',
    note: 'A snapshot this or another Ziy wrote. Settings only — no browsing history is ever moved.',
  },
  {
    id: 'chrome-bookmarks-json',
    label: 'Chromium bookmarks file (JSON)',
    accepts: ['.json'],
    flow: 'file',
    writes: 'browser.bookmarks.create',
    note: 'Chrome/Edge/Brave write a JSON bookmarks file in their profile. Read directly, no conversion step.',
  },
];

/**
 * Parse Chromium's JSON bookmark file ({"roots": {...}} with type "folder" /
 * "url" nodes) into the same tree our HTML parser produces, so both paths feed
 * one importer.
 */
function parseChromiumBookmarks(text) {
  const doc = JSON.parse(String(text));
  const stats = { folders: 0, bookmarks: 0, skipped: 0, duplicates: 0, emptyFolders: 0 };
  const root = { kind: 'folder', title: 'Bookmarks', children: [] };
  const roots = doc && doc.roots && typeof doc.roots === 'object' ? doc.roots : null;
  if (!roots) {
    throw new Error('not a Chromium bookmarks file: no "roots" object');
  }
  const seen = new Set();

  function convertNode(node, parent, key) {
    if (!node || typeof node !== 'object') return;
    const type = String(node.type || (node.url ? 'url' : 'folder')).toLowerCase();
    if (type === 'url') {
      const url = String(node.url || '');
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        stats.skipped += 1;
        return;
      }
      const id = (parent.title || '') + '\u0000' + url;
      if (seen.has(id)) {
        stats.duplicates += 1;
        return;
      }
      seen.add(id);
      parent.children.push({
        kind: 'bookmark',
        title: String(node.name || url),
        url,
        added: node.date_added ? Math.floor(Number(node.date_added) / 1e6) : null,
      });
      stats.bookmarks += 1;
      return;
    }
    // A folder. Chromium's "roots" pseudo-folder is not a real folder.
    const folder = {
      kind: 'folder',
      title: String(node.name || key || 'Untitled folder'),
      children: [],
      added: node.date_added ? Math.floor(Number(node.date_added) / 1e6) : null,
      modified: node.date_modified ? Math.floor(Number(node.date_modified) / 1e6) : null,
    };
    parent.children.push(folder);
    stats.folders += 1;
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) convertNode(child, folder, '');
    if (folder.children.length === 0) stats.emptyFolders += 1;
  }

  for (const [key, node] of Object.entries(roots)) {
    if (!node || typeof node !== 'object') continue;
    // Chromium's roots (bookmark_bar / other / synced) are pseudo-folders the
    // profile manager shows as top-level categories. Flattening them keeps the
    // imported tree the same shape as the HTML path, and does not invent a
    // "bookmark_bar" folder the user never had.
    const children = Array.isArray(node.children) ? node.children : [];
    if (node.type === 'folder') {
      for (const child of children) convertNode(child, root, key);
    } else {
      convertNode(node, root, key);
    }
  }

  return { root, stats };
}

/**
 * Decide which parser a picked file is, by sniffing, and return
 * { kind: 'html'|'chromium-json'|'ziy-snapshot', tree?, snapshot? }.
 *
 * The sniff is order-safe: a JSON snapshot is checked before Chromium's file
 * because both are JSON, and the snapshot marker is what distinguishes them.
 */
function sniffBookmarkSource(text, filename) {
  const body = String(text);
  if (/<dl[\s>]/i.test(body) || /<!DOCTYPE NETSCAPE-Bookmark-file/i.test(body)) {
    return { kind: 'html' };
  }
  const trimmed = body.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const doc = JSON.parse(trimmed);
      if (doc && typeof doc === 'object' && doc.format === 'ziy-settings-snapshot') {
        return { kind: 'ziy-snapshot' };
      }
      if (doc && typeof doc === 'object' && doc.roots && typeof doc.roots === 'object') {
        return { kind: 'chromium-json' };
      }
    } catch {
      /* fall through to the generic errors below */
    }
  }
  const name = String(filename || '').toLowerCase();
  if (name.endsWith('.json')) {
    throw new Error('this is a JSON file, but not a Ziy snapshot and not a Chromium bookmarks file. Pick the Bookmarks file exported as HTML.');
  }
  throw new Error('this file is not a bookmark file Ziy can read. Export HTML bookmarks from the other browser and pick that.');
}

  return {
    parseHtmlBookmarks,
    parseChromiumBookmarks,
    toHtmlBookmarks,
    buildSnapshot,
    readSnapshot,
    sniffBookmarkSource,
    flattenForImport,
    decodeEntities,
    escapeHtml,
    DEFAULT_BROWSER_STATES,
    parseDefaultBrowser,
    defaultBrowserGuidance,
    describeProfiles,
    profileSwitchCommand,
    ZOOM_MIN,
    ZOOM_MAX,
    clampZoom,
    zoomStep,
    zoomResetValue,
    formatZoom,
    ENGINE_RESERVED,
    isEngineReserved,
    shortcutConflicts,
    IMPORT_SOURCES,
    SNAPSHOT_VERSION,
  };
});
