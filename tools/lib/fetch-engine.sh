#!/usr/bin/env bash
# tools/lib/fetch-engine.sh — fetch a Mozilla Firefox BINARY build from
# ftp.mozilla.org, checksum-verify it against Mozilla's own published
# SHA512SUMS, and extract it to build/engine/firefox-<version>/.
#
# WHY THIS EXISTS: build-shell.sh used to be able to build only from a Firefox
# the operator already had installed (/usr/lib/firefox). That made Ziy depend on
# the host OS's packaging instead of on Ziy. Fetching Mozilla's own prebuilt
# tarball makes Ziy self-contained: the engine is a Pinned, checksum-verified
# input the build downloads itself, on any machine, with no Firefox install.
#
# This is NOT a Gecko compile. The tarball is Mozilla's PREBUILT binary
# (firefox-156.0.1.tar.xz, 88 MB): extracting it is an unzip, exactly like
# unpacking an AppImage. No ./mach, no rustc, no clang, no ccache.
#
# PROVENANCE (the whole point of the SHA512SUMS fetch): Mozilla publishes
# SHA512SUMS next to every release, listing every artifact's SHA512. We fetch
# that manifest over HTTPS from Mozilla, look the tarball up in it BY LINE, and
# refuse to extract anything whose digest is not in the manifest. A digest we
# did not read from Mozilla is not provenance.
#
# Usage:
#   fetch-engine.sh [--version V] [--locale L] [--dir PATH] [--retries N] [-h]
#
#   --version V   engine version (default 156.0.1; the version Ziy pins)
#   --locale L    locale directory under linux-x86_64/ (default en-US)
#   --dir PATH    extraction root (default <repo>/build/engine)
#   --retries N   curl --retry (default 20; the link is ~1 MB/s)
#
#   --tarball F   use an already-downloaded tarball F instead of fetching it.
#                 Its digest is STILL verified against Mozilla's published
#                 manifest, so a hand-placed file gets the same provenance
#                 check as a download. Only the bytes are reused.
#
# Exit: 0 = the extracted engine dir exists and is verified. Non-zero = a loud,
# named failure. This script NEVER deletes a tarball, and never starts a
# download while another one is in flight (AI-BRIEF.md §5 rule 12).
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"

ENGINE_VERSION="156.0.1"
LOCALE="en-US"
ENGINE_ROOT=""
RETRIES="20"
LOCAL_TARBALL=""

usage() { sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version)     [ $# -ge 2 ] || { printf 'fail: --version needs a value\n' >&2; exit 2; }; ENGINE_VERSION="$2"; shift 2 ;;
    --version=*)   ENGINE_VERSION="${1#--version=}"; shift ;;
    --locale)      [ $# -ge 2 ] || { printf 'fail: --locale needs a value\n' >&2; exit 2; }; LOCALE="$2"; shift 2 ;;
    --locale=*)    LOCALE="${1#--locale=}"; shift ;;
    --dir)         [ $# -ge 2 ] || { printf 'fail: --dir needs a path\n' >&2; exit 2; }; ENGINE_ROOT="$2"; shift 2 ;;
    --dir=*)       ENGINE_ROOT="${1#--dir=}"; shift ;;
    --retries)     [ $# -ge 2 ] || { printf 'fail: --retries needs a number\n' >&2; exit 2; }; RETRIES="$2"; shift 2 ;;
    --retries=*)   RETRIES="${1#--retries=}"; shift ;;
    --tarball)     [ $# -ge 2 ] || { printf 'fail: --tarball needs a path\n' >&2; exit 2; }; LOCAL_TARBALL="$2"; shift 2 ;;
    --tarball=*)   LOCAL_TARBALL="${1#--tarball=}"; shift ;;
    -h|--help)     usage ;;
    *)             printf 'fail: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# --- the URLs, derived from the version --------------------------------------
# Verified live 2026-10-15: the release directory for 156.0.1 carries
# linux-x86_64/en-US/firefox-156.0.1.tar.xz (content-length 88308892) and
# SHA512SUMS (866154 bytes), and SHA512SUMS lists the tarball's digest on the
# line "…  linux-x86_64/en-US/firefox-156.0.1.tar.xz". The .xz IS the right
# artifact for this build: the tarball's members are the xz-compressed stream of
# a ./firefox/ tree identical in layout to /usr/lib/firefox (omni.ja,
# browser/omni.ja, defaults/, distribution/, libxul.so, firefox-bin, …), which
# is exactly what build-shell.sh's engine validation requires.
BASE_URL="https://ftp.mozilla.org/pub/firefox/releases/${ENGINE_VERSION}"
PLATFORM="linux-x86_64"
ARTIFACT="${PLATFORM}/${LOCALE}/firefox-${ENGINE_VERSION}.tar.xz"
TARBALL_URL="${BASE_URL}/${ARTIFACT}"
SUMS_URL="${BASE_URL}/SHA512SUMS"

[ -n "$ENGINE_ROOT" ] || ENGINE_ROOT="$ROOT/build/engine"
TARBALL="$ENGINE_ROOT/firefox-${ENGINE_VERSION}.tar.xz"
SUMS="$ENGINE_ROOT/SHA512SUMS"
EXTRACTED="$ENGINE_ROOT/firefox-${ENGINE_VERSION}"
# The lock, so a second concurrent call waits instead of racing (rule 12).
LOCK="$ENGINE_ROOT/fetch-${ENGINE_VERSION}.lock"

note()  { printf '  %s %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()   { printf 'fail: %s\n' "$*" >&2; exit 1; }

mkdir -p "$ENGINE_ROOT"

# Serialize against any other fetch of this version, whether in this process's
# future or another tool's. flock is advisory but every caller here takes it.
exec 9>"$LOCK"
if command -v flock >/dev/null 2>&1; then
  if ! flock -w 3600 9; then
    die "another fetch of $ENGINE_VERSION is already holding $LOCK; if that is stale, remove it and retry"
  fi
fi

# --- already extracted? -------------------------------------------------------
if [ -x "$EXTRACTED/firefox" ] && [ -f "$EXTRACTED/omni.ja" ] \
   && [ -f "$EXTRACTED/browser/omni.ja" ]; then
  note "engine already extracted at $EXTRACTED"
  printf '%s\n' "$EXTRACTED"
  exit 0
fi

# --- 1. the published SHA512SUMS manifest -------------------------------------
# Fetching Mozilla's own manifest is what makes the digest provenance rather
# than a magic constant. If it cannot be fetched, we do NOT extract: a tarball
# with no manifest to check it against is an unverified download.
if [ ! -s "$SUMS" ]; then
  note "fetching $SUMS_URL"
  curl -sS --fail --retry "$RETRIES" --retry-delay 5 --retry-all-errors \
       --max-time 900 -o "$SUMS" "$SUMS_URL" \
    || die "could not fetch $SUMS_URL (network failure — do not retry-loop; fix connectivity and rerun)"
fi

# The digest for THIS artifact, read out of the manifest by line. A manifest
# that does not list our artifact must fail here: it means either a wrong URL or
# a manifest we do not understand.
EXPECTED="$(grep -F " $ARTIFACT" "$SUMS" | head -1 | awk '{print $1}')"
[ -n "$EXPECTED" ] || die "$SUMS_URL does not list $ARTIFACT — refusing to use an unlisted artifact"
note "published sha512 $EXPECTED"

# --- 2. download (resumable; ~1 MB/s link) ------------------------------------
# 88,308,892 bytes at ~1 MB/s is ~9 minutes of transfer — the number that makes
# resumability the whole game. -C - resumes a partial file, --retry 20 with
# --retry-all-errors survives a dropped link mid-transfer, and the -w progress
# line records what actually happened for the proof doc.
if [ -n "$LOCAL_TARBALL" ]; then
  # A tarball the caller already has. Copy it into the engine root so the rest
  # of this script (digest check, extraction) has one canonical path, and so a
  # later resume does not depend on the original file still being there.
  [ -f "$LOCAL_TARBALL" ] || die "tarball not found: $LOCAL_TARBALL"
  if [ "$(readlink -f "$LOCAL_TARBALL")" != "$(readlink -f "$TARBALL")" ]; then
    if [ -s "$TARBALL" ] && [ "$(stat -c%s "$LOCAL_TARBALL")" -le "$(stat -c%s "$TARBALL")" ]; then
      note "keeping the existing $TARBALL (already at least as complete as $LOCAL_TARBALL)"
    else
      note "copying local tarball $LOCAL_TARBALL"
      cp -f "$LOCAL_TARBALL" "$TARBALL"
    fi
  fi
elif [ -s "$TARBALL" ]; then
  note "resuming partial download ($(stat -c%s "$TARBALL") bytes present)"
fi
if [ -z "$LOCAL_TARBALL" ]; then
  note "downloading $TARBALL_URL"
  curl -C - --fail --retry "$RETRIES" --retry-delay 5 --retry-all-errors \
       --retry-max-time 3600 --max-time 3600 \
       -o "$TARBALL" "$TARBALL_URL" \
    || die "download failed for $TARBALL_URL (the partial file is kept; rerun to resume with curl -C -)"
fi

# --- 3. verify the digest -----------------------------------------------------
note "verifying sha512 against Mozilla's published manifest"
ACTUAL="$(sha512sum "$TARBALL" | awk '{print $1}')"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  die "SHA512 MISMATCH: got $ACTUAL, Mozilla published $EXPECTED for $ARTIFACT — the tarball is NOT the artifact Mozilla signed. Remove $TARBALL and rerun."
fi
note "sha512 MATCH ($ACTUAL)"

# --- 4. extract ---------------------------------------------------------------
rm -rf "$EXTRACTED"
note "extracting to $EXTRACTED"
tar -xJf "$TARBALL" -C "$ENGINE_ROOT" \
  || die "extraction failed — the tarball may be truncated (rerun to resume the download)"

# Mozilla's binary tarballs unpack to a bare `firefox/` directory (verified:
# the 156.0.1 linux-x86_64 tarball's members are firefox/… , not
# firefox-156.0.1/…), while the source tarball does use the versioned name. We
# want ONE stable path for downstream callers (build-shell.sh, verify.sh, the
# provenance record), so the versioned directory is what we expose: move it
# into place when the tarball chose the other spelling.
if [ ! -d "$EXTRACTED" ] && [ -d "$ENGINE_ROOT/firefox" ]; then
  mv "$ENGINE_ROOT/firefox" "$EXTRACTED"
fi
if [ ! -d "$EXTRACTED" ]; then
  die "tarball did not contain a firefox-156.0.1/ or firefox/ directory (the artifact's top-level name is unexpected)"
fi

# Validate the extracted tree is a usable engine root, with the SAME contract
# build-shell.sh enforces on a system install: an executable binary, both omni.ja
# containers, and defaults/ + distribution/ that our app-identity layer expects.
[ -x "$EXTRACTED/firefox" ]   || die "$EXTRACTED has no executable 'firefox' binary"
[ -f "$EXTRACTED/omni.ja" ]           || die "$EXTRACTED has no omni.ja"
[ -f "$EXTRACTED/browser/omni.ja" ]   || die "$EXTRACTED has no browser/omni.ja"
[ -f "$EXTRACTED/defaults/pref/channel-prefs.js" ] \
  || die "$EXTRACTED has no defaults/pref — not a complete Firefox install tree"

note "engine ready: $EXTRACTED"
printf '%s\n' "$EXTRACTED"
exit 0
