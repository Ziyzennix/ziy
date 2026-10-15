#!/usr/bin/env python3
"""Is the ziy-shields engine actually running in the real boot?

The boot log reports, on every fresh profile:

  SyntaxError: redeclaration of non-configurable global property parseList
  SyntaxError: redeclaration of non-configurable global property localGet
  ReferenceError: module is not defined
  TypeError: blocking.browserApi is not a function

If the event page's own script list cannot even finish evaluating, the DNR
tiers are never installed, `shields.state` never answers, and every shields
flow is dead regardless of how good the lib is. The static ruleset still
blocks (the engine installs it from the manifest), which is exactly how this
would hide: blocking "works", the panel is dead.

This probe measures it on the real bundle, with the real profile, no staging:

  1. the boot log's own JS errors for this add-on
  2. extensions.json active state
  3. shields.installState (static / dynamic / session / webRequest rule counts)
  4. `shields.state` for a real tab (does the panel's data source answer?)
  5. `shields.tabCounts` (the per-tab counter, the F02 evidence)
  6. the DNR rule counts the engine actually holds, from inside the page
  7. blocking behaviour on a fixture page, so the lib diagnosis is separated
     from "does the engine stop trackers"

Route: real add-on origin — the add-on's own lib and background are driven over
its own message bus from a file:// probe page that sends runtime.sendMessage
to ziy-shields@ziy.app. The panel is NOT loaded this way; only the background.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "ziy_flow_harness", os.path.join(HERE, "ziy-flow-harness.py"))
_fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fh)

PROFILE = "/tmp/ziy-flow-shieldsrt-profile"
PORT = 9334
LOG = "/tmp/ziy-shieldsrt.log"
SHIELDS_ID = "ziy-shields@ziy.app"
ARTIFACTS = os.path.join(_fh.ROOT, "build", "verify")

# The five trackers replica/proofs-shields.md §7.3 proved blocked, reused
# verbatim so this probe is comparable with that proof rather than a new one.
FIXTURE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ziy shields fixture</title></head><body>
<h1>Ziy shields flow fixture</h1>
<img src="https://google-analytics.com/ga.js" alt="">
<script src="https://googletagmanager.com/gtag/js"></script>
<script src="https://doubleclick.net/ad.js"></script>
<script src="https://facebook.net/fbevents.js"></script>
<img src="https://scorecardresearch.com/beacon.js" alt="">
<script>
window.loaded = {};
['ga.js','gtag/js','ad.js','fbevents.js','beacon.js'].forEach(function (n) { window.loaded[n] = null; });
document.querySelectorAll('img,script').forEach(function (el) {
  var name = (el.getAttribute('src') || '').split('/').pop();
  el.addEventListener('load', function () { window.loaded[name] = true; });
  el.addEventListener('error', function () { window.loaded[name] = false; });
});
</script></body></html>"""


def kill_anchored(profile):
    out = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout
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


async def ev(bidi, ctx, expression):
    return await _fh.evaluate(bidi, ctx, expression)


async def shields_message(bidi, ctx, op, body=None):
    return await ev(bidi, ctx, """
      (async () => {
        try {
          var reply = await (globalThis.browser || globalThis.chrome)
            .runtime.sendMessage(%s, { op: %s, body: %s });
          return JSON.stringify(reply);
        } catch (e) { return JSON.stringify({ __error: String(e) }); }
      })()
    """ % (json.dumps(SHIELDS_ID), json.dumps(op), json.dumps(body or {})))


async def main():
    kill_anchored(PROFILE)
    os.makedirs(PROFILE, exist_ok=True)
    os.makedirs(ARTIFACTS, exist_ok=True)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1",
               MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [_fh.APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=open(LOG, "wb"), stderr=subprocess.STDOUT)
    print(f"launched pid {child.pid}  profile {PROFILE}")
    report = _fh.Report()
    try:
        if not _fh.wait_for_port(PORT, 120) or not _fh.wait_for_port(2828, 120):
            report.check("the browser opened its debugging ports", False)
            return 1
        time.sleep(20)

        report.head("F02/F03/F04/F05/F06/F07 — shields runtime, real add-on origin")

        # ---- 1. what the boot log says about this add-on -------------------
        log = open(LOG, encoding="utf-8", errors="replace").read()
        errors = [l for l in log.splitlines()
                  if "JavaScript error" in l and "ziy-shields" not in l]
        shield_errors = [l.split("JavaScript error: ", 1)[1] for l in log.splitlines()
                         if "JavaScript error" in l]
        report.head("boot-log errors (every add-on, unfiltered)")
        for line in shield_errors:
            report.note(line)
        lib_errors = [l for l in shield_errors if "redeclaration" in l or "module" in l
                      or "browserApi" in l]
        report.check("the shields lib loads without a syntax error",
                     not any("redeclaration" in l for l in shield_errors),
                     f"{len([l for l in shield_errors if 'redeclaration' in l])} redeclaration errors")
        report.check("the shields background page finishes evaluating",
                     not any("browserApi is not a function" in l for l in shield_errors),
                     "blocking.browserApi is not a function"
                     if any("browserApi is not a function" in l for l in shield_errors) else "")

        # ---- 2. add-on active ---------------------------------------------
        addons = _fh.read_addons(PROFILE)
        shields = next((a for a in addons if a.get("id") == SHIELDS_ID), None)
        report.check("ziy-shields is installed and active",
                     bool(shields and shields.get("active")
                          and shields.get("appDisabled") is not True
                          and shields.get("userDisabled") is not True),
                     f"active={shields.get('active') if shields else None}")

        # ---- 3. the DNR tiers ---------------------------------------------
        # Ask the add-on over its own bus from a page on a real origin.
        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024)
        async with transport as ws:
            bidi = _fh.BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})

            # A file:// probe that sends into the add-on's background page.
            probe = os.path.join(ARTIFACTS, "shields-runtime-probe.html")
            with open(probe, "w", encoding="utf-8") as fh:
                fh.write("<!doctype html><title>shields runtime probe</title>"
                         "<h1>shields runtime probe</h1>")
            created = await bidi.call("browsingContext.create", {"type": "tab"})
            ctx = created.get("context")
            await bidi.call("browsingContext.navigate",
                            {"context": ctx, "url": "file://" + probe, "wait": "complete"})
            await asyncio.sleep(2)

            report.head("the add-on's own message bus, driven from a real page")
            state_reply = await shields_message(bidi, ctx, "shields.state", {"body": {}})
            try:
                state = json.loads(state_reply) if state_reply else None
            except Exception:
                state = None
            report.note(f"shields.state -> {str(state_reply)[:220]}")
            report.check("shields.state answers (the panel's data source is alive)",
                         bool(state and state.get("ok") is True),
                         str(state)[:160] if state else "no reply")

            if state and state.get("ok"):
                st = state.get("state") or {}
                report.note(f"  domain={st.get('domain')!r} rule={json.dumps(st.get('rule'))[:200]}")
                report.note(f"  layers={json.dumps(st.get('layers'))[:160]}")
                report.note(f"  counts={json.dumps(st.get('counts'))[:120]}")
                report.note(f"  installState={json.dumps(st.get('installState'))}")
                report.note(f"  lists={(st.get('lists') or {}).keys() if isinstance(st.get('lists'), dict) else st.get('lists')}")

            install_reply = await shields_message(bidi, ctx, "shields.installState")
            report.note(f"shields.installState -> {install_reply}")
            try:
                inst = json.loads(install_reply or "{}").get("state") or {}
            except Exception:
                inst = {}
            report.check("the static DNR tier reports rules",
                         (inst.get("static") or 0) > 0,
                         f"static={inst.get('static')}")
            report.check("the dynamic DNR tier is installed",
                         (inst.get("dynamic") or 0) > 0,
                         f"dynamic={inst.get('dynamic')}")
            report.check("the webRequest residual tier is installed",
                         (inst.get("webRequest") or 0) > 0,
                         f"webRequest={inst.get('webRequest')}")

            # ---- 4. the filter-list registry (F06) -------------------------
            lists_reply = await shields_message(bidi, ctx, "shields.lists")
            report.note(f"shields.lists -> {str(lists_reply)[:300]}")
            try:
                registry = json.loads(lists_reply or "{}").get("registry") or {}
            except Exception:
                registry = {}
            report.check("the filter-list registry answers with the shipped lists",
                         len(registry) >= 3,
                         f"{len(registry)} lists: {sorted(registry)[:5]}")
            for name in sorted(registry)[:4]:
                rec = registry[name]
                report.note(f"  {name}: rules={rec.get('ruleCount')} "
                            f"enabled={rec.get('enabled')} custom={rec.get('isCustom')}")

            # ---- 5. blocking on a real fixture page ------------------------
            report.head("blocking on the fixture page (real page, real requests)")
            fixture = os.path.join(ARTIFACTS, "shields-flow-fixture.html")
            with open(fixture, "w", encoding="utf-8") as fh:
                fh.write(FIXTURE)
            created2 = await bidi.call("browsingContext.create", {"type": "tab"})
            page_ctx = created2.get("context")
            await bidi.call("browsingContext.navigate", {
                "context": page_ctx, "url": "file://" + fixture, "wait": "complete"})
            await asyncio.sleep(6)
            loaded = await ev(bidi, page_ctx, "JSON.stringify(window.loaded || {})")
            report.note(f"per-tracker outcome: {loaded}")

            tab_ctx = page_ctx
            counts_reply = await shields_message(bidi, ctx, "shields.tabCounts", {})
            report.note(f"shields.tabCounts (probe tab) -> {str(counts_reply)[:200]}")

            # ---- 6. the per-tab counter, asked through the real API --------
            # The panel asks shields.state with the tab id; the counter lives
            # per tab in the event page, so ask through the page context.
            tab_counts = await ev(bidi, page_ctx, """
              (async () => {
                try {
                  var reply = await (globalThis.browser || globalThis.chrome)
                    .runtime.sendMessage(%s, { op: 'shields.tabCounts', body: {} });
                  return JSON.stringify(reply);
                } catch (e) { return JSON.stringify({ __error: String(e) }); }
              })()
            """ % json.dumps(SHIELDS_ID))
            report.note(f"shields.tabCounts (fixture tab) -> {str(tab_counts)[:240]}")

            await bidi.close()

        # ---- 7. the storage store: per-site overrides ----------------------
        report.head("the profile's shields stores (per-site overrides land where)")
        stores = _fh.read_storage_values(PROFILE)
        for rel, doc in stores.items():
            keys = sorted(doc) if isinstance(doc, dict) else ["<non-object>"]
            report.note(f"{rel}: {keys[:12]}")
        shields_store = [rel for rel, doc in stores.items()
                         if isinstance(doc, dict) and "shields.global" in doc]
        report.check("the shields global rule is persisted in the profile",
                     bool(shields_store), f"{shields_store[:2]}")

        return 0
    finally:
        print()
        print("\n".join(report.lines))
        print("\nFAILURES: " + (", ".join(report.failures) if report.failures else "none"))
        print("\ncleanup: killed " + str(kill_anchored(PROFILE)) + " process(es)")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
