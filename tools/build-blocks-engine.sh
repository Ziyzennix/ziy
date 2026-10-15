#!/usr/bin/env bash
# build-blocks-engine — build the host and the precompiled blocking engine.
#
# WHY (replica/native-expansion.md §7.1 T1): adblock-rust replaces Ziy's
# 30,000-rule DNR ceiling with one precompiled engine holding every rule from
# the 7 shipped snapshots — 0.0032–0.0050 ms per request vs 0.34–9.67 ms
# (§6.1/§6.4). Parsing 5.26 MB of filter text happens HERE, once, at
# package-build time; the host reloads the serialized result in ~40 ms
# instead of rebuilding it on every profile.
#
# WHAT IT DOES
#   1. cargo build --release in native/ziy-blocks (host + generator)
#   2. runs ziy-blocks-gen over
#      extensions/ziy-shields/lib/filterlist/snapshots/*.txt, writing
#      native/ziy-blocks/dist/ziy-blocks-engine.dat
#   The generator self-checks the artifact (round-trips it and probes a pinned
#   tracker + a pinned clean URL) and exits non-zero rather than shipping a bad
#   engine.
#
# USAGE
#   tools/build-blocks-engine.sh            # build + generate
#   tools/build-blocks-engine.sh --gen-only # reuse the existing binary
#
# Artifacts are gitignored: target/ and dist/ are derived from tracked sources
# (crate + snapshots), never committed.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
CRATE="$ROOT/native/ziy-blocks"
SNAPSHOTS="$ROOT/extensions/ziy-shields/lib/filterlist/snapshots"
OUT="$CRATE/dist/ziy-blocks-engine.dat"
GEN="$CRATE/target/release/ziy-blocks-gen"

gen_only=0
for arg in "$@"; do
  case "$arg" in
    --gen-only) gen_only=1 ;;
    *) echo "build-blocks-engine: unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# rustup installs to ~/.cargo/bin, which is not on PATH in a non-login shell.
export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null 2>&1 || {
  echo "build-blocks-engine: cargo not found — is the Rust toolchain installed (~/.cargo/bin)?" >&2
  exit 1
}

if [ "$gen_only" -eq 0 ]; then
  echo "build-blocks-engine: cargo build --release (native/ziy-blocks)"
  (cd "$CRATE" && cargo build --release)
fi

[ -x "$GEN" ] || { echo "build-blocks-engine: $GEN missing — run without --gen-only first" >&2; exit 1; }
[ -d "$SNAPSHOTS" ] || { echo "build-blocks-engine: snapshots dir missing: $SNAPSHOTS" >&2; exit 1; }

echo "build-blocks-engine: generating the engine from the shipped snapshots"
mkdir -p "$(dirname "$OUT")"
"$GEN" "$SNAPSHOTS" "$OUT"

echo "build-blocks-engine: done — $OUT"
ls -l "$OUT"
