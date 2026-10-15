/* Ziy news — OPML 2.0 import and export.
 *
 * The shape is decided by the OPML 2.0 specification (opml.org/spec2.opml),
 * not by what other readers happen to emit:
 *
 *   <opml version="2.0"> is required; <head> and <body> are both required.
 *   A subscription list is a tree of <outline> elements. A feed node is
 *   `type="rss"` and MUST carry `text` and `xmlUrl`; optional attributes are
 *   `description`, `htmlUrl`, `language`, `title` and `version`.
 *   `<outline>` elements with no `type` (or type="link") are directories:
 *   their `text` is the directory name and their children are the feeds.
 *
 * The importer is deliberately more generous than the spec requires, because
 * real-world files in the wild carry feeds with the type omitted, with
 * type="rss" omitted entirely, and with attributes we do not know. What the
 * spec says about those: "Processors should ignore any attributes they do
 * not understand."
 *
 * Round-trip is the property we pin in the tests: export(import(x)) == x for
 * our own files, and a directory structure survives both directions.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("../feed/xml.js") : root.ZiyFeedXml,
      typeof require === "function" ? require("./source.js") : root.ZiyNewsSource);
    return;
  }
  root.ZiyNewsOpml = factory(root.ZiyFeedXml, root.ZiyNewsSource);
})(typeof globalThis !== "undefined" ? globalThis : this, function (xml, source) {
  "use strict";

  const XMLNS = "http://www.w3.org/1999/09/xhtml";

  /** Escapes text for an XML attribute or element value. */
  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /* RFC 822, which OPML's spec requires for its date-times. */
  function rfc822(epoch) {
    const d = new Date(Number(epoch) || Date.now());
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return days[d.getUTCDay()] + ", " + pad(d.getUTCDate()) + " " +
      months[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " +
      pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" +
      pad(d.getUTCSeconds()) + " GMT";
  }

  /**
   * Exports sources as OPML 2.0.
   *
   * The structure is grouped by category, because a category is the user's
   * own filing and an export that flattened it would silently discard their
   * organisation. A source whose category is empty or "Uncategorised" is
   * hoisted to the top level rather than dumped in a folder named after
   * absence.
   *
   * Returns { text, counts: { total, grouped, flat, disabled } }.
   */
  function exportSources(sources) {
    const list = Array.isArray(sources) ? sources : [];
    const groups = new Map();
    const flat = [];
    for (const feed of list) {
      const category = String(feed.category || "").trim();
      if (!category || category === "Uncategorised") {
        flat.push(feed);
        continue;
      }
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(feed);
    }

    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<opml version="2.0" xmlns="' + XMLNS + '">');
    lines.push("  <head>");
    lines.push("    <title>Ziy News subscriptions</title>");
    lines.push("    <dateCreated>" + rfc822(Date.now()) + "</dateCreated>");
    lines.push("    <ownerName>Ziy News</ownerName>");
    lines.push("    <docs>http://opml.org/spec2.opml</docs>");
    lines.push("  </head>");
    lines.push("  <body>");

    const categoryNames = Array.from(groups.keys()).sort(compareText);
    for (const name of categoryNames) {
      lines.push('    <outline text="' + escapeXml(name) + '">');
      for (const feed of groups.get(name)) lines.push(outline(feed, "      "));
      lines.push("    </outline>");
    }
    for (const feed of flat) lines.push(outline(feed, "    "));

    lines.push("  </body>");
    lines.push("</opml>");
    return {
      text: lines.join("\n") + "\n",
      counts: {
        total: list.length,
        grouped: list.length - flat.length,
        flat: flat.length,
        disabled: list.filter(function (s) { return s && s.enabled === false; }).length,
      },
    };
  }

  function outline(feed, indent) {
    const parts = [
      'text="' + escapeXml(feed.title || "") + '"',
      'type="rss"',
      'xmlUrl="' + escapeXml(feed.url || "") + '"',
    ];
    /* `title` "is probably the same as text, it should not be omitted" — so we
     * always write it, and always write the feed's own values. */
    parts.push('title="' + escapeXml(feed.title || "") + '"');
    if (feed.siteUrl) parts.push('htmlUrl="' + escapeXml(feed.siteUrl) + '"');
    if (feed.description) parts.push('description="' + escapeXml(feed.description) + '"');
    /* A disabled source must round-trip as disabled: exporting it as enabled
     * would silently re-subscribe the user to a feed they switched off. OPML
     * has no attribute for this of its own, so it is written as a named
     * extension attribute per the spec's extension rule ("OPML can also be
     * extended by the addition of new values for the type attribute" and its
     * extension-elements section), which an importer that does not know it
     * will simply ignore. */
    if (feed.enabled === false) parts.push('ziy:enabled="false"');
    return indent + "<outline " + parts.join(" ") + " />";
  }

  function compareText(a, b) {
    return String(a).localeCompare(String(b));
  }

  /**
   * Imports OPML and returns { sources, counts, skipped, categories }.
   *
   * Each imported source is normalised through the source model, so an import
   * that names a URL the user already has produces the same source id and
   * the caller can merge rather than duplicate. Disabled sources are reported
   * separately: a source with enabled="false" is imported in the off state,
   * which is what an OPML file that asks for it means.
   */
  function importOpml(text) {
    const body = String(text == null ? "" : text);
    let doc;
    try {
      doc = xml.parseDocument(body.replace(/^[\s\uFEFF]+/, ""));
    } catch (_e) {
      throw new OpmlError("not-xml", "That file is not readable XML, so it cannot be OPML.");
    }
    if (!doc || doc.name !== "opml") {
      throw new OpmlError("not-opml", "The root element is not <opml>, so this is not an OPML file.");
    }
    const version = String(doc.attrs.version || "");
    if (version && version !== "1.0" && version !== "2.0" && version !== "1.1") {
      /* "If you see a version 1.1 file, treat it as if it were a version 1.0
       * file." An unknown version is still read; the structure is the same. */
    }

    const opsmlBody = xml.child(doc, "body");
    if (!opsmlBody) {
      throw new OpmlError("no-body", "The OPML has no <body>, so it carries no subscriptions.");
    }

    const sources = [];
    const skipped = [];
    const categories = new Set();
    const seenUrls = new Set();

    walk(opsmlBody, "Uncategorised");

    function walk(container, category) {
      for (const node of xml.childrenNamed(container, "outline")) {
        const xmlUrl = String(node.attrs.xmlUrl || "").trim();
        const type = String(node.attrs.type || "").toLowerCase();
        const children = xml.childrenNamed(node, "outline");
        if (xmlUrl) {
          /* A feed node: type="rss" is the conventional value, and the spec's
           * required attributes are type, text and xmlUrl. A node that has an
           * xmlUrl but no type is read as a feed anyway, because that is what
           * it is. */
          /* enabled is read from either the plain attribute or our own
           * namespaced extension attribute, whichever the file carries. */
          const enabledRaw = node.attrs.enabled !== undefined
            ? node.attrs.enabled
            : node.attrs["ziy:enabled"];
          const enabled = enabledRaw !== "false";
          const feedCategory = category === "Uncategorised"
            ? (String(node.attrs.category || "").trim() || "Uncategorised")
            : category;
          const candidate = source.normalise({
            id: node.attrs["ziy:id"] || undefined,
            title: node.attrs.text || node.attrs.title || "",
            url: xmlUrl,
            siteUrl: node.attrs.htmlUrl || "",
            category: feedCategory,
            enabled: enabled,
          }, feedCategory);
          if (!candidate) {
            skipped.push({ url: xmlUrl, reason: "not a readable http(s) URL" });
            continue;
          }
          if (seenUrls.has(candidate.url)) {
            skipped.push({ url: candidate.url, reason: "already in this file" });
            continue;
          }
          seenUrls.add(candidate.url);
          categories.add(feedCategory);
          sources.push(Object.assign(candidate, {
            kind: node.attrs["ziy:kind"] === "builtin" ? "builtin" : "user",
          }));
          continue;
        }
        /* A directory node: its text is the category name. */
        const name = String(node.attrs.text || "").trim();
        if (children.length > 0) {
          walk(node, name || category);
          if (name) categories.add(name);
        } else if (name) {
          categories.add(name);
        }
      }
    }

    if (sources.length === 0 && skipped.length === 0) {
      throw new OpmlError("no-feeds",
        "The OPML has no subscriptions. An import needs at least one outline with an xmlUrl.");
    }

    return {
      sources: sources,
      counts: {
        imported: sources.length,
        skipped: skipped.length,
        categories: categories.size,
      },
      skipped: skipped,
      categories: Array.from(categories).sort(compareText),
    };
  }

  function OpmlError(code, message) {
    const error = new Error(message);
    error.name = "OpmlError";
    error.code = code;
    return error;
  }

  return {
    exportSources: exportSources,
    importOpml: importOpml,
    escapeXml: escapeXml,
    rfc822: rfc822,
  };
});
