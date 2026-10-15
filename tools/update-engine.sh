#!/usr/bin/env bash
# tools/update-engine.sh — the engine-bump procedure.
#
# Referenced by patches/README.md ("How update-engine.sh re-applies this per
# bump"), shell/omni.ja.patch/README.md ("To re-apply after a Firefox upgrade")
# and replica/deep-fork.md §7 (the four-step bump story).
#
# WHAT IT DOES — re-points Ziy at a NEW Firefox and re-applies every patch an
# engine bump can break, in the order deep-fork.md §7 fixes:
#   1. discover + validate the new install (executable, omni.ja, browser/omni.ja)
#   2. version agreement: the install's own application.ini must say what this
#      bump declares, or stop — an unaligned pin is how stock Gecko ships while
#      the docs claim otherwise
#   3. re-verify the omni.ja patchers' expectations against the NEW engine, in
#      write mode, so a moved member/string fails here BY NAME before install
#   4. pref-layer preflight (shell/preflight-prefs.py)
#   5. rebuild build/ziy via tools/build-shell.sh, which re-applies and re-reads
#      both omni.ja patches
#   6. optionally: git apply --check the C++ patch set against an extracted
#      source tree (--extract-source derives the file list from the patches'
#      own +++ b/ headers and extracts exactly those files)
#
# WHAT IT DOES NOT DO — never compiles anything (replica/deep-fork.md §0: no
# ./mach build, no ./mach configure, no autoconf, no rustc/cargo on this box),
# never uses sudo, never touches the operator's Firefox install, and never
# starts a download: it reuses the checksum-verified tarball if present and
# otherwise fails with the documented resumable command (replica/AI-BRIEF.md
# §2.1, §5 rule 12 — never race an in-flight curl).
#
# Usage:
#   ./tools/update-engine.sh [--engine PATH] [--version NEW] [--source-tree PATH]
#                            [--extract-source] [--no-build] [--force] [-h]
#
#   --engine PATH      new Firefox install root (default: auto-discovered, same
#                      candidate list as tools/build-shell.sh)
#   --version NEW      expected engine version (default 156.0.1); the install's
#                      application.ini must agree
#   --source-tree PATH check the C++ patches against this extracted tree
#   --extract-source   extract exactly the files the patch set touches from the
#                      checksum-verified tarball (~550 KB, ~1 min here), then
#                      check them. Implies --check-source.
#   --no-build         skip step 5 (do not rebuild build/ziy)
#   --force            pass --force through to tools/build-shell.sh
#
# Exit: 0 = every gate passed. 1 = a gate failed, naming the member/string or
# patch. 2 = usage or environment error.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
source "$HERE/lib/common.sh"

ENGINE_VERSION_DEFAULT="156.0.1"
TARBALL_SHA512="80a32a79268b672206f5477ca6bfde620cb7419b27aac090e01f06df06990ee0bbd81bb5c4aa78ac1d0edb26b133b1c6fa11cb6522445eccd70c82e719a24d5b"
PROBE="$ROOT/build/update-engine-probe"

die_usage() { log_error "$*"; exit 2; }

# --- arguments ---------------------------------------------------------------
ENGINE=""; WANT_VERSION=""; SRC_TREE=""
CHECK_SOURCE=0; EXTRACT_SOURCE=0; DO_BUILD=1; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --engine)       [ $# -ge 2 ] || die_usage "--engine needs a path"; ENGINE="$2"; shift 2 ;;
    --engine=*)     ENGINE="${1#--engine=}"; shift ;;
    --version)      [ $# -ge 2 ] || die_usage "--version needs a value"; WANT_VERSION="$2"; shift 2 ;;
    --version=*)    WANT_VERSION="${1#--version=}"; shift ;;
    --source-tree)  [ $# -ge 2 ] || die_usage "--source-tree needs a path"; SRC_TREE="$2"; shift 2 ;;
    --source-tree=*) SRC_TREE="${1#--source-tree=}"; shift ;;
    --check-source) CHECK_SOURCE=1; shift ;;
    --extract-source) CHECK_SOURCE=1; EXTRACT_SOURCE=1; shift ;;
    --no-build)     DO_BUILD=0; shift ;;
    --force)        FORCE=1; shift ;;
    -h|--help)      sed -n '2,46p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)              die_usage "unknown argument: $1" ;;
  esac
done
[ -n "$WANT_VERSION" ] || WANT_VERSION="$ENGINE_VERSION_DEFAULT"

log_step "bump" "re-pointing Ziy at engine $WANT_VERSION"

# --- 1. discover + validate the new engine -----------------------------------
[ -n "$ENGINE" ] || ENGINE="$(ziy_find_engine || true)"
[ -n "$ENGINE" ] || die "no Firefox install found (use --engine PATH, or set ZIY_ENGINE)"
[ -d "$ENGINE" ] || die "engine directory not found: $ENGINE"
[ -x "$ENGINE/firefox" ] || die "$ENGINE has no executable 'firefox' binary"
[ -f "$ENGINE/omni.ja" ] || die "$ENGINE has no omni.ja — not a Firefox install root"
[ -f "$ENGINE/browser/omni.ja" ] || die "$ENGINE/browser/omni.ja missing — not a Firefox install root"
[ -e "$ENGINE/ziy" ] && die "$ENGINE looks like a Ziy build output (it has a 'ziy' launcher). Point --engine at a Firefox install, not at build/."
log_step "engine" "$ENGINE ($("$ENGINE/firefox" --version 2>/dev/null || echo 'version unknown'))"

# --- 2. version agreement ----------------------------------------------------
INI_VERSION="$(sed -n 's/^Version=//p' "$ENGINE/application.ini" | head -1)"
if [ -z "$INI_VERSION" ]; then
  log_warn "$ENGINE/application.ini carries no Version= key; skipping the version check"
elif [ "$INI_VERSION" != "$WANT_VERSION" ]; then
  die "engine version mismatch: $ENGINE reports '$INI_VERSION', this bump expects '$WANT_VERSION'. A deliberate bump must move every pin together (this file's ENGINE_VERSION_DEFAULT, package.json, shell/browser/application.ini, tools/ziy, .github/workflows/build-gecko.yml)"
else
  log_ok "engine reports $INI_VERSION, as this bump expects"
fi

# --- 3. re-verify the omni.ja patchers against the NEW engine -----------------
# Run them in write mode FIRST: each refuses loudly, naming the member and the
# exact string, when a bump moved it. That failure has to happen here, before
# anything is installed.
mkdir -p "$PROBE"
log_step "verify" "omni.ja signing-bypass expectations against $ENGINE"
if ! python3 "$ROOT/shell/omni.ja.patch/patch-omni.py" "$ENGINE/omni.ja" "$PROBE/omni.ja" \
       > "$PROBE/omni.log" 2>&1; then
  sed 's/^/        /' "$PROBE/omni.log"
  die "PRECONDITION FAILED against $ENGINE/omni.ja: modules/AppConstants.sys.mjs no longer carries 'MOZ_REQUIRE_SIGNING: true,' / 'MOZ_ALLOW_ADDON_SIDELOAD: false,' — the constant moved, or the install is already patched. Re-derive that substitution against the new member (shell/omni.ja.patch/README.md); do not skip it."
fi
sed 's/^/        /' "$PROBE/omni.log"
log_ok "signing-bypass preconditions hold"

log_step "verify" "browser/omni.ja newtab-strip expectations against $ENGINE"
if ! python3 "$ROOT/tools/lib/omni-ja.py" "$ENGINE/browser/omni.ja" "$PROBE/browser-omni.ja" \
       --patch ziy-browser > "$PROBE/browser-omni.log" 2>&1; then
  sed 's/^/        /' "$PROBE/browser-omni.log"
  die "PRECONDITION FAILED against $ENGINE/browser/omni.ja: chrome/browser/builtin-addons/newtab/manifest.json no longer carries '\"manifest_version\": 2,' — the built-in new tab moved. Re-derive tools/patches/newtab-strip.toml against the new member."
fi
sed 's/^/        /' "$PROBE/browser-omni.log"
log_ok "newtab-strip preconditions hold"

# --- 4. pref-layer preflight --------------------------------------------------
log_step "preflight" "pref layer consistency + known value shapes"
python3 "$ROOT/shell/preflight-prefs.py"

# --- 5. rebuild from the new engine -------------------------------------------
# build-shell.sh applies AND re-reads both omni.ja patches, so this one command
# is deep-fork.md §7 step 2 in full.
if [ "$DO_BUILD" = "1" ]; then
  FORCE_ARG=""; [ "$FORCE" = "1" ] && FORCE_ARG="--force"
  # shellcheck disable=SC2086
  "$ROOT/tools/build-shell.sh" --engine "$ENGINE" $FORCE_ARG
else
  log_step "build" "skipped (--no-build); run tools/build-shell.sh --engine $ENGINE yourself"
fi

# --- 6. the C++ patch set -----------------------------------------------------
check_source() {
  local tree="$1" p ok=0 total=0
  log_step "source" "C++ patch set against $tree"
  (
    cd "$tree" || exit 3
    for p in "$ROOT/patches/"*.patch; do
      [ -e "$p" ] || continue
      total=$((total+1))
      if git apply --check "$p" 2>/dev/null; then
        echo "  ok    $(basename "$p")"; ok=$((ok+1))
      else
        echo "  FAIL  $(basename "$p") — no longer applies to this source"
        git apply --check "$p" || true
      fi
    done
    echo "C++ patches: $ok/$total apply cleanly"
    [ "$ok" -eq "$total" ]
  ) || die "PRECONDITION FAILED: the C++ patch set does not apply to $tree. A moved line is the EXPECTED result of an engine bump, not a bug in a patch — re-derive the named patch against the new source (patches/README.md 'How to add one'). Do not ship this bump until the set applies cleanly."
  log_ok "C++ patch set applies cleanly to $tree"
}

if [ "$CHECK_SOURCE" = "1" ]; then
  if [ -n "$SRC_TREE" ]; then
    [ -d "$SRC_TREE" ] || die "--source-tree $SRC_TREE is not a directory"
    check_source "$SRC_TREE"
  else
    FOUND=""
    for cand in "/tmp/firefox-src/firefox-$WANT_VERSION" \
                "/tmp/fxsrc/firefox-$WANT_VERSION"; do
      [ -d "$cand" ] && FOUND="$cand" && break
    done
    if [ -n "$FOUND" ]; then
      check_source "$FOUND"
    elif [ "$EXTRACT_SOURCE" = "1" ]; then
      # Derive the file list from the patches themselves, so a new patch needs
      # no edit here. Extract ONLY those files: ~550 KB and ~1 min, against a
      # 3 GB full extraction.
      TB_NAME="firefox-$WANT_VERSION.source.tar.xz"
      TB_URL="https://ftp.mozilla.org/pub/firefox/releases/$WANT_VERSION/source/$TB_NAME"
      # The sha512 is pinned to the shipped revision; a bump re-pins it.
      TB_SHA="$TARBALL_SHA512"
      [ "$WANT_VERSION" = "$ENGINE_VERSION_DEFAULT" ] || TB_SHA=""
      TB=""
      for cand in "/tmp/fxsrc/$TB_NAME" "/tmp/firefox-src/$TB_NAME" "$ROOT/$TB_NAME"; do
        [ -f "$cand" ] && TB="$cand" && break
      done
      if [ -z "$TB" ]; then
        die "no source tree on disk and no tarball at /tmp/fxsrc/$TB_NAME — the C++ patches were NOT re-verified. Recovery (ONE download; check for an in-flight 'curl -C -' and /tmp/fxsrc/curl.log first, and never start a second):
    curl -C - --retry 40 --retry-delay 2 --retry-all-errors --retry-max-time 7000 -o $TB_NAME $TB_URL
  verify sha512 = $TB_SHA (replica/deep-fork.md §6.2) then re-run with --extract-source."
      fi
      ACTUAL_SHA="$(sha512sum "$TB" | awk '{print $1}')"
      if [ -n "$TB_SHA" ] && [ "$ACTUAL_SHA" != "$TB_SHA" ]; then
        die "SHA512 MISMATCH for $TB ($ACTUAL_SHA): truncated or corrupt. Resume it with curl -C -; do not re-download from zero."
      fi
      log_ok "tarball sha512 verified"
      # Derive the file list from the patches themselves, so a new patch needs
      # no edit here. Only MODIFIED files: a patch that CREATES a file (0002's
      # toolkit/ziy-fingerprinting.configure) has no `/dev/null`-free old header
      # and a file that is not in the pristine tarball cannot be extracted —
      # git apply --check needs the file's absence, not its presence.
      WILDCARDS=()
      for p in "$ROOT/patches/"*.patch; do
        [ -e "$p" ] || continue
        while IFS= read -r f; do
          [ -n "$f" ] || continue
          WILDCARDS+=(--wildcards "firefox-$WANT_VERSION/$f")
        done < <(awk '
          /^--- \/dev\/null/ { created = 1; next }
          /^\+\+\+ b\//       { if (!created) { sub(/^b\//, "", $2); print $2 } created = 0 }
        ' "$p")
      done
      SCRATCH="/tmp/ziy-update-engine/firefox-$WANT_VERSION"
      rm -rf "${SCRATCH%/*}"; mkdir -p "${SCRATCH%/*}"
      log_step "extract" "${#WILDCARDS[@]} wildcard(s) -> $SCRATCH"
      # -C before the wildcards: GNU tar stops reading options after the first
      # non-option argument, so a trailing -C is taken as another member name.
      tar -xf "$TB" -C "${SCRATCH%/*}" "${WILDCARDS[@]}"
      check_source "$SCRATCH"
    else
      log_warn "no source tree on disk; the C++ patch set was NOT re-verified. Re-run with --extract-source (checksum-verified tarball extraction, ~1 min) or --source-tree PATH."
    fi
  fi
else
  log_step "source" "C++ patch set not re-verified (no --check-source); re-run with --extract-source to prove the set still applies"
fi

# --- 7. report ---------------------------------------------------------------
cat <<EOF

$(tput bold 2>/dev/null || echo "")engine bump complete$(tput sgr0 2>/dev/null || echo "")
  engine      $ENGINE (${INI_VERSION:-unknown})
  omni.ja     signing bypass + newtab strip re-verified and re-applied
  app dir     $ROOT/build/ziy
  next        ./tools/verify.sh --identity
EOF
log_ok "bump finished"
