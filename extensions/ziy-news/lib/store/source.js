/* Ziy news — the source model.
 *
 * A source is one feed the user subscribed to. It carries the identity the
 * fetcher needs (URL, cache headers, error state) and the presentation the
 * panel and NTP need (name, category, favicon).
 *
 * The default sources are OUR curated list, not any vendor's catalog. They
 * are all public, well-known feeds of public-interest publishers and were
 * each fetched and parsed during the build (see replica/proofs-news.md),
 * so a fresh profile starts with a feed that works rather than a broken
 * demonstration.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyNewsSource = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;

  /* The default starter set.
   *
   * Each entry was verified with a real HTTP GET at build time; the checks
   * and their dates are recorded in replica/proofs-news.md. The categories
   * are ours: they group the panel and the NTP snapshot, and a user can
   * rename or remove any of them. */
  const DEFAULT_SOURCES = Object.freeze([
    Object.freeze({
      id: "bbc-world",
      title: "BBC News — World",
      url: "https://feeds.bbci.co.uk/news/world/rss.xml",
      siteUrl: "https://www.bbc.com/news/world",
      category: "World",
      format: "rss2",
      builtIn: true,
    }),
    Object.freeze({
      id: "guardian-world",
      title: "The Guardian — World",
      url: "https://www.theguardian.com/world/rss",
      siteUrl: "https://www.theguardian.com/world",
      category: "World",
      format: "rss2",
      builtIn: true,
    }),
    Object.freeze({
      id: "dw-world",
      title: "Deutsche Welle — World",
      url: "https://rss.dw.com/xml/rss-en-world",
      siteUrl: "https://www.dw.com/en/world/s-1429",
      category: "World",
      format: "rss2",
      builtIn: true,
    }),
    Object.freeze({
      id: "npr-news",
      title: "NPR — News",
      url: "https://feeds.npr.org/1004/rss.xml",
      siteUrl: "https://www.npr.org/sections/news/",
      category: "World",
      format: "rss2",
      builtIn: true,
    }),
    Object.freeze({
      id: "aljazeera",
      title: "Al Jazeera — All",
      url: "https://www.aljazeera.com/xml/rss/all.xml",
      siteUrl: "https://www.aljazeera.com/",
      category: "World",
      format: "rss2",
      builtIn: true,
    }),
    Object.freeze({
      id: "ars-technica",
      title: "Ars Technica",
      url: "https://feeds.arstechnica.com/arstechnica/index",
      siteUrl: "https://arstechnica.com/",
      category: "Technology",
      format: "rss2",
      builtIn: true,
    }),
    Object.freeze({
      id: "nature",
      title: "Nature",
      url: "https://www.nature.com/nature.rss",
      siteUrl: "https://www.nature.com/",
      category: "Science",
      format: "rss1",
      builtIn: true,
    }),
    Object.freeze({
      id: "heise",
      title: "heise online",
      url: "https://www.heise.de/rss/heise.rdf",
      siteUrl: "https://www.heise.de/",
      category: "Technology",
      format: "rss2",
      builtIn: true,
    }),
    Object.freeze({
      id: "mozilla-blog",
      title: "The Mozilla Blog",
      url: "https://blog.mozilla.org/en/feed/atom/",
      siteUrl: "https://blog.mozilla.org/en/",
      category: "Technology",
      format: "atom",
      builtIn: true,
    }),
    Object.freeze({
      id: "manton-reece",
      title: "Manton Reece",
      url: "https://www.manton.org/feed.json",
      siteUrl: "https://www.manton.org/",
      category: "Following",
      format: "json",
      builtIn: true,
    }),
  ]);

  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "World", label: "World" }),
    Object.freeze({ id: "Technology", label: "Technology" }),
    Object.freeze({ id: "Science", label: "Science" }),
    Object.freeze({ id: "Following", label: "Following" }),
    Object.freeze({ id: "Uncategorised", label: "Uncategorised" }),
  ]);

  /* A source the user added, or a shipped default with its runtime state
   * filled in. `kind` marks a default so a user can restore it after
   * removal, without re-adding it by hand. */
  function normalise(raw, fallbackCategory) {
    if (!raw || typeof raw !== "object") return null;
    const url = String(raw.url || "").trim();
    if (!isHttpUrl(url)) return null;
    const now = dateNow();
    return {
      id: String(raw.id || "").trim() || makeId(url),
      title: String(raw.title || "").trim() || hostOf(url),
      url: url,
      siteUrl: String(raw.siteUrl || "").trim() || "",
      category: String(raw.category || "").trim() || fallbackCategory || "Uncategorised",
      kind: raw.kind === "builtin" || raw.builtIn === true ? "builtin" : "user",
      /* The format the publisher serves, when we know it. It is a fact about
       * the source, not a user setting. */
      format: String(raw.format || "") || null,
      enabled: raw.enabled === undefined ? true : !!raw.enabled,
      /* Cache headers from the last good response, for conditional GET. */
      etag: String(raw.etag || "") || null,
      lastModified: String(raw.lastModified || "") || null,
      lastFetchedAt: toFinite(raw.lastFetchedAt),
      /* Per-source error state, shown in the UI. */
      lastError: raw.lastError && typeof raw.lastError === "object" ? {
        kind: String(raw.lastError.kind || "unknown"),
        message: String(raw.lastError.message || ""),
        at: toFinite(raw.lastError.at),
      } : null,
      consecutiveFailures: toFinite(raw.consecutiveFailures) || 0,
      createdAt: toFinite(raw.createdAt) || now,
      updatedAt: toFinite(raw.updatedAt) || now,
    };
  }

  /* A stable id from the URL: the same URL always produces the same source
   * id, so importing a source the user already has updates it rather than
   * duplicating it. Not cryptographic — it is an identity, not a secret. */
  function makeId(url) {
    /* Scheme and "www." are not identity: the same feed reached by either is
     * the same source, so importing one after adding the other must update
     * rather than fork. The trailing slash and any query or fragment are not
     * identity either. */
    const clean = String(url).replace(/^https?:\/\//i, "").replace(/^www\./, "")
      .replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = (Math.imul(31, hash) + clean.charCodeAt(i)) | 0;
    }
    return "s" + (hash >>> 0).toString(36);
  }

  function defaults() {
    return DEFAULT_SOURCES.map(function (source) {
      /* The format each starter feed actually serves, kept so the options
       * page can label it. It is a fact about the publisher, not a setting,
       * so it is carried through rather than re-detected. */
      return normalise(Object.assign({}, source, {
        kind: "builtin",
        enabled: true,
        category: source.category || "Uncategorised",
        format: source.format,
      }), null);
    });
  }

  function isHttpUrl(value) {
    return /^https?:\/\/[^\s/]+\/?/i.test(String(value || ""));
  }

  function hostOf(url) {
    const m = /^https?:\/\/([^/]+)/i.exec(String(url || ""));
    return m ? m[1].replace(/^www\./, "") : "";
  }

  function toFinite(value) {
    const n = Number(value);
    return isFinite(n) ? n : null;
  }

  function dateNow() {
    try {
      return Date.now();
    } catch (_e) {
      return 0;
    }
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_SOURCES: DEFAULT_SOURCES,
    CATEGORIES: CATEGORIES,
    normalise: normalise,
    defaults: defaults,
    makeId: makeId,
    isHttpUrl: isHttpUrl,
    hostOf: hostOf,
  };
});
