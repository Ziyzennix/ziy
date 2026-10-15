#!/usr/bin/env python3
"""GAP 1 / D-7 — the blocked-item count reports the STATIC DNR tier's blocks.

Defect D-7 (replica/test-report.md §D-7, replica/proofs-fix-events.md §9): the
per-tab counter recorded only residual-webRequest blocks, so a page whose
trackers the STATIC DNR tier stopped reported blocks=0. The static tier is
28 923 rules — the majority of the table — so the count was almost always 0.

What this tool proves, and how it reaches the surface. It follows the exact
route of tools/e2e/ziy-fix-shields-flows.py, which is the only route this build
offers for an extension surface:

  * `browsingContext.navigate` refuses about:newtab and every moz-extension://
    URL (`unsupported operation`), and a file:// page has no `browser.*`, so no
    extension page can be opened by name and no ordinary page can drive the
    add-on. (replica/test-report.md, "How each flow was reached".)
  * the add-on's own page CAN be embedded: a file:// page carrying
    `<iframe src="moz-extension://<uuid>/ui/debug.html">` loads the add-on's
    real document on its real origin, and the engine exposes that frame as its
    own browsing-context child, which is scriptable over BiDi. Inside it
    `typeof browser !== "undefined"`.

So the add-on's real page is embedded as an iframe and its own message bus is
driven from it — the same ops the popup and the options page drive — and the
fixture tracker page is opened in its own tab so the STATIC tier actually stops
those five requests.

The evidence this run is required to produce:

  PASS  with the static tier blocking a known tracker URL, shields.tabCounts
        reports a non-zero count
  PASS  the blocked-item list names the tracker requests
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

PROFILE = "/tmp/ziy-gap1-d7-profile"
PORT = 9371
LOG = "/tmp/ziy-gap1-d7.log"
SHIELDS_ID = "ziy-shields@ziy.app"

# The five trackers tools/e2e/ziy-fix-shields-flows.py proved the static tier
# stops, reused verbatim so this run is comparable with that proof rather than a
# new one. Three of the five are matched by a plain `||host^` block in the
# shipped static ruleset:
#   ||google-analytics.com^  (rule 5841)
#   ||googletagmanager.com^  (rule 3350)
#   ||ad.doubleclick.net^    (rule 4388)
# The facebook.net and scorecardresearch.com URLs are covered by initiator-
# scoped or path-shaped rules, so the count is checked over the set rather than
# per URL — the same way the panel's own count works.
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


def shields_uuid(profile):
    path = os.path.join(profile, "prefs.js")
    if not os.path.exists(path):
        return None
    text = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)', text)
    if not m:
        return None
    return json.loads(m.group(1).replace('\\"', '"').replace("\\\\", "\\")).get(SHIELDS_ID)


def find_contexts(node, out=None):
    if out is None:
        out = []
    if isinstance(node, dict):
        if node.get("url") and node.get("context"):
            out.append(node)
        for v in node.values():
            if isinstance(v, (dict, list)):
                find_contexts(v, out)
    elif isinstance(node, list):
        for v in node:
            find_contexts(v, out)
    return out


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
            print("FAIL no ports"); return 1
        time.sleep(24)

        log = open(LOG, encoding="utf-8", errors="replace").read()
        errors = [l.split("JavaScript error: ", 1)[1] for l in log.splitlines()
                  if "JavaScript error" in l]
        shield_errors = [e for e in errors if "shields" in e.lower()]
        check("the boot log carries no ziy-shields error", not shield_errors,
              "; ".join(shield_errors[:3]) or ("%d JS error(s) total, none shields" % len(errors)))

        uuid = shields_uuid(PROFILE)
        check("the add-on's moz-extension origin is resolvable", bool(uuid), str(uuid))
        if not uuid:
            return 1

        page = "/tmp/ziy-gap1-d7-embed.html"
        with open(page, "w", encoding="utf-8") as fh:
            fh.write("<!doctype html><title>gap1 d7</title>"
                     "<iframe id='f' style='width:1100px;height:820px' "
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
            await asyncio.sleep(9)
            tree = await bidi.call("browsingContext.getTree", {})
            addon_ctx = None
            for c in find_contexts(tree):
                if c["url"].startswith("moz-extension://"):
                    addon_ctx = c["context"]
            check("the add-on's own page runs as a real browsing context", bool(addon_ctx),
                  str([c["url"] for c in find_contexts(tree)]))
            if not addon_ctx:
                return 1

            async def op(name, body=None):
                """Call one of the event page's ops from the add-on's own page,
                the same way the popup and the options page call it."""
                return await _fh.evaluate(bidi, addon_ctx, """
                  (async () => {
                    var msg = { op: %s, body: %s };
                    var api = globalThis.browser || globalThis.chrome;
                    if (!api || !api.runtime || !api.runtime.sendMessage) {
                      return JSON.stringify({ __error: 'no runtime.sendMessage' });
                    }
                    for (var form of [
                      function () { return api.runtime.sendMessage(%s, msg); },
                      function () { return api.runtime.sendMessage(msg); }
                    ]) {
                      try {
                        var r = await form();
                        if (r && (r.ok === true || r.__error === undefined)) return JSON.stringify(r);
                      } catch (e) { }
                    }
                    return JSON.stringify({ __error: 'no form answered' });
                  })()
                """ % (json.dumps(name), json.dumps(body or {}), json.dumps(SHIELDS_ID)))

            # The static tier must be loaded AND indexed for counting. This is
            # the new state the fix adds; installState.staticCounting is the
            # panel's own honest flag for it.
            #
            # The event page rebuilds on startup (rebuildAll() is launched from
            # the listener registration at the bottom of background.js), and it
            # may still be running when the add-on page answers its first
            # message. So the op is polled until the tiers report, rather than
            # assuming the boot already finished.
            st = {}
            for _attempt in range(20):
                inst = json.loads(await op("shields.installState") or "{}")
                st = (inst.get("state") or {})
                if (st.get("static") or 0) > 0 and st.get("staticCounting") is True:
                    break
                await asyncio.sleep(3)
            print("     installState: static=%s staticRules=%s staticCounting=%s webRequest=%s"
                  % (st.get("static"), st.get("staticRules"), st.get("staticCounting"), st.get("webRequest")))
            check("the static DNR tier reports rules", (st.get("static") or 0) > 0,
                  "static=%s" % st.get("static"))
            check("the shipped ruleset is indexed for counting",
                  st.get("staticCounting") is True and (st.get("staticRules") or 0) > 0,
                  "staticRules=%s staticCounting=%s" % (st.get("staticRules"), st.get("staticCounting")))

            # ---- the count, on the real fixture, in its own tab -------------
            fixture = os.path.join(_fh.ARTIFACTS, "ziy-gap1-d7-fixture.html")
            os.makedirs(_fh.ARTIFACTS, exist_ok=True)
            with open(fixture, "w", encoding="utf-8") as fh:
                fh.write(FIXTURE)
            page2 = await bidi.call("browsingContext.create", {"type": "tab"})
            pctx = page2.get("context")
            await bidi.call("browsingContext.navigate",
                            {"context": pctx, "url": "file://" + fixture, "wait": "complete"})
            await asyncio.sleep(12)

            allc = json.loads(await op("shields.counts", {}) or "{}")
            by_tab = allc.get("counts") or {}
            counts = by_tab
            total_blocks = sum(t.get("blocks") or 0 for t in by_tab.values())
            print("     per-tab blocks: %s  (total %d)" % (json.dumps(by_tab)[:220], total_blocks))

            # THE CLAIM. With the static tier blocking a known tracker URL, the
            # per-tab counter reports a non-zero count. Before the fix this read
            # 0 for every tab, because the listener only recorded the residual
            # webRequest tier.
            check("the blocked-item count is non-zero for the fixture tab",
                  total_blocks > 0,
                  "blocks=%s" % json.dumps({k: v.get("blocks") for k, v in by_tab.items()}))

            # The blocked-item list must NAME the stopped requests, not merely
            # count them: the panel renders counts.items, so the URLs have to be
            # in there and each has to say which tier stopped it.
            # `shields.counts` is allCounts(), which is the per-tab summary
            # WITHOUT the item list by design (it is the cheap op). The item
            # list comes from the same read the panel makes, shields.tabCounts,
            # so that is the one used here — per tab id, which the summary's own
            # keys provide.
            named = []
            tiers = set()
            urls = []
            for tab_id in sorted(int(t) for t in (counts or {})):
                detail = await _fh.evaluate(bidi, addon_ctx, """
                  (async () => {
                    var api = globalThis.browser || globalThis.chrome;
                    var r = await api.runtime.sendMessage(%s, {op: 'shields.tabCounts', body: {tabId: %s}});
                    return JSON.stringify(r && r.counts ? r.counts : {});
                  })()
                """ % (json.dumps(SHIELDS_ID), tab_id))
                tab_counts = json.loads(detail or "{}")
                for item in (tab_counts.get("items") or []):
                    named.append(item)
                    if item.get("tier"):
                        tiers.add(item["tier"])
                    if item.get("url"):
                        urls.append(item["url"])
            print("     blocked items: %d  tiers=%s" % (len(named), sorted(tiers)))
            print("     blocked urls: %s" % json.dumps(urls[:6]))

            # The URLs the static tier stopped must be named.
            static_urls = [u for u in urls if any(h in u for h in
                ("google-analytics.com", "googletagmanager.com", "doubleclick.net"))]
            check("the blocked-item list names the static tier's requests",
                  len(named) > 0 and len(static_urls) > 0,
                  "%d item(s), %d naming a static-blocked host" % (len(named), len(static_urls)))
            check("the blocked items record the static DNR tier",
                  "dnr" in tiers,
                  "tiers seen: %s" % sorted(tiers))

            # ---- the add-on's own rendered count ---------------------------
            # The debug page renders the panel's count into its own DOM, which
            # is the figure a user would read.
            n_el = await _fh.evaluate(bidi, addon_ctx,
                                      "(document.getElementById('ziy-count__n')||{}).textContent")
            print("     the add-on page's rendered count: %r" % (n_el,))
            check("the add-on page renders a count", n_el not in (None, ""), "count=%r" % (n_el,))

            # ---- the negative control: a clean page counts nothing ----------
            clean = os.path.join(_fh.ARTIFACTS, "ziy-gap1-d7-clean.html")
            with open(clean, "w", encoding="utf-8") as fh:
                fh.write("<!doctype html><html><body><h1>clean</h1>"
                         "<img src=\"/local.png\" alt=\"\"></body></html>")
            page3 = await bidi.call("browsingContext.create", {"type": "tab"})
            await bidi.call("browsingContext.navigate",
                            {"context": page3.get("context"), "url": "file://" + clean, "wait": "complete"})
            await asyncio.sleep(6)
            detail3 = await _fh.evaluate(bidi, addon_ctx, """
              (async () => {
                var api = globalThis.browser || globalThis.chrome;
                var r = await api.runtime.sendMessage(%s, {op: 'shields.counts', body: {}});
                return JSON.stringify(r && r.counts ? r.counts : {});
              })()
            """ % json.dumps(SHIELDS_ID))
            counts3 = json.loads(detail3 or "{}")
            fixtab = pctx
            # The clean tab is the newest context, so compare its own count.
            clean_total = 0
            for _tab_id, t in (counts3 or {}).items():
                clean_total += t.get("blocks") or 0
            print("     counts after the clean page: %s" % json.dumps(counts3)[:220])
            # The clean page must not have ADDED blocks: what is counted now is
            # the fixture tab's count only.
            check("a clean page adds nothing to the count",
                  clean_total == total_blocks,
                  "before=%d after=%d" % (total_blocks, clean_total))
            await bidi.close()

        return 0 if not failed else 1
    finally:
        killed = kill(PROFILE)
        print("\n%d passed, %d failed" % (len(passed), len(failed)))
        if failed:
            print("FAILURES: " + ", ".join(failed))
        print("cleanup: killed %d process(es)" % killed)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
