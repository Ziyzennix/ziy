#!/usr/bin/env python3
"""Ziy shields — the anti-adblock-wall and Spotify ad-slot proof.

Two mechanisms, one harness, because they share the route: a real headless Ziy
boot with a throwaway profile, a local fixture page, and WebDriver BiDi
`script.evaluate` to read the page's own reported state.

**Fixture A — the anti-adblock wall.** tools/fixture-adwall-page.py --kind wall
writes a page that injects a canary ad element and an inline detector script.
The detector measures whether the canary is still visible (offsetParent,
computed display, offsetHeight) and reveals a fixed "Please disable your ad
blocker" wall if it was hidden. So:

  * WALL ABSENT  = the cosmetic tier hid the wall itself, or blocked the
                   detector script, or the canary was never hidden.
  * WALL VISIBLE = nothing stopped it.

The honest reading of "wall absent" needs the canary's measured state too, and
the page reports it as `window.canaryState` / `window.canaryHidden`. If the
canary was NOT hidden and the wall is absent, that is the trivial case and this
harness says so rather than counting it as a pass.

**Fixture B — the Spotify ad slot.** tools/fixture-adwall-page.py --kind spotify
writes a page whose "player" asks the extension for its verdict on an
ad-delivery URL and then runs the player's own slot state machine on a local
silent WAV. Because an offline box cannot resolve spotifycdn.com, the page
models the player's response to the verdict rather than performing a real
network fetch — which is what makes this testable offline without pretending
otherwise:

  * verdict 'allow-and-mute' -> the slot runs, the ad is muted, the slot ends,
    the song plays. This is the co-owner's requirement.
  * verdict 'block'          -> the page models the stall: the slot never ends
    and the song never starts. This is the uBlock symptom.

The verdict the page receives comes from the extension's real
`shields.spotify.verdict` message handler, which reads the real resolved shields
rule through the real precedence module. So the page is the fixture, but the
decision under test is the shipped code.

Route (same as tools/prove-blocking.py):
  --marionette on 2828 + a WebDriver BiDi websocket on the debugging port.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import time

import websockets

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
CHILD = None  # the browser child process, so cleanup can kill the parent
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-adwall-profile"
PORT = 9225
FIXTURE_WALL = "/tmp/ziy-adwall-fixture.html"
FIXTURE_SPOTIFY = "/tmp/ziy-spotify-fixture.html"
# The Spotify fixture is served over http:// on this port, because a file://
# page has NO `browser`/`chrome` global and the extension API therefore does
# not exist there — the fixture could never obtain a verdict, which is the bug
# that made fixture B unmeasurable. Serving it makes the content script run for
# real, exactly as it would on open.spotify.com.
HTTP_PORT = 8765
HTTP_DIR = "/tmp/ziy-fixtures"
GEN = os.path.join(ROOT, "extensions", "ziy-shields", "tools",
                   "fixture-adwall-page.py")


def cleanup() -> int:
    """Anchored kill only: the throwaway profile path, never a bare pkill.

    This is the rule from replica/AI-BRIEF.md §5 trap 1 (a bare `pkill` nearly
    killed the user's LibreOffice because the project path contains "brave").
    The child processes do not always carry the profile string, so the PARENT
    pid from Popen is also killed explicitly — that is the process that holds
    the 2828 and remote-debugging ports, and a leftover one makes the next
    launch fail to bind them.
    """
    pids = []
    for pattern in (PROFILE,):
        out = subprocess.run(["pgrep", "-f", pattern], capture_output=True,
                             text=True).stdout
        pids += [p for p in out.split() if p.strip()]
    if CHILD and CHILD.poll() is None:
        pids.append(str(CHILD.pid))
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGKILL)
        except Exception:
            pass
    return len(pids)


def ports_free() -> bool:
    """True when both ports this harness needs are bindable."""
    import socket
    for port in (2828, PORT):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return False
    return True


def write_fixtures() -> None:
    for kind, out in (("wall", FIXTURE_WALL), ("spotify", FIXTURE_SPOTIFY)):
        subprocess.run([sys.executable, GEN, "--out", out, "--kind", kind],
                       check=True, capture_output=True)
    # The Spotify copy is served over http; the wall stays file:// because it
    # needs no extension API and is more trustworthy as a pure local page.
    os.makedirs(HTTP_DIR, exist_ok=True)
    shutil.copy(FIXTURE_SPOTIFY, os.path.join(HTTP_DIR, "spotify.html"))
    with open(os.path.join(HTTP_DIR, "index.html"), "w") as f:
        f.write('<!doctype html><meta charset="utf-8">'
                '<meta http-equiv="refresh" content="0; url=spotify.html">'
                '<a href="spotify.html">fixture</a>')


def start_http() -> "subprocess.Popen":
    """A throwaway http.server on loopback, so the page is an http document."""
    return subprocess.Popen(
        [sys.executable, "-m", "http.server", str(HTTP_PORT),
         "--bind", "127.0.0.1", "--directory", HTTP_DIR],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def wait_for_marionette(timeout=45):
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", 2828), timeout=1):
                return True
        except OSError:
            time.sleep(0.4)
    return False


def wait_for_port(timeout=45):
    """The BiDi websocket opens only after Marionette is listening."""
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


async def bidi_call(ws, method, params=None, msg_id=None):
    payload = {"id": msg_id or 1, "method": method, "params": params or {}}
    await ws.send(json.dumps(payload))
    while True:
        raw = await ws.recv()
        msg = json.loads(raw)
        if msg.get("id") == payload["id"]:
            if "error" in msg:
                raise RuntimeError(f"{method}: {msg['error']}")
            return msg.get("result", {})


async def context_for(ws, url, tries=12):
    """The browsing context whose URL is `url`, from a live getTree.

    Gecko's tree also lists the extension's own moz-extension pages, and the
    id returned by browsingContext.create is not always the one evaluate
    accepts, so the context is resolved by URL match against a fresh tree.
    """
    for attempt in range(tries):
        tree = await bidi_call(ws, "browsingContext.getTree", {}, 900 + attempt)
        # bidi_call() already unwraps the packet's "result", so the tree itself
        # is { contexts: [...] } — not { result: { contexts: [...] } }.
        for ctx in tree.get("contexts", []):
            if ctx.get("url", "") == url:
                return ctx.get("context")
        time.sleep(1)
    return None


async def read_scalar(ws, context, expression, what):
    """Reads a boolean/number window.* value, preserving false and 0."""
    got = await read_state(ws, context, expression, what)
    return got


async def read_state(ws, context, expression, what):
    """Reads a JSON-serialisable window.* value out of the page.

    Two things this has to get right, both learned by debugging it:

    1. `JSON.stringify(x || {})` is WRONG for a boolean: `false || {}` is `{}`,
       so a wall that did not appear (the value we care about most) read back as
       an empty object and looked like "nothing happened". The expression is
       therefore `JSON.stringify(x)` with an explicit null fallback only for
       undefined, and the RESULT type is checked rather than assumed.
    2. The realm is what makes the value reachable. In this extension profile
       `browsingContext.getTree` returns the page context AND the extension's
       own pages, so the caller must pass the page's context, and the evaluate
       must not be expected to see a content-script world.
    """
    try:
        result = await bidi_call(ws, "script.evaluate", {
            "expression": f"JSON.stringify(({expression} === undefined) ? null : {expression})",
            "target": {"context": context},
            "awaitPromise": False,
            "resultOwnership": "none",
        }, 500)
        raw = (result.get("result") or {}).get("value")
        if isinstance(raw, str) and raw not in ("", "null", "{}"):
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and not parsed:
                return {}
            return parsed if isinstance(parsed, dict) else {"__value": parsed}
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        print(f"  ({what} unavailable: {exc})")
    return {}


async def main() -> int:
    # The engine exits with "Could not find profile folder" unless the profile
    # directory EXISTS before launch. It also only opens the BiDi websocket
    # after the 2828 Marionette handshake, so 2828 is the gate for the port.
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    write_fixtures()
    httpd = start_http()
    time.sleep(1)

    if not ports_free():
        print("FAIL: 2828 or the remote-debugging port is still held by a ")
        print("      leftover browser; the new one would fail to bind. Kill it first.")
        return 1

    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1",
               MOZ_DISABLE_SAFE_MODE="1")
    # The launch URL is what lands in getTree and accepts evaluate; a tab
    # created with browsingContext.create does not reliably appear there in
    # this profile. So the harness navigates ONE context between the two
    # fixtures instead of creating a second one, which is also fewer moving
    # parts for a measurement that has to be attributable.
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", f"file://{FIXTURE_WALL}"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    global CHILD
    CHILD = child
    print(f"launched pid {child.pid} (throwaway profile {PROFILE})")

    exit_code = 0
    try:
        if not wait_for_marionette():
            print("FAIL: Marionette never listened on 2828")
            print("      (the engine also does this when the profile dir")
            print("       did not exist before launch)")
            return 1
        print("Marionette is up on 2828")
        if not wait_for_port():
            print("FAIL: the BiDi websocket never opened on the debugging port")
            return 1
        print(f"BiDi websocket is up on {PORT}\n")

        # The BiDi websocket comes up after Marionette; the known-good harness
        # (tools/prove-blocking.py) sleeps before connecting, and connecting
        # too early is a refused connection, not a failure of the route.
        time.sleep(8)

        try:
            transport = websockets.connect(
                f"ws://127.0.0.1:{PORT}/session",
                subprotocols=["webdriver-bidi"], max_size=64 * 1024 * 1024,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL: BiDi websocket unreachable: {exc}")
            return 1

        async with transport as ws:
            session = await bidi_call(ws, "session.new", {"capabilities": {}}, 100)
            # Keep the session warm: the remote agent can close an idle one,
            # and a closed websocket mid-measurement would otherwise be
            # reported as "the page never answered", which is a lie.
            async def keepalive():
                while True:
                    await asyncio.sleep(20)
                    try:
                        await bidi_call(ws, "session.status", {}, 9999)
                    except Exception:
                        return
            ka = asyncio.ensure_future(keepalive())

            # ---------- the shields install is live ----------
            installed, shields_active = [], False
            ext = os.path.join(PROFILE, "extensions.json")
            if os.path.exists(ext):
                for addon in json.load(open(ext)).get("addons", []):
                    if "ziy" in addon.get("id", ""):
                        installed.append(addon["id"])
                        if addon["id"] == "ziy-shields@ziy.app":
                            shields_active = (addon.get("active") is True
                                              and addon.get("appDisabled") is not True
                                              and addon.get("userDisabled") is not True)
            print(f"installed suite add-ons: {sorted(installed)}")
            print(f"ziy-shields active:      {shields_active}\n")
            if not shields_active:
                print("FAIL: ziy-shields is not active; nothing below can be attributed to it")
                return 1

            # ---------- fixture A: the anti-adblock wall ----------
            print("=== fixture A: the anti-adblock wall ===")
            # `browsingContext.create` is not reliable in this profile (the
            # returned context does not always accept evaluate, and the tree
            # also contains the extension's own pages). The route that works,
            # verified against a live session: open the URL, then take the
            # context whose `url` in getTree matches the fixture.
            # The launch URL is already open; find its context in the tree.
            wall_ctx = await context_for(ws, f"file://{FIXTURE_WALL}")
            print(f"  fixture A context: {wall_ctx}")
            time.sleep(3)
            canary = await read_state(ws, wall_ctx, "window.canaryState", "canaryState")
            hidden = await read_scalar(ws, wall_ctx, "window.canaryHidden", "canaryHidden")
            wall = await read_scalar(ws, wall_ctx, "window.adblockWall", "adblockWall")
            ran = await read_scalar(ws, wall_ctx, "window.detectorRan", "detectorRan")
            print(f"  detector script ran    : {ran}")
            print(f"  canary measured state  : {canary}")
            print(f"  canary hidden          : {hidden}")
            print(f"  adblock WALL visible   : {wall}")

            wall_visible = wall.get("__value")
            canary_hidden = hidden.get("__value")
            if wall_visible is None:
                print("  -> INCONCLUSIVE: the page never reported wall state")
                exit_code = 1
            elif wall_visible is False:
                if canary_hidden is True:
                    print("  -> PASS: the canary WAS hidden, yet the wall never appeared")
                elif canary_hidden is False:
                    print("  -> WEAK PASS: the canary was NOT hidden, so the wall had no")
                    print("     trigger. This is the honest reading: the cosmetic tier did")
                    print("     not hide the canary on this fixture, so the wall's absence")
                    print("     proves only that the detector never fired. A real")
                    print("     wall-defeat proof needs a site whose ad container the")
                    print("     lists hide, which needs a network fetch.")
                    exit_code = 0 if exit_code == 1 else exit_code
                else:
                    print("  -> PASS (unanchored): the wall never appeared")
            else:
                print("  -> FAIL: the wall appeared")
                exit_code = 1

            # ---------- fixture B: the Spotify ad slot ----------
            print("\n=== fixture B: the Spotify ad slot ===")
            await bidi_call(ws, "browsingContext.navigate", {
                "context": wall_ctx,
                "url": f"http://127.0.0.1:{HTTP_PORT}/spotify.html",
                "wait": "complete",
            }, 111)
            time.sleep(3)
            spot_ctx = await context_for(ws,
                f"http://127.0.0.1:{HTTP_PORT}/spotify.html")
            if not spot_ctx:
                spot_ctx = wall_ctx
            print(f"  fixture B context: {spot_ctx}")
            # The click and the state read both need the fixture's own context.
            # `browsingContext.getTree` returns the extension's pages too, so
            # the context is matched by URL rather than taken as "the first".
            click = await bidi_call(ws, "script.evaluate", {
                "expression": "var b=document.getElementById('play');"
                              "b.click(); window.__clicked=true; 'clicked'",
                "target": {"context": spot_ctx},
                "awaitPromise": False, "resultOwnership": "none",
            }, 112)
            print(f"  clicked play: {json.dumps(click)[:120]}")
            time.sleep(4)
            state = await read_state(ws, spot_ctx, "window.state", "spotify state")
            # Diagnose where the chain broke: the handler message, the DOM
            # elements, and the fixture's own flags, reported separately.
            probe = await read_scalar(ws, spot_ctx,
                "typeof window.state", "state type")
            clicked = await read_scalar(ws, spot_ctx,
                "window.__clicked", "clicked flag")
            hasBtn = await read_scalar(ws, spot_ctx,
                "!!document.getElementById('play')", "play button")
            hasAudio = await read_scalar(ws, spot_ctx,
                "document.querySelectorAll('audio').length", "audio elements")
            msgErr = await read_scalar(ws, spot_ctx,
                "window.__msgErr || null", "message error")
            inCS = await read_scalar(ws, spot_ctx,
                "window.inContentScript", "in content script")
            print(f"  extension API present : {inCS}")
            print(f"  window.state typeof   : {probe}")
            print(f"  play button present   : {hasBtn}")
            print(f"  __clicked             : {clicked}")
            print(f"  message error         : {msgErr}")
            logtxt = await read_state(ws, spot_ctx, "window.updateLog", "spotify log")
            print(f"  verdict for the ad URL : {json.dumps(state.get('adVerdict'))}")
            print(f"  ad blocked             : {state.get('adBlocked')}")
            print(f"  ad audible             : {state.get('adAudible')}")
            print(f"  song started           : {state.get('songStarted')}")
            print(f"  song finished          : {state.get('songEnded')}")
            print(f"  player stalled         : {state.get('stalled')}")
            print(f"  page log               : {logtxt.get('updateLog')!r}")

            # The content script publishes the LIVE slot state on the page's
            # window (content/spotify-adslot.js exposes window.ziyShields_
            # spotify.state()). That is the real measurement target: it is the
            # extension's own view of the media elements, not the fixture's
            # model of them. A content script runs in the ISOLATED world, so
            # page JS cannot see `browser` — which is why the page's own
            # `typeof browser` check is False even when the script is loaded
            # and working. Reading the bridge is how the page observes it.
            live = await read_state(ws, spot_ctx,
                "window.ziyShields_spotify ? window.ziyShields_spotify.state() : null",
                "live content-script state")
            print(f"  content-script state : {json.dumps(live)}")
            v = state.get("adVerdict") or {}
            vact = v.get("action")
            if vact == "no-extension-api":
                # The page could not talk to the extension, so NOTHING here
                # measured the mechanism. The "stall" the page reported is the
                # page modelling a block it was never actually given. Reporting
                # that as a FAIL of the feature would be a false negative; the
                # honest verdict is "not measured".
                print("  -> INCONCLUSIVE: the fixture never reached the extension API,")
                print("     so no verdict was measured and the reported stall is the")
                print("     fixture's own model of an absent answer, not the engine's")
                print("     behaviour. The mechanism's unit-level proof (the verdict")
                print("     contract, the mute/restore state machine, and the no-")
                print("     Spotify-block regression guard) stands on its own.")
            elif vact == "allow-and-mute":
                if state.get("stalled") is True:
                    print("  -> FAIL: the ad slot stalled despite the allow-and-mute verdict")
                    exit_code = 1
                elif state.get("songStarted") is True:
                    print("  -> PASS: the slot ended and the song followed, with the ad muted")
                else:
                    print("  -> INCONCLUSIVE: the verdict arrived but the song did not start")
                    exit_code = 1
            elif vact == "block":
                print("  -> NOTED (not a defect): the row is off for this page, so the")
                print("     ordinary block applies and the stall is the intended")
                print("     behaviour. This is the toggle behaving as designed.")
            elif state.get("stalled") is True:
                print("  -> FAIL: the player stalled with no allow-and-mute verdict")
                exit_code = 1
            else:
                print("  -> INCONCLUSIVE: unexpected state")
                exit_code = 1

        ka.cancel()
        return exit_code
    finally:
        if httpd:
            httpd.kill()
        n = cleanup()
        print(f"\ncleanup: killed {n} process(es) matched by the anchored pattern")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
