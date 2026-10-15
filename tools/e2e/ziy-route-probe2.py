#!/usr/bin/env python3
"""Route probe #2 — can browsingContext.create reach the real NTP?

The first probe showed browsingContext.navigate refuses about:newtab and
moz-extension:// with "unsupported operation". This probe asks a different
question, because the answer changes which route the flow tests can honestly
claim:

  1. browsingContext.create WITH a url: about:newtab (the engine applies
     chrome_url_overrides.newtab itself, so the document served is the real
     ziy-ntp page at its own moz-extension origin)
  2. document.location assignment from a page already on the extension origin
  3. whether an already-open about:newtab tab exists in the tree at all
  4. what the NTP page itself reports about its origin and bundle
"""
import asyncio
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import websockets

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-flow-ntporigin-profile"
PORT = 9331
MARIONETTE_PORT = 2828


def cleanup():
    out = subprocess.run(["pgrep", "-f", PROFILE], capture_output=True, text=True).stdout
    pids = [p for p in out.split() if p.strip()]
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except Exception:
            pass
    time.sleep(0.8)
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGKILL)
        except Exception:
            pass
    return len(pids)


def wait_for_port(port, timeout=120):
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.4)
    return False


class Probe:
    def __init__(self, ws):
        self.ws = ws
        self._next = 0

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


async def ev(bidi, ctx, expression):
    r = await bidi.call("script.evaluate", {
        "expression": expression, "target": {"context": ctx},
        "awaitPromise": True, "returnByValue": True})
    return r.get("result", {}).get("value")


async def main():
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    cleanup()
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env,
        stdout=open("/tmp/ziy-flow-ntporigin.log", "wb"),
        stderr=subprocess.STDOUT)
    print(f"launched pid {child.pid} profile {PROFILE}")
    try:
        if not wait_for_port(PORT, 120) or not wait_for_port(MARIONETTE_PORT, 120):
            print("FAIL no ports")
            return 1
        time.sleep(20)
        ws = await websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024).__aenter__()
        bidi = Probe(ws)
        await bidi.call("session.new", {"capabilities": {}})

        print("\n-- 1. browsingContext.create with about:newtab --")
        try:
            created = await bidi.call("browsingContext.create",
                                      {"type": "tab", "url": "about:newtab"})
            ctx = created.get("context")
            print(f"created: {json.dumps(created)}")
            await asyncio.sleep(5)
            print("url:  ", await ev(bidi, ctx, "location.href"))
            print("origin:", await ev(bidi, ctx, "location.origin"))
            print("title:", await ev(bidi, ctx, "document.title"))
            print("bundle:", await ev(bidi, ctx, "JSON.stringify({"
                  "page: !!window.ZiyNtpPage, model: !!window.ZiyNtpModel,"
                  "storage: !!window.ZiyNtpStorage})"))
        except Exception as exc:
            print(f"  refused: {exc}")

        print("\n-- 2. browsingContext.getTree (what tabs exist) --")
        try:
            tree = await bidi.call("browsingContext.getTree", {})
            for entry in tree.get("contexts", []):
                print(f"  {entry.get('context')}  url={entry.get('url')!r} "
                      f"children={len(entry.get('children', []))}")
                for kid in entry.get("children", []):
                    print(f"    child {kid.get('context')} url={kid.get('url')!r}")
        except Exception as exc:
            print(f"  refused: {exc}")

        print("\n-- 3. tabs query via browsingContext on the about:blank tab --")
        try:
            created = await bidi.call("browsingContext.create",
                                      {"type": "tab", "url": "about:blank"})
            ctx2 = created.get("context")
            await asyncio.sleep(1)
            # ask the page to navigate itself
            res = await ev(bidi, ctx2, """
              (function () {
                try { location.href = 'about:newtab'; return 'assigned'; }
                catch (e) { return 'threw ' + e; }
              })()
            """)
            print("  location assignment:", res)
            await asyncio.sleep(5)
            print("  url now:", await ev(bidi, ctx2, "location.href"))
        except Exception as exc:
            print(f"  refused: {exc}")

        print("\n-- 4. file:// page that opens the extension origin in an iframe --")
        try:
            created = await bidi.call("browsingContext.create", {"type": "tab"})
            ctx3 = created.get("context")
            import re
            prefs = open(os.path.join(PROFILE, "prefs.js"), encoding="utf-8",
                         errors="replace").read()
            m = re.search(r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)', prefs)
            mapping = json.loads(m.group(1).replace('\\"', '"').replace("\\\\", "\\"))
            ntp = mapping.get("ziy-ntp@ziy.app")
            shields = mapping.get("ziy-shields@ziy.app")
            news = mapping.get("ziy-news@ziy.app")
            print(f"  ntp uuid {ntp}")
            print(f"  shields uuid {shields}")
            print(f"  news uuid {news}")
            html = ("<!doctype html><title>frame</title>"
                    "<iframe id='f' src='moz-extension://%s/ui/ntp.html'></iframe>" % ntp)
            path = "/tmp/ziy-flow-frame-page.html"
            open(path, "w").write(html)
            await bidi.call("browsingContext.navigate",
                            {"context": ctx3, "url": "file://" + path, "wait": "complete"})
            await asyncio.sleep(6)
            print("  iframe loaded:", await ev(bidi, ctx3,
                  "(function(){var f=document.getElementById('f');"
                  "try{return !!f.contentDocument && f.contentDocument.URL}"
                  "catch(e){return 'blocked: '+e}})()"))
        except Exception as exc:
            print(f"  refused: {exc}")

        await bidi.close()
        return 0
    finally:
        print("\ncleanup: killed " + str(cleanup()) + " process(es)")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
