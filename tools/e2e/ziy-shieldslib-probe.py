#!/usr/bin/env python3
"""Does the ziy-shields lib actually load as classic page scripts?

The boot log reported:
  SyntaxError: redeclaration of non-configurable global property parseList
  SyntaxError: redeclaration of non-configurable global property localGet
  ReferenceError: module is not defined
  TypeError: blocking.browserApi is not a function

If those happen in the shipped bundle the whole blocking engine is dead at
runtime and only the unit tests pass. This runs the SHIPPED lib files as
page scripts, exactly as the manifest lists them, and reports the first error.

Route: a file:// page over <profile>/extensions is not possible; the files are
loaded from the extracted xpi (byte-identical to the shipped one — verified
with diff -r) so the route is "staged file:// copy of the shipped lib".
"""
import asyncio
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "ziy_flow_harness",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "ziy-flow-harness.py"))
_fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fh)
BiDi = _fh.BiDi
cleanup = _fh.cleanup
wait_for_port = _fh.wait_for_port

PROFILE = "/tmp/ziy-flow-shieldslib-profile"
PORT = 9332
STAGED = "/tmp/xpi-extract"


async def ev(bidi, ctx, expression):
    r = await bidi.call("script.evaluate", {
        "expression": expression, "target": {"context": ctx},
        "awaitPromise": True, "returnByValue": True})
    return r.get("result", {}).get("value")


async def main():
    cleanup(PROFILE)
    os.makedirs(PROFILE, exist_ok=True)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        ["/home/zen/Documents/brave but not chrome or firefox/build/ziy/firefox",
         "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"launched pid {child.pid}")
    try:
        if not wait_for_port(PORT, 120) or not wait_for_port(2828, 120):
            print("FAIL no ports")
            return 1
        import websockets
        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024)
        async with transport as ws:
            bidi = BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})
            created = await bidi.call("browsingContext.create", {"type": "tab"})
            ctx = created.get("context")
            await bidi.call("browsingContext.navigate", {
                "context": ctx, "url": "file://" + STAGED + "/decl-test.html",
                "wait": "complete"})
            await asyncio.sleep(6)
            result = await ev(bidi, ctx, "JSON.stringify(window.__done || [])")
            print("script load results:")
            print(result)
            # Does the merged global exist and carry the API the background expects?
            merged = await ev(bidi, ctx, """
              (function () {
                var z = window.ziyShields;
                return JSON.stringify({
                  exists: !!z,
                  keys: z ? Object.keys(z).sort() : [],
                  hasParseList: !!(z && z.parseList),
                  hasLocalGet: !!(z && z.localGet),
                  hasBrowserApi: !!(z && z.browserApi),
                  hasResolve: !!(z && z.resolve),
                  hasTabCounter: !!(z && z.TabCounter),
                  hasBuildRules: !!(z && z.buildDnrRules),
                  hasGetRegistry: !!(z && z.getRegistry),
                  hasBuildForDomain: !!(z && z.buildForDomain)
                });
              })()
            """)
            print("\nmerged global:")
            print(json.dumps(json.loads(merged), indent=1))
            await bidi.close()
        return 0
    finally:
        print("\ncleanup: killed " + str(cleanup(PROFILE)) + " process(es)")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
