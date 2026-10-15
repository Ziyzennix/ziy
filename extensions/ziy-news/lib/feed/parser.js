/* Ziy news — the four feed parsers.
 *
 * One entry point, `parseFeed`, takes the fetched text plus a source id and
 * returns a normalised feed:
 *
 *   { sourceId, format, title, link, description, language, icon,
 *     items: [Item], warnings: [String] }
 *
 * Format detection is by ROOT ELEMENT, never by content type, because feeds
 * are routinely served with the wrong one (a real JSON Feed served as
 * application/json, a real RSS served as text/html). JSON Feed itself
 * requires the `version` string to match exactly
 * (jsonfeed.org/version/1.1: "since this is currently the only version, it
 * must match exactly").
 */
(function (root, factory) {
  "use strict";
  /* Under node the UMD globals are not populated by a require of THIS file,
   * so resolve the dependencies the CommonJS way when they exist. */
  const xml = (typeof require === "function") ? require("./xml.js") : root.ZiyFeedXml;
  const item = (typeof require === "function") ? require("./item.js") : root.ZiyNewsItem;
  const impl = factory(xml, item);
  if (typeof module === "object" && module.exports) module.exports = impl;
  root.ZiyNewsParse = impl;
})(typeof globalThis !== "undefined" ? globalThis : this, function (xml, item) {
  "use strict";

  const NS = xml.NS;

  const FORMATS = Object.freeze({
    RSS2: "rss2",
    ATOM: "atom",
    RSS1: "rss1",
    JSON: "json",
  });

  const MAX_ITEMS = 500;

  /* ------------------------------------------------------------------------
   * The normalised item each parser produces.
   *
   *  guid      the format's own identifier, opaque
   *  link      the permalink the browser opens
   *  title     plain text (HTML entities already decoded at XML level)
   *  snippet   a plain-text one-liner
   *  html      the feed's full body when it offered one (may be null)
   *  author    the byline when the feed gave one
   *  published epoch ms or null
   *  updated   epoch ms or null (Atom's updated is required to exist)
   *  categories[]
   *  images[[]  urls the feed designates as the item's own image
   *  attachments[] { url, kind, mime, bytes, duration, title }
   *  raw       the source element's raw text, for a debug dump
   * ---------------------------------------------------------------------- */
  function makeItem(sourceId, fields) {
    const value = Object.assign({
      sourceId: sourceId,
      guid: null,
      link: null,
      title: "",
      snippet: "",
      html: null,
      author: null,
      published: null,
      updated: null,
      categories: [],
      images: [],
      attachments: [],
    }, fields);
    return value;
  }

  /* ------------------------------------------------------------------------
   * Atom text constructs (RFC 4287 §3.1).
   *
   * `type` is "text" (the default, plain text), "html" (escaped HTML to
   * decode) or a MIME type, of which "xhtml" (or any XML media type) means
   * the element's inner markup is the value. The mode is per-element, so an
   * entry title can be text while its content is html.
   * ---------------------------------------------------------------------- */
  function atomText(el) {
    if (!el) return null;
    const type = String(el.attrs.type || "text").toLowerCase();
    const textValue = (el.xhtml != null ? el.xhtml : el.text) || "";
    if (type === "html") return xml.decodeEntities(textValue);
    if (type === "xhtml" || type.indexOf("/xml") >= 0 || type.indexOf("+xml") >= 0) {
      return textValue;
    }
    /* "text" and an unknown/plain MIME type: the source is literal. */
    return textValue;
  }

  /* A person construct: atom:name, falling back to atom:email, then to the
   * RSS convention of "email (Name)". */
  function atomAuthor(el, xml) {
    if (!el) return null;
    try {
      const name = xml.child(el, "name");
      if (name && name.text) return xml.decodeEntities(name.text).trim();
      const email = xml.child(el, "email");
      if (email && email.text) return xml.decodeEntities(email.text).trim();
    } catch (_e) {
      /* A person element without name or email is not an error. */
    }
    return null;
  }

  /* ------------------------------------------------------------------------
   * RSS 2.0
   * ---------------------------------------------------------------------- */
  function parseRss2(doc, sourceId) {
    const channel = xml.child(doc, "channel");
    if (!channel) return null;
    const items = [];
    const itemNodes = xml.childrenNamed(channel, "item");
    for (const node of itemNodes.slice(0, MAX_ITEMS)) {
      const title = xml.text(node, "title");
      const link = xml.text(node, "link");
      const description = xml.rawChild(node, "description");
      const encoded = xml.textNS(node, NS.CONTENT, "encoded");
      const guidNode = xml.child(node, "guid");
      const guid = guidNode ? guidNode.text : null;
      const isPermaLink = guidNode ? String(guidNode.attrs.isPermaLink) !== "false" : true;
      const authorEmail = xml.text(node, "author");
      const creator = xml.textNS(node, NS.DC, "creator");
      const pubDate = xml.text(node, "pubDate") || xml.textNS(node, NS.DC, "date");

      const categories = [];
      for (const c of xml.childrenNamed(node, "category")) {
        if (c.text) categories.push(xml.decodeEntities(c.text));
      }

      /* Enclosures first: RSS 2.0's own media hook. A media:content or
       * media:thumbnail is the namespace extension, same role. */
      const attachments = [];
      for (const enc of xml.childrenNamed(node, "enclosure")) {
        const a = item.normaliseAttachment(
          enc.attrs.url,
          enc.attrs.type,
          enc.attrs.length,
          { title: null, duration: null }
        );
        if (a) attachments.push(a);
      }
      for (const m of xml.childrenNamed(node, "content")) {
        if (m.uri !== NS.MEDIA) continue;
        const a = item.normaliseAttachment(
          m.attrs.url,
          m.attrs.type || m.attrs.medium,
          m.attrs.fileSize != null ? m.attrs.fileSize : null,
          { title: m.attrs.title || null, duration: null }
        );
        if (a) attachments.push(a);
      }

      const mediaThumbnails = [];
      for (const t of xml.childrenNamed(node, "thumbnail")) {
        if (t.uri !== NS.MEDIA) continue;
        if (t.attrs.url) mediaThumbnails.push(t.attrs.url);
      }

      const images = [];
      for (const a of attachments) if (a.kind === "image") images.push(a.url);
      for (const url of mediaThumbnails) if (images.indexOf(url) < 0) images.push(url);

      const html = encoded || description || null;
      const published = item.parseDate(pubDate);

      items.push(makeItem(sourceId, {
        guid: guid || null,
        link: link || (isPermaLink && guid && /^https?:\/\//.test(guid) ? guid : null),
        title: title || "",
        snippet: item.snippet(html || "", 180),
        html: html,
        author: creator || cleanEmail(authorEmail) || null,
        published: published,
        updated: null,
        categories: categories,
        images: images,
        attachments: attachments,
        raw: node.raw,
      }));
    }

    return {
      format: FORMATS.RSS2,
      title: xml.text(channel, "title") || "",
      link: xml.text(channel, "link") || "",
      description: stripTags(xml.text(channel, "description") || ""),
      language: xml.text(channel, "language"),
      icon: xml.textNS(channel, NS.MEDIA, "thumbnail") ||
            imageUrlOf(channel) || null,
      items: items,
    };
  }

  function imageUrlOf(channel) {
    const image = xml.child(channel, "image");
    if (image && image.children) {
      const url = xml.child(image, "url");
      if (url) return url.text;
    }
    return null;
  }

  /* RSS 2.0's author is "lawyer@boyer.net (Lawyer Boyer)" — an email with an
   * optional parenthesised name. A reader shows the name when there is one. */
  function cleanEmail(value) {
    if (!value) return null;
    const m = /^\s*[^@\s<]+@[^@\s]+\s*\(([^)]+)\)\s*$/.exec(value);
    if (m) return m[1].trim();
    const angle = /^\s*"?([^"<]+)"?\s*<[^>]*>\s*$/.exec(value);
    if (angle) return angle[1].trim();
    const bare = /^\s*[^@\s]+@[^@\s]+\s*$/.exec(value);
    if (bare) return null;
    return value.trim() || null;
  }

  function stripTags(value) {
    return item.stripHtml(value);
  }

  /* ------------------------------------------------------------------------
   * Atom 1.0 (RFC 4287)
   * ---------------------------------------------------------------------- */
  function parseAtom(doc, sourceId) {
    /* Any element named "feed" that is in the Atom namespace by ANY prefix —
     * or in no namespace at all, which feeds in the wild emit. The check is
     * the URI, never the prefix (RFC 4287 §1.3). */
    const feed = doc.name === "feed" && (doc.uri === NS.ATOM || doc.uri === null) ? doc : null;
    if (!feed) return null;

    const items = [];
    for (const node of xml.childrenNamed(feed, "entry").slice(0, MAX_ITEMS)) {
      const title = atomText(xml.child(node, "title"));
      const link = atomLink(node, "alternate");
      const idNode = xml.child(node, "id");
      const id = idNode ? idNode.text : null;
      const summary = atomText(xml.child(node, "summary"));
      const content = atomContent(xml.child(node, "content"));
      const authorNode = xml.child(node, "author") ||
        (xml.child(feed, "author") ? feed : null) && xml.child(node, "author");
      const author = atomAuthor(xml.child(node, "author"), xml) ||
        atomAuthor(xml.child(feed, "author"), xml);
      const published = item.parseDate(xml.text(node, "published"));
      const updated = item.parseDate(xml.text(node, "updated"));

      const categories = [];
      for (const c of xml.childrenNamed(node, "category")) {
        const label = c.attrs.label || c.attrs.term;
        if (label) categories.push(label);
      }

      /* rel="enclosure" links are attachments (RFC 4287 §4.2.7.2: "a related
       * resource that is potentially large in size and might require special
       * handling ... the length attribute SHOULD be provided"). */
      const attachments = [];
      for (const linkEl of xml.childrenNamed(node, "link")) {
        const rel = linkEl.attrs.rel || "alternate";
        if (rel === "enclosure" && linkEl.attrs.href) {
          const a = item.normaliseAttachment(
            linkEl.attrs.href,
            linkEl.attrs.type,
            linkEl.attrs.length,
            { title: linkEl.attrs.title || null, duration: null }
          );
          if (a) attachments.push(a);
        }
      }
      const images = [];
      for (const a of attachments) if (a.kind === "image") images.push(a.url);

      const body = content || summary || null;
      items.push(makeItem(sourceId, {
        guid: id || null,
        link: link,
        title: title || "",
        snippet: item.snippet(body || "", 180),
        html: body,
        author: author,
        published: published,
        updated: updated,
        categories: categories,
        images: images,
        attachments: attachments,
        raw: node.raw,
      }));
    }

    return {
      format: FORMATS.ATOM,
      title: atomText(xml.child(feed, "title")) || "",
      link: atomLink(feed, "alternate") || "",
      description: stripTags(atomText(xml.child(feed, "subtitle")) || ""),
      language: feed.attrs["xml:lang"] || null,
      icon: atomText(xml.child(feed, "icon")) || atomText(xml.child(feed, "logo")) || null,
      items: items,
    };
  }

  /**
   * The alternate link. RFC 4287 §4.2.7.2: an absent `rel` means "alternate",
   * so a link with no rel is the page, and a rel="self" link is the feed.
   * Where several alternates exist the first wins, preferring text/html.
   */
  function atomLink(el, rel) {
    let first = null;
    for (const linkEl of xml.childrenNamed(el, "link")) {
      const href = linkEl.attrs.href;
      if (!href) continue;
      const linkRel = linkEl.attrs.rel || "alternate";
      if (linkRel !== rel) continue;
      if (rel === "alternate") {
        const type = linkEl.attrs.type || "text/html";
        if (type === "text/html" || type === "application/xhtml+xml") return href;
      }
      if (!first) first = href;
    }
    return first;
  }

  /**
   * Atom content. §4.1.3: content "is intended for consumption by a reader",
   * while an entry's summary is "a digest". So content wins over summary for
   * the body, and both honour the type attribute; a `src` attribute means the
   * content is elsewhere and the element is empty.
   */
  function atomContent(el) {
    if (!el) return null;
    if (el.attrs.src) return null;
    return atomText(el);
  }

  /* ------------------------------------------------------------------------
   * RSS 1.0 / RDF (the RSS 1.0 spec: items are resources)
   * ---------------------------------------------------------------------- */
  function parseRss1(doc, sourceId) {
    const rdf = doc.uri === NS.RDF || doc.name === "RDF";
    if (!rdf) return null;
    const channel = xml.child(doc, "channel");
    if (!channel) return null;

    const items = [];
    for (const node of xml.childrenNamed(doc, "item").slice(0, MAX_ITEMS)) {
      /* Both the typed form (<item rdf:about="...">) and the plain form
       * occur. rdf:about is the resource, so it is the identifier; the
       * `about` attribute also lives on the typed item, which is the same
       * value read differently. */
      const guid = node.attrs.about || xml.text(node, "identifier") || null;
      const link = xml.text(node, "link");
      const title = xml.text(node, "title");
      const description = xml.rawChild(node, "description");
      const encoded = xml.textNS(node, NS.CONTENT, "encoded");
      const dd = xml.textNS(node, NS.DC, "date") || xml.text(node, "date");
      const creator = xml.textNS(node, NS.DC, "creator");

      const categories = [];
      for (const c of xml.childrenNamed(node, "category")) {
        if (c.text) categories.push(xml.decodeEntities(c.text));
      }

      const mediaThumbnails = [];
      for (const t of xml.childrenNamed(node, "thumbnail")) {
        if (t.uri !== NS.MEDIA) continue;
        if (t.attrs.url) mediaThumbnails.push(t.attrs.url);
      }

      const images = mediaThumbnails.slice();
      const html = encoded || description || null;

      items.push(makeItem(sourceId, {
        guid: guid,
        link: link,
        title: title || "",
        snippet: item.snippet(html || "", 180),
        html: html,
        author: creator || null,
        published: item.parseDate(dd),
        updated: null,
        categories: categories,
        images: images,
        attachments: [],
        raw: node.raw,
      }));
    }

    return {
      format: FORMATS.RSS1,
      title: xml.text(channel, "title") || "",
      link: xml.text(channel, "link") || "",
      description: stripTags(xml.text(channel, "description") || ""),
      language: xml.text(channel, "language"),
      icon: xml.text(channel, "image") || null,
      items: items,
    };
  }

  /* ------------------------------------------------------------------------
   * JSON Feed 1.1
   *
   * "any item without an id must be discarded" (jsonfeed.org/version/1.1) and
   * a numeric id is coerced to a string. Everything is optional except
   * `version`, `title` and `items`.
   * ---------------------------------------------------------------------- */
  function parseJsonFeed(doc, sourceId) {
    let data;
    try {
      data = JSON.parse(doc);
    } catch (_e) {
      /* "If a feed is invalid JSON, then we strongly recommend not attempting
       * to parse it or use partial data." */
      return null;
    }
    if (!data || typeof data !== "object") return null;
    if (typeof data.version !== "string" || data.version.indexOf("jsonfeed") < 0) return null;
    if (!Array.isArray(data.items)) return null;

    const items = [];
    let discardedForNoId = 0;
    for (const node of data.items.slice(0, MAX_ITEMS)) {
      if (!node || typeof node !== "object") continue;
      const id = coerceId(node.id);
      if (!id) {
        discardedForNoId++;
        continue;
      }
      const html = typeof node.content_html === "string" ? node.content_html
        : (typeof node.content_text === "string" ? escapeHtml(node.content_text) : null);
      const summary = typeof node.summary === "string" ? node.summary : null;
      const author = firstAuthorName(node.authors) || firstAuthorName([node.author]);
      const attachments = Array.isArray(node.attachments)
        ? node.attachments
            .map(function (a) {
              if (!a || typeof a !== "object" || !a.url || !a.mime_type) return null;
              return item.normaliseAttachment(
                a.url, a.mime_type, a.size_in_bytes,
                { title: a.title || null, duration: toFinite(a.duration_in_seconds) }
              );
            })
            .filter(Boolean)
        : [];
      const images = [];
      if (typeof node.image === "string" && node.image) images.push(node.image);
      for (const a of attachments) if (a.kind === "image" && images.indexOf(a.url) < 0) images.push(a.url);

      const body = html || summary;
      items.push(makeItem(sourceId, {
        guid: id,
        link: typeof node.url === "string" && node.url ? node.url : null,
        title: typeof node.title === "string" ? node.title : "",
        snippet: item.snippet(summary || body || "", 180),
        html: body,
        author: author,
        published: item.parseDate(node.date_published),
        updated: item.parseDate(node.date_modified),
        categories: Array.isArray(node.tags) ? node.tags.filter(function (t) {
          return typeof t === "string";
        }) : [],
        images: images,
        attachments: attachments,
        raw: null,
      }));
    }

    const authors = firstAuthorName(data.authors);
    return {
      format: FORMATS.JSON,
      title: typeof data.title === "string" ? data.title : "",
      link: typeof data.home_page_url === "string" ? data.home_page_url : "",
      description: typeof data.description === "string" ? data.description : "",
      language: typeof data.language === "string" ? data.language : null,
      icon: typeof data.icon === "string" ? data.icon
        : (typeof data.favicon === "string" ? data.favicon : null),
      items: items,
      warnings: discardedForNoId > 0
        ? [discardedForNoId + " item(s) discarded: no id"]
        : [],
    };
  }

  function coerceId(value) {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && isFinite(value)) return String(value);
    return null;
  }

  function firstAuthorName(authors) {
    if (!Array.isArray(authors)) return null;
    for (const a of authors) {
      if (a && typeof a === "object" && typeof a.name === "string" && a.name.trim()) {
        return a.name.trim();
      }
      if (typeof a === "string" && a.trim()) return a.trim();
    }
    return null;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function toFinite(value) {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : null;
  }

  /* ------------------------------------------------------------------------
   * Entry point: detect by root element, never by content type.
   * ---------------------------------------------------------------------- */
  function parseFeed(text, sourceId) {
    const warnings = [];
    const body = String(text == null ? "" : text);
    const trimmed = body.replace(/^[\s\uFEFF]+/, "");
    const source = sourceId || "source";

    /* JSON: the parser itself verifies the version string, so only a leading
     * `{` routes there. */
    if (trimmed.charAt(0) === "{") {
      const feed = parseJsonFeed(trimmed, source);
      if (feed) return feed;
      /* An object that is not a JSON Feed falls through to XML, which will
       * also reject it; the caller sees the parse error. */
    }

    let doc;
    try {
      doc = xml.parseDocument(trimmed);
    } catch (_e) {
      throw new FeedError("not-xml", "The response could not be read as XML.");
    }
    if (!doc || !doc.name) {
      throw new FeedError("empty", "The response contained no feed elements.");
    }

    /* Detect by root element. A namespace URI, not a prefix, decides the
     * format, because the prefix is arbitrary. */
    /* A feed is an element in the Atom namespace named "feed", regardless of
     * the prefix it was written with. A feed with NO namespace and no prefix
     * is also accepted, because feeds in the wild omit it. */
    if (doc.name === "feed" && (doc.uri === NS.ATOM || doc.uri === null)) {
      const feed = parseAtom(doc, source);
      if (feed) return feed;
      throw new FeedError("not-a-feed", "An Atom document with no readable channel.");
    }
    if (doc.name === "RDF" && doc.uri === NS.RDF) {
      const feed = parseRss1(doc, source);
      if (feed) return feed;
      throw new FeedError("not-a-feed", "An RDF document with no readable channel.");
    }
    if (doc.name === "rss") {
      const version = String(doc.attrs.version || "");
      if (version === "1.0") {
        const feed = parseRss1(doc, source);
        if (feed) return feed;
        throw new FeedError("not-a-feed", "An RSS 1.0 document with no readable channel.");
      }
      const feed = parseRss2(doc, source);
      if (feed) return feed;
      throw new FeedError("not-a-feed", "An RSS document with no readable channel.");
    }
    /* Some feeds drop the version attribute but are plainly RSS 2.0. */
    if (xml.childrenNamed(doc, "channel").length > 0) {
      const feed = parseRss2(doc, source);
      if (feed) return feed;
    }
    /* A bare <html> document: the URL was not a feed. This is the common
     * failure and gets its own message, because the fix is a different URL. */
    if (doc.name === "html") {
      throw new FeedError("html-not-feed", "That looks like a web page, not a feed.");
    }
    throw new FeedError("unknown-format", "The root element is not a feed we read: <" +
      doc.name + ">.");
  }

  function FeedError(code, message) {
    const error = new Error(message);
    error.name = "FeedError";
    error.code = code;
    return error;
  }

  return {
    FORMATS: FORMATS,
    parseFeed: parseFeed,
    atomText: atomText,
    atomLink: atomLink,
    cleanEmail: cleanEmail,
    escapeHtml: escapeHtml,
  };
});
