/* Ziy news — the panel and options page shared code.
 *
 * Four rules this file exists to enforce, because a panel that violates any
 * of them is not a Ziy panel:
 *
 *  1. Design tokens only. Every colour, space, radius and size comes from a
 *     CSS custom property in ui/tokens.css (a verbatim copy of
 *     replica/design/tokens.css). No hex string is written in this file or in
 *     the stylesheets, except the SVGs' own currentColor.
 *
 *  2. Ziy voice. Every string the user reads is written here, in our words.
 *     The reference product's phrasing is never used, and its brand name
 *     never appears (replica/design/components.md, "Copy rule").
 *
 *  3. Real ARIA. The list is a list (`role="list"`), the refresh status is a
 *     live region (`role="status"`), an error is an alert (`role="alert"`),
 *     and focus is visible on every interactive element. Keyboard navigation
 *     is documented at the bottom of this file and tested by the DOM
 *     assertions in the boot proof.
 *
 *  4. The background page is the only network path. Pages call ops over
 *     `runtime.sendMessage`; they never fetch a feed themselves, because a
 *     page fetch is subject to CORS and the grant belongs to the event page.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyNewsUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EXTENSION_ID = "ziy-news@ziy.app";

  /* --------------------------------------------------------------------- */
  /* Copy — every string the user reads, in Ziy's voice.                    */
  /* --------------------------------------------------------------------- */

  const COPY = Object.freeze({
    panelTitle: "Ziy News",
    loading: "Gathering your feeds…",
    emptyTitle: "Nothing new in your window",
    emptyBody: "Your sources are following this window closely. Widen the window, or add a source and we will fetch it now.",
    emptyAction: "Choose sources",
    noSourcesTitle: "You have no sources yet",
    noSourcesBody: "Add a feed by URL, or start from our starter set and trim it down to what you read.",
    noSourcesAction: "Open source settings",
    offlineTitle: "You are offline",
    offlineBody: "Ziy News reads from the network, so it cannot fetch right now. Your saved stories are still here.",
    errorTitle: "A source is unhappy",
    refresh: "Refresh now",
    refreshing: "Checking your sources…",
    markAllRead: "Mark all read",
    openLinksIn: "Open links where",
    openInNewTab: "New tab",
    openInCurrentTab: "Current tab",
    window: "Show stories from",
    imagesOn: "Show images",
    imagesOff: "Hide images",
    unreadCount: function (n) { return n === 1 ? "1 new story" : n + " new stories"; },
    refreshNeverRun: "Not checked yet.",
    refreshOk: function (sources, unchanged, added, ms) {
      return "Checked " + plural(sources, "source") + " in " + ms + " ms. " +
        plural(added, "new story", "new stories") + " stored, " +
        plural(unchanged, "unchanged") + ".";
    },
    refreshPartial: function (ok, failed) {
      return plural(failed, "source") + " failed, " + ok + " answered.";
    },
    refreshIdle: "Nothing was due this time.",
    sourceError: function (message) { return "This source is unhappy: " + message; },
    // keyboard help, shown by the "?" affordance
    keyboard: [
      "j or ↓ — next story",
      "k or ↑ — previous story",
      "Enter — open in the destination you chose",
      "m — mark read or unread",
      "r — check your sources now",
      "? — show or hide this help",
    ],
  });

  function plural(count, one, many) {
    const word = count === 1 ? (one || (one + "")) : (many || one + "s");
    return count + " " + word;
  }

  /* --------------------------------------------------------------------- */
  /* Formatting                                                            */
  /* --------------------------------------------------------------------- */

  function relativeLabel(published, now) {
    if (!published) return "date unknown";
    const delta = Math.max(0, Number(now) - published);
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return plural(minutes, "minute") + " ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return plural(hours, "hour") + " ago";
    const days = Math.floor(hours / 24);
    if (days < 7) return plural(days, "day") + " ago";
    const d = new Date(published);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getUTCDate() + " " + months[d.getUTCMonth()];
  }

  /* A plain-text one-liner from a feed's HTML. Never trust feed markup: the
   * panel renders text, so the tags are gone either way. */
  function toSnippet(html, limit) {
    const cap = limit || 160;
    const text = String(html || "")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length <= cap) return text;
    const cut = text.slice(0, cap);
    const space = cut.lastIndexOf(" ");
    return (space > cap * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "") + "…";
  }

  /* A safe hostname for a source row, for the favicon and the fallback
   * label. Returns the empty string for a URL we cannot parse. */
  function hostOf(url) {
    const match = /^https?:\/\/([^/]+)/i.exec(String(url || ""));
    return match ? match[1].replace(/^www\./, "") : "";
  }

  /* --------------------------------------------------------------------- */
  /* DOM                                                                    */
  /* --------------------------------------------------------------------- */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs && typeof attrs === "object") {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (value == null) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = String(value);
        else if (key === "dataset") {
          for (const dataKey of Object.keys(value)) {
            node.dataset[dataKey] = String(value[dataKey]);
          }
        } else if (key.slice(0, 2) === "on" && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === "value") {
          node.value = String(value);
        } else {
          node.setAttribute(key, String(value));
        }
      }
    }
    for (const child of children || []) {
      if (child == null) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* --------------------------------------------------------------------- */
  /* Messaging.                                                            */
  /* --------------------------------------------------------------------- */

  /**
   * One op, one reply. Rejections carry the error object the background sent
   * so the UI can show a real message instead of "something went wrong".
   */
  async function op(name, payload) {
    const a = root.browser || root.chrome;
    const message = Object.assign({ op: name, from: "ui" }, payload || {});
    const reply = await a.runtime.sendMessage(EXTENSION_ID, message);
    if (!reply || reply.ok !== true) {
      const err = new Error((reply && reply.error && reply.error.message) || "The news engine did not answer.");
      err.kind = reply && reply.error ? reply.error.kind : "no-reply";
      throw err;
    }
    return reply;
  }

  /* --------------------------------------------------------------------- */
  /* Announcements.                                                        */
  /* --------------------------------------------------------------------- */

  /**
   * A polite live region for refresh status. The container is created once
   * and reused; the text is REPLACED, not appended, so a screen reader says
   * the newest thing rather than reading the history.
   */
  function announce(region, message) {
    if (!region) return;
    region.textContent = "";
    /* A zero-length task lets the live region fire on the change. */
    setTimeout(function () {
      if (region) region.textContent = message;
    }, 0);
  }

  return {
    EXTENSION_ID: EXTENSION_ID,
    COPY: COPY,
    relativeLabel: relativeLabel,
    toSnippet: toSnippet,
    hostOf: hostOf,
    el: el,
    byId: byId,
    escapeHtml: escapeHtml,
    op: op,
    announce: announce,
    plural: plural,
  };
});
