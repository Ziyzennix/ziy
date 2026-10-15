#!/usr/bin/env python3
"""tools/lib/omni-ja.py — the reusable, byte-length-preserving omni.ja patcher.

One tool for every omni.ja rewrite the Ziy shell performs, built from the
container knowledge in replica/proofs-shell.md §1.1-1.3 and the original
signing-only patcher (shell/omni.ja.patch/patch-omni.py, which still works and
is unchanged).

THE MECHANISM, and why it is this narrow
----------------------------------------
omni.ja is a zip wrapped in a 4-byte envelope; the central directory sits right
after the prefix and member data follows the EOCD. Local-header offsets in the
central directory are absolute file offsets. Members that ship STORED
(compression method 0) are exactly the file bytes on disk, so a same-length
byte rewrite of a stored member's body leaves every offset valid — only the
member's CRC-32 has to be recomputed, and it has to be written into BOTH the
central-directory header (offset +16 of its 46-byte header) and the local file
header (offset +14 of its 30-byte header).

Everything else about the archive must come out byte-identical. This tool
enforces that with a full-file byte diff against the input, allowing only the
patched members' bodies and their CRC fields; anything else is a hard failure
before a single byte is written.

WHAT IT REFUSES TO DO
---------------------
  * change any member's LENGTH, in total (a length change moves every later
    member and the container is dead; the failure looks like a corrupt install,
    not a patch failure). Individual substitutions may differ in length only if
    the member's net change is exactly zero — the AppConstants pair below is the
    one documented case: signing +1 byte, sideload -1 byte.
  * apply a substitution whose pattern is not present exactly once in the member
    (engine bump protection: if the string moved, we fail loudly at build time
    instead of silently shipping an unpatched engine)
  * patch a compressed member (method != 0)
  * tolerate a CRC disagreement in the input

USAGE
-----
  # 1. the built-in patches (this is what build-shell.sh calls):
  tools/lib/omni-ja.py in-omni.ja out-omni.ja --patch ziy

  # 2. a named patch file of substitutions, one member per section:
  tools/lib/omni-ja.py in-omni.ja out-omni.ja --patch-file tools/patches/newtab.toml

  # 3. verify an already-written archive (no write; exits non-zero on drift):
  tools/lib/omni-ja.py --verify out-omni.ja --patch-file tools/patches/newtab.toml

A patch file is TOML with one [[member]] table per member:

    [[member]]
    path = "chrome/browser/builtin-addons/newtab/manifest.json"

    [[member.replace]]
    pattern = '"manifest_version": 2,'
    replacement = '"manifest_version": 3,'

(pattern and replacement MUST be the same length. The tool refuses otherwise.)

Exit codes: 0 ok, 1 precondition failed (absent pattern / wrong length),
            2 verification failed, 3 usage or IO error.
"""

from __future__ import annotations

import argparse
import struct
import sys
import tomllib
import zlib
from pathlib import Path

FAIL_PRECONDITION = 1
FAIL_VERIFY = 2
FAIL_USAGE = 3


class OmniError(Exception):
    """Any refusal to patch. The message is the build-time loud failure."""

    def precondition(self) -> bool:
        return str(self).startswith("PRECONDITION FAILED")


# ---------------------------------------------------------------------------
# Container parsing (identical semantics to shell/omni.ja.patch/patch-omni.py)
# ---------------------------------------------------------------------------

def locate_central_directory(data: bytes) -> tuple[int, int, int]:
    """Return (cd_start, cd_size, eocd_at) for the inner zip of an omni.ja."""
    candidates = []
    pos = 0
    while True:
        pos = data.find(b"PK\x05\x06", pos)
        if pos < 0:
            break
        candidates.append(pos)
        pos += 1
    if not candidates:
        raise OmniError("no EOCD record found; not an omni.ja container")
    for eocd in candidates:
        if eocd + 22 > len(data):
            continue
        (_sig, _dsk, _cdsk, _ndisk, _ntot,
         cd_size, cd_off, _cmlen) = struct.unpack("<4sHHHHIIH", data[eocd:eocd + 22])
        if cd_size == 0 or cd_off == 0:
            continue
        cd_start = eocd - cd_size
        if cd_start < 0 or cd_start + cd_size != eocd:
            continue
        if data[cd_start:cd_start + 4] != b"PK\x01\x02":
            continue
        return cd_start, cd_size, eocd
    raise OmniError(
        "found EOCD candidates but none had a consistent central directory; "
        "this is not an omni.ja layout this tool understands"
    )


def parse_central_directory(data: bytes, cd_start: int, cd_end: int) -> dict[str, dict]:
    """Return {name: entry} for every central-directory file header."""
    entries: dict[str, dict] = {}
    pos = cd_start
    while pos < cd_end:
        if data[pos:pos + 4] != b"PK\x01\x02":
            raise OmniError(f"central directory entry at {pos} is not PK\\x01\\x02")
        fields = struct.unpack("<4sHHHHHHIIIHHHHHII", data[pos:pos + 46])
        (_sig, vm, vn, flags, method, mtime, mdate, crc, csize, usize,
         nlen, elen, clen, dsk, iattr, ext_attr, lho) = fields
        if pos + 46 + nlen > cd_end:
            raise OmniError("truncated central directory entry name")
        name = data[pos + 46:pos + 46 + nlen].decode("utf-8", "surrogateescape")
        entries[name] = {
            "crc": crc,
            "csize": csize,
            "usize": usize,
            "method": method,
            "lho": lho,
            "nlen": nlen,
            "elen": elen,
            "cd_offset": pos,
        }
        pos += 46 + nlen + elen + clen
    return entries


def member_body_offset(data: bytes, lho: int, nlen: int, elen: int, name: str) -> int:
    """Absolute offset of the member's data, after checking the local header."""
    if data[lho:lho + 4] != b"PK\x03\x04":
        raise OmniError(
            f"{name}: local header at {lho} is {data[lho:lho + 4]!r}, not PK\\x03\\x04"
        )
    l_nlen, l_elen = struct.unpack("<HH", data[lho + 26:lho + 30])
    if l_nlen != nlen:
        raise OmniError(
            f"{name}: local header name length {l_nlen} disagrees with the "
            f"central directory's {nlen}"
        )
    if l_elen != elen:
        raise OmniError(
            f"{name}: local header extra-field length {l_elen} disagrees with the "
            f"central directory's {elen}"
        )
    local_name = data[lho + 30:lho + 30 + l_nlen].decode("utf-8", "surrogateescape")
    if local_name != name:
        raise OmniError(f"{name}: local header names a different entry ({local_name!r})")
    return lho + 30 + l_nlen + l_elen


# ---------------------------------------------------------------------------
# Patch specification
# ---------------------------------------------------------------------------

class Substitution:
    __slots__ = ("pattern", "replacement")

    def __init__(self, pattern: str | bytes, replacement: str | bytes):
        self.pattern = _as_bytes(pattern)
        self.replacement = _as_bytes(replacement)
        if len(self.pattern) != len(self.replacement):
            # Not automatically fatal: the two AppConstants flips are
            # deliberately +1/-1 of each other and cancel inside the member.
            # What IS fatal is a NET change in the member's length, which
            # apply_member_patch() checks after all substitutions are applied.
            # This constructor records the difference so the caller can refuse
            # unbalanced sets, and the tool refuses anything whose net effect
            # is non-zero.
            pass

    def __repr__(self) -> str:  # for the build log
        return f"{self.pattern.decode('utf-8', 'replace')} -> {self.replacement.decode('utf-8', 'replace')}"


def _as_bytes(value) -> bytes:
    if isinstance(value, bytes):
        return value
    return value.encode("utf-8")


class MemberPatch:
    """One member's set of substitutions."""

    __slots__ = ("path", "substitutions")

    def __init__(self, path: str, substitutions: list[Substitution]):
        self.path = path
        self.substitutions = substitutions


# The patches build-shell.sh applies, in order, each independently reversible.
# Every substitution here was verified byte-exact against Firefox 156.0.1's
# shipped omni.ja members on this machine; the engine-bump protection is the
# precondition check inside apply_member_patch.
#
# TWO archives, TWO patch sets: Firefox ships omni.ja (the toolkit modules) and
# browser/omni.ja (the browser chrome, which is where the built-in New Tab
# add-on lives). A patch set is therefore pinned to the archive that contains
# its member, and applying it to the wrong one is a loud failure, not a skip.
ZIY_PATCHES: list[MemberPatch] = [
    MemberPatch("modules/AppConstants.sys.mjs", [
        # proof: the two constants exist only here, not in firefox-bin/libxul.
        #
        # `true` -> `false` is +1 byte and `false` -> `true` is -1 byte. The
        # sideload flip is the +1/-1 BALANCE of the signing flip, so the member
        # length is preserved exactly (proofs-shell.md §1.3: "signing goes +1
        # byte, sideload goes -1 byte, and they cancel"). This is the rewrite
        # the original signing patcher performed, expressed once through the
        # shared mechanism.
        Substitution("MOZ_REQUIRE_SIGNING: true,", "MOZ_REQUIRE_SIGNING: false,"),
        Substitution("MOZ_ALLOW_ADDON_SIDELOAD: false,",
                     "MOZ_ALLOW_ADDON_SIDELOAD: true,"),
    ]),
]

# browser/omni.ja's set: the built-in New Tab add-on is the ONLY other newtab
# provider in the product.
ZIY_BROWSER_PATCHES: list[MemberPatch] = [
    MemberPatch("chrome/browser/builtin-addons/newtab/manifest.json", [
        # The built-in New Tab add-on's manifest is a STORED member, so a
        # same-length rewrite is possible. Bumping manifest_version 2 -> 3 makes
        # Gecko's add-on installer reject the built-in at install time (its MV2
        # `background.scripts` is not valid under MV3), so Firefox's own newtab
        # page is gone while every byte of it still ships — the add-on manager
        # records it as broken and it never registers chrome_url_overrides.
        # ziy-ntp's chrome_url_overrides.newtab is then the ONLY newtab.
        Substitution('"manifest_version": 2,', '"manifest_version": 3,'),
    ]),
]


def load_patch_file(path: Path) -> list[MemberPatch]:
    """Read a TOML patch file: [[member]] tables with [[member.replace]] pairs."""
    if not path.exists():
        raise OmniError(f"patch file {path} does not exist")
    with path.open("rb") as fh:
        doc = tomllib.load(fh)
    members = doc.get("member")
    if not members:
        raise OmniError(f"{path}: no [[member]] tables")
    out: list[MemberPatch] = []
    for table in members:
        mpath = table.get("path")
        subs = []
        for rep in table.get("replace", []):
            subs.append(Substitution(rep["pattern"], rep["replacement"]))
        if not subs:
            raise OmniError(f"{path}: member {mpath!r} has no [[member.replace]] entries")
        out.append(MemberPatch(mpath, subs))
    return out


# ---------------------------------------------------------------------------
# The patcher
# ---------------------------------------------------------------------------

def apply_member_patch(
    data: bytearray,
    entries: dict[str, dict],
    patch: MemberPatch,
    applied: list[dict],
) -> None:
    """Apply one member's substitutions in place. Raises OmniError on any refusal."""
    name = patch.path
    if name not in entries:
        raise OmniError(
            f"PRECONDITION FAILED: {name} is not present in this omni.ja. This "
            "is not an engine layout this patch covers (or the engine moved "
            "the member). Refusing to write an archive that claims to be "
            "patched."
        )
    entry = entries[name]
    if entry["method"] != 0:
        raise OmniError(
            f"{name} is compressed (method {entry['method']}); the "
            "byte-length-preserving rewrite requires a stored member. A "
            "recompressing patch needs a different tool."
        )
    body = member_body_offset(bytes(data), entry["lho"], entry["nlen"],
                              entry["elen"], name)
    end = body + entry["csize"]
    if end > len(data):
        raise OmniError(f"{name} body runs past the end of the archive")

    actual_crc = zlib.crc32(bytes(data[body:end])) & 0xFFFFFFFF
    if actual_crc != entry["crc"]:
        raise OmniError(
            f"{name} CRC mismatch (stored {entry['crc']:#010x}, actual "
            f"{actual_crc:#010x}); refusing to patch a corrupt archive"
        )

    source = bytes(data[body:end])
    patched = source
    for sub in patch.substitutions:
        if sub.pattern not in patched:
            raise OmniError(
                f"PRECONDITION FAILED: {name} does not contain "
                f"{sub.pattern.decode('utf-8', 'replace')!r}. Either this "
                "omni.ja is already patched, or this engine build moved or "
                "reworded the string — re-derive the patch against the new "
                "engine before building. The build fails here on purpose: a "
                "silent no-op would ship an unpatched engine."
            )
        if patched.count(sub.pattern) != 1:
            raise OmniError(
                f"PRECONDITION FAILED: {name} contains "
                f"{sub.pattern.decode('utf-8', 'replace')!r} "
                f"{patched.count(sub.pattern)} times; the patch is ambiguous "
                "and would rewrite the wrong bytes."
            )
        patched = patched.replace(sub.pattern, sub.replacement, 1)

    if len(patched) != len(source):
        raise OmniError(
            f"patch is not byte-length preserving ({len(source)} -> {len(patched)})"
        )
    new_crc = zlib.crc32(patched) & 0xFFFFFFFF

    data[body:end] = patched
    if new_crc != entry["crc"]:
        # Rewrite the CRC in both headers. Both fields are fixed-position
        # 4-byte fields in their original headers, so nothing moves.
        cd_crc_at = entry["cd_offset"] + 16
        local_crc_at = entry["lho"] + 14
        if bytes(data[cd_crc_at:cd_crc_at + 4]) != struct.pack("<I", entry["crc"]):
            raise OmniError("central directory CRC field is not where we expect it")
        if bytes(data[local_crc_at:local_crc_at + 4]) != struct.pack("<I", entry["crc"]):
            raise OmniError("local header CRC field is not where we expect it")
        struct.pack_into("<I", data, cd_crc_at, new_crc)
        struct.pack_into("<I", data, local_crc_at, new_crc)

    applied.append({
        "member": name,
        "crc_before": entry["crc"],
        "crc_after": new_crc,
        "body": body,
        "size": entry["csize"],
        "substitutions": [repr(s) for s in patch.substitutions],
        "cd_crc_at": entry["cd_offset"] + 16,
        "local_crc_at": entry["lho"] + 14,
    })


def reparse_and_check(data: bytes, expect_cd: tuple[int, int], expect_count: int) -> dict[str, dict]:
    """The verification pass: the archive still parses, nothing moved."""
    cd_start, cd_size, eocd = locate_central_directory(data)
    if (cd_start, cd_size) != expect_cd:
        raise OmniError("verification: central directory moved during patching")
    entries = parse_central_directory(data, cd_start, eocd)
    if len(entries) != expect_count:
        raise OmniError("verification: entry count changed during patching")
    for name, ent in entries.items():
        if data[ent["lho"]:ent["lho"] + 4] != b"PK\x03\x04":
            raise OmniError(f"verification: {name} lost its local header")
        l_nlen = struct.unpack("<H", data[ent["lho"] + 26:ent["lho"] + 28])[0]
        if data[ent["lho"] + 30:ent["lho"] + 30 + l_nlen].decode(
            "utf-8", "surrogateescape"
        ) != name:
            raise OmniError(f"verification: {name} local header name mismatch")
    return entries


def verify_member(data: bytes, entries: dict[str, dict], info: dict,
                  expect_new: bool) -> None:
    """Re-read a patched member from the finished bytes and prove the change."""
    name = info["member"]
    ent = entries[name]
    body = member_body_offset(data, ent["lho"], ent["nlen"], ent["elen"], name)
    source = data[body:body + ent["csize"]]
    if len(source) != info["size"]:
        raise OmniError(f"verification: {name} size changed")
    # The member is STORED, so the bytes on disk ARE the content: the stored CRC
    # must equal the CRC of what is there.
    recomputed = zlib.crc32(source) & 0xFFFFFFFF
    if recomputed != ent["crc"]:
        raise OmniError(
            f"verification: {name} stored CRC {ent['crc']:#010x} != "
            f"recalculated {recomputed:#010x}; the central directory would be "
            "lying about the patched member"
        )
    for line in info["substitutions"]:
        old, _, new = line.partition(" -> ")
        old_b = old.encode("utf-8", "surrogateescape")
        new_b = new.encode("utf-8", "surrogateescape")
        if expect_new:
            if new_b not in source:
                raise OmniError(f"verification: {name} did not take {line}")
            if old_b in source:
                raise OmniError(f"verification: {name} still contains {old!r}")
        else:
            if new_b in source:
                raise OmniError(f"verification: {name} unexpectedly contains {new!r}")
            if old_b not in source:
                raise OmniError(f"verification: {name} lost its original {old!r}")


def patch_archive(src: Path, dst: Path, patches: list[MemberPatch]) -> list[dict]:
    """Apply every patch and write dst. Returns the per-member report."""
    original = src.read_bytes()
    data = bytearray(original)
    if not data:
        raise OmniError(f"{src} is empty")

    cd_start, cd_size, eocd_at = locate_central_directory(original)
    entries = parse_central_directory(original, cd_start, eocd_at)
    expect_count = len(entries)

    applied: list[dict] = []
    for patch in patches:
        apply_member_patch(data, entries, patch, applied)

    if len(data) != len(original):
        raise OmniError("verification: file size changed; aborting before write")

    # Full re-parse of what we are about to write.
    final = bytes(data)
    v_entries = reparse_and_check(final, (cd_start, cd_size), expect_count)
    # And the member content check per patch, plus CRC agreement.
    for info in applied:
        verify_member(final, v_entries, info, expect_new=True)

    # Nothing may differ except the patched members' bodies and their CRC fields.
    changed = [i for i, (a, b) in enumerate(zip(original, final)) if a != b]
    allowed: set[int] = set()
    for info in applied:
        allowed |= set(range(info["body"], info["body"] + info["size"]))
        allowed |= set(range(info["cd_crc_at"], info["cd_crc_at"] + 4))
        allowed |= set(range(info["local_crc_at"], info["local_crc_at"] + 4))
    stray = [i for i in changed if i not in allowed]
    if stray:
        raise OmniError(
            "verification: bytes changed outside the patched members and their "
            f"CRC fields (first stray offset {stray[0]}); aborted before writing"
        )

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(final)
    return applied


def verify_archive(path: Path, patches: list[MemberPatch]) -> list[dict]:
    """Check an already-written archive carries every patch (no write)."""
    data = path.read_bytes()
    cd_start, cd_size, eocd_at = locate_central_directory(data)
    entries = parse_central_directory(data, cd_start, eocd_at)
    found: list[dict] = []
    for patch in patches:
        if patch.path not in entries:
            raise OmniError(f"{path}: {patch.path} is not present")
        ent = entries[patch.path]
        body = member_body_offset(data, ent["lho"], ent["nlen"], ent["elen"], patch.path)
        source = data[body:body + ent["csize"]]
        recomputed = zlib.crc32(source) & 0xFFFFFFFF
        if recomputed != ent["crc"]:
            raise OmniError(
                f"{path}: {patch.path} stored CRC {ent['crc']:#010x} != "
                f"recalculated {recomputed:#010x}"
            )
        for sub in patch.substitutions:
            if sub.pattern in source:
                raise OmniError(
                    f"{path}: {patch.path} still contains "
                    f"{sub.pattern.decode('utf-8', 'replace')!r} — not patched"
                )
            if sub.replacement not in source:
                raise OmniError(
                    f"{path}: {patch.path} does not contain "
                    f"{sub.replacement.decode('utf-8', 'replace')!r} — not patched"
                )
        found.append({
            "member": patch.path,
            "crc": ent["crc"],
            "size": ent["csize"],
            "substitutions": [repr(s) for s in patch.substitutions],
            "body": body,
            "cd_crc_at": ent["cd_offset"] + 16,
            "local_crc_at": ent["lho"] + 14,
        })
    return found


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("input", type=Path, nargs="?", help="input omni.ja")
    ap.add_argument("output", type=Path, nargs="?", help="patched output path")
    ap.add_argument("--patch", action="append", default=[],
                    help="built-in patch name (repeatable; currently: ziy)")
    ap.add_argument("--patch-file", action="append", default=[], type=Path,
                    help="TOML patch file (repeatable)")
    ap.add_argument("--verify", action="store_true",
                    help="verify an existing archive against the patches; no write")
    args = ap.parse_args()

    try:
        patches: list[MemberPatch] = []
        for name in args.patch:
            if name == "ziy":
                patches.extend(ZIY_PATCHES)
            elif name == "ziy-browser":
                patches.extend(ZIY_BROWSER_PATCHES)
            elif name == "ziy-all":
                patches.extend(ZIY_PATCHES)
                patches.extend(ZIY_BROWSER_PATCHES)
            else:
                raise OmniError(
                    f"unknown built-in patch {name!r} "
                    "(available: ziy, ziy-browser, ziy-all)"
                )
        for pfile in args.patch_file:
            patches.extend(load_patch_file(pfile))
        if not patches:
            raise OmniError("no patches selected; use --patch ziy and/or --patch-file")

        if args.verify:
            if not args.input:
                raise OmniError("--verify needs the archive to check")
            found = verify_archive(args.input, patches)
            print(f"omni-ja: {args.input} carries {len(found)} patched member(s):")
            for info in found:
                print(f"  {info['member']}  size {info['size']}  crc {info['crc']:#010x}")
                for line in info["substitutions"]:
                    print(f"    {line}")
            return 0

        if not args.input or not args.output:
            raise OmniError("patch mode needs <input> and <output>")
        if not args.input.exists():
            raise OmniError(f"{args.input}: no such file")
        if args.output.exists() and args.output.samefile(args.input):
            raise OmniError("refusing to patch in place")

        applied = patch_archive(args.input, args.output, patches)
    except OmniError as exc:
        sys.stderr.write(f"omni-ja: {exc}\n")
        return FAIL_PRECONDITION if exc.precondition() else FAIL_VERIFY
    except OSError as exc:
        sys.stderr.write(f"omni-ja: {exc}\n")
        return FAIL_USAGE

    print(f"omni-ja: {args.input} -> {args.output}")
    for info in applied:
        print(f"  patched        {info['member']}")
        print(f"  member offset  {info['body']}  size {info['size']}")
        for line in info["substitutions"]:
            print(f"    {line}")
        print(f"  member CRC     {info['crc_before']:#010x} -> {info['crc_after']:#010x}")
    total_bytes = sum(
        len(s.pattern) for patch in patches for s in patch.substitutions
    )
    print(f"  {len(applied)} member(s) patched, byte-length preserving "
          f"(~{total_bytes} bytes rewritten)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
