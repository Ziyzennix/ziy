/* Ziy passwords — the client side of the credential vault.
 *
 * WHAT THIS IS
 * ------------
 * The browser's half of a native password manager. The engine exposes no
 * password-manager write API to extensions (replica/proofs-desktop.md §6.4), so
 * the credentials live in native/ziy-pwd, encrypted under a passphrase only the
 * user holds, and this module is the contract between the panel and that
 * helper: the message shapes, the normalisation, and the state the UI reads.
 *
 * It never holds key material and never sees a passphrase it did not receive
 * from the panel's own input box. A passphrase is passed through to the native
 * host and dropped: it is not stored in storage.local, not kept in a module
 * variable beyond the call, and not logged.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * There is no autofill of page forms. See manifest.json and
 * replica/proofs-must-gaps.md §GAP 3: the fill path needs a reliable content-
 * script hook into the page's login form, and on this engine the
 * `scripting`/`activeTab` permission model does not provide one that works
 * without a user gesture per navigation. A vault that stores, lists, imports
 * and exports is a real feature; a fill button that does nothing is not, so the
 * button does not ship. The state the panel shows is the honest one.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * This file is loaded as a classic <script> in the shared global scope of the
 * event page, next to the background script. It therefore declares NOTHING at
 * the top level: the whole body lives inside the factory below. A second
 * top-level declaration of a name another file already owns is a PARSE-time
 * SyntaxError in that scope ("redeclaration of non-configurable global
 * property"), the engine discards the whole file, and every listener in it
 * fails to register — defect D-2 in replica/test-report.md. The API is
 * published on the one `ziyPwd` namespace this extension shares, and on
 * module.exports under node --test.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  if (!root.ziyPwd) root.ziyPwd = {};
  const api = factory();
  Object.assign(root.ziyPwd, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.NATIVE_HOST_NAME = api.NATIVE_HOST_NAME;
    exports.defaultState = api.defaultState;
    exports.normaliseOrigin = api.normaliseOrigin;
    exports.originMatchesPage = api.originMatchesPage;
    exports.parseCsv = api.parseCsv;
    exports.credentialsFromCsv = api.credentialsFromCsv;
    exports.toCsv = api.toCsv;
    exports.escapeField = api.escapeField;
    exports.send = api.send;
    exports.augment = api.augment;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** MDN's native-messaging name: the manifest file's `name` field. */
  const NATIVE_HOST_NAME = "ziy-pwd";

  /**
   * The state the panel reads. Everything except `unlocked` and `busy` outlives
   * a navigation, because the engine suspends the event page between messages
   * and restores nothing (architecture §1.3, proofs-fix-events §1) — so what
   * must survive lives in browser.storage.local and is loaded here.
   */
  const defaultState = {
    /** True only while the vault's key is in the helper's memory. */
    unlocked: false,
    hasVault: false,
    count: 0,
    /** The last error the panel should show, in the product's own words. */
    error: null,
    /** True while a native call is in flight, so the panel can disable a button. */
    busy: false,
    /** The last op the user ran, so a reload can say what just happened. */
    lastOp: null,
  };

  /**
   * An origin, normalised the way a credential is keyed: scheme + host +
   * non-default port, no path.
   * `https://Example.com:443/login` -> `https://example.com`.
   *
   * A bare host is rejected on purpose: a credential must belong to a scheme a
   * page can be served over, or a fill could not tell whether it applies. This
   * is the same normalisation the native helper's store.js performs, so the two
   * cannot disagree about which origin a row belongs to.
   */
  function normaliseOrigin(origin) {
    const raw = String(origin || "").trim();
    if (!raw) return null;
    let url;
    try {
      url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch (e) {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const port = url.port && !isDefaultPort(url.protocol, url.port) ? `:${url.port}` : "";
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
  }

  function isDefaultPort(protocol, port) {
    return (protocol === "https:" && port === "443") || (protocol === "http:" && port === "80");
  }

  /**
   * The origin a credential belongs to, and whether it is the page's origin.
   * This is what decides whether a saved row is offered for the current tab, and
   * it is the only matching rule the product needs: the scheme and the host must
   * both match. A subdomain match is NOT offered, because a credential saved
   * for one host is not a credential for another host the user visited.
   */
  function originMatchesPage(credentialOrigin, pageUrl) {
    const a = normaliseOrigin(credentialOrigin);
    const b = normaliseOrigin(pageUrl);
    if (!a || !b) return false;
    return a === b;
  }

  /* ------------------------------------------------------------------ *
   * The CSV, in the panel, for the round-trip the user can inspect
   * ------------------------------------------------------------------ */

  /** RFC 4180 quoting: a field with a comma, a quote or a newline is quoted. */
  function escapeField(value) {
    const s = String(value === undefined || value === null ? "" : value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /**
   * Parses CSV text into rows, honouring RFC 4180 quoting.
   * Returns null when the file is not a password CSV this product accepts.
   */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const src = String(text || "");
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; continue; }
          inQuotes = false; continue;
        }
        field += ch; continue;
      }
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ",") { row.push(field); field = ""; continue; }
      if (ch === "\r") continue;
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return null;
    const header = rows[0].map(h => String(h || "").trim().toLowerCase());
    for (const needed of ["url", "username", "password"]) {
      if (header.indexOf(needed) === -1) return null;
    }
    return { header, rows: rows.slice(1).filter(r => r.some(c => c !== "")) };
  }

  /**
   * Credentials from a CSV, with a skip count. A row with no origin or no
   * password cannot be filled, so it is counted rather than stored — an
   * unimportable row is not a silent failure the user finds at the next fill.
   */
  function credentialsFromCsv(text) {
    const parsed = parseCsv(text);
    if (!parsed) return { credentials: [], skipped: 0, error: "not a password CSV" };
    const at = (row, name) => {
      const idx = parsed.header.indexOf(name);
      return idx < 0 ? "" : String(row[idx] === undefined ? "" : row[idx]);
    };
    const credentials = [];
    let skipped = 0;
    for (const row of parsed.rows) {
      const origin = at(row, "url").trim();
      const username = at(row, "username").trim();
      const password = at(row, "password");
      if (!origin || !password) { skipped++; continue; }
      credentials.push({ name: at(row, "name").trim(), origin, username, password });
    }
    return { credentials, skipped, error: null };
  }

  /** The CSV a browser reads back: header, then one row per credential. */
  function toCsv(credentials) {
    const lines = ["name,url,username,password"];
    for (const c of credentials || []) {
      lines.push([
        escapeField(c.name || ""),
        escapeField(c.origin || ""),
        escapeField(c.username || ""),
        escapeField(c.password || ""),
      ].join(","));
    }
    return lines.join("\r\n") + "\r\n";
  }

  /* ------------------------------------------------------------------ *
   * The message contract
   * ------------------------------------------------------------------ */

  /**
   * One request to the native host, answered with one reply.
   *
   * A port is used rather than sendMessage because MDN's native messaging is
   * port-based (`runtime.connectNative`), and a request/response pair is matched
   * by a per-call id because a Port is not itself request/response — the same
   * pattern extensions/ziy-sync/background/background.js uses for the sync
   * agent, so the two helpers differ by host name and op list and by nothing
   * else.
   *
   * The passphrase is passed through and never retained: `reply` is the only
   * thing this function returns, and the state it updates carries `unlocked`,
   * never a key.
   */
  let port = null;
  let nextId = 1;

  function connect() {
    if (port) return port;
    port = (typeof browser !== "undefined" ? browser : chrome).runtime.connectNative(NATIVE_HOST_NAME);
    port.onDisconnect.addListener(() => { port = null; });
    return port;
  }

  /**
   * @param {string} op          one of the native host's ops
   * @param {object} [payload]   the op's own fields; `passphrase` is allowed
   *                             here and nowhere else
   * @returns {Promise<object>}  the op's result
   */
  function send(op, payload) {
    return new Promise((resolve, reject) => {
      const api = (typeof browser !== "undefined" ? browser : chrome);
      const p = connect();
      if (!p) { reject(new Error("native messaging is unavailable")); return; }
      const id = `pwd-${nextId++}-${Date.now()}`;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("the password helper did not answer in time"));
      }, 30000);
      const onMessage = (message) => {
        if (!message || message.id !== id) return;
        cleanup();
        if (message.ok) resolve(message.result);
        else {
          const err = new Error(message.message || message.error || "helper error");
          err.code = message.error;
          reject(err);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        p.onMessage.removeListener(onMessage);
      };
      p.onMessage.addListener(onMessage);
      p.postMessage({ id, op, ...payload });
    });
  }

  /**
   * Folds an op's reply into the panel state. The one rule: an error is kept as
   * an error until the next successful op clears it, and a password is NEVER
   * part of this state.
   */
  function augment(state, patch) {
    const next = { ...state, ...patch };
    if (patch.error) next.error = patch.error;
    else if (!patch.keepError) next.error = null;
    if (patch.busy === undefined) next.busy = false;
    return next;
  }

  return {
    NATIVE_HOST_NAME,
    defaultState,
    normaliseOrigin,
    originMatchesPage,
    parseCsv,
    credentialsFromCsv,
    toCsv,
    escapeField,
    send,
    augment,
  };
});
