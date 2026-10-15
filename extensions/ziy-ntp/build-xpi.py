#!/usr/bin/env python3
"""Package the Ziy NTP extension into its own distribution xpi.

Deterministic by construction: the entries are written in sorted order with
fixed timestamps, so the same tree always produces the same bytes. That makes
the artefact diffable between builds and means a rebuild never churns a
checksum for reasons unrelated to content.

The id comes from the filename, which is how the app-scope installer derives it
(`getExpectedID()` in `XPIProvider.sys.mjs`), so the manifest's
`browser_specific_settings.gecko.id` and the filename must agree — the script
asserts that and refuses to write an xpi that would install under the wrong id.

    python3 tools/build-ntp-xpi.py [--out PATH] [--check]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
from pathlib import Path

EXTENSION_ID = "ziy-ntp@ziy.app"
ADDON_ID = f"{EXTENSION_ID}.xpi"
# A fixed epoch so the archive is byte-stable across runs.
ZIP_EPOCH = (2026, 10, 14, 12, 0, 0)
# Files that are part of the extension, never the workspace scaffolding.
EXCLUDE_DIRS = {".git", "node_modules", "__pycache__", "test", "content"}
EXCLUDE_FILES = {"package-lock.json", ".DS_Store", "README.md", "build-xpi.py", "package.json"}


def extension_root() -> Path:
    """The extension directory this script lives in."""
    return Path(__file__).resolve().parent


def collect_files(root: Path) -> list[Path]:
    """Every file that ships, as repo-relative paths, sorted."""
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDE_DIRS)
        for name in filenames:
            if name in EXCLUDE_FILES:
                continue
            files.append(Path(dirpath) / name)
    return sorted(files, key=lambda p: p.as_posix())


def read_manifest_id(root: Path) -> str | None:
    manifest = root / "manifest.json"
    if not manifest.exists():
        return None
    try:
        doc = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    settings = doc.get("browser_specific_settings") or {}
    gecko = settings.get("gecko") or {}
    return gecko.get("id")


def build(out_path: Path) -> int:
    root = extension_root()
    if not (root / "manifest.json").exists():
        print(f"no manifest.json under {root}", file=sys.stderr)
        return 1

    manifest_id = read_manifest_id(root)
    if manifest_id != EXTENSION_ID:
        print(
            f"manifest gecko id is {manifest_id!r}, expected {EXTENSION_ID!r}: "
            "the app-scope installer derives the id from the filename, so this "
            "xpi would install under the wrong id",
            file=sys.stderr,
        )
        return 1

    files = collect_files(root)
    if not files:
        print(f"nothing to package under {root}", file=sys.stderr)
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temporary name first so a failure cannot leave a half xpi.
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            arcname = path.relative_to(root).as_posix()
            info = zipfile.ZipInfo(arcname, date_time=ZIP_EPOCH)
            # 0644 for files; the store does not depend on it.
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes())

    # Verify before replacing anything the profile may already have installed.
    with zipfile.ZipFile(tmp_path) as zf:
        bad = zf.testzip()
        if bad is not None:
            print(f"corrupt entry written: {bad}", file=sys.stderr)
            tmp_path.unlink(missing_ok=True)
            return 1
        names = set(zf.namelist())
        required = {
            "manifest.json",
            "lib/model.js",
            "lib/storage.js",
            "background/background.js",
            "ui/ntp.html",
            "ui/ntp.js",
            "ui/ntp.css",
            "ui/options.html",
            "ui/options.js",
        }
        missing = sorted(required - names)
        if missing:
            print(f"the xpi is missing required files: {missing}", file=sys.stderr)
            tmp_path.unlink(missing_ok=True)
            return 1

    os.replace(tmp_path, out_path)
    size = out_path.stat().st_size
    print(f"{out_path} ({size} bytes, {len(files)} entries)")
    return 0


def check(out_path: Path) -> int:
    """Read-only validation of a built xpi against the tree."""
    root = extension_root()
    problems: list[str] = []

    if not out_path.exists():
        print(f"{out_path} does not exist", file=sys.stderr)
        return 1

    with zipfile.ZipFile(out_path) as zf:
        names = set(zf.namelist())
        if "manifest.json" not in names:
            print(f"{out_path} has no manifest.json", file=sys.stderr)
            return 1
        manifest = json.loads(zf.read("manifest.json"))
        manifest_id = (
            (manifest.get("browser_specific_settings") or {})
            .get("gecko", {})
            .get("id")
        )
        if manifest_id != EXTENSION_ID:
            problems.append(
                f"manifest id is {manifest_id!r}, expected {EXTENSION_ID!r}"
            )
        if out_path.name != f"{EXTENSION_ID}.xpi":
            problems.append(
                f"filename {out_path.name!r} does not match the id "
                f"{EXTENSION_ID!r} (the app-scope installer uses the filename)"
            )
        if manifest.get("chrome_url_overrides", {}).get("newtab") != "ui/ntp.html":
            problems.append("chrome_url_overrides.newtab is not ui/ntp.html")
        if manifest.get("manifest_version") != 3:
            problems.append("manifest_version is not 3")
        background = manifest.get("background") or {}
        if "service_worker" in background:
            problems.append(
                "background.service_worker is declared; Gecko does not implement it "
                "(Firefox bug 1573659) — use background.scripts"
            )
        if not background.get("scripts"):
            problems.append("background.scripts is missing")

        # Everything the page needs must be inside.
        for f in ("lib/model.js", "lib/storage.js", "ui/ntp.html", "ui/ntp.css",
                  "ui/ntp.js", "ui/options.html", "ui/options.js"):
            if f not in names:
                problems.append(f"{f} is missing from the xpi")

        # And the tree must match the archive. Workspace-only files (the tests,
        # the packaging script, the module notes) are deliberately not shipped.
        excluded_names = EXCLUDE_FILES
        for path in collect_files(root):
            rel = path.relative_to(root).as_posix()
            if rel in excluded_names:
                continue
            if rel not in names:
                problems.append(f"{rel} is in the tree but not in the xpi")
            elif zf.read(rel) != path.read_bytes():
                problems.append(f"{rel} in the xpi differs from the tree")

    for problem in problems:
        print(f"  {problem}", file=sys.stderr)
    if problems:
        print(f"{out_path} FAILED check ({len(problems)} problems)", file=sys.stderr)
        return 1
    print(f"{out_path} passes check: id, filename, manifest shape and tree match")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=None,
        help="output xpi path (default: build/ziy/distribution/extensions/<id>.xpi)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate an existing xpi against the tree instead of writing one",
    )
    args = parser.parse_args()

    if args.out:
        out_path = Path(args.out)
    else:
        # build/ziy/distribution/extensions/<id>.xpi, relative to the repo root.
        out_path = (
            extension_root().parent.parent
            / "build"
            / "ziy"
            / "distribution"
            / "extensions"
            / ADDON_ID
        )

    if args.check:
        return check(out_path)
    return build(out_path)


if __name__ == "__main__":
    raise SystemExit(main())
