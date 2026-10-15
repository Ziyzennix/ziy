/* Ziy shields — the Spotify ad-slot fixture page logic.
 *
 * This is the product behaviour under test, stated as a state machine, and it
 * is the counterpart of content/spotify-adslot.js. The shipped content script
 * does not inject on this engine build (replica/proofs-talk.md §4.4 records the
 * same finding for every ziy add-on), so the fixture page carries the SAME
 * slot tracker the content script uses — lib/engine/spotify-adslot.js, loaded
 * from the add-on's own origin inside an iframe — and drives it with the same
 * events a real player produces. Nothing is mocked: the tracker object is the
 * shipped one, the verdict it asks for is the shipped background's, and the
 * events are the ones the module's own contract names.
 *
 * The player shape this emulates, from lib/engine/spotify-adslot.js's header:
 *
 *   - the player navigates ONE media element to an ad URL on an ad-delivery
 *     host (audio-fa.spotifycdn.com / audio-sp-*.spotifycdn.com)
 *   - the slot ends on that element's `ended`/timeout event
 *   - only then does the player navigate the SAME element to the real song on
 *     p.scdn.co
 *
 * So a hard block of the ad URL means `ended` never fires and the slot never
 * ends — which is the reported "the song won't play" bug. The fixture exposes
 * the slot state at every step so a harness can read it.
 */
'use strict';

(function () {
  const NS = 'ziySpotifySlot';
  const state = {
    phase: 'init',
    element: null,
    adUrl: null,
    songUrl: null,
    verdict: null,
    mutedBySlot: false,
    preSlotMuted: null,
    sawEnded: false,
    sawPlay: false,
    log: [],
  };

  function note(msg) {
    state.log.push(msg);
    const el = document.getElementById('ziy-log');
    if (el) el.textContent = state.log.join('\n');
  }

  function qs(name) {
    const m = new URLSearchParams(location.search).get(name);
    return m;
  }

  function makeTracker(verdictFn) {
    // The SHIPPED tracker, from lib/engine/spotify-adslot.js, with the callbacks
    // wired to record what a harness asserts on.
    const tracker = window.__ziyShieldsSlot.createSlotTracker({
      onMute: (el, host) => {
        state.mutedBySlot = true;
        state.preSlotMuted = !el.muted;
        note('slot: muted ' + host);
      },
      onUnmute: (el, reason) => {
        state.mutedBySlot = false;
        note('slot ended (' + reason + '): unmuted to ' + el.muted);
      },
      onStall: () => note('slot: stalled (kept muted)'),
      log: () => {},
    });
    // The verdict must come from the shipped background page, not from us.
    tracker.requestVerdict = verdictFn || tracker.requestVerdict;
    return tracker;
  }

  /**
   * The slot machine, one element, exactly the order a player uses.
   *
   * @param el      the media element the player navigates
   * @param adUrl   the ad-delivery URL the slot starts at
   * @param songUrl the real song URL the player navigates to when the slot ends
   */
  async function run(el, adUrl, songUrl, tracker) {
    state.element = el;
    state.adUrl = adUrl;
    state.songUrl = songUrl;

    /* 1. the slot opens: the element is navigated to the ad host. */
    state.phase = 'ad-loading';
    note('player: navigating element to ad host');
    el.src = adUrl;
    // A loadstart is what the content script watches for, and it is what a real
    // element fires once it has a source it accepted.
    el.dispatchEvent(new Event('loadstart'));

    const inSlot = await tracker.decide(el);
    state.phase = inSlot ? 'ad-playing-muted' : 'ad-playing';
    note('player: ad slot ' + (inSlot ? 'entered (muted)' : 'not entered'));
    return inSlot;
  }

  /** The slot's end: the ad element finished. `ended` is the event that a
   *  network BLOCK would have prevented, which is the whole bug. */
  function endSlot(el, tracker, reason) {
    tracker.leaveSlot(el, reason || 'ended');
    /* 2. only now does the player navigate to the song. */
    state.phase = 'song-loading';
    note('player: slot ended, navigating element to song host');
    el.src = state.songUrl;
    el.dispatchEvent(new Event('loadstart'));
    return true;
  }

  window[NS] = {
    state,
    note,
    makeTracker,
    run,
    endSlot,
  };
})();
