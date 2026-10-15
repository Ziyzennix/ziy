/**
 * ziy-talk background — the event page that owns the durable half of Talk.
 *
 * THE MANIFEST, AND WHY IT IS WHAT IT IS
 * --------------------------------------
 * The decisions that shaped manifest.json, made once and here rather than
 * rediscovered:
 *
 *   background.scripts, not service_worker — Gecko does not implement
 *     background.service_worker (Firefox bug 1573659). See architecture §1.3.
 *   sidebar_action with open_at_install: false — the panel is the Talk surface,
 *     but the engine's default is to open it on install, and a call surface that
 *     yanks itself open on first boot is an intrusion. The user opens Talk when
 *     they want a call.
 *   permissions: storage + tabs, nothing else — Talk's durable state is three
 *     storage.local keys; the only API use is finding the tab that is hosting a
 *     meeting, and intercepting a ziy-talk:// navigation. No host_permissions at
 *     all: the configured Jitsi server is a page the user opens, not an origin
 *     this extension reads on their behalf.
 *   no scripting permission — the Jitsi bridge is declared as a content_script,
 *     which needs no permission, and the MV3 CSP (below) is why we cannot inject
 *     the Jitsi script ourselves.
 *   protocol_handlers is deliberately NOT used — the engine's schema
 *     (extension_protocol_handlers.json) only accepts a fixed list of well-known
 *     protocols or a custom name matching `^(ext|web)\+[a-z0-9.+-]+$`. A bare
 *     `ziy-talk:` cannot be registered, so the scheme is resolved inside this
 *     extension (see resolveScheme below) and the shareable link is the server's
 *     own URL, which is what makes it work across devices.
 *
 * Gecko runs `background.scripts` as an EVENT PAGE in MV3 (no service worker
 * exists on this engine; architecture §1.3), so this file is written to be
 * suspend-safe: every listener is registered at top level, nothing is held in
 * this scope that a later call needs, and every build is idempotent.
 *
 * WHAT LIVES HERE, and why
 * ------------------------
 *   - the settings and recent-rooms records in storage.local, because the panel
 *     is suspended and reopened but the user's choices are not transient
 *   - the answer to "is Talk available here", which mirrors Brave's own
 *     braveTalk.isSupported() contract: false in private windows with Tor
 *   - the interception of ziy-talk:// links, so a Ziy Talk link shared from one
 *     device to another opens the configured server's room
 *
 * The room id, the settings shape, the third-party gate and the chip semantics
 * are all lib/, which is pure. This file is orchestration and storage only.
 *
 * TOR / PRIVATE WINDOWS — the honest mechanism
 * -------------------------------------------
 * Brave's contract is a single function: `braveTalk.isSupported()` returns an
 * error for a Tor profile and true otherwise. Ziy reads the same shape of data
 * from the two sources Gecko exposes to an extension, both verified to exist in
 * this engine's own schema files (browser/omni.ja, chrome/browser/content/
 * browser/schemas/{windows,tabs}.json):
 *
 *   1. `browser.windows.get(windowId).incognito` and `browser.tabs.get(tabId).
 *      incognito` — real booleans on the Window and Tab objects. Fire in
 *      `windows.onFocusChanged` / `tabs.onActivated` / `tabs.onUpdated`.
 *   2. `browser.extension.inIncognitoContext` — documented as "true for content
 *      scripts running inside private browsing tabs and for extension pages
 *      running inside a private browsing process", which is what makes a SIDEBAR
 *      panel able to tell it is itself in a private context. That is the check
 *      the panel uses for its own rendering; the background uses it whenever a
 *      sender tells it where it is.
 *
 * The shell owns the pref `ziy.talk.supported` (architecture §2/§4: the shell
 * gates the sidebar entry and the NTP camera icon). This extension never writes
 * a pref — the engine exposes no preference-writing API to extensions — it only
 * READS the pref if it has been set, and treats a missing pref as "available".
 * When the shell has set it to false, the panel shows the "not available here"
 * state, which is the same thing Brave's isSupported() does.
 */

'use strict';

const ROOM = globalThis.ZiyTalkRoom;
const SETTINGS = globalThis.ZiyTalkSettings;
const CHIPS = globalThis.ZiyTalkChips;

const api = (typeof browser !== 'undefined') ? browser : chrome;

/* ------------------------------------------------------------------ *
 * Late binding: lib/settings.js needs lib/room.js's validators to explain why a
 * value is malformed. Both are loaded as background scripts, so this wires them
 * together once. It is a function call, not an import, because the libs are UMD
 * scripts that share the background page's global scope.
 * ------------------------------------------------------------------ */
SETTINGS.bindRoomHelpers(ROOM);

/* ------------------------------------------------------------------ *
 * Supported-ness, resolved on demand.
 *
 * Order, cheapest and most local first:
 *   1. the caller's own inIncognitoContext (a sidebar panel in a private
 *      process answers this for itself, and it is the most accurate signal for
 *      the thing we care about: is THIS panel in a private window)
 *   2. the window/tab incognito flags, when the caller gave us a location
 *   3. the shell pref ziy.talk.supported, which is the product-level gate
 *
 * A missing pref is treated as "supported" — the pref is the shell's override
 * for a Tor-identity window, and its absence means the shell has not disabled
 * Talk on this profile.
 * ------------------------------------------------------------------ */
async function isSupported(where) {
  if (where && where.inIncognito === true) return false;
  if (where && typeof where.windowId === 'number') {
    try {
      const win = await api.windows.get(where.windowId);
      if (win && win.incognito) return false;
    } catch { /* the window may have closed between the ask and the answer */ }
  }
  if (where && typeof where.tabId === 'number') {
    try {
      const tab = await api.tabs.get(where.tabId);
      if (tab && tab.incognito) return false;
    } catch { /* likewise */ }
  }
  try {
    const prefs = await api.storage.local.get('pref.talk.supported');
    if (prefs['pref.talk.supported'] === false) return false;
  } catch { /* storage is not the place a pref lives; reading the real pref is
               below and is allowed to fail without breaking the panel */ }
  try {
    const local = await api.storage.local.get('ziy.talk.supported');
    if (local['ziy.talk.supported'] === false) return false;
  } catch { /* no shell override */ }
  return true;
}

/** The panel's own view, for its own rendering. */
function currentContext() {
  const ext = api.extension || {};
  return { inIncognito: ext.inIncognitoContext === true };
}

/* ------------------------------------------------------------------ *
 * Message bus.
 *
 * One handler, one shape. Every message is `{kind, ...}` and every reply is a
 * plain object or null. The panel's message() rejects on a restarting background,
 * so nothing here may throw past this point.
 * ------------------------------------------------------------------ */
const HANDLERS = Object.freeze({
  'settings:get': getSettings,
  'settings:set': setSettings,
  'recent:get': getRecent,
  'recent:set': setRecent,
  'recent:remember': rememberRecent,
  'supported:get': async (msg) => ({ supported: await isSupported(currentContext()) }),
  'supported:get-at': async (msg) => ({ supported: await isSupported(msg.where) }),
  'call:command': sendCallCommand,
});

api.runtime.onMessage.addListener((message, sender) => {
  const kind = message && message.kind;
  const handler = HANDLERS[kind];
  if (!handler) return undefined;
  return Promise.resolve()
    .then(() => handler(message, sender))
    .then((result) => result === undefined ? {} : result)
    .catch((err) => {
      // Never let one bad message wedge the event page.
      console.error(`ziy-talk background: ${kind} failed`, err);
      return { error: String(err && err.message ? err.message : err) };
    });
});

/* ------------------------------------------------------------------ *
 * Settings and recent rooms.
 *
 * Storage keys are the ones architecture §3.1 assigns: `talk.room` for the
 * transient TalkRoom, `talk.settings` for the settings bus row, and `talk.recent`
 * for the room list. Everything written goes through normalise, so a record
 * written by an older build self-heals instead of half-loading.
 * ------------------------------------------------------------------ */
async function getSettings() {
  const stored = await api.storage.local.get(SETTINGS.KEY_SETTINGS);
  return { settings: SETTINGS.normaliseSettings(stored[SETTINGS.KEY_SETTINGS]) };
}

async function setSettings(message) {
  const next = SETTINGS.normaliseSettings(message.settings);
  await api.storage.local.set({ [SETTINGS.KEY_SETTINGS]: next });
  return { settings: next };
}

async function getRecent() {
  const stored = await api.storage.local.get(SETTINGS.KEY_RECENT);
  return { recent: SETTINGS.normaliseRecent(stored[SETTINGS.KEY_RECENT]) };
}

async function setRecent(message) {
  const next = SETTINGS.normaliseRecent(message.recent);
  await api.storage.local.set({ [SETTINGS.KEY_RECENT]: next });
  return { recent: next };
}

async function rememberRecent(message) {
  if (!ROOM.isValidRoomId(message.room)) {
    return { recent: (await getRecent()).recent, error: 'not a room id' };
  }
  const current = (await getRecent()).recent;
  const next = SETTINGS.rememberRoom(current, message.room, message.server, Date.now());
  await api.storage.local.set({ [SETTINGS.KEY_RECENT]: next });
  return { recent: next };
}

/* ------------------------------------------------------------------ *
 * The call command, forwarded to the tab that is hosting the meeting.
 *
 * THIS IS THE ONLY PLACE THE CONTROL SURFACE CAN ACTUALLY DRIVE A MEETING, and
 * it is worth spelling out why, because it is the constraint the whole design
 * bends around.
 *
 * Jitsi's External API is a postMessage bridge ("api.executeCommand(command,
 * ...arguments)"), and the panel cannot start it: the MV3 extension CSP forbids
 * a remote script source in extension_pages, and the bridge's scope and
 * allowedOrigin are pinned to the host page's own origin. A tab, by contrast, is
 * a page on the server's origin, where a content script CAN inject the server's
 * own external_api.js — and that is exactly what this handler arranges, by
 * forwarding the command to that tab.
 *
 * Without such an injected bridge (a server that does not ship external_api.js,
 * or a mode where we cannot inject), the command is refused with an error rather
 * than silently swallowed: the caller shows the documented degraded annotation.
 * ------------------------------------------------------------------ */
async function sendCallCommand(message, sender) {
  const command = message.command;
  const chip = CHIPS.CHIPS.find((c) => c.jitsi === command);
  const target = await findMeetingTab(message.room);
  if (!target) {
    return { ok: false, reason: 'no-meeting-tab' };
  }
  try {
    // Ask the tab's content script to execute the command through its bridge.
    // A refusal (no bridge injected, or a command the server does not implement)
    // is a normal answer, not a crash.
    const reply = await api.tabs.sendMessage(target.id, {
      kind: 'jitsi:execute',
      command,
      args: message.args || [],
    }).catch((err) => ({ ok: false, reason: String(err && err.message ? err.message : err) }));
    return Object.assign({ ok: Boolean(reply && reply.ok) }, reply);
  } catch (err) {
    return { ok: false, reason: String(err && err.message ? err.message : err), chip: chip && chip.id };
  }
}

/** The tab currently showing `room`, when there is one. */
async function findMeetingTab(room) {
  if (!room) return null;
  const settings = (await getSettings()).settings;
  const origin = SETTINGS.normaliseServerUrl(settings.serverUrl);
  if (origin === null) return null;
  const url = SETTINGS.buildRoomUrl(origin, room);
  const tabs = await api.tabs.query({});
  return tabs.find((t) => t.url === url || (t.url && t.url.indexOf(`${url}`) === 0)) || null;
}

/* ------------------------------------------------------------------ *
 * ziy-talk://<room> — resolving our own scheme.
 *
 * The route, and why this one: Gecko's manifest schema only permits protocol
 * handlers from a fixed list (bitcoin, geo, irc, mailto, ...) or a custom name
 * matching `^(ext|web)\+[a-z0-9.+-]+$`, so `ziy-talk:` CANNOT be registered as a
 * protocol handler (verified in chrome/toolkit/content/extensions/schemas/
 * extension_protocol_handlers.json in this engine). The supported way to notice a
 * link once the user has it is therefore a navigation listener, not a registered
 * scheme: `tabs.onUpdated` fires with the new URL for every tab this extension
 * can see, and it is the only place that can already rewrite the URL before the
 * user sees a broken page. `webNavigation.onCommitted` would also observe the
 * navigation, but its schema declares the `webNavigation` permission, which this
 * manifest deliberately does not request (it would add a user-visible
 * "Access browser activity during navigation" prompt), and it can only notice
 * the committed URL after the fact — it could never perform the rewrite
 * `tabs.update` does here. So `tabs.onUpdated` is the single implementation.
 * Tabs needs no host permission to observe a navigation the user performed.
 *
 * The scheme therefore resolves to the configured server's room URL, which is a
 * real URL any device can open — that is the whole point: a Ziy link is a
 * portable name for the room, not a second location for it.
 * ------------------------------------------------------------------ */
const SCHEME = /^ziy-talk:\/\/([^/?#]+)/i;

function schemeRoom(url) {
  if (typeof url !== 'string') return null;
  const match = SCHEME.exec(url.trim());
  if (!match) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return ROOM.isValidRoomId(decoded) ? decoded : null;
}

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo && changeInfo.url;
  const room = url ? schemeRoom(url) : null;
  if (!room) return;
  const resolved = await resolveScheme(room);
  if (resolved.error) {
    console.warn('ziy-talk: ' + resolved.error);
    return;
  }
  await api.tabs.update(tabId, { url: resolved.url }).catch(() => {});
}, { properties: ['url'] });

async function resolveScheme(room) {
  const settings = (await getSettings()).settings;
  const origin = SETTINGS.normaliseServerUrl(settings.serverUrl);
  if (origin === null) {
    return { error: 'ziy-talk: no server configured, so the link cannot be opened' };
  }
  const url = SETTINGS.buildRoomUrl(origin, room);
  if (!url) return { error: 'ziy-talk: the configured server is not a usable https address' };
  const list = SETTINGS.rememberRoom((await getRecent()).recent, room, origin, Date.now());
  await api.storage.local.set({ [SETTINGS.KEY_RECENT]: list });
  return { url };
}

/* ------------------------------------------------------------------ *
 * Install: seed the settings once, so the first panel open is the documented
 * default rather than a half-filled record.
 * ------------------------------------------------------------------ */
api.runtime.onInstalled.addListener(async (details) => {
  try {
    const stored = await api.storage.local.get(SETTINGS.KEY_SETTINGS);
    if (!stored[SETTINGS.KEY_SETTINGS]) {
      await api.storage.local.set({ [SETTINGS.KEY_SETTINGS]: SETTINGS.factorySettings() });
    }
  } catch (err) {
    console.error('ziy-talk background: could not seed settings', err);
  }
});
