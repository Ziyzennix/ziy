#!/usr/bin/env bash
# tools/build-shell.sh — assemble build/ziy/ from shell/ + a Firefox engine.
#
# Produces the Ziy product directory: a controlled copy of Firefox's install
# tree with our application.ini, defaults, mozilla.cfg, distribution/, patched
# omni.ja, branding and suite .xpi files. The result runs as an independent app
# (replica/architecture.md §2.1, §8).
#
# SELF-CONTAINED BUILD (replica/proofs-self-contained.md): Ziy does NOT depend
# on a Firefox the operator already happens to have installed. With no system
# engine present, this script fetches Mozilla's own PREBUILT binary tarball
# (tools/lib/fetch-engine.sh), verifies its SHA512 against Mozilla's published
# SHA512SUMS, and builds from that. Extracting a prebuilt tarball is an unzip,
# not a Gecko compile — no ./mach, no rustc, no clang.
#
# Usage:
#   ./tools/build-shell.sh [--engine PATH] [--engine-version V]
#                          [--engine-tarball FILE] [--force]
#
#   --engine PATH        Firefox install root (system install, default:
#                        /usr/lib/firefox — the fast local path when present)
#   --engine-version V   fetch Mozilla's prebuilt tarball for version V
#                        (default 156.0.1, the version everything is pinned to)
#   --engine-tarball F   use an already-downloaded tarball FILE instead of
#                        fetching it (its digest is still verified)
#   --force              Rebuild even when build/ziy already exists
#
# Engine resolution order (first hit wins):
#   1. $ZIY_ENGINE / --engine                 an explicit engine path
#   2. $ZIY_ENGINE_TARBALL / --engine-tarball an explicit prebuilt tarball
#   3. an already-extracted tarball engine at build/engine/firefox-<version>/
#   4. a system Firefox install (/usr/lib/firefox, /opt/firefox, …)
#   5. fetch Mozilla's prebuilt tarball for --engine-version
#
# The suite .xpi files may be absent: distribution/extensions/ is wired either
# way and tools/build-extension.sh fills it later. An empty directory is not an
# error — the shell must build and boot before the extensions exist.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
source "$HERE/lib/common.sh"

BUILD_DIR="$ROOT/build"
OUT="$BUILD_DIR/ziy"
ENGINE="${ZIY_ENGINE:-}"
ENGINE_TARBALL="${ZIY_ENGINE_TARBALL:-}"
ENGINE_VERSION="156.0.1"
# The pinned version Ziy's whole app dir, omni.ja patches and policies are
# written against. An engine version that disagrees with this is a loud error,
# not a silent build: the app id, the prefs and both patches are all
# length/string-exact against 156.0.1's own files.
PINNED_ENGINE_VERSION="156.0.1"

# --- argument parsing --------------------------------------------------------
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --engine)
      [ $# -ge 2 ] || die "--engine needs a path"
      ENGINE="$2"; shift 2 ;;
    --engine=*)
      ENGINE="${1#--engine=}"; shift ;;
    --engine-tarball)
      [ $# -ge 2 ] || die "--engine-tarball needs a path"
      ENGINE_TARBALL="$2"; shift 2 ;;
    --engine-tarball=*)
      ENGINE_TARBALL="${1#--engine-tarball=}"; shift ;;
    --engine-version)
      [ $# -ge 2 ] || die "--engine-version needs a value"
      ENGINE_VERSION="$2"; shift 2 ;;
    --engine-version=*)
      ENGINE_VERSION="${1#--engine-version=}"; shift ;;
    --force)
      FORCE=1; shift ;;
    -h|--help)
      sed -n '2,33p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)
      die "unknown argument: $1" ;;
  esac
done

# --- 0. resolve the engine ----------------------------------------------------
# The self-contained path, in the order the header documents. An explicit
# --engine/--engine-tarball always wins; then an already-extracted tarball
# engine (cheap, no network); then the system install (the fast local path,
# unchanged); and only if neither exists do we fetch from Mozilla.
#
# ZIY_NO_FETCH=1 disables the download, so a caller (CI with no network policy,
# an offline rehearsal) can force the build to refuse rather than reach out.
FETCHED=0
if [ -n "$ENGINE" ]; then
  [ -d "$ENGINE" ] || die "engine directory not found: $ENGINE"
  log_step "engine" "explicit: $ENGINE"
elif [ -n "$ENGINE_TARBALL" ]; then
  [ -f "$ENGINE_TARBALL" ] || die "engine tarball not found: $ENGINE_TARBALL"
  log_step "engine" "fetching from local tarball: $ENGINE_TARBALL"
  ENGINE="$("$ROOT/tools/lib/fetch-engine.sh" --tarball "$ENGINE_TARBALL" \
            --version "$ENGINE_VERSION" --dir "$BUILD_DIR/engine")" \
    || die "could not use $ENGINE_TARBALL (see the fetch-engine output above)"
  FETCHED=1
elif [ -x "$BUILD_DIR/engine/firefox-$ENGINE_VERSION/firefox" ] \
     && [ -f "$BUILD_DIR/engine/firefox-$ENGINE_VERSION/omni.ja" ]; then
  ENGINE="$BUILD_DIR/engine/firefox-$ENGINE_VERSION"
  log_step "engine" "extracted tarball engine: $ENGINE"
else
  # A caller can suppress the system search entirely (ZIY_SYSTEM_ENGINE_SEARCH=0
  # — used by the clean-environment rehearsal in proofs-self-contained.md, which
  # must prove the no-Firefox path without deleting /usr/lib/firefox).
  CANDIDATE=""
  if [ "${ZIY_SYSTEM_ENGINE_SEARCH:-1}" != "0" ]; then
    CANDIDATE="$(ziy_find_engine || true)"
  fi
  if [ -n "$CANDIDATE" ]; then
    ENGINE="$CANDIDATE"
    log_step "engine" "system install: $ENGINE"
  elif [ "${ZIY_NO_FETCH:-0}" = "1" ]; then
    die "no engine found (no --engine, no extracted tarball at build/engine/firefox-$ENGINE_VERSION, no system Firefox) and ZIY_NO_FETCH=1 — provide an engine explicitly"
  else
    log_step "engine" "no system Firefox found; fetching Mozilla's prebuilt tarball for $ENGINE_VERSION"
    ENGINE="$("$ROOT/tools/lib/fetch-engine.sh" --version "$ENGINE_VERSION" \
              --dir "$BUILD_DIR/engine")" \
      || die "engine fetch failed (see the fetch-engine output above)"
    FETCHED=1
  fi
fi

# --- 1. discover and validate the engine -------------------------------------
if [ ! -d "$ENGINE" ]; then
  die "engine directory not found: $ENGINE"
fi
if [ ! -x "$ENGINE/firefox" ]; then
  die "$ENGINE has no executable 'firefox' binary"
fi
if [ ! -f "$ENGINE/omni.ja" ]; then
  die "$ENGINE has no omni.ja — not a Firefox install root"
fi
if [ ! -f "$ENGINE/browser/omni.ja" ]; then
  die "$ENGINE/browser/omni.ja missing — not a Firefox install root"
fi
# Version agreement. The build is pinned, and building against an engine that
# disagrees with the pin is exactly the drift update-engine.sh exists to
# prevent: a silent mismatch ships stock Gecko while every doc claims otherwise.
ENGINE_VERSION_REPORTED="$(sed -n 's/^Version=//p' "$ENGINE/application.ini" 2>/dev/null | head -1)"
if [ -n "$ENGINE_VERSION_REPORTED" ] && [ "$ENGINE_VERSION_REPORTED" != "$ENGINE_VERSION" ]; then
  die "engine version mismatch: $ENGINE reports '$ENGINE_VERSION_REPORTED', this build expects '$ENGINE_VERSION' (--engine-version). Move every pin together: tools/build-shell.sh PINNED_ENGINE_VERSION, package.json, shell/browser/application.ini, tools/ziy"
fi
if [ "$ENGINE_VERSION" != "$PINNED_ENGINE_VERSION" ]; then
  die "engine version $ENGINE_VERSION is not the pinned version $PINNED_ENGINE_VERSION. The app id, prefs and both omni.ja patches are derived against the pin; a bump is tools/update-engine.sh's job, not this flag's."
fi

log_step "engine" "$ENGINE ($("$ENGINE/firefox" --version 2>/dev/null || echo 'version unknown'))"
[ "$FETCHED" = "0" ] || log_step "engine" "built from Mozilla's prebuilt tarball, sha512-verified (see build/engine/)"

# --- 2. prepare the output tree ----------------------------------------------
if [ -e "$OUT" ] && [ "$FORCE" = "0" ]; then
  log_step "build" "build/ziy exists (--force to rebuild)"
  log_ok "already built: $OUT"
  exit 0
fi
rm -rf "$OUT"
mkdir -p "$OUT"

# --- 3. copy the engine install tree -----------------------------------------
# A copy, not a symlink, because we are going to modify files inside it
# (omni.ja) and we never touch the operator's or distro's Firefox.
log_step "copy" "$ENGINE -> $OUT"
cp -a "$ENGINE/." "$OUT/"
# Our copy must be writable even though the source is root-owned read-only.
chmod -R u+w "$OUT" 2>/dev/null || true

# --- 4. our own app identity -------------------------------------------------
log_step "install" "browser/application.ini (Ziy app id)"
install -Dm 0644 "$ROOT/shell/browser/application.ini" \
                 "$OUT/browser/application.ini"

log_step "install" "browser/defaults/preferences/{ziy.js,ziy-hardening.js}"
install -Dm 0644 "$ROOT/shell/browser/defaults/preferences/ziy.js" \
                 "$OUT/browser/defaults/preferences/ziy.js"
install -Dm 0644 "$ROOT/shell/browser/defaults/preferences/ziy-hardening.js" \
                 "$OUT/browser/defaults/preferences/ziy-hardening.js"

log_step "install" "mozilla.cfg (autoconfig, world-readable)"
install -Dm 0644 "$ROOT/shell/mozilla.cfg" "$OUT/mozilla.cfg"
chmod 0644 "$OUT/mozilla.cfg"     # autoconfig requires the file be readable

# Preflight the whole pref layer BEFORE anything boots. This gate exists because
# a pref whose value the engine's own consumer rejects (the concrete case:
# privacy.fingerprintingProtection.granularOverrides must be a JSON array, not a
# string) makes the prefs service refuse the write, and a refused write inside
# autoconfig aborts the rest of mozilla.cfg — leaving the engine half-configured
# and crashing on the graphics compositor. It catches that here, at build time,
# instead of at launch.
log_step "preflight" "pref layer consistency + known value shapes"
python3 "$ROOT/shell/preflight-prefs.py"

# --- 5. branding -------------------------------------------------------------
log_step "install" "branding (brand/ preferred, shell/brand-fallback/ fallback)"
BRAND_SRC="$ROOT/brand"
if [ -f "$BRAND_SRC/logo.svg" ]; then
  ICON_SOURCE="$BRAND_SRC/logo.svg"
else
  ICON_SOURCE="$ROOT/shell/brand-fallback/logo.svg"
fi
mkdir -p "$OUT/chrome/icons/default"
"$ROOT/shell/brand-fallback/render-icons.py" "$OUT/chrome/icons/default" >/dev/null
install -Dm 0644 "$ICON_SOURCE" "$OUT/chrome/icons/default/ziy.svg"
install -Dm 0644 "$OUT/chrome/icons/default/ziy.png" "$OUT/ziy.png"

# --- 6. window chrome --------------------------------------------------------
log_step "install" "browser/chrome/userChrome.css + userContent.css + ziy-menu.svg"
install -Dm 0644 "$ROOT/shell/chrome/userChrome.css" \
                 "$OUT/browser/chrome/userChrome.css"
install -Dm 0644 "$ROOT/shell/chrome/userContent.css" \
                 "$OUT/browser/chrome/userContent.css"
# The app-menu glyph. userChrome.css pins #PanelUI-menu-button's list-style-image
# to the RELATIVE path "ziy-menu.svg", which resolves against the stylesheet's
# own directory — so the app-dir copy needs the asset beside it too, not just
# in the profile. Without this line the app-dir copy of the stylesheet would
# pin the menu button at a file that is not there, and the engine would fall
# back to its own icon.
install -Dm 0644 "$ROOT/shell/chrome/ziy-menu.svg" \
                 "$OUT/browser/chrome/ziy-menu.svg"

# --- 7. the omni.ja patch ----------------------------------------------------
log_step "patch" "omni.ja: MOZ_REQUIRE_SIGNING true->false, MOZ_ALLOW_ADDON_SIDELOAD false->true"
python3 "$ROOT/shell/omni.ja.patch/patch-omni.py" "$ENGINE/omni.ja" "$OUT/omni.ja" \
  > "$BUILD_DIR/omni.ja.patch.log"
sed 's/^/        /' "$BUILD_DIR/omni.ja.patch.log"

# Independent re-verification, so the build cannot report success on a patch the
# build itself did not re-read.
CERT="$(python3 - "$OUT/omni.ja" <<'PY'
import sys
sys.path.insert(0, "shell/omni.ja.patch")
import importlib.util
spec = importlib.util.spec_from_file_location("patch_omni", "shell/omni.ja.patch/patch-omni.py")
po = importlib.util.module_from_spec(spec)
spec.loader.exec_module(po)
data = open(sys.argv[1], "rb").read()
cd_start, cd_size, eocd = po.locate_central_directory(data)
entries = po.parse_central_directory(data, cd_start, eocd)
e = entries[po.MEMBER]
body = po.member_body_offset(data, e["lho"], e["nlen"], e["elen"], po.MEMBER)
raw = data[body : body + e["csize"]].decode("utf-8", "replace")
assert po.NEW_SIGNING.decode() in raw, "MOZ_REQUIRE_SIGNING is not false in the built omni.ja"
assert po.NEW_SIDELOAD.decode() in raw, "MOZ_ALLOW_ADDON_SIDELOAD is not true in the built omni.ja"
assert po.OLD_SIGNING.decode() not in raw, "unpatched signing string still present"
assert po.OLD_SIDELOAD.decode() not in raw, "unpatched sideload string still present"
print()
print("re-verified from build/ziy/omni.ja on disk:")
print("  MOZ_REQUIRE_SIGNING: false      in " + po.MEMBER)
print("  MOZ_ALLOW_ADDON_SIDELOAD: true  in " + po.MEMBER)
PY
)"
printf '%s\n' "$CERT" | sed 's/^/        /'

# --- 7b. the browser/omni.ja patch: Firefox's own new tab is stripped --------
# The engine's new tab page is a built-in add-on inside browser/omni.ja, and
# ziy-ntp already claims chrome_url_overrides.newtab. Both being registered is
# a race we do not want to run: the built-in is hidden, and the resolution
# between an extension override and a built-in override is not documented
# behaviour we should depend on. So the built-in is made uninstallable-in-place
# by the shared patcher (tools/lib/omni-ja.py): a byte-length-preserving
# manifest_version bump makes the add-on installer reject the built-in while
# every byte of it still ships.
#
# The patch is idempotent-safe in the loud direction: if the source string is
# absent (engine bump, or an already-patched source) the build FAILS here
# instead of shipping an engine with two newtab pages.
log_step "patch" "browser/omni.ja: strip Firefox's built-in New Tab add-on (newtab@mozilla.org)"
python3 "$ROOT/tools/lib/omni-ja.py" "$ENGINE/browser/omni.ja" "$OUT/browser/omni.ja" \
  --patch ziy-browser > "$BUILD_DIR/browser-omni.ja.patch.log" 2>&1 || {
    sed 's/^/        /' "$BUILD_DIR/browser-omni.ja.patch.log"
    die "browser/omni.ja newtab strip failed — see $BUILD_DIR/browser-omni.ja.patch.log"
  }
sed 's/^/        /' "$BUILD_DIR/browser-omni.ja.patch.log"

# Independent re-read of the written file, the same contract as the omni.ja one.
BROWSER_CERT="$(python3 - "$OUT/browser/omni.ja" "$ROOT" <<'PY'
import importlib.util
import sys

app_archive, repo_root = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location(
    "omni_ja", repo_root + "/tools/lib/omni-ja.py")
oj = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oj)
found = oj.verify_archive(__import__("pathlib").Path(app_archive),
                          oj.load_patch_file(__import__("pathlib").Path(
                              repo_root + "/tools/patches/newtab-strip.toml")))
assert len(found) == 1, "the newtab-strip patch is not present in browser/omni.ja"
info = found[0]
print()
print("re-verified from build/ziy/browser/omni.ja on disk:")
print(f"  {info['member']}")
for line in info["substitutions"]:
    print(f"    {line}")
PY
)" || die "browser/omni.ja does not carry the newtab-strip patch"
printf '%s\n' "$BROWSER_CERT" | sed 's/^/        /'

# --- 8. distribution: policies, partner ini, extension suite -----------------
log_step "install" "distribution/policies.json (validated against the engine schema)"
python3 "$ROOT/shell/policies-gen.py"

log_step "install" "distribution/distribution.ini"
install -Dm 0644 "$ROOT/shell/distribution/distribution.ini" \
                 "$OUT/distribution/distribution.ini"
install -Dm 0644 "$ROOT/shell/distribution/policies.json" \
                 "$OUT/distribution/policies.json"

log_step "install" "distribution/extensions/ (the suite; may be empty for now)"
mkdir -p "$OUT/distribution/extensions"
# Firefox ships its own langpacks in this directory. They are not ours, they are
# signed, and they only add a second locale's chrome. Drop them so the
# distribution directory contains exactly the Ziy suite (plus the self-test xpi
# verify.sh adds).
rm -f "$OUT"/distribution/extensions/langpack-*@*.xpi
COPIED=0
for suite_root in "$ROOT/shell/distribution/extensions" "$ROOT/build/ziy/distribution/extensions"; do
  [ -d "$suite_root" ] || continue
  for xpi in "$suite_root"/*.xpi; do
    [ -e "$xpi" ] || continue
    SRC="$xpi"
    DST="$OUT/distribution/extensions/$(basename "$xpi")"
    # install -D refuses when src and dst resolve to the same file (which is the
    # case for anything already sitting in build/ziy); resolve first.
    if [ "$(readlink -f "$SRC" 2>/dev/null)" != "$(readlink -f "$DST" 2>/dev/null)" ]; then
      install -m 0644 "$SRC" "$DST"
    fi
    COPIED=$((COPIED + 1))
  done
done
if [ "$COPIED" -eq 0 ]; then
  log_warn "no suite xpis found — the shell still boots; tools/build-extension.sh fills this later"
else
  log_ok "installed $COPIED suite xpis"
fi

# --- 8b. the MPL notice and the C++ patch set --------------------------------
# MPL-2.0 §3.2(a): shipping a modified engine in executable form obliges us to
# tell recipients where the source is. The notice (shell/LICENSES.txt) carries
# that pointer, the not-affiliated statement and the residual-version-string
# disclosure (replica/research-legal.md §2.3-§2.4, §1.1 Rule 4; replica/deploy.md
# §5 rows 4-7), and the patch set ships verbatim beside it so the "how to
# obtain" is material in the product and not only a URL (research-legal.md
# §1.2, §4.4; patches/README.md).
log_step "install" "LICENSES.txt (MPL §3.2(a) notice) + patches/ (engine source diffs)"
install -Dm 0644 "$ROOT/shell/LICENSES.txt" "$OUT/LICENSES.txt"
mkdir -p "$OUT/patches"
PATCH_SHIPPED=0
for p in "$ROOT"/patches/*.patch "$ROOT"/patches/README.md; do
  [ -e "$p" ] || continue
  install -m 0644 "$p" "$OUT/patches/"
  PATCH_SHIPPED=$((PATCH_SHIPPED + 1))
done
log_ok "shipped the notice + $PATCH_SHIPPED engine source file(s) in $OUT/patches/"

# --- 9. the launcher ---------------------------------------------------------
log_step "install" "build/ziy/ziy launcher stub"
install -Dm 0755 "$ROOT/shell/launcher.sh" "$OUT/ziy"

# --- 10. desktop entry and icon ----------------------------------------------
log_step "install" "ziy.desktop"
install -Dm 0644 "$ROOT/shell/ziy.desktop" "$OUT/ziy.desktop"

log_step "install" "brand icons into the XDG icon tree under build/"
for size in 16 22 24 32 48 64 96 128 256; do
  if [ -f "$OUT/chrome/icons/default/logo-$size.png" ]; then
    mkdir -p "$BUILD_DIR/share/icons/hicolor/${size}x${size}/apps"
    install -m 0644 "$OUT/chrome/icons/default/logo-$size.png" \
      "$BUILD_DIR/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  fi
done
# Fall back to the largest rendered mark for any size we did not produce.
for size in 16 22 24 32 48 64 96 128 256; do
  if [ ! -f "$BUILD_DIR/share/icons/hicolor/${size}x${size}/apps/ziy.png" ]; then
    mkdir -p "$BUILD_DIR/share/icons/hicolor/${size}x${size}/apps"
    install -m 0644 "$OUT/ziy.png" \
      "$BUILD_DIR/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  fi
done

# --- 11. record the engine provenance -----------------------------------------
# The engine is a build input, so WHERE it came from is a fact the next worker
# (and tools/verify.sh --self-contained) needs to know: a Ziy built from
# Mozilla's own checksum-verified tarball depends on nothing but a network
# connection; a Ziy built from a system Firefox depends on that Firefox. Both
# are supported; the record makes which one happened unambiguous.
ENGINE_SOURCE="system"
ENGINE_SHA512=""
TARBALL_PATH=""
# An engine resolved under build/engine/ is, by construction, the extracted
# tarball engine fetch-engine.sh produced; anything else came from the host.
# Compare against a canonical absolute path on BOTH sides: the engine may have
# been given as a relative --engine argument, and a relative path would not
# match this glob and would be recorded as a system build.
ENGINE_DIR_CANON="$(cd -- "$ENGINE" 2>/dev/null && pwd -P || printf '%s' "$ENGINE")"
case "$ENGINE_DIR_CANON" in
  "$(cd -- "$BUILD_DIR/engine" 2>/dev/null && pwd -P || printf '%s' "$BUILD_DIR/engine")"/*)
    ENGINE_SOURCE="tarball"
    TARBALL_PATH="$BUILD_DIR/engine/firefox-$ENGINE_VERSION.tar.xz"
    [ -f "$TARBALL_PATH" ] && ENGINE_SHA512="$(sha512sum "$TARBALL_PATH" | awk '{print $1}')"
    ;;
esac
cat > "$BUILD_DIR/engine-provenance.txt" <<EOF
# Written by tools/build-shell.sh; read by tools/verify.sh --self-contained.
# source=tarball means this Ziy was built from Mozilla's prebuilt engine
# tarball (fetch-engine.sh, sha512 verified against Mozilla's SHA512SUMS) and
# needs no Firefox install on the machine. source=system means it was built
# from a Firefox discovered at the path below.
source=$ENGINE_SOURCE
engine=$ENGINE
engine_version=$ENGINE_VERSION_REPORTED
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tarball=$TARBALL_PATH
sha512=$ENGINE_SHA512
EOF
log_step "provenance" "engine source: $ENGINE_SOURCE -> build/engine-provenance.txt"

# --- 12. report ---------------------------------------------------------------
cat <<EOF

$(tput bold 2>/dev/null || echo "")build/ziy ready$(tput sgr0 2>/dev/null || echo "")
  app dir        $OUT
  launch         $OUT/ziy
  launcher (dev) ./tools/ziy --profile ...
  suite xpis     $COPIED
  engine         $ENGINE (source: $ENGINE_SOURCE)
  omni.ja        patched (log: build/omni.ja.patch.log)
  notices        LICENSES.txt + patches/ ($PATCH_SHIPPED files, MPL §3.2(a))

Next:
  ./tools/bootstrap-profile.py            -> ~/.ziy/profiles/default/
  ./tools/ziy                             -> launch Ziy
EOF
log_ok "build complete"
