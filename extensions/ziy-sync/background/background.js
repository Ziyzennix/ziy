/**
 * ziy-sync background — the event page that owns the chain.
 *
 * Gecko runs `background.scripts` as an EVENT PAGE in MV3 (there is no
 * service-worker implementation; architecture §1.3 and
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background),
 * so anything that must survive a suspension lives in browser.storage.local or
 * in the native agent, never in this scope.
 *
 * WHAT LIVES WHERE, and why that is the whole design
 * --------------------------------------------------
 * Browser side (this file + the options page):
 *   - the settings bus (`settings.*`) that the shared settings surface reads
 *   - per-category send/receive toggles, mirrored for the options UI
 *   - the bookmark/history listeners that record local changes as syncable
 *   - the native-messaging port to the agent
 *
 * Native agent (native/ziy-sync-agent):
 *   - the BIP-39 seed, the Ed25519 private key, the derived keys, the chain id
 *   - all encryption, all signatures, all HTTP to the sync server
 *
 * The browser never sees a word of the code after the user has typed it, and
 * never sees a derived key. This file's job is orchestration, not crypto.
 */

import { SyncClient } from "../lib/client.js";
import { CATEGORIES } from "../lib/keyderivation.js";
import { categoryGate } from "../lib/record.js";

const NATIVE_HOST_NAME = "ziy-sync-agent";
const STORAGE_KEY = "ziy.sync.state";
const DEFAULT_SERVER = "http://127.0.0.1:8484";

/** The state the options page reads and writes. */
const defaultState = {
  inChain: false,
  chainId: null,
  deviceId: null,
  deviceName: "Ziy desktop",
  deviceType: "desktop",
  lastSyncAt: null,
  categories: {},          // {bookmarks: {send:true, receive:true}, ...}
  serverUrl: DEFAULT_SERVER,
  rotatingWordBucket: null,
  rotatingWordOffline: false,
  lastError: null,
};

async function loadState() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const state = { ...defaultState, ...(stored[STORAGE_KEY] || {}) };
  if (!Object.keys(state.categories).length) {
    const gate = categoryGate(CATEGORIES);
    state.categories = Object.fromEntries(CATEGORIES.map((c) => [c, gate[c]]));
  }
  return state;
}

async function saveState(state) {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
}

/** Connect to the native agent, keeping one port per event-page lifetime. */
let agentPort = null;
function agent() {
  if (agentPort) return agentPort;
  agentPort = browser.runtime.connectNative(NATIVE_HOST_NAME);
  agentPort.onDisconnect.addListener(() => {
    agentPort = null;
  });
  return agentPort;
}

/**
 * One request to the agent, answered with one reply.
 * A request/response pair over a port is matched by a per-call id because MDN's
 * Port messaging is not itself request/response.
 */
function agentRequest(payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const port = agent();
    const id = `req-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const timer = setTimeout(() => {
      reject(new Error(`the sync agent did not answer ${payload.op} in time`));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!message || message.id !== id) return;
      port.onMessage.removeListener(onMessage);
      clearTimeout(timer);
      if (message.ok) resolve(message.result);
      else reject(Object.assign(new Error(message.message || message.error || "agent error"), { code: message.error }));
    };
    port.onMessage.addListener(onMessage);
    port.postMessage({ id, op: payload.op, ...payload });
  });
}

/* ------------------------------------------------------------------------- */
/* chain lifecycle                                                            */
/* ------------------------------------------------------------------------- */

async function startChain({ words, deviceName, deviceType, serverUrl } = {}) {
  const result = await agentRequest({
    op: "chain.create",
    words,
    device_name: deviceName || "Ziy desktop",
    device_type: deviceType || "desktop",
  });
  await persistChain({ chainId: result.chain_id, deviceId: result.device_id, deviceName: result.device_name, deviceType: result.device_type, serverUrl });
  return result;
}

async function joinChain({ words, chainId, deviceName, serverUrl } = {}) {
  const result = await agentRequest({
    op: "chain.join",
    words,
    chain_id: chainId,
    device_name: deviceName || "Ziy desktop",
  });
  await persistChain({ chainId: result.chain_id, deviceId: result.device_id, deviceName: result.device_name, serverUrl });
  return result;
}

async function persistChain({ chainId, deviceId, deviceName, deviceType, serverUrl }) {
  const state = await loadState();
  state.inChain = true;
  state.chainId = chainId;
  state.deviceId = deviceId;
  if (deviceName) state.deviceName = deviceName;
  if (deviceType) state.deviceType = deviceType;
  if (serverUrl) state.serverUrl = serverUrl;
  state.lastError = null;
  await saveState(state);
  broadcast({ type: "chain-changed", state });
}

async function leaveChain() {
  const result = await agentRequest({ op: "chain.leave" });
  const state = await loadState();
  state.inChain = false;
  state.chainId = null;
  state.deviceId = null;
  state.lastSyncAt = null;
  await saveState(state);
  broadcast({ type: "chain-changed", state });
  return result;
}

/* ------------------------------------------------------------------------- */
/* sync                                                                       */
/* ------------------------------------------------------------------------- */

/** Local records we hold, in the shape the agent expects on a push. */
async function readLocalRecords() {
  const stored = await browser.storage.local.get("ziy.sync.records");
  return stored["ziy.sync.records"] || {};
}

async function writeLocalRecords(records) {
  await browser.storage.local.set({ "ziy.sync.records": records });
}

/**
 * Record a local change as a syncable record. The plaintext is written to
 * storage.local (which is what the options page and the record listeners share)
 * and the agent is told to push it; the agent re-reads the same value, encrypts
 * and signs it there, so the plaintext never leaves the profile in the clear
 * over the network.
 */
async function queueRecord(category, recordId, value, tombstone = false) {
  const state = await loadState();
  const gate = state.categories[category];
  if (!gate || !gate.send) return { skipped: "category-send-off" };
  const records = await readLocalRecords();
  records[category] = records[category] || {};
  records[category][recordId] = { value, tombstone, updatedAt: Math.floor(Date.now() / 1000) };
  await writeLocalRecords(records);
  return { queued: true };
}

/** Push everything queued, then pull the delta. */
async function syncNow() {
  const state = await loadState();
  if (!state.inChain) {
    throw new Error("This device is not part of a sync chain yet.");
  }
  const records = await readLocalRecords();
  const outgoing = [];
  for (const [category, byId] of Object.entries(records)) {
    for (const [recordId, entry] of Object.entries(byId)) {
      outgoing.push({ category, record_id: recordId, value: entry.value, tombstone: Boolean(entry.tombstone) });
    }
  }
  const result = await agentRequest({ op: "sync.now", records: outgoing });
  const after = await loadState();
  after.lastSyncAt = Math.floor(Date.now() / 1000);
  after.lastError = null;
  await saveState(after);
  broadcast({ type: "sync-progress", state: after, pushed: result.pushed?.length ?? 0, pulled: result.pulled ?? 0 });
  return result;
}

/* ------------------------------------------------------------------------- */
/* bookmark / history listeners                                               */
/* ------------------------------------------------------------------------- */

/**
 * A bookmark change becomes a syncable record. The record id is the bookmark's
 * uuid, so editing the same bookmark twice updates one record rather than
 * creating two — which is what makes last-writer-wins meaningful.
 */
async function bookmarkRecord(id, node) {
  const payload = {
    id: node.id,
    title: node.title,
    url: node.url || null,
    parentGuid: node.parentGuid || null,
    index: node.index ?? null,
    dateAdded: node.dateAdded ?? null,
  };
  return queueRecord("bookmarks", node.id, payload);
}

if (typeof browser !== "undefined" && browser.bookmarks) {
  browser.bookmarks.onCreated.addListener((id, node) => { bookmarkRecord(id, node).catch(() => {}); });
  browser.bookmarks.onChanged.addListener((id, info) => { bookmarkRecord(id, { id, ...info }).catch(() => {}); });
  browser.bookmarks.onRemoved.addListener((id) => {
    queueRecord("bookmarks", id, null, true).catch(() => {});
  });
  browser.bookmarks.onMoved.addListener((id, info) => {
    bookmarkRecord(id, { id, ...info }).catch(() => {});
  });
}

/* ------------------------------------------------------------------------- */
/* messages from the options page and other extensions                        */
/* ------------------------------------------------------------------------- */

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object" || !message.op) return undefined;
  const op = message.op;

  // (a) chain lifecycle
  if (op === "ziy-sync/state") {
    return loadState();
  }
  if (op === "ziy-sync/capabilities") {
    return agentRequest({ op: "capabilities" });
  }
  if (op === "ziy-sync/start-chain") {
    return agentRequest({ op: "chain.create" }).then((r) => r);
  }
  if (op === "ziy-sync/create-chain") {
    return startChain(message);
  }
  if (op === "ziy-sync/join-chain") {
    return joinChain(message);
  }
  if (op === "ziy-sync/leave-chain") {
    return leaveChain();
  }
  if (op === "ziy-sync/sync-now") {
    return syncNow();
  }
  if (op === "ziy-sync/set-category") {
    return setCategoryToggle(message.category, message.patch);
  }
  if (op === "ziy-sync/devices") {
    return agentRequest({ op: "devices.list" });
  }
  if (op === "ziy-sync/remove-device") {
    return agentRequest({ op: "devices.remove", device_id: message.device_id });
  }
  if (op === "ziy-sync/delete-account") {
    return agentRequest({ op: "account.delete", confirm: "DELETE" });
  }
  if (op === "ziy-sync/challenge") {
    // The options page's join flow asks for a fresh chain code to display, so
    // the words are generated and shown once in the browser, then handed to the
    // agent which never stores them in readable form.
    return agentRequest({ op: "chain.create", words: undefined });
  }
  return undefined;
});

/** Toggle one category's send/receive, locally and in the agent. */
async function setCategoryToggle(category, patch) {
  if (!CATEGORIES.includes(category)) throw new Error(`unknown category "${category}"`);
  const state = await loadState();
  state.categories[category] = { ...state.categories[category], ...patch };
  await saveState(state);
  await agentRequest({ op: "chain.set-category", category, ...patch });
  broadcast({ type: "category-changed", category, patch });
  return state.categories[category];
}

/* ------------------------------------------------------------------------- */
/* options-page bridge                                                        */
/* ------------------------------------------------------------------------- */

/**
 * The options page is an extension page under a chrome-extension:// origin, so
 * it can import the same modules we do and send messages to this background.
 * Rather than duplicating state, the page asks and the background answers.
 */
function broadcast(message) {
  try {
    browser.runtime.sendMessage(message).catch(() => {});
  } catch {
    /* no listener: the options page is closed */
  }
}

// A periodic sync while a chain is active. An event page cannot rely on timers,
// but an alarm survives suspension and is the documented mechanism.
if (typeof browser !== "undefined" && browser.alarms) {
  browser.alarms.create("ziy-sync-periodic", { periodInMinutes: 15 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "ziy-sync-periodic") {
      loadState().then((state) => (state.inChain ? syncNow() : null)).catch(() => {});
    }
  });
}
