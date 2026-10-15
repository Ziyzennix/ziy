#!/usr/bin/env bash
# tools/build-extension.sh — package the Ziy WebExtension suite as .xpi files.
#
# One output per extensions/* directory that has a manifest.json, written to
# build/ziy/distribution/extensions/<addon-id>.xpi.
#
# The add-on id is read from each extension's browser_specific_settings.gecko.id
# and the file is named "<id>.xpi" because the app-scope distribution installer
# derives the add-on id from the FILENAME (XPIProvider.sys.mjs's getExpectedID
# strips ".xpi" and requires the result to match), and installs it with a
# distribution/<id>.xpi -> extensions.installedDistroAddon.<id> pref marker.
#
# Usage:
#   tools/build-extension.sh --all        # every extensions/* dir with a manifest
#   tools/build-extension.sh DIR [DIR...] # specific extension dir(s)
#   tools/build-extension.sh --check      # verify existing xpis in the output dir
#   tools/build-extension.sh --list XPI   # print the zip members of one xpi
#
# The packaging itself is tools/lib/zpxi.py (deterministic zip: fixed timestamp,
# sorted entries, *.map / node_modules/ / test/ / .DS_Store / *.bak excluded).
# This script only decides WHICH directories are packaged and reports the
# summary; it is deliberately dumb about extension internals.
#
# This script never touches tools/build-shell.sh. build-shell.sh copies
# *.xpi from build/ziy/distribution/extensions/ into the app dir itself, so
# packaging here is all the wiring the suite needs.
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"

EXT_ROOT="$ROOT/extensions"
OUT_DIR="${ZIY_XPI_OUT_DIR:-$ROOT/build/ziy/distribution/extensions}"

PACKER="$HERE/lib/zpxi.py"

MODE="pack"
declare -a TARGETS=()

note() { printf '\n%s== %s ==%s\n' "$(tput bold 2>/dev/null || echo '')" "$1" "$(tput sgr0 2>/dev/null || echo '')" >&2; }
die()  { printf 'fail: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --all) MODE="pack"; TARGETS=(); shift ;;
    --check) MODE="check"; shift ;;
    --list) MODE="list"; shift ;;
    --out) [ $# -ge 2 ] || die "--out needs a directory"; OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) TARGETS+=("$1"); shift ;;
  esac
done

if [ ! -f "$PACKER" ]; then
  die "packer not found: $PACKER"
fi

# --- --all: every extensions/* dir that has a manifest.json -------------------
# A directory with no manifest.json, or with one that is not yet valid JSON,
# is a sibling worker's work in progress: packaging it is impossible, failing
# the whole build over it would block everyone, and silently packaging garbage
# would be worse than both. So such directories are reported as SKIPPED and the
# build succeeds on everything that is real.
collect_all() {
  local d
  for d in "$EXT_ROOT"/*/; do
    [ -f "$d/manifest.json" ] || continue
    if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$d/manifest.json" 2>/dev/null; then
      continue
    fi
    printf '%s\n' "${d%/}"
  done
}

list_skipped() {
  local d
  for d in "$EXT_ROOT"/*/; do
    [ -f "$d/manifest.json" ] || continue
    if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$d/manifest.json" 2>/dev/null; then
      continue
    fi
    printf '  skip  %s (manifest.json is not valid JSON yet — not packaging)\n' "${d%/}" >&2
  done
  return 0
}

if [ "$MODE" = "pack" ] && [ ${#TARGETS[@]} -eq 0 ]; then
  MODE="all"
fi

if [ "$MODE" = "all" ]; then
  list_skipped
  mapfile -t TARGETS < <(collect_all)
  [ ${#TARGETS[@]} -gt 0 ] || die "no extensions/* directories with a manifest.json under $EXT_ROOT"
fi

# --- pack ---------------------------------------------------------------------
if [ "$MODE" = "pack" ] || [ "$MODE" = "all" ]; then
  note "packaging ${#TARGETS[@]} extension(s) -> $OUT_DIR"
  mkdir -p "$OUT_DIR"

  declare -a RESULTS=()
  OK=0
  BAD=0
  for dir in "${TARGETS[@]}"; do
    if [ ! -f "$dir/manifest.json" ]; then
      # Allow bare names: "ziy-shell" -> extensions/ziy-shell
      if [ -f "$EXT_ROOT/$dir/manifest.json" ]; then
        dir="$EXT_ROOT/$dir"
      else
        printf '  fail  %s (no manifest.json)\n' "$dir" >&2
        BAD=$((BAD+1)); RESULTS+=("$dir MISSING"); continue
      fi
    fi
    # zpxi pack refuses a filename that is not "<id>.xpi"; read the id first.
    ADDON_ID="$(python3 - "$dir" <<'PY'
import sys, json
m = json.load(open(sys.argv[1] + "/manifest.json"))
g = m.get("browser_specific_settings", {}).get("gecko", {})
print(g.get("id", ""))
PY
)"
    if [ -z "$ADDON_ID" ]; then
      printf '  fail  %s (no browser_specific_settings.gecko.id)\n' "$dir" >&2
      BAD=$((BAD+1)); RESULTS+=("$dir NOID"); continue
    fi
    if line="$(python3 "$PACKER" pack "$dir" "$OUT_DIR/$ADDON_ID.xpi")"; then
      set -- $line
      FILES="$2"; BYTES="$3"
      printf '  ok    %-24s %s files, %s bytes\n' "$ADDON_ID" "$FILES" "$BYTES"
      OK=$((OK+1)); RESULTS+=("$ADDON_ID $FILES $BYTES")
    else
      printf '  fail  %s: %s\n' "$dir" "$line" >&2
      BAD=$((BAD+1)); RESULTS+=("$dir FAILED")
    fi
  done
  note "summary"
  printf '%s\n' "${RESULTS[@]}"
  printf '  %s packed, %s failed\n' "$OK" "$BAD"
  [ "$BAD" -eq 0 ] || exit 1
  printf '\ninstalled into the app dir by tools/build-shell.sh (it copies build/ziy/distribution/extensions/*.xpi\ninto build/ziy/distribution/extensions/ -> <appdir>/distribution/extensions/).\n' >&2
  exit 0
fi

# --- check --------------------------------------------------------------------
if [ "$MODE" = "check" ]; then
  note "checking xpis in $OUT_DIR"
  mkdir -p "$OUT_DIR"
  shopt -s nullglob
  XPIS=("$OUT_DIR"/*.xpi)
  shopt -u nullglob
  if [ ${#XPIS[@]} -eq 0 ]; then
    die "no .xpi files in $OUT_DIR — run tools/build-extension.sh --all first"
  fi

  BAD=0
  declare -a TABLE=()
  for xpi in ${XPIS[@]+"${XPIS[@]}"}; do
    if ! line="$(python3 "$PACKER" check "$xpi")"; then
      printf '%s\n' "$line" >&2
      BAD=$((BAD+1)); continue
    fi
    printf '  %s\n' "$line"
    # The packer prints one tab-separated machine line per xpi: id <tab> files <tab> bytes
    read -r c_id c_files c_bytes <<EOF
$(python3 "$PACKER" summary "$xpi")
EOF
    TABLE+=("$(printf '%-24s %3s files %9s bytes' "$c_id" "$c_files" "$c_bytes")")
  done

  note "summary table (id, files, bytes)"
  printf '%s\n' "${TABLE[@]}"
  printf '  %d xpi(s) checked, %d bad\n' "${#XPIS[@]}" "$BAD"
  [ "$BAD" -eq 0 ] || exit 1
  note "verified"
  printf '  every xpi is named <addon-id>.xpi, carries manifest.json with the same\n'
  printf '  browser_specific_settings.gecko.id, and lists its zip members.\n'
  exit 0
fi

# --- list ---------------------------------------------------------------------
if [ "$MODE" = "list" ]; then
  [ ${#TARGETS[@]} -ge 1 ] || die "--list needs an .xpi path"
  python3 "$PACKER" list "${TARGETS[0]}"
  exit $?
fi

die "unreachable"
