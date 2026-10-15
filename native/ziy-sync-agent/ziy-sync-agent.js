#!/usr/bin/env node
/**
 * ziy-sync-agent — the Ziy native messaging host for the sync chain.
 *
 * WHAT THIS EXISTS FOR
 * --------------------
 * Ziy keeps chain material (the seed, the device private key) out of
 * browser-accessible storage, per architecture.md §3.1: "SyncChain, SyncRecord
 * | native SQLite (ziy-sync-agent) | credentials and the key must never sit in
 * browser-accessible storage". This process is that out-of-browser home. The
 * extension asks it for operations; it never sees the seed it is not given.
 *
 * WHAT IT DOES
 * ------------
 * 1. Creates a chain from a 24-word code (plus today's rotating word) and a
 *    chain id, deriving the AES record key and the Ed25519 device keypair.
 * 2. Joins an existing chain from a code another device published.
 * 3. Syncs: pulls the server's delta for its enabled categories, pushes local
 *    changes, folds both into a last-writer-wins view.
 * 4. Deletes everything on leave: the SQLite rows AND the server's blob cache.
 *
 * IT DOES NOT
 * -----------
 * - hold the word code after initialisation — only the derived seed, and only
 *   to re-derive per-record keys; the seed is stored AES-encrypted under a key
 *   held in a file mode 0600 alongside the DB (see store.js)
 * - log anything that could identify a record's content
 * - talk to any endpoint but the one operator-configured sync server
 *
 * PERSISTENCE
 * -----------
 * node:sqlite (available in the installed Node 26; checked with
 * `node -e "require('node:sqlite')"`, which succeeds — recorded in
 * replica/proofs-sync.md). The schema is replica/schema.sql's native block.
 *
 * PROTOCOL (stdio, MDN native messaging)
 * ---------------------------------------
 * Requests are one JSON object each: {"op": "...", ...}
 * Replies are one JSON object each: {"ok": true, ...} or {"ok": false, "error": "..."}
 */

import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeMessageReader, NativeMessageWriter, ALLOWED_EXTENSION_ID } from "./lib/native-protocol.js";
import { SyncAgentStore } from "./lib/store.js";
import { handleChainCreate, handleChainJoin, handleChainStatus } from "./lib/ops-chain.js";
import { handlePush, handlePull, handleSync } from "./lib/ops-sync.js";
import { handleDevices, handleDeviceRemove, handleChainLeave, handleAccountDelete } from "./lib/ops-admin.js";
import { handleCapabilities } from "./lib/ops-info.js";
import { fetchRotatingWord, ChainKeys } from "./lib/ziy-crypto.js";
import { loadDeviceIdentity } from "./lib/device-identity.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fallback data dir. Overridable so tests never touch the real one.
 * Default: $ZIY_SYNC_DATA_DIR, else ~/.ziy/sync-agent.
 */
function defaultDataDir() {
  return process.env.ZIY_SYNC_DATA_DIR || path.join(process.env.HOME || "/tmp", ".ziy", "sync-agent");
}

/**
 * Rebuild this process's in-memory chain session from the SQLite store.
 *
 * The browser launches the agent, may let it be killed, and launches it again —
 * MDN: the browser sends SIGTERM then SIGKILL to close a native host, and a new
 * connection starts a new process. So the chain material must come back from
 * disk on every launch, and NOTHING is trusted from the launch arguments. This
 * is why the seed lives encrypted in the agent's own directory (store.js) rather
 * than in the browser: the browser cannot rehydrate it, and neither can anyone
 * who copies the SQLite file without the key beside it.
 *
 * Returns the agent, with chainKeys/identity/deviceId populated when a chain row
 * exists, or left null when this device has no chain yet.
 */
async function rehydrate(agent) {
  let chain;
  let seed;
  try {
    chain = agent.store.getChain();
    if (!chain) return agent;
    seed = await agent.store.readSeed();
  } catch {
    // A store this build cannot decrypt is one written by a different build or
    // a different key file. The agent still has to run: report the situation
    // through chain.status rather than dying at startup, because a daemon that
    // crashes on a bad decode turns "your chain is unreadable" into "sync is
    // broken" with no way to ask why.
    agent.rehydrateError = "unreadable-store";
    return agent;
  }
  if (!seed) return agent;

  const rotatingWord =
    process.env.ZIY_SYNC_ROTATING_WORD ||
    (await fetchRotatingWord().catch(() => ({ word: null }))).word;

  agent.chainKeys = new ChainKeys(seed, chain.chain_id, rotatingWord);

  // The device keypair is persisted PKCS#8-encrypted in the agent's DB, so a
  // relaunch recovers the SAME device rather than generating a new one (which
  // the server would then reject as an unknown signer).
  const identity = await loadDeviceIdentity(agent.store);
  if (!identity) return agent;

  agent.identity = identity;
  agent.deviceId = identity.deviceId;
  agent.baseUrl = process.env.ZIY_SYNC_SERVER || null;
  return agent;
}

export function createAgent({ dataDir = defaultDataDir(), stdout = process.stdout, stdin = process.stdin } = {}) {
  const store = new SyncAgentStore(dataDir);
  const writer = new NativeMessageWriter(stdout);

  const handlers = new Map();
  handlers.set("capabilities", (payload, agent) => handleCapabilities(agent, payload));
  handlers.set("chain.create", (payload, agent) => handleChainCreate(agent, store, payload));
  handlers.set("chain.join", (payload, agent) => handleChainJoin(agent, store, payload));
  handlers.set("chain.status", (payload, agent) => handleChainStatus(agent, store, payload));
  handlers.set("chain.leave", (payload, agent) => handleChainLeave(agent, store, payload));
  handlers.set("sync.push", (payload, agent) => handlePush(agent, store, payload));
  handlers.set("sync.pull", (payload, agent) => handlePull(agent, store, payload));
  handlers.set("sync.now", (payload, agent) => handleSync(agent, store, payload));
  handlers.set("devices.list", (payload, agent) => handleDevices(agent, store, payload));
  handlers.set("devices.remove", (payload, agent) => handleDeviceRemove(agent, store, payload));
  handlers.set("account.delete", (payload, agent) => handleAccountDelete(agent, store, payload));

  return { store, writer, handlers };
}

/**
 * Produce a fully-initialised agent: handlers registered AND the chain session
 * rehydrated from disk. Every entry point (main, and any test that drives the
 * agent in-process) goes through this so a relaunch behaves identically to a
 * first launch, which is the whole point of persisting the chain material.
 */
export async function createReadyAgent(options = {}) {
  const agent = createAgent(options);
  await rehydrate(agent);
  return agent;
}

/**
 * Verify the launch arguments MDN says the browser passes: [manifest path,
 * extension id]. A host started by anything else — a test harness, a stray shell
 * — must not silently serve chain operations. Test harnesses set
 * ZIY_SYNC_AGENT_TEST=1 to bypass the check.
 */
export function verifyLaunch(argv = process.argv) {
  if (process.env.ZIY_SYNC_AGENT_TEST === "1") return { ok: true, tested: true };
  const extensionId = argv[3];
  if (!extensionId) return { ok: false, error: "no extension id in argv" };
  if (extensionId !== ALLOWED_EXTENSION_ID) {
    return { ok: false, error: `refusing to serve extension ${extensionId}` };
  }
  return { ok: true, manifestPath: argv[2], extensionId };
}

async function main() {
  const launch = verifyLaunch();
  if (!launch.ok) {
    process.stderr.write(`ziy-sync-agent: ${launch.error}\n`);
    process.exit(2);
  }

  const agent = await createReadyAgent();
  const reader = new NativeMessageReader(process.stdin);

  reader.on("message", async (message) => {
    const started = Date.now();
    // MDN: "If the native application sends any output to stderr, the browser
    // will redirect it to the browser console." So we only write there on a real
    // fault, never as a trace.
    const reply = await dispatch(agent, message, started);
    await agent.writer.send(reply);
  });

  reader.on("error", (error) => {
    process.stderr.write(`ziy-sync-agent: framing error: ${error.message}\n`);
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    // The browser sends SIGTERM then SIGKILL (MDN, "Closing the native app").
    agent.store.close();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    agent.store.close();
    process.exit(0);
  });
}

/**
 * Dispatch one message. Errors are answers, not crashes: a broken request gets
 * {"ok":false,"error":"unhandled-op"} and the process keeps serving, so one bad
 * field can never take the sync chain down.
 */
async function dispatch(agent, message, started) {
  const op = message && typeof message === "object" ? message.op : null;
  const handler = op && agent.handlers.get(op);
  if (!handler) {
    return { ok: false, error: "unknown-op", message: `no handler for op "${op}"` };
  }
  try {
    const result = await handler(message, agent);
    return { ok: true, op, ms: Date.now() - started, result };
  } catch (error) {
    // The message is generic on purpose: an internal message could name a path
    // or a key. The full fault goes to stderr, which the browser console shows.
    process.stderr.write(`ziy-sync-agent: op ${op} failed: ${error && error.stack ? error.stack : String(error)}\n`);
    return { ok: false, error: (error && error.code) || "internal", message: safeMessage(error) };
  }
}

function safeMessage(error) {
  const raw = error && error.message ? error.message : String(error);
  // Never echo a value that might be a path, a word or a key.
  if (/\/home\/|\/tmp\/|\/\.ziy|wordlist|mnemonic|secret|seed|private/i.test(raw)) {
    return "the agent refused to include details in this reply; see the agent log";
  }
  return raw;
}

// Only run when executed directly, not when imported by a test.
if (process.argv[1] && process.argv[1].endsWith("ziy-sync-agent.js")) {
  main().catch((error) => {
    process.stderr.write(`ziy-sync-agent: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}

