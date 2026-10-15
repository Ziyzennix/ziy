/* Ziy news — the normalised item and its dedupe identity.
 *
 * Every one of the four formats is mapped onto one item shape, and the field
 * mapping is decided by each format's specification rather than by trial:
 *
 *  RSS 2.0 (rssboard.org/rss-specification):
 *    title/link/description; guid with isPermaLink (default true); pubDate
 *    is RFC 822; enclosure url/length/type; author is an email address.
 *  Atom 1.0 (RFC 4287):
 *    title (text construct); link rel=alternate (rel defaults to alternate,
 *    §4.2.7.2); id is the dedupe key and MUST NOT be mapped (§2); content vs
 *    summary (§4.1.3: content "is intended for consumption by a reader";
 *    summary is the digest); updated and published are RFC 3339; rel=enclosure
 *    links are attachments with a length attribute (§4.2.7.2).
 *  RSS 1.0 / RDF (purl.org/rss/1.0 + RSS FAQ):
 *    items are typed with rdf:about; rss:link; dc:date; content:encoded.
 *  JSON Feed 1.1 (jsonfeed.org/version/1.1):
 *    id (REQUIRED, coerced to a string; an item without one is discarded);
 *    url is the permalink; content_html/content_text; image; attachments with
 *    url/mime_type/size_in_bytes/duration_in_seconds; authors (preferred over
 *    the deprecated singular author); tags map to categories; dates are
 *    RFC 3339.
 *
 * One shared shape keeps the panel, the NTP snapshot and storage identical
 * across formats, which is what makes the `feed.snapshot` contract simple.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyNewsItem = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------------
   * Dates.
   *
   * Three families appear in real feeds:
   *   RFC 822    "Sat, 07 Sep 2002 09:42:31 GMT"      RSS 2.0, OPML
   *   RFC 3339   "2003-12-13T18:30:02Z"               Atom, JSON Feed
   *              + the W3C "2002-09-06" date-only form
   * RSS 2.0 also permits a two-digit year (the spec's own exception) and a
   * three-letter zone name, both of which appear in the wild.
   * ---------------------------------------------------------------------- */
  const MONTHS = Object.freeze({
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  });

  /** Parses a feed date into epoch milliseconds, or null when unusable. */
  function parseDate(value) {
    if (value == null) return null;
    if (value instanceof Date) return isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number") return isFinite(value) ? value : null;
    const raw = String(value).trim();
    if (!raw) return null;

    /* RFC 3339 / ISO 8601: 2003-12-13T18:30:02Z, with a mandatory uppercase Z
     * absent an offset, per RFC 4287 §3.3. Date.parse also accepts the
     * W3C date-only form, which feeds do emit. */
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const t = Date.parse(raw);
      if (!isNaN(t)) return t;
    }

    /* RFC 822, tolerantly: [Sat,] 07 Sep 2002 09:42:31 [+0000 | GMT | EST] */
    const m = /^(?:[A-Za-z]{3,9},\s*)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(raw);
    if (m) {
      const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (month != null) {
        let year = parseInt(m[3], 10);
        /* RSS 2.0's two-digit-year exception: pivot at 70. */
        if (m[3].length <= 2) year += year < 70 ? 2000 : 1900;
        const offsetMinutes = utcOffsetFromZone(m[7]);
        const stamp = Date.UTC(year, month, parseInt(m[1], 10),
          parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6] || "0", 10));
        /* The stamp was read as if it were UTC. A positive offset (east of
         * UTC) means the wall clock is ahead, so the real instant is EARLIER
         * by that many minutes; a negative offset (west, like EST) means the
         * real instant is LATER. SUBTRACTING the offset (in minutes) does
         * both: +300 minutes east gives an instant 5h earlier, -300 minutes
         * west gives an instant 5h later. */
        if (isFinite(stamp)) return stamp - offsetMinutes * 60 * 1000;
      }
    }
    return null;
  }

  function utcOffsetFromZone(zone) {
    if (!zone) return 0;
    if (zone === "GMT" || zone === "UTC" || zone === "Z" || zone === "UT") return 0;
    const numeric = /^([+-])(\d{2})(\d{2})$/.exec(zone);
    if (numeric) {
      const sign = numeric[1] === "-" ? -1 : 1;
      return sign * (parseInt(numeric[2], 10) * 60 + parseInt(numeric[3], 10));
    }
    /* RFC 822 §5 permits one-letter military zones, and its named alphabetic
     * zones (EST, CST, ...) are obsolete and AMBIGUOUS: "EST" is used for
     * both -0500 and -0400 in real feeds, and single letters repeat three
     * times around the alphabet. The RSS 2.0 spec carries RFC 822's date
     * rules wholesale ("All date-times in RSS conform to the Date and Time
     * Specification of RFC 822"), so a conforming reader must accept the
     * text, but the RFC itself marks the alphabetic form as discouraged.
     *
     * Documented behaviour: the NUMERIC forms (+0000 / -0500) resolve to
     * their exact offset, and the alphabetic and single-letter forms are
     * read as their literal local time with offset 0 — i.e. treated as
     * GMT/UTC, which is the conventional best-practice fallback. The
     * alternative (guessing EST == -0500) silently mis-times the feed and
     * is indistinguishable from the truth downstream. */
    return 0;
  }

  /* ------------------------------------------------------------------------
   * Snippets.
   *
   * A row shows a short plain-text line. Feeds give us HTML (content_html,
   * content:encoded, an Atom html/text summary, an RSS description), so the
   * snippet strips tags and collapses whitespace. Entity decoding happens
   * elsewhere, at parse time, so this works on already-decoded text.
   * ---------------------------------------------------------------------- */
  function stripHtml(html) {
    if (!html) return "";
    return String(html)
      /* Tags, including a script/style body in one pass via the alternation. */
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function snippet(source, limit) {
    const cap = limit || 180;
    const plain = stripHtml(source);
    if (plain.length <= cap) return plain;
    /* Cut at a word boundary so a row never ends mid-word. */
    const cut = plain.slice(0, cap);
    const space = cut.lastIndexOf(" ");
    return (space > cap * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "") + "…";
  }

  /* ------------------------------------------------------------------------
   * Media: enclosures, Atom rel=enclosure links, media:* extensions and
   * JSON Feed attachments all normalise to the same attachment shape.
   * ---------------------------------------------------------------------- */
  function normaliseAttachment(url, mime, length, extra) {
    if (!url) return null;
    const kind = kindOfMime(mime) !== "file" ? kindOfMime(mime) : kindOfUrl(url);
    return Object.assign({
      url: String(url),
      kind: kind,
      mime: String(mime || ""),
      bytes: toFiniteInt(length),
    }, extra || {});
  }

  function kindOfMime(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.indexOf("image/") === 0) return "image";
    if (m.indexOf("audio/") === 0) return "audio";
    if (m.indexOf("video/") === 0) return "video";
    return "file";
  }

  /**
   * The kind of an attachment whose feed gave no usable MIME type. A
   * `media:content` with only a url and a width is the common case, and its
   * extension is the only signal there is.
   */
  function kindOfUrl(url) {
    const ext = extensionOf(url).slice(1);
    return Object.prototype.hasOwnProperty.call(KIND_BY_EXTENSION, ext)
      ? KIND_BY_EXTENSION[ext] : "file";
  }

  function extensionOf(url) {
    const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(url || ""));
    return m ? "." + m[1].toLowerCase() : "";
  }

  /** Extensions that identify a media kind when a feed gives no MIME type. */
  const KIND_BY_EXTENSION = Object.freeze({
    jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", avif: "image", bmp: "image", svg: "image",
    mp3: "audio", m4a: "audio", aac: "audio", ogg: "audio", oga: "audio", opus: "audio", wav: "audio", flac: "audio",
    mp4: "video", m4v: "video", webm: "video", mov: "video", ogv: "video",
  });

  function toFiniteInt(value) {
    const n = parseInt(String(value == null ? "" : value), 10);
    return isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Picks the one image an item shows in a list row. Priority follows what
   * each format designates as the item's own image, with a `media:thumbnail`
   * fallback for feeds that only carry a thumbnail, and the image of the
   * first image attachment as the last resort.
   */
  function pickImage(images, mediaThumbnails, imageAttachments) {
    if (images && images.length > 0) return images[0];
    if (mediaThumbnails && mediaThumbnails.length > 0) return mediaThumbnails[0];
    if (imageAttachments && imageAttachments.length > 0) return imageAttachments[0];
    return null;
  }

  /* ------------------------------------------------------------------------
   * Dedupe.
   *
   * The key is (sourceId, guid) when there is a guid, else
   * (sourceId, link). A guid is opaque (RSS 2.0: "there are no rules for the
   * syntax of a guid. Aggregators must view them as a string"), so it is used
   * verbatim; Atom's id is compared verbatim too (RFC 4287 §4.2.6.1 forbids
   * IRI mapping, exactly so comparison is stable).
   * ---------------------------------------------------------------------- */
  function dedupeKey(item) {
    if (item.guid) return item.sourceId + "\u0000" + item.guid;
    if (item.link) return item.sourceId + "\u0000" + item.link;
    return null;
  }

  /**
   * Dedupes a list of items in place, keeping the FIRST occurrence of each
   * key (which is the newest, because items are sorted newest-first before
   * this runs). Returns { kept, dropped, duplicateKeys } so a caller can
   * report what happened.
   */
  function dedupe(items, keyOf) {
    const seen = new Set();
    const kept = [];
    const dropped = [];
    const duplicateKeys = new Set();
    for (const item of items) {
      const key = keyOf ? keyOf(item) : dedupeKey(item);
      if (!key) {
        /* An item with neither guid nor link cannot be referred to again, so
         * it is kept but can never be marked read by identity. */
        kept.push(item);
        continue;
      }
      if (seen.has(key)) {
        dropped.push(item);
        duplicateKeys.add(key);
        continue;
      }
      seen.add(key);
      kept.push(item);
    }
    return { kept: kept, dropped: dropped, duplicateKeys: duplicateKeys };
  }

  /* Sort newest first, oldest (or dateless) last. */
  function byNewestFirst(a, b) {
    const at = a.published || 0;
    const bt = b.published || 0;
    if (at !== bt) return bt - at;
    return (a.title || "").localeCompare(b.title || "");
  }

  function toIsoString(epoch) {
    if (!epoch) return null;
    try {
      return new Date(epoch).toISOString();
    } catch (_e) {
      return null;
    }
  }

  return {
    parseDate: parseDate,
    stripHtml: stripHtml,
    snippet: snippet,
    normaliseAttachment: normaliseAttachment,
    kindOfMime: kindOfMime,
    kindOfUrl: kindOfUrl,
    extensionOf: extensionOf,
    pickImage: pickImage,
    dedupeKey: dedupeKey,
    dedupe: dedupe,
    byNewestFirst: byNewestFirst,
    toIsoString: toIsoString,
  };
});
