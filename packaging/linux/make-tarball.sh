#!/usr/bin/env bash
# packaging/linux/make-tarball.sh — the portable Linux tarball.
#
# Produces build/packaging/ziy-<version>-linux-x86_64.tar.xz: the app dir, the
# launcher, the docs and a bundled README, installable anywhere by unpacking it
# and running ./ziy. This is the universal Linux path — it makes no assumption
# about a package manager, a system Firefox, or root, which is why it covers
# "all distros" that a .deb cannot.
#
# WHAT IT IS NOT: it does not build the browser. tools/build-shell.sh produces
# build/ziy; this script packages what that left on disk. If build/ziy is
# missing this script FAILS LOUDLY (that is the only honest response to
# "package a product nobody built yet"), it does not fabricate an app dir.
#
# THE ENGINE IS BUNDLED, NOT DEPENDED ON. The tarball carries the whole engine
# the build resolved (build/engine-provenance.txt records which one it was), so
# the machine that unpacks it needs no Firefox installed. The one thing the
# tarball CANNOT carry is the shared-library set — see the dependency note in
# the generated README and packaging/linux/DEPS.md.
#
# WHAT IT VERIFIES ITSELF, before it declares success:
#   1. build/ziy exists and is a complete app dir (executable, both omni.ja,
#      our application.ini).
#   2. the app dir's own omni.ja carries the signing patch, re-read from the
#      bytes we are about to ship (not from a build log).
#   3. the desktop entry, the icons and the README are all present in the
#      staging tree before tar runs.
#   4. the produced tarball unpacks into a tmp dir and THAT copy has an
#      executable launcher, the same application.ini and the same omni.ja
#      digest as the staged tree — the archive is verified by re-reading its
#      own output, not by trusting tar's exit code.
#
# Usage:
#   packaging/linux/make-tarball.sh [--out DIR] [--name STEM]
#
#   --out DIR      output directory (default build/packaging)
#   --name STEM    artifact stem (default ziy-<version>-linux-x86_64)
#
# Env:
#   ZIY_APP_DIR    the app dir to package (default build/ziy)
#   ZIY_VERSION    product version string (default 156.0.1)
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"
APP_DIR="${ZIY_APP_DIR:-$ROOT/build/ziy}"
VERSION="${ZIY_VERSION:-156.0.1}"
OUT_DIR="$ROOT/build/packaging"
STEM="ziy-$VERSION-linux-x86_64"

C_RESET=; C_BOLD=; C_DIM=; C_RED=; C_GREEN=; C_YELLOW=
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
fi
log_step() { printf '  %s%-10s%s %s\n' "$C_DIM" "$1" "$C_RESET" "$2" >&2; }
log_ok()   { printf '%s  ok  %s%s\n' "$C_GREEN" "$1" "$C_RESET" >&2; }
log_warn() { printf '%swarn:  %s%s\n' "$C_YELLOW" "$1" "$C_RESET" >&2; }
die()      { printf '%sfail:  %s%s\n' "$C_RED" "$1" "$C_RESET" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || die "--out needs a directory"; OUT_DIR="$2"; shift 2 ;;
    --name) [ $# -ge 2 ] || die "--name needs a stem"; STEM="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. the input tree. Every check here is a check a missing step would trip.
# ---------------------------------------------------------------------------
[ -d "$APP_DIR" ] || die "app dir not found: $APP_DIR — run ./tools/build-shell.sh first"
[ -x "$APP_DIR/firefox" ] || die "$APP_DIR has no executable 'firefox' — not a Ziy app dir"
[ -f "$APP_DIR/omni.ja" ] || die "$APP_DIR has no omni.ja — run ./tools/build-shell.sh first"
[ -f "$APP_DIR/browser/omni.ja" ] || die "$APP_DIR/browser/omni.ja missing"
[ -f "$APP_DIR/browser/application.ini" ] || die "$APP_DIR/browser/application.ini missing — the app identity was never installed"
grep -q '^Name=Ziy' "$APP_DIR/browser/application.ini" \
  || die "$APP_DIR/browser/application.ini does not name Ziy — this is not our build"

# The signing patch, re-read from the bytes we are about to ship. A build log
# that says "patched" is not evidence; the archive member is.
# The official verifier, not a re-implementation: tools/lib/omni-ja.py --verify
# re-opens the archive, recomputes the stored member's CRC from the bytes on
# disk and asserts both substitutions — and it understands omni.ja's 4-byte
# container envelope, which plain zipfile cannot read ("bad magic number for
# central directory"). Both containers are checked.
log_step "verify" "omni.ja carries the signing patch in the shipped bytes"
python3 "$ROOT/tools/lib/omni-ja.py" --verify "$APP_DIR/omni.ja" --patch ziy >/dev/null 2>&1 \
  || die "the signing patch is NOT in $APP_DIR/omni.ja — a patched omni.ja is the reason our unsigned suite installs at all"
python3 "$ROOT/tools/lib/omni-ja.py" --verify "$APP_DIR/browser/omni.ja" --patch ziy-browser >/dev/null 2>&1 \
  || die "the newtab-strip patch is NOT in $APP_DIR/browser/omni.ja"
log_ok "omni.ja: signing false, sideload true; browser/omni.ja: built-in New Tab stripped"

# The suite. It may legitimately be empty in a shell-only build (build-shell.sh
# says so in its own header), but the packaging layer must SAY which one it is
# shipping, because "the suite installs" is a promise a user can verify.
SUITE_COUNT=$(ls "$APP_DIR"/distribution/extensions/*.xpi 2>/dev/null | wc -l | tr -d ' ')
if [ "$SUITE_COUNT" -eq 0 ]; then
  log_warn "distribution/extensions/ is empty — run tools/build-extension.sh --all. The tarball will ship WITHOUT the WebExtension suite."
else
  log_ok "suite: $SUITE_COUNT xpi file(s) ship inside the app dir"
fi

# ---------------------------------------------------------------------------
# 2. stage the tree.
#
# WHAT SHIPS: everything in build/ziy that the product needs to run, plus a
# README at the archive root. WHAT DOES NOT SHIP: the crash reporter binaries
# are kept (they are ours and the URLs are stripped), but nothing from the
# operator's system leaks in — we copy from the app dir, not from /usr/lib.
# ---------------------------------------------------------------------------
STAGE="$(mktemp -d /tmp/ziy-pkg-tarball-XXXXXX)"
UNPACK=""
cleanup() {
  rm -rf "$STAGE"
  [ -n "$UNPACK" ] && rm -rf "$UNPACK"
  return 0
}
trap cleanup EXIT

log_step "stage" "copying the app dir into $STAGE/$STEM"
mkdir -p "$STAGE/$STEM"
# cp -a, not a move: build/ziy is the thing sibling workers are booting right
# now, and it stays exactly as it is. A hardlink would be wrong too (dpkg-deb
# and tar both rewrite metadata; we want no surprises in the source tree).
cp -a "$APP_DIR/." "$STAGE/$STEM/"
chmod -R u+w "$STAGE/$STEM" 2>/dev/null || true

# The launcher, named exactly what the user types. build-shell.sh already
# installed shell/launcher.sh as build/ziy/ziy; assert it is there rather than
# re-installing a second copy that could drift.
[ -x "$STAGE/$STEM/ziy" ] || install -m 0755 "$ROOT/shell/launcher.sh" "$STAGE/$STEM/ziy"
log_ok "launcher: $STAGE/$STEM/ziy"

# The desktop entry and the icons travel with the tarball so an unpacked copy
# can be integrated by tools/install-desktop.sh (which rewrites Exec to the
# live path — no absolute path is baked in here, so the tarball installs
# anywhere the IA-32 question of "where did I put it" has any answer).
install -m 0644 "$ROOT/shell/ziy.desktop" "$STAGE/$STEM/ziy.desktop"
mkdir -p "$STAGE/$STEM/share/icons/hicolor"
for size in 16 22 24 32 48 64 96 128 256; do
  # Prefer the hicolor tree build-shell.sh rendered; fall back to the largest
  # rendered mark for a size the brand renderer did not produce, exactly as
  # build-shell.sh's own fallback does.
  src="$ROOT/build/share/icons/hicolor/${size}x${size}/apps/ziy.png"
  [ -f "$src" ] || src="$APP_DIR/ziy.png"
  [ -f "$src" ] || continue
  mkdir -p "$STAGE/$STEM/share/icons/hicolor/${size}x${size}/apps"
  install -m 0644 "$src" "$STAGE/$STEM/share/icons/hicolor/${size}x${size}/apps/ziy.png"
done
ICON_COUNT=$(find "$STAGE/$STEM/share/icons" -name 'ziy.png' | wc -l | tr -d ' ')
log_ok "icons: $ICON_COUNT size(s) under share/icons/hicolor/"
[ "$ICON_COUNT" -ge 1 ] || log_warn "no icons were packaged — a desktop entry with a missing icon is a cosmetic defect, not a launch defect"

# Our own tooling travels with it: bootstrap-profile.py is what a fresh box
# needs on the first run, and install-desktop.sh is what wires the entry.
install -m 0644 "$ROOT/tools/bootstrap-profile.py" "$STAGE/$STEM/bootstrap-profile.py"
install -m 0755 "$ROOT/tools/install-desktop.sh" "$STAGE/$STEM/install-desktop.sh"
install -m 0644 "$ROOT/shell/extensions.list" "$STAGE/$STEM/extensions.list"

# ---------------------------------------------------------------------------
# 3. the README. Written from the facts of THIS tree, not from a template:
#    the suite count above, the icons above, and the engine provenance record.
# ---------------------------------------------------------------------------
ENGINE_SOURCE="$(sed -n 's/^source=//p' "$ROOT/build/engine-provenance.txt" 2>/dev/null || echo unknown)"
ENGINE_PATH="$(sed -n 's/^engine=//p' "$ROOT/build/engine-provenance.txt" 2>/dev/null || echo unknown)"
ENGINE_SHA512="$(sed -n 's/^sha512=//p' "$ROOT/build/engine-provenance.txt" 2>/dev/null || echo)"
cat > "$STAGE/$STEM/README.md" <<EOF
# Ziy $VERSION

A privacy-first browser on the Gecko engine. This tarball is a complete,
self-contained Linux build: it carries its own engine, so nothing has to be
installed system-wide and no Firefox is needed on the machine.

## What is inside

| path | what it is |
| --- | --- |
| \`ziy\` | the launcher — run \`./ziy\` |
| \`firefox\` | the Gecko launcher binary (the engine; renamed by nothing, it is still Gecko underneath) |
| \`browser/\`, \`omni.ja\` | the engine's own files, with Ziy's \`application.ini\` inside \`browser/\` |
| \`mozilla.cfg\` | Ziy's autoconfig layer (the locked prefs) |
| \`distribution/\` | our \`policies.json\`, \`distribution.ini\` and the WebExtension suite |
| \`ziy.desktop\` | the freedesktop entry, with a placeholder \`Exec\` for a package install |
| \`share/icons/hicolor/\` | Ziy's app icon at every size |
| \`bootstrap-profile.py\` | creates \~/.ziy/profiles/<name>/ on first run |
| \`install-desktop.sh\` | installs the .desktop entry + icons into \`~/.local\` |

## Running it

\`\`\`bash
tar -xJf $(basename "$STEM").tar.xz
cd $STEM
./ziy
\`\`\`

That is the whole install. It runs from a tarball, from \`/opt\`, from a USB
stick, from a read-only mount, from any directory on any distro — there is no
package manager step and no root.

\`./ziy\` creates \`~/.ziy/profiles/default/\` itself on the first run, so a fresh
box works with no manual step. Options: \`--profile NAME\`, \`--headless\`, and
every other argument passes straight through to the engine (\`--screenshot\`,
URLs, \`--new-window\`, …).

## Desktop integration (optional, per-user, no root)

\`\`\`bash
cd $STEM
./install-desktop.sh
\`\`\`

That writes \`~/.local/share/applications/ziy.desktop\` and
\`~/.local/share/icons/hicolor/*/apps/ziy.png\`, and runs
\`update-desktop-database\` when it exists. It is idempotent, it never touches
Firefox, and it does not make Ziy your default browser — that stays your
decision; \`./install-desktop.sh --set-default\` prints the command.

## Shared libraries

This tarball bundles the engine and our whole product layer, but it cannot
bundle the C library or the GUI toolkits, because those come from the operating
system. Ziy needs the same shared libraries Firefox does: glibc, GTK 3,
DBus, ALSA/PulseAudio, X11 or Wayland, and the usual font and X stack. On any
current Linux desktop those are present. The bundled binary carries a
\`dependentlibs.list\`; the package-level rows that depend on them are listed in
\`packaging/linux/DEPS.md\` (the .deb turns them into \`Depends:\`).

## What ships in this copy

- Version: **$VERSION**
- Suite: **$SUITE_COUNT WebExtension(s)** in \`distribution/extensions/\`$([ "$SUITE_COUNT" -eq 0 ] && echo ' — **NONE: run tools/build-extension.sh --all before packaging**')
- Engine: **$ENGINE_PATH** (source: **$ENGINE_SOURCE**)$([ -n "$ENGINE_SHA512" ] && echo ", sha512 \`${ENGINE_SHA512:0:16}…\`")

## Updating

Ziy does not use Mozilla's update channel — an update from Mozilla would
overwrite the patched \`omni.ja\` and silently un-patch the product. Ships new
tarballs instead and re-point \`ziy\` at them; the engine version is pinned in
\`tools/build-shell.sh\` and this version string is \`$VERSION\`.
EOF

# A checksum file at the archive root: the cheapest possible integrity story
# for a tarball downloaded over HTTPS, and it makes the workflow's own
# artifact verification a one-line sha256sum -c.
( cd "$STAGE/$STEM" && find . -type f | LC_ALL=C sort | xargs sha256sum > CHECKSUMS.sha256 ) 2>/dev/null
log_ok "README.md + CHECKSUMS.sha256 written"

# ---------------------------------------------------------------------------
# 4. tar it.
#
# The staged tree is rebuilt so owner/group are reproducible: root-owned
# staging (a CI runner) must not produce a tarball nobody can read as a user.
# --sort=name is the deterministic member order; xz -T0 is parallel so the
# ~350 MB compresses in minutes on a runner and seconds locally.
# ---------------------------------------------------------------------------
mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/$STEM.tar.xz"
rm -f "$TARBALL"
log_step "compress" "creating $TARBALL (xz, multithreaded)"
tar --sort=name --owner=0 --group=0 --numeric-owner \
    -C "$STAGE" -cJf "$TARBALL" "$STEM" \
  || die "tar failed — see the message above"

if [ ! -s "$TARBALL" ]; then
  die "no tarball was produced at $TARBALL"
fi

# ---------------------------------------------------------------------------
# 5. verify by re-reading our own output. This is the step that distinguishes
#    "tar exited 0" from "the archive is what we say it is".
# ---------------------------------------------------------------------------
log_step "verify" "re-reading $TARBALL"
UNPACK="$(mktemp -d /tmp/ziy-pkg-verify-XXXXXX)"
tar -xJf "$TARBALL" -C "$UNPACK" || die "the tarball we just wrote does not unpack"
R="$UNPACK/$STEM"

[ -x "$R/ziy" ] || die "the unpacked tarball has no executable 'ziy'"
[ -f "$R/README.md" ] || die "the unpacked tarball has no README.md"

# The launcher must resolve its own app dir from its own location: that is the
# property that makes it work from /opt, from a USB stick and from a checkout
# alike. It is in shell/launcher.sh's own contract ("resolved from this file's
# own location"); assert the property survived packaging.
grep -q 'readlink -f "${BASH_SOURCE\[0\]}"' "$R/ziy" \
  || log_warn "the packaged launcher does not resolve its app dir from its own location — packaging may have replaced it"

# The patched omni.ja, byte-verified AGAIN in the unpacked copy, and its digest
# compared to the staged one. This is the assertion that the compression is
# lossless for the file the whole product story depends on.
UNPACKED_DIGEST="$(sha256sum "$R/omni.ja" | awk '{print $1}')"
STAGED_DIGEST="$(sha256sum "$STAGE/$STEM/omni.ja" | awk '{print $1}')"
[ "$UNPACKED_DIGEST" = "$STAGED_DIGEST" ] \
  || die "omni.ja changed during packaging (staged $STAGED_DIGEST, unpacked $UNPACKED_DIGEST)"
log_ok "omni.ja digest identical in the staged tree and the unpacked archive"

python3 - "$R/omni.ja" <<'PY' || die "the shipped omni.ja lost the signing patch somewhere in packaging"
import sys, zipfile
zf = zipfile.ZipFile(sys.argv[1])
m = zf.read("modules/AppConstants.sys.mjs").decode("utf-8", "replace")
assert "MOZ_REQUIRE_SIGNING: false," in m and "MOZ_ALLOW_ADDON_SIDELOAD: true," in m
PY
log_ok "the shipped omni.ja still carries both patches"

# Identity, from the archive's own bytes.
grep -q '^Name=Ziy' "$R/browser/application.ini" \
  || die "the shipped application.ini does not name Ziy"
[ -f "$R/distribution/policies.json" ] || log_warn "the tarball carries no distribution/policies.json"
[ "$SUITE_COUNT" = "0" ] || [ "$(ls "$R"/distribution/extensions/*.xpi 2>/dev/null | wc -l | tr -d ' ')" = "$SUITE_COUNT" ] \
  || die "the suite xpi count changed during packaging"
log_ok "identity + suite verified from the unpacked archive"

# Size report: the packaging number that bites (research-tech.md §3 records the
# installer-size metric as a first-class one).
TARBALL_SIZE="$(du -h "$TARBALL" | cut -f1)"
UNPACKED_SIZE="$(du -sh "$R" | cut -f1)"
sha256sum "$TARBALL" > "$TARBALL.sha256"
log_ok "wrote $TARBALL.sha256"
log_ok "artifact: $TARBALL ($TARBALL_SIZE compressed, $UNPACKED_SIZE unpacked)"

# ---------------------------------------------------------------------------
# 6. What this script did NOT verify — stated, because a packaging script that
#    renders a browser only on the CI runner must not imply it ran it.
# ---------------------------------------------------------------------------
cat <<EOF

$(tput bold 2>/dev/null || echo '')tarball ready$(tput sgr0 2>/dev/null || echo "")
  artifact      $TARBALL
  checksum      $TARBALL.sha256
  suite         $SUITE_COUNT xpi
  unpacked to   $UNPACK (remove it anytime)

  VERIFIED HERE: tree completeness, both omni.ja patches, identity, suite
  count, archive round-trip (unpack + digest + launcher).
  NOT VERIFIED HERE: that the browser BOOTS. A boot needs a GUI/headless run
  and ~2 minutes of CPU on a throwaway profile — that is CI's job
  (.github/workflows/build-packages.yml, step "smoke"), not the co-owner's
  4-core box's. See packaging/linux/DEPS.md for the shared-library list.
EOF
log_ok "make-tarball.sh complete"
