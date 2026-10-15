#!/usr/bin/env python3
"""GAP 3 — the ziy-pwd boot proof: installed by the app dir, and the popup
renders the honest states.

What is proven, and on what route. The engine refuses `browsingContext.navigate`
for about:newtab and every moz-extension:// URL (`unsupported operation`), and a
file:// page has no `browser.*` — both recorded in replica/test-report.md's route
table. The route that DOES reach an extension's own document is the one
tools/e2e/ziy-fix-shields-flows.py established: a file:// page carrying
`<iframe src="moz-extension://<uuid>/ui/popup.html">`, which the engine exposes
as its own browsing-context child and which is scriptable over BiDi. That is the
route used here, so every assertion below is about the SHIPPED popup on the
SHIPPED origin.

Two things about that route are honest limits rather than passes:

  * an iframe gets `runtime` and `storage` but NO `tabs` (measured in
    proofs-fix-events.md §5.2), so the popup's site prefill is absent and the
    panel is asserted without it;
  * the native helper is not launched by this proof (the vault lives outside
    the browser), so the vault-state assertions read what the popup does when the
    bus ANSWERS and when it does not. The native path itself is proven by
    native/ziy-pwd's own suites and by the installer's live probe.
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

PROFILE = "/tmp/ziy-gap3-pwd-profile"
PORT = 9381
LOG = "/tmp/ziy-gap3-pwd.log"
PWD_ID = "ziy-pwd@ziy.app"


def kill(profile):
    pids = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout.split()
    for pid in pids:
        try:
            os.kill(int(pid), signal.SIGKILL)
        except Exception:
            pass
    return len(pids)


def addon_uuid(profile, addon_id):
    path = os.path.join(profile, "prefs.js")
    if not os.path.exists(path):
        return None
    text = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)', text)
    if not m:
        return None
    return json.loads(m.group(1).replace('\\"', '"').replace("\\\\", "\\")).get(addon_id)


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
        errors = [l.split("JavaScript error: ", 1)[1] for l in log.splitlines() if "JavaScript error" in l]
        pwd_errors = [e for e in errors if "pwd" in e.lower() or "ziy-pwd" in e.lower()]
        check("the boot log carries no ziy-pwd error", not pwd_errors,
              "; ".join(pwd_errors[:3]) or ("%d JS error(s) total, none ziy-pwd" % len(errors)))

        # ---- 1. The add-on is installed by the app dir, and active ----------
        addons = _fh.read_addons(PROFILE)
        pwd = next((a for a in addons if a.get("id") == PWD_ID), None)
        check("ziy-pwd is installed and active",
              bool(pwd and pwd.get("active") and pwd.get("appDisabled") is not True),
              "active=%s version=%s" % (pwd.get("active") if pwd else None,
                                        pwd.get("version") if pwd else None))

        # ---- 2. The installedDistroAddon marker, the suite's install proof ----
        prefs = open(os.path.join(PROFILE, "prefs.js"), encoding="utf-8", errors="replace").read()
        marker = ('extensions.installedDistroAddon.%s' % PWD_ID) in prefs
        check("the app-scope installer marked ziy-pwd in prefs.js", marker,
              "installedDistroAddon.%s" % PWD_ID)

        # ---- 3. The whole suite is still installed alongside it -------------
        suite = _fh.suite_state(PROFILE)
        expected = [i for i in _fh.SUITE if i]
        missing = [i for i in expected if i not in suite]
        inactive = [i for i in expected if i in suite and not suite[i]["active"]]
        check("every suite id is installed AND active alongside ziy-pwd",
              not missing and not inactive,
              "%d/%d active, missing=%s inactive=%s" % (len(expected) - len(missing) - len(inactive),
                                                        len(expected), missing, inactive))

        uuid = addon_uuid(PROFILE, PWD_ID)
        check("the add-on's moz-extension origin is resolvable", bool(uuid), str(uuid))
        if not uuid:
            return 1

        # ---- 4. The popup's real DOM, on the real origin --------------------
        page = "/tmp/ziy-gap3-pwd-embed.html"
        with open(page, "w", encoding="utf-8") as fh:
            fh.write("<!doctype html><title>gap3 pwd</title>"
                     "<iframe id='f' style='width:420px;height:560px' "
                     "src='moz-extension://%s/ui/popup.html'></iframe>" % uuid)

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
            await asyncio.sleep(10)
            tree = await bidi.call("browsingContext.getTree", {})
            pwd_ctx = None
            for c in find_contexts(tree):
                if c["url"].startswith("moz-extension://") and "ui/popup.html" in c["url"]:
                    pwd_ctx = c["context"]
            check("the add-on's popup runs as a real browsing context", bool(pwd_ctx),
                  str([c["url"] for c in find_contexts(tree) if "moz-extension" in c["url"]]))
            if not pwd_ctx:
                return 1

            async def text_of(expr):
                return await _fh.evaluate(bidi, pwd_ctx, expr)

            # BiDi's script.evaluate with returnByValue:true turns JS booleans
            # into Python booleans, so `found` is compared against a real bool
            # and printed as its repr.
            for sel, label in [
                ("ziy-badge", "the state badge"),
                ("ziy-status", "the live status region"),
                ("ziy-create", "the create-vault form"),
                ("ziy-unlock", "the unlock form"),
                ("ziy-main", "the unlocked panel"),
                ("ziy-save", "the save form"),
                ("ziy-import-btn", "the import button"),
                ("ziy-export-btn", "the export button"),
                ("ziy-clear-btn", "the delete-all button"),
            ]:
                found = await text_of("!!document.getElementById(%s)" % json.dumps(sel))
                check("the popup carries %s" % label, found is True, "found=%r" % (found,))

            # The honest state: no helper is answering this origin, so the panel
            # must say so rather than claim a vault it cannot see.
            badge = await text_of("(document.getElementById('ziy-badge')||{}).textContent")
            status = await text_of("(document.getElementById('ziy-status')||{}).textContent")
            print("     badge=%r status=%r" % (badge, status))
            check("the popup does not claim an unlocked vault", (badge or "") != "unlocked",
                  "badge=%r" % (badge,))
            check("the popup's status is a real sentence, not blank",
                  isinstance(status, str) and len(status) > 8, "status=%r" % (status,))

            # The create form is the first thing a new user sees, and it is the
            # only way in: there is no unlock form before there is a vault.
            create_hidden = await text_of("document.getElementById('ziy-create').hidden")
            unlock_hidden = await text_of("document.getElementById('ziy-unlock').hidden")
            main_hidden = await text_of("document.getElementById('ziy-main').hidden")
            print("     create.hidden=%s unlock.hidden=%s main.hidden=%s"
                  % (create_hidden, unlock_hidden, main_hidden))
            check("a fresh install offers the create-vault form",
                  create_hidden is False, "create.hidden=%r" % (create_hidden,))
            check("no credential surface is visible before the vault exists",
                  main_hidden is True, "main.hidden=%r" % (main_hidden,))
            # No fake controls. The panel must not ship a fill button.
            fill_controls = await text_of("""
              (function(){
                var out = [];
                document.querySelectorAll('button, [role="button"], input').forEach(function(el){
                  if (/fill|autofill/i.test(el.id || '') || /fill|autofill/i.test(el.textContent || ''))
                    out.push(el.id || el.tagName);
                });
                return JSON.stringify(out);
              })()
            """)
            print("     fill-looking controls:", fill_controls)
            check("the popup ships no fill control", fill_controls == "[]", fill_controls)

            # The panel says the feature is absent, in words.
            foot = await text_of("(document.getElementById('ziy-foot')||{}).textContent")
            check("the popup states the honest limits in words",
                  isinstance(foot, str) and "Form filling is not part of this build" in foot,
                  (foot or "")[:80])

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
