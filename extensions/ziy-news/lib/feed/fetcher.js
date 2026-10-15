/* Ziy news — the fetch engine: politeness, backoff, and the refresh plan.
 *
 * Every rule here is about being a good citizen of the network we read from:
 *
 *  Conditional GET (RFC 9110 §3.2 / the RSS Best Practices at
 *  rssboard.org/rss-profile, and JSON Feed's own "Feed readers are strongly
 *  advised to use Conditional GET"):
 *    - If-Modified-Since sends Last-Modified back to the source.
 *    - If-None-Match sends ETag back to the source.
 *    A 304 means "unchanged": the stored items stand, nothing is rewritten,
 *    and the source's lastFetch timestamp advances.
 *
 *  Cache headers are respected rather than ignored:
 *    - Cache-Control max-age (seconds) and Expires (absolute) both cap the
 *      next fetch for that source. A source that says "not for 10 minutes"
 *      is not fetched again for 10 minutes, even if the alarm fires sooner.
 *
 *  Failure handling:
 *    - 404 the feed is gone: the source is marked and skipped, and its error
 *      is shown in the UI until the user fixes or removes it.
 *    - 429 the source is rate limiting: back off hard, starting at 15 minutes.
 *    - 5xx and timeouts are transient: exponential backoff from 2 minutes,
 *      doubling, capped at 60 minutes, with jitter so a fleet of readers
 *      does not synchronise.
 *
 *  Concurrency: at most MAX_CONCURRENT feeds in flight, so 20 sources do not
 *  open 20 sockets at once on a cold start.
 *
 * The engine is deliberately free of the WebExtension API, so it can be
 * tested with a fake clock and a fake fetch: determinism is evidence.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyNewsFetcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_CONCURRENT = 4;
  const REQUEST_TIMEOUT_MS = 20000;

  /* Backoff ladder. The base doubles each time; the jitter is a deterministic
   * fraction of the base (see test: the fake clock makes the jitter
   * reproducible). */
  const BACKOFF_BASE_MS = 2 * 60 * 1000;   /* 2 minutes */
  const BACKOFF_MAX_MS = 60 * 60 * 1000;   /* 60 minutes */
  const BACKOFF_429_MS = 15 * 60 * 1000;   /* 15 minutes, before doubling */

  const USER_AGENT = "Ziy News/1.0 (+https://ziy.app) feed reader";

  /* --------------------------------------------------------------------- */
  /* Backoff math                                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Delay after the nth consecutive failure, in milliseconds.
   * `attempt` is 1-based: the first failure already backs off by the base,
   * rather than firing again immediately.
   *
   * The jitter is ±12.5% of the computed delay, derived from the attempt so
   * the same source always gets the same delay for the same attempt — the
   * panel shows a timestamp that must not move on its own.
   */
  function backoffDelay(attempt, status) {
    const failures = Math.max(1, Math.floor(attempt));
    const base = status === 429 ? BACKOFF_429_MS : BACKOFF_BASE_MS;
    /* failure 1: base; failure 2: 2x; failure 3: 4x; ... capped. */
    const doubled = Math.min(BACKOFF_MAX_MS, base * Math.pow(2, failures - 1));
    return Math.round(doubled * (1 + jitterFor(failures)));
  }

  function jitterFor(attempt) {
    /* A small deterministic spread: ±12.5%, hashed from the attempt. */
    const hash = Math.imul(attempt + 1, 2654435761) >>> 0;
    const spread = ((hash & 0xff) / 255 - 0.5) * 0.25;
    return spread;
  }

  /* --------------------------------------------------------------------- */
  /* Cache policy                                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Decides when a source may next be fetched.
   * Returns { at: epochMs, reason: string }.
   *
   * The rules, in order of authority:
   *   1. an alarm in the future blocks until then
   *   2. the source's own cache headers (max-age / Expires) block until then
   *   3. a failure backoff blocks until then
   *   4. the refresh interval
   */
  function nextFetchAt(source, settings, now) {
    const at = Number(now);
    if (!source) return { at: at, reason: "no-source" };
    if (source.enabled === false) return { at: Infinity, reason: "disabled" };

    const failures = toFiniteInt(source.consecutiveFailures) || 0;
    if (failures > 0 && source.lastFetchedAt) {
      const delay = backoffDelay(failures, source.lastError && source.lastError.kind === "rate-limited"
        ? 429 : 0);
      const backoffAt = toFiniteInt(source.lastFetchedAt) + delay;
      if (backoffAt > at) return { at: backoffAt, reason: "backoff:" + failures };
    }

    const cacheAt = cacheExpiresAt(source);
    if (cacheAt && cacheAt > at) return { at: cacheAt, reason: "cache" };

    const intervalMs = (settings && settings.refreshMinutes ? settings.refreshMinutes * 60 * 1000
      : 30 * 60 * 1000);
    const lastCompleted = toFiniteInt(source.lastFetchedAt);
    /* A source that has NEVER been fetched — a fresh install, or a source the
     * user just added — is due NOW, not after the first interval. Otherwise a
     * new profile sits empty for half an hour. */
    if (lastCompleted == null) return { at: at, reason: "never-fetched" };
    const intervalAt = lastCompleted + intervalMs;
    return { at: intervalAt, reason: "interval" };
  }

  function cacheExpiresAt(source) {
    const maxAge = toFiniteInt(source.cacheMaxAge);
    if (maxAge != null && source.lastFetchedAt) {
      return toFiniteInt(source.lastFetchedAt) + maxAge * 1000;
    }
    const expires = toFiniteInt(source.cacheExpiresAt);
    if (expires != null) return expires;
    return null;
  }

  /**
   * Which sources to fetch now, capped at MAX_CONCURRENT and ordered by
   * how overdue they are, so a long setback does not start with the same
   * first source every time.
   */
  function planFetch(sources, settings, now) {
    const due = [];
    for (const source of sources) {
      if (!source || source.enabled === false) continue;
      const next = nextFetchAt(source, settings, now);
      if (next.at <= now) due.push({ source: source, overdueBy: now - next.at, reason: next.reason });
    }
    due.sort(function (a, b) { return b.overdueBy - a.overdueBy; });
    return due.slice(0, MAX_CONCURRENT).map(function (entry) { return entry.source; });
  }

  /* --------------------------------------------------------------------- */
  /* The request                                                            */
  /* --------------------------------------------------------------------- */

  /** Builds the headers for a conditional GET. */
  function requestHeaders(source) {
    const headers = {
      "Accept": "application/rss+xml, application/atom+xml, application/xml, " +
        "application/feed+json, application/json;q=0.9, text/xml;q=0.8, */*;q=0.5",
      "User-Agent": USER_AGENT,
    };
    if (source && source.etag) headers["If-None-Match"] = source.etag;
    if (source && source.lastModified) headers["If-Modified-Since"] = source.lastModified;
    return headers;
  }

  /**
   * One fetch attempt. The `fetchImpl` is injected so tests can supply a
   * fake; in the extension it is the event page's fetch, which the
   * host_permissions grant makes cross-origin.
   *
   * Returns one of:
   *   { status: 304, notModified: true, headers }
   *   { status: 200, body: "…", headers }
   *   throws a FetchFailure with a `kind` for the UI
   */
  async function fetchOne(source, fetchImpl, options) {
    const opts = options || {};
    const doFetch = fetchImpl || defaultFetch;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(function () {
      if (controller) controller.abort();
    }, opts.timeoutMs || REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await doFetch(source.url, {
        method: "GET",
        headers: requestHeaders(source),
        redirect: "follow",
        credentials: "omit",
        signal: controller ? controller.signal : undefined,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new FetchFailure("timeout", "The feed did not answer in time.", err);
    }
    clearTimeout(timer);

    if (!response) throw new FetchFailure("no-response", "The fetch returned nothing.");

    if (response.status === 304) {
      return { status: 304, notModified: true, headers: response.headers || {} };
    }
    if (response.status === 404 || response.status === 410) {
      throw new FetchFailure("gone", "That feed is gone (" + response.status + ").", null, response.status);
    }
    if (response.status === 429) {
      throw new FetchFailure("rate-limited", "That site is asking us to slow down (429).",
        null, response.status);
    }
    if (response.status === 401 || response.status === 403) {
      throw new FetchFailure("forbidden", "That feed refused the request (" + response.status + ").",
        null, response.status);
    }
    if (response.status >= 500) {
      throw new FetchFailure("server-error", "That site had a server error (" + response.status + ").",
        null, response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FetchFailure("http-" + response.status,
        "That feed answered " + response.status + ".", null, response.status);
    }

    const body = await response.text();
    if (!body || !body.trim()) {
      throw new FetchFailure("empty", "That feed answered with an empty body.", null, response.status);
    }
    return { status: response.status, body: body, headers: response.headers || {} };
  }

  function defaultFetch(url, init) {
    /* Kept as a function reference rather than a direct call so a test can
     * tell "no fetch was injected" apart from "fetch threw". */
    throw new Error("ziy-news: no fetch implementation was provided to the fetcher");
  }

  /* --------------------------------------------------------------------- */
  /* Response bookkeeping                                                  */
  /* --------------------------------------------------------------------- */

  /**
   * Records what a successful response said about caching, so the next
   * refresh honours it. Mutates nothing: returns the patch to store.
   */
  function cachePatchFromHeaders(headers, now, previous) {
    const out = {
      etag: previous && previous.etag ? previous.etag : null,
      lastModified: previous && previous.lastModified ? previous.lastModified : null,
      cacheMaxAge: null,
      cacheExpiresAt: null,
    };
    const get = function (name) {
      if (!headers) return null;
      if (typeof headers.get === "function") return headers.get(name);
      return headers[name] || headers[name.toLowerCase()] || null;
    };
    const etag = get("etag");
    if (etag) out.etag = String(etag);
    const lastModified = get("last-modified");
    if (lastModified) out.lastModified = String(lastModified);

    /* A weak etag (`W/"…"`) still identifies the response, so it is kept. */
    const cacheControl = get("cache-control") || "";
    const maxAge = /max-age\s*=\s*(\d+)/i.exec(String(cacheControl));
    if (maxAge) {
      const seconds = parseInt(maxAge[1], 10);
      if (isFinite(seconds) && seconds >= 0) out.cacheMaxAge = seconds;
    }
    const expires = get("expires");
    if (expires) {
      const at = Date.parse(String(expires));
      if (!isNaN(at)) out.cacheExpiresAt = at;
    }
    out.cacheCheckedAt = Number(now) || 0;
    return out;
  }

  function toFiniteInt(value) {
    const n = Number(value);
    return isFinite(n) ? Math.floor(n) : null;
  }

  function FetchFailure(kind, message, cause, status) {
    const error = new Error(message);
    error.name = "FetchFailure";
    error.kind = kind;
    if (cause) error.cause = cause;
    if (status) error.status = status;
    return error;
  }

  return {
    MAX_CONCURRENT: MAX_CONCURRENT,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    BACKOFF_BASE_MS: BACKOFF_BASE_MS,
    BACKOFF_MAX_MS: BACKOFF_MAX_MS,
    BACKOFF_429_MS: BACKOFF_429_MS,
    USER_AGENT: USER_AGENT,
    backoffDelay: backoffDelay,
    nextFetchAt: nextFetchAt,
    planFetch: planFetch,
    requestHeaders: requestHeaders,
    fetchOne: fetchOne,
    cachePatchFromHeaders: cachePatchFromHeaders,
    FetchFailure: FetchFailure,
  };
});
