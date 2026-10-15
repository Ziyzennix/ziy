/* Ziy news — a minimal XML reader.
 *
 * The four feed formats are XML or JSON. XML is handled here, deliberately
 * without a full DOM: extension pages must stay small, and the only XML we
 * ever read is feed markup that we do not control, which means it will be
 * malformed in ways a validating parser would reject and a reader must
 * survive. So this is a tolerant pull parser: it reads an element tree into
 * a plain-object form and skips what it cannot understand.
 *
 * Design rules, each one learned from the specifications rather than guessed:
 *
 *  - Element content is kept as text. Atom text constructs carry a `type`
 *    attribute (RFC 4287 §3.1: "text", "html", or a MIME type) and XHTML
 *    content is a `<div>` whose inner markup is serialised. Both need the
 *    RAW source of the element, not its decoded text, so the reader keeps the
 *    raw source slice when asked.
 *  - CDATA sections are literal (RSS Best Practices: entity-encoded HTML is
 *    allowed inside `<description>`); character references are decoded once.
 *  - Namespaces are resolved to their URI, never to the prefix, because the
 *    prefix is arbitrary (RFC 4287 §1.3: "the choice of namespace prefix is
 *    arbitrary and not semantically significant"). dc: and content: are
 *    therefore matched by URI.
 *  - Malformed XML must not throw. A feed we cannot read is a per-source
 *    error state, not a crash of the whole refresh.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyFeedXml = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Namespace URIs we actually act on. Anything else stays accessible by URI
   * but is only consulted where a format says to. */
  const NS = Object.freeze({
    ATOM: "http://www.w3.org/2005/Atom",
    RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    RSS1: "http://purl.org/rss/1.0/",
    DC: "http://purl.org/dc/elements/1.1/",
    CONTENT: "http://purl.org/rss/1.0/modules/content/",
    MEDIA: "http://search.yahoo.com/mrss/",
    XHTML: "http://www.w3.org/1999/xhtml",
    ITUNES: "http://www.itunes.com/dtds/podcast-1.0.dtd",
  });

  const WELL_KNOWN = Object.freeze({
    /* Real-world feeds use the conventional prefixes, and an undeclared
     * prefix (a broken feed) must still resolve, so both forms are mapped. */
    atom: NS.ATOM,
    rss: "http://purl.org/rss/1.0/",
    rdf: NS.RDF,
    dc: NS.DC,
    content: NS.CONTENT,
    media: NS.MEDIA,
    itunes: NS.ITUNES,
    xhtml: NS.XHTML,
  });

  /* ------------------------------------------------------------------------
   * Character references.
   *
   * XML predefines exactly five. A feed that emits &#xNN; is allowed one for
   * arbitrary code points, and a numeric reference to a character that XML
   * forbids in a document is an illegal character that a reader must skip
   * rather than substitute.
   * ---------------------------------------------------------------------- */
  const PREDEFINED = Object.freeze({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  });

  function decodeEntities(text) {
    if (text.indexOf("&") < 0) return text;
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (all, body) {
      if (body.charAt(0) === "#") {
        let code;
        if (body.charAt(1) === "x" || body.charAt(1) === "X") {
          code = parseInt(body.slice(2), 16);
        } else {
          code = parseInt(body.slice(1), 10);
        }
        if (!isFinite(code) || code <= 0 || code > 0x10ffff) return "";
        /* XML 1.0 forbids surrogates and the control range except tab, LF,
         * CR. A feed that emits one is broken; drop the reference. */
        if (code >= 0xd800 && code <= 0xdfff) return "";
        if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return "";
        try {
          return String.fromCodePoint(code);
        } catch (_e) {
          return "";
        }
      }
      if (Object.prototype.hasOwnProperty.call(PREDEFINED, body)) return PREDEFINED[body];
      /* An unknown named entity: XML without a DTD forbids them, so the
       * reference is malformed. Keeping the raw text lets a caller see it. */
      return all;
    });
  }

  /* ------------------------------------------------------------------------
   * The tokenizer + tree reader.
   * ---------------------------------------------------------------------- */

  /**
   * Reads a document into a tree of plain elements:
   *   { name, uri, attrs, text, raw, children, [xhtml] }
   * `raw` is the element's own source slice. `xhtml` holds serialised inner
   * markup for an XHTML element (Atom's type="xhtml", RFC 4287 §3.1).
   */
  function parseDocument(xml) {
    const str = String(xml == null ? "" : xml);
    const root = { name: null, uri: null, attrs: {}, text: "", raw: "", children: [] };
    let i = 0;
    /* Namespace stack: prefixes can be redefined in any scope. */
    const nsStack = [{}];

    function resolvePrefix(prefix) {
      for (let s = nsStack.length - 1; s >= 0; s--) {
        const table = nsStack[s];
        if (Object.prototype.hasOwnProperty.call(table, prefix)) return table[prefix];
      }
      return undefined;
    }

    function splitName(qualified) {
      const colon = qualified.indexOf(":");
      if (colon < 0) return { prefix: "", local: qualified };
      return { prefix: qualified.slice(0, colon), local: qualified.slice(colon + 1) };
    }

    function uriOf(qualified) {
      const parts = splitName(qualified);
      if (!parts.prefix) return null;
      return resolvePrefix(parts.prefix);
    }

    function makeElement(qualified, startIndex, declaredNow) {
      const parts = splitName(qualified);
      let uri = null;
      if (parts.prefix) {
        uri = resolvePrefix(parts.prefix);
        if (uri === undefined) uri = WELL_KNOWN[parts.prefix] || null;
      } else {
        /* An unprefixed element is in the DEFAULT namespace, which is set by
         * xmlns="..." on the element itself or on an ancestor. Atom and RSS
         * 1.0 both ship that way, and the element's own default declaration
         * must win over an ancestor's. */
        if (declaredNow && Object.prototype.hasOwnProperty.call(declaredNow, "")) {
          uri = declaredNow[""];
        } else {
          const inherited = resolvePrefix("");
          uri = inherited === undefined ? null : inherited;
        }
      }
      return {
        name: parts.local,
        qualified: qualified,
        prefix: parts.prefix,
        uri: uri,
        attrs: {},
        text: "",
        raw: "",
        children: [],
        start: startIndex,
      };
    }

    function readAttrs(from, limit) {
      /* Attributes may span whitespace and quotes. Reads them into the closed
       * over `attrs` object of this call. */
      let j = from;
      const attrs = {};
      while (j < limit) {
        while (j < limit && isSpace(str.charCodeAt(j))) j++;
        if (j >= limit) break;
        if (str.startsWith("/>", j)) return attrs;
        if (str.charAt(j) === ">") return attrs;
        const eq = str.indexOf("=", j);
        if (eq < 0 || eq > limit) {
          /* A bare attribute name: not legal XML, but some feeds emit them. */
          const name = readName(j, limit);
          if (!name) return attrs;
          attrs[name] = "";
          j += name.length;
          continue;
        }
        const name = readName(j, Math.min(eq, limit));
        if (!name) return attrs;
        let k = eq + 1;
        while (k < limit && isSpace(str.charCodeAt(k))) k++;
        const quote = str.charAt(k);
        if (quote !== '"' && quote !== "'") {
          /* Unquoted value: take up to whitespace or the tag end. */
          let end = k;
          while (end < limit && !isSpace(str.charCodeAt(end)) && str.charAt(end) !== ">" &&
                 !str.startsWith("/>", end)) end++;
          attrs[name] = decodeEntities(str.slice(k, end));
          j = end;
          continue;
        }
        const close = str.indexOf(quote, k + 1);
        if (close < 0 || close > limit) return attrs;
        attrs[name] = decodeEntities(str.slice(k + 1, close));
        j = close + 1;
      }
      return attrs;
    }

    function readName(from, limit) {
      const match = /^[^\s/>=<]+/.exec(str.slice(from, Math.min(limit, from + 512)));
      return match ? match[0] : "";
    }

    /* A stack of open elements: { el, childIndexAtOpen }. */
    const stack = [];
    let current = root;
    let pendingText = "";

    function flushText() {
      if (!pendingText) return;
      const trimmed = collapseWhitespace(pendingText);
      if (trimmed) current.text += decodeEntities(pendingText);
      pendingText = "";
    }

    while (i < str.length) {
      const lt = str.indexOf("<", i);
      if (lt < 0) break;
      if (lt > i) {
        const chunk = str.slice(i, lt);
        /* Character data inside an element. Keep it verbatim apart from
         * entity decoding, which `flushText` does when the text is used. */
        pendingText += chunk;
        i = lt;
      }
      if (str.startsWith("<!--", i)) {
        const end = str.indexOf("-->", i + 4);
        i = end < 0 ? str.length : end + 3;
        continue;
      }
      if (str.startsWith("<![CDATA[", i)) {
        const end = str.indexOf("]]>", i + 9);
        const chunk = str.slice(i + 9, end < 0 ? str.length : end);
        pendingText += chunk;
        i = end < 0 ? str.length : end + 3;
        continue;
      }
      if (str.startsWith("<?", i)) {
        const end = str.indexOf("?>", i + 2);
        i = end < 0 ? str.length : end + 2;
        continue;
      }
      if (str.startsWith("<!", i)) {
        /* DOCTYPE or a malformed declaration. Some feeds carry an internal
         * subset with brackets, which must not be treated as content. */
        const end = str.indexOf(">", i + 2);
        let j = i + 2;
        if (j < str.length && str.startsWith("DOCTYPE", j)) {
          /* Skip to the matching bracket that closes the internal subset. */
          let depth = 0;
          let k = str.indexOf("[", j);
          if (k >= 0 && k < (end < 0 ? str.length : end)) {
            depth = 1;
            k++;
            while (k < str.length && depth > 0) {
              const c = str.charAt(k);
              if (c === "[") depth++;
              else if (c === "]") depth--;
              k++;
            }
            const tail = str.indexOf(">", k);
            i = tail < 0 ? str.length : tail + 1;
          } else {
            i = end < 0 ? str.length : end + 1;
          }
        } else {
          i = end < 0 ? str.length : end + 1;
        }
        continue;
      }
      if (str.startsWith("</", i)) {
        const end = str.indexOf(">", i + 2);
        const qualified = str.slice(i + 2, end < 0 ? str.length : end).trim();
        flushText();
        if (stack.length > 0) {
          const open = stack.pop();
          open.el.raw = str.slice(open.el.start, end < 0 ? str.length : end + 1);
          nsStack.pop();
          current = stack.length > 0 ? stack[stack.length - 1].el : root;
        }
        /* A stray end tag is ignored rather than fatal. */
        i = end < 0 ? str.length : end + 1;
        continue;
      }
      /* Start tag. */
      const gt = findTagEnd(str, i);
      if (gt < 0) break;
      const tagText = str.slice(i + 1, gt + 1);
      if (tagText.startsWith("/")) {
        i = gt + 1;
        continue;
      }
      const nameMatch = /^([^\s/>]+)/.exec(tagText);
      if (!nameMatch) {
        i = gt + 1;
        continue;
      }
      const qualified = nameMatch[1];
      const attrs = readAttrs(i + 1 + qualified.length, gt);
      const selfClosing = str.startsWith("/>", gt - 1) || str.startsWith("/>", gt - 2);

      /* Namespaces declared on this element live in scope beneath it, so they
       * are collected BEFORE the element is named. */
      const declared = {};
      for (const key of Object.keys(attrs && typeof attrs === "object" ? attrs : {})) {
        if (key === "xmlns") declared[""] = attrs[key];
        else if (key.startsWith("xmlns:")) declared[key.slice(6)] = attrs[key];
      }
      const el = makeElement(qualified, i, declared);
      el.attrs = attrs && typeof attrs === "object" ? attrs : {};

      nsStack.push(declared);
      stack.push({ el: el });

      /* `<xhtml:div>` (or an unprefixed div in an XHTML-scoped document) is
       * Atom's XHTML content: the INNER markup is the value. */
      const isXhtml = el.uri === NS.XHTML ||
        (el.uri === null && el.name === "div");

      if (!isXhtml && (el.uri === NS.ATOM || el.uri === null) && qualified !== "div") {
        /* normal element: record it under the parent and descend */
      }

      if (!isXhtml && el.uri !== NS.XHTML) {
        flushText();
        current.children.push(el);
      }

      if (selfClosing) {
        stack.pop();
        nsStack.pop();
        el.raw = str.slice(i, gt + 1);
        if (isXhtml) el.text = "";
      } else if (isXhtml) {
        /* Capture the whole inner span verbatim; attributes are on the div. */
        const closeIndex = findMatchingClose(str, i);
        el.raw = str.slice(i, closeIndex < 0 ? str.length : closeIndex + 1);
        el.xhtml = decodeEntities(stripOuterTags(str.slice(gt + 1, closeIndex < 0 ? str.length : closeIndex)));
        el.text = el.xhtml;
        /* Skip past it so its children are not double-read as RSS items. */
        i = closeIndex < 0 ? str.length : findAfterTag(str, closeIndex);
        stack.pop();
        nsStack.pop();
        current.children.push(el);
        continue;
      } else {
        current = el;
      }
      i = gt + 1;
    }

    /* Anything left open is closed implicitly, which is what a tolerant
     * reader does with a truncated feed. */
    while (stack.length > 0) {
      const open = stack.pop();
      open.el.raw = str.slice(open.el.start);
      nsStack.pop();
    }

    return root.children.length > 0 ? root.children[0] : root;
  }

  function isSpace(code) {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  }

  function findTagEnd(str, from) {
    /* The `>` that ends this tag, ignoring `>` inside a quoted value. */
    let i = from + 1;
    let quote = "";
    while (i < str.length) {
      const c = str.charAt(i);
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        return i;
      }
      i++;
    }
    return -1;
  }

  function findMatchingClose(str, from) {
    /* Index of the `</tagName>` that closes the element starting at `from`,
     * skipping nested elements of the same name. */
    const nameMatch = /^<([^\s/>]+)/.exec(str.slice(from, from + 256));
    const qualified = nameMatch ? nameMatch[1] : "";
    let i = findTagEnd(str, from);
    if (i < 0) return -1;
    let depth = 1;
    while (i < str.length) {
      const next = str.indexOf("<", i);
      if (next < 0) return -1;
      if (str.startsWith("</" + qualified + ">", next) && depth === 1) return next;
      if (str.startsWith("</" + qualified, next)) depth--;
      else if (str.startsWith("<" + qualified, next)) {
        /* Count the matching open, but not a self-closing one. */
        const end = findTagEnd(str, next);
        if (end > 0 && str.charAt(end - 1) === "/") {
          /* self-closing */
        } else if (end > 0) {
          depth++;
        }
      }
      i = next + 1;
    }
    return -1;
  }

  function findAfterTag(str, tagStart) {
    const end = findTagEnd(str, tagStart);
    return end < 0 ? str.length : end + 1;
  }

  function stripOuterTags(inner) {
    return inner.replace(/^\s*<!--/, "").replace(/\s*-->\s*$/, "");
  }

  function collapseWhitespace(text) {
    return text.replace(/^\s+|\s+$/g, "");
  }

  /* ------------------------------------------------------------------------
   * Reader helpers shared by the four format parsers.
   * ---------------------------------------------------------------------- */

  /** First direct child with the given local name (any namespace). */
  function child(el, name) {
    if (!el || !el.children) return null;
    for (const c of el.children) if (c.name === name) return c;
    return null;
  }

  /** First direct child with the given local name AND namespace URI. */
  function childNS(el, uri, name) {
    if (!el || !el.children) return null;
    for (const c of el.children) {
      if (c.name === name && (c.uri === uri || name === c.name && c.uri === uri)) return c;
    }
    return null;
  }

  function childrenNamed(el, name) {
    const out = [];
    if (!el || !el.children) return out;
    for (const c of el.children) if (c.name === name) out.push(c);
    return out;
  }

  /** Text of a direct child by local name, decoded. */
  function text(el, name) {
    const c = child(el, name);
    return c ? decodeEntities(c.text) : null;
  }

  function textNS(el, uri, name) {
    const c = childNS(el, uri, name);
    return c ? decodeEntities(c.text) : null;
  }

  /** Raw inner source of a direct child by local name (for HTML payloads). */
  function rawChild(el, name) {
    const c = child(el, name);
    if (!c) return null;
    return decodeEntities(c.text);
  }

  function childWithAttr(el, name, attr, value) {
    if (!el || !el.children) return null;
    for (const c of el.children) {
      if (c.name === name && String(c.attrs[attr]) === value) return c;
    }
    return null;
  }

  return {
    NS: NS,
    parseDocument: parseDocument,
    decodeEntities: decodeEntities,
    child: child,
    childNS: childNS,
    childrenNamed: childrenNamed,
    childWithAttr: childWithAttr,
    text: text,
    textNS: textNS,
    rawChild: rawChild,
    collapseWhitespace: collapseWhitespace,
  };
});
