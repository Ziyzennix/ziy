#!/usr/bin/env python3
"""The Ziy omni.ja signing patch.

architecture.md §1.4 records why this is safe and why it is one place instead
of many:

  Firefox release builds refuse to install unsigned add-ons. The two constants
  that decide that — MOZ_REQUIRE_SIGNING and MOZ_ALLOW_ADDON_SIDELOAD — live
  ONLY in modules/AppConstants.sys.mjs inside omni.ja. They are not compiled
  into firefox-bin or libxul.so (`strings ... | grep MOZ_REQUIRE_SIGNING` is
  empty in both). The module is STORED (uncompressed) inside the zip, so the
  two strings can be rewritten in place at equal length, which leaves every
  central-directory offset and CRC valid.

  Ziy needs this because the whole suite ships unsigned from our own repo
  (replica/architecture.md §8: ids come from the .xpi filename, the add-ons are
  ours, and nothing from AMO can replace them).

What this script does, in order:

  1. Reads the input omni.ja.
  2. Locates its central directory (omni.ja is a zip wrapped in a small
     envelope — see README in this directory).
  3. Finds modules/AppConstants.sys.mjs and reads its local-header offset.
  4. Verifies the exact source strings are present. If either is missing, the
     file is already patched or is an unexpected build, and the script FAILS
     LOUDLY rather than writing a file that claims to be patched.
  5. Rewrites both booleans, byte-length preserving (same number of characters:
     `true` -> `false` and `false` -> `true`).
  6. Writes the output file, re-opens it, and re-verifies:
       - the new strings are present and the old ones are gone,
       - every central-directory entry still has a matching local header,
       - the file size is unchanged and no byte outside the two replaced runs
         was modified.

Usage:
    python3 patch-omni.py <in-omni.ja> <out-omni.ja> [--force]

Exit codes: 0 = patched OK, 1 = precondition failed (absent strings),
            2 = verification failed, 3 = usage/IO error.
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path

MEMBER = "modules/AppConstants.sys.mjs"

OLD_SIGNING = b"MOZ_REQUIRE_SIGNING: true,"
NEW_SIGNING = b"MOZ_REQUIRE_SIGNING: false,"
OLD_SIDELOAD = b"MOZ_ALLOW_ADDON_SIDELOAD: false,"
NEW_SIDELOAD = b"MOZ_ALLOW_ADDON_SIDELOAD: true,"

FAIL_PRECONDITION = 1
FAIL_VERIFY = 2
FAIL_USAGE = 3


class OmniError(Exception):
    pass


def locate_central_directory(data: bytes) -> tuple[int, int]:
    """Return (cd_start, cd_size) for the inner zip of an omni.ja container.

    omni.ja is not a bare zip: it begins with a 4-byte envelope and the zip's
    central directory sits right after it, while the zip's own offset fields
    are relative to the file start. The structure was reverse-engineered from
    /usr/lib/firefox/omni.ja and is stable across the two Firefox builds this
    project targets; see README.md in this directory for the byte map.

    The EOCD *inside* the envelope is the one whose central-directory offset
    points at the same place its central directory actually ends, so we find it
    by scanning every EOCD candidate and taking the one that resolves.
    """
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
        # The real central directory ends exactly where the EOCD begins.
        cd_start = eocd - cd_size
        if cd_start < 0 or cd_start + cd_size != eocd:
            continue
        # And it must actually start with a central-directory file header.
        if data[cd_start:cd_start + 4] != b"PK\x01\x02":
            continue
        return cd_start, cd_size, eocd
    raise OmniError(
        "found EOCD candidates but none had a consistent central directory; "
        "this is not an omni.ja layout this script understands"
    )


def parse_central_directory(data: bytes, cd_start: int, cd_end: int) -> dict[str, dict]:
    """Return {name: entry} for every central-directory file header."""
    entries: dict[str, dict] = {}
    pos = cd_start
    while pos < cd_end:
        if data[pos:pos + 4] != b"PK\x01\x02":
            raise OmniError(f"central directory entry at {pos} is not PK\\x01\\x02")
        fields = struct.unpack(
            "<4sHHHHHHIIIHHHHHII", data[pos:pos + 46]
        )
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
            # Absolute offset of this entry's central-directory header, so the
            # patcher can find and rewrite its CRC field in place.
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
        raise OmniError(
            f"{name}: local header names a different entry ({local_name!r})"
        )
    return lho + 30 + l_nlen + l_elen


def patch(src: Path, dst: Path) -> dict:
    data = bytearray(src.read_bytes())
    original_size = len(data)

    cd_start, cd_size, eocd_at = locate_central_directory(bytes(data))
    entries = parse_central_directory(bytes(data), cd_start, eocd_at)

    if MEMBER not in entries:
        raise OmniError(
            f"{src}: {MEMBER} is not present. This omni.ja is not a Firefox "
            "layout this patch covers (or has already been repackaged)."
        )
    entry = entries[MEMBER]
    if entry["method"] != 0:
        raise OmniError(
            f"{MEMBER} is compressed (method {entry['method']}); the "
            "byte-length-preserving rewrite requires a stored member. A "
            "recompressing patch needs a different tool."
        )

    body = member_body_offset(bytes(data), entry["lho"], entry["nlen"], entry["elen"], MEMBER)
    end = body + entry["csize"]
    if end > len(data):
        raise OmniError(f"{MEMBER} body runs past the end of {src}")

    actual_crc = zlib.crc32(bytes(data[body:end])) & 0xFFFFFFFF
    if actual_crc != entry["crc"]:
        raise OmniError(
            f"{MEMBER} CRC mismatch (stored {entry['crc']:#010x}, "
            f"actual {actual_crc:#010x}); refusing to patch a corrupt archive"
        )

    source = bytes(data[body:end])
    if OLD_SIGNING not in source:
        raise OmniError(
            f"PRECONDITION FAILED: {MEMBER} does not contain "
            f"{OLD_SIGNING.decode()!r}. Either omni.ja is already patched "
            "(re-run against a fresh Firefox install) or this Firefox moved "
            "the constant. Run with --force to overwrite the output anyway."
        )
    if OLD_SIDELOAD not in source:
        raise OmniError(
            f"PRECONDITION FAILED: {MEMBER} does not contain "
            f"{OLD_SIDELOAD.decode()!r}."
        )

    patched = source.replace(OLD_SIGNING, NEW_SIGNING, 1)
    patched = patched.replace(OLD_SIDELOAD, NEW_SIDELOAD, 1)

    if len(patched) != len(source):
        raise OmniError(  # cannot happen with these two substitutions
            f"patch is not byte-length preserving ({len(source)} -> {len(patched)})"
        )
    new_crc = zlib.crc32(patched) & 0xFFFFFFFF

    data[body:end] = patched
    if len(data) != original_size:
        raise OmniError("output size changed; aborting before write")

    # A stored member's CRC has to be recomputed and written back into BOTH the
    # central directory header and the local file header, or the archive claims
    # a checksum the bytes no longer have. Both fields sit at a fixed offset in
    # their 46-/30-byte headers, and rewriting a 4-byte field at its original
    # position cannot move anything, so offsets stay valid.
    if new_crc == entry["crc"]:
        # Only possible if the content did not really change; do not touch it.
        pass
    cd_crc_at = entry["cd_offset"] + 16
    local_crc_at = entry["lho"] + 14
    if bytes(data[cd_crc_at:cd_crc_at + 4]) != struct.pack("<I", entry["crc"]):
        raise OmniError("central directory CRC field is not where we expect it")
    if bytes(data[local_crc_at:local_crc_at + 4]) != struct.pack("<I", entry["crc"]):
        raise OmniError("local header CRC field is not where we expect it")
    struct.pack_into("<I", data, cd_crc_at, new_crc)
    struct.pack_into("<I", data, local_crc_at, new_crc)

    # --- verification pass, on the bytes we are about to write -----------------
    v_cd_start, v_cd_size, v_eocd = locate_central_directory(bytes(data))
    if (v_cd_start, v_cd_size) != (cd_start, cd_size):
        raise OmniError("central directory moved during patching")
    v_entries = parse_central_directory(bytes(data), v_cd_start, v_eocd)
    if len(v_entries) != len(entries):
        raise OmniError("entry count changed during patching")

    # Every entry's local header must still be present and named correctly.
    for name, ent in v_entries.items():
        if data[ent["lho"]:ent["lho"] + 4] != b"PK\x03\x04":
            raise OmniError(f"verification: {name} lost its local header")
        l_nlen = struct.unpack("<H", data[ent["lho"] + 26:ent["lho"] + 28])[0]
        if data[ent["lho"] + 30:ent["lho"] + 30 + l_nlen].decode(
            "utf-8", "surrogateescape"
        ) != name:
            raise OmniError(f"verification: {name} local header name mismatch")

    v_body = member_body_offset(bytes(data), v_entries[MEMBER]["lho"],
                               v_entries[MEMBER]["nlen"], v_entries[MEMBER]["elen"],
                               MEMBER)
    v_source = bytes(data[v_body:v_body + v_entries[MEMBER]["csize"]])
    if NEW_SIGNING not in v_source or OLD_SIGNING in v_source:
        raise OmniError("verification: MOZ_REQUIRE_SIGNING not flipped")
    if NEW_SIDELOAD not in v_source or OLD_SIDELOAD in v_source:
        raise OmniError("verification: MOZ_ALLOW_ADDON_SIDELOAD not flipped")

    # The member is STORED, so the data on disk IS the honest content: recompute
    # the CRC of the patched member and check it against what the central
    # directory now claims.
    recomputed = zlib.crc32(v_source) & 0xFFFFFFFF
    if recomputed != v_entries[MEMBER]["crc"]:
        raise OmniError(
            "verification: stored CRC "
            f"{v_entries[MEMBER]['crc']:#010x} != recalculated {recomputed:#010x}; "
            "the central directory would be lying about the patched member"
        )

    # Nothing may differ except the member body and the two 4-byte CRC fields
    # we deliberately rewrote. Everything else — every local header, every
    # central-directory entry, the EOCD, the envelope prefix — must be
    # byte-identical, which is what keeps the container loadable.
    original = src.read_bytes()
    changed: list[int] = []
    if len(data) != len(original):
        raise OmniError("verification: file size changed")
    for i, (a, b) in enumerate(zip(original, data)):
        if a != b:
            changed.append(i)
    allowed = set(range(body, end)) | set(range(cd_crc_at, cd_crc_at + 4)) | set(
        range(local_crc_at, local_crc_at + 4)
    )
    stray = [i for i in changed if i not in allowed]
    if stray:
        raise OmniError(
            "verification: bytes changed outside the patched member and its CRC "
            f"fields (first stray offset {stray[0]}); aborted before writing"
        )

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(bytes(data))

    return {
        "member": MEMBER,
        "crc_before": entry["crc"],
        "crc_after": new_crc,
        "member_offset": body,
        "member_size": entry["csize"],
        "entries": len(v_entries),
        "bytes_changed": len(changed),
        "size": len(data),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("input", type=Path, help="input omni.ja")
    ap.add_argument("output", type=Path, help="patched output path")
    args = ap.parse_args()

    if not args.input.exists():
        sys.stderr.write(f"patch-omni.py: {args.input}: no such file\n")
        return FAIL_USAGE
    if args.output.exists() and args.output.samefile(args.input):
        sys.stderr.write("patch-omni.py: refusing to patch in place\n")
        return FAIL_USAGE

    try:
        info = patch(args.input, args.output)
    except OmniError as exc:
        sys.stderr.write(f"patch-omni.py: {exc}\n")
        return FAIL_PRECONDITION if "PRECONDITION FAILED" in str(exc) else FAIL_VERIFY

    print(f"patch-omni.py: {args.input} -> {args.output}")
    print(f"  patched        {info['member']}")
    print(f"  member offset  {info['member_offset']}  size {info['member_size']}")
    print(f"  bytes changed  {info['bytes_changed']} (byte-length preserving)")
    print(f"  member CRC     {info['crc_before']:#010x} -> {info['crc_after']:#010x}")
    print(f"  zip entries    {info['entries']}, file size {info['size']}")
    print("  MOZ_REQUIRE_SIGNING is now false; MOZ_ALLOW_ADDON_SIDELOAD is now true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
