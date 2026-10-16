#!/usr/bin/env bash
# tools/ci/rust-archive-report.sh — report the on-disk FORMAT of the Rust static
# libraries a Gecko build produced, so a link failure names the format instead
# of only the linker's complaint.
#
# WHY THIS EXISTS (run 38914407147, 2026-10-16). The hosted build reached
# `toolkit/library/build/libxul.so` at minute 241 of its `mach build` and died
# ten seconds later with:
#
#   /usr/bin/ld: ../../../x86_64-unknown-linux-gnu/release/libgkrust.a:
#     error adding symbols: file format not recognized
#
# The linker could not read the Rust static archive at all. The run answered no
# follow-up question: the runner is gone, nothing uploads the objdir, and the
# log carries neither the archive's size, its members, nor their object format.
# This script is what makes the next occurrence answerable — it is called by
# `.github/workflows/build-gecko.yml` step g2a (a cheap ~13-minute probe that
# builds ONLY `toolkit/library/rust`) and by step g2b (after a failed full
# build, before re-exiting with the build's own status).
#
# WHAT IT REFUSES TO CLAIM. The archive's format on the two failing runs is
# UNKNOWN — that is the open question, not a recorded fact. This script only
# prints what the bytes on disk are; it does not say which of the candidate
# causes (an LLVM-bitcode archive from a hand-set MOZ_LTO_RUST_CROSS, a
# truncated/zero-byte file from a full disk, a toolchain mismatch) produced
# them. `replica/compile-readiness.md` §9 carries the ranked, explicitly
# unverified hypothesis list.
#
# USAGE
#   tools/ci/rust-archive-report.sh [--objdir DIR] [ARCHIVE ...]
#   tools/ci/rust-archive-report.sh --gate [--objdir DIR]      # see --gate
#
# With no ARCHIVE arguments it searches --objdir (default: obj-ziy) for
# `libgkrust*.a`, then for any `*.a` under a `*/release/` directory.
#
# EXIT STATUS
#   0  report printed (and, with --gate, no provably-unlinkable archive found)
#   1  --gate only: an archive is EMPTY or is not an `ar` archive at all
#   2  usage error
#
# --gate TRIPS ON EXACTLY TWO CONTAINER CONDITIONS, deliberately:
#      * size 0            — nothing to link;
#      * first 8 bytes are neither `!<arch>` nor `!<thin>`.
#   Both are what BFD's `bfd_check_format` fails on, i.e. the exact condition
#   behind "error adding symbols: file format not recognized", and neither can
#   be fixed by letting the build continue. Everything else — including an
#   archive whose MEMBERS are LLVM bitcode, which binutils' ld cannot add but
#   which is only unlinkable if the C++ link really has no LTO plugin — is
#   reported as a verdict and a warning and does NOT trip the gate: aborting a
#   run on a suspected format would throw away the ccache progress the same run
#   is building, and the printed report is enough for the next dispatch to act
#   on. A `set -e`-style abort is the wrong shape for a measurement tool, so
#   this script runs without `-e`: partial evidence beats a dead probe.
#
# READ-ONLY. It never writes to, moves or deletes an archive; members are
# streamed to a temp dir (`ar p`) and the temp dir is removed on exit.

set -uo pipefail

OBJDIR="obj-ziy"
GATE=0
ARCHIVES=()

usage() {
  sed -n '/^# USAGE/,/^# --gate TRIPS/p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --objdir)
      [ $# -ge 2 ] || { echo "rust-archive-report: --objdir needs a value" >&2; exit 2; }
      OBJDIR="$2"; shift 2 ;;
    --gate) GATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "rust-archive-report: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) ARCHIVES+=("$1"); shift ;;
  esac
done

TMPDIR_REPORT="$(mktemp -d "${TMPDIR:-/tmp}/ziy-rust-archive-XXXXXX")"
cleanup() { rm -rf "$TMPDIR_REPORT"; }
trap cleanup EXIT

# --- tool roster ------------------------------------------------------------
# Printed first, on purpose: a verdict is only as good as the tools that
# produced it, and "the tool was absent" is a result, not a footnote. Numeric
# suffixes are NOT hardcoded as present — the roster below says what exists on
# this machine, so a run where llvm-tools-preview failed to install is
# self-evident in the log.
report_tools() {
  echo "== tools =="
  local t
  for t in ar readelf nm file od sha256sum stat; do
    printf '%-14s %s\n' "$t" "$(command -v "$t" 2>/dev/null || echo '(absent)')"
  done
  printf 'ar --version   %s\n' "$(ar --version 2>/dev/null | head -1 || echo '(none)')"
  for t in llvm-ar-19 llvm-nm-19 llvm-readelf-19 llvm-readobj-19 llvm-bcanalyzer-19 \
           llvm-ar llvm-nm llvm-readelf llvm-readobj llvm-bcanalyzer; do
    printf '%-14s %s\n' "$t" "$(command -v "$t" 2>/dev/null || echo '(absent)')"
  done
}

# --- byte-level classification ---------------------------------------------
# The magic bytes are checked directly rather than trusting `file`, because the
# verdict has to hold on a runner whose `file` database version is unknown:
#   ELF         7f 45 4c 46              \x7fELF
#   bitcode     42 43 c0 de              'BC' 0xc0 0xde   (raw bitcode)
#   bitcode      de c0 17 0b             0xDEC0170B       (bitcode wrapper)
#   ar archive  21 3c 61 72 63 68 3e 0a  "!<arch>\n"      (!<thin> for thin)
magic_8() { head -c 8 "$1" 2>/dev/null; }

classify_bytes() {
  # $1 = file to classify (never a directory). Echoes one token.
  local f="$1" m
  m="$(head -c 4 "$1" 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n')"
  case "$m" in
    7f454c46) echo "ELF-OBJECT"; return ;;
    4243c0de|dec0170b) echo "LLVM-BITCODE"; return ;;
  esac
  m="$(magic_8 "$1")"
  case "$m" in
    '!<arch>') echo "AR-ARCHIVE"; return ;;
    '!<thin>') echo "THIN-AR-ARCHIVE"; return ;;
  esac
  echo "UNKNOWN"
}

classify_container() {
  local a="$1" sz m
  sz="$(stat -c%s "$a" 2>/dev/null || echo 0)"
  if [ "${sz:-0}" -eq 0 ]; then echo "EMPTY"; return; fi
  m="$(magic_8 "$a")"
  case "$m" in
    '!<arch>') echo "AR-ARCHIVE"; return ;;
    '!<thin>') echo "THIN-AR-ARCHIVE"; return ;;
  esac
  # An archive we cannot even read the header of, or something that is not an
  # archive: both are the "not recognized" class. Keep the distinction visible.
  case "$(classify_bytes "$a")" in
    ELF-OBJECT) echo "NOT-AN-ARCHIVE-ELF-OBJECT" ;;
    LLVM-BITCODE) echo "NOT-AN-ARCHIVE-LLVM-BITCODE" ;;
    *) echo "NOT-AN-ARCHIVE" ;;
  esac
}

# --- member evidence --------------------------------------------------------
member_list() {
  # Regular archives only; thin archives name paths that may not exist here.
  ar t "$1" 2>"$TMPDIR_REPORT/ar.err"
}

first_object_member() {
  # `ar t` prints the symbol table as "/" (or "/SYM64/") and long-name tables as
  # "//": those are not object members, so they are skipped when picking the
  # member to inspect.
  awk '!/^\/$|^\/\/$|^\/SYM64\/$/ { print; exit }'
}

# --- one archive ------------------------------------------------------------
report_archive() {
  local a="$1" sz container verdict members first rm_of tmp member klass
  echo "== archive: $a =="
  if [ ! -e "$a" ]; then
    echo "verdict: ABSENT — no such file"
    return 0
  fi
  if [ -d "$a" ]; then
    echo "verdict: IS-A-DIRECTORY — the link expects a file here"
    return 0
  fi
  sz="$(stat -c%s "$a" 2>/dev/null || echo 0)"
  echo "size_bytes: $sz"
  echo "mode_owner: $(stat -c '%A %U:%G %y' "$a" 2>/dev/null || echo '(stat failed)')"
  # A cheap, stable fingerprint: hashing the first MiB distinguishes "same
  # archive as the probe saw" from "the file changed between probe and link"
  # without reading a multi-GB file twice per run.
  echo "head1MiB_sha256: $(head -c 1048576 "$a" 2>/dev/null | sha256sum 2>/dev/null | awk '{print $1}')"
  printf 'first8_bytes_octal: %s\n' "$(magic_8 "$a" | od -An -c 2>/dev/null | tr -s ' ')"
  printf 'first8_bytes_hex:   %s\n' "$(magic_8 "$a" | od -An -tx1 2>/dev/null | tr -s ' ')"

  container="$(classify_container "$a")"
  echo "container: $container"
  echo "file(1): $(file -b "$a" 2>/dev/null || echo '(file absent)')"

  members=""
  if [ "$container" = "AR-ARCHIVE" ]; then
    members="$(member_list "$a")"
    if [ -s "$TMPDIR_REPORT/ar.err" ]; then
      echo "ar stderr: $(cat "$TMPDIR_REPORT/ar.err")"
    fi
    echo "ar_member_count: $(printf '%s\n' "$members" | grep -c . 2>/dev/null || echo 0)"
    echo "ar_members_first5:"
    printf '%s\n' "$members" | head -5 | sed 's/^/  /'
    first="$(printf '%s\n' "$members" | first_object_member)"
    if [ -n "$first" ]; then
      tmp="$TMPDIR_REPORT/member"
      if ar p "$a" "$first" > "$tmp" 2>"$TMPDIR_REPORT/arp.err" && [ -s "$tmp" ]; then
        echo "first_object_member: $first ($(stat -c%s "$tmp") bytes)"
        klass="$(classify_bytes "$tmp")"
        printf 'first_object_member_magic_hex: %s\n' \
          "$(head -c 4 "$tmp" | od -An -tx1 | tr -d ' \n')"
        echo "first_object_member_format: $klass  (from the magic bytes above, not from a tool's opinion)"
        echo "first_object_member_file(1): $(file -b "$tmp" 2>/dev/null || echo '(file absent)')"
        echo "first_object_member_readelf:"
        readelf -h "$tmp" 2>&1 | head -6 | sed 's/^/  /'
        # WHAT THE READERS ACTUALLY DO — measured on the dev box 2026-10-16
        # against a member that IS bitcode (fixture: `clang-19 -emit-llvm -c`):
        #   readelf         -> "Error: This is a LLVM bitcode file - try using
        #                        llvm-bcanalyzer"      <- binutils NAMES it
        #   llvm-readelf    -> "warning: bitcode files are not supported"
        #   llvm-readobj    -> the same
        #   llvm-bcanalyzer -> "Stream type: LLVM IR"     <- the second opinion
        # So binutils' readelf is the tool that names the format, and
        # llvm-bcanalyzer is the one that reads it; the LLVM object readers
        # REFUSE bitcode. They are still tried, because they are the right tool
        # for an ELF member that binutils' readelf could not open, and every
        # line they print is evidence either way. (An earlier version of this
        # comment claimed the LLVM readers could read bitcode members; the
        # fixture falsified it. Corrected, not kept.)
        if [ "$klass" != "ELF-OBJECT" ]; then
          local llvm_tool
          for llvm_tool in llvm-readelf llvm-readelf-19 llvm-readobj llvm-readobj-19; do
            if command -v "$llvm_tool" >/dev/null 2>&1; then
              echo "first_object_member_${llvm_tool} --file-header:"
              "$llvm_tool" --file-header "$tmp" 2>&1 | head -8 | sed 's/^/  /'
            fi
          done
          local bcanalyzer
          for bcanalyzer in llvm-bcanalyzer llvm-bcanalyzer-19; do
            if command -v "$bcanalyzer" >/dev/null 2>&1; then
              echo "first_object_member_${bcanalyzer} (summary — 'Stream type' is the format):"
              "$bcanalyzer" "$tmp" 2>&1 | head -6 | sed 's/^/  /'
            fi
          done
        fi
        rm_of="$(nm -A "$tmp" 2>/dev/null | wc -l)"
        echo "first_object_member_nm_symbols: $rm_of"
      else
        echo "first_object_member: could not be extracted with ar p"
        [ -s "$TMPDIR_REPORT/arp.err" ] && echo "  ar p stderr: $(cat "$TMPDIR_REPORT/arp.err")"
      fi
    else
      echo "first_object_member: none (only symbol-table members)"
    fi
  elif [ "$container" = "THIN-AR-ARCHIVE" ]; then
    echo "note: a THIN archive references member files by path; BFD ld reads"
    echo "      thin archives, but only while those paths still exist."
    echo "file(1): $(file -b "$a" 2>/dev/null || echo '(file absent)')"
  fi

  # --- verdict --------------------------------------------------------------
  case "$container" in
    EMPTY)
      verdict="EMPTY (0 bytes) — UNLINKABLE" ;;
    NOT-AN-ARCHIVE|NOT-AN-ARCHIVE-ELF-OBJECT|NOT-AN-ARCHIVE-LLVM-BITCODE)
      verdict="NOT-AN-ARCHIVE ($container) — UNLINKABLE by any ar reader" ;;
    THIN-AR-ARCHIVE)
      verdict="THIN-ARCHIVE — readable by BFD ld while the member paths resolve" ;;
    AR-ARCHIVE)
      case "${klass:-}" in
        ELF-OBJECT) verdict="ARCHIVE-OF-ELF-OBJECTS — a normal link input" ;;
        LLVM-BITCODE)
          verdict="ARCHIVE-OF-LLVM-BITCODE — binutils cannot add these symbols; \
linkable only through an LTO/bitcode-capable linker (see compile-readiness.md §9)" ;;
        *) verdict="ARCHIVE-OF-UNKNOWN-MEMBERS (first member: ${klass:-unread})" ;;
      esac ;;
    *) verdict="UNKNOWN" ;;
  esac
  echo "verdict: $verdict"
  return 0
}

# --- driver -----------------------------------------------------------------
report_tools
echo "objdir: $OBJDIR"
if [ -d "$OBJDIR" ]; then
  echo "objdir_size: $(du -sh "$OBJDIR" 2>/dev/null | cut -f1)"
else
  echo "objdir_size: (no $OBJDIR directory)"
fi
echo "disk: $(df -h . 2>/dev/null | awk 'NR==1 || NR==2 {printf "%s ", $0}')"

if [ "${#ARCHIVES[@]}" -eq 0 ]; then
  # The link command named this exact path, relative to obj-ziy:
  #   ../../../x86_64-unknown-linux-gnu/release/libgkrust.a
  # Search for it rather than assuming the objdir layout, then widen the search
  # to any release-profile static library, which is where a second Rust lib would
  # be if the layout differs from the local proof (deep-fork.md §6.3).
  if [ -d "$OBJDIR" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && ARCHIVES+=("$f")
    done < <(find "$OBJDIR" -type f -name 'libgkrust*.a' 2>/dev/null | sort)
    if [ "${#ARCHIVES[@]}" -eq 0 ]; then
      while IFS= read -r f; do
        [ -n "$f" ] && ARCHIVES+=("$f")
      done < <(find "$OBJDIR" -type f -path '*/release/*.a' 2>/dev/null | sort | head -20)
    fi
  fi
fi

if [ "${#ARCHIVES[@]}" -eq 0 ]; then
  echo "verdict: NO-ARCHIVES-FOUND — nothing named libgkrust*.a (or */release/*.a)"
  echo "         under $OBJDIR. Either the target never ran, or it writes elsewhere;"
  echo "         the link command's own path is the authority."
  exit 0
fi

GATE_HIT=0
for a in "${ARCHIVES[@]}"; do
  report_archive "$a"
  case "$(classify_container "$a")" in
    EMPTY|NOT-AN-ARCHIVE|NOT-AN-ARCHIVE-ELF-OBJECT|NOT-AN-ARCHIVE-LLVM-BITCODE)
      GATE_HIT=$((GATE_HIT + 1)) ;;
  esac
  echo
done

if [ "$GATE" -eq 1 ] && [ "$GATE_HIT" -gt 0 ]; then
  echo "gate: $GATE_HIT archive(s) cannot be read as an ar archive — a link against"
  echo "      them cannot succeed, and the build must not spend hours finding out."
  exit 1
fi
exit 0
