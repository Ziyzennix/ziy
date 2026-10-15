#!/usr/bin/env python3
"""Can the add-on's own page be reached from a file:// page in an IFRAME?

BiDi refuses to navigate to moz-extension://, and browsingContext.create with a
url lands on about:blank. This probe tries the last remaining route: a file://
page that embeds the add-on's own ui/debug.html in an iframe. If the frame
loads, the add-on's own JS runs at its real origin with a real browser.browser
global, and the ops can be driven from inside it - which is the honest "real
add-on origin" route for the shields flows.
"""
import asyncio
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("ziy_flow_harness", os.path.join(HERE, "ziy-flow-harness.py"))
_fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fh)

PROFILE = "/tmp/ziy-fix-iframe-profile"
PORT = 9361
LOG = "/tmp/ziy-fix-iframe.log"
SHIELDS_ID = "ziy-shields@ziy.app"


def kill(profile):
    pids = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout.split()
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGKILL)
        except Exception:
            pass
    return len(pids)


def shields_uuid(profile):
    path = os.path.join(profile, "prefs.js")
    if not os.path.exists(path):
        return None
    text = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)', text)
    if not m:
        return None
    value = json.loads(m.group(1).replace('\\"', '"').replace("\\\\", "\\"))
    return value.get(SHIELDS_ID)


async def main():
    kill(PROFILE)
    os.makedirs(PROFILE, exist_ok=True)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [_fh.APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=open(LOG, "wb"), stderr=subprocess.STDOUT)
    print("launched pid %s profile %s" % (child.pid, PROFILE))
    try:
        if not _fh.wait_for_port(PORT, 120) or not _fh.wait_for_port(2828, 120):
            print("FAIL no ports"); return 1
        time.sleep(24)
        uuid = shields_uuid(PROFILE)
        print("shields uuid:", uuid)
        if not uuid:
            print("FAIL no uuid"); return 1

        page = "/tmp/ziy-fix-iframe-page.html"
        with open(page, "w", encoding="utf-8") as fh:
            fh.write("<!doctype html><title>frame probe</title>"
                     "<iframe id='f' style='width:1200px;height:800px' "
                     "src='moz-extension://%s/ui/debug.html'></iframe>" % uuid)

        import websockets
        transport = websockets.connect(
            "ws://127.0.0.1:%d/session" % PORT, subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024)
        async with transport as ws:
            bidi = _fh.BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})
            ctx = (await bidi.call("browsingContext.create", {"type": "tab"})).get("context")
            await bidi.call("browsingContext.navigate",
                            {"context": ctx, "url": "file://" + page, "wait": "complete"})
            await asyncio.sleep(8)
            tree = await bidi.call("browsingContext.getTree", {})
            print("\ncontext tree after the iframe loads:")
            print(json.dumps(tree, indent=1)[:1500])
            # Find the child context (the iframe), and evaluate inside it.
            children = []

            def walk(node):
                # getTree returns {"contexts": [...]} as well as nested
                # "children" arrays, so every dict value and list element is
                # visited, not just the "children" key.
                if isinstance(node, dict):
                    if node.get("url") and node.get("context"):
                        children.append(node)
                    for v in node.values():
                        if isinstance(v, (dict, list)):
                            walk(v)
                elif isinstance(node, list):
                    for v in node:
                        walk(v)
            walk(tree)
            print("\ncontexts found:", [(c.get("url"), c.get("context")) for c in children])
            for c in children:
                print("child url:", c.get("url"), "id:", c.get("context"))
            if children:
                child_ctx = children[-1]["context"]
                res = await _fh.evaluate(bidi, child_ctx, """
                  (function () {
                    var api = (globalThis.browser || globalThis.chrome);
                    return JSON.stringify({url: location.href, hasApi: !!api,
                      domain: document.getElementById('ziy-domain-text') && document.getElementById('ziy-domain-text').textContent,
                      count: document.getElementById('ziy-count__n') && document.getElementById('ziy-count__n').textContent});
                  })()
                """)
                print("iframe (child context) result:", res)
            try:
                d = json.loads(res)
                print("\nIFRAME ROUTE WORKS" if d.get("hasApi") else "\niframe loaded but no API")
            except Exception:
                pass
            await bidi.close()
        return 0
    finally:
        print("\ncleanup: killed %d process(es)" % kill(PROFILE))


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
