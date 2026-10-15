#!/usr/bin/env bash
# tools/lib/common.sh — shared helpers for the Ziy shell tooling.
#
# Sourced by tools/build-shell.sh, tools/verify.sh, tools/bootstrap-profile.py
# (via the shim in tools/lib/) and the launcher. Kept in one file so the scripts
# agree on what a log line looks like and how a failure is reported.
set -uo pipefail

# Colours, but only when we are on a terminal.
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=; C_BOLD=; C_DIM=; C_RED=; C_GREEN=; C_YELLOW=; C_BLUE=
fi

log_step()   { printf '  %s%-10s%s %s\n' "$C_DIM" "$1" "$C_RESET" "$2" >&2; }
log_ok()     { printf '%s  ok  %s%s\n' "$C_GREEN" "$1" "$C_RESET" >&2; }
log_warn()   { printf '%swarn:  %s%s\n' "$C_YELLOW" "$1" "$C_RESET" >&2; }
log_error()  { printf '%sfail:  %s%s\n' "$C_RED" "$1" "$C_RESET" >&2; }
die()        { log_error "$*"; exit 1; }

# The repo root regardless of where a script was invoked from.
ziy_repo_root() {
  (cd -- "$(dirname -- "${BASH_SOURCE[1]}")/.." && pwd)
}

# Engine discovery, in the order build-shell.sh documents.
ziy_find_engine() {
  local candidates=()
  [ -n "${ZIY_ENGINE:-}" ] && candidates+=("$ZIY_ENGINE")
  candidates+=("/usr/lib/firefox" "/opt/firefox" "/usr/local/firefox")
  local d
  for d in /usr/lib/firefox* /usr/local/lib/firefox* /opt/firefox*; do
    [ -x "$d/firefox" ] && candidates+=("$d")
  done
  for d in "${candidates[@]}"; do
    if [ -x "$d/firefox" ] && [ -f "$d/omni.ja" ] && [ -f "$d/browser/omni.ja" ]; then
      printf '%s\n' "$d"
      return 0
    fi
  done
  return 1
}

# Process hygiene. The project directory contains 'brave'; so do the user's
# LibreOffice and Firefox sessions. Everything we start MUST be selected with an
# anchored pattern that only matches a throwaway profile under /tmp/ziy-*, or by
# a PID we recorded ourselves. Never `pkill -f firefox`, never `pkill firefox`.
ziy_pids_of() {
  pgrep -f "$1" 2>/dev/null || true
}

ziy_kill_throwaway() {
  # $1 = regex anchored on the throwaway profile path, e.g. '/tmp/ziy-.*profile'
  local pids
  pids="$(pgrep -f "$1" 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids="$(pgrep -f "$1" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

ziy_report_running() {
  local pids
  pids="$(pgrep -f '/tmp/ziy-.*profile' 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    echo "no Ziy throwaway processes running"
  else
    echo "still running: $pids"
  fi
}
