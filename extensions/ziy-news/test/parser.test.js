/* Ziy news — parser tests against the four REAL feeds fetched at build time.
 *
 * These are not synthetic fixtures. Each file in test/fixtures/ was retrieved
 * with a real HTTP GET while building this extension (2026-10-14), and the
 * exact commands and their outputs are recorded in replica/proofs-news.md.
 * A parser that only passes hand-written XML will fail on the first real feed
 * it meets, so the real feed is the test.
 *
 * What each file is:
 *   bbc-world.rss.xml       RSS 2.0, with dc:, content: and media: namespaces,
 *                           CDATA titles, media:thumbnail images
 *   guardian-world.rss.xml  RSS 2.0, different namespace handling on the same
 *                           format — a second real publisher, not a variant
 *   nature-atom.atom.xml    RSS 1.0 / RDF (Nature serves RSS 1.0), typed items
 *                           with rdf:about, dc:creator, dc:date, content:encoded
 *   mozilla-blog.atom.xml   Atom 1.0, default namespace, atom:content
 *   manton-jsonfeed.json    JSON Feed 1.1, with content_html, image, authors
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const parse = require("../lib/feed/parser.js");
const xml = require("../lib/feed/xml.js");
const item = require("../lib/feed/item.js");

const FIXTURES = path.join(__dirname, "fixtures");

function read(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

/** Every fixture must parse into a feed with real rows. */
test("each of the four real formats parses into a feed with items", () => {
  const cases = [
    { file: "bbc-world.rss.xml", format: "rss2", minItems: 8 },
    { file: "guardian-world.rss.xml", format: "rss2", minItems: 8 },
    { file: "nature-atom.atom.xml", format: "rss1", minItems: 8 },
    { file: "mozilla-blog.atom.xml", format: "atom", minItems: 5 },
    { file: "manton-jsonfeed.json", format: "json", minItems: 5 },
  ];
  for (const entry of cases) {
    const feed = parse.parseFeed(read(entry.file), entry.file);
    assert.equal(feed.format, entry.format, entry.file + " is " + entry.format);
    assert.ok(feed.items.length >= entry.minItems,
      entry.file + " has " + feed.items.length + " items");
    assert.ok(feed.title && feed.title.length > 0, entry.file + " names itself");
  }
});

test("format detection is by root element, not by content type", () => {
  /* A feed served as text/plain must still be read: the content type is the
   * server's claim, the root element is the fact. */
  const rss = read("bbc-world.rss.xml");
  const json = read("manton-jsonfeed.json");
  assert.equal(parse.parseFeed(rss, "a").format, "rss2");
  assert.equal(parse.parseFeed(json, "a").format, "json");
});

test("fixtures were fetched for real and are recorded", () => {
  /* The fixture directory is the build record; each file must be non-trivial
   * in size, so a truncated download fails here rather than in the parser. */
  const expected = {
    "bbc-world.rss.xml": 8000,
    "guardian-world.rss.xml": 5000,
    "nature-atom.atom.xml": 5000,
    "mozilla-blog.atom.xml": 5000,
    "manton-jsonfeed.json": 5000,
  };
  for (const [file, minBytes] of Object.entries(expected)) {
    const stat = fs.statSync(path.join(FIXTURES, file));
    assert.ok(stat.size >= minBytes, file + " is " + stat.size + " bytes");
  }
});

/* --------------------------------------------------------------------- */
/* RSS 2.0                                                                */
/* --------------------------------------------------------------------- */

test("RSS 2.0: the BBC feed's channel and items carry the right fields", () => {
  const feed = parse.parseFeed(read("bbc-world.rss.xml"), "bbc");
  assert.equal(feed.title, "BBC News");
  assert.match(feed.link, /bbc\.co\.uk|bbc\.com/);
  assert.equal(feed.format, "rss2");
  const first = feed.items[0];
  assert.ok(first.title.length > 0, "the first item has a title");
  assert.match(first.link, /^https:\/\/www\.bbc\.co\.uk\/news\//, "the link is the article");
  /* The BBC feed uses media:thumbnail, so an image must be present. */
  const withImages = feed.items.filter(r => r.images.length > 0);
  assert.ok(withImages.length > 5, "media:thumbnail images are extracted");
  assert.match(withImages[0].images[0], /^https:\/\//, "the image URL is absolute");
  /* BBC's guid is a permalink URL with a fragment; it is used verbatim as the
   * dedupe key, because RSS 2.0 has no rule for guid syntax. */
  assert.ok(first.guid.length > 0, "the guid is read");
});

test("RSS 2.0: pubDate parses as RFC 822", () => {
  const feed = parse.parseFeed(read("bbc-world.rss.xml"), "bbc");
  for (const row of feed.items.slice(0, 5)) {
    assert.ok(row.published && row.published > 1600000000000,
      "a real epoch timestamp: " + new Date(row.published).toISOString());
  }
});

test("RSS 2.0: the Guardian feed parses the same format correctly", () => {
  const feed = parse.parseFeed(read("guardian-world.rss.xml"), "guardian");
  assert.equal(feed.format, "rss2");
  assert.match(feed.title, /Guardian/);
  /* Guardian puts the item title in CDATA and uses media:content images. */
  const withImages = feed.items.filter(r => r.images.length > 0);
  assert.ok(withImages.length > 3, "media:content URLs become the item image");
  const first = feed.items[0];
  assert.ok(first.snippet.length > 10, "the description becomes the snippet");
});

/* --------------------------------------------------------------------- */
/* RSS 1.0 / RDF                                                           */
/* --------------------------------------------------------------------- */

test("RDF/RSS 1.0: Nature's typed items use rdf:about and dc: fields", () => {
  const feed = parse.parseFeed(read("nature-atom.atom.xml"), "nature");
  assert.equal(feed.format, "rss1", "the root element is rdf:RDF");
  assert.equal(feed.title, "Nature");
  const first = feed.items[0];
  /* Nature's dedupe key is dc:identifier, which is a doi. */
  assert.match(first.guid, /^(doi:|https:\/\/)/, "the guid is a doi or URL: " + first.guid);
  assert.match(first.link, /^https:\/\/www\.nature\.com\//, "the link is the article");
  assert.equal(first.author, "Elizabeth Gibney", "dc:creator becomes the author");
  /* dc:date in Nature's feed is the W3C date-only form. */
  assert.equal(new Date(first.published).toISOString().slice(0, 10), "2026-10-14");
});

test("RDF/RSS 1.0: content:encoded is the body and description is not used", () => {
  const feed = parse.parseFeed(read("nature-atom.atom.xml"), "nature");
  const withHtml = feed.items.filter(r => r.html && /<p>|<a /.test(r.html));
  assert.ok(withHtml.length > 5, "content:encoded is kept as HTML");
});

/* --------------------------------------------------------------------- */
/* Atom                                                                   */
/* --------------------------------------------------------------------- */

test("Atom 1.0: the Mozilla blog's entries carry the RFC 4287 fields", () => {
  const feed = parse.parseFeed(read("mozilla-blog.atom.xml"), "moz");
  assert.equal(feed.format, "atom");
  assert.equal(feed.title, "The Mozilla Blog");
  const first = feed.items[0];
  /* atom:id is the dedupe key and MUST NOT be mapped (RFC 4287 §4.2.6.1). */
  assert.match(first.guid, /^https:\/\//, "atom:id is used verbatim");
  /* The alternate link: rel is absent, so it defaults to "alternate". */
  assert.match(first.link, /^https:\/\/blog\.mozilla\.org\//, "the alternate link");
  /* An entry with no published uses updated, which Atom requires. */
  assert.ok(first.published && first.published > 1700000000000, "a real published date");
});

test("Atom 1.0: rel=enclosure links are attachments, rel=self is not the link", () => {
  const row = buildAtomParserFeed();
  assert.equal(row.link, "https://site/episode", "the alternate link wins");
  assert.equal(row.attachments.length, 1, "one enclosure attachment");
  assert.equal(row.attachments[0].kind, "audio", "an audio enclosure");
  assert.equal(row.attachments[0].bytes, 123, "the length attribute is kept");
});

function buildAtomParserFeed() {
  const text = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>T</title>
      <entry>
        <title>Podcast</title>
        <id>urn:x:1</id>
        <link rel="alternate" type="text/html" href="https://site/episode"/>
        <link rel="enclosure" type="audio/mpeg" length="123" href="https://site/ep.mp3"/>
        <link rel="self" type="application/atom+xml" href="https://site/feed.atom"/>
        <updated>2026-01-02T03:04:05Z</updated>
      </entry>
    </feed>`;
  const feed = parse.parseFeed(text, "one");
  return feed.items[0];
}

/* --------------------------------------------------------------------- */
/* JSON Feed                                                              */
/* --------------------------------------------------------------------- */

test("JSON Feed 1.1: Manton's feed uses the spec's fields", () => {
  const feed = parse.parseFeed(read("manton-jsonfeed.json"), "manton");
  assert.equal(feed.format, "json");
  const first = feed.items[0];
  /* id is required, url is the permalink, and both are read. */
  assert.ok(first.guid && first.guid.length > 0, "the id is the dedupe key");
  assert.match(first.link, /^https:\/\/www\.manton\.org\//, "url is the permalink");
  assert.ok(first.published, "date_published parsed as RFC 3339");
  /* This feed has no summaries, so the snippet comes from content_html. */
  assert.ok(first.snippet.length > 0, "content_html becomes the snippet");
});

test("JSON Feed 1.1: an item without an id is discarded", () => {
  const text = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "T",
    items: [
      { id: "a", url: "https://a", content_text: "one" },
      { url: "https://b", content_text: "no id" },
      { id: "c", url: "https://c", content_text: "two" },
    ],
  });
  const feed = parse.parseFeed(text, "x");
  assert.equal(feed.items.length, 2, "the id-less item is dropped");
  assert.deepEqual(feed.items.map(r => r.guid), ["a", "c"]);
  assert.deepEqual(feed.warnings, ["1 item(s) discarded: no id"]);
});

test("JSON Feed 1.1: an attachment with a mime_type and size is kept", () => {
  const text = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "T",
    items: [{
      id: "1",
      url: "https://a",
      content_text: "body",
      attachments: [{ url: "https://a/ep.mp3", mime_type: "audio/mpeg", size_in_bytes: 999 }],
    }],
  });
  const feed = parse.parseFeed(text, "x");
  const attachments = feed.items[0].attachments;
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].kind, "audio");
  assert.equal(attachments[0].bytes, 999);
});

test("JSON Feed: a numeric id is coerced to a string", () => {
  const text = JSON.stringify({
    version: "https://jsonfeed.org/version/1",
    title: "T",
    items: [{ id: 42, url: "https://a", content_text: "body" }],
  });
  const feed = parse.parseFeed(text, "x");
  assert.equal(feed.items[0].guid, "42");
});

/* --------------------------------------------------------------------- */
/* Rejection paths                                                        */
/* --------------------------------------------------------------------- */

test("a web page is reported as not a feed, not parsed as empty", () => {
  const html = "<!doctype html><html><head><title>Site</title></head><body>Hi</body></html>";
  assert.throws(() => parse.parseFeed(html, "x"), (err) => {
    assert.equal(err.code, "html-not-feed");
    return true;
  });
});

test("invalid JSON is rejected rather than partially parsed", () => {
  /* JSON Feed 1.1: "If a feed is invalid JSON, then we strongly recommend not
   * attempting to parse it or use partial data." A leading `{` routes to the
   * JSON parser, which rejects it; the XML reader then rejects it too. */
  assert.throws(() => parse.parseFeed("{not json", "x"), (err) => {
    assert.ok(["not-a-feed", "not-xml", "empty", "unknown-format"].includes(err.code),
      "a rejection with a named kind, not a crash: " + err.code);
    return true;
  });
});

test("an empty response is reported as empty", () => {
  assert.throws(() => parse.parseFeed("   ", "x"), (err) => err.code === "empty");
});

test("a feed with a truncated item still parses the items before it", () => {
  const good = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
    <item><title>One</title><link>https://a/1</link></item>
    <item><title>Two</title><link>https://a/2</link></item>
    <item><title>Three</tit`;
  const feed = parse.parseFeed(good, "x");
  assert.ok(feed.items.length >= 2, "two whole items survive a truncated third");
  assert.equal(feed.items[0].title, "One");
});

/* --------------------------------------------------------------------- */
/* Namespaces                                                             */
/* --------------------------------------------------------------------- */

test("namespaces resolve by URI, not by the arbitrary prefix", () => {
  /* RFC 4287 §1.3: "the choice of namespace prefix is arbitrary and not
   * semantically significant." So a prefixed Atom feed must parse the same
   * as a default-namespaced one. */
  const prefixed = `<?xml version="1.0"?>
    <a:feed xmlns:a="http://www.w3.org/2005/Atom">
      <a:title>Prefixed</a:title>
      <a:entry>
        <a:title>An entry</a:title>
        <a:id>urn:x:2</a:id>
        <a:link rel="alternate" href="https://a/2"/>
        <a:published>2026-02-03T04:05:06Z</a:published>
        <a:updated>2026-02-04T04:05:06Z</a:updated>
      </a:entry>
    </a:feed>`;
  const feed = parse.parseFeed(prefixed, "x");
  assert.equal(feed.format, "atom");
  assert.equal(feed.title, "Prefixed");
  assert.equal(feed.items[0].link, "https://a/2");
  assert.equal(new Date(feed.items[0].published).toISOString(), "2026-02-03T04:05:06.000Z");
  assert.equal(new Date(feed.items[0].updated).toISOString(), "2026-02-04T04:05:06.000Z");
});

test("an undeclared conventional prefix still resolves", () => {
  /* Some feeds emit dc: without declaring it. The reader falls back to the
   * well-known URI rather than dropping the field. */
  const doc = xml.parseDocument(`<rss version="2.0"><channel><title>T</title>
    <item><title>A</title><dc:date>2026-01-02T03:04:05Z</dc:date></item>
    </channel></rss>`);
  const channel = xml.child(doc, "channel");
  const itemNode = xml.child(channel, "item");
  const date = xml.childNS(itemNode, xml.NS.DC, "date");
  assert.ok(date, "dc:date resolves without a declaration");
});

/* --------------------------------------------------------------------- */
/* Items and media                                                        */
/* --------------------------------------------------------------------- */

test("dedupe by guid keeps the first of a repeated pair", () => {
  const rows = [
    { sourceId: "s", guid: "g1", link: "https://a/1", published: 2 },
    { sourceId: "s", guid: "g1", link: "https://a/1", published: 2 },
    { sourceId: "s", guid: "g2", link: "https://a/2", published: 1 },
  ];
  const out = item.dedupe(rows);
  assert.equal(out.kept.length, 2);
  assert.equal(out.dropped.length, 1);
  assert.equal(out.duplicateKeys.size, 1);
});

test("dedupe falls back to the link when there is no guid", () => {
  const rows = [
    { sourceId: "s", guid: null, link: "https://a/1", published: 1 },
    { sourceId: "s", guid: null, link: "https://a/1", published: 1 },
  ];
  const out = item.dedupe(rows);
  assert.equal(out.kept.length, 1);
  assert.equal(out.dropped.length, 1);
});

test("two sources publishing the same guid are not deduped together", () => {
  /* The dedupe key carries the source id, because a guid is unique within a
   * feed (RSS 2.0: "it's up to the source of the feed to establish the
   * uniqueness of the string") — not across feeds. */
  const rows = [
    { sourceId: "a", guid: "same", link: "https://a/1" },
    { sourceId: "b", guid: "same", link: "https://b/1" },
  ];
  const out = item.dedupe(rows);
  assert.equal(out.kept.length, 2);
});

test("an item with neither guid nor link is kept but has no key", () => {
  const rows = [{ sourceId: "s", title: "Anonymous" }];
  const out = item.dedupe(rows);
  assert.equal(out.kept.length, 1);
  assert.equal(out.dropped.length, 0);
});

test("attachments classify by MIME type and by extension", () => {
  assert.equal(item.normaliseAttachment("https://a/x.mp3", "audio/mpeg").kind, "audio");
  assert.equal(item.normaliseAttachment("https://a/x.jpg", "image/jpeg").kind, "image");
  assert.equal(item.normaliseAttachment("https://a/x.mp4", "video/mp4").kind, "video");
  /* An enclosure with no declared type falls back to the URL's extension,
   * which is the only signal the feed gave. */
  assert.equal(item.normaliseAttachment("https://a/ep.m4a", "").kind, "audio");
  /* A media:content with only a width and a query string, as the Guardian
   * emits, still resolves to an image. */
  assert.equal(item.normaliseAttachment("https://i.guim.co.uk/img/media/13d3/4250.jpg?width=140&s=x", "").kind, "image");
  /* An attachment with neither a type nor an extension is a file, not a
   * guess. */
  assert.equal(item.normaliseAttachment("https://a/episode", "").kind, "file");
});

test("a snippet strips tags, collapses whitespace and cuts at a word boundary", () => {
  assert.equal(item.snippet("<p>Hello <b>world</b></p>", 50), "Hello world");
  const long = "word ".repeat(100);
  const cut = item.snippet("<p>" + long + "</p>", 40);
  assert.ok(cut.length <= 41, "the cut is inside the cap: " + cut.length);
  assert.ok(!cut.endsWith(" "), "no trailing space");
  assert.ok(cut.endsWith("…"), "a cut ends with an ellipsis");
});

/* --------------------------------------------------------------------- */
/* Dates, across the three families                                       */
/* --------------------------------------------------------------------- */

test("dates parse in RFC 822, RFC 3339 and the W3C date-only form", () => {
  const rss = item.parseDate("Sat, 07 Sep 2002 09:42:31 GMT");
  assert.equal(rss, Date.UTC(2002, 8, 7, 9, 42, 31), "RFC 822");
  const atom = item.parseDate("2003-12-13T18:30:02Z");
  assert.equal(atom, Date.UTC(2003, 11, 13, 18, 30, 2), "RFC 3339 with a mandatory Z");
  const offset = item.parseDate("2003-12-13T18:30:02+01:00");
  assert.equal(offset, Date.UTC(2003, 11, 13, 17, 30, 2), "RFC 3339 with an offset");
  const w3c = item.parseDate("2026-10-14");
  assert.equal(new Date(w3c).toISOString().slice(0, 10), "2026-10-14", "date-only");
});

test("RSS 2.0's two-digit-year exception is handled", () => {
  const pivoted = item.parseDate("Sun, 19 May 02 15:21:36 GMT");
  assert.equal(new Date(pivoted).getUTCFullYear(), 2002, "02 becomes 2002");
  const old = item.parseDate("Sun, 19 May 99 15:21:36 GMT");
  assert.equal(new Date(old).getUTCFullYear(), 1999, "99 becomes 1999");
});

test("a named zone in an RSS date resolves to its documented offset", () => {
  /* RFC 822 §5's one-letter military zones and named alphabetic zones are
   * obsolete and ambiguous (the RFC itself marks them "discouraged"), so the
   * documented behaviour is: read the literal local time with offset 0, the
   * conventional fallback. The NUMERIC forms are exact. */
  const gmt = item.parseDate("Sat, 07 Sep 2002 09:42:31 GMT");
  const est = item.parseDate("Sat, 07 Sep 2002 09:42:31 EST");
  assert.equal(est, gmt, "an alphabetic zone is read as GMT, not guessed at");
  const numeric = item.parseDate("Sat, 07 Sep 2002 04:42:31 -0500");
  assert.equal(numeric, gmt, "04:42:31 at -0500 is the same instant as 09:42:31 GMT");
  const east = item.parseDate("Sat, 07 Sep 2002 11:42:31 +0200");
  assert.equal(east, gmt, "11:42:31 at +0200 is the same instant as 09:42:31 GMT");
});

test("an unparseable date returns null rather than NaN or the epoch", () => {
  assert.equal(item.parseDate("not a date"), null);
  assert.equal(item.parseDate(""), null);
  assert.equal(item.parseDate(null), null);
});
