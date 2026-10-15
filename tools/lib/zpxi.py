#!/usr/bin/env python3
"""Deterministic .xpi packaging for the Ziy extension suite.

A .xpi is a zip file. The Ziy app dir installs each file in
distribution/extensions/ by deriving the add-on id from the FILENAME
(XPIProvider.sys.mjs getExpectedID(): leafName minus ".xpi", validated against
gIDTest) — which is why this packager refuses to write anything whose name is
not "<addon-id>.xpi".

Determinism: every entry gets a fixed timestamp (2026-01-01 00:00:00) and a
fixed external attributes word, and the entries are written in sorted order.
Two builds of the same tree therefore produce identical bytes, which is what
makes `git diff` on build/ziy/distribution/extensions/ meaningful.

Excluded by rule, not by hand: *.map, node_modules/ (at any depth), test/
directories, .DS_Store, *.bak.

    python3 tools/lib/zpxi.py pack    <src-dir> <out.xpi>
    python3 tools/lib/zpxi.py check   <out.xpi>     # id matches filename, manifest present
    python3 tools/lib/zpxi.py list    <out.xpi>
    python3 tools/lib/zpxi.py summary <out.xpi>     # "id files bytes"
"""

from __future__ import annotations

import json
import os
import sys
import zipfile
from pathlib import Path

# 2026-01-01, a fixed point in time, so the zip is reproducible.
ZIP_DATE = (2026, 1, 1, 0, 0, 0)

# Basenames that never belong in a shipped xpi.
EXCLUDED_FILES = {".DS_Store"}

# Suffixes that never belong in a shipped xpi (source maps, backups).
EXCLUDED_SUFFIXES = (".map", ".bak")

# Directory names pruned at any depth: dependencies and tests.
EXCLUDED_DIRS = {"node_modules", "test"}


def load_addon_id(src: Path) -> str:
    """browser_specific_settings.gecko.id from the extension's manifest.json."""
    manifest_path = src / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"{src}: no manifest.json — not an extension directory")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bss = manifest.get("browser_specific_settings") or {}
    gecko = bss.get("gecko") or {}
    addon_id = gecko.get("id")
    if not addon_id:
        raise SystemExit(
            f"{manifest_path}: no browser_specific_settings.gecko.id — the "
            "app-dir installer derives the add-on id from the .xpi filename, so "
            "the manifest must state it exactly"
        )
    if not addon_id.endswith("@ziy.app"):
        raise SystemExit(f"{manifest_path}: add-on id {addon_id!r} is not a Ziy suite id")
    return addon_id


def included_files(src: Path) -> list[Path]:
    """Relative paths of everything this packager ships."""
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDED_DIRS)
        for name in sorted(filenames):
            if name in EXCLUDED_FILES:
                continue
            if name.endswith(EXCLUDED_SUFFIXES):
                continue
            full = Path(dirpath) / name
            rel = full.relative_to(src)
            # A file under an excluded dir can only appear via a symlink.
            if any(part in EXCLUDED_DIRS for part in rel.parts):
                continue
            out.append(rel)
    return sorted(out, key=lambda p: p.as_posix())


def pack(src: Path, out: Path) -> int:
    addon_id = load_addon_id(src)
    if out.name != f"{addon_id}.xpi":
        raise SystemExit(
            f"refusing to write {out.name}: the app-dir installer derives the "
            f"add-on id from the filename, so this must be {addon_id}.xpi"
        )
    files = included_files(src)
    if not files:
        raise SystemExit(f"{src}: nothing to package")

    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    if tmp.exists():
        tmp.unlink()

    total = 0
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in files:
            data = (src / rel).read_bytes()
            info = zipfile.ZipInfo(rel.as_posix(), date_time=ZIP_DATE)
            # 0644 for files, 0755 not set: nothing in the suite is executable.
            info.external_attr = (0o100644 & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)
            total += len(data)
        # The manifest must be inside; assert it rather than trust the walk.
        names = set(zf.namelist())
        if "manifest.json" not in names:
            raise SystemExit(f"{src}: packed {len(names)} files but manifest.json is missing")

    os.replace(tmp, out)
    print(f"{addon_id} {len(files)} {out.stat().st_size} {out}")
    return 0


def check(xpi: Path) -> int:
    """Verify the packaged xpi: name/id agreement and manifest presence."""
    problems: list[str] = []
    if not xpi.is_file():
        raise SystemExit(f"{xpi}: not a file")
    with zipfile.ZipFile(xpi) as zf:
        names = zf.namelist()
        if "manifest.json" not in names:
            problems.append("manifest.json is not in the zip")
            manifest = {}
        else:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        gecko = (manifest.get("browser_specific_settings") or {}).get("gecko") or {}
        addon_id = gecko.get("id")
        if not addon_id:
            problems.append("manifest.json has no browser_specific_settings.gecko.id")
        if xpi.name.endswith(".xpi"):
            stem = xpi.name[: -len(".xpi")]
            if addon_id and stem != addon_id:
                problems.append(
                    f"filename id {stem!r} != manifest id {addon_id!r}; the app-dir "
                    "installer derives the id from the filename"
                )
        else:
            problems.append("not named *.xpi")
        raw = sum(i.file_size for i in zf.infolist())

    for p in problems:
        print(f"FAIL {xpi.name}: {p}", file=sys.stderr)
    if problems:
        return 1
    print(f"OK   {xpi.name}: id {addon_id}, {len(names)} files, {raw} bytes uncompressed, {xpi.stat().st_size} on disk")
    return 0


def listing(xpi: Path) -> int:
    with zipfile.ZipFile(xpi) as zf:
        for info in zf.infolist():
            print(f"{info.file_size:8d}  {info.filename}")
    return 0


def summary(xpi: Path) -> int:
    with zipfile.ZipFile(xpi) as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        addon_id = (manifest.get("browser_specific_settings") or {}).get("gecko", {}).get("id", "?")
        print(f"{addon_id}\t{len(zf.infolist())}\t{xpi.stat().st_size}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    cmd = argv[1]
    if cmd == "pack" and len(argv) == 4:
        return pack(Path(argv[2]), Path(argv[3]))
    if cmd in ("check", "list", "summary") and len(argv) == 3:
        return {"check": check, "list": listing, "summary": summary}[cmd](Path(argv[2]))
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
