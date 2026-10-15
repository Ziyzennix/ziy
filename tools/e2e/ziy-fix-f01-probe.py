#!/usr/bin/env python3
"""F01, driven over WebDriver BiDi: does ziy-shell's onInstalled open the
welcome tab? The regression case greps the boot log for 'welcome.html', which a
headless boot with an about:blank start URL never prints, so this probe asks the
engine directly for the tab list.

Route: real add-on origin + engine page, one throwaway profile under /tmp/ziy-*.
Kills are anchored on that profile path by PID.
"""
import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("ziy_flow_harness", os.path.join(HERE, "ziy-flow-harness.py"))
_fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fh)

PROFILE = "/tmp/ziy-fix-f01-profile"
PORT = 9357
LOG = "/tmp/ziy-fix-f01.log"
SHELL_ID = "ziy-shell@ziy.app"


def kill_anchored(profile):
    out = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout
    pids = [p for p in out.split() if p.strip()]
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGTERM) if False else os.kill(int(pid), 9)
        except Exception:
            pass
    return len(pids)


async def main():
    import signal
    subprocess.run(["pgrep", "-f", PROFILE], capture_output=True, text=True)
    for line in subprocess.run(["pgrep", "-f", PROFILE], capture_output=True, text=True).stdout.split():
        try:
            os.kill(int(line), signal.SIGKILL)
        except Exception:
            pass
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [_fh.APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=open(LOG, "wb"), stderr=subprocess.STDOUT)
    print(f"launched pid {child.pid} profile {PROFILE}")
    try:
        if not _fh.wait_for_port(PORT, 120) or not _fh.wait_for_port(2828, 120):
            print("FAIL no ports"); return 1
        import websockets
        time.sleep(22)  # the app-scope installer needs time to place the suite
        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024)
        async with transport as ws:
            bidi = _fh.BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})
            tree = await bidi.call("browsingContext.getTree", {})
            urls = _fh.deep_urls(tree) if hasattr(_fh, "deep_urls") else _collect(tree)
            print(f"TABS AFTER FRESH BOOT: {urls}")
            welcome = [u for u in urls if "welcome.html" in u]
            addons = _fh.read_addons(PROFILE)
            shell = next((a for a in addons if a.get("id") == SHELL_ID), None)
            print(f"ziy-shell active: {bool(shell and shell.get('active'))}")
            print(f"welcome tab present: {bool(welcome)}")
            prefs = os.path.join(PROFILE, "prefs.js")
            if os.path.exists(prefs):
                text = open(prefs, encoding="utf-8", errors="replace").read()
                print(f"ziy.shell settings key in prefs: {'ziy.shell' in text}")
            errors = [l for l in open(LOG, encoding="utf-8", errors="replace").read().splitlines()
                      if "JavaScript error" in l]
            print(f"boot-log JavaScript errors: {len(errors)}")
            for e in errors:
                print("   ", e)
            ok = bool(welcome) and not errors
            print("\n" + ("F01 PASS — the welcome tab opened and the event page is alive"
                          if ok else "F01 FAIL"))
            return 0 if ok else 1
    finally:
        print("\ncleanup: killed " + str(kill_anchored(PROFILE)) + " process(es)")


def _collect(node):
    out = []
    if isinstance(node, dict):
        if "url" in node:
            out.append(node["url"])
        for v in node.values():
            out.extend(_collect(v))
    elif isinstance(node, list):
        for v in node:
            out.extend(_collect(v))
    return out


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
