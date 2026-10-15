/* Ziy news — OPML 2.0 round-trip and the store models.
 *
 * OPML shape follows opml.org/spec2.opml: <opml version="2.0">, a <head>,
 * a <body>, and subscription nodes of type="rss" with the required `text`
 * and `xmlUrl`. Import is deliberately more generous (a node with an xmlUrl
 * and no type is a feed), because real files in the wild vary.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const opml = require("../lib/store/opml.js");
const source = require("../lib/store/source.js");
const settings = require("../lib/store/settings.js");
const store = require("../lib/store/store.js");

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* --------------------------------------------------------------------- */
/* Round trip                                                            */
/* --------------------------------------------------------------------- */

test("a round trip keeps every source, its category and its enabled state", () => {
  const raw = [
    { title: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml", siteUrl: "https://bbc.co.uk", category: "World" },
    { title: "Guardian", url: "https://www.theguardian.com/world/rss", category: "World", enabled: false },
    { title: "Manton", url: "https://www.manton.org/feed.json", category: "" },
  ];
  const sources = raw.map(r => source.normalise(r, null)).filter(Boolean);
  const out = opml.exportSources(sources);
  const back = opml.importOpml(out.text);
  assert.equal(back.sources.length, sources.length, "no source is lost");
  const byUrl = new Map(sources.map(s => [s.url, s]));
  for (const row of back.sources) {
    const original = byUrl.get(row.url);
    assert.ok(original, "a round-tripped URL is one we exported: " + row.url);
    assert.equal(row.category, original.category, "the category survives");
    assert.equal(row.enabled, original.enabled, "enabled survives");
    assert.equal(row.siteUrl, original.siteUrl, "the htmlUrl survives");
  }
});

test("export is valid OPML 2.0 shape", () => {
  const out = opml.exportSources(source.defaults());
  const doc = out.text;
  assert.match(doc, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<opml version="2\.0"/);
  assert.match(doc, /<head>[\s\S]*<title>Ziy News subscriptions<\/title>/);
  assert.match(doc, /<body>/);
  /* Every starter feed is a type="rss" node with the spec's required attrs. */
  for (const s of source.defaults()) {
    assert.match(doc, new RegExp('type="rss"[^/>]*xmlUrl="' + escapeForRegex(s.url) + '"'),
      s.url + " is a subscription node");
  }
  /* dateCreated is an RFC 822 date-time, as the OPML spec requires. */
  assert.match(doc, /<dateCreated>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/dateCreated>/);
});

test("export groups by category and hoists uncategorised to the top level", () => {
  const sources = [
    { title: "A", url: "https://a.test/feed.xml", category: "Tech" },
    { title: "B", url: "https://b.test/feed.xml", category: "Tech" },
    { title: "C", url: "https://c.test/feed.xml", category: "" },
  ].map(r => source.normalise(r, null));
  const out = opml.exportSources(sources);
  assert.match(out.text, /<outline text="Tech">/);
  const back = opml.importOpml(out.text);
  const cat = new Map(back.sources.map(s => [s.url, s.category]));
  assert.equal(cat.get("https://a.test/feed.xml"), "Tech");
  assert.equal(cat.get("https://c.test/feed.xml"), "Uncategorised", "an uncategorised source is hoisted, not filed under emptiness");
  assert.equal(out.counts.grouped, 2);
  assert.equal(out.counts.flat, 1);
});

test("import reads a nested directory structure as categories", () => {
  const text = `<?xml version="1.0"?>
<opml version="2.0"><head><title>t</title></head><body>
  <outline text="Tech">
    <outline text="Ars" type="rss" xmlUrl="https://ars.test/feed"/>
    <outline text="Heise" type="rss" xmlUrl="https://heise.test/feed" htmlUrl="https://heise.de"/>
  </outline>
  <outline text="Science">
    <outline text="Nature" type="rss" xmlUrl="https://nature.test/feed"/>
  </outline>
  <outline text="Loose" type="rss" xmlUrl="https://loose.test/feed"/>
</body></opml>`;
  const result = opml.importOpml(text);
  assert.equal(result.sources.length, 4);
  const byUrl = new Map(result.sources.map(s => [s.url, s]));
  assert.equal(byUrl.get("https://ars.test/feed").category, "Tech");
  assert.equal(byUrl.get("https://nature.test/feed").category, "Science");
  assert.equal(byUrl.get("https://loose.test/feed").category, "Uncategorised");
  assert.equal(byUrl.get("https://heise.test/feed").siteUrl, "https://heise.de");
});

test("import reads a feed node whose type attribute is omitted", () => {
  /* The spec requires type, but a node carrying an xmlUrl is a feed whatever
   * it says. Dropping it would strand the user's subscriptions. */
  const text = `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline text="No type" xmlUrl="https://a.test/feed.xml"/>
</body></opml>`;
  const result = opml.importOpml(text);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://a.test/feed.xml");
});

test("import rejects a non-OPML root and an empty body", () => {
  assert.throws(() => opml.importOpml("<html><body>nope</body></html>"), (e) => e.code === "not-opml");
  assert.throws(() => opml.importOpml("<opml version=\"2.0\"><head><title>t</title></head><body/></opml>"),
    (e) => e.code === "no-feeds");
});

test("import de-duplicates within a file and skips non-http URLs", () => {
  const text = `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline text="A" type="rss" xmlUrl="https://a.test/feed"/>
  <outline text="A again" type="rss" xmlUrl="https://a.test/feed"/>
  <outline text="FTP" type="rss" xmlUrl="ftp://a.test/feed"/>
  <outline text="Bad" type="rss" xmlUrl="not a url"/>
</body></opml>`;
  const result = opml.importOpml(text);
  assert.equal(result.sources.length, 1);
  assert.equal(result.counts.skipped, 3, "the duplicate and the two unusable URLs are reported, not silently dropped");
  assert.equal(result.skipped[0].reason, "already in this file");
});

test("import honours enabled=false, which the spec allows as an attribute", () => {
  const text = `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline text="X" type="rss" xmlUrl="https://a.test/feed" enabled="false"/>
</body></opml>`;
  const result = opml.importOpml(text);
  assert.equal(result.sources[0].enabled, false);
});

/* --------------------------------------------------------------------- */
/* Source model                                                          */
/* --------------------------------------------------------------------- */

test("a source id is stable for the same URL, so a re-add updates not duplicates", () => {
  assert.equal(source.makeId("https://a.test/feed"), source.makeId("https://a.test/feed"));
  assert.equal(source.makeId("https://a.test/feed"), source.makeId("http://www.a.test/feed/"));
  assert.notEqual(source.makeId("https://a.test/feed"), source.makeId("https://b.test/feed"));
});

test("normalise rejects a non-http URL and falls back to the host as the title", () => {
  assert.equal(source.normalise({ url: "ftp://x/y" }), null);
  assert.equal(source.normalise({ url: "" }), null);
  const row = source.normalise({ url: "https://www.example.com/feed.xml" }, null);
  assert.equal(row.title, "example.com", "no title means the host is used, without the www");
  assert.equal(row.category, "Uncategorised");
  assert.equal(row.enabled, true);
});

test("the default starter set is complete, valid and one per publisher", () => {
  const defaults = source.defaults();
  assert.ok(defaults.length >= 8, "a starter set with enough to read");
  const urls = new Set();
  for (const s of defaults) {
    assert.ok(source.isHttpUrl(s.url), s.url + " is a usable URL");
    assert.ok(s.title.length > 0);
    assert.ok(s.category.length > 0);
    urls.add(s.url);
  }
  assert.equal(urls.size, defaults.length, "no source is listed twice");
  /* Every starter feed must have been fetched and parsed during the build;
   * the identities the parser recognises are pinned here. */
  const formats = new Set(defaults.map(s => s.format));
  assert.ok(formats.has("rss2") && formats.has("atom"), "the starter set covers both XML families");
});

/* --------------------------------------------------------------------- */
/* Settings                                                              */
/* --------------------------------------------------------------------- */

test("settings clamp nonsense to working defaults", () => {
  const defaults = settings.normalise(null);
  assert.equal(defaults.refreshMinutes, 30, "the prompt's default");
  assert.equal(defaults.windowHours, 24);
  assert.equal(defaults.maxItems, 40);
  const junk = settings.normalise({ refreshMinutes: "ten", windowHours: 5, maxItems: 9999,
    openLinksInNewTab: "yes", showImages: 1 });
  assert.equal(junk.refreshMinutes, 30);
  assert.equal(junk.windowHours, 24);
  assert.equal(junk.maxItems, 100, "the cap is the documented maximum");
  assert.equal(junk.openLinksInNewTab, false, "a non-boolean does not become true");
  assert.equal(junk.showImages, true, "a non-boolean does not become false");
});

test("settings patch keeps unchanged fields and applies a valid one", () => {
  const base = settings.normalise(null);
  const next = settings.patch(base, { refreshMinutes: 60 });
  assert.equal(next.refreshMinutes, 60);
  assert.equal(next.windowHours, 24, "an untouched field is untouched");
  const back = settings.patch(next, { refreshMinutes: 30 });
  assert.equal(back.refreshMinutes, 30);
});

/* --------------------------------------------------------------------- */
/* Storage model                                                          */
/* --------------------------------------------------------------------- */

test("pruning drops items past the age horizon and past the per-source cap", () => {
  const now = Date.now();
  const old = { key: "s\u0000old", sourceId: "s", published: now - 30 * 24 * 3600 * 1000 };
  const fresh = { key: "s\u0000fresh", sourceId: "s", published: now - 3600 * 1000 };
  const out = store.pruneItems([old, fresh], now);
  assert.equal(out.dropped, 1, "the 30-day-old item is dropped");
  assert.equal(out.droppedKeys[0], "s\u0000old");
  assert.equal(out.kept.length, 1);

  const many = [];
  for (let i = 0; i < 400; i++) {
    many.push({ key: "s\u0000" + i, sourceId: "s", published: now - i * 1000 });
  }
  const capped = store.pruneItems(many, now, 300);
  assert.equal(capped.kept.length, 300, "the per-source cap holds the newest 300");
  assert.equal(capped.kept[0].key, "s\u00000", "the newest is kept first");
  assert.equal(capped.dropped, 100);
});

test("pruning keeps an item with no date rather than dropping it", () => {
  /* A missing date is a real state; hiding a story because the feed's date
   * is broken is worse than showing it with "date unknown". */
  const now = Date.now();
  const dateless = { key: "s\u0000x", sourceId: "s", published: null, guid: "x" };
  const out = store.pruneItems([dateless], now);
  assert.equal(out.kept.length, 1);
});

test("an item with no key at all is dropped by pruning", () => {
  const out = store.pruneItems([{ sourceId: "s", title: "no key" }], Date.now());
  assert.equal(out.kept.length, 0, "an unnameable item cannot be kept or referred to");
});

test("read state tolerates a corrupt stored value", () => {
  assert.deepEqual(store.normaliseReadState(null), {});
  assert.deepEqual(store.normaliseReadState("{not json"), {});
  const good = store.normaliseReadState({ "s\u0000a": true, "bad": true, "s\u0000b": false });
  assert.deepEqual(good, { "s\u0000a": true }, "only well-formed keys are kept");
});

test("the refresh record is normalised to a working shape", () => {
  const empty = store.normaliseRefresh(null);
  assert.equal(empty.lastRunAt, 0);
  assert.equal(empty.sources, 0);
  const partial = store.normaliseRefresh({ lastRunAt: 5, sources: 2, failed: 1 });
  assert.equal(partial.sources, 2);
  assert.equal(partial.ok, 0, "an absent field is a real zero, not undefined");
});

test("the storage schema names the stores the event page writes", () => {
  const names = store.SCHEMA.stores.map(s => s.name);
  assert.deepEqual(names, ["items", "meta", "refreshLog"]);
  const items = store.SCHEMA.stores[0];
  assert.equal(items.keyPath, "key", "the dedupe key is the primary key");
  const indexNames = items.indexes.map(i => i.name);
  assert.ok(indexNames.includes("sourceId"));
  assert.ok(indexNames.includes("published"), "the published index serves the age window");
});
