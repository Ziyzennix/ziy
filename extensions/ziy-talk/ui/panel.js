/**
 * Ziy Talk sidebar panel (recon S39/S40, F11).
 *
 * This file is UI orchestration only: it renders the states, wires the buttons
 * and asks background/background.js for anything that must outlive the panel's
 * suspension. Every domain decision — what a room id is, what a valid setting is,
 * whether a server is someone else's, which chip maps to which command — lives in
 * lib/, which is pure and unit-tested, so this file never re-decides any of it.
 *
 * THE CALL-MODE CONSTRAINT, stated once, honestly
 * ----------------------------------------------
 * Brave's Talk panel embeds a hosted web app in an iframe and talks to it with
 * Jitsi's External API. We cannot do the same in a sidebar panel, and here is
 * the exact reason, verified on this machine rather than assumed: the MV3
 * extension CSP (MDN: "In Manifest V3, all CSP sources that refer to external
 * or non-static content are forbidden in CSP directives covering script
 * content") forbids a remote script source in extension_pages, so
 * `<script src="https://meet.example/external_api.js">` inside our own page
 * cannot load. The External API is not just a script: it is a postMessage
 * bridge whose scope and allowedOrigin are tied to the host page's own origin,
 * so it has to start life as a script in the page that owns the meeting.
 *
 * Ziy therefore has two call modes, both real, neither faked:
 *
 *   "tab"     the meeting is a browser tab at the configured server's room URL.
 *             That page is allowed to load the server's own external_api.js —
 *             it is the server's origin, not ours — so the full control surface
 *             is live and every chip drives the documented command.
 *   "sidebar" the meeting is an iframe in this panel. The iframe works: audio,
 *             video, chat and everything the meeting itself offers. The bridge
 *             does not, so the chips are what they actually are — annotations
 *             naming where each control lives in the meeting window, plus a
 *             link to open the same room in a tab where the controls are live.
 *
 * There is no third hidden mode where the chips appear to work in the sidebar
 * without a bridge. That would be a fake control, which this product refuses.
 *
 * The default is "tab", because it is the mode where the product's control
 * surface is actually in charge. The setting labels the two choices with what
 * they can and cannot do, so the user picks with the facts in front of them.
 */

'use strict';

const ROOM = self.ZiyTalkRoom;
const SETTINGS = self.ZiyTalkSettings;
const CHIPS = self.ZiyTalkChips;
const QR = self.ZiyTalkQR;

const api = (typeof browser !== 'undefined') ? browser : chrome;

/* ------------------------------------------------------------------ *
 * Copy — Ziy's own voice, in one place.
 * ------------------------------------------------------------------ */
const COPY = Object.freeze({
  lobbyTitle: 'Start a call',
  joinTitle: 'Join a call',
  roomTitle: 'Your call is ready',
  recentTitle: 'Recent calls',
  settingsTitle: 'Talk settings',
  unsupported:
    'Talk is not available in private windows with Tor. Open a regular window to start a call.',
  noServer:
    'Ziy is not pointed at a meeting server yet, so there is nowhere to start a call. ' +
    'Add your own Jitsi Meet server in Talk settings.',
  invalidServer:
    'The meeting server in your settings is not a usable https address, so calls cannot start. ' +
    'Fix it in Talk settings.',
  serverUnreachable:
    'The meeting server did not answer, so the call could not start. Check the address in settings and try again.',
  blockedThirdParty:
    'This call would run on a server Ziy does not run. That server sees the call metadata, the room name, ' +
    'and the network address of everyone who joins. Ziy never sees any of it — but you are choosing who does.',
  copyDone: 'Call link copied to your clipboard.',
  copyFailed: 'Could not copy the link. Select it and copy it manually.',
  nameHint: 'Blank is allowed. You can change this later in settings.',
  codesLabel: 'Call link',
  qrCaption:
    'Scan to join from a phone. The code holds the same link as above.',
  cameraDenied:
    'No camera for the preview. Your browser did not grant access; you can still start the call and turn the camera on inside the meeting.',
  cameraMissing:
    'This device has no camera that Ziy can use for a preview. The meeting will say so if it needs one.',
  callOpened: 'The meeting is open in a tab.',
  rejoinDone: 'Rejoining the meeting.',
  qrFailed: 'The link is too long to draw as a QR code.',
  /* the "what this chip can and cannot do" copy */
  degradedNote:
    'The meeting is running inside the panel. Its own controls are live inside the meeting window, ' +
    'but the panel cannot drive them from here, so each control below says where it lives. ' +
    'Open the call in a tab to get the full controls back.',
  chipOpenInTab: 'Open in a tab for full controls',
});

/* ------------------------------------------------------------------ *
 * Element handles
 * ------------------------------------------------------------------ */
const els = {};
for (const id of [
  'talk-live', 'view-unsupported', 'unsupported-body',
  'view-lobby', 'lobby-name', 'lobby-name-hint', 'lobby-preview', 'lobby-video', 'preview-note',
  'btn-start', 'btn-join-open', 'join-form', 'join-input', 'join-error', 'btn-join', 'btn-join-cancel',
  'view-join', 'view-room', 'room-h', 'room-id', 'room-url-label', 'room-server-hint', 'room-qr-figure',
  'room-qr', 'qr-caption', 'btn-copy', 'btn-enter', 'btn-room-done',
  'view-warning', 'warning-h', 'warning-body', 'warning-list', 'btn-warning-accept', 'btn-warning-cancel',
  'warning-remember',
  'view-call', 'call-h', 'call-url', 'chip-bar', 'call-live', 'btn-leave',
  'view-call-sidebar', 'call-s-h', 'meeting-frame', 'call-note', 'chip-bar-degraded', 'call-live-degraded',
  'btn-open-tab', 'btn-leave-sidebar',
  'view-disconnected', 'disc-body', 'btn-rejoin', 'btn-disc-done',
  'view-error', 'error-title', 'error-body', 'btn-error-settings', 'btn-error-retry', 'btn-error-done',
  'view-recent', 'recent-list', 'recent-empty', 'view-settings', 'settings-summary', 'btn-open-settings',
]) {
  els[id] = document.getElementById(id);
}

const VIEWS = [
  'unsupported', 'lobby', 'join', 'room', 'warning', 'call', 'call-sidebar',
  'disconnected', 'error', 'recent', 'settings',
];

/* ------------------------------------------------------------------ *
 * Panel state.
 *
 * `current` holds the id of the view on screen. `pendingRoom` is the room the
 * user has been handed and has not yet entered, so the warning gate can be
 * answered and the call still start. `settings` is always a normalised record,
 * never whatever storage last held.
 * ------------------------------------------------------------------ */
const state = {
  current: 'lobby',
  settings: SETTINGS.factorySettings(),
  supported: true,
  pendingRoom: null,       // { room, server, url }
  activeRoom: null,        // same shape, once entered
  recent: [],
  chips: CHIPS.factoryChipState(),
  callMode: 'tab',         // mirrored from settings.openInNewTab
  previewStream: null,
  warningRemember: false,
};

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */
function show(name) {
  state.current = name;
  for (const view of VIEWS) {
    const el = els['view-' + view];
    if (el) el.hidden = view !== name;
  }
  const live = {
    lobby: 'Talk is ready. Start a call or join with a code.',
    join: 'Enter a room code or link to join a call.',
    room: 'Your call link is ready to share.',
    warning: 'This call would run on a server Ziy does not run.',
    call: 'You are in the call.',
    'call-sidebar': 'The meeting is open in the panel.',
    disconnected: 'The call has ended.',
    error: 'The call could not start.',
    recent: 'Showing recent calls.',
    settings: 'Showing Talk settings.',
    unsupported: 'Talk is not available here.',
  }[name];
  if (live) announce(live);
}

function announce(message) {
  els['talk-live'].textContent = message;
}

function error(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
  const field = el.getAttribute('aria-controls') ? document.getElementById(el.getAttribute('aria-controls')) : null;
  if (field) field.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function message(kind, payload) {
  return api.runtime.sendMessage(Object.assign({ kind }, payload || {})).catch((err) => {
    // A closed or restarting background page must not take the panel down with
    // it; the panel falls back to defaults and says so.
    console.error('ziy-talk panel: message failed', kind, err);
    return null;
  });
}

/* ------------------------------------------------------------------ *
 * Storage-backed settings and recent rooms
 * ------------------------------------------------------------------ */
async function loadSettings() {
  const stored = await message('settings:get');
  state.settings = SETTINGS.normaliseSettings(stored && stored.settings);
  state.callMode = state.settings.openInNewTab ? 'tab' : 'sidebar';
  els['lobby-name'].value = state.settings.displayName || '';
  els['call-note'].textContent = COPY.degradedNote;
  return state.settings;
}

async function loadRecent() {
  const stored = await message('recent:get');
  state.recent = SETTINGS.normaliseRecent(stored && stored.recent);
  renderRecent();
}

async function persistSettings(next) {
  state.settings = SETTINGS.normaliseSettings(Object.assign({}, state.settings, next));
  state.callMode = state.settings.openInNewTab ? 'tab' : 'sidebar';
  await message('settings:set', { settings: state.settings });
  return state.settings;
}

/* ------------------------------------------------------------------ *
 * Rendering: recent rooms
 * ------------------------------------------------------------------ */
function renderRecent() {
  const list = els['recent-list'];
  list.textContent = '';
  els['recent-empty'].hidden = state.recent.length > 0;
  for (const entry of state.recent) {
    const li = document.createElement('li');
    li.className = 'recent__row';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent__code';
    open.dataset.room = entry.room;
    const url = SETTINGS.buildRoomUrl(entry.server, entry.room);
    open.textContent = entry.room;
    open.setAttribute('aria-label',
      `Open call ${entry.room}${url ? ` on ${entry.server}` : ''}`);
    open.addEventListener('click', () => enterRoom(entry.room, entry.server));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--icon recent__remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove call ${entry.room} from recent calls`);
    remove.addEventListener('click', async () => {
      const next = state.recent.filter((r) => r.room !== entry.room);
      state.recent = next;
      await message('recent:set', { recent: next });
      renderRecent();
      announce(`Call ${entry.room} removed from recent calls.`);
    });

    li.append(open, remove);
    list.append(li);
  }
}

/* ------------------------------------------------------------------ *
 * Rendering: the settings summary
 * ------------------------------------------------------------------ */
function renderSettingsSummary() {
  const dl = els['settings-summary'];
  dl.textContent = '';
  const rows = [
    ['Meeting server', state.settings.serverUrl || 'not set'],
    ['Call mode', state.callMode === 'tab' ? 'Open calls in a tab' : 'Keep calls in this panel'],
    ['Join with microphone', state.settings.audioMuted ? 'Muted' : 'On'],
    ['Join with camera', state.settings.videoMuted ? 'Off' : 'On'],
    ['Camera preview in lobby', state.settings.cameraPreview ? 'On' : 'Off'],
    ['Warn before third-party servers', state.settings.warnThirdParty ? 'On' : 'Off'],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
}

/* ------------------------------------------------------------------ *
 * Rendering: the control chips
 *
 * One toolbar, one tab stop per chip (components.md §20). Each chip is a real
 * <button> with aria-pressed and a name that carries its state. The glyphs are
 * inline SVG so there is no icon dependency and no network fetch.
 * ------------------------------------------------------------------ */
const GLYPHS = Object.freeze({
  microphone: {
    off: 'M3 12h18M6 12V8a6 6 0 0 1 12 0v4M6 12v3a6 6 0 0 0 12 0v-3',
    on: 'M3 3l18 18M9 9v3M15 9v3M6 9v3a6 6 0 0 0 9.5 4.9M12 18v3',
  },
  camera: {
    off: 'M2 8.5A1.5 1.5 0 0 1 3.5 7h2L7 5h10l1.5 2h2A1.5 1.5 0 0 1 22 8.5v9A1.5 1.5 0 0 1 20.5 19h-17A1.5 1.5 0 0 1 2 17.5zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    on: 'M2 8.5A1.5 1.5 0 0 1 3.5 7h2L7 5h10l1.5 2h2A1.5 1.5 0 0 1 22 8.5v9A1.5 1.5 0 0 1 20.5 19h-17A1.5 1.5 0 0 1 2 17.5zM2 2l20 20',
  },
  screen: {
    off: 'M3 5h18v11H3zM8 20h8M12 16v4',
    on: 'M3 5h18v11H3zM2 2l20 20',
  },
  chat: {
    off: 'M4 5h16v11H9l-5 4z',
    on: 'M4 5h16v11H9l-5 4zM2 2l20 20',
  },
  hand: {
    off: 'M8 12V6a1.5 1.5 0 0 1 3 0v5m0-1V4.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3l-1.5-2A1.5 1.5 0 0 1 6 11',
    on: 'M8 12V6a1.5 1.5 0 0 1 3 0m-3 12V6a1.5 1.5 0 0 1 3 0m0 6V4.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3l-1.5-2A1.5 1.5 0 0 1 6 11',
  },
  people: {
    off: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5M16 5.5a3 3 0 0 1 0 6M18 20c0-2.2-.7-4.2-2-5.8M21.5 13.5A6.5 6.5 0 0 1 22 20',
    on: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5M16 5.5a3 3 0 0 1 0 6M18 20c0-2.2-.7-4.2-2-5.8M21.5 13.5A6.5 6.5 0 0 1 22 20',
  },
  tiles: {
    off: 'M3 4h7v6H3zM14 4h7v6h-7zM3 14h7v6H3zM14 14h7v6h-7z',
    on: 'M3 4h18v16H3zM3 12h18M12 4v16',
  },
  more: {
    off: 'M5 12h.01M12 12h.01M19 12h.01',
    on: 'M5 12h.01M12 12h.01M19 12h.01',
  },
  leave: {
    off: 'M14 4H5v16h9M11 12h9m-3-3 3 3-3 3',
    on: 'M14 4H5v16h9M11 12h9m-3-3 3 3-3 3',
  },
});

function glyph(id, name) {
  const paths = GLYPHS[id] || GLYPHS.more;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('chip__glyph');
  for (const [key, cls] of [['off', 'chip__glyph--off'], ['on', 'chip__glyph--on']]) {
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', cls);
    const d = paths[key];
    if (!d) continue;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    g.append(path);
    svg.append(g);
  }
  return svg;
}

function buildChips(container, mode) {
  container.textContent = '';
  if (mode === 'degraded') {
    for (const id of ['microphone', 'camera', 'screen', 'chat', 'hand', 'participants', 'tiles']) {
      const fallback = CHIPS.DEGRADED_FALLBACK[id];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip chip--degraded';
      chip.dataset.chip = id;
      chip.setAttribute('aria-disabled', 'true');
      chip.setAttribute('aria-describedby', 'call-note');
      chip.title = fallback.text;
      const label = document.createElement('span');
      label.className = 'chip__text';
      label.textContent = fallback.text;
      chip.append(label);
      container.append(chip);
    }
    /* The one control the panel CAN still offer: hand the meeting to a tab,
       where the bridge exists. */
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'chip chip--degraded';
    open.id = 'chip-open-tab';
    open.textContent = COPY.chipOpenInTab;
    open.addEventListener('click', () => openInTab());
    container.append(open);
    return;
  }

  for (const chip of CHIPS.CHIPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (chip.id === 'leave' ? ' chip--leave' : '');
    btn.dataset.chip = chip.id;
    btn.setAttribute('aria-controls', 'call-live');
    btn.append(glyph(CHIPS.glyph(chip.id), CHIPS.label(chip.id, state.chips)));
    btn.addEventListener('click', () => onChipPress(chip.id));
    container.append(btn);
  }
  syncChips(container);
}

function syncChips(container) {
  for (const btn of container.querySelectorAll('.chip')) {
    const id = btn.dataset.chip;
    if (!id) continue;
    const pressed = CHIPS.pressed(id, state.chips);
    if (pressed !== null) btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.setAttribute('aria-label', CHIPS.label(id, state.chips));
    const disabled = state.chips.call !== 'live' && id !== 'leave';
    if (disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }
  const live = els['call-live'];
  live.textContent = CHIPS.participantsAnnouncement(state.chips);
}

/* ------------------------------------------------------------------ *
 * Chip press — the honest path through lib/chips.js.
 *
 * press() decides what a press means: a real command when the bridge is live,
 * an honest degraded annotation when it is not, or a rejection when there is no
 * call to press against. The panel renders whichever it gets back and never
 * overwrites the answer.
 * ------------------------------------------------------------------ */
function onChipPress(id) {
  const intent = CHIPS.press(id, state.chips);
  if (intent.kind === 'rejected') {
    announce(intent.text);
    return;
  }
  if (intent.kind === 'degraded') {
    // The chip is an annotation, so pressing it says the annotation aloud
    // rather than pretending something happened.
    announce(`${CHIPS.label(id, state.chips)}. ${intent.fallback.text}`);
    return;
  }
  // Reached only in tab mode with a live bridge.
  message('call:command', { command: intent.command, room: state.activeRoom && state.activeRoom.room })
    .then(() => {
      /* The command was sent. The chip's next state comes from the event the
         meeting posts back, not from optimistic local flipping — flipping
         locally would show a state the meeting may have refused. */
      const optimistic = CHIPS.applyEvent(state.chips, 'commandSent', { chip: id });
      state.chips = optimistic;
      syncChips(els['chip-bar']);
    });
}

/* ------------------------------------------------------------------ *
 * The meeting surface
 * ------------------------------------------------------------------ */
function renderCall() {
  if (!state.activeRoom) { show('lobby'); return; }
  show(state.callMode === 'tab' ? 'call' : 'call-sidebar');
  const url = state.activeRoom.url;
  if (state.callMode === 'tab') {
    els['call-url'].textContent = url;
    els['call-url'].href = url;
    state.chips = Object.assign({}, CHIPS.factoryChipState(), {
      bridge: 'live',      // tab mode: the bridge exists on the server's page
      call: 'live',
    });
    buildChips(els['chip-bar'], 'live');
    return;
  }
  // Sidebar mode: the iframe, and the honest degraded chips.
  const frame = els['meeting-frame'];
  frame.textContent = '';
  const loading = document.createElement('p');
  loading.className = 'meeting__loading';
  loading.setAttribute('aria-hidden', 'true');
  loading.textContent = 'Opening the meeting…';
  frame.append(loading);
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.title = 'The meeting';
  iframe.setAttribute('allow', 'camera; microphone; display-capture; fullscreen; autoplay');
  iframe.addEventListener('load', () => loading.remove());
  frame.append(iframe);
  state.chips = Object.assign({}, CHIPS.factoryChipState(), {
    bridge: 'absent',     // no External API from a moz-extension page — see the header
    call: 'live',
  });
  buildChips(els['chip-bar-degraded'], 'degraded');
  els['call-live-degraded'].textContent = CHIPS.participantsAnnouncement(state.chips);
}

function openInTab() {
  if (!state.activeRoom) return;
  const url = state.activeRoom.url;
  api.tabs.create({ url }).catch((err) => {
    console.error('ziy-talk panel: could not open a tab', err);
    showError(COPY.serverUnreachable);
  });
  announce(COPY.callOpened);
  show('call');
}

/* ------------------------------------------------------------------ *
 * Room entry — the gate, the handoff, the persistence.
 * ------------------------------------------------------------------ */
async function buildRoom(roomId, server) {
  const trust = SETTINGS.serverTrust(state.settings, server);
  if (!trust.configured) return { error: state.settings.serverUrl ? COPY.invalidServer : COPY.noServer };
  const url = SETTINGS.buildRoomUrl(trust.origin, roomId);
  if (!url) return { error: COPY.invalidServer };
  return { room: { room: roomId, server: trust.origin, url }, trust };
}

async function enterRoom(roomId, server) {
  const built = await buildRoom(roomId, server);
  if (built.error) { showError(built.error); return; }
  if (built.trust.requiresConfirmation) { askThirdParty(built.room, built.trust); return; }
  startRoom(built.room);
}

function askThirdParty(room, trust) {
  state.pendingRoom = room;
  els['warning-body'].textContent = COPY.blockedThirdParty;
  const list = els['warning-list'];
  list.textContent = '';
  for (const item of [
    `The meeting runs at ${trust.origin}, on hardware Ziy does not control.`,
    'That operator can see who joined, when, and the room name.',
    'Ziy never sees your call, your name or your address — and neither does any server of ours.',
  ]) {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  }
  state.warningRemember = false;
  els['warning-remember'].checked = false;
  show('warning');
}

async function startRoom(room) {
  state.activeRoom = room;
  state.chips = Object.assign({}, CHIPS.factoryChipState(), {
    bridge: state.callMode === 'tab' ? 'live' : 'absent',
    call: 'live',
  });
  await message('recent:remember', { room: room.room, server: room.server });
  await loadRecent();
  renderCall();
  announce(`Call ${room.room} started.`);
}

/* ------------------------------------------------------------------ *
 * The "ready to share" room view: id, link, QR, copy.
 * ------------------------------------------------------------------ */
function renderRoom(room) {
  els['room-id'].textContent = room.url;
  els['room-server-hint'].textContent =
    room.server === SETTINGS.PUBLIC_TEST_SERVER
      ? `This call runs on ${SETTINGS.PUBLIC_TEST_SERVER_LABEL}, a server Ziy does not run.`
      : `This call runs on your own server, ${room.server}.`;
  els['qr-caption'].textContent = COPY.qrCaption;
  const canvas = els['room-qr'];
  canvas.textContent = '';
  const symbol = QR.matrix(room.url);
  if (!symbol) {
    const note = document.createElement('p');
    note.className = 'field__hint';
    note.textContent = COPY.qrFailed;
    canvas.append(note);
  } else {
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.id = 'room-qr-label';
    label.textContent = `QR code for ${room.url}`;
    canvas.append(label);
    canvas.insertAdjacentHTML('beforeend', QR.toSvg(symbol, { scale: 5, quiet: 4 }));
    const svg = canvas.querySelector('svg');
    if (svg) {
      svg.setAttribute('aria-labelledby', 'room-qr-label');
    }
  }
  show('room');
}

/* ------------------------------------------------------------------ *
 * Error / unsupported / disconnected
 * ------------------------------------------------------------------ */
function showError(body) {
  els['error-body'].textContent = body;
  show('error');
}

function showUnsupported() {
  els['unsupported-body'].textContent = COPY.unsupported;
  show('unsupported');
}

/* ------------------------------------------------------------------ *
 * Start-a-call
 * ------------------------------------------------------------------ */
async function startCall() {
  const settings = state.settings;
  const trust = SETTINGS.serverTrust(settings, settings.serverUrl);
  if (!trust.configured) {
    showError(settings.serverUrl ? COPY.invalidServer : COPY.noServer);
    return;
  }
  let roomId;
  try {
    roomId = ROOM.generateRoomId();
  } catch (err) {
    // The generator refuses to fall back to a non-cryptographic source. A room
    // that would be predictable is worse than no room, so the panel says so.
    console.error('ziy-talk panel: no cryptographic randomness', err);
    showError(
      'Ziy could not find a source of strong randomness, so it will not create a room id it cannot keep private. ' +
      'This is a browser problem, not a network one.'
    );
    return;
  }
  await persistSettings({ displayName: els['lobby-name'].value });
  if (trust.requiresConfirmation) {
    const built = await buildRoom(roomId, settings.serverUrl);
    if (built.error) { showError(built.error); return; }
    askThirdParty(built.room, trust);
    return;
  }
  const built = await buildRoom(roomId, settings.serverUrl);
  if (built.error) { showError(built.error); return; }
  state.pendingRoom = built.room;
  renderRoom(built.room);
}

/* ------------------------------------------------------------------ *
 * Join
 * ------------------------------------------------------------------ */
async function joinCall(event) {
  event.preventDefault();
  const parsed = ROOM.parseRoomInput(els['join-input'].value);
  if (parsed.error) { error(els['join-error'], parsed.error); els['join-input'].focus(); return; }
  error(els['join-error'], '');
  await enterRoom(parsed.roomId, state.settings.serverUrl);
}

/* ------------------------------------------------------------------ *
 * Clipboard
 * ------------------------------------------------------------------ */
async function copyLink() {
  if (!state.pendingRoom) return;
  const text = state.pendingRoom.url;
  try {
    await navigator.clipboard.writeText(text);
    const btn = els['btn-copy'];
    btn.textContent = 'Copied';
    btn.setAttribute('aria-label', 'Call link copied to your clipboard');
    announce(COPY.copyDone);
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy the call link');
    }, 2000);
  } catch (err) {
    console.error('ziy-talk panel: clipboard failed', err);
    announce(COPY.copyFailed);
    els['room-id'].setAttribute('tabindex', '-1');
    els['room-id'].focus();
  }
}

/* ------------------------------------------------------------------ *
 * Camera preview
 * ------------------------------------------------------------------ */
async function maybePreview() {
  const box = els['lobby-preview'];
  if (!state.settings.cameraPreview) { box.hidden = true; return; }
  box.hidden = false;
  const note = els['preview-note'];
  note.hidden = true;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('no mediaDevices');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    state.previewStream = stream;
    els['lobby-video'].srcObject = stream;
    await els['lobby-video'].play().catch(() => {});
  } catch (err) {
    note.hidden = false;
    note.textContent = err && err.name === 'NotFoundError' ? COPY.cameraMissing : COPY.cameraDenied;
  }
}

function stopPreview() {
  if (state.previewStream) {
    for (const track of state.previewStream.getTracks()) track.stop();
    state.previewStream = null;
  }
  els['lobby-video'].srcObject = null;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
function wire() {
  els['btn-start'].addEventListener('click', () => {
    stopPreview();
    startCall();
  });
  els['btn-join-open'].addEventListener('click', () => {
    els['btn-join-open'].setAttribute('aria-expanded', 'true');
    show('join');
    els['join-input'].focus();
  });
  els['btn-join-cancel'].addEventListener('click', () => {
    els['btn-join-open'].setAttribute('aria-expanded', 'false');
    show('lobby');
  });
  els['join-form'].addEventListener('submit', joinCall);
  els['btn-copy'].addEventListener('click', copyLink);
  els['btn-enter'].addEventListener('click', () => {
    if (!state.pendingRoom) return;
    stopPreview();
    const room = state.pendingRoom;
    state.pendingRoom = null;
    startRoom(room);
  });
  els['btn-room-done'].addEventListener('click', () => { state.pendingRoom = null; show('lobby'); });
  els['btn-warning-accept'].addEventListener('click', async () => {
    const room = state.pendingRoom;
    const remember = state.warningRemember;
    if (remember) await persistSettings({ warnThirdParty: false });
    state.pendingRoom = null;
    if (room) startRoom(room);
  });
  els['btn-warning-cancel'].addEventListener('click', () => { state.pendingRoom = null; show('lobby'); });
  els['warning-remember'].addEventListener('change', (e) => {
    state.warningRemember = e.target.checked;
  });
  els['btn-leave'].addEventListener('click', () => {
    message('call:command', { command: 'hangup', room: state.activeRoom && state.activeRoom.room });
    endCall();
  });
  els['btn-leave-sidebar'].addEventListener('click', () => {
    const frame = els['meeting-frame'];
    frame.textContent = '';
    endCall();
  });
  els['btn-open-tab'].addEventListener('click', openInTab);
  els['btn-rejoin'].addEventListener('click', () => {
    const room = state.activeRoom;
    if (room) startRoom(room);
  });
  els['btn-disc-done'].addEventListener('click', () => { state.activeRoom = null; show('lobby'); });
  els['btn-error-settings'].addEventListener('click', () => api.runtime.openOptionsPage());
  els['btn-error-retry'].addEventListener('click', () => {
    if (state.activeRoom) startRoom(state.activeRoom);
    else show('lobby');
  });
  els['btn-error-done'].addEventListener('click', () => show('lobby'));
  els['btn-open-settings'].addEventListener('click', () => api.runtime.openOptionsPage());
  window.addEventListener('pagehide', stopPreview);

  // The panel is a sidebar page, so it is suspended and resumed rather than
  // reloaded. Storage changes made by the options page or the background must
  // therefore be picked up while it is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(changes)) {
      if (key.startsWith('talk.')) { loadSettings(); loadRecent(); renderSettingsSummary(); return; }
    }
  });
}

function endCall() {
  state.chips = Object.assign({}, CHIPS.factoryChipState(), { call: 'ended' });
  els['disc-body'].textContent = `You left call ${state.activeRoom ? state.activeRoom.room : ''}.`;
  show('disconnected');
  announce('The call has ended.');
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
async function boot() {
  wire();
  const supported = await message('supported:get');
  state.supported = !supported || supported.supported !== false;
  await loadSettings();
  await loadRecent();
  if (!state.supported) { showUnsupported(); return; }
  renderSettingsSummary();
  if (!state.settings.serverUrl) {
    // The shipped default is a reserved-invalid origin: the honest first-run
    // state is "no server configured", said in the settings summary rather than
    // as a blocking error, because the panel is still useful for joining.
    els['settings-summary'].append(Object.assign(document.createElement('p'), {
      className: 'field__hint',
      textContent: COPY.noServer,
    }));
  }
  show('lobby');
  maybePreview();
  announce('Talk panel opened. Start a call or join with a code.');
}

boot().catch((err) => {
  console.error('ziy-talk panel: boot failed', err);
  showError('The Talk panel could not start. Try closing and reopening the panel.');
});
