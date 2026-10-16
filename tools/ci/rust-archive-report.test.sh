#!/usr/bin/env bash
# tools/ci/rust-archive-report.test.sh — prove tools/ci/rust-archive-report.sh
# classifies archives correctly and trips its gate on exactly the two container
# conditions it documents.
#
# RUN IT:  bash tools/ci/rust-archive-report.test.sh
# NEEDS:   bash, ar, od, file, sha256sum, stat (all in step b's toolchain) and
#          clang-19 for the LLVM-bitcode fixture. Without clang the bitcode case
#          SKIPs and says so — it does not silently pass.
# COST:    seconds. No Gecko, no network, no dispatch.
#
# WHY IT EXISTS (replica/compile-readiness.md §9): the tool this tests is the
# only instrument for the libgkrust.a link failure of run 38914407147, and an
# instrument that has never been shown a known-good and a known-bad input is
# not evidence. Every fixture below is built with a format known by
# construction, so a wrong verdict is a test failure rather than a runner
# mystery:
#   elf.a       archive whose member is a real ELF object   -> ARCHIVE-OF-ELF-OBJECTS (gate 0)
#   bitcode.a   archive whose member is real LLVM bitcode   -> ARCHIVE-OF-LLVM-BITCODE (gate 0)
#   thin.a      thin archive (ar rcsT)                      -> THIN-ARCHIVE          (gate 0)
#   empty.a     zero bytes                                  -> EMPTY                (gate 1)
#   text.a      a linker-looking text file                  -> NOT-AN-ARCHIVE       (gate 1)
# The bitcode case exits 0 ON PURPOSE: g2a must not abort a run on a suspected
# member format. The script's own header carries that reasoning.
#
# EXIT: 0 = every case behaved as documented; 1 = at least one did not.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="$ROOT/ci/rust-archive-report.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ziy-archive-test-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

OBJ="$WORK/obj-ziy/x86_64-unknown-linux-gnu/release"
mkdir -p "$OBJ"
ARCHIVE="$OBJ/libgkrust.a"

PASS=0
FAIL=0
SKIP=0

note() { printf '%s\n' "$*"; }

check() { # $1=label $2=expected verdict substring $3=expected gate rc
  local label="$1" want="$2" want_rc="$3" out verdict rc ok="PASS"
  out="$(bash "$REPORT" --objdir "$WORK/obj-ziy" 2>&1)"
  verdict="$(printf '%s\n' "$out" | grep -m1 '^verdict: ')"
  rc=0
  bash "$REPORT" --objdir "$WORK/obj-ziy" --gate >/dev/null 2>&1 || rc=$?
  case "$verdict" in
    *"$want"*) ;;
    *) ok="FAIL(verdict)";;
  esac
  if [ "$rc" -ne "$want_rc" ]; then
    ok="FAIL(gate rc=$rc want=$want_rc)"
  fi
  if [ "$ok" = "PASS" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
  printf '%-5s %-12s gate_rc=%s  %s\n' "$ok" "$label" "$rc" "$verdict"
  if [ "$ok" != "PASS" ]; then
    printf '%s\n' "$out" | head -25 | sed 's/^/      /'
  fi
}

# --- fixtures ---------------------------------------------------------------
cat > "$WORK/hello.c" <<'C'
int ziy_probe(int x) { return x + 1; }
C

if command -v clang-19 >/dev/null 2>&1; then
  clang-19 -c "$WORK/hello.c" -o "$WORK/hello.o"
  clang-19 -emit-llvm -c "$WORK/hello.c" -o "$WORK/hello.bc"
  HAVE_CLANG=1
else
  HAVE_CLANG=0
  note "clang-19 not found — the ELF and bitcode fixtures will be SKIPped"
fi

# NOTE: `ar rcs` UPDATES an archive in place — run twice against the same path
# it APPENDS, so the second archive silently keeps the first one's member and
# the fixture stops testing what its name says. (The first run of this file did
# exactly that: bitcode.a was still elf.a's member plus a bitcode member, and
# the report called it ARCHIVE-OF-ELF-OBJECTS. The test failed, the tool was
# right.) Every fixture is therefore built on a freshly removed path.
mk_archive() { rm -f "$ARCHIVE"; ar rcs "$ARCHIVE" "$1"; }

if [ "$HAVE_CLANG" = "1" ]; then
  mk_archive "$WORK/hello.o";  check "elf.a" "ARCHIVE-OF-ELF-OBJECTS" 0
  mk_archive "$WORK/hello.bc"; check "bitcode.a" "ARCHIVE-OF-LLVM-BITCODE" 0
else
  SKIP=$((SKIP + 2))
fi

if ar rcsT "$WORK/thin.a" "$WORK/hello.o" 2>/dev/null; then
  cp "$WORK/thin.a" "$ARCHIVE"; check "thin.a" "THIN-ARCHIVE" 0
else
  SKIP=$((SKIP + 1)); note "SKIP thin.a — this ar has no rcsT (thin archive) support"
fi

: > "$ARCHIVE"; check "empty.a" "EMPTY" 1
printf 'ld: internal error: cannot open the archive\n' > "$ARCHIVE"
check "text.a" "NOT-AN-ARCHIVE" 1

# --- CLI shape --------------------------------------------------------------
# A diagnostic that dies on a bad argument is a diagnostic nobody can use from a
# step that is already failing.
if bash "$REPORT" --not-an-option >/dev/null 2>&1; then
  printf '%-5s %-12s\n' "FAIL" "usage" ; FAIL=$((FAIL + 1))
else
  rc=$?
  if [ "$rc" -eq 2 ]; then printf '%-5s %-12s rc=%s\n' "PASS" "usage" "$rc"; PASS=$((PASS + 1));
  else printf '%-5s %-12s rc=%s (want 2)\n' "FAIL" "usage" "$rc"; FAIL=$((FAIL + 1)); fi
fi

out="$(bash "$REPORT" --objdir "$WORK/no-such-objdir" 2>&1)"
if printf '%s\n' "$out" | grep -q "NO-ARCHIVES-FOUND"; then
  printf '%-5s %-12s\n' "PASS" "no-objdir"; PASS=$((PASS + 1))
else
  printf '%-5s %-12s\n' "FAIL" "no-objdir"; FAIL=$((FAIL + 1))
  printf '%s\n' "$out" | head -20 | sed 's/^/      /'
fi

# An explicit archive argument must work without --objdir (g2b may be called
# from a directory that has no objdir on its PATH-relative side).
if [ "$HAVE_CLANG" = "1" ]; then
  out="$(bash "$REPORT" "$WORK/hello.bc" 2>&1)"
  if printf '%s\n' "$out" | grep -q "NOT-AN-ARCHIVE-LLVM-BITCODE"; then
    printf '%-5s %-12s\n' "PASS" "bare-file"; PASS=$((PASS + 1))
  else
    printf '%-5s %-12s\n' "FAIL" "bare-file"; FAIL=$((FAIL + 1))
    printf '%s\n' "$out" | head -20 | sed 's/^/      /'
  fi
fi

# The readers' behaviour IS the evidence, so it is asserted rather than trusted:
# binutils' readelf must be shown naming the bitcode, and llvm-bcanalyzer must be
# shown reading it. If a runner's llvm-bcanalyzer is missing, the case SKIPs (the
# tool prints '(absent)' in its roster, so the absence is still in the record).
if [ "$HAVE_CLANG" = "1" ]; then
  # Point at the ARCHIVE fixture, not a bare .bc: a bare file is reported at
  # container level only (which is correct — the linker's input is the
  # archive), so the member readers only run on a real ar container. That is
  # also the shape of the real failure: an `ar` archive whose member is bitcode.
  mk_archive "$WORK/hello.bc"
  out="$(bash "$REPORT" --objdir "$WORK/obj-ziy" 2>&1)"
  if printf '%s\n' "$out" | grep -q "This is a LLVM bitcode file"; then
    printf '%-5s %-12s\n' "PASS" "readelf-names"; PASS=$((PASS + 1))
  else
    printf '%-5s %-12s\n' "FAIL" "readelf-names"; FAIL=$((FAIL + 1))
    printf '%s\n' "$out" | tail -20 | sed 's/^/      /'
  fi
  if command -v llvm-bcanalyzer-19 >/dev/null 2>&1 || command -v llvm-bcanalyzer >/dev/null 2>&1; then
    if printf '%s\n' "$out" | grep -q "Stream type: LLVM IR"; then
      printf '%-5s %-12s\n' "PASS" "bcanalyzer-reads"; PASS=$((PASS + 1))
    else
      printf '%-5s %-12s\n' "FAIL" "bcanalyzer-reads"; FAIL=$((FAIL + 1))
      printf '%s\n' "$out" | tail -20 | sed 's/^/      /'
    fi
  else
    printf '%-5s %-12s\n' "SKIP" "bcanalyzer-reads (no llvm-bcanalyzer on PATH)"; SKIP=$((SKIP + 1))
  fi
fi

printf '\n%d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
