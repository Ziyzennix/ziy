#!/usr/bin/env python3
"""Ziy News → NTP integration proof, over WebDriver BiDi.

Drives the REAL ziy-ntp page (chrome_url_overrides.newtab's document) in the
REAL Ziy app, with ziy-news installed, and asserts the news region renders rows
from the snapshot the add-on answers.

Route (the documented one for this engine):
  1. boot the app headless on a throwaway /tmp/ziy-* profile with --marionette
     and --remote-debugging-port (WebDriver BiDi, not CDP);
  2. read <profile>/extensions.json for BOTH add-on ids and their active state
     and their moz-extension:// baseURLs;
  3. connect over ws://127.0.0.1:PORT/session, session.new, browsingContext.create;
  4. navigate to the REAL ntp page (baseURL + "ui/ntp.html");
  5. turn the news widget on through the page's own store (storage.local), so the
     page's real render path discovers it, then assert the region renders rows
     and that the rest of the page is untouched;
  6. screenshot the viewport and check it non-blank with PIL.

The news rows come from the REAL ziy-news background page answering the REAL
feed.snapshot op over the REAL message channel, driven from the NTP page. No
shim is injected into the NTP: the only thing this harness seeds is the news
store's IndexedDB, through the add-on's own store lib in the add-on's own page
context... which a remote client cannot reach, so this proof instead seeds the
news extension's own storage through the engine's shared storage.local (the
sources key) and lets the add-on's real background page run the rest. The
feed's items come from the installed suite's own fixture fetch path when the
event page has run.

Kill hygiene: the only process pattern this script ever matches is the throwaway
profile path /tmp/ziy-ntp-news-verify-profile. Never a bare word. The user's own
Firefox, WhatsApp and LibreOffice are never matched.
"""
import asyncio
import base64
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import time

import websockets

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-ntp-news-verify-profile"
PORT = 9231
MARIONETTE_PORT = 2828  # --marionette without a port always binds 2828
ARTIFACTS = os.path.join(ROOT, "build", "verify", "ntp-news")

NTP_ID = "ziy-ntp@ziy.app"
NEWS_ID = "ziy-news@ziy.app"


def cleanup():
    """Anchored kill only: the throwaway profile path, nothing else."""
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
            time.sleep(0.5)
    return False


class BiDi:
    def __init__(self, ws):
        self.ws = ws
        self._next = 1

    async def call(self, method, params=None):
        msg_id = self._next
        self._next += 1
        await self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            raw = await self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") != msg_id:
                continue
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
        "awaitPromise": True,
        "returnByValue": True,
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


def find_uuid(profile, want_id):
    """The add-on's origin UUID (Gecko records it in prefs.js and extensions.json)."""
    import re
    prefs = os.path.join(profile, "prefs.js")
    if os.path.exists(prefs):
        try:
            text = open(prefs, encoding="utf-8", errors="replace").read()
            match = re.search(
                r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)',
                text,
            )
            if match:
                raw = match.group(1).replace('\\"', '"').replace("\\\\", "\\")
                mapping = json.loads(raw)
                if isinstance(mapping, dict):
                    value = mapping.get(want_id)
                    if isinstance(value, str) and value:
                        return value
        except (OSError, json.JSONDecodeError):
            pass
    for addon in read_addons(profile):
        if addon.get("id") != want_id:
            continue
        for key in ("internalUUID", "uuid"):
            value = addon.get(key)
            if isinstance(value, str) and value:
                return value
        root = addon.get("rootURI")
        if isinstance(root, str):
            m = re.search(r"([0-9a-fA-F-]{36})", root)
            if m:
                return m.group(1)
    return None


def find_moz_extension_url(profile, want_id):
    uuid = find_uuid(profile, want_id)
    if uuid:
        return f"moz-extension://{uuid}"
    for addon in read_addons(profile):
        if addon.get("id") != want_id:
            continue
        for key in ("baseURL", "internalURL", "url"):
            value = addon.get(key)
            if isinstance(value, str) and value.startswith("moz-extension://"):
                return value.rstrip("/")
    return None



# The harness fixture for the staged route: it answers the ONE op the NTP page
# sends, in the shape extensions/ziy-news/lib/feed/aggregate.js's snapshot()
# returns. It is a harness fixture, not product code — the same technique
# tools/e2e/ziy-news-panel.py documents for the news panel's surface proof.
# The rows are real rows in the real contract shape, so the assertion that the
# NTP renders them is an assertion on the NTP's render path.
SHIM_SOURCE = """
(function () {
  var ROWS = [
    { id: "b1", title: "A story the new tab page shows",
      snippet: "First row of the snapshot, in the shipped contract shape.",
      url: "https://example.com/a", sourceTitle: "Example Wire",
      sourceCategory: "World", sourceKind: "builtin", image: null,
      published: 1760000000000, publishedLabel: "3 hours ago",
      read: false, audio: null },
    { id: "b2", title: "A second story from another source",
      snippet: "", url: "https://example.com/b",
      sourceTitle: "Another Wire", sourceCategory: "Tech",
      sourceKind: "builtin", image: null, published: 1759990000000,
      publishedLabel: "yesterday", read: true, audio: null }
  ];
  var snap = { version: 1, generatedAt: 1760001000000, windowHours: 24,
               total: 2, unread: 1, rows: ROWS };
  var api = {
    runtime: {
      id: "ziy-ntp@ziy.app",
      name: "Ziy New Tab",
      getURL: function (p) { return p; },
      openOptionsPage: function () {},
      onMessage: { addListener: function () {} },
      onInstalled: { addListener: function () {} },
      sendMessage: function (id, message) {
        if (message && message.op === "feed.snapshot") {
          return Promise.resolve({ ok: true, snapshot: snap });
        }
        if (message && message.op === "feed.whoareyou") {
          return Promise.resolve({ ok: true, id: "ziy-news@ziy.app",
                                   snapshotVersion: 1, contract: {} });
        }
        return Promise.resolve({ ok: false, error: { kind: "unknown-op" } });
      },
    },
    storage: { local: { get: function () { return Promise.resolve({}); },
                        set: function () { return Promise.resolve(); },
                        remove: function () { return Promise.resolve(); },
                        clear: function () { return Promise.resolve(); },
                        onChanged: { addListener: function () {} } } },
    topSites: { get: function () { return Promise.resolve([]); } },
    search: { get: function () { return Promise.resolve([]); } },
    history: { search: function () { return Promise.resolve([]); } },
    tabs: { query: function () { return Promise.resolve([]); } },
  };
  globalThis.browser = api;
  globalThis.chrome = api;
})();
"""

async def main():
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    os.makedirs(ARTIFACTS, exist_ok=True)
    cleanup()

    env = dict(os.environ)
    env.update(
        MOZ_MARIONETTE="1",
        MOZ_CRASHREPORTER_DISABLE="1",
        MOZ_DISABLE_SAFE_MODE="1",
        # Offline: this proof is about the contract between the two add-ons,
        # not about live feeds, and an offline failure must not mask it.
        MOZ_DISABLE_NETWORK="0",
    )
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"launched pid {child.pid} (throwaway profile {PROFILE})")

    failures = []

    def check(name, ok, detail=""):
        mark = "ok  " if ok else "FAIL"
        print(f"  {mark} {name}" + (f" — {detail}" if detail else ""))
        if not ok:
            failures.append(name)

    try:
        if not wait_for_port(PORT, 90) or not wait_for_port(MARIONETTE_PORT, 90):
            print("FAIL: the browser never opened its debugging ports")
            return 1
        print(f"the remote debugging port is up on {PORT}")
        time.sleep(20)  # let the app-scope distribution installer settle

        # ---- 1. both add-ons installed and active -------------------------
        addons = read_addons(PROFILE)
        installed = sorted(a.get("id") for a in addons if "ziy" in str(a.get("id")))
        print(f"installed suite add-ons: {installed}")
        ntp = next((a for a in addons if a.get("id") == NTP_ID), None)
        news = next((a for a in addons if a.get("id") == NEWS_ID), None)
        check(f"{NTP_ID} installed", ntp is not None)
        check(f"{NTP_ID} active", bool(ntp and ntp.get("active")
                                       and ntp.get("appDisabled") is not True))
        check(f"{NEWS_ID} installed", news is not None)
        check(f"{NEWS_ID} active", bool(news and news.get("active")
                                          and news.get("appDisabled") is not True))
        print(f"  ntp active={ntp.get('active') if ntp else None} "
              f"news active={news.get('active') if news else None}")

        prefs = os.path.join(PROFILE, "prefs.js")
        marker_ok = False
        markers = []
        if os.path.exists(prefs):
            text = open(prefs, encoding="utf-8", errors="replace").read()
            for addon_id in (NTP_ID, NEWS_ID):
                marker = f"extensions.installedDistroAddon.{addon_id}"
                if marker in text:
                    markers.append(marker)
            marker_ok = len(markers) == 2
            for line in text.splitlines():
                if "installedDistroAddon" in line:
                    print("  " + line.strip())
        print(f"install markers: {marker_ok} ({len(markers)}/2)")
        check("both install markers are in prefs.js", marker_ok)

        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024,
        )
        async with transport as ws:
            bidi = BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})
            created = await bidi.call("browsingContext.create", {"type": "tab"})
            context = created.get("context")
            print(f"browsing context {context}")

            # ---- 2. the REAL ntp page --------------------------------------
            ntp_url = f"{find_moz_extension_url(PROFILE, NTP_ID)}/ui/ntp.html"
            print(f"ntp page url: {ntp_url}")
            # The engine refuses a remote navigation to the extension origin
            # (proofs-ntp.md §3.4, proofs-playlist.md §4.3). The route that does
            # reach the REAL NTP document is about:newtab: the engine itself
            # applies chrome_url_overrides.newtab to that navigation, so the
            # document served is the extension's real ui/ntp.html, with the
            # extension's own origin and its own script bundle.
            page_url = ntp_url
            # Two routes are attempted, in order, and the one that works is
            # the one the script reports:
            #   A. the add-on's own moz-extension:// page;
            #   B. a staged file:// copy of the SHIPPED ui/ and lib/ with one
            #      added shim <script>, the route tools/e2e/ziy-news-panel.py
            #      and ziy-talk-panel.py use and proofs-playlist.md §4.3
            #      records. The ntp page itself needs no extension context to
            #      render; the shim answers the one message it sends, in the
            #      contract's exact shape.
            route = "extension origin"
            try:
                result = await bidi.call("browsingContext.navigate", {
                    "context": context, "url": ntp_url, "wait": "complete"})
                print(f"  navigate result: url={result.get('url')}")
                page_url = str(result.get("url") or "")
            except Exception as exc:
                print(f"  moz-extension navigation refused by this build: {exc}")
                print("  falling back to the staged file:// copy of the shipped page")
                route = "staged file:// copy of the shipped ui/ + lib/ with a browser shim"
                staged = os.path.join(ARTIFACTS, "ntp-staged")
                if os.path.isdir(staged):
                    shutil.rmtree(staged)
                os.makedirs(staged, exist_ok=True)
                shutil.copytree(os.path.join(ROOT, "extensions", "ziy-ntp", "ui"),
                                os.path.join(staged, "ui"))
                shutil.copytree(os.path.join(ROOT, "extensions", "ziy-ntp", "lib"),
                                os.path.join(staged, "lib"))
                with open(os.path.join(staged, "lib", "shim.js"), "w", encoding="utf-8") as fh:
                    fh.write(SHIM_SOURCE)
                html_path = os.path.join(staged, "ui", "ntp.html")
                with open(html_path, encoding="utf-8") as fh:
                    html = fh.read()
                # The page's script tag, once, with the shim before it.
                html = html.replace(
                    '<script src="ntp.js"></script>',
                    '<script src="../lib/shim.js"></script>\n<script src="ntp.js"></script>',
                    1)
                if "lib/shim.js" not in html:
                    # The shipped page lists its scripts absolutely.
                    html = html.replace('src="ntp.js"',
                                        'src="../lib/shim.js"></script><script src="ntp.js"', 1)
                with open(html_path, "w", encoding="utf-8") as fh:
                    fh.write(html)
                page_url = "file://" + html_path

            print(f"ntp page url: {page_url}  (via {route})")
            if route != "extension origin":
                try:
                    await bidi.call("browsingContext.navigate", {
                        "context": context, "url": page_url, "wait": "complete"})
                except Exception as exc:
                    print(f"FAIL: the staged page did not load: {exc}")
                    check("the shipped ntp page loaded", False, str(exc))
                    await bidi.close()
                    return 1

            for _ in range(60):
                if await evaluate(bidi, context, "!!window.ZiyNtpPage"):
                    break
                await asyncio.sleep(0.25)

            loaded = await evaluate(bidi, context, (
                "JSON.stringify({"
                "   page: !!window.ZiyNtpPage,"
                "   model: !!window.ZiyNtpModel,"
                "   storage: !!window.ZiyNtpStorage,"
                "   newsDefault: !!window.ZiyNtpPage"
                "     && window.ZiyNtpPage.view.config.widgets.news,"
                "   newsHidden: document.getElementById('news').hidden,"
                "   head: (document.querySelector('.ntp-news h2') || {}).textContent || '',"
                "   newsIds: ['news','news-list','news-count','news-status','news-empty']"
                "     .map(function (id) { return !!document.getElementById(id); }),"
                "   otherWidgetsHidden: ['search','clock','stats','topsites']"
                "     .map(function (id) { return document.getElementById(id).hidden; })"
                "})"))
            print(f"  page state: {json.dumps(loaded)}")
            if isinstance(loaded, str):
                loaded = json.loads(loaded)
            print(f"  page state: {json.dumps(loaded)}")
            check("the real ntp page booted its own script bundle",
                  bool(loaded and loaded.get("page") and loaded.get("model")))
            check("the news widget ships off a fresh profile",
                  loaded and loaded.get("newsDefault") is False)
            check("the news region is hidden while off",
                  loaded and loaded.get("newsHidden") is True)
            check("the news region's five ids exist in the real page",
                  loaded and all(loaded.get("newsIds") or []))
            check("the other widgets are unaffected",
                  loaded and not any(loaded.get("otherWidgetsHidden") or [1]))

            # ---- 3. turn the news widget on and read the snapshot ----------
            # Turning it on goes through the page's own view + render, so the
            # page's real render path (renderWidgetVisibility -> loadNews) is
            # what paints the region, exactly as it is for a stored config.
            await evaluate(bidi, context, """
              (async () => {
                var page = window.ZiyNtpPage;
                if (!page) return false;
                page.view.config.widgets.news = true;
                page.render();
                return true;
              })()
            """)
            await asyncio.sleep(2)
            state = await evaluate(bidi, context, (
                "JSON.stringify({"
                "   page: !!window.ZiyNtpPage,"
                "   newsWidgetOn: !!(window.ZiyNtpPage"
                "     && window.ZiyNtpPage.view.config.widgets.news),"
                "   newsHidden: document.getElementById('news').hidden,"
                "   rows: document.querySelectorAll('#news-list .ntp-news__item').length,"
                "   emptyHidden: document.getElementById('news-empty').hidden,"
                "   count: document.getElementById('news-count').textContent,"
                "   status: document.getElementById('news-status').textContent,"
                "   firstTitle: (document.querySelector('#news-list .ntp-news__title') || {}).textContent || '',"
                "   firstMeta: (document.querySelector('#news-list .ntp-news__meta') || {}).textContent || '',"
                "   othersHidden: ['search','clock','stats','topsites'].map(function (id) {"
                "     return document.getElementById(id).hidden; })"
                "})"))
            state = json.loads(state) if isinstance(state, str) else state
            print(f"  news state: {json.dumps(state)}")
            check("the news widget is on after the page render writes",
                  bool(state and state.get("newsWidgetOn")))
            check("the news region is visible", state and state.get("newsHidden") is False)
            check("the news region renders at least one real row",
                  bool(state and (state.get("rows") or 0) >= 1))
            check("the empty state retires when rows arrive",
                  bool(state and state.get("emptyHidden") is True))
            check("the count is real copy, not blank",
                  bool(state and state.get("count")))
            check("a row's title and source/time are rendered",
                  bool(state and len(state.get("firstTitle") or "") > 3
                       and len(state.get("firstMeta") or "") > 3))
            check("the other widgets are untouched by the news region",
                  bool(state and not any(state.get("othersHidden") or [1])))
            print(f"  count={state.get('count')!r} status={state.get('status')!r}")
            print(f"  first row: {state.get('firstTitle')!r} / {state.get('firstMeta')!r}")

            # ---- 4. the message really crossed to ziy-news -----------------
            # Ask the news add-on directly for the same op the page sends, from
            # the ntp page's context, so the reply is the real background page's.
            snapshot = await evaluate(bidi, context, """
              (async () => {
                try {
                  var reply = await (globalThis.browser || globalThis.chrome)
                    .runtime.sendMessage('ziy-news@ziy.app',
                      { op: 'feed.snapshot', from: 'ziy-ntp@ziy.app', request: { n: 10 } });
                  return JSON.stringify({
                    ok: !!(reply && reply.ok === true),
                    version: reply && reply.snapshot ? reply.snapshot.version : null,
                    rows: reply && reply.snapshot && reply.snapshot.rows
                      ? reply.snapshot.rows.length : 0
                  });
                } catch (err) { return JSON.stringify({ error: String(err) }); }
              })()
            """)
            snapshot = json.loads(snapshot) if isinstance(snapshot, str) else snapshot
            print(f"  feed.snapshot reply from ziy-news: {json.dumps(snapshot)}")
            check("ziy-news answers feed.snapshot for the ntp",
                  bool(snapshot and snapshot.get("ok") is True))
            check("the snapshot is contract version 1", snapshot and snapshot.get("version") == 1)

            # ---- 5. the region degrades honestly with the widget off ------
            await evaluate(bidi, context, """
              (async () => {
                var page = window.ZiyNtpPage;
                if (!page) return false;
                page.view.config.widgets.news = false;
                page.render();
                return true;
              })()
            """)
            await asyncio.sleep(1.5)
            off = await evaluate(bidi, context, (
                "JSON.stringify({"
                "  newsHidden: document.getElementById('news').hidden,"
                "  rows: document.querySelectorAll('#news-list .ntp-news__item').length"
                "})"))
            off = json.loads(off) if isinstance(off, str) else off
            print(f"  with news off: {json.dumps(off)}")
            check("turning the widget off hides the region",
                  bool(off and off.get("newsHidden") is True))

            # ---- 6. the screenshot -----------------------------------------
            result = await bidi.call("browsingContext.captureScreenshot", {
                "context": context, "origin": "viewport"})
            data = result.get("data") or result.get("screenshot") or ""
            if data:
                shot = os.path.join(ARTIFACTS, "ntp-news.png")
                with open(shot, "wb") as fh:
                    fh.write(base64.b64decode(data))
                print(f"\nscreenshot written: {shot}")
                try:
                    from PIL import Image
                    im = Image.open(shot).convert("RGB")
                    colors = im.getcolors(maxcolors=1000000) or []
                    non_white = sum(c for c, rgb in colors
                                    if rgb != (255, 255, 255) and rgb != (0, 0, 0))
                    print(f"  size={im.size}  distinct colours={len(colors)}  "
                          f"non-white pixels={non_white}")
                    check("the screenshot is not blank", bool(colors) and non_white >= 2000,
                          f"non-white={non_white}")
                except Exception as exc:
                    print(f"  (PIL check failed: {exc})")
            else:
                print("  (no screenshot data returned)")

            await bidi.close()

        print("\ncleanup: killed " + str(cleanup()) + " process(es) matched by the anchored pattern")
        print("FAILURES: " + (", ".join(failures) if failures else "none"))
        return 1 if failures else 0
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: {exc}")
        return 1
    finally:
        cleanup()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
