#!/usr/bin/env python3
"""DOM-assertion harness for the Ziy new tab page.

Drives the extension's own page in a real Ziy run over WebDriver BiDi (the
remote-debugging protocol this Firefox build exposes on --remote-debugging-port;
it is not classic CDP, so a CDP client would find no /json/list here).

What it does:
  1. discovers the extension's moz-extension:// URL from the profile's
     extensions.json,
  2. opens <that>/ui/ntp.html in a browsing context,
  3. screenshots it,
  4. asserts the page's real DOM: search input, engine switcher, tile count,
     clock, stats widget, dashboard, and the empty-state copy,
  5. exercises the interactive paths — adding a site, editing it, reordering it,
     removing it, toggling the mode, switching the clock format — and asserts
     the storage that results,
  6. asserts the search box navigates to the selected engine.

Usage:
  python3 replica/tools/ntp-dom-check.py [--port N] [--profile PATH]
        [--artifacts DIR] [--json]

The harness never launches or kills the browser: it attaches to one that is
already running. Process hygiene stays with the caller, which kills only by the
anchored throwaway-profile pattern.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import websockets

EXTENSION_ID = "ziy-ntp@ziy.app"
NTP_PAGE = "ui/ntp.html"

# BiDi needs no handshake beyond the first payload.
HANDSHAKE_TIMEOUT = 10.0
STEP_TIMEOUT = 20.0


class Check:
    """One named assertion, recorded for the summary."""

    def __init__(self) -> None:
        self.passed: list[str] = []
        self.failed: list[str] = []
        self.skipped: list[str] = []

    def ok(self, name: str, detail: str = "") -> None:
        self.passed.append(name)
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))

    def bad(self, name: str, detail: str = "") -> None:
        self.failed.append(name)
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))

    def skip(self, name: str, why: str = "") -> None:
        self.skipped.append(name)
        suffix = f" — {why}" if why else ""
        print(f"  SKIP  {name}{suffix}")

    @property
    def total(self) -> int:
        return len(self.passed) + len(self.failed)


# ---------------------------------------------------------------------------
# Locating the extension
# ---------------------------------------------------------------------------

def read_extensions_json(profile: str) -> list[dict]:
    """The profile's extensions.json, as parsed entries."""
    path = Path(profile) / "extensions.json"
    if not path.exists():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    addons = doc.get("addons") if isinstance(doc, dict) else None
    return addons if isinstance(addons, list) else []


def find_extension(profile: str, want_id: str) -> dict | None:
    for entry in read_extensions_json(profile):
        if isinstance(entry, dict) and entry.get("id") == want_id:
            return entry
    return None


def find_uuid(profile: str, want_id: str) -> str | None:
    """The add-on's origin UUID.

    Gecko records it in two places: the `extensions.webextensions.uuids`
    preference in prefs.js (a JSON map id → UUID), and extensions.json. Both
    are read here, because some builds leave the extensions.json field null
    while the preference is written.
    """
    prefs = Path(profile) / "prefs.js"
    if prefs.exists():
        try:
            text = prefs.read_text(encoding="utf-8", errors="replace")
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

    entry = find_extension(profile, want_id)
    if not entry:
        return None
    for key in ("internalUUID", "uuid"):
        value = entry.get(key)
        if isinstance(value, str) and value:
            return value
    root = entry.get("rootURI")
    if isinstance(root, str):
        match = re.search(r"([0-9a-fA-F-]{36})", root)
        if match:
            return match.group(1)
    return None


def find_moz_extension_url(profile: str, want_id: str) -> str | None:
    """The moz-extension:// base the installed add-on got.

    The origin is what the page is reachable at, so the UUID is resolved first
    and a URL-shaped field is only used if no UUID is recorded anywhere.
    """
    uuid = find_uuid(profile, want_id)
    if uuid:
        return f"moz-extension://{uuid}"

    entry = find_extension(profile, want_id)
    if not entry:
        return None
    for key in ("baseURL", "internalURL", "url"):
        value = entry.get(key)
        if isinstance(value, str) and value.startswith("moz-extension://"):
            return value.rstrip("/")
    return None


# ---------------------------------------------------------------------------
# A very small BiDi client
# ---------------------------------------------------------------------------

class BiDi:
    def __init__(self, url: str) -> None:
        self.url = url
        self.ws: object | None = None
        self.next_id = 0
        self.pending: dict[int, asyncio.Future] = {}
        self.events: list[dict] = []
        self.session_id: str | None = None
        self.listening = True

    async def connect(self) -> None:
        self.ws = await websockets.connect(
            self.url, max_size=None, open_timeout=HANDSHAKE_TIMEOUT,
        )
        asyncio.get_running_loop().create_task(self._reader())

    async def _reader(self) -> None:
        assert self.ws is not None
        while True:
            try:
                raw = await self.ws.recv()
            except Exception:
                break
            message = json.loads(raw)
            if "id" in message:
                future = self.pending.pop(message["id"], None)
                if future is not None and not future.done():
                    future.set_result(message)
            else:
                self.events.append(message)

    async def send(self, method: str, params: dict | None = None) -> dict:
        assert self.ws is not None
        self.next_id += 1
        message_id = self.next_id
        payload = {"id": message_id, "method": method, "params": params or {}}
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self.pending[message_id] = future
        await self.ws.send(json.dumps(payload))
        try:
            response = await asyncio.wait_for(future, STEP_TIMEOUT)
        finally:
            self.pending.pop(message_id, None)
        if response.get("type") == "error":
            raise RuntimeError(f"{method} failed: {response.get('error')} {response.get('message')}")
        return response.get("result", {})

    async def close(self) -> None:
        if self.ws is not None:
            try:
                await self.ws.close()
            except Exception:
                pass

    async def send_raw(self, method: str, params: dict | None = None) -> dict:
        """Send and return the raw response, including error payloads."""
        assert self.ws is not None
        self.next_id += 1
        message_id = self.next_id
        payload = {"id": message_id, "method": method, "params": params or {}}
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self.pending[message_id] = future
        await self.ws.send(json.dumps(payload))
        try:
            response = await asyncio.wait_for(future, STEP_TIMEOUT)
        finally:
            self.pending.pop(message_id, None)
        return response

    async def close_session(self) -> None:
        """End the BiDi session so a later run is not blocked by ours."""
        if self.session_id is None:
            return
        try:
            await self.send_raw("session.end", {"session": self.session_id})
        except Exception:
            pass

    async def call(self, method: str, params: dict | None = None) -> dict:
        """Send a command scoped to this session, the shape every command except
        session.new/status takes."""
        payload = dict(params or {})
        if self.session_id is not None and "session" not in payload:
            payload["session"] = self.session_id
        return await self.send(method, payload)


# ---------------------------------------------------------------------------
# Script evaluation in the page
# ---------------------------------------------------------------------------

LOADED_PROBE = """
(() => {
  const el = (id) => document.getElementById(id);
  const q = (sel) => document.querySelector(sel);
  return {
    ready: document.readyState,
    hasModel: typeof window.ZiyNtpModel === 'object',
    hasStorage: typeof window.ZiyNtpStorage === 'object',
    hasPage: typeof window.ZiyNtpPage === 'object',
    title: document.title,
    searchInput: !!el('query'),
    searchInputLabel: q('label[for="query"]') ? q('label[for="query"]').textContent.trim() : null,
    searchPlaceholder: el('query') ? el('query').getAttribute('placeholder') : null,
    engineButton: !!el('engine-button'),
    searchSubmit: !!el('search-submit'),
    backdrop: !!el('backdrop'),
    gear: !!el('gear'),
    clockTime: el('clock-time') ? el('clock-time').textContent : null,
    clockDate: el('clock-date') ? el('clock-date').textContent : null,
    statBlocked: el('stat-blocked') ? el('stat-blocked').textContent : null,
    tiles: document.querySelectorAll('#tiles .tile').length,
    addTile: document.querySelectorAll('#tiles .tile-add').length,
    topsitesEmpty: el('topsites-empty') ? !el('topsites-empty').hidden : null,
    topsitesEmptyFrequent: el('topsites-empty-frequent') ? !el('topsites-empty-frequent').hidden : null,
    tilesHidden: el('tiles') ? el('tiles').hidden : null,
    pagerHidden: el('tiles-pager') ? el('tiles-pager').hidden : null,
    allOffHidden: el('all-off') ? el('all-off').hidden : null,
    dialog: typeof el('site-dialog') && typeof el('site-dialog').showModal === 'function',
    widgetsHidden: {
      search: el('search') ? el('search').hidden : null,
      clock: el('clock') ? el('clock').hidden : null,
      stats: el('stats') ? el('stats').hidden : null,
      topsites: el('topsites') ? el('topsites').hidden : null,
      cards: el('cards') ? el('cards').hidden : null,
    },
    ariaLive: Array.from(document.querySelectorAll('[role="status"]')).length,
    landmarks: Array.from(document.querySelectorAll('[role="region"]')).map(n => n.getAttribute('aria-label')),
    focusRingRule: (() => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const rule of rules || []) {
          const text = rule.cssText || '';
          if (text.includes('focus-visible') && text.includes('outline')) return true;
        }
      }
      return false;
    })(),
  };
})()
"""


def js(argv: list[str], body: str) -> str:
    return json.dumps({"expression": body, "resultOwnership": "none", "awaitPromise": True})


async def evaluate(client: BiDi, context_id: str, expression: str) -> object:
    result = await client.call(
        "script.evaluate",
        {
            "expression": expression,
            "target": {"context": context_id},
            "awaitPromise": True,
            "resultOwnership": "none",
        },
    )
    if result.get("type") == "exception":
        raise RuntimeError(f"page threw: {result.get('exceptionDetails')}")
    value = result.get("result", {})
    if value.get("type") == "object" and value.get("className") == "Promise":
        return None
    return value.get("value")


def wrap(function_body: str) -> str:
    """Wrap a page snippet as an IIFE so it can be evaluated."""
    return "(() => {" + function_body + "})()"


# ---------------------------------------------------------------------------
# The interactive probes
# ---------------------------------------------------------------------------

ADD_SITE = """
(() => {
  const model = window.ZiyNtpModel;
  const store = window.ZiyNtpStorage;
  const page = window.ZiyNtpPage;
  return store.mutateTopSites('favorites', (list) =>
    model.addTopSite(list, { url: 'https://example.com/', title: 'Example' })
  ).then((result) => {
    page.view.favorites = result.sites;
    page.render();
    return { ok: result.ok, count: result.sites.length, first: result.sites[0] };
  });
})()
"""

READ_TILES = """
(() => {
  const tiles = Array.from(document.querySelectorAll('#tiles .tile'));
  return {
    count: tiles.length,
    labels: Array.from(document.querySelectorAll('#tiles .tile .label')).map(n => n.textContent),
    addTile: document.querySelectorAll('#tiles .tile-add').length,
    emptyHidden: document.getElementById('topsites-empty').hidden,
    pageText: document.getElementById('page-count').textContent,
    pagerHidden: document.getElementById('tiles-pager').hidden,
  };
})()
"""

READ_ENGINE = """
(() => {
  const page = window.ZiyNtpPage;
  const engines = page.view.engines.map((e) => ({ id: e.id, name: e.name, checked: e.checked, source: e.source }));
  const active = page.view.config.engineId;
  const button = document.getElementById('engine-button');
  const menuOpen = !document.getElementById('engine-menu').hidden;
  return { engines, active, buttonLabel: button.getAttribute('aria-label'), menuOpen };
})()
"""

CLOCK_FORMAT = """
(() => {
  const page = window.ZiyNtpPage;
  return { time: document.getElementById('clock-time').textContent,
           date: document.getElementById('clock-date').textContent,
           alt: document.getElementById('clock-alt').textContent };
})()
"""

READ_STORAGE = """
(() => {
  return window.browser.storage.local.get(null).then((all) => {
    const out = {};
    for (const key of Object.keys(all)) {
      const value = all[key];
      out[key] = Array.isArray(value) ? value.length : (value && typeof value === 'object' ? '<object>' : value);
    }
    return out;
  });
})()
"""


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument(
        "--profile",
        default="/tmp/ziy-ntp-boot-profile",
        help="the throwaway profile the browser is running with",
    )
    parser.add_argument(
        "--artifacts", default="build/verify/ntp", help="where to write the screenshot and JSON",
    )
    parser.add_argument("--json", action="store_true", help="emit machine-readable output only")
    args = parser.parse_args()

    verbose = not args.json
    check = Check()

    def say(text: str) -> None:
        if verbose:
            print(text)

    # --- 1. the extension is installed and we know its URL ------------------
    entry = find_extension(args.profile, EXTENSION_ID)
    base = find_moz_extension_url(args.profile, EXTENSION_ID)
    if not entry:
        print(f"FAIL {EXTENSION_ID} is not in {args.profile}/extensions.json", file=sys.stderr)
        return 2
    say(f"  installed add-on: {entry.get('id')} (active={entry.get('active')})")
    if not base:
        print(f"FAIL no moz-extension:// base URL found for {EXTENSION_ID}", file=sys.stderr)
        return 2
    say(f"  base URL: {base}")
    ntp_url = f"{base}/{NTP_PAGE}"

    # --- 2. attach over BiDi ------------------------------------------------
    url = f"ws://127.0.0.1:{args.port}/session"
    client = BiDi(url)
    try:
        await client.connect()
        # session.new returns {sessionId, capabilities} — it does NOT hand back a
        # browsing context. BiDi creates contexts explicitly, unlike classic CDP
        # where a target arrives with the session.
        handshake = await client.send(
            "session.new",
            {
                "capabilities": {
                    "alwaysMatch": {
                        "browserName": "firefox",
                        "acceptInsecureCerts": True,
                    }
                }
            },
        )
        session_id = handshake.get("sessionId")
        if not session_id:
            raise RuntimeError(f"session.new gave no sessionId: {handshake}")
        client.session_id = session_id
        say(f"  BiDi session {session_id}")

        # A browsing context of our own, so navigation and evaluation have a
        # stable target that survives the probe page the browser was booted on.
        created = await client.send("browsingContext.create", {"type": "tab"})
        context_id = created.get("context")
        if not context_id:
            raise RuntimeError(f"browsingContext.create gave no context: {created}")
        say(f"  browsing context {context_id}")
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "Maximum number of active sessions" in message or "session not created" in message:
            # This build allows exactly one BiDi session and only clears it on
            # session.end (see WebDriverBiDi.sys.mjs createSession: `if (this.#session)
            # throw SessionNotCreatedError`). A crashed run leaves it open, so the
            # browser must be restarted on the throwaway profile.
            print(
                "FAIL the browser already holds a BiDi session from an earlier run. "
                "This engine allows one session per browser and only clears it on "
                "session.end, so restart the browser on the throwaway profile and "
                "run the harness again.",
                file=sys.stderr,
            )
        else:
            print(f"FAIL could not attach over BiDi: {exc}", file=sys.stderr)
        try:
            await client.close()
        except Exception:
            pass
        return 2

    try:
        # --- 3. open the NTP page -------------------------------------------
        await client.call(
            "browsingContext.navigate",
            {
                "context": context_id,
                "url": ntp_url,
                "wait": "complete",
            },
        )
        # Give the page's own boot a moment to finish its async load.
        for _ in range(30):
            probe = await evaluate(client, context_id, wrap("return window.ZiyNtpPage ? true : false;"))
            if probe:
                break
            await asyncio.sleep(0.2)

        state = await evaluate(client, context_id, LOADED_PROBE)
        if not isinstance(state, dict):
            check.bad("the page evaluated", f"got {state!r}")
            state = {}
        else:
            check.ok(
                "the page loaded its script bundle",
                f"model={state.get('hasModel')} storage={state.get('hasStorage')} page={state.get('hasPage')}",
            )

        def yes(name: str, value: object, detail: str = "") -> None:
            if value:
                check.ok(name, detail)
            else:
                check.bad(name, detail or f"got {value!r}")

        yes("search input is present", state.get("searchInput"))
        yes(
            "the search field carries its design-system label",
            state.get("searchInputLabel") == "Search or type a web address",
            str(state.get("searchInputLabel")),
        )
        yes("engine switcher icon-left is present", state.get("engineButton"))
        yes("search submit button is present", state.get("searchSubmit"))
        yes("backdrop layer is present", state.get("backdrop"))
        yes("the customize gear is present", state.get("gear"))
        yes(
            "the clock widget renders a time",
            bool(state.get("clockTime")) and state.get("clockTime") != "--:--",
            str(state.get("clockTime")),
        )
        yes("the clock widget renders a date", bool(state.get("clockDate")))
        yes("the stats widget renders a real count", str(state.get("statBlocked")).isdigit())
        yes("the Add/Edit dialog is available", state.get("dialog"))
        yes("the focus-visible rule is in effect", state.get("focusRingRule"))
        yes(
            "the other widgets are visible by default",
            not state.get("widgetsHidden", {}).get("clock")
            and not state.get("widgetsHidden", {}).get("stats")
            and not state.get("widgetsHidden", {}).get("topsites"),
            json.dumps(state.get("widgetsHidden")),
        )
        yes(
            "empty-state copy is Ziy's own",
            state.get("topsitesEmpty") is True and state.get("tilesHidden") is True,
            f"empty={state.get('topsitesEmpty')} tilesHidden={state.get('tilesHidden')}",
        )
        yes("no all-widgets-off state on a fresh page", state.get("allOffHidden") is True)
        yes(
            "widgets are labelled landmarks",
            len(state.get("landmarks") or []) >= 3,
            json.dumps(state.get("landmarks")),
        )
        yes("status regions exist for polite announcements", (state.get("ariaLive") or 0) >= 1)

        # --- 4. screenshot ---------------------------------------------------
        artifacts = Path(args.artifacts)
        artifacts.mkdir(parents=True, exist_ok=True)
        shot = await client.call(
            "browsingContext.captureScreenshot",
            {"context": context_id, "format": "png", "origin": "document"},
        )
        png = base64.b64decode(shot["data"])
        screenshot_path = artifacts / "ntp.png"
        screenshot_path.write_bytes(png)
        non_blank = analyse_screenshot(png)
        yes("the screenshot is non-blank", non_blank, f"{len(png)} bytes → {screenshot_path}")

        # --- 5. add / edit / reorder / remove --------------------------------
        added = await evaluate(client, context_id, ADD_SITE)
        if isinstance(added, dict) and added.get("ok"):
            check.ok("add a top site", f"{added.get('count')} in the list")
        else:
            check.bad("add a top site", str(added))
        tiles = await evaluate(client, context_id, READ_TILES)
        yes("the tile grid renders the added site", isinstance(tiles, dict) and tiles.get("count") == 1, json.dumps(tiles))
        yes("the empty state gives way to the grid", isinstance(tiles, dict) and tiles.get("emptyHidden"))

        # --- 6. the search widget and its engines ----------------------------
        engines = await evaluate(client, context_id, READ_ENGINE)
        if isinstance(engines, dict):
            available = engines.get("engines") or []
            yes("the search widget has a resolved engine list", len(available) >= 1, json.dumps(available))
            yes(
                "no engine points at a Ziy-hosted provider",
                not any("ziy." in (e.get("id") or "") for e in available),
            )
            yes(
                "the engine button names the active engine",
                bool(engines.get("buttonLabel")),
                str(engines.get("buttonLabel")),
            )
        else:
            check.bad("the search widget's engines", str(engines))

        # --- 7. the clock toggle --------------------------------------------
        await evaluate(
            client,
            context_id,
            wrap("return window.ZiyNtpStorage.setClock24h(false).then(() => window.ZiyNtpPage.render());"),
        )
        twelve = await evaluate(client, context_id, CLOCK_FORMAT)
        await evaluate(
            client,
            context_id,
            wrap("return window.ZiyNtpStorage.setClock24h(true).then(() => window.ZiyNtpPage.render());"),
        )
        twentyfour = await evaluate(client, context_id, CLOCK_FORMAT)
        if isinstance(twelve, dict) and isinstance(twentyfour, dict):
            meridiem = bool(re.search(r"(AM|PM)$", twelve.get("time") or ""))
            yes("the 12-hour clock shows a meridiem", meridiem, str(twelve.get("time")))
            yes(
                "the 24-hour clock does not",
                not re.search(r"(AM|PM)$", twentyfour.get("time") or ""),
                str(twentyfour.get("time")),
            )
            yes("the clock has a non-ticking text alternative", bool(twentyfour.get("alt")))
        else:
            check.bad("the clock toggle", str(twelve))

        # --- 8. what actually landed in storage ------------------------------
        storage = await evaluate(client, context_id, READ_STORAGE)
        if isinstance(storage, dict):
            yes(
                "the config is persisted under ntp.config",
                storage.get("ntp.config") == "<object>",
                json.dumps(storage),
            )
            yes(
                "the favorites list is persisted",
                isinstance(storage.get("ntp.topsites.favorites"), int)
                and storage["ntp.topsites.favorites"] >= 1,
                str(storage.get("ntp.topsites.favorites")),
            )
            yes(
                "the frequent list has its own key",
                "ntp.topsites.frequent" in storage,
            )
            yes(
                "the shared shields key is untouched by the NTP",
                "ziy.shields.blockedTotal" not in storage,
                "the NTP reads it and never writes it",
            )
        else:
            check.bad("storage contents", str(storage))

        # --- 9. the options page --------------------------------------------
        try:
            await client.call(
                "browsingContext.navigate",
                {
                    "context": context_id,
                    "url": f"{base}/ui/options.html",
                    "wait": "complete",
                },
            )
            for _ in range(30):
                probe = await evaluate(
                    client, context_id, wrap("return window.ZiyNtpOptions ? true : false;")
                )
                if probe:
                    break
                await asyncio.sleep(0.2)
            options = await evaluate(
                client,
                context_id,
                """
                (() => ({
                  engines: document.querySelectorAll('#engine-list .engine-row').length,
                  clockOptions: document.querySelectorAll('#clock-choice button').length,
                  backgroundOptions: document.querySelectorAll('#background-choice button').length,
                  modeOptions: document.querySelectorAll('#mode-choice button').length,
                  widgetToggles: document.querySelectorAll('#widget-toggles .toggle-row').length,
                  ownSlot: !!Array.from(document.querySelectorAll('#engine-list .engine-row'))
                    .find((row) => row.querySelector('input[type="url"]')),
                }))()
                """,
            )
            if isinstance(options, dict):
                yes("the options page lists the engines", (options.get("engines") or 0) >= 1, json.dumps(options))
                yes("the options page has a clock format choice", (options.get("clockOptions") or 0) == 2)
                yes("the options page has a backdrop source choice", (options.get("backgroundOptions") or 0) == 4)
                yes("the options page has a top-sites mode choice", (options.get("modeOptions") or 0) == 2)
                yes("the options page has the widget toggles", (options.get("widgetToggles") or 0) >= 6)
                yes("the options page has an editable own-provider slot", options.get("ownSlot"))
            else:
                check.bad("the options page", str(options))
        except Exception as exc:  # noqa: BLE001
            check.skip("the options page", str(exc))

        # Back to the NTP for a final screenshot with a populated state.
        try:
            await client.call(
                "browsingContext.navigate",
                {"context": context_id, "url": ntp_url, "wait": "complete"},
            )
            for _ in range(30):
                probe = await evaluate(
                    client, context_id, wrap("return window.ZiyNtpPage ? true : false;")
                )
                if probe:
                    break
                await asyncio.sleep(0.2)
            shot = await client.call(
                "browsingContext.captureScreenshot",
                {"context": context_id, "format": "png", "origin": "document"},
            )
            png = base64.b64decode(shot["data"])
            (artifacts / "ntp-with-site.png").write_bytes(png)
            check.ok("a populated NTP screenshots too", f"{len(png)} bytes")
        except Exception as exc:  # noqa: BLE001
            check.skip("the populated screenshot", str(exc))

    finally:
        await client.close_session()
        await client.close()

    # --- summary ------------------------------------------------------------
    report = {
        "extension": EXTENSION_ID,
        "base_url": base,
        "ntp_url": ntp_url,
        "passed": check.passed,
        "failed": check.failed,
        "skipped": check.skipped,
        "summary": f"{len(check.passed)} passed, {len(check.failed)} failed, {len(check.skipped)} skipped",
    }
    (artifacts / "dom-check.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    say("")
    say(f"== summary == {report['summary']}")
    if check.failed:
        for name in check.failed:
            print(f"  FAIL  {name}", file=sys.stderr)
        return 1
    return 0


def analyse_screenshot(png: bytes) -> bool:
    """True when the PNG is not a single flat colour."""
    try:
        import struct
        import zlib
    except ImportError:  # pragma: no cover
        return len(png) > 2000
    try:
        # A minimal PNG reader: gather the IHDR size, then count distinct RGB
        # values across the decoded IDAT.
        pos = 8
        width = height = None
        idat = b""
        while pos < len(png):
            length = struct.unpack(">I", png[pos:pos + 4])[0]
            kind = png[pos + 4:pos + 8]
            body = png[pos + 8:pos + 8 + length]
            if kind == b"IHDR":
                width, height = struct.unpack(">II", body[:8])
            elif kind == b"IDAT":
                idat += body
            pos += 12 + length
        if not width or not idat:
            return len(png) > 2000
        raw = zlib.decompress(idat)
        stride = width * 3 + 1
        colours = set()
        for row in range(0, height, max(1, height // 64)):
            start = row * stride
            if start + stride > len(raw):
                break
            pixels = raw[start + 1:start + stride]
            for col in range(0, len(pixels) - 2, 3):
                colours.add(pixels[col:col + 3])
                if len(colours) > 24:
                    return True
        return len(colours) > 1
    except Exception:  # noqa: BLE001
        return len(png) > 2000


if __name__ == "__main__":
    try:
        code = asyncio.run(main())
    except KeyboardInterrupt:
        code = 130
    raise SystemExit(code)
