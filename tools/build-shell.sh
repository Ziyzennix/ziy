#!/usr/bin/env bash
# tools/build-shell.sh — assemble build/ziy/ from shell/ + a Firefox install.
#
# Produces the Ziy product directory: a controlled copy of Firefox's install
# tree with our application.ini, defaults, mozilla.cfg, distribution/, patched
# omni.ja, branding and suite .xpi files. The result runs as an independent app
# (replica/architecture.md §2.1, §8).
#
# Usage:
#   ./tools/build-shell.sh [--engine PATH] [--force]
#
#   --engine PATH   Firefox install root (default: /usr/lib/firefox, discovered
#                   via any of the candidates below)
#   --force         Rebuild even when build/ziy already exists
#
# Engine discovery order:
#   $ZIY_ENGINE, --engine, /usr/lib/firefox, /opt/firefox, /usr/local/firefox,
#   the first dir named 'firefox' under /usr/lib, /usr/local/lib and /opt
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

# --- argument parsing --------------------------------------------------------
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --engine)
      [ $# -ge 2 ] || die "--engine needs a path"
      ENGINE="$2"; shift 2 ;;
    --engine=*)
      ENGINE="${1#--engine=}"; shift ;;
    --force)
      FORCE=1; shift ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)
      die "unknown argument: $1" ;;
  esac
done

[ -n "$ENGINE" ] || ENGINE="$(ziy_find_engine || true)"
[ -n "$ENGINE" ] || die "no Firefox install found (use --engine PATH, or set ZIY_ENGINE)"

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

log_step "engine" "$ENGINE ($("$ENGINE/firefox" --version 2>/dev/null || echo 'version unknown'))"

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
log_step "install" "browser/chrome/userChrome.css"
install -Dm 0644 "$ROOT/shell/chrome/userChrome.css" \
                 "$OUT/browser/chrome/userChrome.css"

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

# --- 11. report ---------------------------------------------------------------
cat <<EOF

$(tput bold 2>/dev/null || echo "")build/ziy ready$(tput sgr0 2>/dev/null || echo "")
  app dir        $OUT
  launch         $OUT/ziy
  launcher (dev) ./tools/ziy --profile ...
  suite xpis     $COPIED
  omni.ja        patched (log: build/omni.ja.patch.log)

Next:
  ./tools/bootstrap-profile.py            -> ~/.ziy/profiles/default/
  ./tools/ziy                             -> launch Ziy
EOF
log_ok "build complete"
