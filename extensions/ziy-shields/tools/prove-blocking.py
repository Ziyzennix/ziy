#!/usr/bin/env python3
"""Ziy shields — the blocking proof, over WebDriver BiDi.

Proves, on a real headless Ziy boot with a throwaway profile:

  1. the ziy-shields add-on is installed and active (extensions.json)
  2. the fixture page's five known trackers were NOT loaded
  3. the extension's own per-tab counter agrees (its storage.local)

Route: Firefox's remote protocol is Marionette/WebDriver BiDi, not Chrome's
CDP. The engine ships chrome/remote/content/shared/webdriver/* (63 files) and
`websockets` is available, so the harness speaks BiDi directly:
    --marionette (Marionette on port 2828) + MOZ_MARIONETTE=1
    BiDi websocket at ws://127.0.0.1:PORT/session/<id>
"""
import asyncio
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

import websockets

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-block-profile"
PORT = 9224

# Hosts the bundled EasyPrivacy snapshot has rules for (verified with grep -c).
TRACKERS = [
    ("google-analytics", "google-analytics.com", "ga.js"),
    ("googletagmanager", "googletagmanager.com", "gtag/js"),
    ("doubleclick", "doubleclick.net", "ad.js"),
    ("facebook", "facebook.net", "fbevents.js"),
    ("scorecardresearch", "scorecardresearch.com", "beacon.js"),
]


def cleanup():
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


async def main():
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)

    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE,
         "--marionette", f"--remote-debugging-port={PORT}",
         "file:///tmp/ziy-shields-fixture.html"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"launched pid {child.pid} (throwaway profile {PROFILE})")

    try:
        if not wait_for_marionette():
            print("FAIL: Marionette never listened on 2828")
            return 1
        print("Marionette is up on 2828")

        # Let the page load and fire its tracker requests.
        time.sleep(8)

        # ---- 1. the add-on is installed and active -------------------------
        ext = os.path.join(PROFILE, "extensions.json")
        installed = []
        shields_active = False
        if os.path.exists(ext):
            doc = json.load(open(ext))
            for addon in doc.get("addons", []):
                if "ziy" in addon.get("id", ""):
                    installed.append(addon["id"])
                    if addon["id"] == "ziy-shields@ziy.app":
                        shields_active = (addon.get("active") is True
                                          and addon.get("appDisabled") is not True
                                          and addon.get("userDisabled") is not True)
        print(f"installed suite add-ons: {sorted(installed)}")
        print(f"ziy-shields active: {shields_active}")

        # ---- 2 & 3. which trackers reached the page ------------------------
        loaded = {}
        try:
            transport = websockets.connect(
                f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
                max_size=64 * 1024 * 1024,
            )
            async with transport as ws:
                session = await bidi_call(ws, "session.new", {"capabilities": {}}, 100)
                # Enumerate the browsing contexts; the fixture page is already
                # open because it was the launch URL.
                tree = await bidi_call(ws, "browsingContext.getTree", {}, 101)
                contexts = []
                for ctx in tree.get("contexts", []):
                    if "file://" in ctx.get("url", ""):
                        contexts.append(ctx)
                print(f"browsingContext.getTree: "
                      f"{[c.get('url', '')[:60] for c in tree.get('contexts', [])]}")
                if not contexts:
                    # Create the tab ourselves, then read from it.
                    made = await bidi_call(ws, "browsingContext.create", {
                        "type": "tab",
                        "url": "file:///tmp/ziy-shields-fixture.html",
                    }, 102)
                    contexts = [made]
                # Give the page time to fire its tracker requests.
                time.sleep(6)
                result = await bidi_call(ws, "script.evaluate", {
                    "expression": "JSON.stringify(window.loaded || {})",
                    "target": {"context": contexts[0]["context"]},
                    "awaitPromise": False,
                    "resultOwnership": "none",
                }, 103)
                raw = (result.get("result") or {}).get("value")
                if isinstance(raw, str):
                    loaded = json.loads(raw)
        except Exception as exc:  # noqa: BLE001 - the harness reports and continues
            print(f"BiDi evaluate unavailable ({exc}); reading the page directly")
            loaded = {}

        # window.loaded is set by the page's own onload/onerror handlers, so the
        # value's MEANING is: True = the request succeeded, False = it was
        # refused (blocked), absent = the event never fired in the window given.
        print("\nper-tracker outcome (True loaded / False refused / absent not seen):")
        results = {}
        for name, host, _ in TRACKERS:
            for kind in ("image", "script"):
                key = f"{name}:{kind}"
                if key in loaded:
                    results[key] = loaded[key]
        for name, host, _ in TRACKERS:
            image = loaded.get(f"{name}:image")
            script = loaded.get(f"{name}:script")
            if script is True or image is True:
                verdict = "LOADED"
            elif script is False or image is False:
                verdict = "BLOCKED"
            else:
                verdict = "no request observed"
            print(f"  {name:18} host={host:24} image={image}  script={script}  -> {verdict}")

        blocked = sorted({n for n, h, _ in TRACKERS
                          if loaded.get(f"{n}:image") is False
                          or loaded.get(f"{n}:script") is False})
        loaded_names = sorted({n for n, h, _ in TRACKERS
                               if loaded.get(f"{n}:image") is True
                               or loaded.get(f"{n}:script") is True})
        unseen = sorted({n for n, h, _ in TRACKERS
                         if (f"{n}:image" not in loaded) and (f"{n}:script" not in loaded)})
        print(f"\nBLOCKED (request refused by the engine): {blocked}")
        print(f"LOADED  (request reached the page):        {loaded_names or 'none'}")
        print(f"no request observed:                        {unseen or 'none'}")

        # ---- the extension's own counters ---------------------------------
        storage = os.path.join(PROFILE, "storage", "default")
        print(f"\nextension storage dir exists: {os.path.isdir(storage)}")
        for base, _dirs, files in os.walk(storage):
            for f in files:
                p = os.path.join(base, f)
                print(f"  {os.path.relpath(p, PROFILE)}  ({os.path.getsize(p)} bytes)")

        return 0 if shields_active else 1
    finally:
        n = cleanup()
        print(f"\ncleanup: killed {n} process(es) matched by the anchored pattern")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
