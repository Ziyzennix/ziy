/* Ziy Playlist — the capture classifier.
 *
 * One question, answered as a decision rather than a boolean: is a piece of
 * information from a page something the panel can PLAY, and if so what kind
 * of thing is it?
 *
 *   direct     a URL a media element is expected to decode by extension or by
 *              declared type (mp4/webm/mp3/m4a/opus/…)
 *   manifest   an HLS playlist (.m3u8/.m3u): one item, the manifest URL, and
 *              the loader resolves the variants at play time
 *   page       a page URL: not directly playable. Kept so the queue can name
 *              where the media lives (DASH .mpd, a protected player, an
 *              embedded iframe) and the row opens it in a tab
 *   none       nothing worth adding
 *
 * The classifier is pure and shared by three callers, which is the whole
 * point of it being its own file:
 *
 *   1. the content script, deciding what a page's <video>/<audio> elements
 *      expose as their sources;
 *   2. the event page, deciding whether a URL arriving from an address-bar
 *      prompt or a message is playable;
 *   3. the tests, which pin every rule with the real fixture files.
 *
 * No DOM, no browser.*, no I/O. UMD export, the suite's convention.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    const model = typeof require === "function" ? require("./model.js") : root.ZiyPlaylistModel;
    module.exports = factory(model);
    return;
  }
  root.ZiyPlaylistClassify = factory(root.ZiyPlaylistModel);
})(typeof globalThis !== "undefined" ? globalThis : this, function (model) {
  "use strict";

  /* MIME types a media element can be handed directly. This is the engine's
     real capability, not a wish list: Gecko decodes the containers its own
     media stack supports (MDN, "Media types and formats for image, audio, and
     video content"), which for a Ziy build means the free and system-dependent
     codecs Gecko ships. Anything listed here is therefore a genuine
     "assign to src and press play" case. */
  const MEDIA_MIME = Object.freeze({
    "video/mp4": { type: "video", container: "mp4" },
    "video/webm": { type: "video", container: "webm" },
    "video/ogg": { type: "video", container: "ogg" },
    "video/quicktime": { type: "video", container: "mov" },
    "audio/mpeg": { type: "audio", container: "mp3" },
    "audio/mp4": { type: "audio", container: "m4a" },
    "audio/mp4; codecs=mp4a.40.2": { type: "audio", container: "m4a" },
    "audio/aac": { type: "audio", container: "aac" },
    "audio/aacp": { type: "audio", container: "aac" },
    "audio/ogg": { type: "audio", container: "ogg" },
    "audio/ogg; codecs=opus": { type: "audio", container: "opus" },
    "audio/ogg; codecs=vorbis": { type: "audio", container: "ogg" },
    "audio/webm": { type: "audio", container: "webm" },
    "audio/webm; codecs=opus": { type: "audio", container: "opus" },
    "audio/wav": { type: "audio", container: "wav" },
    "audio/wave": { type: "audio", container: "wav" },
    "audio/x-wav": { type: "audio", container: "wav" },
    "audio/flac": { type: "audio", container: "flac" },
    "audio/x-flac": { type: "audio", container: "flac" },
    "application/ogg": { type: "audio", container: "ogg" },
  });

  /* Streaming container types. An HLS manifest is a MEDIA item the loader
     resolves; a DASH manifest is a PAGE item, because this engine has no DASH
     pipeline and promising playback would be a fake control. */
  const STREAMING_MIME = Object.freeze({
    "application/x-mpegurl": { kind: "manifest", container: "m3u8", type: "video" },
    "application/vnd.apple.mpegurl": { kind: "manifest", container: "m3u8", type: "video" },
    "audio/x-mpegurl": { kind: "manifest", container: "m3u", type: "audio" },
    "application/dash+xml": { kind: "page", container: "mpd", type: "video" },
    "video/mp2t": { kind: "manifest", container: "ts", type: "video" },
  });

  const KIND_DIRECT = "direct";
  const KIND_MANIFEST = "manifest";
  const KIND_PAGE = "page";
  const KIND_NONE = "none";

  /** The last path segment of a URL, without the query or fragment. */
  function lastPathSegment(url) {
    const withoutQuery = String(url || "").split(/[?#]/)[0];
    const parts = withoutQuery.split("/");
    return parts[parts.length - 1] || "";
  }

  /** A lowercased file extension, or "" when there is none. The name is
      percent-decoded first, because a URL-escaped path segment is still a
      file name; what is NOT decoded is the query, which is not part of it. */
  function extensionOf(url) {
    const raw = lastPathSegment(url);
    if (raw === "") return "";
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch (_e) {
      /* A malformed escape is left as written: the segment still has a
         literal dot or it does not, and guessing never helps. */
      name = raw;
    }
    const dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) return "";
    return name.slice(dot + 1).toLowerCase();
  }

  /** Media query or fragment parameters some CDNs use to pass a type. */
  function declaredTypeFromQuery(url) {
    const match = /[?&](?:type|mime|content[_-]?type)=([^&]+)/i.exec(String(url || ""));
    return match ? decodeURIComponent(match[1]).toLowerCase() : "";
  }

  /**
   * The classification. `hints.mediaType` is what the content script read off
   * an element's `type` attribute or `crossOrigin` state; it is the element's
   * own claim and outranks the URL's extension when both exist.
   */
  function classifyUrl(url, hints) {
    const input = typeof url === "string" ? url.trim() : "";
    if (input === "") return { kind: KIND_NONE, reason: "empty" };
    if (!/^(https?|file|blob):/i.test(input)) {
      // A data: or moz-extension: URL is either tiny or not fetchable by name;
      // it is never a durable queue entry.
      return { kind: KIND_NONE, reason: "unsupported-scheme" };
    }

    const type = normalizeMime((hints && hints.mediaType) || declaredTypeFromQuery(input));

    // 1. The declared type, which is the strongest signal there is.
    if (type) {
      if (MEDIA_MIME[type]) {
        return { kind: KIND_DIRECT, container: MEDIA_MIME[type].container,
                 media: MEDIA_MIME[type].type, mime: type };
      }
      if (STREAMING_MIME[type]) {
        const s = STREAMING_MIME[type];
        return { kind: s.kind, container: s.container, media: s.type, mime: type };
      }
      // A declared type we do not decode (video/avi, audio/x-ms-wma, …) is a
      // page item rather than a direct item that would fail to play.
      if (/^video\//.test(type)) return { kind: KIND_PAGE, container: "", media: "video", mime: type };
      if (/^audio\//.test(type)) return { kind: KIND_PAGE, container: "", media: "audio", mime: type };
    }

    // 2. The extension, which is what a bare <video src> is read from.
    const ext = extensionOf(input);
    const table = model && model.MEDIA_EXTENSIONS ? model.MEDIA_EXTENSIONS : {};
    const manifestTable = model && model.MANIFEST_EXTENSIONS ? model.MANIFEST_EXTENSIONS : {};
    if (Object.prototype.hasOwnProperty.call(table, ext)) {
      const row = table[ext];
      return { kind: KIND_DIRECT, container: ext, media: row.type, mime: row.mime };
    }
    if (Object.prototype.hasOwnProperty.call(manifestTable, ext)) {
      const row = manifestTable[ext];
      return {
        kind: row.kind === "media" ? KIND_MANIFEST : KIND_PAGE,
        container: ext,
        media: row.type,
        mime: row.mime,
      };
    }

    // 3. No extension, no declared type: the URL names a page, not a file.
    //    Extensionless media URLs do exist behind CDN paths
    //    (/stream/1234?expires=…), but guessing one into a queue entry that
    //    cannot play is worse than treating it as a page.
    return { kind: KIND_PAGE, reason: "no-media-signal", container: "", media: "video", mime: "" };
  }

  function normalizeMime(value) {
    if (typeof value !== "string") return "";
    const cleaned = value.split(";")[0].trim().toLowerCase();
    if (cleaned === "") return "";
    // A media "type" attribute is sometimes a bare codec or a comment;
    // a slash is what makes it a MIME type.
    if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(cleaned)) return "";
    return cleaned;
  }

  /**
   * A URL the content script should offer as an item. True for files the
   * element can play and for manifests; false for pages and for blob: URLs
   * that only exist for this page session (a blob captured now cannot be
   * replayed tomorrow, so it must not become a durable queue row).
   */
  function isAddable(url, hints) {
    const result = classifyUrl(url, hints);
    return result.kind === KIND_DIRECT || result.kind === KIND_MANIFEST;
  }

  /**
   * Reads the playable sources off one element-ish object. `element` is the
   * shape the content script can put together (so this function stays pure):
   *   { src, currentSrc, sources: [{src, type}], blob, title, poster, duration }
   * and `documentTitle`/`documentUrl` come from the page.
   *
   * The candidates are ordered the way a player resolves them: currentSrc
   * first (what is actually playing), then src, then each <source> child.
   * Only the FIRST candidate that classifies as addable becomes the item —
   * adding a manifest and its four variants as five rows would be four rows
   * too many.
   */
  function candidatesFor(element) {
    const out = [];
    const el = element || {};
    const push = (url, type) => {
      const value = typeof url === "string" ? url.trim() : "";
      if (value === "") return;
      if (/^blob:/i.test(value)) return; // not durable
      if (out.some((row) => row.url === value)) return;
      out.push({ url: value, type: typeof type === "string" ? type : "" });
    };
    if (el.currentSrc) push(el.currentSrc, el.currentType || el.type);
    if (el.src) push(el.src, el.type);
    for (const child of el.sources || []) {
      if (child && typeof child.src === "string") push(child.src, child.type);
    }
    if (el.blob) push(el.blob, el.type);
    return out;
  }

  /**
   * The item a page element should contribute, or null. This is the single
   * place the "what goes in the queue" decision is made for element capture.
   */
  function itemFromElement(element, page) {
    const candidates = candidatesFor(element);
    for (const candidate of candidates) {
      const result = classifyUrl(candidate.url, { mediaType: candidate.type });
      if (result.kind !== KIND_DIRECT && result.kind !== KIND_MANIFEST) continue;
      const info = page || {};
      const video = result.media === "video";
      return {
        url: candidate.url,
        kind: result.kind === KIND_MANIFEST ? "manifest" : "media",
        type: video ? "video" : "audio",
        mime: result.mime || "",
        title: bestTitle(element, info),
        source: {
          title: typeof info.title === "string" ? info.title : "",
          url: typeof info.url === "string" ? info.url : "",
          host: typeof info.host === "string" ? info.host : "",
        },
        thumbnail: posterFor(element, info),
        duration: durationOf(element),
      };
    }
    return null;
  }

  /**
   * The title, in priority order: the element's own title/aria-label, the
   * page's og:title, the page's <title>, the file name, and last a generic
   * word. A queue row that says "blob:" tells the user nothing.
   */
  function bestTitle(element, page) {
    const own = (element && (element.title || element.label)) || "";
    const candidates = [
      own,
      page && page.ogTitle,
      page && page.schemaTitle,
      page && page.title,
      fileNameLabel(element),
    ];
    for (const candidate of candidates) {
      const text = typeof candidate === "string" ? candidate.replace(/\s+/g, " ").trim() : "";
      if (text !== "") return model.cleanTitle(text, "");
    }
    return "Untitled item";
  }

  function fileNameLabel(element) {
    const candidates = candidatesFor(element);
    for (const candidate of candidates) {
      const name = lastPathSegment(candidate.url);
      if (name === "") continue;
      // Media file names often carry a numeric id; keep the readable part.
      const cleaned = decodeURIComponent(name)
        .replace(/\.[a-z0-9]{1,5}$/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned !== "") return cleaned;
    }
    return "";
  }

  /** A poster: the element's own poster, else the page's og:image. */
  function posterFor(element, page) {
    const own = element && typeof element.poster === "string" ? element.poster.trim() : "";
    if (own !== "" && /^(https?|data:)/i.test(own)) return own;
    const og = page && typeof page.ogImage === "string" ? page.ogImage.trim() : "";
    if (og !== "" && /^(https?|data:)/i.test(og)) return og;
    const schema = page && Array.isArray(page.schemaImages) && page.schemaImages.length > 0
      ? String(page.schemaImages[0])
      : "";
    if (schema && /^(https?|data:)/i.test(schema)) return schema;
    return null;
  }

  function durationOf(element) {
    const value = Number(element && element.duration);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  return {
    KIND_DIRECT,
    KIND_MANIFEST,
    KIND_PAGE,
    KIND_NONE,
    MEDIA_MIME,
    STREAMING_MIME,
    extensionOf,
    lastPathSegment,
    normalizeMime,
    classifyUrl,
    isAddable,
    candidatesFor,
    itemFromElement,
    bestTitle,
    posterFor,
  };
});
