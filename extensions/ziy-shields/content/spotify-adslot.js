/* Ziy shields — content script: Spotify ad slots.
 *
 * The partner of lib/engine/spotify-adslot.js. This script is what makes the
 * ad slot SILENT rather than blocked, and it is the difference between "the ad
 * is gone and the song plays" and the uBlock symptom the co-owner reported
 * ("the song won't play / skips forever").
 *
 * How it works, in the order the events happen:
 *
 *   1. the page's media element navigates to an ad-delivery host. We cannot see
 *      that directly (the extension does, in the background page), so the
 *      background page tells us: the 'shields.spotify.state' message carries
 *      the ad host it saw for this document.
 *   2. for every <video>/<audio> element on the page we watch `loadstart`,
 *      `play` and `error`, and ask the background page what the current
 *      element's source is. A musical note on the shape of the URL is not
 *      enough — Spotify's ad URLs rotate — so the background answer is what
 *      decides.
 *   3. an element whose source is an AD host is put in a slot: muted, and its
 *      pre-slot mute state remembered. An element whose source is a SONG host
 *      is never touched.
 *   4. when the slot can end — the element ended, stalled, or navigated to a
 *      song host — the remembered mute state is restored, so the song that
 *      follows is audible at whatever volume the user chose.
 *
 * Why not just block the network request: a hard block makes the media element
 * error, its `ended` event never fires, the player's ad slot never ends, and
 * the song never starts. That is the stall, and it is the whole reason this
 * script exists.
 *
 * This runs in the ISOLATED world and never touches the page's own globals: it
 * reads media elements' state and calls play()/pause() on them, which is the
 * same surface the cosmetic tier uses (element hiding), not page script
 * manipulation. No page function is called, no property is patched.
 */
'use strict';

(function () {
  const NS = 'ziy-shields-spotify';

  /* The shared lib namespace, the same one the background page assembles.
   * In a content script the UMD files are not loaded (the manifest lists only
   * this file under content_scripts), so the tracker is created from a message
   * round-trip to the background page rather than from a local require. */
  const b = (typeof browser !== 'undefined') ? browser : chrome;

  function send(op, body) {
    return b.runtime.sendMessage({ op, body });
  }

  /** Element ids for diagnostics, so the debug page can name them. */
  function label(el) {
    if (el.id) return `#${el.id}`;
    if (el.className) return `${el.tagName.toLowerCase()}.${el.className.trim().split(/\s+/)[0]}`;
    return el.tagName.toLowerCase();
  }

  /**
   * Asks the background page for the verdict on one URL. Returns a promise of
   * the verdict object, never a throw.
   */
  function verdictFor(url) {
    return send('shields.spotify.verdict', { url }).then(
      (r) => (r && r.verdict) || { action: 'passthrough', reason: 'no-verdict' },
      () => ({ action: 'passthrough', reason: 'message-failed' }),
    );
  }

  /** Every media element on the page, live. */
  function mediaElements() {
    return Array.from(document.querySelectorAll('audio,video'));
  }

  /* The tracker, created lazily so the isolated world stays declarative until
   * there is a real decision to make. */
  let tracker = null;
  const muted = new Map();   // element -> the pre-slot mute state
  const inSlot = new Set();  // elements we put in an ad slot

  function currentSrc(el) {
    return el.currentSrc || el.src || '';
  }

  /** Puts an element in an ad slot: silent, remembering what it was. */
  function enterSlot(el, host) {
    if (inSlot.has(el)) return;
    inSlot.add(el);
    muted.set(el, el.muted);
    el.muted = true;
    el.dataset[NS + 'Slot'] = host || '';
    el.dataset[NS + 'Muted'] = '1';
  }

  /** Leaves the slot and restores the pre-slot mute state. */
  function leaveSlot(el, reason) {
    if (!inSlot.has(el)) return;
    inSlot.delete(el);
    const was = muted.get(el);
    el.muted = was === true;
    muted.delete(el);
    delete el.dataset[NS + 'Slot'];
    delete el.dataset[NS + 'Muted'];
    el.dataset[NS + 'LastSlotEnd'] = reason || '';
  }

  /**
   * The decision for one element at one moment. Resolves to true when the
   * element is in an ad slot (i.e. muted by us).
   */
  async function decide(el) {
    const src = currentSrc(el);
    if (!src) { leaveSlot(el, 'no-source'); return false; }
    const v = await verdictFor(src);
    if (v && v.action === 'allow-and-mute') {
      enterSlot(el, v.host);
      return true;
    }
    leaveSlot(el, v && v.reason ? v.reason : 'not-an-ad');
    return false;
  }

  /* --- the event wiring the player's behaviour actually triggers ---------- */

  function watch(el) {
    if (el[NS + 'Watched']) return;
    el[NS + 'Watched'] = true;

    /* The slot's start: the element is about to play something. */
    el.addEventListener('loadstart', () => { decide(el); });
    el.addEventListener('play', () => {
      decide(el).then((isAd) => {
        /* The ad slot is active and silent. If it were a block, the element
         * would have errored instead of firing `play`, and the player would
         * have stalled here — which is exactly what we avoid. */
        if (isAd) el.dataset[NS + 'AdAudible'] = '0';
      });
    });

    /* The slot's end: the element finished, or it moved on to the song. */
    el.addEventListener('ended', () => leaveSlot(el, 'ended'));
    el.addEventListener('emptied', () => leaveSlot(el, 'emptied'));
    el.addEventListener('stalled', () => {
      /* A stall is not the end of a slot: keep it muted and keep it in the
       * slot, because ending the slot here would restore audio mid-ad. */
      if (inSlot.has(el)) el.dataset[NS + 'Stalled'] = '1';
    });
  }

  function observe() {
    for (const el of mediaElements()) watch(el);
  }

  /* The player creates its media elements on demand, so the DOM is watched.
   * The cosmetic tier already does this for the same reason (an ad slot
   * appears after the first paint). */
  const mo = new MutationObserver(() => observe());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  observe();

  /* The debug/inspection surface: the same shape the tracker exposes, so the
   * options page and the e2e harness can read the live state. */
  window[NS.replace(/-/g, '_')] = {
    state: () => ({
      activeSlots: inSlot.size,
      mutedElements: Array.from(inSlot).map(label),
      muted: Array.from(muted.entries()).map(([el, was]) => ({
        element: label(el), preSlotMuted: was,
      })),
    }),
    decide,
    leaveSlot,
  };
})();
