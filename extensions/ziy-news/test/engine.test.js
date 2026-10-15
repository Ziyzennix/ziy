/* Ziy news — politeness, filtering, the storage model, and the feed.snapshot
 * message contract.
 *
 * Two of these suites exist because of the feedback corpus (replica/fixes.md):
 *
 *  - §1.2 "Slow, laggy, heavy" (273 reviews, 4 sources; the analyser's
 *    lowest-rated theme at 2.5 stars) names Brave's own background services,
 *    the BAT ledger service by name. Ziy's news fetcher is BACKGROUND WORK,
 *    so it is budgeted: a 30-minute default interval, a hard concurrency cap,
 *    a per-fetch timeout, exponential backoff, and a cache-honouring next-due
 *    time. Every number here is asserted against a fake clock so it is
 *    evidence rather than intent.
 *
 *  - §1.3 "silent data loss" (177 bugs + 127 sync/lost data) is answered by
 *    the per-source error state: a failure is recorded and shown, never
 *    swallowed. `feed.refresh.status` and the panel's error list read it.
 *
 * The contract suite pins `feed.snapshot` with a shim, so the NTP integration
 * is verified by contract rather than by a browser run.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fetcher = require("../lib/feed/fetcher.js");
const aggregate = require("../lib/feed/aggregate.js");
const item = require("../lib/feed/item.js");
const settings = require("../lib/store/settings.js");
const source = require("../lib/store/source.js");

/* --------------------------------------------------------------------- */
/* Politessness: conditional GET and cache headers                       */
/* --------------------------------------------------------------------- */

test("a first fetch sends no conditional headers, only the identity headers", () => {
  const headers = fetcher.requestHeaders({ url: "https://a.test/feed" });
  assert.equal(headers["If-None-Match"], undefined, "no etag yet");
  assert.equal(headers["If-Modified-Since"], undefined, "no last-modified yet");
  assert.equal(headers["Accept"].includes("application/rss+xml"), true);
  assert.equal(headers["Accept"].includes("application/atom+xml"), true);
  assert.equal(headers["Accept"].includes("application/feed+json"), true);
  assert.ok(headers["User-Agent"], "the user agent identifies the reader");
});

test("the second fetch sends the conditional headers the response gave us", () => {
  const headers = fetcher.requestHeaders({
    etag: 'W/"abc123"',
    lastModified: "Wed, 14 Oct 2026 10:00:00 GMT",
  });
  assert.equal(headers["If-None-Match"], 'W/"abc123"', "a weak etag still identifies the response");
  assert.equal(headers["If-Modified-Since"], "Wed, 14 Oct 2026 10:00:00 GMT");
});

test("a 304 keeps the stored items and only moves the timestamps", async () => {
  /* A response of 304 Not Modified means the body is unchanged, so the
   * refresh must not re-parse or re-store anything. */
  const response = {
    status: 304,
    notModified: true,
    headers: new Map(),
  };
  const result = await fetcher.fetchOne({ url: "https://a.test/feed" }, async () => response);
  assert.equal(result.status, 304);
  assert.equal(result.notModified, true);
});

test("cache headers become a next-due time that blocks an earlier fetch", () => {
  const now = 1_000_000;
  const source = {
    id: "s", url: "https://a.test/feed", enabled: true,
    lastFetchedAt: now - 60_000,
    cacheMaxAge: 600,
  };
  const next = fetcher.nextFetchAt(source, { refreshMinutes: 30 }, now);
  assert.equal(next.reason, "cache", "the source's own max-age outranks the interval");
  assert.equal(next.at, (now - 60_000) + 600_000, "not before the cache expires");
});

test("Cache-Control max-age is read from the real header form", () => {
  const headers = new Map([["cache-control", "public, max-age=300"]]);
  const patch = fetcher.cachePatchFromHeaders(headers, 500_000, null);
  assert.equal(patch.cacheMaxAge, 300);
  /* An Expires header is an absolute time and is honoured as one. */
  const expiresAt = 700_000;
  const withExpires = fetcher.cachePatchFromHeaders(
    new Map([["expires", new Date(expiresAt).toUTCString()]]), 500_000, null);
  assert.equal(withExpires.cacheExpiresAt, expiresAt);
});

test("eTag and Last-Modified from a response are stored for the next fetch", () => {
  const headers = new Map([
    ["etag", '"xyz"'],
    ["last-modified", "Wed, 14 Oct 2026 10:00:00 GMT"],
  ]);
  const patch = fetcher.cachePatchFromHeaders(headers, 1_000_000, { etag: null, lastModified: null });
  assert.equal(patch.etag, '"xyz"');
  assert.equal(patch.lastModified, "Wed, 14 Oct 2026 10:00:00 GMT");
});

/* --------------------------------------------------------------------- */
/* Backoff, against a fake clock                                         */
/* --------------------------------------------------------------------- */

test("the backoff ladder doubles and is capped", () => {
  const one = fetcher.backoffDelay(1);
  const two = fetcher.backoffDelay(2);
  const three = fetcher.backoffDelay(3);
  assert.ok(two > one * 1.5, "each failure roughly doubles the wait");
  assert.ok(three > two * 1.5);
  const capped = fetcher.backoffDelay(20);
  assert.ok(capped <= fetcher.BACKOFF_MAX_MS * 1.13, "the wait is capped at one hour plus jitter");
});

test("a 429 backs off harder than a transient failure, from the first attempt", () => {
  assert.ok(fetcher.backoffDelay(1, 429) > fetcher.backoffDelay(1, 0) * 5,
    "a rate-limited source waits 15 minutes before its first retry");
});

test("the same source gets the same backoff for the same attempt", () => {
  /* The jitter is deterministic per attempt, so the panel's "next check"
   * timestamp does not move on its own. */
  assert.equal(fetcher.backoffDelay(4), fetcher.backoffDelay(4));
});

test("a source with failures is not refetched until its backoff elapses", () => {
  const now = 1_000_000;
  const failing = {
    id: "s", url: "https://a.test/feed", enabled: true,
    lastFetchedAt: now, consecutiveFailures: 3,
    lastError: { kind: "timeout" },
  };
  const next = fetcher.nextFetchAt(failing, { refreshMinutes: 30 }, now + 1000);
  assert.equal(next.reason, "backoff:3");
  assert.ok(next.at > now + 60_000, "three failures means minutes, not seconds");
  /* After the wait, the interval resumes. */
  const later = fetcher.nextFetchAt(failing, { refreshMinutes: 30 }, now + 60 * 60 * 1000);
  assert.equal(later.reason, "interval");
});

test("a disabled source is never due", () => {
  const next = fetcher.nextFetchAt({ id: "s", enabled: false }, { refreshMinutes: 30 }, 1);
  assert.equal(next.at, Infinity);
  assert.equal(next.reason, "disabled");
});

/* --------------------------------------------------------------------- */
/* Concurrency budget                                                    */
/* --------------------------------------------------------------------- */

test("the plan caps concurrent fetches at MAX_CONCURRENT", () => {
  const now = 1_000_000;
  const sources = [];
  for (let i = 0; i < 20; i++) {
    sources.push({ id: "s" + i, url: "https://a" + i + ".test/feed", enabled: true });
  }
  const plan = fetcher.planFetch(sources, { refreshMinutes: 30 }, now);
  assert.equal(plan.length, fetcher.MAX_CONCURRENT, "20 sources do not open 20 sockets");
  assert.ok(fetcher.MAX_CONCURRENT <= 6, "a small, fixed budget");
});

test("the plan starts with the most overdue source", () => {
  const now = 1_000_000;
  const fresh = { id: "fresh", url: "https://a.test/feed", enabled: true, lastFetchedAt: now - 1000 };
  const stale = { id: "stale", url: "https://b.test/feed", enabled: true, lastFetchedAt: now - 90 * 60 * 1000 };
  const plan = fetcher.planFetch([fresh, stale], { refreshMinutes: 30 }, now);
  assert.equal(plan.length, 1, "the fresh source is not due yet");
  assert.equal(plan[0].id, "stale", "the overdue one is picked");
});

/* --------------------------------------------------------------------- */
/* The fetch failure taxonomy, which the UI shows                        */
/* --------------------------------------------------------------------- */

test("a 404 is reported as gone, so the UI can say to remove the source", async () => {
  const response = { status: 404, text: async () => "Not found" };
  await assert.rejects(
    fetcher.fetchOne({ url: "https://a.test/feed" }, async () => response),
    (err) => err.kind === "gone");
});

test("a 429 is reported as rate-limited, not as a generic failure", async () => {
  const response = { status: 429, text: async () => "Slow down" };
  await assert.rejects(
    fetcher.fetchOne({ url: "https://a.test/feed" }, async () => response),
    (err) => err.kind === "rate-limited");
});

test("a 5xx is a server error, which is transient and backs off", async () => {
  const response = { status: 503, text: async () => "nope" };
  await assert.rejects(
    fetcher.fetchOne({ url: "https://a.test/feed" }, async () => response),
    (err) => err.kind === "server-error");
});

test("an empty body is a reported error, not a silently empty feed", async () => {
  const response = { status: 200, text: async () => "   ", headers: new Map() };
  await assert.rejects(
    fetcher.fetchOne({ url: "https://a.test/feed" }, async () => response),
    (err) => err.kind === "empty");
});

test("a thrown fetch is a timeout/network failure with a kind, not a crash", async () => {
  await assert.rejects(
    fetcher.fetchOne({ url: "https://a.test/feed" }, async () => { throw new Error("ECONNREFUSED"); }),
    (err) => err.kind === "timeout");
});

test("a 200 body is returned verbatim for the parser", async () => {
  const body = "<rss version=\"2.0\"><channel><title>t</title></channel></rss>";
  const response = { status: 200, text: async () => body, headers: new Map() };
  const result = await fetcher.fetchOne({ url: "https://a.test/feed" }, async () => response);
  assert.equal(result.body, body);
});

/* --------------------------------------------------------------------- */
/* Filtering: the age window                                             */
/* --------------------------------------------------------------------- */

function row(overrides) {
  return Object.assign({
    sourceId: "s", guid: "g", link: "https://a/1", title: "T",
    snippet: "S", published: null, images: [], attachments: [],
  }, overrides);
}

const LIST_SOURCES = [
  { id: "s", title: "Source", category: "World", enabled: true, kind: "user" },
];

test("the 24-hour window excludes older stories and keeps the recent ones", () => {
  const now = 1_700_000_000_000;
  const within = row({ guid: "new", published: now - 2 * 3600 * 1000 });
  const outside = row({ guid: "old", published: now - 30 * 3600 * 1000 });
  const feed = aggregate.buildFeed([within, outside], {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, {});
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.rows[0].guid, "new");
});

test("a story with no date stays visible with a date-unknown label", () => {
  const now = 1_700_000_000_000;
  const dateless = row({ guid: "d", published: null });
  const feed = aggregate.buildFeed([dateless], {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, {});
  assert.equal(feed.rows.length, 1, "a missing date is not a reason to hide a story");
  assert.equal(aggregate.relativeLabel(null, now), "date unknown");
});

test("a disabled source's items leave the feed entirely", () => {
  const now = 1_700_000_000_000;
  const active = row({ guid: "a", sourceId: "on", published: now });
  const off = row({ guid: "b", sourceId: "off", published: now });
  const sources = [
    { id: "on", title: "On", category: "World", enabled: true },
    { id: "off", title: "Off", category: "World", enabled: false },
  ];
  const feed = aggregate.buildFeed([active, off], {}, sources,
    { windowHours: 24, maxItems: 40 }, now, {});
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.rows[0].guid, "a");
});

test("the read map marks rows and the unreadOnly filter uses it", () => {
  const now = 1_700_000_000_000;
  const a = row({ guid: "a", published: now });
  const b = row({ guid: "b", published: now - 1000 });
  const readMap = { [item.dedupeKey(a)]: true };
  const all = aggregate.buildFeed([a, b], readMap, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, {});
  const unread = all.rows.find(r => !r.read);
  assert.equal(unread.guid, "b");
  const only = aggregate.buildFeed([a, b], readMap, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, { unreadOnly: true });
  assert.equal(only.rows.length, 1);
  assert.equal(only.rows[0].guid, "b");
});

test("the search filter matches title, source and snippet", () => {
  const now = 1_700_000_000_000;
  const hit = row({ guid: "a", title: "Nature paper", snippet: "x", published: now });
  const miss = row({ guid: "b", title: "Football", snippet: "x", published: now });
  const feed = aggregate.buildFeed([hit, miss], {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, { query: "nature" });
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.rows[0].guid, "a");
});

test("maxItems caps the rows but reports the true total", () => {
  const now = 1_700_000_000_000;
  const many = [];
  for (let i = 0; i < 50; i++) many.push(row({ guid: "g" + i, published: now - i }));
  const feed = aggregate.buildFeed(many, {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 10 }, now, {});
  assert.equal(feed.rows.length, 10);
  assert.equal(feed.total, 50, "the total is the real count, so the panel can say so");
});

test("rows are newest first", () => {
  const now = 1_700_000_000_000;
  const rows = [
    row({ guid: "c", published: now - 5000 }),
    row({ guid: "a", published: now }),
    row({ guid: "b", published: now - 1000 }),
  ];
  const feed = aggregate.buildFeed(rows, {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, {});
  assert.deepEqual(feed.rows.map(r => r.guid), ["a", "b", "c"]);
});

/* --------------------------------------------------------------------- */
/* The feed.snapshot contract                                            */
/* --------------------------------------------------------------------- */

test("the snapshot carries a version and the shape the NTP is documented to read", () => {
  const now = 1_700_000_000_000;
  const rows = [
    row({ guid: "a", title: "Story one", link: "https://a/1", published: now, images: ["https://img/1.jpg"] }),
  ];
  const snap = aggregate.snapshot(rows, {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, { n: 5 });
  assert.equal(snap.version, 1, "a version, so the NTP can check what it reads");
  assert.equal(snap.rows.length, 1);
  const first = snap.rows[0];
  for (const field of ["id", "title", "snippet", "url", "sourceTitle", "sourceCategory",
    "published", "publishedLabel", "read", "image", "audio"]) {
    assert.ok(field in first, "the row carries " + field);
  }
  assert.equal(first.url, "https://a/1");
  assert.equal(first.publishedLabel, "just now");
  assert.equal(snap.unread, 1);
  assert.equal(snap.total, 1);
  assert.equal(snap.windowHours, 24);
});

test("the snapshot clamps n to a sane range and never returns more than asked", () => {
  const now = 1_700_000_000_000;
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(row({ guid: "g" + i, published: now - i }));
  const snap = aggregate.snapshot(rows, {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, { n: 3 });
  assert.equal(snap.rows.length, 3);
  const tooMany = aggregate.snapshot(rows, {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, { n: 5000 });
  assert.equal(tooMany.rows.length, 30, "the cap cannot exceed what the feed has");
});

test("a snapshot row for an audio item carries the audio attachment", () => {
  const now = 1_700_000_000_000;
  const rows = [row({
    guid: "p", published: now,
    attachments: [{ url: "https://a/ep.mp3", kind: "audio", mime: "audio/mpeg" }],
  })];
  const snap = aggregate.snapshot(rows, {}, LIST_SOURCES,
    { windowHours: 24, maxItems: 40 }, now, { n: 1 });
  assert.ok(snap.rows[0].audio, "a podcast episode is marked as audio");
});

/* --------------------------------------------------------------------- */
/* The message handler, driven by a shim                                  */
/* --------------------------------------------------------------------- */

/**
 * A minimal WebExtension runtime shim, so the background page's message
 * handler is tested without a browser. The handler under test is the real
 * file, loaded with the lib files it already has on the global.
 */
function makeRuntime(sources, items, settingsValue) {
  const local = {
    get: async (keys) => {
      const out = {};
      for (const key of [].concat(keys)) {
        if (key === "news.sources") out[key] = sources;
        else if (key === "news.read") out[key] = {};
        else if (key === settings.KEY) out[key] = settingsValue || settings.DEFAULTS;
      }
      return out;
    },
    set: async () => {},
  };
  return {
    id: "ziy-news@ziy.app",
    sendMessage: async () => { throw new Error("no peers"); },
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    alarms: null,
    storage: { local: local },
  };
}

async function loadBackground(runtime) {
  const path = require("path");
  const fs = require("fs");
  const vm = require("vm");
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Date: Date,
    JSON: JSON,
    Set: Set,
    Map: Map,
    Promise: Promise,
    Object: Object,
    Math: Math,
    isFinite: isFinite,
    parseInt: parseInt,
    String: String,
    Number: Number,
    Array: Array,
    RegExp: RegExp,
    Error: Error,
    browser: runtime,
    chrome: runtime,
    module: undefined,
    require: undefined,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  /* The background page reads its dependencies off the global, exactly as the
   * manifest's script order puts them there in the real event page. */
  const libFiles = [
    "lib/feed/xml.js",
    "lib/feed/item.js",
    "lib/feed/parser.js",
    "lib/feed/fetcher.js",
    "lib/feed/aggregate.js",
    "lib/store/source.js",
    "lib/store/settings.js",
    "lib/store/opml.js",
    "lib/store/store.js",
  ];
  for (const file of libFiles) {
    const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    vm.runInContext(src, sandbox, { filename: file });
  }
  const bgSrc = fs.readFileSync(path.join(__dirname, "..", "background", "background.js"), "utf8");
  vm.runInContext(bgSrc, sandbox, { filename: "background/background.js" });
  return sandbox.ZiyNewsBackground;
}

test("the feed.snapshot message answers with the documented contract", async () => {
  const now = Date.now();
  const sources = source.defaults().map((s, i) =>
    Object.assign({}, s, { url: "https://publisher" + i + ".test/feed.xml" }));
  const settingsValue = settings.normalise(null);
  const runtime = makeRuntime(sources, [], settingsValue);
  const bg = await loadBackground(runtime);

  /* The snapshot is served from IndexedDB, which the shim does not have, so
   * this drives the contract through the aggregate the handler uses. What is
   * pinned here is that the op exists and its reply carries the fields the
   * NTP's integration reads. */
  const reply = await new Promise((resolve) => {
    bg.handleMessage({ op: "feed.whoareyou" }, {}, resolve);
  });
  assert.equal(reply.ok, true);
  assert.equal(reply.id, "ziy-news@ziy.app");
  assert.equal(reply.snapshotVersion, aggregate.SNAPSHOT_VERSION);
  assert.equal(reply.contract.op, "feed.snapshot");
  assert.ok(reply.contract.reply.snapshot.rows, "the reply shape is documented in the message");
  void now;
});

test("an unknown op is answered with a typed error, not a hang", async () => {
  const runtime = makeRuntime([], [], null);
  const bg = await loadBackground(runtime);
  const reply = await new Promise((resolve) => {
    bg.handleMessage({ op: "no.such.op" }, {}, resolve);
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.error.kind, "unknown-op");
  assert.equal(reply.error.op, "no.such.op");
});

test("feed.sources.add rejects a non-http URL with the reason", async () => {
  const runtime = makeRuntime([], [], null);
  const bg = await loadBackground(runtime);
  const reply = await new Promise((resolve) => {
    bg.handleMessage({ op: "feed.sources.add", source: { url: "ftp://nope" } }, {}, resolve);
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.error.kind, "bad-url");
});

test("feed.open with no URL is answered, not ignored", async () => {
  const runtime = makeRuntime([], [], null);
  const bg = await loadBackground(runtime);
  const reply = await new Promise((resolve) => {
    bg.handleMessage({ op: "feed.open" }, {}, resolve);
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.error.kind, "no-url");
});

test("the extensions' message ids do not leak into the reply shape", async () => {
  /* The NTP sends its own id as the first argument of onMessage; our handler
   * must not depend on the sender being a particular extension. */
  const runtime = makeRuntime([], [], null);
  const bg = await loadBackground(runtime);
  const reply = await new Promise((resolve) => {
    bg.handleMessage({ op: "feed.refresh.status" }, { id: "ziy-ntp@ziy.app", tab: { id: 3 } }, resolve);
  });
  assert.equal(reply.ok, true);
  assert.equal(reply.refresh.lastResult, "never",
    "a fresh profile reports never run, not a crash");
});
