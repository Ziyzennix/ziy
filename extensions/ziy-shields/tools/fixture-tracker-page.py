#!/usr/bin/env python3
"""Writes a local page that requests five known tracker URLs.

The blocked hosts each have a rule in the bundled EasyPrivacy snapshot — check
with:

    grep -F '||google-analytics.com' \\
      extensions/ziy-shields/lib/filterlist/snapshots/easyprivacy.txt

So the fixture is a real, offline-honest blocking probe: no external network
needed, rules that definitely exist in the shipped table, and loads a working
Shields install must stop. The page also exposes `window.loaded`, a map of
"name:type" -> true/false, so a dump through the harness page can report which
trackers actually reached the page.
"""
import argparse
from pathlib import Path

# name, host, path, how the page requests it
TRACKERS = [
    ("google-analytics", "google-analytics.com", "ga.js", "image"),
    ("googletagmanager", "googletagmanager.com", "gtag/js", "script"),
    ("doubleclick", "doubleclick.net", "ad.js", "script"),
    ("facebook", "facebook.net", "fbevents.js", "script"),
    ("scorecardresearch", "scorecardresearch.com", "beacon.js", "image"),
]

# Written without str.format() so the CSS braces stay literal.
PAGE_HEAD = (
    "<!doctype html>\n"
    '<html lang="en"><head><meta charset="utf-8">'
    "<title>Ziy Shields fixture</title>\n"
    "<style>\n"
    "body{font:16px system-ui,sans-serif;margin:2rem;background:#0b6e6e;color:#fff}\n"
    "dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem}\n"
    "ul{padding:0;list-style:none}\n"
    "</style></head>\n"
    "<body>\n"
    "<h1>Ziy Shields blocking fixture</h1>\n"
    "<p>This page loads five known third-party trackers. Every one of them has a\n"
    "rule in the EasyPrivacy snapshot bundled in the extension, so a working\n"
    "Shields install must stop all five. <code>window.loaded</code> reports which\n"
    "ones actually reached this page.</p>\n"
    "<dl>\n"
)

PAGE_MID = (
    "</dl>\n"
    "<ul id=\"log\"></ul>\n"
    "<script>\n"
    "window.loaded = {};\n"
    "window.HOSTS = " + repr({t[0]: t[1] for t in TRACKERS}) + ";\n"
    "window.PATHS = " + repr({t[0]: t[2] for t in TRACKERS}) + ";\n"
    "window.KINDS = " + repr({t[0]: t[3] for t in TRACKERS}) + ";\n"
    "function mark(name, ok) {\n"
    "  window.loaded[name] = ok;\n"
    "  var li = document.createElement('li');\n"
    "  li.textContent = name + ' -> ' + (ok ? 'LOADED' : 'blocked');\n"
    "  li.setAttribute('data-loaded', String(ok));\n"
    "  document.getElementById('log').appendChild(li);\n"
    "}\n"
    "for (var name in window.HOSTS) {\n"
    "  (function (name) {\n"
    "    var kind = window.KINDS[name];\n"
    "    var url = 'https://' + window.HOSTS[name] + '/' + window.PATHS[name];\n"
    "    if (kind === 'script') {\n"
    "      var s = document.createElement('script');\n"
    "      s.src = url;\n"
    "      s.onload = function () { mark(name + ':script', true); };\n"
    "      s.onerror = function () { mark(name + ':script', false); };\n"
    "      document.head.appendChild(s);\n"
    "    } else {\n"
    "      var i = new Image();\n"
    "      i.onload = function () { mark(name + ':image', true); };\n"
    "      i.onerror = function () { mark(name + ':image', false); };\n"
    "      i.src = url;\n"
    "    }\n"
    "  })(name);\n"
    "}\n"
    "</script>\n"
    "</body></html>\n"
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    args = ap.parse_args()

    parts = [PAGE_HEAD]
    for name, host, path, _kind in TRACKERS:
        parts.append(
            f"<dt>{name}</dt><dd><code>https://{host}/{path}</code></dd>\n"
        )
    parts.append(PAGE_MID)
    html = "".join(parts)

    Path(args.out).write_text(html, encoding="utf-8")
    print(f"wrote {args.out} ({len(html)} bytes) with {len(TRACKERS)} tracker requests")


if __name__ == "__main__":
    main()
