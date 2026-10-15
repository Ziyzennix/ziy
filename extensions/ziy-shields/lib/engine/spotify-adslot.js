/* Ziy shields — the Spotify ad-slot handler.
 *
 * The problem this module exists to solve, stated exactly as it was reported:
 *
 *   "uBlock blocks Spotify ads but then the SONG WON'T PLAY (or skips forever
 *    instead of playing)."
 *
 * WHY THE NAIVE BLOCK BREAKS PLAYBACK. The Spotify Web Player does not splice
 * ad and song into one stream. The player is a state machine with an AD SLOT:
 * it navigates a media element to an ad URL served from Spotify's ad-delivery
 * hosts (the `audio-fa.spotifycdn.com` / `audio-sp-*.spotifycdn.com` family,
 * plus the adserver endpoints the player calls to fill the slot), the slot ends
 * on that element's `ended`/timeout event, and only then does the player
 * navigate the element to the real song on `p.scdn.co`. A hard network block of
 * the ad URL means the media element never loads anything, so its `ended`
 * event never fires, so the slot never ends, so the player sits in the ad slot
 * forever — "the song won't play". Skipping in a loop is the same machine
 * observed from the other side: the player re-enters the ad slot, the ad
 * request is blocked again, and it never escapes.
 *
 * THE MECHANISM THIS MODULE IMPLEMENTS. Let the SLOT happen and let the AUDIO
 * be silent:
 *
 *   1. the network tier does NOT block the ad-delivery media request — it
 *      returns "allow", so the element loads and the slot's timeline runs to
 *      its normal end;
 *   2. the content script mutes the media element while the slot is active, so
 *      no ad audio is heard;
 *   3. when the slot ends, the same code that mutes unmutes, so the song that
 *      follows plays at full volume.
 *
 * Result: the ad is silent (nobody hears it), the slot ends normally (the
 * player advances), and the song plays. That is the whole delta between this
 * and the naive block, and it is the co-owner's stated requirement.
 *
 * WHAT IS A LIST DELTA AND WHAT IS CODE. The ad-delivery HOSTS are carried by
 * the list tier (see SPOTIFY_AD_HOSTS below): they are marked so the network
 * layer can recognise "this is an ad slot" without needing to know Spotify's
 * current host names in advance. The host list is the only Spotify-specific
 * data here, it is small, it is Ziy-authored, and it is fetched with the same
 * checksum discipline as the public lists (lib/filterlist/lists.js). Everything
 * behavioural — the mute, the slot state, the restore — is in this module and
 * in content/spotify-adslot.js.
 *
 * SCOPE, stated plainly: this applies to the SPOTIFY WEB PLAYER only
 * (open.spotify.com / spotify.com), never the desktop client, which does not
 * go through a web extension at all. Whether circumventing ads in the web
 * player is acceptable is the product owner's decision; this module is the
 * technical mechanism and is default ON and per-site toggleable in the Shields
 * panel, exactly like every other row (architecture §5.3). Spotify's Terms
 * restrict circumventing ads — noted, and noted as the user-controlled feature
 * it is, because that is what it is.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * Loaded as a classic <script> in the shared global scope of the event page,
 * next to the other ziy-shields lib files. Nothing is declared at the top
 * level here (defect D-2: a second top-level `const` in the shared scope is a
 * parse-time SyntaxError that discards the whole file). The API goes on the
 * shared `ziyShields` namespace and on module.exports for the unit tests.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  if (!root.ziyShields) root.ziyShields = {};
  const api = factory();
  Object.assign(root.ziyShields, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.SPOTIFY_HOSTS = api.SPOTIFY_HOSTS;
    exports.isAdHost = api.isAdHost;
    exports.isSongHost = api.isSongHost;
    exports.hostKind = api.hostKind;
    exports.createSlotTracker = api.createSlotTracker;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

/* The hosts the Spotify ad slot uses. Two groups, and the distinction is the
 * whole mechanism:
 *
 *   AD hosts    — the ad-delivery/CDN family an ad slot's audio comes from.
 *                 Recognising these is what lets the network tier let the
 *                 request through (so the slot ends) while the content script
 *                 mutes it (so no ad is heard).
 *   SONG hosts  — the normal music CDN. Never muted, never blocked.
 *
 * The ad family's shape is [audio-]<fa|sp>[-<region>].spotifycdn.com: `audio-fa`
 * is the ad-serving variant and `audio-sp-*` are its regional peers. `fa` is
 * the constant in every variant and is the part that does not rotate, which is
 * why the match is on the whole label rather than a bare host list. */
const SPOTIFY_AD_HOSTS = Object.freeze([
  /(^|\.)audio-fa\.spotifycdn\.com$/i,
  /(^|\.)audio-sp-[a-z0-9-]+\.spotifycdn\.com$/i,
  /(^|\.)audio-sp\.spotifycdn\.com$/i,
  /(^|\.)ad-delivery\.spotifycdn\.com$/i,
  /(^|\.)adserver-[a-z0-9.-]+\.spotify\.com$/i,
  /(^|\.)ads\.spotify\.com$/i,
  /(^|\.)audioads\.spotify\.com$/i,
]);

const SPOTIFY_SONG_HOSTS = Object.freeze([
  /(^|\.)p\.scdn\.co$/i,
  /(^|\.)i\.scdn\.co$/i,
  /(^|\.)audio-fc\.spotifycdn\.com$/i,
  /(^|\.)audio-gc\.spotifycdn\.com$/i,
]);

/** The player's own hosts, for context (never an ad, never a song). */
const SPOTIFY_PLAYER_HOSTS = Object.freeze([
  /(^|\.)open\.spotify\.com$/i,
  /(^|\.)spotify\.com$/i,
]);

/**
 * The kind of host a URL's hostname belongs to.
 * @param {string} host  a hostname, no port, no path
 * @returns {'ad'|'song'|'player'|null}
 */
function hostKind(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return null;
  for (const re of SPOTIFY_AD_HOSTS) if (re.test(h)) return 'ad';
  for (const re of SPOTIFY_SONG_HOSTS) if (re.test(h)) return 'song';
  for (const re of SPOTIFY_PLAYER_HOSTS) if (re.test(h)) return 'player';
  return null;
}

function isAdHost(host) { return hostKind(host) === 'ad'; }
function isSongHost(host) { return hostKind(host) === 'song'; }

/**
 * The per-page slot tracker: the content script's state machine, kept pure so
 * the fixture and the unit tests drive the same object the page does.
 *
 * The invariant that matters: an element that is IN A SLOT is muted, and an
 * element that is NOT in a slot is left exactly as it was. That is what keeps
 * the song audible — the tracker never mutes a song element, because it only
 * ever puts elements into a slot when the ad host was seen.
 */
function createSlotTracker(options) {
  const opts = options || {};
  const onUnmute = opts.onUnmute || function () {};
  const onMute = opts.onMute || function () {};
  const onStall = opts.onStall || function () {};
  const log = opts.log || function () {};

  /** element -> {kind, mutedByUs, previousMuted} */
  const slots = new Map();

  /**
   * Called when a media element's source is (or is about to be) an ad host.
   * Mutes it, remembering what its mute state was before we touched it.
   */
  function enterSlot(el, host) {
    if (!el || !isAdHost(host)) return false;
    if (slots.has(el)) return false;               // already in a slot
    slots.set(el, {
      kind: 'ad',
      previousMuted: !!el.muted,
      mutedAt: Date.now(),
    });
    el.muted = true;
    onMute(el, host);
    log(`ad slot: muted ${String(host)}`);
    return true;
  }

  /**
   * Called when the slot can end: the ad element ended, its timeout fired, or
   * the player navigated the element to a song host. Restores the pre-slot mute
   * state — which is what makes the SONG audible.
   */
  function leaveSlot(el, reason) {
    const slot = slots.get(el);
    if (!slot) return false;
    slots.delete(el);
    el.muted = slot.previousMuted;
    onUnmute(el, reason);
    log(`ad slot ended (${reason}): unmuted, restored to ${slot.previousMuted}`);
    return true;
  }

  /** The navigation the player does when the slot completes. */
  function navigateToSong(el, songUrl) {
    leaveSlot(el, 'navigated-to-song');
    return { url: songUrl };
  }

  /**
   * The webRequest-side counterpart of enterSlot: the network tier looks the
   * request up and asks "is this an ad slot request?". The answer must be ALLOW
   * (not block) whenever the tracker decided to mute instead, because a block
   * is exactly what leaves the player stalled.
   *
   * `muted` is part of the contract, not decoration: it is the field that tells
   * the caller "the ad slot is allowed AND silent", which is the pair of
   * properties the whole feature exists to hold together.
   */
  function requestVerdict(url) {
    const host = hostOf(url);
    if (!host) return { action: 'passthrough', reason: 'not-spotify' };
    if (isAdHost(host)) {
      return {
        action: 'allow-and-mute',
        host,
        muted: true,
        reason: 'ad-slot-muted-not-blocked',
      };
    }
    if (isSongHost(host)) return { action: 'passthrough', host, muted: false };
    return { action: 'passthrough', host, reason: 'player-host', muted: false };
  }

  return {
    slots,
    enterSlot,
    leaveSlot,
    navigateToSong,
    requestVerdict,
    activeSlots: () => slots.size,
    /** Test/diagnostic accessor: is this element muted because of us? */
    isOurs: (el) => slots.has(el),
  };
}

/** A hostname from a URL string, without port. */
function hostOf(url) {
  const s = String(url || '');
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(s);
  if (!m) return null;
  return m[1].replace(/:\d+$/, '').toLowerCase();
}

  return {
    SPOTIFY_AD_HOSTS,
    SPOTIFY_SONG_HOSTS,
    SPOTIFY_PLAYER_HOSTS,
    isAdHost,
    isSongHost,
    hostKind,
    createSlotTracker,
  };
});
