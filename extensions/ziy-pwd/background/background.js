/* Ziy passwords — the background event page.
 *
 * WHAT IT DOES
 * ------------
 * Bridges the panel to the native helper, and holds the one piece of state that
 * must outlive a message: the unlock flag and the credential count.
 *
 * WHY IT IS AN EVENT PAGE, NOT A SERVICE WORKER
 * ---------------------------------------------
 * Gecko 156 does not implement background.service_worker (Firefox bug 1573659),
 * so the manifest declares both `scripts` and `service_worker` and Gecko runs
 * the scripts form — the cross-browser recipe, exactly as every other extension
 * in this suite does (architecture §1.3, proofs-fix-events §1). Consequences
 * that shape this file:
 *
 *   - every listener is registered at the TOP level, never inside an async
 *     bootstrap, because a suspended event page restarts by re-evaluating the
 *     script and re-registering them;
 *   - the lib file is listed BEFORE this one in the manifest's scripts array,
 *     because both share one classic-script global scope and a file listed
 *     later cannot read a global an earlier file assigns at evaluation time;
 *   - nothing that must survive a suspension lives in a variable: the unlock
 *     flag is re-read from the helper on every query, which is the honest
 *     source (the helper owns the key; a stale copy in the event page would be
 *     a lie the panel could act on).
 */

'use strict';

/* The lib file is a UMD IIFE that publishes on the shared `ziyPwd` global.
 * It is guarded because an event page can be re-evaluated in an order where the
 * namespace is not yet there on a cold start (defect D-2's lesson: a top-level
 * unguarded read throws and the whole file is discarded). */
const P = globalThis.ziyPwd || {};

const STORAGE_KEY = "ziy.pwd.state";

/**
 * The state that survives. It deliberately does NOT include the passphrase, the
 * key, or any credential plaintext: the helper owns all three, and a copy in
 * browser storage would be a credential store in browser-accessible storage,
 * which is the thing this design exists to avoid (architecture §3.1's rule,
 * applied to the sync chain's material).
 */
let local = {
  unlocked: false,
  hasVault: false,
  count: 0,
  lastOp: null,
};

const api = (typeof browser !== "undefined") ? browser : chrome;

function saveLocal() {
  return api.storage.local.set({ [STORAGE_KEY]: local });
}

async function loadLocal() {
  const stored = await api.storage.local.get(STORAGE_KEY);
  const saved = stored && stored[STORAGE_KEY];
  if (saved && typeof saved === "object") {
    local = Object.assign(local, saved);
    return local;
  }
  return local;
}

/**
 * One op to the native helper. The reply's own shape is trusted for `ok`, and
 * every failure is answered rather than thrown, so the panel can show a real
 * error instead of an unanswered promise.
 */
function op(name, body) {
  if (!P.send) return Promise.reject(new Error("the pwd client library did not load"));
  return P.send(name, body || {});
}

/**
 * Refreshes the stored state from the helper. The helper is the authority on
 * whether the vault is unlocked, because it holds the key.
 */
async function refreshStatus() {
  try {
    const status = await op("vault.status", {});
    local.unlocked = status.locked === false;
    local.hasVault = status.hasVault === true;
    local.count = typeof status.count === "number" ? status.count : 0;
  } catch (error) {
    // A helper that cannot answer is reported, not guessed at: an unknown
    // unlock state is not an unlocked state.
    local.error = "The password helper did not answer. Is native/ziy-pwd installed?";
  }
  await saveLocal();
  return local;
}

/* ------------------------------------------------------------------ *
 * The message bus — what the panel calls
 * ------------------------------------------------------------------ */

api.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.op !== "string") return undefined;

  switch (message.op) {
    case "pwd.state":
      return refreshStatus().then(state => ({ ok: true, state }));

    case "pwd.status":
      return op("vault.status", {}).then(status => ({ ok: true, status }));

    case "pwd.capabilities":
      return op("capabilities", {}).then(caps => ({ ok: true, caps }));

    case "pwd.create":
      return op("vault.create", { passphrase: message.body.passphrase })
        .then(async (result) => {
          local.lastOp = "vault.create";
          await refreshStatus();
          return { ok: true, result };
        });

    case "pwd.unlock":
      return op("vault.unlock", { passphrase: message.body.passphrase })
        .then(async (result) => {
          local.lastOp = "vault.unlock";
          await refreshStatus();
          return { ok: true, result };
        })
        .catch(async (error) => {
          local.lastOp = "vault.unlock";
          await saveLocal();
          throw error;
        });

    case "pwd.lock":
      return op("vault.lock", {})
        .then(async (result) => {
          local.lastOp = "vault.lock";
          await refreshStatus();
          return { ok: true, result };
        });

    case "pwd.save":
      return op("credentials.save", message.body)
        .then(async (result) => {
          local.lastOp = "credentials.save";
          await refreshStatus();
          return { ok: true, result };
        });

    case "pwd.list":
      return op("credentials.list", {})
        .then(result => ({ ok: true, credentials: result.credentials || [] }));

    case "pwd.remove":
      return op("credentials.remove", { id: message.body.id })
        .then(async (result) => {
          local.lastOp = "credentials.remove";
          await refreshStatus();
          return { ok: true, result };
        });

    case "pwd.clear":
      return op("credentials.clear", {})
        .then(async (result) => {
          local.lastOp = "credentials.clear";
          await refreshStatus();
          return { ok: true, result };
        });

    case "pwd.import":
      // The CSV is parsed by the SAME code the native helper uses (the shapes
      // are mirrored in this extension's lib and native/ziy-pwd/lib/csv.js, and
      // the shape is pinned by tests in both suites), so a file the panel
      // accepts is a file the helper accepts. The plaintext CSV is passed
      // through and never stored in browser storage.
      return op("csv.import", { csv: message.body.csv })
        .then(async (result) => {
          local.lastOp = "csv.import";
          await refreshStatus();
          return { ok: true, result };
        });

    case "pwd.export":
      return op("csv.export", {})
        .then(result => ({ ok: true, result }));

    default:
      return undefined;
  }
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

loadLocal().then(() => refreshStatus());
