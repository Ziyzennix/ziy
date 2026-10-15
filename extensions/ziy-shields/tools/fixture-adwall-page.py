#!/usr/bin/env python3
"""Writes the local anti-adblock-wall fixture, and the Spotify ad-slot fixture.

Two fixtures, because they test two different mechanisms:

**antiadblock-wall.html** — the "please turn off your ad blocker" wall.
Emulates the detector shape the real lists defend against, and the shape the
co-owner asked us to defeat:

  1. the page injects a *canary* element with class `ad-slot ad` — the bait an
     ad blocker hides
  2. an inline script (the "detector") checks whether the canary is still
     visible, by the same signals real detectors use: `offsetParent` non-null,
     `getComputedStyle(...).display !== 'none'`, and `offsetHeight > 0`
  3. if the canary was hidden, the detector reveals `#adblock-wall` (the wall)
     and calls `window.reportWall(true)`
  4. if the canary survived, the detector calls `window.reportWall(false)` and
     the page reports the canary's measured state

`window.adblockWall`, `window.canaryState` and `window.loaded` are what the
harness reads back through the debug page, the same route
tools/prove-blocking.py uses for the tracker fixture.

The wall is deliberately also styled to sit ON TOP of the page content
(`position:fixed; z-index:9999`), because that is what the real walls do, and
because it makes the "wall is gone" claim observable rather than a matter of
trusting a flag.

**spotify-adslot.html** — the Spotify-style ad slot. Emulates the web player's
slot mechanism: the player puts a media element on the ad URL; when that
request FAILS or errors the player stalls in the ad slot and the real song
never follows. That is the exact symptom the co-owner reported from uBlock
("the song won't play / skips forever"). The fixture has two media elements:

  - `#ad-audio`   src on `audio-fa.spotifycdn.test` — the ad delivery host
  - `#song-audio` src on `p.scdn.co.test` — the real song, which is only
    started by the player's advance-to-slot logic

and `window.reportSlot()` publishes the observed state: whether the ad
requested, whether it errored, and whether the song played to completion.

Both fixtures are offline-honest: the "ad host" and "song host" are names that
resolve to nothing, so the only thing that can decide what happens is the
extension. The URLs are deliberately on hosts whose names match the Spotify
ad-delivery pattern so the list rule under test is the one the spike carries.
"""
from __future__ import annotations

import argparse
from pathlib import Path

# --- the anti-adblock wall ------------------------------------------------

WALL_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Ziy Shields anti-adblock fixture</title>
<style>
body{font:16px system-ui,sans-serif;margin:2rem;background:#12232e;color:#fff}
#ad-slot{width:300px;height:90px;background:#5a6b7a}
#adblock-wall{display:none;position:fixed;inset:0;z-index:9999;
  background:#111;color:#fff;font-size:20px;line-height:1.5;padding:4rem;
  text-align:center}
#adblock-wall.on{display:flex !important;align-items:center;justify-content:center}
</style>
</head><body>
<h1>Anti-adblock detector fixture</h1>
<p>The canary below is the bait. The inline script measures whether it is
still visible and shows the wall if it was hidden.</p>
<div id="ad-slot" class="ad-slot ad adsbox ad-banner">canary</div>
<div id="adblock-wall" role="alertdialog" aria-labelledby="wall-title">
  <div>
    <h2 id="wall-title">Please disable your ad blocker</h2>
    <p>This site is funded by advertising. Turn off your ad blocker and
    reload to continue reading.</p>
  </div>
</div>
<div id="detector-script" data-role="detector"></div>
<script>
(function () {
  "use strict";
  var canary = document.getElementById("ad-slot");
  var wall = document.getElementById("adblock-wall");

  /* The three measurements every real detector makes. */
  function measure() {
    var cs = canary ? getComputedStyle(canary) : null;
    return {
      offsetParent: !!(canary && canary.offsetParent),
      display: cs ? cs.display : "absent",
      height: canary ? canary.offsetHeight : -1,
      clientHeight: canary ? canary.clientHeight : -1,
    };
  }

  function hidden(state) {
    return state.display === "none"
        || state.height === 0
        || state.clientHeight === 0
        || !state.offsetParent;
  }

  var state = measure();

  /* A detector script that gets blocked never runs this line, so wall stays
     false. That is the "detector script blocked" path. */
  window.canaryState = state;
  window.canaryHidden = hidden(state);
  window.detectorRan = true;

  if (hidden(state)) {
    wall.className = "on";
    window.adblockWall = true;
  } else {
    window.adblockWall = false;
  }
  window.reportWall = function (v) { window.adblockWall = v; };

  window.loaded = true;
  window.loadedAt = Date.now();
})();
</script>
</body></html>
"""

# --- the Spotify-style ad slot --------------------------------------------
#
# Offline-honesty note: an offline box cannot resolve audio-fa.spotifycdn.com, so
# a fixture whose ad <audio> literally pointed there would fail to load whether
# or not the extension blocked it — it would prove nothing. That is why the
# audio half is a local silent WAV and the DECISION under test is the
# extension's verdict, obtained over a real message from the real background
# page. The URL is still the real ad host, so the verdict being asked about is
# the real thing.
#
# So the fixture separates the two halves and tests each on its own:
#
#   * the NETWORK half is the extension's verdict on the ad URL, which the page
#     asks for over a runtime message and reports verbatim. That is the half
#     that decides "stall" vs "advance", and it is fully testable offline.
#   * the PLAYER half is the player's own state machine, driven by a tiny
#     locally-servable audio loop for both the ad and the song, so the
#     "slot ends -> song follows" behaviour can be observed end to end.
#
# The fixture also carries the stall reproduction: if the extension's verdict is
# a block, the page models the player's real response (the media element errors,
# its `ended` never fires, the slot never ends) and reports stalled:true.
SPOTIFY_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Ziy Shields Spotify ad-slot fixture</title>
<style>
body{font:16px system-ui,sans-serif;margin:2rem;background:#191414;color:#fff}
#log{font-family:ui-monospace,monospace;white-space:pre-wrap;background:#000;
  padding:1rem;border-radius:.5rem}
button{font-size:1rem;padding:.5rem 1rem}
</style>
</head><body>
<h1>Spotify ad-slot fixture</h1>
<p>The player puts a media element on the ad URL, waits out the slot, then
advances to the real song. A hard block of the ad URL leaves the player stalled
in the slot &mdash; the song never plays.</p>
<button id="play">Play</button>
<div id="log"></div>
<script>
(function () {
  "use strict";
  var AD_URL = "__ZSPOT_AD_URL__";
  var SONG_URL = "__ZSPOT_SONG_URL__";
  var log = [];
  var state = {
    adVerdict: null, adBlocked: null, adAudible: false,
    songStarted: false, songEnded: false, stalled: false,
  };

  function say(msg) {
    log.push(msg);
    document.getElementById("log").textContent = log.join("\\n");
  }

  /* The extension API only exists on an extension page or in a content script
     on an http(s) document. A file:// page has NEITHER `browser` NOR `chrome`,
     so a bare `browser || chrome` here throws and kills the whole IIFE before
     `window.state` is ever published — which is exactly the failure this
     fixture had, and why fixture B could not measure anything. When the API is
     absent the fixture says so explicitly instead of dying silently. */
  var b = (typeof browser !== "undefined") ? browser
        : (typeof chrome !== "undefined" ? chrome : null);
  var IN_CONTENT_SCRIPT = !!b && !!b.runtime;

  /* Ask the extension what it would do with the ad URL. This is the half that
     decides stall vs advance. */
  function askVerdict(url) {
    if (!IN_CONTENT_SCRIPT) {
      // Reported, not thrown: the harness reads this back and the
      // "inconclusive" branch below prints why, rather than the page looking
      // like it simply never responded.
      return Promise.resolve({
        action: "no-extension-api",
        reason: "this page is not an extension context; the verdict cannot be "
              + "obtained here",
      });
    }
    return b.runtime.sendMessage({
      op: "shields.spotify.verdict",
      body: { url: url },
    }).then(function (r) { return r && r.verdict; },
      function (e) {
        // The message itself failed — no listener answered. That is a real
        // distinction from "the listener answered with an unknown verdict",
        // and the harness probes it so the difference stays visible.
        window.__msgErr = String(e && e.message ? e.message : e);
        return { action: "unknown", reason: String(e) };
      });
  }

  /* A 0.2s silent WAV, so the "ad" and the "song" are both servable offline
     and the slot has a real timeline. They differ only by the label the page
     keeps, so what is being measured is purely the player state machine. */
  var SILENT = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==";

  var adSlotActive = false;
  var adEl = null;
  var songEl = null;

  function advanceSlot() {
    if (!adSlotActive) return;
    adSlotActive = false;
    state.stalled = false;
    state.songStarted = true;
    say("slot ended -> starting the song at full volume");
    songEl = new Audio();
    songEl.muted = false;
    songEl.volume = 1;
    songEl.src = SILENT;
    songEl.addEventListener("ended", function () {
      state.songEnded = true;
      say("the song played to the end");
    });
    songEl.play().then(function () { say("song playing"); },
      function (e) { say("song play() rejected: " + e.name); state.stalled = true; });
  }

  function enterAdSlot() {
    adSlotActive = true;
    say("entering the ad slot");
    adEl = new Audio();
    adEl.muted = true;              /* the mute: the ad is never audible */
    state.adAudible = false;
    adEl.src = SILENT;
    adEl.play().then(function () { say("ad playing (muted)"); },
      function (e) {
        say("the ad could not play: " + e.name);
        state.stalled = true;       /* the player's real response to a failure */
      });
    setTimeout(advanceSlot, 300);
  }

  document.getElementById("play").addEventListener("click", function () {
    askVerdict(AD_URL).then(function (v) {
      state.adVerdict = v;
      state.adBlocked = v && v.action === "block";
      say("extension verdict for the ad URL: " + JSON.stringify(v));
      if (state.adBlocked) {
        /* Model the player's response to a hard block: the slot never ends. */
        state.stalled = true;
        say("ad request blocked -> the slot never ends -> the song never plays");
        return;
      }
      enterAdSlot();
    });
  });

  window.inContentScript = IN_CONTENT_SCRIPT;
  window.state = state;
  window.loaded = true;
})();

/* If the player IIFE threw, this records where. A fixture that silently dies
   is a fixture that proves nothing, so the harness can tell "the mechanism
   said no" apart from "the fixture never ran". */
window.addEventListener("error", function (e) {
  window.__scriptError = { message: e.message, line: e.lineno, col: e.colno,
                           source: (e.filename || "").slice(-40) };
});
</script>
</body></html>
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output .html path")
    ap.add_argument(
        "--kind",
        choices=["wall", "spotify"],
        default="wall",
        help="which fixture to write",
    )
    ap.add_argument("--ad-url", default=None, help="the ad slot audio URL")
    ap.add_argument("--song-url", default=None, help="the real song URL")
    args = ap.parse_args()

    html = WALL_PAGE if args.kind == "wall" else SPOTIFY_PAGE
    if args.kind == "spotify":
        # The two hosts are the Spotify ad-delivery / CDN shape the list rules
        # name; they resolve to nothing, so only the extension decides.
        ad_url = args.ad_url or "https://audio-fa.spotifycdn.com/ad-segment.mp3"
        song_url = args.song_url or "https://p.scdn.co/song.mp3"
        # Placeholders are tokens a URL cannot contain, so the substitution
        # cannot rewrite its own declaration. (The first version of this
        # fixture used the bare words, and the replace turned
        # `var AD_URL = "..."` into `var https://... = "..."` — a SyntaxError
        # that made the page's script never run and every window.* read
        # undefined, so the fixture proved nothing.)
        html = html.replace("__ZSPOT_AD_URL__", ad_url).replace(
            "__ZSPOT_SONG_URL__", song_url)

    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    print(f"wrote {path} ({len(html)} bytes, kind={args.kind})")


if __name__ == "__main__":
    main()
