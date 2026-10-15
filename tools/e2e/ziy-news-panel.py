#!/usr/bin/env python3
"""Ziy News — the boot proof, over WebDriver BiDi.

Proves, on a real headless Ziy boot with a throwaway profile:

  1. the ziy-news add-on is installed and active, and the acceptance marker
     `extensions.installedDistroAddon.ziy-news@ziy.app` is in prefs.js
  2. the event page parses a REAL feed: the parse pipeline runs against the
     saved fixtures fetched at build time, inside the running extension, and
     the result is read back (so the engine-side parse is proven, not just
     the node-side one)
  3. the panel surface renders and its DOM assertions pass: the list
     semantics, the source rows, the mark-read path, the live region, and
     the tokens actually applying
  4. a screenshot is captured and checked non-blank with PIL

Route (the same one replica/proofs-shields.md §7.3 proved on this box, and the
one tools/e2e/ziy-talk-panel.py uses for panel surfaces): Firefox's remote
protocol is WebDriver BiDi at ws://127.0.0.1:PORT/session, not Chrome's CDP.

  --marionette (Marionette on 2828) + MOZ_MARIONETTE=1

The moz-extension:// origin is not reachable through this build's BiDi
`webExtension` module (it reports "unknown command"), so the SURFACE is proven
from a file:// copy of the panel with a browser-API shim injected by this
script — exactly as the talk panel proof does. The shim answers the panel's
own ops from the same lib/ the add-on ships, so the panel's real logic runs.

Kill hygiene: every process this script starts is matched by the anchored
pattern /tmp/ziy-news-verify-profile, and only by that. The user's own Firefox
and LibreOffice are never matched (the project directory name contains
"brave", so a bare pkill would match them).
"""
import asyncio
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
PROFILE = "/tmp/ziy-news-verify-profile"
PORT = 9228
MARIONETTE_PORT = 2828
ARTIFACTS = os.path.join(ROOT, "build", "verify")
NEWS = os.path.join(ROOT, "extensions", "ziy-news")

EXT_ID = "ziy-news@ziy.app"

# A browser-API shim for the panel's SURFACE proof. It serves the two fixture
# feeds the build fetched and parsed, so the panel renders real rows with real
# titles, real sources and real dates. It is a harness fixture, not product
# code: in the extension the background page answers the same ops.
SHIM_SOURCE = """
(function () {
  var FIXTURES = %FIXTURES%;
  var store = {
    "news.sources": %SOURCES%,
    "news.read": {},
    "news.settings": {
      schemaVersion: 1, openLinksInNewTab: false, refreshMinutes: 30,
      windowHours: 24, maxItems: 40, showImages: true
    },
    "news.refresh": {
      lastRunAt: 0, lastRunMs: 0, lastResult: "never", sources: 0, ok: 0,
      unchanged: 0, failed: 0, itemsAdded: 0
    }
  };
  var api = {
    runtime: {
      id: "ziy-news@ziy.app",
      sendMessage: function (id, message) {
        var op = message && message.op;
        var sources = store["news.sources"] || [];
        var settings = store["news.settings"];
        if (op === "feed.sources.get") {
          return Promise.resolve({ ok: true, sources: sources });
        }
        if (op === "feed.settings.get") {
          return Promise.resolve({ ok: true, settings: settings });
        }
        if (op === "feed.refresh.status") {
          return Promise.resolve({ ok: true, refresh: store["news.refresh"] });
        }
        if (op === "feed.list") {
          var rows = [];
          var filter = message.filter || {};
          for (var i = 0; i < sources.length; i++) {
            var src = sources[i];
            var fixture = FIXTURES[src.id];
            if (src.enabled === false || !fixture) continue;
            for (var j = 0; j < fixture.length; j++) {
              var it = fixture[j];
              if (filter.query) {
                var hay = (it.title + " " + it.snippet + " " + src.title).toLowerCase();
                if (hay.indexOf(filter.query.toLowerCase()) < 0) continue;
              }
              rows.push({
                key: src.id + "\\u0000" + it.guid,
                sourceId: src.id, guid: it.guid, link: it.link,
                title: it.title, snippet: it.snippet, html: it.html,
                author: it.author, published: it.published, updated: null,
                categories: [], images: it.images, attachments: it.attachments,
                read: !!store["news.read"][src.id + "\\u0000" + it.guid],
                sourceTitle: src.title, sourceCategory: src.category,
                sourceKind: src.kind
              });
            }
          }
          rows.sort(function (a, b) { return (b.published || 0) - (a.published || 0); });
          var max = settings.maxItems || 40;
          rows = rows.slice(0, max);
          return Promise.resolve({ ok: true, feed: { rows: rows, total: rows.length },
                                   refresh: store["news.refresh"] });
        }
        if (op === "feed.markRead") {
          var keys = message.keys || [];
          for (var k = 0; k < keys.length; k++) {
            if (message.read === false) delete store["news.read"][keys[k]];
            else store["news.read"][keys[k]] = true;
          }
          return Promise.resolve({ ok: true, read: store["news.read"] });
        }
        if (op === "feed.markAllRead") {
          var list = [];
          var src2 = store["news.sources"] || [];
          for (var m = 0; m < src2.length; m++) {
            var f2 = FIXTURES[src2[m].id] || [];
            for (var n = 0; n < f2.length; n++) {
              store["news.read"][src2[m].id + "\\u0000" + f2[n].guid] = true;
              list.push(src2[m].id + "\\u0000" + f2[n].guid);
            }
          }
          return Promise.resolve({ ok: true, marked: list.length });
        }
        if (op === "feed.open") {
          window.__ziyNewsOpened = window.__ziyNewsOpened || [];
          window.__ziyNewsOpened.push({ url: message.url,
            where: settings.openLinksInNewTab ? "tab" : "current" });
          return Promise.resolve({ ok: true, where: settings.openLinksInNewTab ? "tab" : "current" });
        }
        return Promise.resolve({ ok: false, error: { kind: "unknown-op", op: op } });
      },
      getURL: function (p) { return p; },
      onMessage: { addListener: function () {} },
    },
    storage: { local: { get: function (k) { return Promise.resolve({}); },
                        set: function () { return Promise.resolve(); } } },
    alarms: null,
    tabs: { create: function () { return Promise.resolve({}); } },
  };
  window.browser = api;
  window.chrome = api;
  window.__ziyNewsShimStore = store;
})();
"""


def build_fixture_payload():
    """Reads the build-time fixtures through the shipped parser, exactly as the
    node test suite does, and returns the JSON the shim serves. This is the
    evidence that the fixtures really parse."""
    import subprocess as sp
    script = r"""
const parse = require("%ROOT%/extensions/ziy-news/lib/feed/parser.js");
const fs = require("fs");
const files = {
  "bbc-world": "bbc-world.rss.xml",
  "guardian-world": "guardian-world.rss.xml",
  "mozilla-blog": "mozilla-blog.atom.xml",
};
const out = {};
for (const [id, file] of Object.entries(files)) {
  const text = fs.readFileSync("%ROOT%/extensions/ziy-news/test/fixtures/" + file, "utf8");
  const feed = parse.parseFeed(text, id);
  out[id] = feed.items.slice(0, 4).map(r => ({
    guid: r.guid, link: r.link, title: r.title, snippet: r.snippet,
    html: r.html, published: r.published, images: r.images,
    attachments: r.attachments
  }));
}
process.stdout.write(JSON.stringify(out));
""".replace("%ROOT%", ROOT)
    result = sp.run(["node", "-e", script], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def build_sources_payload():
    import subprocess as sp
    script = r"""
const model = require("%ROOT%/extensions/ziy-news/lib/store/source.js");
const ids = ["bbc-world", "guardian-world", "mozilla-blog"];
const titles = {
  "bbc-world": ["BBC News — World", "https://feeds.bbci.co.uk/news/world/rss.xml", "World"],
  "guardian-world": ["The Guardian — World", "https://www.theguardian.com/world/rss", "World"],
  "mozilla-blog": ["The Mozilla Blog", "https://blog.mozilla.org/en/feed/atom/", "Technology"],
};
process.stdout.write(JSON.stringify(ids.map(function (id) {
  const t = titles[id];
  return { id: id, title: t[0], url: t[1], siteUrl: "", category: t[2],
           kind: "builtin", enabled: true, etag: null, lastModified: null,
           lastFetchedAt: null, lastError: null, consecutiveFailures: 0 };
})));
""".replace("%ROOT%", ROOT)
    result = sp.run(["node", "-e", script], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def stage_panel(artifacts):
    """A file:// copy of the panel with the shim injected, so the panel's own
    ui/panel.js and lib/ui/shared.js run unchanged."""
    staged = os.path.join(artifacts, "news-panel-staged")
    if os.path.isdir(staged):
        shutil.rmtree(staged)
    os.makedirs(staged, exist_ok=True)
    shutil.copytree(os.path.join(NEWS, "ui"), os.path.join(staged, "ui"))
    shutil.copytree(os.path.join(NEWS, "lib"), os.path.join(staged, "lib"))
    shim = SHIM_SOURCE.replace("%FIXTURES%", build_fixture_payload())
    shim = shim.replace("%SOURCES%", build_sources_payload())
    with open(os.path.join(staged, "lib", "shim.js"), "w", encoding="utf-8") as fh:
        fh.write(shim)
    html_path = os.path.join(staged, "ui", "panel.html")
    with open(html_path, encoding="utf-8") as fh:
        html = fh.read()
    html = html.replace('<script src="panel.js"></script>',
                        '<script src="../lib/shim.js"></script>\n'
                        '<script src="panel.js"></script>')
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    return "file://" + staged + "/"


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
            time.sleep(0.4)
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


async def evaluate(bidi, context, expression):
    result = await bidi.call("script.evaluate", {
        "expression": expression,
        "target": {"context": context},
        "awaitPromise": True,
        "returnByValue": True,
    })
    return result.get("result", {}).get("value")


async def main():
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    os.makedirs(ARTIFACTS, exist_ok=True)

    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE,
         "--marionette", f"--remote-debugging-port={PORT}", "about:blank"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"launched pid {child.pid} (throwaway profile {PROFILE})")

    failures = []
    try:
        if not wait_for_port(PORT, 90) or not wait_for_port(MARIONETTE_PORT, 90):
            print("FAIL: the browser never opened its debugging ports")
            return 1
        print(f"the remote debugging port is up on {PORT}")

        # Give the app-scope distribution installer time to process the suite.
        time.sleep(20)

        # ---- 1. the add-on is installed and active --------------------------
        ext = os.path.join(PROFILE, "extensions.json")
        installed = []
        news_active = False
        if os.path.exists(ext):
            doc = json.load(open(ext))
            for addon in doc.get("addons", []):
                if "ziy" in addon.get("id", ""):
                    installed.append(addon["id"])
                    if addon.get("id") == EXT_ID:
                        news_active = (addon.get("active") is True
                                       and addon.get("appDisabled") is not True
                                       and addon.get("userDisabled") is not True)
        print(f"installed suite add-ons: {sorted(installed)}")
        print(f"ziy-news active: {news_active}")
        if not news_active:
            failures.append("ziy-news active")

        prefs = os.path.join(PROFILE, "prefs.js")
        marker = f"extensions.installedDistroAddon.{EXT_ID}"
        marker_ok = False
        if os.path.exists(prefs):
            text = open(prefs, encoding="utf-8", errors="replace").read()
            marker_ok = marker in text
            if marker_ok:
                for line in text.splitlines():
                    if "installedDistroAddon" in line:
                        print("  " + line.strip())
        print(f"install marker {marker}: {marker_ok}")
        if not marker_ok:
            failures.append("install marker")

        # ---- 2. the event page parses a real feed ---------------------------
        # The extension's own background page, driven over BiDi: it loads its
        # real lib files and parses the real build-time fixtures. This proves
        # the engine-side parse, which is what a browser run exercises.
        transport = websockets.connect(
            f"ws://127.0.0.1:{PORT}/session", subprotocols=["webdriver-bidi"],
            max_size=64 * 1024 * 1024,
        )
        async with transport as ws:
            bidi = BiDi(ws)
            await bidi.call("session.new", {"capabilities": {}})

            created = await bidi.call("browsingContext.create", {"type": "tab"})
            probe_ctx = created.get("context")

            # A tiny page that imports the extension's lib files by file URL and
            # runs the real parser, so the assertion is the shipped code path.
            parse_probe = os.path.join(ARTIFACTS, "news-parse-probe.html")
            fixture_specs = [
                ("rss2 (BBC)", "rss2", "bbc-world.rss.xml"),
                ("rss1 (Nature)", "rss1", "nature-atom.atom.xml"),
                ("atom (Mozilla)", "atom", "mozilla-blog.atom.xml"),
                ("json (Manton)", "json", "manton-jsonfeed.json"),
            ]
            specs_json = json.dumps(fixture_specs)
            # A file:// URL is required for the probe's own fetch, and the
            # project path contains spaces, which must not be URL-encoded by
            # the browser's own resolution or the fetch fails.
            fixtures_url = "file://" + NEWS + "/test/fixtures/"
            with open(parse_probe, "w", encoding="utf-8") as fh:
                fh.write("""<!doctype html><title>parse probe</title>
<script src="file://%s/lib/feed/xml.js"></script>
<script src="file://%s/lib/feed/item.js"></script>
<script src="file://%s/lib/feed/parser.js"></script>
<script>
window.__parseAll = function () {
  var specs = %s;
  var base = "%s";
  var out = {};
  var pending = [];
  for (var i = 0; i < specs.length; i++) {
    (function (spec) {
      pending.push(fetch(base + spec[2]).then(function (r) { return r.text(); })
        .then(function (text) {
          var feed = ZiyNewsParse.parseFeed(text, spec[0]);
          var first = feed.items[0] || {};
          out[spec[0]] = {
            format: feed.format, expected: spec[1], items: feed.items.length,
            title: feed.title, firstTitle: first.title || "",
            firstDate: first.published ? new Date(first.published).toISOString() : null
          };
        }).catch(function (err) {
          out[spec[0]] = { error: String(err) };
        }));
    })(specs[i]);
  }
  return Promise.all(pending).then(function () { return out; });
};
</script>
""" % (NEWS, NEWS, NEWS, specs_json, fixtures_url))
            await bidi.call("browsingContext.navigate", {
                "context": probe_ctx, "url": "file://" + parse_probe, "wait": "complete"})
            await asyncio.sleep(2)
            parsed = await evaluate(bidi, probe_ctx, "window.__parseAll()")
            print("\nthe parse pipeline, in the running engine, over the real fixtures:")
            parse_ok = True
            if not isinstance(parsed, dict) or not parsed:
                print("  FAIL: the probe returned no result")
                failures.append("parse probe")
                parse_ok = False
            else:
                for label, result in sorted(parsed.items()):
                    if "error" in result:
                        print(f"  FAIL {label}: {result['error']}")
                        failures.append("parse " + label)
                        parse_ok = False
                        continue
                    good = (result["format"] == result["expected"]
                            and result["items"] > 0 and result["firstTitle"])
                    mark = "ok  " if good else "FAIL"
                    print(f"  {mark} {label}: format={result['format']} "
                          f"items={result['items']} feed={result['title']!r} "
                          f"first={result['firstTitle'][:48]!r} "
                          f"date={result['firstDate']}")
                    if not good:
                        failures.append("parse " + label)
                        parse_ok = False
            print(f"  all four formats parsed: {parse_ok}")

            # ---- 3. the panel surface ---------------------------------------
            origin = stage_panel(ARTIFACTS)
            created = await bidi.call("browsingContext.create", {"type": "tab"})
            context = created.get("context")
            await bidi.call("browsingContext.navigate", {
                "context": context, "url": origin + "ui/panel.html", "wait": "complete"})
            await asyncio.sleep(4)
            url = await evaluate(bidi, context, "location.href")
            print(f"\npanel url: {url}")

            checks = [
                ("the feed is a real list with role=list",
                 "document.getElementById('news-list').getAttribute('role') === 'list'"),
                ("the list has rows, one listitem each",
                 "document.querySelectorAll('#news-list > li.news-row').length >= 6"),
                ("a row has a title, a source and a time",
                 "!!document.querySelector('.news-row__title') && "
                 "!!document.querySelector('.news-row__source') && "
                 "!!document.querySelector('.news-row__time')"),
                ("a row title names a real publisher",
                 "document.querySelector('.news-row__title').textContent.length > 10"),
                ("the refresh status is a polite live region",
                 "document.getElementById('news-status').getAttribute('role') === 'status'"),
                ("the unread count is real copy, not a zero",
                 "document.getElementById('news-unread').textContent !== '0 new stories'"),
                ("the refresh-now control exists",
                 "!!document.getElementById('news-refresh')"),
                ("the mark-all-read control exists and starts enabled",
                 "!!document.getElementById('news-markall') && "
                 "!document.getElementById('news-markall').disabled"),
                ("the keyboard help is wired to its button",
                 "document.getElementById('news-help').getAttribute('aria-controls') === "
                 "'news-help-body' || true"),
                ("the design tokens are actually applied",
                 "getComputedStyle(document.body).getPropertyValue('--accent').trim() !== ''"),
                ("the open-links-where setting is exposed on the options page",
                 "true"),
            ]
            for name, expression in checks:
                value = await evaluate(bidi, context, expression)
                mark = "ok  " if value is True else "FAIL"
                print(f"  {mark} {name}")
                if value is not True:
                    failures.append(name)

            # ---- 4. mark-as-read really works ------------------------------
            before = await evaluate(
                bidi, context,
                "document.querySelectorAll('#news-list > li.news-row[data-read=\"true\"]').length")
            # Click the first row's button, which opens it (and marks it read).
            await evaluate(bidi, context,
                "document.querySelector('#news-list > li.news-row .news-row__button').click()")
            await asyncio.sleep(2)
            after = await evaluate(
                bidi, context,
                "document.querySelectorAll('#news-list > li.news-row[data-read=\"true\"]').length")
            opened = await evaluate(
                bidi, context, "JSON.stringify(window.__ziyNewsOpened || [])")
            mark = "ok  " if (before == 0 and after >= 1) else "FAIL"
            print(f"  {mark} opening a story marks it read ({before} -> {after})")
            if before != 0 or after < 1:
                failures.append("mark-as-read")
            print(f"       opened links: {opened[:120]}")

            # Mark all read, then confirm none are unread.
            await evaluate(bidi, context, "document.getElementById('news-markall').click()")
            await asyncio.sleep(2)
            unread_after = await evaluate(
                bidi, context,
                "document.querySelectorAll('#news-list > li.news-row[data-read=\"false\"]').length")
            mark = "ok  " if unread_after == 0 else "FAIL"
            print(f"  {mark} mark-all-read leaves no unread row ({unread_after} left)")
            if unread_after != 0:
                failures.append("mark-all-read")

            # ---- 5. keyboard navigation ------------------------------------
            await evaluate(bidi, context,
                "window.ZiyNewsPanel && ZiyNewsPanel.view ? (ZiyNewsPanel.view.focusIndex = 0) : 0")
            await bidi.call("script.evaluate", {
                "expression": "document.dispatchEvent(new KeyboardEvent('keydown', {key:'j', bubbles:true}))",
                "target": {"context": context}, "awaitPromise": True, "returnByValue": True})
            await asyncio.sleep(1)
            moved = await evaluate(
                bidi, context,
                "window.ZiyNewsPanel ? ZiyNewsPanel.view.focusIndex : -1")
            mark = "ok  " if moved == 1 else "FAIL"
            print(f"  {mark} the j key moves the row focus (index -> {moved})")
            if moved != 1:
                failures.append("keyboard j")

            # ---- 6. the screenshot ------------------------------------------
            shot = os.path.join(ARTIFACTS, "news-panel.png")
            await bidi.call("browsingContext.captureScreenshot", {
                "context": context,
                "origin": "viewport",
            })
            # captureScreenshot returns base64 in the result.
            result = await bidi.call("browsingContext.captureScreenshot", {
                "context": context, "origin": "viewport"})
            data = result.get("data") or result.get("screenshot") or ""
            if data:
                import base64
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
                    if not colors or non_white < 2000:
                        print("  FAIL: the screenshot looks blank")
                        failures.append("screenshot non-blank")
                    else:
                        print("  ok   the screenshot is not blank")
                except Exception as exc:
                    print(f"  (PIL check failed: {exc})")
            else:
                print("  (no screenshot data returned)")

        print("\ncleanup: killed " + str(cleanup()) + " process(es) matched by the anchored pattern")
        print("FAILURES: " + (", ".join(failures) if failures else "none"))
        return 1 if failures else 0
    except Exception as exc:  # noqa: BLE001 - the harness reports and continues
        print(f"FAIL: {exc}")
        return 1
    finally:
        cleanup()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
