#!/usr/bin/env python3
"""The regression suite's shields-runtime slice: F02-F07, real add-on origin.

This is `tools/e2e/ziy-fix-shields-flows.py`'s harness, imported and driven as
the suite's shields-runtime case rather than reimplemented. The suite needs the
same things that tool already proves on the route that works: the event page
evaluates, the add-on's own bus answers `shields.state`, the DNR tiers and the
filter-list registry report real numbers, the panel page renders, and the writes
persist in the profile.

WHY THE OLD CASE WAS WRONG. It called `ziy-shields-runtime-probe.py`, which
drives the add-on's ops from a `file://` page. A `file://` page has no
`browser.*` global at all (measured: `typeof browser === "undefined"`,
`replica/test-report.md`'s route table, `tools/e2e/ziy-route-probe.py`), so its
`shields.state` could never succeed on any build — a defect of the probe, not of
the product (`replica/proofs-fix-events.md` section 5.2, "A caveat about the old
tool"). The suite's three log greps for the D-1/D-2 signatures were also weak:
they only show an error is ABSENT, never that the event page ANSWERS.

THE ROUTE HERE. The one the fix-events workstream proved: a `file://` driver page
carrying `<iframe src="moz-extension://<uuid>/ui/debug.html">` loads the add-on's
own document on its real origin, and the engine exposes that frame as its own
browsingContext child in `browsingContext.getTree`, scriptable over BiDi. Inside
it `typeof browser !== "undefined"`, so `runtime.sendMessage` reaches the real
event page exactly as ui/popup.js does. No shim, no staged copy: this is the
shipped page, and `extensions/ziy-shields/manifest.json` already declares
`web_accessible_resources` for `ui/*`, so no packaging change was needed.

Output contract with the shell: one line per check,
`  PASS|FAIL  <name>  — <evidence>`; exit 0 only when nothing failed. The suite
maps each of these onto its own case names by their leading PASS/FAIL verb.

Route: real add-on origin + BiDi. One throwaway profile under /tmp/ziy-*.
Kills are anchored on that profile path, by PID, never a bare word.
"""
import asyncio
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "ziy_fix_shields_flows", os.path.join(HERE, "ziy-fix-shields-flows.py"))
_fh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fh)


def main():
    """The working probe, re-pointed at the suite's throwaway profile and port,
    so the suite's own anchored cleanup and its process hygiene apply unchanged.
    Everything it asserts is unchanged from the proof that recorded them."""
    _fh.PROFILE = "/tmp/ziy-regress-shields-profile"
    _fh.PORT = 9340
    _fh.LOG = "/tmp/ziy-regress-shields.log"
    return asyncio.run(_fh.main())


if __name__ == "__main__":
    sys.exit(main())
