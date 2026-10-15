#!/usr/bin/env node
/**
 * ziy-pwd — the Ziy native messaging host that owns the credential vault.
 *
 * WHAT THIS EXISTS FOR
 * --------------------
 * The engine exposes no password-manager write API to extensions. That is
 * verified, not assumed: replica/proofs-desktop.md §6.4 records the absence,
 * which is why the "Built-in password manager" must-row has been at `no` rather
 * than faked. This host is the honest route: the credentials live where browser
 * storage cannot reach them, encrypted under a passphrase only the user holds.
 *
 * The shape follows native/ziy-sync-agent exactly, on purpose:
 *   - stdio JSON with MDN's UInt32LE length prefix (lib/native-protocol.js)
 *   - two launch arguments: the manifest path, then the add-on id, both checked
 *   - one handler map, one dispatch, errors are answers and never crashes
 *   - SIGTERM/SIGINT close the store and exit 0
 * One convention in the product's native layer is one thing to audit, and the
 * alternative is two divergent framing implementations in one shipping product.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * - It does not fill a form. See the note in the ticket's own source and the
 *   extension's manifest: the fill path needs content-script injection into the
 *   page, and this build's engine schema gates `scripting` behind the
 *   `activeTab`/host permissions in a way that does not give a password manager
 *   a reliable "the login form on this page" hook without a user gesture per
 *   navigation. A vault that SAVES, LISTS, IMPORTS and EXPORTS is real; a fill
 *   button that does nothing is not, so it does not ship here. That is recorded
 *   in replica/parity.md's row note rather than left for a user to discover.
 * - It does not autolock on a timer. Locking is explicit (pwd.lock) because a
 *   timer would need a clock the host does not otherwise need, and a lock that
 *   fires mid-fill is worse than no timer.
 */

import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeMessageReader, NativeMessageWriter, ALLOWED_EXTENSION_ID } from "./lib/native-protocol.js";
import { VaultStore, normaliseOrigin } from "./lib/store.js";
import { credentialsFromCsv, toCsv } from "./lib/csv.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fallback data dir. Overridable so tests never touch the real vault.
 * Default: $ZIY_PWD_DATA_DIR, else ~/.ziy/pwd.
 */
function defaultDataDir() {
  return process.env.ZIY_PWD_DATA_DIR || path.join(process.env.HOME || "/tmp", ".ziy", "pwd");
}

export function createAgent({ dataDir = defaultDataDir(), stdout = process.stdout, stdin = process.stdin } = {}) {
  const store = new VaultStore(dataDir);
  const writer = new NativeMessageWriter(stdout);

  const handlers = new Map();
  handlers.set("capabilities", () => handleCapabilities(store));
  handlers.set("vault.status", () => handleStatus(store));
  handlers.set("vault.create", (payload) => handleCreate(store, payload));
  handlers.set("vault.unlock", (payload) => handleUnlock(store, payload));
  handlers.set("vault.lock", () => handleLock(store));
  handlers.set("credentials.save", (payload) => handleSave(store, payload));
  handlers.set("credentials.list", () => ({ credentials: store.list() }));
  handlers.set("credentials.get", (payload) => handleGet(store, payload));
  handlers.set("credentials.remove", (payload) => handleRemove(store, payload));
  handlers.set("credentials.clear", () => handleClear(store));
  handlers.set("csv.import", (payload) => handleImport(store, payload));
  handlers.set("csv.export", () => handleExport(store));

  return { store, writer, handlers };
}

/* The handlers. Each is small on purpose: the store carries the logic, and the
 * dispatch carries the reply shape. */

function handleCapabilities(store) {
  return {
    service: "ziy-pwd",
    api: "v1",
    protocol: "native-messaging stdio, UInt32LE length prefix, JSON payloads (MDN)",
    kdf: "PBKDF2-SHA512",
    hasVault: store.hasVault(),
    locked: store.isLocked(),
    ops: [
      "capabilities", "vault.status", "vault.create", "vault.unlock", "vault.lock",
      "credentials.save", "credentials.list", "credentials.get",
      "credentials.remove", "credentials.clear", "csv.import", "csv.export",
    ],
  };
}

function handleStatus(store) {
  return {
    hasVault: store.hasVault(),
    locked: store.isLocked(),
    count: store.hasVault() ? store.db.prepare("select count(*) as n from credentials").get().n : 0,
  };
}

function handleCreate(store, payload) {
  const passphrase = payload && payload.passphrase;
  if (!passphrase || typeof passphrase !== "string" || !passphrase.length) {
    throw new Error("a passphrase is required");
  }
  return store.create(passphrase);
}

function handleUnlock(store, payload) {
  const passphrase = payload && payload.passphrase;
  if (!passphrase || typeof passphrase !== "string" || !passphrase.length) {
    throw new Error("a passphrase is required");
  }
  return store.unlock(passphrase);
}

function handleLock(store) {
  return store.lock();
}

function handleSave(store, payload) {
  const origin = normaliseOrigin(payload && payload.origin);
  return store.save({ ...payload, origin });
}

function handleGet(store, payload) {
  const id = payload && payload.id;
  if (!id) throw new Error("an id is required");
  const found = store.get(id);
  if (!found) return null;
  return found;
}

function handleRemove(store, payload) {
  const id = payload && payload.id;
  if (!id) throw new Error("an id is required");
  return store.remove(id);
}

function handleClear(store) {
  return store.clear();
}

/**
 * The CSV import. Rows that cannot be filled are counted and reported rather
 * than dropped silently, so the panel can say "9 saved, 1 skipped".
 */
function handleImport(store, payload) {
  const text = payload && payload.csv;
  if (typeof text !== "string" || !text.length) throw new Error("empty csv");
  const { credentials, skipped, error } = credentialsFromCsv(text);
  if (error) throw new Error(error);
  const saved = [];
  for (const cred of credentials) {
    saved.push(store.save(cred));
  }
  return { saved: saved.length, skipped, credentials: saved };
}

/** The CSV export: the same file a browser writes, from the decrypted vault. */
function handleExport(store) {
  const rows = store.list();
  const full = rows.map(r => {
    // list() gives no password by design; the export needs it, and the export is
    // the one op that does.
    const cred = store.get(r.id);
    return {
      name: r.origin,
      origin: r.origin,
      username: r.username,
      password: cred ? cred.password : "",
    };
  });
  return { csv: toCsv(full), count: full.length };
}

/**
 * Verify the launch arguments MDN says the browser passes: [manifest path,
 * extension id]. A host started by anything else must not serve credentials.
 * Test harnesses set ZIY_PWD_AGENT_TEST=1 to bypass the check.
 */
export function verifyLaunch(argv = process.argv) {
  if (process.env.ZIY_PWD_AGENT_TEST === "1") return { ok: true, tested: true };
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
    process.stderr.write(`ziy-pwd: ${launch.error}\n`);
    process.exit(2);
  }

  const agent = createAgent();
  const reader = new NativeMessageReader(process.stdin);

  reader.on("message", async (message) => {
    const started = Date.now();
    const reply = await dispatch(agent, message, started);
    await agent.writer.send(reply);
  });

  reader.on("error", (error) => {
    process.stderr.write(`ziy-pwd: framing error: ${error.message}\n`);
    process.exit(1);
  });

  process.on("SIGTERM", () => {
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
 * {"ok":false,"error":"unhandled-op"} and the process keeps serving.
 *
 * Exported so the test suite drives the REAL dispatch path — including the reply
 * scrubber — rather than a copy of it.
 *
 * The scrubber runs on every reply: only credentials.get may carry a plaintext
 * password, so a handler that leaks one into another op's result has it removed
 * here rather than on the wire.
 */
export async function dispatch(agent, message, started) {
  const op = message && typeof message === "object" ? message.op : null;
  const handler = op && agent.handlers.get(op);
  if (!handler) {
    return { ok: false, error: "unknown-op", message: `no handler for op "${op}"` };
  }
  try {
    const result = await handler(message, agent);
    const { scrubReply } = await import("./lib/native-protocol.js");
    return { ok: true, op, ms: Date.now() - started, result: scrubReply(op, result) };
  } catch (error) {
    process.stderr.write(`ziy-pwd: op ${op} failed: ${error && error.stack ? error.stack : String(error)}\n`);
    // The message is generic on purpose: an internal message could name a path,
    // a passphrase or a credential. The full fault goes to stderr.
    return { ok: false, error: (error && error.code) || "internal", message: safeMessage(error) };
  }
}

function safeMessage(error) {
  const raw = error && error.message ? error.message : String(error);
  if (/\/home\/|\/tmp\/|\/\.ziy|passphrase|password|secret|phrase/i.test(raw)) {
    return "the agent refused to include details in this reply; see the agent log";
  }
  return raw;
}

// Only run when executed directly, not when imported by a test.
if (process.argv[1] && process.argv[1].endsWith("ziy-pwd.js")) {
  main().catch((error) => {
    process.stderr.write(`ziy-pwd: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
