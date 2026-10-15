#!/usr/bin/env python3
"""Build the Ziy self-test extension.

This is the artefact tools/verify.sh uses to prove the signing bypass is really
working: an unsigned .xpi with a distinct id (ziy-selftest@ziy.app) placed in the
app dir's distribution/extensions/, which release Firefox would silently ignore
and our patched omni.ja installs. Its manifest asks for no privileges at all, so
it is safe to drop into a throwaway profile, and it writes a marker into its
storage the verify script can read back.

    python3 tools/build-selftest-xpi.py <out.xpi>
"""

from __future__ import annotations

import base64
import json
import io
import os
import sys
import zipfile
from pathlib import Path


MANIFEST = {
    "manifest_version": 2,
    "name": "Ziy Self-Test",
    "version": "1.0",
    "description": "Proves the Ziy app dir installs unsigned add-ons. Part of "
                   "tools/verify.sh; safe to remove.",
    "author": "Ziy",
    "browser_specific_settings": {
        "gecko": {
            # Filled in by build() from the output filename: the app-scope
            # installer derives the add-on id from the .xpi filename, so the
            # two must be generated from one value.
            "id": None,
            "strict_min_version": "115.0",
        }
    },
    "background": {
        "scripts": ["background.js"],
    },
    "permissions": [],
    "host_permissions": [],
}

BACKGROUND_JS = """/* Ziy self-test background page.
 *
 * Its only job is to record that it ran, into browser.storage.local, and to
 * expose that fact over runtime.onMessage so tools/verify.sh can ask for it
 * from the same process if it ever needs to.
 */
const MARKER_KEY = "ziy.selftest.ran";

async function markRan() {
  try {
    const current = await browser.storage.local.get(MARKER_KEY);
    const n = (current && current[MARKER_KEY] && current[MARKER_KEY].count) || 0;
    const payload = {
      count: n + 1,
      at: new Date().toISOString(),
      id: browser.runtime.id,
      installReason:
        (browser.runtime.getManifest &&
          browser.runtime.getManifest().browser_specific_settings &&
          browser.runtime.getManifest().browser_specific_settings.gecko &&
          browser.runtime.getManifest().browser_specific_settings.gecko.id) ||
        browser.runtime.id,
      signedState: "unsigned-by-construction",
    };
    await browser.storage.local.set({ [MARKER_KEY]: payload });
  } catch (e) {
    // An extension with no storage permission would fail here; we ask for
    // "storage" in the manifest precisely so it cannot.
  }
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.op === "ziy-selftest/probe") {
    return browser.storage.local.get(MARKER_KEY).then((v) => ({
      ok: true,
      from: browser.runtime.id,
      marker: v[MARKER_KEY] || null,
    }));
  }
  return undefined;
});

browser.runtime.onInstalled.addListener((details) => {
  markRan();
});

browser.runtime.onStartup.addListener(() => {
  markRan();
});

// Also mark immediately: background scripts in MV3-on-Gecko are event pages, so
// the onInstalled listener may already have fired before this file finished
// evaluating.
markRan();
"""

# A tiny 48x48 icon in Ziy's brand violet so the add-on has a real asset (the
# point of this artefact is the id and the install, not the art). Generated with
# Pillow rather than hand-copied base64, because hand-copied base64 was wrong
# once and broke the build.
ICON_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAS0lEQVR4nO3OMQHAIADAM"
    "EDQlODfDvv39GRHoiBzP2f8ybod+BIqQkWoCBWhIlSEilARKkJFqAgVoSJUhIpQESpC"
    "RagIFaEiVITKCzzeAdmlTr9bAAAAAElFTkSuQmCC"
)


def build(out: Path) -> int:
    # The app-scope installer derives the add-on id from the FILENAME, so the
    # manifest id has to be generated from the path we were asked to write.
    addon_id = out.name
    if not addon_id.endswith(".xpi"):
        sys.exit(f"build-selftest-xpi.py: output must end in .xpi (got {out.name})")
    addon_id = addon_id[: -len(".xpi")]
    if "@" not in addon_id:
        sys.exit(
            f"build-selftest-xpi.py: filename must be the add-on id, e.g. "
            f"ziy-selftest@ziy.test.xpi (got {out.name})"
        )

    manifest = json.loads(json.dumps(MANIFEST))
    manifest["browser_specific_settings"]["gecko"]["id"] = addon_id
    manifest["name"] = f"Ziy Self-Test ({addon_id})"

    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    # A deterministic zip: no timestamps, so two runs produce the same bytes.
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        def add(name: str, data: bytes) -> None:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)

        add("manifest.json", json.dumps(manifest, indent=2).encode() + b"\n")
        add("background.js", BACKGROUND_JS.encode())
        add("ziy-selftest-48.png", ICON_PNG)
    print(f"build-selftest-xpi.py: wrote {out} ({out.stat().st_size} bytes), "
          f"id={addon_id}, unsigned by construction")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} <out.xpi>", file=sys.stderr)
        return 2
    return build(Path(sys.argv[1]))


if __name__ == "__main__":
    raise SystemExit(main())
