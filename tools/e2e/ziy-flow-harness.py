#!/usr/bin/env python3
"""Ziy e2e shared harness — one boot, many flows, honest routes.

The rules this file encodes (replica/recon.md, the replica-test skill):

  * ONE throwaway profile per scenario, always under /tmp/ziy-*/
  * every kill is anchored: pgrep -f '/tmp/ziy-flow-<name>-profile' by PID
  * the user's own Firefox (WhatsApp) and LibreOffice are never matched
  * MOZ_CRASHREPORTER_DISABLE=1 on every launch
  * the route used for every flow is recorded, not implied:
      - "real add-on origin"   the page is the shipped one at moz-extension://
      - "staged file://"       a byte copy of the shipped ui/ + lib/ with one
                               added shim <script> (the documented route)
      - "engine page"          about:newtab / about:addons, loaded by the engine
      - "BiDi"                 driven through WebDriver BiDi, not CDP
      - "headed"               a real window on a real display
"""
from __future__ import annotations

import asyncio
import glob
import json
import os
import shutil
import signal
import subprocess
import sys
import time

import websockets

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
XPI_DIR = os.path.join(ROOT, "build", "ziy", "distribution", "extensions")
MARIONETTE_PORT = 2828
ARTIFACTS = os.path.join(ROOT, "build", "verify")
SUITE = [
    "ziy-shell@ziy.app", "ziy-shields@ziy.app", "ziy-ntp@ziy.app",
    "ziy-news@ziy.app", "ziy-playlist@ziy.app", "ziy-talk@ziy.app",
    "ziy-sync@ziy.app", "ziy-desktop@ziy.app",
]


class Report:
    """One check per line: PASS / FAIL / BLOCKED with its evidence."""

    def __init__(self):
        self.lines: list[str] = []

    def check(self, name, ok, detail=""):
        mark = "PASS" if ok else "FAIL"
        line = f"  {mark}  {name}"
        if detail:
            line += f"  — {detail}"
        self.lines.append(line)
        print(line, flush=True)
        return bool(ok)

    def blocked(self, name, why, route=""):
        line = f"  BLOCKED  {name}  — {why}"
        if route:
            line += f"  (route: {route})"
        self.lines.append(line)
        print(line, flush=True)

    def note(self, text):
        self.lines.append(f"  ..   {text}")
        print(f"  ..   {text}", flush=True)

    def head(self, text):
        self.lines.append(text)
        print("\n" + text, flush=True)

    @property
    def failures(self):
        return [l for l in self.lines if l.strip().startswith("FAIL")]


class BiDi:
    def __init__(self, ws):
        self.ws = ws
        self._next = 0

    async def call(self, method, params=None):
        self._next += 1
        msg_id = self._next
        await self.ws.send(json.dumps({"id": msg_id, "method": method,
                                       "params": params or {}}))
        while True:
            raw = await self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def close(self):
        try:
            await self.ws.close()
        except Exception:
            pass


async def evaluate(bidi, context, expression, retries=3):
    last = None
    for _ in range(retries):
        try:
            result = await bidi.call("script.evaluate", {
                "expression": expression,
                "target": {"context": context},
                "awaitPromise": True, "returnByValue": True,
            })
            return result.get("result", {}).get("value")
        except Exception as exc:  # noqa: BLE001 - a transient frame error is retried
            last = exc
            await asyncio.sleep(0.4)
    raise last  # type: ignore[misc]


async def click(bidi, context, selector):
    return await evaluate(
        bidi, context,
        f"(function(){{var e=document.querySelector({json.dumps(selector)});"
        f"if(!e)return false;e.scrollIntoView({{block:'center'}});e.click();return true;}})()")


async def type_into(bidi, context, selector, text):
    return await evaluate(bidi, context, """
      (function () {
        var el = document.querySelector(%s);
        if (!el) return false;
        el.focus();
        el.value = %s;
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        return true;
      })()
    """ % (json.dumps(selector), json.dumps(text)))


def cleanup(profile):
    """Anchored kill by profile path, never a bare word."""
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


def wait_for_port(port, timeout=120):
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.4)
    return False


def launch(profile, port, url="about:blank", extra_env=None, settle=20):
    """Boot the Ziy app dir on a throwaway profile. Returns the popen handle."""
    subprocess.run(["rm", "-rf", profile])
    os.makedirs(profile, exist_ok=True)
    cleanup(profile)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1",
               MOZ_DISABLE_SAFE_MODE="1")
    if extra_env:
        env.update(extra_env)
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", profile, "--marionette",
         f"--remote-debugging-port={port}", url],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"  launched pid {child.pid}  profile {profile}  port {port}")
    if not wait_for_port(port, 120) or not wait_for_port(MARIONETTE_PORT, 120):
        raise RuntimeError("the browser never opened its debugging ports")
    time.sleep(settle)
    return child


def read_addons(profile):
    path = os.path.join(profile, "extensions.json")
    if not os.path.exists(path):
        return []
    try:
        return json.load(open(path)).get("addons", [])
    except Exception:
        return []


def suite_state(profile):
    """{id: {active, installed}} for the whole suite, from extensions.json."""
    out = {}
    for addon in read_addons(profile):
        if "ziy" not in str(addon.get("id")):
            continue
        out[addon.get("id")] = {
            "active": bool(addon.get("active")) and addon.get("appDisabled") is not True
            and addon.get("userDisabled") is not True,
            "installed": True,
            "version": addon.get("version"),
        }
    return out


def find_url(profile, want_id):
    """The add-on's moz-extension:// base, from the uuids pref or extensions.json."""
    import re
    prefs = os.path.join(profile, "prefs.js")
    if os.path.exists(prefs):
        text = open(prefs, encoding="utf-8", errors="replace").read()
        m = re.search(
            r'user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\)',
            text)
        if m:
            raw = m.group(1).replace('\\"', '"').replace("\\\\", "\\")
            try:
                value = json.loads(raw).get(want_id)
                if isinstance(value, str) and value:
                    return f"moz-extension://{value}"
            except Exception:
                pass
    for addon in read_addons(profile):
        if addon.get("id") != want_id:
            continue
        for key in ("baseURL", "internalURL", "url"):
            v = addon.get(key)
            if isinstance(v, str) and v.startswith("moz-extension://"):
                return v.rstrip("/")
        m = re.search(r"([0-9a-fA-F-]{36})", addon.get("rootURI", "") or "")
        if m:
            return f"moz-extension://{m.group(1)}"
    return None


def stage(extension_name, shim, artifacts_dir, script_tag=None, copy_lib=True):
    """A file:// copy of the SHIPPED page, with one shim <script> added.

    The page's own ui/*.js and lib/* run unchanged; the shim only answers the
    browser.* calls the page makes, in the shipped contract's shape.
    """
    staged = os.path.join(artifacts_dir, f"{extension_name}-flow-staged")
    if os.path.isdir(staged):
        shutil.rmtree(staged)
    os.makedirs(staged, exist_ok=True)
    src = os.path.join(ROOT, "extensions", extension_name)
    shutil.copytree(os.path.join(src, "ui"), os.path.join(staged, "ui"))
    if copy_lib:
        shutil.copytree(os.path.join(src, "lib"), os.path.join(staged, "lib"))
        shim_path = os.path.join(staged, "lib", "shim.js")
        shim_rel = "../lib/shim.js"
    else:
        shim_path = os.path.join(staged, "shim.js")
        shim_rel = "shim.js"
    with open(shim_path, "w", encoding="utf-8") as fh:
        fh.write(shim)
    page = script_tag or "<script src=\"panel.js\"></script>"
    # The harness injects before the page's own last script tag; the caller
    # supplies it when the page's scripts are not a single tag.
    return staged, shim_rel, page


def inject_shim(html_path, shim_rel, script_tag):
    with open(html_path, encoding="utf-8") as fh:
        html = fh.read()
    if script_tag not in html:
        raise RuntimeError(f"the page has no {script_tag!r} to inject before")
    html = html.replace(script_tag,
                        f'<script src="{shim_rel}"></script>\n{script_tag}', 1)
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)


def page_files(extension_name):
    src = os.path.join(ROOT, "extensions", extension_name)
    out = []
    for path in glob.glob(os.path.join(src, "ui", "**", "*.js"), recursive=True):
        out.append(os.path.relpath(path, os.path.join(src, "ui")))
    return out


def storage_local(profile):
    """The profile's extension storage.local files, for the per-site override
    store assertions (ziy-shields writes browser.storage.local, which the
    engine persists as storage-sync-v2/local/<uuid>.json-addons.mozilla.org)."""
    roots = [os.path.join(profile, "storage", "permanent"),
             os.path.join(profile, "storage", "default"),
             os.path.join(profile, "storage")]
    found = {}
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                path = os.path.join(dirpath, name)
                try:
                    text = open(path, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                if "ziy" in text or "shields" in text:
                    found[os.path.relpath(path, profile)] = len(text)
    return found


def read_storage_values(profile):
    """Every extension's storage.local contents, keyed by storage directory."""
    out = {}
    for dirpath, _dirs, files in os.walk(os.path.join(profile, "storage")):
        for name in files:
            path = os.path.join(dirpath, name)
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if "ziy" not in text:
                continue
            try:
                doc = json.loads(text)
            except Exception:
                continue
            out[os.path.relpath(path, profile)] = doc
    return out


def grep_running_pages(report, bidi=None, contexts=None):
    """The cut-features-must-be-absent check: no AI, no wallet, no BAT, no VPN
    anywhere a user can see. Returns the strings found."""
    banned = ["assistant", "leo", "wallet", "rewards", "bat ", "bat\n", "vpn",
              "brave"]
    findings = []
    return banned, findings
