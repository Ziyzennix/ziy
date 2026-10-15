/* Ziy Playlist — the queue model.
 *
 * Pure functions over one shape: the item list. No DOM, no browser.*, no I/O,
 * so the same code runs in the panel, in the event page and under `node --test`.
 * UMD-style export, the convention every lib/ file in this suite follows
 * (see extensions/ziy-talk/lib/settings.js).
 *
 * WHAT AN ITEM IS
 *   id          a stable key, from makeId(). The panel and the store both key on it.
 *   url         the playable URL, or the page URL for a 'page' item.
 *   kind        'media'  a URL a media element can play (direct file, HLS manifest)
 *               'page'   a page URL: not directly playable, opens in a tab
 *   type        'video' | 'audio'  — what the row looks like and what the panel plays
 *   mime        the best guess at the content type ('video/mp4', 'application/x-mpegURL'…)
 *   title       the label, cleaned to a display string
 *   source      the site it came from ({ title, url, host }) for the row's subtitle
 *   thumbnail   a poster image URL when the page offered one, else null
 *   duration    seconds, a number, 0 when unknown — never NaN
 *   addedAt     epoch ms
 *   order       position in the queue; reorder rewrites these, so it is stored
 *   position    the resume point, seconds, 0 when never played
 *   lastPlayedAt epoch ms or 0
 *
 * THE STATE IS AN ARRAY, ORDERED. `order` is a derived convenience for rows
 * that need a stable index across reloads; the array itself is the truth, and
 * every mutation returns a NEW array (no in-place splicing by callers), so a
 * caller that forgets to save simply does not persist rather than corrupting
 * the queue.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZiyPlaylistModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;

  const KINDS = Object.freeze({
    media: "media",
    page: "page",
  });

  const TYPES = Object.freeze({
    video: "video",
    audio: "audio",
  });

  /* The direct-file extensions a media element is expected to decode. A URL
     ending in one of these is a media URL without asking the network. */
  const MEDIA_EXTENSIONS = Object.freeze({
    // video
    mp4: { kind: "media", type: "video", mime: "video/mp4" },
    m4v: { kind: "media", type: "video", mime: "video/mp4" },
    webm: { kind: "media", type: "video", mime: "video/webm" },
    ogv: { kind: "media", type: "video", mime: "video/ogg" },
    mov: { kind: "media", type: "video", mime: "video/quicktime" },
    mkv: { kind: "media", type: "video", mime: "video/x-matroska" },
    // audio
    mp3: { kind: "media", type: "audio", mime: "audio/mpeg" },
    m4a: { kind: "media", type: "audio", mime: "audio/mp4" },
    aac: { kind: "media", type: "audio", mime: "audio/aac" },
    opus: { kind: "media", type: "audio", mime: "audio/ogg; codecs=opus" },
    ogg: { kind: "media", type: "audio", mime: "audio/ogg" },
    oga: { kind: "media", type: "audio", mime: "audio/ogg" },
    weba: { kind: "media", type: "audio", mime: "audio/webm" },
    wav: { kind: "media", type: "audio", mime: "audio/wav" },
    flac: { kind: "media", type: "audio", mime: "audio/flac" },
  });

  /* Playlist manifests. A .m3u8 is HLS: the URL stays ONE item and the player
     resolves the variants. .mpd is DASH, which this engine cannot play (see
     the documented limitation in the panel), so a .mpd is kept as a page-style
     item rather than promised as playable. */
  const MANIFEST_EXTENSIONS = Object.freeze({
    m3u8: { kind: "media", type: "video", mime: "application/x-mpegURL" },
    m3u: { kind: "media", type: "audio", mime: "application/x-mpegURL" },
    mpd: { kind: "page", type: "video", mime: "application/dash+xml" },
  });

  const MAX_ITEMS = 500;

  /** A short, collision-resistant id. Not random: derived from the inputs. */
  let counter = 0;
  function makeId(url, now) {
    counter += 1;
    const stamp = Number.isFinite(now) ? now : 0;
    let hash = 0x811c9dc5;
    const text = String(url) + "|" + stamp + "|" + counter;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return "it_" + hash.toString(36) + "_" + counter.toString(36);
  }

  /* ------------------------------------------------------------------ */
  /* Normalisation                                                      */
  /* ------------------------------------------------------------------ */

  /** A display string: trimmed, collapsed, capped, never undefined. */
  function cleanTitle(value, fallback) {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (text === "") return fallback || "Untitled item";
    return text.length > 200 ? text.slice(0, 197) + "…" : text;
  }

  /** A finite non-negative number, or the fallback. Never NaN. */
  function seconds(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback || 0;
    // Sub-second precision is meaningless in a resume point and doubles the
    // chance of a spurious "changed" write.
    return Math.round(n * 10) / 10;
  }

  function hostOf(url) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || ""));
    return match ? match[1].toLowerCase() : "";
  }

  /**
   * The full item normaliser: every field is coerced to its shape, unknown
   * fields are dropped, and a missing url collapses the item to null (an item
   * with no address plays nothing). Used by the store on load and by every
   * mutation on the way in, so validation is not per-caller.
   */
  function normaliseItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    if (url === "" || !/^(https?|file|blob):/i.test(url)) return null;
    const kind = raw.kind === KINDS.page ? KINDS.page : KINDS.media;
    const type = raw.type === TYPES.video ? TYPES.video : TYPES.audio;
    const source = raw.source && typeof raw.source === "object" ? raw.source : null;
    const now = Number.isFinite(raw.addedAt) ? raw.addedAt : 0;
    const item = {
      id: typeof raw.id === "string" && raw.id !== "" ? raw.id : makeId(url, now),
      url: url,
      kind: kind,
      type: type,
      mime: typeof raw.mime === "string" && raw.mime !== "" ? raw.mime : "",
      title: cleanTitle(raw.title, ""),
      source: source
        ? {
            title: typeof source.title === "string" ? source.title : "",
            url: typeof source.url === "string" ? source.url : "",
            host: typeof source.host === "string" ? source.host : hostOf(source.url || url),
          }
        : null,
      thumbnail: typeof raw.thumbnail === "string" && /^(https?|data|blob):/i.test(raw.thumbnail)
        ? raw.thumbnail
        : null,
      duration: seconds(raw.duration, 0),
      addedAt: now,
      order: Number.isFinite(raw.order) ? Math.max(0, Math.floor(raw.order)) : 0,
      position: seconds(raw.position, 0),
      lastPlayedAt: Number.isFinite(raw.lastPlayedAt) ? raw.lastPlayedAt : 0,
    };
    // A media item with a position past its own duration is a corrupt record:
    // resuming into it would fail to seek, so the position is dropped.
    if (item.duration > 0 && item.position >= item.duration) item.position = 0;
    return item;
  }

  /**
   * The queue: a normalised, ordered array. De-duplicated by url (the simplest
   * identity that survives a reload), capped, with `order` rewritten so the
   * stored indices always match the array positions.
   */
  function normaliseQueue(stored) {
    if (!Array.isArray(stored)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of stored) {
      const item = normaliseItem(raw);
      if (!item) continue;
      // A duplicate url is the same media reached twice; the first entry wins,
      // and re-adding is a "play it now" rather than a second row.
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      out.push(item);
      if (out.length >= MAX_ITEMS) break;
    }
    return reindex(out);
  }

  function reindex(list) {
    return list.map((item, index) => Object.assign({}, item, { order: index }));
  }

  function emptyQueue() {
    return [];
  }

  /* ------------------------------------------------------------------ */
  /* Mutations — each returns a new array, never mutates                 */
  /* ------------------------------------------------------------------ */

  /**
   * Adds an item at the end (default) or the front. A duplicate url MOVES the
   * existing row rather than adding a second one, and keeps the position
   * already remembered for it: re-adding a half-watched video is "play it
   * again", not "watch it from the start twice".
   */
  function add(list, raw, options) {
    const opts = options || {};
    const current = normaliseQueue(list);
    const item = normaliseItem(raw);
    if (!item) return current;
    const existingIndex = current.findIndex((row) => row.url === item.url);
    if (existingIndex >= 0) {
      const existing = current[existingIndex];
      const moved = Object.assign({}, existing, {
        title: item.title || existing.title,
        source: item.source || existing.source,
        thumbnail: item.thumbnail || existing.thumbnail,
        duration: item.duration || existing.duration,
        mime: item.mime || existing.mime,
      });
      const rest = current.filter((_, i) => i !== existingIndex);
      const next = opts.at === "front" ? [moved, ...rest] : [...rest, moved];
      return reindex(next);
    }
    const next = opts.at === "front" ? [item, ...current] : [...current, item];
    return reindex(next).slice(0, MAX_ITEMS);
  }

  function remove(list, id) {
    const current = normaliseQueue(list);
    if (!id) return current;
    return reindex(current.filter((item) => item.id !== id));
  }

  /** Removes every item. "Reset playlist" in settings is exactly this. */
  function clear(list) {
    void list;
    return emptyQueue();
  }

  /**
   * Reorder by moving one item from `from` to `to`. Both are indices into the
   * CURRENT array, which is what the panel's keyboard and drag handlers both
   * produce. An out-of-range index is clamped, not rejected, so a stale
   * keypress can never throw mid-interaction.
   */
  function move(list, from, to) {
    const current = normaliseQueue(list);
    if (current.length < 2) return current;
    const a = clampIndex(from, current.length);
    const b = clampIndex(to, current.length);
    if (a === b) return reindex(current);
    const copy = current.slice();
    const [item] = copy.splice(a, 1);
    copy.splice(b, 0, item);
    return reindex(copy);
  }

  function clampIndex(value, length) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > length - 1) return length - 1;
    return n;
  }

  /** The item with this id, or null. */
  function find(list, id) {
    for (const item of normaliseQueue(list)) {
      if (item.id === id) return item;
    }
    return null;
  }

  function indexOfId(list, id) {
    const current = normaliseQueue(list);
    for (let i = 0; i < current.length; i += 1) {
      if (current[i].id === id) return i;
    }
    return -1;
  }

  /**
   * Moves one item before/after another by id — the shape the panel's
   * drag-and-drop produces ("dropped X onto Y").
   */
  function moveBefore(list, id, targetId) {
    const current = normaliseQueue(list);
    const from = indexOfId(current, id);
    const to = indexOfId(current, targetId);
    if (from < 0 || to < 0 || from === to) return current;
    // "Before" means the moved row lands where the target was.
    return move(current, from, to);
  }

  /* ------------------------------------------------------------------ */
  /* Playback position                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Writes the resume point for one item. A position is never written for a
   * 'page' item (it has no timeline), and a position at the very end is
   * treated as finished: 0, so the next open starts from the beginning.
   */
  function setPosition(list, id, position) {
    const current = normaliseQueue(list);
    const value = seconds(position, 0);
    return current.map((item) => {
      if (item.id !== id) return item;
      if (item.kind === KINDS.page) return item;
      if (item.duration > 0 && value >= item.duration) {
        return Object.assign({}, item, { position: 0, lastPlayedAt: item.lastPlayedAt });
      }
      return Object.assign({}, item, { position: value });
    });
  }

  function markPlayed(list, id, now) {
    const stamp = Number.isFinite(now) ? now : 0;
    return normaliseQueue(list).map((item) =>
      item.id === id ? Object.assign({}, item, { lastPlayedAt: stamp }) : item
    );
  }

  /** Records a duration learned after metadata loaded. */
  function setDuration(list, id, duration) {
    const value = seconds(duration, 0);
    return normaliseQueue(list).map((item) =>
      item.id === id ? Object.assign({}, item, { duration: value }) : item
    );
  }

  /* ------------------------------------------------------------------ */
  /* Ordering helpers for the panel                                     */
  /* ------------------------------------------------------------------ */

  /** Newest last-watched first — the panel's "recently played" grouping. */
  function sortByRecent(list) {
    return normaliseQueue(list).slice().sort((a, b) => {
      if (b.lastPlayedAt !== a.lastPlayedAt) return b.lastPlayedAt - a.lastPlayedAt;
      return b.addedAt - a.addedAt;
    });
  }

  /** The next item after `id`, wrapping, ignoring 'page' items. */
  function nextPlayable(list, id) {
    const current = normaliseQueue(list);
    const playable = current.filter((item) => item.kind === KINDS.media);
    if (playable.length === 0) return null;
    const at = current.findIndex((item) => item.id === id);
    if (at < 0) return playable[0];
    for (let i = at + 1; i < current.length; i += 1) {
      if (current[i].kind === KINDS.media) return current[i];
    }
    return playable[0];
  }

  function count(list) {
    return normaliseQueue(list).length;
  }

  return {
    SCHEMA_VERSION,
    KINDS,
    TYPES,
    MEDIA_EXTENSIONS,
    MANIFEST_EXTENSIONS,
    MAX_ITEMS,
    makeId,
    cleanTitle,
    seconds,
    hostOf,
    normaliseItem,
    normaliseQueue,
    reindex,
    emptyQueue,
    add,
    remove,
    clear,
    move,
    moveBefore,
    find,
    indexOfId,
    setPosition,
    markPlayed,
    setDuration,
    sortByRecent,
    nextPlayable,
    count,
  };
});
