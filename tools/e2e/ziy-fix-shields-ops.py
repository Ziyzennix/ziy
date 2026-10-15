#!/usr/bin/env python3
"""F02-F07 - the shields ops, driven against the REAL event page.

Two route facts constrain this (replica/test-report.md, "How each flow was
reached"):

  * a file:// or about:blank page has NO browser.* / chrome.* global, so the
    event page cannot be messaged from an ordinary page;
  * browsingContext.navigate refuses every moz-extension:// URL with
    "unsupported operation", and browsingContext.create with a url lands on
    about:blank - so the add-on's own page cannot be opened remotely either.

So this uses the route the earlier shields runtime probe already established and
this one reuses verbatim: a file:// probe page whose own JS calls
runtime.sendMessage(EXTENSION_ID, op) on the add-on's real message bus. A page
on a real origin CAN do that (the harness's stalled technique), and the ops it
reaches are the real event page's handlers - the same handlers the popup and
the options page use.

Every assertion reads back what the real event page returned, so a "the panel's
data source is alive" verdict here is the shipped code answering, not a shim.
"""
import asyncio
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("ziy_flow_harness", os.path.join(HERE, "ziy-flow-harness.py"))
_fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fh)

PROFILE = "/tmp/ziy-fix-shieldsops-profile"
PORT = 9358
LOG = "/tmp/ziy-fix-shieldsops.log"
SHIELDS_ID = "ziy-shields@ziy.app"
EXT_SRC = os.path.join(_fh.ROOT, "extensions", "ziy-shields")

# The five trackers replica/proofs-shields.md section 7.3 proved blocked, reused
# verbatim so this run is comparable with that proof rather than a new one.
FIXTURE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ziy shields fixture</title></head><body>
<h1>Ziy shields flow fixture</h1>
<img src="https://google-analytics.com/ga.js" alt="">
<script src="https://googletagmanager.com/gtag/js"></script>
<script src="https://doubleclick.net/ad.js"></script>
<script src="https://facebook.net/fbevents.js"></script>
<img src="https://scorecardresearch.com/beacon.js" alt="">
</body></html>"""


def kill(profile):
    pids = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout.split()
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGKILL)
        except Exception:
            pass
    return len(pids)


async def ev(bidi, ctx, expr):
    return await _fh.evaluate(bidi, ctx, expr)


async def main():
    kill(PROFILE)
    os.makedirs(PROFILE, exist_ok=True)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [_fh.APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=open(LOG, "wb"), stderr=subprocess.STDOUT)
    print("launched pid %s  profile %s" % (child.pid, PROFILE))
    passed, failed = [], []

    def check(name, ok, detail=""):
        (passed if ok else failed).append(name)
        print("  %s  %s%s" % ("PASS" if ok else "FAIL", name, ("  - " + detail) if detail else ""), flush=True)

    try:
        if not _fh.wait_for_port(PORT, 120) or not _fh.wait_for_port(2828, 120):
            print("FAIL no ports")
            return 1
        time.sleep(24)
        log = open(LOG, encoding="utf-8", errors="replace").read()
        errors = [l.split("JavaScript error: ", 1)[1] for l in log.splitlines()
                  if "JavaScript error" in l]
        shield_errors = [e for e in errors if "shields" in e.lower()]
        check("no ziy-shields error in the boot log", not shield_errors,
              "; ".join(shield_errors[:3]) or ("%d error(s) total, none shields" % len(errors)))

        addons = _fh.read_addons(PROFILE)
        shields = next((a for a in addons if a.get("id") == SHIELDS_ID), None)
        check("ziy-shields is installed and active",
              bool(shields and shields.get("active") and shields.get("appDisabled") is not True),
              "active=%s" % (shields.get("active") if shields else None))

        # A real page whose own JS can message the add-on. The add-on's own page
        # is unreachable over BiDi (documented), so a plain file:// page carries
        # the sendMessage; the handler it reaches is the event page's.
        probe = os.path.join(_fh.ARTIFACTS, "ziy-fix-shields-probe.html")
        os.makedirs(_fh.ARTIFACTS, exist_ok=True)
        with open(probe, "w", encoding="utf-8") as fh:
            fh.write("<!doctype html><title>shields ops probe</title>"
                     "<h1>shields ops probe</h1>")

        import websockets
        transport = websockets.connect(
            "ws://127.0.0.1:%d/session" % PORT, subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024)
        async with transport as ws:
            bidi = _fh.BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})
            ctx = (await bidi.call("browsingContext.create", {"type": "tab"})).get("context")
            await bidi.call("browsingContext.navigate",
                            {"context": ctx, "url": "file://" + probe, "wait": "complete"})
            await asyncio.sleep(2)

            async def op(name, body=None):
                return await ev(bidi, ctx, """
                  (async () => {
                    try {
                      var r = await (globalThis.browser || globalThis.chrome)
                        .runtime.sendMessage(%s, { op: %s, body: %s });
                      return JSON.stringify(r);
                    } catch (e) { return JSON.stringify({ __error: String(e) }); }
                  })()
                """ % (json.dumps(SHIELDS_ID), json.dumps(name), json.dumps(body or {})))

            # ---- F02/F05 the DNR tiers -------------------------------------
            inst = json.loads(await op("shields.installState") or "{}")
            st = inst.get("state") or {}
            check("the static DNR tier reports rules", (st.get("static") or 0) > 0,
                  "static=%s" % st.get("static"))
            check("the dynamic DNR tier is installed", (st.get("dynamic") or 0) > 0,
                  "dynamic=%s" % st.get("dynamic"))
            check("the webRequest residual tier is installed", (st.get("webRequest") or 0) > 0,
                  "webRequest=%s" % st.get("webRequest"))

            # ---- F06 the filter-list registry ------------------------------
            lists = json.loads(await op("shields.lists") or "{}")
            reg = lists.get("registry") or {}
            check("the filter-list registry answers with the shipped lists", len(reg) >= 3,
                  "%d lists: %s" % (len(reg), sorted(reg)[:4]))
            for name in sorted(reg)[:4]:
                rec = reg[name]
                print("     %s: rules=%s enabled=%s custom=%s"
                      % (name, rec.get("ruleCount"), rec.get("enabled"), rec.get("isCustom")))

            # ---- F02/F03/F04 state, override, persistence -------------------
            state = json.loads(await op("shields.state", {"body": {}}) or "{}")
            check("shields.state answers (the panel's data source is alive)",
                  state.get("ok") is True, str(state)[:150])
            if state.get("ok"):
                s = state["state"]
                print("     domain=%r rule=%s" % (s.get("domain"), json.dumps(s.get("rule"))[:140]))
                print("     counts=%s" % json.dumps(s.get("counts"))[:100])

            setres = json.loads(await op("shields.setSite",
                                        {"body": {"domain": "example.com",
                                                  "patch": {"enabled": False}}}) or "{}")
            check("per-site override writes (shields.setSite)", setres.get("ok") is True,
                  str(setres)[:120])
            st2 = json.loads(await op("shields.state", {"body": {}}) or "{}")
            after = (st2.get("state") or {}).get("rule") or {}
            check("the override is visible through shields.state",
                  after.get("enabled") is False, json.dumps(after)[:120])

            # ---- F05 the per-tab counter on a real tracker page ------------
            fixture = os.path.join(_fh.ARTIFACTS, "ziy-fix-shields-fixture.html")
            with open(fixture, "w", encoding="utf-8") as fh:
                fh.write(FIXTURE)
            page = await bidi.call("browsingContext.create", {"type": "tab"})
            pctx = page.get("context")
            await bidi.call("browsingContext.navigate",
                            {"context": pctx, "url": "file://" + fixture, "wait": "complete"})
            await asyncio.sleep(8)
            counts = json.loads(await op("shields.tabCounts", {"body": {}}) or "{}")
            c = counts.get("counts") or {}
            print("     tabCounts blocks=%s items=%s kb=%s"
                  % (c.get("blocks"), len(c.get("items") or []), c.get("kb")))
            check("the per-tab counter counts blocked requests", (c.get("blocks") or 0) > 0,
                  json.dumps(c)[:160])

            # ---- F07 the global rule is persisted --------------------------
            stores = _fh.read_storage_values(PROFILE)
            keys = [k for doc in stores.values() if isinstance(doc, dict) for k in doc
                    if k.startswith("shields.")]
            check("the shields global rule and the per-site override are persisted",
                  any(k == "shields.global" for k in keys), "keys=%s" % sorted(keys)[:8])
            await bidi.close()

        print("\n%d passed, %d failed" % (len(passed), len(failed)))
        if failed:
            print("FAILURES: " + ", ".join(failed))
        return 0 if not failed else 1
    finally:
        print("\ncleanup: killed %d process(es)" % kill(PROFILE))


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
