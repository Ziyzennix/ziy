#!/usr/bin/env python3
"""Ziy e2e route probe — which routes this engine actually allows.

One browser, one throwaway profile /tmp/ziy-route-probe-profile. Reports,
for each route, whether a real page load happened and what URL it ended up
at. Routes probed:

  1. plain BiDi session + browsingContext.navigate to about:newtab
  2. BiDi navigate to the NTP add-on's own moz-extension:// URL
  3. BiDi navigate to file:// copy (baseline sanity)
  4. the shields popup URL
  5. session.subscribe to network / script events

Kill hygiene: anchored pattern /tmp/ziy-route-probe-profile only.
"""
import asyncio
import json
import os
import subprocess
import sys
import time

import websockets

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-route-probe-profile"
PORT = 9330
MARIONETTE_PORT = 2828


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


def wait_for_port(port, timeout=90):
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
        self._next += 1
        msg_id = self._next
        await self.ws.send(json.dumps({"id": msg_id, "method": method,
                                       "params": params or {}}))
        while True:
            raw = await self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def close(self):
        try:
            await self.ws.close()
        except Exception:
            pass


async def evaluate(bidi, context, expression):
    result = await bidi.call("script.evaluate", {
        "expression": expression,
        "target": {"context": context},
        "awaitPromise": True, "returnByValue": True,
    })
    return result.get("result", {}).get("value")


def read_addons(profile):
    path = os.path.join(profile, "extensions.json")
    if not os.path.exists(path):
        return []
    try:
        return json.load(open(path)).get("addons", [])
    except Exception:
        return []


def find_url(profile, want_id):
    import re
    prefs = os.path.join(profile, "prefs.js")
    if os.path.exists(prefs):
        text = open(prefs, encoding="utf-8", errors="replace").read()
        m = re.search(r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)', text)
        if m:
            raw = m.group(1).replace('\\"', '"').replace("\\\\", "\\")
            try:
                mapping = json.loads(raw)
                v = mapping.get(want_id)
                if isinstance(v, str) and v:
                    return f"moz-extension://{v}"
            except Exception:
                pass
    for addon in read_addons(profile):
        if addon.get("id") == want_id:
            for key in ("baseURL", "internalURL", "url"):
                v = addon.get(key)
                if isinstance(v, str) and v.startswith("moz-extension://"):
                    return v.rstrip("/")
            root = addon.get("rootURI", "")
            m = re.search(r"([0-9a-fA-F-]{36})", root or "")
            if m:
                return f"moz-extension://{m.group(1)}"
    return None


async def try_navigate(bidi, context, url, wait=3):
    try:
        result = await bidi.call("browsingContext.navigate",
                                  {"context": context, "url": url, "wait": "complete"})
        await asyncio.sleep(wait)
        actual = await evaluate(bidi, context, "location.href")
        title = await evaluate(bidi, context, "document.title")
        return {"url": url, "ok": True, "result_url": result.get("url"),
                "actual_url": actual, "title": title}
    except Exception as exc:
        return {"url": url, "ok": False, "error": str(exc)}


async def main():
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    cleanup()
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=open("/tmp/ziy-route-probe.log", "wb"), stderr=subprocess.STDOUT)
    print(f"launched pid {child.pid} (throwaway profile {PROFILE})")
    try:
        if not wait_for_port(PORT, 90) or not wait_for_port(MARIONETTE_PORT, 90):
            print("FAIL: no ports")
            return 1
        print("ports up")
        time.sleep(20)
        addons = sorted(a.get("id") for a in read_addons(PROFILE) if "ziy" in str(a.get("id")))
        print(f"installed suite add-ons: {addons}")

        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024)
        async with transport as ws:
            bidi = BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})

            # what does the session advertise?
            ntp_url = find_url(PROFILE, "ziy-ntp@ziy.app")
            shields_url = find_url(PROFILE, "ziy-shields@ziy.app")
            desktop_url = find_url(PROFILE, "ziy-desktop@ziy.app")
            news_url = find_url(PROFILE, "ziy-news@ziy.app")
            print(f"ntp origin: {ntp_url}")
            print(f"shields origin: {shields_url}")
            print(f"desktop origin: {desktop_url}")
            print(f"news origin: {news_url}")

            async def attempt(label, url):
                created = await bidi.call("browsingContext.create", {"type": "tab"})
                ctx = created.get("context")
                out = await try_navigate(bidi, ctx, url)
                print(f"\n[{label}] {url}")
                print(f"  {json.dumps(out)}")
                return out

            await attempt("about:newtab", "about:newtab")
            await attempt("ntp extension page", (ntp_url or "moz-extension://x") + "/ui/ntp.html")
            await attempt("shields popup", (shields_url or "moz-extension://x") + "/ui/popup.html")
            await attempt("desktop popup", (desktop_url or "moz-extension://x") + "/ui/popup.html")
            await attempt("news options", (news_url or "moz-extension://x") + "/ui/options.html")
            await attempt("file baseline", "file:///tmp/ziy-route-probe-baseline.html")
            await attempt("about:addons", "about:addons")

            # webExtension module probe
            try:
                listed = await bidi.call("webExtension.moz:listExtensions", {})
                print(f"\nwebExtension.moz:listExtensions: {json.dumps(listed)[:300]}")
            except Exception as exc:
                print(f"\nwebExtension.moz:listExtensions refused: {exc}")

            await bidi.close()
        return 0
    finally:
        print("\ncleanup: killed " + str(cleanup()) + " process(es)")


if __name__ == "__main__":
    open("/tmp/ziy-route-probe-baseline.html", "w").write(
        "<!doctype html><title>baseline</title><h1>baseline</h1>")
    sys.exit(asyncio.run(main()))
