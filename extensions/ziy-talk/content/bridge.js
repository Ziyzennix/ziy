/**
 * ziy-talk content script — the ONLY place the real Jitsi control bridge lives,
 * and the reason it lives here is the CSP constraint documented in the manifest.
 *
 * WHY THIS FILE IS A CONTENT SCRIPT AND NOT A PANEL SCRIPT
 * ------------------------------------------------------
 * Jitsi's External API is a postMessage bridge created by a script that runs in
 * the page that owns the meeting: `new JitsiMeetExternalAPI(domain, options)`
 * makes an iframe at `<origin>/<room>` and talks to it over window.postMessage
 * with scope `jitsi_meet_external_api_<id>` and allowedOrigin set to the room
 * URL's origin. That whole contract is origin-bound by design.
 *
 * A moz-extension page cannot host it, for two independent reasons:
 *   1. the MV3 extension CSP forbids a remote script source in extension_pages,
 *      so `<script src="https://server/external_api.js">` inside the panel
 *      cannot load;
 *   2. even a locally-copied external_api.js would build a bridge from the
 *      moz-extension origin, which the meeting page does not accept.
 *
 * A content script injected INTO the meeting tab, on the other hand, runs in that
 * page's own origin. It can load the server's own external_api.js, build the
 * bridge the way Jitsi documents it, and expose the documented commands. That is
 * what this file does, and it is why the "open calls in a tab" mode is the one
 * where the control surface is fully live.
 *
 * The documented commands this mirrors (jitsi.github.io/handbook, the IFrame API
 * pages, fetched 2026-10-14):
 *   api.executeCommand(command, ...arguments)
 *   api.executeCommands(commands)
 *   api.addListener(event, listener) / api.removeListener(event, listener)
 * Events are the public camelCase names the same page lists:
 *   audioMuteStatusChanged {muted}, videoMuteStatusChanged {muted},
 *   screenSharingStatusChanged {visible}, raiseHandUpdated {visible},
 *   participantJoined {id, ...}, participantLeft {id, ...},
 *   videoConferenceJoined, videoConferenceLeft, readyToClose,
 *   errorOccurred {isFatal, message, type},
 *   audioAvailabilityChanged {available}, videoAvailabilityChanged {available}
 *
 * WHAT THIS FILE DOES NOT DO: it does not fake a bridge. If the server does not
 * serve external_api.js — which is a real configuration, and the standard's own
 * docs describe the script as something the server hosts — the script reports
 * "bridge: absent" and every caller degrades to the annotation path. No command
 * is ever answered optimistically.
 */

(() => {
  'use strict';

  const api = (typeof browser !== 'undefined') ? browser : chrome;

  /* The room this tab is showing, if any. A Jitsi room URL is
     <origin>/<room>; anything path-shaped belongs to the same meeting. */
  const roomFromUrl = (url) => {
    const match = /^https:\/\/([^/]+)\/([^/?#]+)/.exec(url || '');
    return match ? match[2] : null;
  };

  let bridge = null;      // the JitsiMeetExternalAPI instance
  let bridgeState = 'absent';

  /* The chip state machine, mirrored from lib/chips.js so the script carries one
     definition of which event means which chip. */
  const CHIP_EVENTS = {
    audioMuteStatusChanged: { chip: 'microphone', from: 'muted' },
    videoMuteStatusChanged: { chip: 'camera', from: 'muted' },
    screenSharingStatusChanged: { chip: 'screen', from: 'visible' },
    raiseHandUpdated: { chip: 'hand', from: 'visible' },
  };

  let chips = {
    microphone: false, camera: false, screen: false, chat: false, hand: false,
    tiles: false, participantsPane: false, participants: 0, call: 'idle',
  };

  function applyEvent(name, payload) {
    const map = CHIP_EVENTS[name];
    if (map) {
      const value = payload ? payload[map.from] : undefined;
      if (typeof value === 'boolean') chips[map.chip] = value;
    }
    if (name === 'videoConferenceJoined') chips.call = 'live';
    if (name === 'videoConferenceLeft' || name === 'readyToClose') chips.call = 'ended';
    if (name === 'participantJoined') chips.participants += 1;
    if (name === 'participantLeft') chips.participants = Math.max(0, chips.participants - 1);
    if (name === 'errorOccurred' && payload && payload.isFatal) chips.call = 'error';
  }

  /* ------------------------------------------------------------------ *
   * Loading the server's own external_api.js.
   *
   * This is the part that is genuinely server-dependent: the script is served by
   * the Jitsi deployment, at a documented path, and a deployment that does not
   * serve it (or is not Jitsi at all, or is unreachable) leaves the bridge
   * absent. The timeout is short because a page that cannot answer in a couple of
   * seconds is a page the control surface cannot drive.
   * ------------------------------------------------------------------ */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { resolve(); return; }
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      const timer = setTimeout(() => {
        el.remove();
        reject(new Error('external_api.js timed out'));
      }, 8000);
      el.addEventListener('load', () => { clearTimeout(timer); resolve(); });
      el.addEventListener('error', () => { clearTimeout(timer); el.remove(); reject(new Error('external_api.js failed to load')); });
      (document.head || document.documentElement).append(el);
    });
  }

  async function ensureBridge() {
    if (bridge) return bridge;
    if (bridgeState === 'failed') return null;
    const origin = location.origin;
    try {
      await loadScript(`${origin}/external_api.js`);
      /* jshint ignore:start */
      if (typeof window.JitsiMeetExternalAPI !== 'function') {
        bridgeState = 'absent';
        return null;
      }
      /* jshint ignore:end */
      const room = roomFromUrl(location.href);
      if (!room) { bridgeState = 'absent'; return null; }
      bridge = new window.JitsiMeetExternalAPI(origin, {
        roomName: room,
        parentNode: document.body,
        width: '100%',
        height: '100%',
      });
      for (const name of Object.keys(CHIP_EVENTS)) {
        bridge.addListener(name, (payload) => applyEvent(name, payload));
      }
      bridge.addListener('videoConferenceJoined', () => applyEvent('videoConferenceJoined'));
      bridge.addListener('videoConferenceLeft', () => applyEvent('videoConferenceLeft'));
      bridge.addListener('readyToClose', () => applyEvent('readyToClose'));
      bridge.addListener('participantJoined', () => applyEvent('participantJoined'));
      bridge.addListener('participantLeft', () => applyEvent('participantLeft'));
      bridge.addListener('errorOccurred', (payload) => applyEvent('errorOccurred', payload));
      bridgeState = 'live';
      return bridge;
    } catch (err) {
      bridgeState = 'failed';
      console.warn('ziy-talk: no Jitsi bridge on this server — controls will degrade', err.message || err);
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * The message the background forwards here.
   * ------------------------------------------------------------------ */
  api.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.kind !== 'jitsi:execute') return undefined;
    return Promise.resolve()
      .then(async () => {
        const instance = await ensureBridge();
        if (!instance) {
          // The honest refusal: say the bridge is absent so the caller can show
          // the degraded annotation, rather than pretending the command ran.
          return { ok: false, reason: 'bridge-absent', chipState: chips, bridge: bridgeState };
        }
        const args = message.args || [];
        const supported = typeof instance.executeCommand === 'function';
        if (!supported) {
          return { ok: false, reason: 'executeCommand-missing', chipState: chips, bridge: bridgeState };
        }
        instance.executeCommand(message.command, ...args);
        // The answer is "sent", not "applied": the chip's next visible state
        // arrives with the event the meeting posts back, so the UI can never
        // show a state the meeting declined.
        return { ok: true, sent: message.command, chipState: chips, bridge: bridgeState };
      })
      .catch((err) => ({ ok: false, reason: String(err && err.message ? err.message : err), bridge: bridgeState }));
  });

  /**
   * The extension's own URL for a page inside it, which is the only way an
   * outside caller can learn the add-on's moz-extension:// origin: the engine
   * does not expose the internal UUID in extensions.json, and the BiDi
   * `webExtension` module is not built into this engine. A content script runs
   * in the extension's origin, so publishing the URL from here is exact, and it
   * is what the e2e proof uses to find the panel page.
   */
  api.runtime.onMessage.addListener((message) => {
    if (!message || message.kind !== 'ziy-talk:panel-url') return undefined;
    return { url: api.runtime.getURL('/ui/panel.html') };
  });

  // Published on the page for the e2e harness (tools/e2e/ziy-talk-panel.py).
  // A content script's `window` is a sandbox wrapper, so the property has to be
  // cloned into the page's own global to be visible to a page-context
  // Runtime.evaluate. cloneInto is the documented way to do that.
  try {
    const url = api.runtime.getURL('/ui/panel.html');
    if (typeof cloneInto === 'function') {
      cloneInto(url, window, { defineAs: '__ziyTalkPanelURL' });
    } else {
      window.__ziyTalkPanelURL = url;
    }
  } catch { /* a page that forbids it just does not publish it */ }

  /* ------------------------------------------------------------------ *
   * Boot only on a page that looks like a meeting on a Jitsi server.
   *
   * `external_api.js` being served from the origin is the cheapest read on
   * "this is a Jitsi Meet", so the script tries it and otherwise stays quiet.
   * A page that is not a Jitsi server never gets a bridge and never sees a fake
   * control.
   * ------------------------------------------------------------------ */
  const room = roomFromUrl(location.href);
  if (room) {
    ensureBridge().catch(() => {});
    // Also try again on readyState complete, because a SPA meeting page may not
    // have its head at injection time.
    if (document.readyState !== 'complete') {
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'complete' && !bridge) ensureBridge().catch(() => {});
      });
    }
  }
})();
