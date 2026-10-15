/**
 * Ziy Talk options page (recon S40).
 *
 * Same division as the panel: every domain decision is lib/settings.js's, and
 * this file renders and validates. The validators are called through the model
 * rather than re-implemented, so a rule that changes (an https origin only, note
 * ever a credential-bearing one) changes in exactly one place.
 *
 * The privacy note is generated from the settings rather than written twice, so
 * it can never drift from what the product actually does.
 */

'use strict';

const ROOM = self.ZiyTalkRoom;
const SETTINGS = self.ZiyTalkSettings;

const api = (typeof browser !== 'undefined') ? browser : chrome;

const els = {
  form: document.getElementById('options-form'),
  live: document.getElementById('options-live'),
  server: document.getElementById('opt-server'),
  serverError: document.getElementById('opt-server-error'),
  serverHint: document.getElementById('opt-server-hint'),
  serverField: document.getElementById('opt-server'),
  publicButton: document.getElementById('btn-public-server'),
  privacyBody: document.getElementById('privacy-body'),
  name: document.getElementById('opt-name'),
  audio: document.getElementById('opt-audio'),
  video: document.getElementById('opt-video'),
  preview: document.getElementById('opt-preview'),
  prejoin: document.getElementById('opt-prejoin'),
  warn: document.getElementById('opt-warn'),
  sounds: document.getElementById('opt-sounds'),
  mode: Array.from(document.querySelectorAll('input[name="call-mode"]')),
  recent: document.getElementById('options-recent'),
  recentEmpty: document.getElementById('options-recent-empty'),
  clearRecent: document.getElementById('btn-clear-recent'),
  save: document.getElementById('btn-save'),
  reset: document.getElementById('btn-reset'),
  saveState: document.getElementById('save-state'),
};

const state = { settings: SETTINGS.factorySettings(), recent: [], dirty: false };

function announce(message) {
  els.live.textContent = message;
}

function setSaveState(message, kind) {
  els.saveState.textContent = message;
  els.saveState.className = 'save-state' + (kind ? ' save-state--' + kind : '');
}

/* ------------------------------------------------------------------ *
 * The privacy note, built from the model.
 * ------------------------------------------------------------------ */
function renderPrivacyNote() {
  const origin = SETTINGS.normaliseServerUrl(state.settings.serverUrl);
  const isPublic = origin === SETTINGS.PUBLIC_TEST_SERVER;
  if (origin === null) {
    els.privacyBody.textContent =
      'No server is set yet, so Ziy has nowhere to send a call. That is the honest default: ' +
      'Ziy does not run a call service and will not imply one.';
    return;
  }
  els.privacyBody.textContent = isPublic
    ? `The public test server (${SETTINGS.PUBLIC_TEST_SERVER}) is run by a third party. They can see ` +
      'the room name, who joined, when, and the network addresses of everyone in the call. ' +
      'Ziy sees none of it, because Ziy is not in the call.'
    : `This server is the one you named. Its operator — which is you — can see the call's metadata ` +
      'on their own hardware. Ziy sees none of it: Ziy only navigates you to the room link, holds ` +
      'your room list on this device, and never touches the call’s media.';
}

/* ------------------------------------------------------------------ *
 * Form <-> model
 * ------------------------------------------------------------------ */
function fillForm() {
  els.server.value = state.settings.serverUrl || '';
  els.name.value = state.settings.displayName || '';
  els.audio.checked = Boolean(state.settings.audioMuted);
  els.video.checked = Boolean(state.settings.videoMuted);
  els.preview.checked = Boolean(state.settings.cameraPreview);
  els.prejoin.checked = Boolean(state.settings.preMeetingScreen);
  els.warn.checked = Boolean(state.settings.warnThirdParty);
  els.sounds.checked = Boolean(state.settings.sounds);
  for (const radio of els.mode) {
    radio.checked = state.settings.openInNewTab ? radio.value === 'tab' : radio.value === 'sidebar';
  }
  renderPrivacyNote();
  renderRecent();
}

function readForm() {
  const next = {
    serverUrl: els.server.value,
    displayName: els.name.value,
    audioMuted: els.audio.checked,
    videoMuted: els.video.checked,
    cameraPreview: els.preview.checked,
    preMeetingScreen: els.prejoin.checked,
    warnThirdParty: els.warn.checked,
    sounds: els.sounds.checked,
    openInNewTab: els.mode.find((r) => r.checked)?.value === 'tab',
  };
  return SETTINGS.serialiseSettings(Object.assign({}, state.settings, next));
}

/* ------------------------------------------------------------------ *
 * Validation, through the model's own field validators.
 *
 * The error is tied to the field with aria-describedby + aria-invalid and the
 * field is announced with role="alert" when validation fails, per the
 * components.md error-state convention.
 * ------------------------------------------------------------------ */
function validateServerField(value) {
  const field = SETTINGS.FIELDS.find((f) => f.key === 'serverUrl');
  const problem = field.validate(value);
  els.serverError.textContent = problem || '';
  els.serverError.hidden = !problem;
  els.serverField.setAttribute('aria-invalid', problem ? 'true' : 'false');
  return problem === null;
}

function renderRecent() {
  els.recent.textContent = '';
  els.recentEmpty.hidden = state.recent.length > 0;
  for (const entry of state.recent) {
    const li = document.createElement('li');
    li.className = 'recent__row';
    const code = document.createElement('p');
    code.className = 'recent__code';
    code.style.cursor = 'default';
    const url = SETTINGS.buildRoomUrl(entry.server, entry.room);
    code.textContent = url || entry.room;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--icon recent__remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove call ${entry.room} from recent calls`);
    remove.addEventListener('click', async () => {
      state.recent = state.recent.filter((r) => r.room !== entry.room);
      await api.storage.local.set({ 'talk.recent': state.recent });
      renderRecent();
      announce(`Call ${entry.room} removed.`);
    });
    li.append(code, remove);
    els.recent.append(li);
  }
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */
async function load() {
  const stored = await api.storage.local.get([SETTINGS.KEY_SETTINGS, SETTINGS.KEY_RECENT]);
  state.settings = SETTINGS.normaliseSettings(stored[SETTINGS.KEY_SETTINGS]);
  state.recent = SETTINGS.normaliseRecent(stored[SETTINGS.KEY_RECENT]);
  fillForm();
  setSaveState('Settings loaded.', 'ok');
}

async function save(event) {
  event.preventDefault();
  const value = els.server.value;
  if (!validateServerField(value)) {
    els.server.focus();
    setSaveState('Fix the server address before saving.', 'err');
    announce('The server address is not valid, so nothing was saved.');
    return;
  }
  const next = readForm();
  await api.storage.local.set({
    [SETTINGS.KEY_SETTINGS]: next,
  });
  state.settings = next;
  state.dirty = false;
  renderPrivacyNote();
  setSaveState('Saved.', 'ok');
  announce('Talk settings saved.');
  document.dispatchEvent(new CustomEvent('ziy-talk-settings-saved', { detail: next }));
}

function markDirty() {
  state.dirty = true;
  if (els.serverError.hidden) setSaveState('Not saved yet.', null);
  els.server.removeEventListener('input', onServerInput);
  els.server.addEventListener('input', onServerInput);
}

function onServerInput() {
  if (els.server.value === state.settings.serverUrl) { markDirty(); return; }
  markDirty();
  renderPrivacyNote();
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
function wire() {
  els.form.addEventListener('submit', save);
  els.server.addEventListener('input', () => { markDirty(); renderPrivacyNote(); });
  els.server.addEventListener('blur', () => {
    // Validate on blur with whatever is typed, but only when there is something
    // to complain about: an empty field is "not configured", not an error.
    if (els.server.value.trim() === '') { validateServerField(''); }
  });
  els.publicButton.addEventListener('click', () => {
    els.server.value = SETTINGS.PUBLIC_TEST_SERVER;
    validateServerField(els.server.value);
    markDirty();
    renderPrivacyNote();
    announce(
      'Public test server selected. Ziy will warn you before every call on it, ' +
      'because that operator can see who joins and the room name.'
    );
    els.server.focus();
  });
  els.clearRecent.addEventListener('click', async () => {
    state.recent = [];
    await api.storage.local.set({ [SETTINGS.KEY_RECENT]: [] });
    renderRecent();
    announce('All recent calls removed.');
  });
  els.reset.addEventListener('click', async () => {
    const defaults = SETTINGS.factorySettings();
    await api.storage.local.set({ [SETTINGS.KEY_SETTINGS]: defaults });
    state.settings = defaults;
    fillForm();
    setSaveState('Defaults restored and saved.', 'ok');
    announce('Talk settings restored to the defaults and saved.');
  });
  for (const control of [els.name, els.audio, els.video, els.preview, els.prejoin, els.warn, els.sounds, ...els.mode]) {
    control.addEventListener('input', markDirty);
  }
}

wire();
load().catch((err) => {
  console.error('ziy-talk options: could not load', err);
  setSaveState('Could not load your settings.', 'err');
});
