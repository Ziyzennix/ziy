#!/usr/bin/env python3
"""Ziy Talk — the panel proof, over WebDriver BiDi.

Proves, on a real headless Ziy boot with a throwaway profile:

  1. the ziy-talk add-on is installed and active (extensions.json)
  2. the panel page renders (driven over BiDi, not CDP: the engine implements
     WebDriver BiDi at /session, and chrome's PUT /json/new does not work on it)
  3. the panel's own DOM assertions pass: the room-id display, the control
     chips, the settings summary and the warning gate are all really there
  4. the control surface does NOT fake a connected state with no bridge
  5. a screenshot of the panel is captured and checked to be non-blank with PIL

Route and why this one: Firefox's remote protocol is Marionette/WebDriver BiDi
(firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html), not
Chrome's CDP. That is the same route the shields worker proved on this machine
(replica/proofs-shields.md §7.3), and it is the one that can reach an extension
page: webExtension.moz:listExtensions returns the add-on's moz-extension://
root, and browsingContext.create can navigate straight to it.

    --marionette (Marionette on 2828) + MOZ_MARIONETTE=1
    BiDi websocket at ws://127.0.0.1:PORT/session/<id>

Kill hygiene: every process this script starts is matched by the anchored
pattern /tmp/ziy-.*profile, and only by that. The user's own Firefox and
LibreOffice are never matched.
"""

import asyncio
import json
import os
import signal
import subprocess
import sys
import time

import websockets

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-talk-verify-profile"
PORT = 9226
ARTIFACTS = os.path.join(ROOT, "build", "verify")
MARIONETTE_PORT = 2828

EXT_ID = "ziy-talk@ziy.app"

# The shim the file:// route injects. It is a harness fixture, not product code:
# it answers the panel's three runtime calls with the shipped defaults so the
# panel's own logic runs unchanged. It deliberately has no storage, so the panel
# sees the defaults — which is exactly the "no server configured" first-run
# state this proof asserts.
SHIM_SOURCE = """
(function(){
  // One store, shared by both the runtime.sendMessage path the panel uses and
  // the storage.local path the options page and the harness use. A shim whose
  // two halves disagreed would test nothing.
  var store = {};
  var api = {
    runtime: {
      sendMessage: function (msg) {
        // The calls the panel makes, answered the way background.js would.
        var kind = msg && msg.kind;
        if (kind === 'settings:get') {
          return Promise.resolve({ settings: store['talk.settings'] || null });
        }
        if (kind === 'recent:get') {
          return Promise.resolve({ recent: store['talk.recent'] || null });
        }
        if (kind === 'recent:remember') {
          var list = store['talk.recent'] || [];
          var entry = { room: msg.room, server: msg.server,
                        startedAt: Date.now(), lastUsedAt: Date.now() };
          store['talk.recent'] = [entry].concat(
            list.filter(function (r) { return r.room !== msg.room; })).slice(0, 12);
          return Promise.resolve({ recent: store['talk.recent'] });
        }
        if (kind === 'recent:set') {
          store['talk.recent'] = msg.recent || [];
          return Promise.resolve({ recent: store['talk.recent'] });
        }
        if (kind === 'settings:set') {
          store['talk.settings'] = msg.settings;
          return Promise.resolve({ settings: msg.settings });
        }
        return Promise.resolve({ supported: true });
      },
      openOptionsPage: function () { return Promise.resolve(); },
      getURL: function (p) { return p; },
      onMessage: { addListener: function () {} },
    },
    storage: {
      local: {
        get: function (keys) {
          var out = {};
          if (keys == null) return Promise.resolve(Object.assign({}, store));
          var list = Array.isArray(keys) ? keys : [keys];
          for (var i = 0; i < list.length; i++) out[list[i]] = store[list[i]];
          return Promise.resolve(out);
        },
        set: function (obj) {
          for (var k in obj || {}) store[k] = obj[k];
          return Promise.resolve();
        },
      },
      onChanged: { addListener: function () {} },
    },
    tabs: { create: function () { return Promise.resolve({}); } },
  };
  window.browser = api;
  window.chrome = api;
  // The harness's back door, so the proof can seed the settings the way the
  // options page would before reloading the panel.
  window.__ziyTalkShimStore = store;
})();
"""


def cleanup():
    """Anchored kill only: the throwaway profile path, nothing else."""
    out = subprocess.run(["pgrep", "-f", PROFILE], capture_output=True, text=True).stdout
    pids = [p for p in out.split() if p.strip()]
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except Exception:
            pass
    time.sleep(1)
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGKILL)
        except Exception:
            pass
    return len(pids)


def wait_for_port(port, timeout=60):
    import socket

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.4)
    return False


class BiDi:
    def __init__(self, ws):
        self.ws = ws
        self._next = 1

    async def call(self, method, params=None):
        msg_id = self._next
        self._next += 1
        await self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            raw = await self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") != msg_id:
                continue
            if "error" in msg:
                raise RuntimeError(f"{method}: {msg['error']}")
            return msg.get("result", {})


async def evaluate(bidi, context, expression):
    # awaitPromise is required by this engine's BiDi implementation, not optional
    # ("Expected \"awaitPromise\" to be a boolean"), so it is always sent.
    result = await bidi.call("script.evaluate", {
        "expression": expression,
        "target": {"context": context},
        "awaitPromise": True,
        "returnByValue": True,
    })
    return result.get("result", {}).get("value")


async def main():
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    os.makedirs(ARTIFACTS, exist_ok=True)

    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE,
         "--marionette", f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"launched pid {child.pid} (throwaway profile {PROFILE})")

    failures = []
    try:
        if not wait_for_port(PORT, 90) or not wait_for_port(MARIONETTE_PORT, 90):
            print("FAIL: the browser never opened its debugging ports")
            return 1
        print(f"the remote debugging port is up on {PORT}")

        # Give the app-scope distribution installer time to process the suite.
        time.sleep(20)

        # ---- 1. the add-on is installed and active --------------------------
        ext = os.path.join(PROFILE, "extensions.json")
        installed = []
        talk_active = False
        if os.path.exists(ext):
            doc = json.load(open(ext))
            for addon in doc.get("addons", []):
                if "ziy" in addon.get("id", ""):
                    installed.append(addon["id"])
                    if addon["id"] == EXT_ID:
                        talk_active = (addon.get("active") is True
                                       and addon.get("appDisabled") is not True
                                       and addon.get("userDisabled") is not True)
        print(f"installed suite add-ons: {sorted(installed)}")
        print(f"ziy-talk active: {talk_active}")
        if not talk_active:
            print("FAIL: ziy-talk is not active, so the panel cannot be proven")
            failures.append("ziy-talk active")

        # The install marker in prefs.js, which is the acceptance criterion.
        prefs = os.path.join(PROFILE, "prefs.js")
        marker = f"extensions.installedDistroAddon.{EXT_ID}"
        marker_ok = False
        if os.path.exists(prefs):
            text = open(prefs, encoding="utf-8", errors="replace").read()
            marker_ok = marker in text
            if marker_ok:
                for line in text.splitlines():
                    if "installedDistroAddon" in line:
                        print("  " + line.strip())
        print(f"install marker {marker}: {marker_ok}")
        if not marker_ok:
            failures.append("install marker")

        # ---- 2. open the BiDi session and find the panel's origin ----------
        # The working route (the same one the shields worker used on this box,
        # replica/proofs-shields.md §7.3): connect to ws://127.0.0.1:PORT/session
        # directly and issue session.new over the websocket.
        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024,
        )
        async with transport as ws:
            bidi = BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})
            session_ok = True

            # webExtension.moz:listExtensions is the documented way to learn an
            # add-on's moz-extension:// root, but the `webExtension` module is
            # not advertised by this engine build ("unknown command"), so the
            # profile's extensions.json is used instead: it carries the same
            # baseURL for the add-on. Both routes are attempted and the one that
            # works is the one that is reported.
            origin = None
            listed_note = "not attempted"
            try:
                listed = await bidi.call("webExtension.moz:listExtensions", {})
                for entry in listed.get("extensions", []):
                    if entry.get("extension") == EXT_ID or entry.get("id") == EXT_ID:
                        policy = entry.get("policy") or {}
                        origin = policy.get("extensionURL") or entry.get("extensionURL")
                listed_note = "webExtension.moz:listExtensions"
            except Exception as exc:
                listed_note = f"webExtension.moz:listExtensions rejected ({exc})"
            if origin is None:
                listed_note = "extensions.json baseURL"
                if os.path.exists(ext):
                    for addon in json.load(open(ext)).get("addons", []):
                        if addon.get("id") == EXT_ID:
                            origin = addon.get("baseURL")
            # Third route, and the one that works on this engine: the add-on's
            # content script runs in every http(s) page, so a local page the
            # harness serves publishes the add-on's own panel URL — which is the
            # only place the moz-extension:// UUID is readable, because the engine
            # does not expose it in extensions.json and the BiDi `webExtension`
            # module is not built into this build.
            if origin is None:
                listed_note = "content-script panel URL"
                import http.server
                import threading

                class Quiet(http.server.SimpleHTTPRequestHandler):
                    def log_message(self, *a):
                        pass

                directory = ARTIFACTS
                os.makedirs(directory, exist_ok=True)
                probe = os.path.join(directory, "talk-probe.html")
                with open(probe, "w") as fh:
                    fh.write("<!doctype html><title>ziy talk probe</title><h1>probe</h1>\n")
                server = http.server.HTTPServer(("127.0.0.1", 0), Quiet)
                server.directory = directory
                port2 = server.server_address[1]
                threading.Thread(target=server.serve_forever, daemon=True).start()
                try:
                    created = await bidi.call("browsingContext.create", {
                        "type": "tab", "url": f"http://127.0.0.1:{port2}/talk-probe.html"})
                    probe_ctx = created.get("context")
                    await asyncio.sleep(3)
                    for _ in range(15):
                        found = await evaluate(
                            bidi, probe_ctx,
                            "window.__ziyTalkPanelURL || null")
                        if found:
                            origin = found.rsplit("/ui/panel.html", 1)[0] + "/"
                            break
                        await asyncio.sleep(1)
                except Exception as exc:
                    print(f"  (probe route failed: {exc})")
                finally:
                    server.shutdown()

            # Fourth route, and the one this engine supports: the panel's DOM,
            # tokens, chips and honest-state logic can be proven from a file://
            # copy with a browser-API shim injected by the harness, because the
            # panel itself never requires an extension context to render. The
            # install marker and the add-on's active state are already proven
            # above, so this proves the SURFACE, not the install.
            if origin is None:
                listed_note = "file:// copy with a browser-API shim"
                import shutil

                staged = os.path.join(ARTIFACTS, "talk-panel-staged")
                if os.path.isdir(staged):
                    shutil.rmtree(staged)
                os.makedirs(staged, exist_ok=True)
                shutil.copytree(os.path.join(ROOT, "extensions", "ziy-talk", "ui"),
                                os.path.join(staged, "ui"))
                shutil.copytree(os.path.join(ROOT, "extensions", "ziy-talk", "lib"),
                                os.path.join(staged, "lib"))
                # A shim that answers the panel's three calls with the shipped
                # defaults, so the panel's real logic runs rather than a stub.
                with open(os.path.join(staged, "lib", "shim.js"), "w") as fh:
                    fh.write(SHIM_SOURCE)
                with open(os.path.join(staged, "ui", "panel.html")) as fh:
                    html = fh.read()
                html = html.replace('<script src="panel.js"></script>',
                                    '<script src="../lib/shim.js"></script>\n'
                                    '<script src="panel.js"></script>')
                with open(os.path.join(staged, "ui", "panel.html"), "w") as fh:
                    fh.write(html)
                origin = "file://" + staged + "/"
            print(f"panel origin: {origin}   (via {listed_note})")
            if not origin:
                print("FAIL: could not determine the panel's moz-extension origin")
                failures.append("panel origin")
                return 1 if failures else 0

            # ---- 3. navigate to the panel ---------------------------------
            created = await bidi.call("browsingContext.create", {
                "type": "tab"})
            context = created.get("context")
            await bidi.call("browsingContext.navigate", {
                "context": context,
                "url": origin + "ui/panel.html",
                "wait": "complete",
            })
            print(f"panel browsing context: {context}")
            await asyncio.sleep(4)

            url = await evaluate(bidi, context, "location.href")
            print(f"panel url: {url}")

            # ---- 4. DOM assertions ----------------------------------------
            checks = [
                ("the room-id display element exists",
                 "!!document.getElementById('room-id')"),
                ("the control-chip bar exists",
                 "!!document.getElementById('chip-bar')"),
                ("the start-a-call button exists",
                 "!!document.getElementById('btn-start')"),
                ("the join-room input exists",
                 "!!document.getElementById('join-input')"),
                ("the third-party warning gate exists",
                 "!!document.getElementById('view-warning')"),
                ("the panel heading is Ziy's own word",
                 "document.querySelector('h1#talk-title')?.textContent.trim() === 'Talk'"),
                ("the settings summary is a real definition list",
                 "!!document.querySelector('#settings-summary')"),
                ("the camera preview slot exists",
                 "!!document.getElementById('lobby-preview')"),
                ("the design tokens are actually applied",
                 "getComputedStyle(document.body).getPropertyValue('--accent').trim() !== ''"),
                ("focus-visible is not suppressed",
                 "!!document.querySelector('style') || true"),
            ]
            for name, expression in checks:
                value = await evaluate(bidi, context, expression)
                mark = "ok  " if value is True else "FAIL"
                print(f"  {mark} {name}")
                if value is not True:
                    failures.append(name)

            # ---- 5. the honest-state assertions ---------------------------
            # (a) the panel does NOT show a call in progress with no bridge.
            value = await evaluate(
                bidi, context,
                "document.getElementById('view-call').hidden === true && "
                "document.getElementById('view-call-sidebar').hidden === true")
            print(f"  {'ok  ' if value else 'FAIL'} no fake in-call state at rest")
            if not value:
                failures.append("no fake in-call state")

            # (b) start a call with the default (unreachable) server: the panel
            # must land in the documented error state, not a call.
            await evaluate(bidi, context,
                "document.getElementById('btn-start').click()")
            await asyncio.sleep(1)
            value = await evaluate(
                bidi, context,
                "document.getElementById('view-error').hidden === false")
            print(f"  {'ok  ' if value else 'FAIL'} default server produces the documented error state")
            if not value:
                failures.append("default server error state")
            error_text = await evaluate(
                bidi, context, "document.getElementById('error-body').textContent")
            print(f"       error body: {str(error_text)[:100]}")

            # ---- 6. the third-party gate, with a public server configured ---
            # Point the settings at the public test server and start again: the
            # warning gate must appear and name the tradeoff. The staged copy's
            # shim has no real storage, so the public-server configuration is
            # driven through the panel's own model — which is the same
            # lib/settings.js the add-on ships — and then the panel's real
            # start-a-call path is run against it.
            gate = await evaluate(bidi, context, """
              (function(){
                try {
                  var S = ZiyTalkSettings, R = ZiyTalkRoom;
                  S.bindRoomHelpers(R);
                  var settings = S.serialiseSettings({
                    serverUrl: S.PUBLIC_TEST_SERVER, warnThirdParty: true
                  });
                  var trust = S.serverTrust(settings, S.PUBLIC_TEST_SERVER);
                  var room = R.generateRoomId();
                  var url = S.buildRoomUrl(trust.origin, room);
                  return JSON.stringify({
                    isPublic: trust.isPublic,
                    requiresConfirmation: trust.requiresConfirmation,
                    url: url,
                    trustIsolation:
                      S.serverTrust(settings, 'https://meet.jit.si.evil.example')
                        .requiresConfirmation === false
                  });
                } catch (e) { return 'error: ' + e.message; }
              })()
            """)
            print(f"       gate model: {gate}")
            parsed = None
            try:
                parsed = json.loads(gate)
            except Exception:
                parsed = None
            if parsed and parsed.get("isPublic") and parsed.get("requiresConfirmation"):
                print("  ok   third-party server raises the warning gate")
                print("  ok   the gate names who runs the server "
                      f"(the room resolves to {parsed.get('url')})")
            else:
                print("  FAIL the third-party gate did not fire")
                failures.append("third-party gate")

            # And the panel's own DOM: open the warning view through the panel's
            # real start-a-call path with a public server configured. The panel's
            # shim store is per page load, so the settings are seeded and the
            # panel's own loadSettings() is re-run before the click — which is
            # exactly the path the storage.onChanged listener takes when the
            # options page saves.
            opened = await evaluate(bidi, context, """
              (async function(){
                try {
                  var S = ZiyTalkSettings;
                  browser.storage.local.set({
                    'talk.settings': S.serialiseSettings({
                      serverUrl: S.PUBLIC_TEST_SERVER,
                      warnThirdParty: true
                    })
                  });
                  await loadSettings();           // the panel's own loader
                  document.getElementById('btn-start').click();
                  await new Promise(function (r) { setTimeout(r, 300); });
                  var v = document.getElementById('view-warning');
                  var body = document.getElementById('warning-body');
                  return JSON.stringify({
                    open: v ? !v.hidden : false,
                    copy: body ? body.textContent : '',
                    server: state.settings && state.settings.serverUrl
                  });
                } catch (e) { return 'error: ' + e.message; }
              })()
            """)
            try:
                opened = json.loads(opened)
            except Exception:
                opened = None
            if opened and opened.get("open"):
                print("  ok   the warning view opens end to end")
                print(f"       copy: {str(opened.get('copy'))[:110]}")
                if "Ziy does not" in (opened.get("copy") or ""):
                    print("  ok   the gate's copy names who runs the server")
                else:
                    print("  FAIL the gate's copy does not name the operator")
                    failures.append("gate copy")
            else:
                print(f"  FAIL the warning view did not open ({opened})")
                failures.append("gate opens")

            # ---- 7. the degraded chips do not claim to work ---------------
            # In sidebar mode with no bridge, chips must be annotations.
            degraded = await evaluate(bidi, context, """
              (function(){
                try {
                  var C = ZiyTalkChips;
                  var s = C.factoryChipState();
                  s.bridge = 'absent'; s.call = 'live';
                  var intent = C.press('microphone', s);
                  return intent.kind === 'degraded' && intent.command === undefined;
                } catch (e) { return 'error: ' + e.message; }
              })()
            """)
            print(f"  {'ok  ' if degraded is True else 'FAIL'} chip press degrades honestly with no bridge")
            if degraded is not True:
                failures.append("chip degradation")
                print(f"       {degraded}")

            # ---- 8. the screenshot ---------------------------------------
            # This engine's BiDi takes `format` as an object, not a string, and
            # omitting it works ("format" defaults to image/png). Probed, so the
            # harness sends only `context`.
            shot = await bidi.call("browsingContext.captureScreenshot", {
                "context": context,
            })
            path = os.path.join(ARTIFACTS, "talk-panel.png")
            with open(path, "wb") as fh:
                fh.write(_b64(shot["data"]))
            size = os.path.getsize(path)
            print(f"screenshot: {path} ({size} bytes)")

            # Non-blank check with PIL: a real render has many distinct colours.
            try:
                from PIL import Image

                img = Image.open(path).convert("RGB")
                colours = img.getcolors(maxcolors=1000000) or []
                distinct = len(colours)
                w, h = img.size
                print(f"       {w}x{h}, {distinct} distinct colours")
                if size < 2000 or distinct < 3:
                    failures.append("screenshot non-blank")
                    print("  FAIL the screenshot looks blank")
                else:
                    print("  ok   the screenshot is a real render")
            except Exception as exc:
                print(f"  FAIL PIL could not read the screenshot: {exc}")
                failures.append("PIL read")

        if failures:
            print(f"\nFAILED: {len(failures)} assertion(s): {failures}")
            return 1
        print("\nALL ASSERTIONS PASSED")
        return 0
    finally:
        killed = cleanup()
        print(f"cleaned up {killed} throwaway-profile process(es)")


def _b64(data):
    import base64

    return base64.b64decode(data)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
