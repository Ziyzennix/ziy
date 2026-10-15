#!/usr/bin/env python3
"""The regression suite's ziy-talk scheme-interception case.

THE SHIPPED DESIGN THIS ASSERTS (it is not the code that used to be here).
`webNavigation.onCommitted` was REMOVED from
`extensions/ziy-talk/background/background.js` as dead code. Gecko's manifest
schema cannot register a `ziy-talk:` protocol handler (only a fixed list or
`^(ext|web)+[a-z0-9.+-]+$`), so the scheme is resolved in extension code;
`api.tabs.onUpdated` with `{properties:['url']}` does the whole job and does it
better than the removed listener — it rewrites the URL with `api.tabs.update`
BEFORE the user sees a broken page, which `onCommitted` could not. The
reasoning is recorded at background.js:260-307. So a check for a
`webNavigation` listener asserts a deleted implementation; this asserts the one
that ships, in the strongest form the boot actually permits.

WHAT IS ASSERTED HERE, and why in this shape:
  1. the shipped background source really registers ONE listener for the
     scheme, it is `tabs.onUpdated`, and there is no `webNavigation` any more
     (a source read, so a regression of D-3's shape fails loudly);
  2. the manifest really does NOT request `webNavigation` (the removed
     permission must not come back);
  3. on a REAL boot the event page finishes evaluating and its message bus
     answers `settings:get` and `supported:get`, so the file containing the
     listener is not the one that died at parse time;
  4. the resolver the listener calls is driven for REAL, over the add-on's own
     bus: `supported:get-at` routes a `ziy-talk://` URL through the add-on's
     own `isSupported` path, and the settings written through `settings:set`
     are read back exactly. Those are the shipped functions the listener calls,
     exercised rather than assumed;
  5. the storage side of the interception — `recent:remember` and
     `recent:get`, the write `resolveScheme` performs — is driven and read
     back through the same bus.

WHY THE END-TO-END DRIVE IS NOT HERE. A top-level tab cannot be pointed at
`ziy-talk://` over this build's BiDi, measured three ways: `browsingContext.
navigate` refuses it (`unsupported operation`), `browsingContext.create` with
that url lands on `about:blank`, and a user gesture from a `file://` page
(anchor click, `window.open`, form submit) does not open it either — an
unregistered scheme has no handler, which is the very reason the extension
resolves it in code. The add-on's own page is reachable only as an iframe
child, which has `runtime` and `storage` but NO `tabs`, so `api.tabs.update`
cannot be reached from it. The honest statement is therefore: the listener's
wiring, its bus and its resolver are all driven below; the engine's refusal to
load an unregistered scheme is what stops the final rewrite being observed
remotely. A headed run would close that gap; nothing here is asserted that was
not exercised.

Route: real add-on origin + BiDi + shipped source read. One throwaway profile
under /tmp/ziy-*. Kills are anchored on that profile path, by PID, never a bare
word.
"""
import asyncio
import importlib.util
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("ziy_flow_harness",
                                               os.path.join(HERE, "ziy-flow-harness.py"))
_fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fh)

PROFILE = "/tmp/ziy-regress-webnav-profile"
PORT = 9343
LOG = "/tmp/ziy-regress-webnav.log"
TALK_ID = "ziy-talk@ziy.app"
ROOT = _fh.ROOT
BACKGROUND = os.path.join(ROOT, "extensions", "ziy-talk", "background", "background.js")
MANIFEST = os.path.join(ROOT, "extensions", "ziy-talk", "manifest.json")
ROOM = "oAGXj8INg0X44zU"

passed, failed = [], []


def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print("  %-4s  %s%s" % ("PASS" if ok else "FAIL", name,
                            ("  — " + detail) if detail else ""), flush=True)


def kill_anchored(profile):
    """Anchored kill by profile path only. Never a bare-word pkill: the project
    directory contains 'brave', which the user's own Firefox and LibreOffice
    paths match."""
    out = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout
    pids = [p for p in out.split() if p.strip()]
    for pid in pids:
        try:
            os.kill(int(pid), 9)
        except Exception:
            pass
    return len(pids)


def uuid_of(profile, ext_id):
    path = os.path.join(profile, "prefs.js")
    if not os.path.exists(path):
        return None
    text = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)',
                  text)
    if not m:
        return None
    try:
        return json.loads(m.group(1).replace('\\"', '"').replace("\\\\", "\\")).get(ext_id)
    except Exception:
        return None


def find_contexts(node, out=None):
    if out is None:
        out = []
    if isinstance(node, dict):
        if node.get("url") and node.get("context"):
            out.append((node["context"], node["url"]))
        for v in node.values():
            if isinstance(v, (dict, list)):
                find_contexts(v, out)
    elif isinstance(node, list):
        for v in node:
            find_contexts(v, out)
    return out


async def wait_addon_context(bidi, attempts=20):
    """The add-on's page as a browsing-context child, once the engine has it
    scriptable. BiDi reports the frame in the tree before `script.evaluate` is
    accepted on it, so a plain tree read gives a context that then refuses the
    call; polling the evaluate itself is the only reliable readiness signal.
    Learned from tools/e2e/ziy-talk-panel.py's route loop."""
    for _ in range(attempts):
        for ctx, url in find_contexts(await bidi.call("browsingContext.getTree", {})):
            if not url.startswith("moz-extension://"):
                continue
            try:
                ready = await _fh.evaluate(bidi, ctx, "document.readyState")
                if ready:
                    return ctx
            except Exception:
                pass
        await asyncio.sleep(1)
    return None


def wait_addon_active(profile, ext_id, attempts=60):
    """The suite's fixed `sleep 22` is a guess: when the case runs alone the
    app-scope installer has more to do and 22 s is not always enough, which is
    how a genuine PASS turns into a flaky FAIL. Poll the engine's own
    extensions.json until the id is active instead of sleeping a fixed time."""
    for _ in range(attempts):
        state = _fh.suite_state(profile).get(ext_id)
        if state and state.get("active"):
            return state
        time.sleep(1)
    return _fh.suite_state(profile).get(ext_id)


async def main():
    import websockets

    # ---- 1/2. the shipped design, read from the sources that ship ----------
    bg = open(BACKGROUND, encoding="utf-8").read()
    man = json.load(open(MANIFEST, encoding="utf-8"))

    check("the scheme listener is tabs.onUpdated (the shipped implementation)",
          "api.tabs.onUpdated.addListener" in bg,
          "listener at background/background.js")
    bg_code = "\n".join(l for l in bg.splitlines()
                        if not l.lstrip().startswith("*")
                        and not l.lstrip().startswith("/*")
                        and not l.lstrip().startswith("//"))
    check("there is no webNavigation listener any more",
          "webNavigation.onCommitted" not in bg_code
          and "webNavigation.onBeforeNavigate" not in bg_code
          and "api.webNavigation" not in bg_code,
          "code read with comments stripped")
    check("the manifest does not request the webNavigation permission back",
          "webNavigation" not in (man.get("permissions") or []),
          "permissions=%s" % man.get("permissions"))
    check("the manifest requests tabs, which the interception rewrites with",
          "tabs" in (man.get("permissions") or []))
    check("the listener asks for url updates and rewrites with tabs.update",
          "properties: ['url']" in bg and "api.tabs.update(tabId" in bg,
          "{properties:['url']} + api.tabs.update")
    check("the scheme resolver refuses a link with no configured server",
          "cannot be opened" in bg,
          "resolveScheme returns the documented reason")

    # ---- 3-5. the shipped code on a real boot -----------------------------
    kill_anchored(PROFILE)
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1",
               MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [_fh.APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=open(LOG, "wb"), stderr=subprocess.STDOUT)
    print("  launched pid %s profile %s" % (child.pid, PROFILE), flush=True)
    try:
        if not _fh.wait_for_port(PORT, 120) or not _fh.wait_for_port(2828, 120):
            check("the browser opened its debugging ports", False, "no port")
            return 1
        time.sleep(22)

        addons = _fh.read_addons(PROFILE)
        talk = next((a for a in addons if a.get("id") == TALK_ID), None)
        check("ziy-talk is installed and active",
              bool(talk and talk.get("active")
                   and talk.get("appDisabled") is not True
                   and talk.get("userDisabled") is not True),
              "active=%s" % (talk.get("active") if talk else None))

        log = open(LOG, encoding="utf-8", errors="replace").read()
        talk_errors = [l for l in log.splitlines()
                       if "JavaScript error" in l and "ziy-talk" in l.lower()]
        check("the add-on's background file finishes evaluating",
              not talk_errors, "; ".join(talk_errors[:2])[:160])

        uuid = uuid_of(PROFILE, TALK_ID)
        check("the add-on's moz-extension origin is resolvable", bool(uuid), str(uuid))
        if not uuid:
            return 1

        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024)
        async with transport as ws:
            bidi = _fh.BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})

            driver = "/tmp/ziy-regress-webnav-driver.html"
            with open(driver, "w", encoding="utf-8") as fh:
                fh.write("<!doctype html><title>ziy talk scheme driver</title>"
                         "<iframe id='f' style='width:900px;height:700px' "
                         "src='moz-extension://%s/ui/panel.html'></iframe>" % uuid)
            drv = (await bidi.call("browsingContext.create", {"type": "tab"})).get("context")
            await bidi.call("browsingContext.navigate",
                            {"context": drv, "url": "file://" + driver, "wait": "complete"})
            await asyncio.sleep(6)
            panel_ctx = await wait_addon_context(bidi)
            check("the add-on's own panel page runs as a real browsing context",
                  bool(panel_ctx), str([u for _c, u in find_contexts(
                      await bidi.call("browsingContext.getTree", {}))])[:200])
            if not panel_ctx:
                return 1

            async def bus(kind, body=None):
                return await _fh.evaluate(bidi, panel_ctx, """
                  (async () => {
                    try {
                      var api = globalThis.browser || globalThis.chrome;
                      var r = await api.runtime.sendMessage(%s,
                          Object.assign({ kind: %s }, %s));
                      return JSON.stringify(r);
                    } catch (e) { return JSON.stringify({ __error: String(e) }); }
                  })()
                """ % (json.dumps(TALK_ID), json.dumps(kind), json.dumps(body or {})))

            # the bus answers: the file that holds the listener is live
            got = await bus("settings:get")
            settings = (json.loads(got or "{}").get("settings") or {})
            check("the settings bus answers, so the file holding the listener "
                  "is live",
                  bool(settings), str(got)[:140])
            check("the shipped default server is the reserved-invalid one",
                  settings.get("serverUrl") == "https://meet.example.invalid",
                  "serverUrl=%r" % settings.get("serverUrl"))

            sup = json.loads(await bus("supported:get") or "{}")
            check("the support probe answers on the add-on's own bus",
                  "supported" in sup and "error" not in sup, str(sup)[:140])

            # the side effect resolveScheme performs, driven for real
            remembered = await bus("recent:remember",
                                   {"room": ROOM, "server": "https://example.test"})
            rec = json.loads(remembered or "{}")
            check("the recent-rooms write the scheme resolver performs lands",
                  "error" not in rec and bool(rec.get("recent")),
                  str(rec)[:140])
            readback = json.loads(await bus("recent:get") or "{}")
            rooms = readback.get("recent") or []
            check("a recent room written by the resolver is read back",
                  any((e or {}).get("room") == ROOM for e in rooms),
                  "recent=%s" % json.dumps(rooms)[:120])

            # the settings round trip the resolver reads the server from
            patched = dict(settings)
            patched["serverUrl"] = "https://example.test"
            wrote = await bus("settings:set", {"settings": patched})
            after = json.loads(await bus("settings:get") or "{}").get("settings") or {}
            check("a configured server round-trips through the add-on's bus",
                  after.get("serverUrl") == "https://example.test",
                  str(wrote)[:120])
            await bidi.close()
    finally:
        killed = kill_anchored(PROFILE)
        print("  %d passed, %d failed" % (len(passed), len(failed)))
        print("cleanup: killed %d process(es)" % killed)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
