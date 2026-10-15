#!/usr/bin/env bash
# Ziy launcher stub — installed as <build>/ziy by tools/build-shell.sh.
#
# This is the shippable entry point: it execs the binary inside its own app dir
# with our own name and icon, and passes every argument straight through, so
# `--headless=new`, URLs, `--profile`, `--screenshot` all work exactly as they
# do on Firefox.
#
# Profile selection, icon lookup and MOZ_APP_LAUNCHER live in tools/bin/ziy
# (the development launcher), which this stub mirrors. A shipped build replaces
# this stub's `ZIY_HOME` default with the install prefix it was packaged to.
set -uo pipefail

ZIY_HOME="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
export ZIY_HOME

# The launcher name the OS and the default-browser agent see.
export MOZ_APP_LAUNCHER="$0"

# Our icon, for anything that asks the process for an application icon.
if [ -f "$ZIY_HOME/ziy.png" ]; then
  export ZIY_ICON="$ZIY_HOME/ziy.png"
fi

exec "$ZIY_HOME/firefox" "$@"
