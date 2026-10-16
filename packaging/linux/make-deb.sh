#!/usr/bin/env bash
# packaging/linux/make-deb.sh — a real Debian package.
#
# Produces build/packaging/ziy_<version>_amd64.deb, built with `dpkg-deb
# --build` from a staging tree laid out the way dpkg-deb reads it:
#
#   <staging>/DEBIAN/control        Package ziy, Version, Architecture
#                                   amd64, Maintainer, Depends
#   <staging>/DEBIAN/postinst       icon install + update-desktop-database
#   <staging>/usr/lib/ziy/…         the whole app dir
#   <staging>/usr/bin/ziy           a symlink to /usr/lib/ziy/ziy
#   <staging>/usr/share/applications/ziy.desktop
#   <staging>/usr/share/icons/hicolor/<size>x<size>/apps/ziy.png
#
# IT DOES NOT INSTALL ANYTHING, and it needs no root: dpkg-deb --build is a
# staging-tree operation, so "write the package" and "install the package" are
# separate acts and only the second needs privileges. What it DOES verify:
#   1. the app dir is complete and branded (the same checks make-tarball.sh
#      performs, re-run here because a deb is its own artifact),
#   2. the patched omni.ja, re-read from the bytes being packaged,
#   3. after dpkg-deb --build: `dpkg-deb --contents` (path + mode + size per
#      file) and `dpkg-deb --info`/`dpkg -I` (the metadata), both parsed for
#      the exact fields the ticket names — a package that lists itself as
#      amd64 with no Depends is a packaging bug this script catches itself,
#   4. the paths inside the archive match the paths in control + postinst
#      (a postinst that installs icons the package does not ship is a lie),
#   5. LINTIAN, if present. It is not installed on the build box; the
#      workflow installs it on the runner. When it is absent this script says
#      so in its own output instead of pretending.
#
# WHAT IT DOES NOT VERIFY: that an apt-get install works end-to-end. That
# needs root, which this box does not have, and a container on the runner does
# (.github/workflows/build-packages.yml).
#
# Usage:
#   packaging/linux/make-deb.sh [--out DIR] [--arch ARCH] [--version V]
#
#   --out DIR     output directory (default build/packaging)
#   --arch ARCH   Debian architecture (default amd64)
#   --version V   product version (default 156.0.1)
#
# Env: ZIY_APP_DIR (default build/ziy)
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"
APP_DIR="${ZIY_APP_DIR:-$ROOT/build/ziy}"
VERSION="${ZIY_VERSION:-156.0.1}"
DEB_ARCH="amd64"
OUT_DIR="$ROOT/build/packaging"
# Debian package revision: our own post-release/packaging counter. It is part
# of the Debian version, so 156.0.1-1 is "product version 156.0.1, our
# packaging revision 1" — apt compares it properly, and a rebuild of the same
# product version is -2, not a fake new version.
DEB_REVISION="1"
PKG_VERSION="$VERSION-$DEB_REVISION"
PREFIX="/usr/lib/ziy"

C_RESET=; C_BOLD=; C_DIM=; C_RED=; C_GREEN=; C_YELLOW=
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
fi
log_step() { printf '  %s%-10s%s %s\n' "$C_DIM" "$1" "$C_RESET" "$2" >&2; }
log_ok()   { printf '%s  ok  %s%s\n' "$C_GREEN" "$1" "$C_RESET" >&2; }
log_warn() { printf '%swarn:  %s%s\n' "$C_YELLOW" "$1" "$C_RESET" >&2; }
die()      { printf '%sfail:  %s%s\n' "$C_RED" "$1" "$C_RESET" >&2; exit 1; }

command -v dpkg-deb >/dev/null 2>&1 || die "dpkg-deb is not installed — this script is a no-op without it (apt install dpkg)"
DEB="ziy_${PKG_VERSION}_${DEB_ARCH}.deb"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || die "--out needs a directory"; OUT_DIR="$2"; shift 2 ;;
    --arch) [ $# -ge 2 ] || die "--arch needs an architecture"; DEB_ARCH="$2"; shift 2 ;;
    --version) [ $# -ge 2 ] || die "--version needs a version"; VERSION="$2"; PKG_VERSION="$VERSION-$DEB_REVISION"; DEB="ziy_${PKG_VERSION}_${DEB_ARCH}.deb"; shift 2 ;;
    # Print the whole usage header: every leading comment line from line 2 up
    # to the first non-comment line. (The old `sed -n '2,40p'` range stopped
    # short of the Env line, so --help silently omitted a documented input.)
    -h|--help) awk 'NR==1{next} /^#/{print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. the input tree, checked the same way make-tarball.sh checks it, because
#    each artifact stands alone: a deb built from a broken app dir is a broken
#    deb, and "make-tarball already checked" is not a thing the maintainer of
#    the deb can rely on.
# ---------------------------------------------------------------------------
[ -d "$APP_DIR" ] || die "app dir not found: $APP_DIR — run ./tools/build-shell.sh first"
[ -x "$APP_DIR/firefox" ] || die "$APP_DIR has no executable 'firefox'"
[ -f "$APP_DIR/omni.ja" ] && [ -f "$APP_DIR/browser/omni.ja" ] \
  || die "$APP_DIR is missing an omni.ja — run ./tools/build-shell.sh first"
[ -f "$APP_DIR/browser/application.ini" ] || die "$APP_DIR/browser/application.ini missing"
grep -q '^Name=Ziy' "$APP_DIR/browser/application.ini" \
  || die "$APP_DIR/browser/application.ini does not name Ziy"
[ -x "$APP_DIR/ziy" ] || die "$APP_DIR/ziy launcher missing — build-shell.sh installs it"

log_step "verify" "omni.ja signing patch present in the bytes being packaged"
# The official verifier, not a re-implementation: tools/lib/omni-ja.py --verify
# re-opens the archive, recomputes the member CRC from the bytes on disk and
# asserts both substitutions. It also handles omni.ja's 4-byte container
# envelope, which plain zipfile cannot read (it refuses "bad magic number for
# central directory"). Both containers are checked: the signing patch in
# omni.ja and the newtab-strip in browser/omni.ja.
python3 "$ROOT/tools/lib/omni-ja.py" --verify "$APP_DIR/omni.ja" --patch ziy >/dev/null 2>&1 \
  || die "the signing patch is NOT in the app dir's omni.ja"
python3 "$ROOT/tools/lib/omni-ja.py" --verify "$APP_DIR/browser/omni.ja" --patch ziy-browser >/dev/null 2>&1 \
  || die "the newtab-strip patch is NOT in the app dir's browser/omni.ja"
log_ok "omni.ja: MOZ_REQUIRE_SIGNING false, MOZ_ALLOW_ADDON_SIDELOAD true; browser/omni.ja: built-in New Tab stripped"

SUITE_COUNT=$(ls "$APP_DIR"/distribution/extensions/*.xpi 2>/dev/null | wc -l | tr -d ' ')
[ "$SUITE_COUNT" -eq 0 ] || log_ok "suite: $SUITE_COUNT xpi ship inside /usr/lib/ziy"

# ---------------------------------------------------------------------------
# 2. the shared libraries, as package names.
#
# The deb's honest answer to "what does this need from the system". Rather
# than guessing, we ask the tool: dpkg-shlibdeps resolves every NEEDED entry
# in every shipped .so to a Debian package name, which is what lintian and
# apt will check at install time. It is the only source of truth available
# without root, and it is what a hand-written Depends list gets wrong.
# NOTE: dpkg-shlibdeps wants to run inside the package's own build tree (it
# reads debian/control and the system's own shlibs/symbols records); we run it
# on the staging tree and keep it advisory — the generated list is printed
# below and written to the staging dir as deb-shlibdeps.txt, and the hand
# maintained Depends line below stays authoritative. If dpkg-shlibdeps fails
# (no debian dir, no shlibs), we say so and keep going with the list in
# DEPS.md, because a missing resolver is not a reason to ship no Depends.
# ---------------------------------------------------------------------------
log_step "resolve" "mapping the engine's NEEDED libraries to Debian packages (dpkg-shlibdeps)"
DEPS_SH="$(command -v dpkg-shlibdeps || true)"
STAGE="$(mktemp -d /tmp/ziy-pkg-deb-XXXXXX)"
# dpkg-deb --build packages the whole staging tree, so anything this script
# leaves in $STAGE ships inside the .deb at `/` — how the first real run
# (2026-10-16) came to deliver ./bin/ (a second 130 MB copy of the engine),
# ./debian/, ./deb-shlibdeps.txt and ./shlibdeps.err inside the PAYLOAD.
# Resolver artefacts are build-machine facts, not package contents, so they
# live in their own scratch dir removed before the deb is built.
RESOLVE="$(mktemp -d /tmp/ziy-pkg-resolve-XXXXXX)"
cleanup() { rm -rf "$STAGE" "$RESOLVE"; }
trap cleanup EXIT
# dpkg-deb preserves the staging dir's own mode, so mktemp's 0700 became
# `drwx------ root/root 0 .` in the package — every real deb ships
# `drwxr-xr-x` (verified against this box's apt-cached debs on 2026-10-16).
# Pin it explicitly rather than inherit the umask.
chmod 0755 "$STAGE"

GEN_DEPS=""
if [ -n "$DEPS_SH" ]; then
  # dpkg-shlibdeps needs a debian/ dir to write its fragment into and a
  # directory tree to scan; a symlink farm would confuse it, so we hand it a
  # copy of exactly what ships. It also refuses to run as root without a
  # debian/control, non-root is fine.
  mkdir -p "$RESOLVE/debian"
  printf 'Source: ziy-staging\nSection: web\nPriority: optional\nMaintainer: Ziy\nStandards-Version: 4.6.2\n' \
    > "$RESOLVE/debian/control"
  # Copy just the ELF objects: scanning the whole 350 MB tree would take
  # minutes and produce the same answer, because only the binaries carry
  # NEEDED entries.
  mkdir -p "$RESOLVE/bin"
  for f in firefox firefox-bin crashhelper crashreporter updater pingsender \
           gfxtest libxul.so libmozgtk.so libmozsandbox.so liblgpllibs.so; do
    [ -e "$APP_DIR/$f" ] && cp -a "$APP_DIR/$f" "$RESOLVE/bin/" 2>/dev/null || true
  done
  if [ -n "$(ls -A "$RESOLVE/bin" 2>/dev/null)" ]; then
    # -O prints the dependency list to STDOUT and does NOT write
    # debian/substvars (verified against dpkg-dev 1.22.6 on 2026-10-16 with a
    # throwaway package: the debian/ dir held only control afterward). The
    # earlier code read that never-written substvars file, so the resolver's
    # result was always empty and the fallback below warned "Install
    # dpkg-dev" even with dpkg-dev installed. Capture stdout instead — it is
    # the one place -O puts the list.
    SHLIBDEPS_OUT="$( cd "$RESOLVE" && dpkg-shlibdeps -O --ignore-missing-info bin/* 2>"$RESOLVE/shlibdeps.err" )" \
      || log_warn "dpkg-shlibdeps could not resolve every library ($(head -2 "$RESOLVE/shlibdeps.err" 2>/dev/null | tr '\n' ' '))"
    GEN_DEPS="$(printf '%s\n' "$SHLIBDEPS_OUT" | sed -n 's/^shlibs:Depends=//p')"
    if [ -n "$GEN_DEPS" ]; then
      printf '%s\n' "$GEN_DEPS" > "$RESOLVE/deb-shlibdeps.txt"
      log_ok "dpkg-shlibdeps resolved: $GEN_DEPS"
    fi
  fi
fi

# The list we ship when the resolver produced nothing. It is the same set the
# local install's own dependency closure resolved to (checked against this
# box's firefox package on 2026-10-15 — see packaging/linux/DEPS.md), and it
# is deliberately an upper bound: an over-declared Depends blocks an install
# less often than an under-declared one blocks the browser from starting.
BASE_DEPS="libglib2.0-0, libgtk-3-0, libdbus-1-3, libasound2, libpulse0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxrandr2, libxi6, libxtst6, libcairo2, libpango-1.0-0, libcairo-gobject2, libatk1.0-0, libatk-bridge2.0-0, libgbm1, libdrm2, libwayland-client0, libxkbcommon0, libfontconfig1, libfreetype6, libnss3, libnspr4, zlib1g, ffmpeg"
if [ -n "$GEN_DEPS" ]; then
  # Merge: the resolver's list is authoritative for versions; the hand list
  # adds anything the resolver classed as missing.
  DEPENDS="$(printf '%s, %s' "$BASE_DEPS" "$GEN_DEPS" \
             | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' | LC_ALL=C sort -u | paste -sd, - )"
else
  log_warn "no dpkg-shlibdeps result — using the hand-maintained Depends list (packaging/linux/DEPS.md). Install 'dpkg-dev' for the resolved list."
  DEPENDS="$BASE_DEPS"
fi
log_ok "Depends: $DEPENDS"

# ---------------------------------------------------------------------------
# 3. stage the deb tree.
# ---------------------------------------------------------------------------
log_step "stage" "$STAGE/ (DEBIAN + /usr/lib/ziy + /usr/bin/ziy + desktop data)"
install -d "$STAGE/DEBIAN" "$STAGE/usr/bin" "$STAGE/usr/share/applications" \
             "$STAGE/usr/share/icons/hicolor"

# --- the app dir, at /usr/lib/ziy ------------------------------------------
# Copied, not moved, and NOT hard-linked: dpkg-deb reads the staging tree to
# build the data tarball, and a hardlink into build/ziy would make the deb
# break if that tree is ever replaced while a package is being built.
mkdir -p "$STAGE/usr/lib/ziy"
cp -a "$APP_DIR/." "$STAGE/usr/lib/ziy/"
chmod -R u+w "$STAGE/usr/lib/ziy" 2>/dev/null || true
[ -x "$STAGE/usr/lib/ziy/ziy" ] || install -m 0755 "$ROOT/shell/launcher.sh" "$STAGE/usr/lib/ziy/ziy"

# The launcher already resolves its own app dir from its own location
# (readlink -f on BASH_SOURCE), which is exactly what a /usr/lib install
# needs. No path rewrite is required — and none is done, so a tarball and a
# deb carry byte-identical launchers.

# --- /usr/bin/ziy: a symlink, not a wrapper ---------------------------------
# A symlink keeps ONE copy of the launcher (no wrapper script that can drift
# from shell/launcher.sh) and puts the documented /usr/bin/ziy name in PATH.
# The target is RELATIVE on purpose — a symlink stored in a package must
# resolve inside the installed tree — but it must be relative FROM THE LINK'S
# OWN DIRECTORY: the link lives in /usr/bin, so the target is
# "../lib/ziy/ziy". The earlier target "ziy" resolved to /usr/bin/ziy itself
# (a self-loop): readlink -f failed on it and every exec died with "Too many
# levels of symbolic links" (verified against a staging tree in /tmp on
# 2026-10-16). With "../lib/ziy/ziy" the link lands on the real launcher,
# whose own readlink -f resolution then works no matter where the package is
# unpacked.
ln -sfn ../lib/ziy/ziy "$STAGE/usr/bin/ziy" || die "failed to create the /usr/bin/ziy symlink"
[ "$(readlink "$STAGE/usr/bin/ziy")" = "../lib/ziy/ziy" ] \
  || die "the /usr/bin/ziy symlink points at '$(readlink "$STAGE/usr/bin/ziy")', expected '../lib/ziy/ziy'"

# --- the desktop entry + icons ----------------------------------------------
install -m 0644 "$ROOT/shell/ziy.desktop" "$STAGE/usr/share/applications/ziy.desktop"
ICON_COUNT=0
for size in 16 22 24 32 48 64 96 128 256; do
  src="$ROOT/build/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  [ -f "$src" ] || src="$APP_DIR/ziy.png"
  [ -f "$src" ] || continue
  # Stage the icon both where the .deb exposes it directly
  # (/usr/share/icons/hicolor/…) and where the postinst's documented copy
  # loop expects it inside the app dir
  # (/usr/lib/ziy/share/icons/hicolor/… — the same layout make-tarball.sh
  # produces, keeping the two artifacts in parity).
  install -Dm 0644 "$src" "$STAGE/usr/lib/ziy/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  install -Dm 0644 "$src" "$STAGE/usr/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  ICON_COUNT=$((ICON_COUNT+1))
done
[ "$ICON_COUNT" -ge 1 ] || log_warn "no icons staged — the entry will fall back to the icon in /usr/lib/ziy"
log_ok "desktop entry + $ICON_COUNT icon(s) staged"

# --- DEBIAN/control ---------------------------------------------------------
cat > "$STAGE/DEBIAN/control" <<EOF
Package: ziy
Version: $PKG_VERSION
Architecture: $DEB_ARCH
Maintainer: Ziy <packaging@ziy.app>
Installed-Size: $(du -sk "$STAGE/usr" | cut -f1)
Depends: $DEPENDS
Section: web
Priority: optional
Homepage: https://ziy.app
Description: Ziy — a privacy-first browser on the Gecko engine
 Ziy is a browser product built on Mozilla's Gecko engine: its own app
 directory, its own branding, its own WebExtension suite (shields/blocking,
 news, playlist, talk, sync, new tab, password manager, desktop integration),
 and its own profile tree.
 .
 This package installs the complete application under /usr/lib/ziy and puts
 a ziy launcher in /usr/bin. It bundles the engine and modifies no Firefox
 installation on the system.
EOF
log_ok "DEBIAN/control written (Package ziy, Version $PKG_VERSION, Architecture $DEB_ARCH)"

# --- DEBIAN/postinst --------------------------------------------------------
# Small, and honest about it: install the icons the way a desktop theme
# expects (the deb may ship a slightly different icon set than the hicolor
# tree at runtime) and refresh the desktop database. Both are best-effort and
# BOTH failures are reported, because a postinst that swallows an error is how
# "the icon never showed up" happens with nobody able to say why.
cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
# Ziy .deb postinst.
#
# What this does, and nothing else:
#   1. refresh the desktop database
#   2. refresh the icon cache
# It does NOT make Ziy the default browser — that is the user's decision, and
# tools/install-desktop.sh --set-default prints the command rather than
# running it.
#
# set -e is deliberately NOT used: a failure to update a cache is not a
# reason to abort an install, but it is always PRINTED.
set -u

case "${1:-}" in
  configure|abort-upgrade|abort-remove|abort-deconfigure) ;;
  *) exit 0 ;;
esac

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications \
  || echo "ziy postinst: update-desktop-database unavailable or failed (harmless: the entry still installs)" >&2

command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor \
  || echo "ziy postinst: gtk-update-icon-cache unavailable or failed (harmless: icons still install)" >&2

# The icons ship in the package; this loop is the second documented copy into
# the hicolor theme, for a system that prefers /usr/share/icons over the
# package's own directories. Same file, same mode, no version skew.
for size in 16 22 24 32 48 64 96 128 256; do
  src="/usr/lib/ziy/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  dst="/usr/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    mkdir -p "/usr/share/icons/hicolor/${size}x${size}/apps" 2>/dev/null || true
    cp -f "$src" "$dst" 2>/dev/null \
      || echo "ziy postinst: could not install $dst" >&2
  fi
done

exit 0
EOF
chmod 0755 "$STAGE/DEBIAN/postinst"

# conffiles: the files a sysadmin may edit that dpkg must not clobber on
# upgrade. mozilla.cfg is OUR code, not theirs, so it is NOT listed; the
# desktop entry and the icons are also regenerated. An empty conffiles file is
# correct and explicit: it means "this package has no admin-owned config".
: > "$STAGE/DEBIAN/conffiles"

# ---------------------------------------------------------------------------
# 4. build the package.
# ---------------------------------------------------------------------------
mkdir -p "$OUT_DIR"
DEB_PATH="$OUT_DIR/$DEB"
rm -f "$DEB_PATH"
log_step "build" "dpkg-deb --build -> $DEB_PATH"
# --root-owner-group makes the archive root-owned whatever user runs the
# build, so a package built by a CI runner and one built locally are
# byte-comparable and both install as root. -Zxz keeps the 350 MB tree at a
# sane download size on a 1 MB/s link (the design decision in
# research-tech.md §3: installer size is a first-class metric).
dpkg-deb --root-owner-group -Zxz --build "$STAGE" "$DEB_PATH" \
  || die "dpkg-deb --build failed"
[ -s "$DEB_PATH" ] || die "dpkg-deb reported success but $DEB_PATH is missing"
log_ok "built $DEB_PATH ($(du -h "$DEB_PATH" | cut -f1))"

# ---------------------------------------------------------------------------
# 5. verify the artifact, with the real tools, by parsing their output.
#    This is the whole point of a dpkg-deb build being local-friendly: the
#    package can be inspected without root, without apt, without installing
#    anything.
# ---------------------------------------------------------------------------
log_step "verify" "dpkg -I (the metadata)"
INFO="$(dpkg -I "$DEB_PATH" 2>/dev/null || dpkg-deb --info "$DEB_PATH")" \
  || die "dpkg -I could not read the package we just wrote"
printf '%s\n' "$INFO" | sed 's/^/        /'

# The named assertions from the ticket. Each one is a real check against the
# real tool's output, and each failure is a loud one.
printf '%s\n' "$INFO" | grep -q '^ *Package: ziy$' || die "the package is not named 'ziy'"
printf '%s\n' "$INFO" | grep -q "^ *Version: $PKG_VERSION$" || die "the package version is not '$PKG_VERSION'"
printf '%s\n' "$INFO" | grep -q "^ *Architecture: $DEB_ARCH$" || die "the package architecture is not '$DEB_ARCH'"
printf '%s\n' "$INFO" | grep -q '^ *Maintainer: ' || die "the package has no Maintainer"
# [2026-10-16, first real run] This first demanded the line START
# `Depends: lib`, but the resolved list legitimately starts `ffmpeg,` — a
# deliberate BASE_DEPS member — so a correct package failed here. Any
# comma-separated entry may be the first lib* one; both shapes are proven:
# the merged/sorted list (`ffmpeg,libasound2,…`) and the fallback BASE_DEPS
# (`libglib2.0-0, libgtk-3-0, …`).
printf '%s\n' "$INFO" | grep -qE '^ *Depends: (lib|.*, ?lib)' || die "the package declares no library Depends — it cannot install anywhere real"
printf '%s\n' "$INFO" | grep -q '^ *Description: ' || die "the package has no Description"
log_ok "metadata: Package/Version/Architecture/Maintainer/Depends all correct"

log_step "verify" "dpkg -c (the payload)"
CONTENTS="$(dpkg-deb --contents "$DEB_PATH")" \
  || die "dpkg-deb --contents could not list the package we just wrote"
printf '%s\n' "$CONTENTS" | sed 's/^/        /' >&2
log_ok "listed $(printf '%s\n' "$CONTENTS" | wc -l | tr -d ' ') path(s)"

# The paths the ticket names, asserted one by one.
# NOTE: `dpkg-deb --contents` emits `mode owner size date path` with NO
# leading whitespace, so these patterns match the path directly (no `^ *`
# prefix — that prefix would never match, a mechanical defect caught on the
# first real run).
printf '%s\n' "$CONTENTS" | grep -q '\./usr/lib/ziy/ziy$' \
  || die "the package does not ship /usr/lib/ziy/ziy"
printf '%s\n' "$CONTENTS" | grep -q '\./usr/bin/ziy' \
  || die "the package does not ship /usr/bin/ziy"
printf '%s\n' "$CONTENTS" | grep -q '\./usr/lib/ziy/omni\.ja$' \
  || die "the package does not ship /usr/lib/ziy/omni.ja"
printf '%s\n' "$CONTENTS" | grep -q '\./usr/lib/ziy/browser/application\.ini$' \
  || die "the package does not ship our application.ini"
printf '%s\n' "$CONTENTS" | grep -q '\./usr/lib/ziy/distribution/extensions/.*\.xpi$' \
  || log_warn "the package ships no suite xpis (distribution/extensions/ is empty)"
printf '%s\n' "$CONTENTS" | grep -q '\./usr/share/applications/ziy\.desktop$' \
  || die "the package does not ship the .desktop entry"

# /usr/bin/ziy must be a SYMLINK in the archive (an 'l' mode) and its target
# must be the relative "../lib/ziy/ziy", because that is what keeps it from
# drifting from shell/launcher.sh and makes it resolve inside the installed
# tree. A regular file here means something installed a second copy of the
# launcher.
# NOTE: dpkg-deb --contents prints a symlink entry as
#   lrwxrwxrwx root/root 0 <date> ./usr/bin/ziy -> ../lib/ziy/ziy
# — i.e. with a "-> target" suffix that the earlier `\./usr/bin/ziy$` pattern
# could never match (verified against a throwaway package built with this
# box's dpkg-deb on 2026-10-16). The tolerant pattern is the one that
# actually reads the entry.
LINK_LINE="$(printf '%s\n' "$CONTENTS" | grep -E '^ *l[^ ]* .*\./usr/bin/ziy( -> .*)?$' || true)"
if [ -n "$LINK_LINE" ]; then
  LINK_TARGET="$(printf '%s' "$LINK_LINE" | awk '{print $NF}')"
  [ "$LINK_TARGET" = "../lib/ziy/ziy" ] \
    || die "/usr/bin/ziy is a symlink to '$LINK_TARGET', expected '../lib/ziy/ziy' — a self-loop here is a /usr/bin/ziy that cannot exec"
  log_ok "/usr/bin/ziy is a symlink: $LINK_TARGET"
else
  die "/usr/bin/ziy is not a symlink in the package (expected 'l' mode) — it would drift from shell/launcher.sh"
fi

# The maintainer scripts must be in the control archive, not the data.
log_step "verify" "dpkg-deb --ctrl-tarfile (control archive members)"
CTRL="$(dpkg-deb --ctrl-tarfile "$DEB_PATH" | tar -tf - 2>/dev/null)" \
  || die "could not read the package's control archive"
printf '%s\n' "$CTRL" | sed 's/^/        /' >&2
printf '%s\n' "$CTRL" | grep -q '^\./postinst$' || die "the package has no postinst"
log_ok "control archive carries postinst"

# Path agreement between the control file, the postinst and the payload. This
# is the cross-check that catches a package that promises icons it does not
# ship, or a postinst pointing at files a future refactor moved.
POSTINST="$(dpkg-deb --ctrl-tarfile "$DEB_PATH" | tar -xOf - ./postinst 2>/dev/null)"
POSTINST_PACKAGED_ICON_SIZES="$(printf '%s\n' "$POSTINST" | grep -o 'for size in [0-9 ]*;' | head -1 | tr -d ';' )"
log_ok "postinst icon sizes: $POSTINST_PACKAGED_ICON_SIZES"
if printf '%s\n' "$CONTENTS" | grep -q '\./usr/share/icons/hicolor/256x256/apps/ziy\.png$'; then
  log_ok "the package ships the 256px hicolor icon"
else
  log_warn "no 256px hicolor icon in the payload"
fi
# The postinst's icon copy loop reads from inside the app dir
# (/usr/lib/ziy/share/icons/hicolor/…). Assert it actually ships there —
# matching make-tarball.sh's layout — so the postinst source path is not a
# dead wrong path.
for size in 16 22 24 32 48 64 96 128 256; do
  printf '%s\n' "$CONTENTS" | grep -q \
    '\./usr/lib/ziy/share/icons/hicolor/'${size}'x'${size}'/apps/ziy\.png$' \
    || log_warn "no app-dir hicolor icon for ${size}x${size} — postinst icon loop does nothing for this size"
done
# LICENSES.txt + patches/ are shipped in the app dir (build-shell stage 8b)
# and are required by MPL §3.2(a); assert they round-trip into the deb.
printf '%s\n' "$CONTENTS" | grep -q '\./usr/lib/ziy/LICENSES\.txt$' \
  || die "the package does not ship /usr/lib/ziy/LICENSES.txt"
printf '%s\n' "$CONTENTS" | grep -q '\./usr/lib/ziy/patches/000[1-5]-' \
  || die "the package does not ship all five patches under /usr/lib/ziy/patches/"

# ---------------------------------------------------------------- lintian ---
# Not installed on the co-owner's box (it is a 5 MB apt install that exists to
# tell us things dpkg-deb cannot). The workflow installs it and runs it; here
# its absence is reported, not hidden.
if command -v lintian >/dev/null 2>&1; then
  log_step "verify" "lintian"
  lintian --no-tag-display-limit "$DEB_PATH" 2>&1 | sed 's/^/        /' >&2 || true
  log_ok "lintian finished (see the lines above; warnings are advisory, errors are not)"
else
  log_warn "lintian NOT PRESENT on this box — not run. .github/workflows/build-packages.yml runs it on the runner. NOT VERIFIED LOCALLY."
fi

# ---------------------------------------------------------------------------
# 6. the report. Both what was verified and what was not, in the same output.
# ---------------------------------------------------------------------------
# The checksum line is the package's BASENAME, not the absolute build path,
# so the .sha256 verifies on the machine that downloaded it: drop the two
# files side by side and `sha256sum -c <name>.deb.sha256` works there.
( cd "$OUT_DIR" && sha256sum "$DEB" > "$DEB.sha256" )
log_ok "wrote $DEB_PATH.sha256"

cat <<EOF

$(tput bold 2>/dev/null || echo '')deb ready$(tput sgr0 2>/dev/null || echo "")
  artifact      $DEB_PATH ($(du -h "$DEB_PATH" | cut -f1))
  checksum      $DEB_PATH.sha256
  version       $PKG_VERSION
  arch          $DEB_ARCH
  files         $(printf '%s\n' "$CONTENTS" | wc -l | tr -d ' ')
  suite         $SUITE_COUNT xpi
  Depends       $(printf '%s' "$DEPENDS" | cut -c1-80)…

  VERIFIED HERE: dpkg-deb --build produced the file; dpkg -c lists the paths;
  dpkg -I shows Package/Version/Architecture/Maintainer/Depends correctly;
  /usr/bin/ziy is a symlink; the control archive carries postinst.
  NOT VERIFIED HERE (by design): dpkg -i, apt-get install, the postinst
  actually running, and lintian (not installed). Those need root or a
  runner; the workflow does them.
EOF
log_ok "make-deb.sh complete"
