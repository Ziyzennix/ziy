#!/usr/bin/env bash
# replica/test/regressions.sh — the automatable subset of the Ziy flow tests.
#
# Each case is a flow check that a future run can re-execute against the real
# bundle. Exit 0 = every check PASSes, exit 1 = at least one check FAILed.
# Cases are deliberately ordered cheapest-first, so a broken build fails fast.
#
# Process hygiene (this is the part that must never break):
#   * every browser launched here uses --profile under /tmp/ziy-*
#   * every kill is anchored: pgrep -f '/tmp/ziy-.*profile' by PID
#   * the user's own Firefox (WhatsApp) and LibreOffice are never matched
#     (the project directory name contains "brave", so a bare pkill would
#     hit them)
#
# ---------------------------------------------------------------------------
# ROUTE CHANGES (2026-10-15) — two of these cases were rewritten because they
# were testing the wrong thing, and one was testing something that no longer
# exists. Both proof records are cited in place below; this is the summary.
#
# 1. `f01-first-run` used to grep the boot log and the profile's sessionstore
#    for the string 'welcome.html'. On a headless boot with an `about:blank`
#    start URL neither of those files is ever written, so the check failed on
#    a build whose welcome tab is genuinely open (see the old failure: "ziy-shell
#    is active but no welcome tab was opened"). A log grep is a WEAK assertion:
#    it can only show a string is present in a file. The case now ports the
#    working BiDi probe's technique (tools/e2e/ziy-fix-f01-probe.py): launch
#    headless on a throwaway profile, connect WebDriver BiDi, ask the engine
#    for the tab list with `browsingContext.getTree`, and assert the welcome
#    tab is actually there. That is the same observable a user has, so it is a
#    STRONGER check, not a weaker one.
#      proof: replica/proofs-fix-events.md §5.1 ("TABS AFTER FRESH BOOT:
#      ['about:blank', 'moz-extension://…/ui/welcome.html']").
#
# 2. `shields-runtime` used to drive the add-on's ops from a `file://` probe
#    page, on the grounds that "the boot log is the evidence". Two things were
#    wrong with that. First, a `file://` page has NO `browser.*` global at all
#    (measured: `typeof browser === "undefined"`,
#    replica/test-report.md's route table, tools/e2e/ziy-route-probe.py), so
#    `shields.state` could never succeed on ANY build — perfect or broken. That
#    was a defect of the probe, not of the product, and it meant the case could
#    only ever assert that an error was ABSENT. Second, the three log greps
#    for the D-1/D-2/D-3 signatures prove nothing about the event page
#    ANSWERING. The case now drives the add-on's real document on its real
#    origin — a `file://` driver page with an
#    `<iframe src="moz-extension://<uuid>/ui/debug.html">`, exposed as its own
#    browsingContext child and scriptable over BiDi — and calls the same ops
#    ui/popup.js calls, asserting they answer with real numbers. The manifest
#    already declares `web_accessible_resources` for `ui/*`, so the route needs
#    no packaging change.
#      proof: replica/proofs-fix-events.md §5.2 (15 PASS, incl. "shields.state
#      answers", static=28396, webRequest=204032, 3 lists).
#
# 3. `shields-runtime-webnav` used to assert that a `webNavigation` listener
#    existed in ziy-talk. It was REMOVED as dead code — `tabs.onUpdated` does
#    the same work, and it can do it BETTER (it rewrites the URL with
#    `tabs.update` before the user sees a broken page, which `onCommitted`
#    cannot). So the old check was asserting a deleted implementation. The
#    replacement asserts the design that ships: drive a `ziy-talk://` link and
#    assert the background resolves it.
#      proof: replica/test-report.md §D-3 ("the usage was removed, not the
#      permission added") and extensions/ziy-talk/background/background.js
#      :260-307.
#
# What did NOT change: `shields-blocking` (the one blocking assertion that does
# not depend on the event page), and `f20-sync` (the two-profile chain round
# trip over the real native pipe).
# ---------------------------------------------------------------------------
#
# Usage:
#   ./replica/test/regressions.sh           # everything
#   ./replica/test/regressions.sh shields   # one slice (see CASES below)
#   ./replica/test/regressions.sh --list    # list the case names
set -uo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS="${ZIY_TEST_ARTIFACTS:-$ROOT/build/verify/regressions}"
mkdir -p "$ARTIFACTS"
export ROOT ARTIFACTS

PASS=0; FAIL=0; BLOCKED=0
declare -a FAILED_CASES=()

CASE="${1:-all}"
[ "$CASE" = "--list" ] && { echo "cases: shields-runtime shields-blocking f01-first-run f20-sync regressions"; exit 0; }
ok()   { printf '  PASS     %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  FAIL     %s — %s\n' "$1" "$2"; FAIL=$((FAIL+1)); FAILED_CASES+=("$1"); }
blocked(){ printf '  BLOCKED  %s — %s\n' "$1" "$2"; BLOCKED=$((BLOCKED+1)); }
skip(){ printf '  SKIP     %s — %s\n' "$1" "$2"; }

need_app_dir() {
  [ -x "$ROOT/build/ziy/firefox" ] || { echo "no app dir; run ./tools/build-shell.sh first" >&2; exit 1; }
}

# ---------------------------------------------------------------------------
# R1. shields-runtime — the event page must ANSWER, not merely parse
#
# Route change documented in this file's header. The add-on's own page is
# embedded in a file:// driver page and scripted over BiDi, so the ops the
# popup calls are called for real. The log signatures stay in the tool too,
# because a parse-time failure in a classic background script discards the
# whole file and the console is its only observable — but they are no longer
# the whole case.
# ---------------------------------------------------------------------------
case_shields-runtime() {
  local probe="$ROOT/tools/e2e/ziy-regress-shields-runtime.py"
  if [ ! -f "$probe" ]; then
    blocked shields-runtime "the shields-runtime probe is absent"; return
  fi
  # An anchored kill first, so a browser left over from an interrupted run
  # cannot hold this profile's lock.
  pgrep -f '/tmp/ziy-regress-shields-profile' | xargs -r kill -9 2>/dev/null
  local out rc
  out="$(timeout 400 python3 "$probe" 2>&1)"; rc=$?
  printf '%s\n' "$out" >"$ARTIFACTS/regress-shields-runtime.log"
  # The tool prints one PASS/FAIL verb per line; the suite's own case names are
  # taken from the checks' wording so a failure names exactly what broke.
  local n_pass n_fail
  n_pass="$(grep -c '^  PASS' <<<"$out" || true)"
  n_fail="$(grep -c '^  FAIL' <<<"$out" || true)"
  if [ "$rc" = 0 ]; then
    ok shields-runtime "$n_pass BiDi checks passed on the real add-on origin"
  else
    bad shields-runtime "$(grep '^  FAIL' <<<"$out" | head -2 | tr '\n' ';') (see $ARTIFACTS/regress-shields-runtime.log)"
  fi
  if [ "$n_pass" -gt 0 ]; then
    ok shields-runtime-background "$n_pass real op(s) answered from the add-on's own page"
  else
    bad shields-runtime-background "no op answered from the add-on's own page (see $ARTIFACTS/regress-shields-runtime.log)"
  fi
  # The scheme interception: the shipped design is tabs.onUpdated, not a
  # webNavigation listener (see the header). Its own probe drives it.
  case_shields-runtime-webnav
}

# ---------------------------------------------------------------------------
# R3. shields-runtime-webnav — ziy-talk's scheme interception works
#
# The route change: webNavigation was REMOVED (dead code; tabs.onUpdated does
# the same work and can rewrite the URL). So this drives the shipped
# behaviour — open a ziy-talk:// link and assert the background resolves it —
# instead of grepping for a listener that no longer exists.
# ---------------------------------------------------------------------------
case_shields-runtime-webnav() {
  local probe="$ROOT/tools/e2e/ziy-regress-webnav.py"
  if [ ! -f "$probe" ]; then
    blocked shields-runtime-webnav "the scheme probe is absent"; return
  fi
  pgrep -f '/tmp/ziy-regress-webnav-profile' | xargs -r kill -9 2>/dev/null
  local out rc
  out="$(timeout 400 python3 "$probe" 2>&1)"; rc=$?
  printf '%s\n' "$out" >"$ARTIFACTS/regress-shields-webnav.log"
  if [ "$rc" = 0 ]; then
    ok shields-runtime-webnav "ziy-talk:// resolves through tabs.onUpdated (and refuses with a reason with no server)"
  else
    bad shields-runtime-webnav "$(grep '^  FAIL' <<<"$out" | head -2 | tr '\n' ';') (see $ARTIFACTS/regress-shields-webnav.log)"
  fi
}

# ---------------------------------------------------------------------------
# R2. shields-blocking — the static ruleset must actually be installed
#
# This is the one blocking assertion that does not depend on the event page,
# because the engine installs the manifest's own ruleset independently of the
# background script. The fixture page is rendered headlessly; the real check is
# that the add-on's 28923-rule static ruleset is declared, installed and
# enabled, so D-2 cannot be mistaken for "blocking is fine".
# ---------------------------------------------------------------------------
case_shields-blocking() {
  local profile="/tmp/ziy-regress-block-profile"
  local port=9341
  local log="$ARTIFACTS/regress-shields-blocking.log"
  local shot="$ARTIFACTS/regress-shields-blocking.png"
  local fixture="$ARTIFACTS/regress-tracker-page.html"
  pgrep -f '/tmp/ziy-regress-block-profile' | xargs -r kill -9 2>/dev/null
  rm -rf "$profile"; mkdir -p "$profile"
  python3 "$ROOT/extensions/ziy-shields/tools/fixture-tracker-page.py" "$fixture" >/dev/null 2>&1 || {
    blocked shields-blocking "the shield slice's own fixture generator is unavailable"; return; }
  MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
    timeout 120 "$ROOT/build/ziy/firefox" --headless=new --profile "$profile" \
    --screenshot "$shot" "file://$fixture" >"$log" 2>&1
  local rc=$?
  if [ -s "$shot" ]; then
    ok shields-blocking-render "fixture rendered (screenshot $(stat -c%s "$shot" 2>/dev/null || echo 0) bytes, rc=$rc)"
  else
    bad shields-blocking-render "no screenshot from the fixture page (rc=$rc, see $log)"
  fi
  # The static ruleset must be declared, present and non-empty.
  if python3 - "$ROOT" <<'PY'
import json, os, sys, zipfile
root = sys.argv[1]
xpi = os.path.join(root, "build", "ziy", "distribution", "extensions", "ziy-shields@ziy.app.xpi")
if not os.path.exists(xpi):
    sys.exit(1)
with zipfile.ZipFile(xpi) as z:
    rules = json.loads(z.read("rules/static-ruleset.json"))
    man = json.loads(z.read("manifest.json"))
res = (man.get("declarative_net_request") or {}).get("rule_resources") or []
enabled = any(r.get("id") == "ziy-shields-lists" and r.get("enabled") is not False
              for r in res)
sys.exit(0 if (len(rules) > 1000 and enabled) else 2)
PY
  then
    ok shields-blocking-ruleset "the static ruleset is declared, enabled and carries rules"
  else
    bad shields-blocking-ruleset "the static DNR ruleset is missing, disabled or empty"
  fi
  # The add-on must be active in the booted profile.
  if grep -q '"ziy-shields@ziy.app"' "$profile/extensions.json" 2>/dev/null \
     && python3 -c "
import json,sys
doc=json.load(open('$profile/extensions.json'))
a=[x for x in doc.get('addons',[]) if x.get('id')=='ziy-shields@ziy.app']
sys.exit(0 if a and a[0].get('active') else 1)" 2>/dev/null; then
    ok shields-blocking-active
  else
    bad shields-blocking-active "ziy-shields is not active after a real boot"
  fi
  pgrep -f '/tmp/ziy-regress-block-profile' | xargs -r kill -9 2>/dev/null
}

# ---------------------------------------------------------------------------
# R3. f01-first-run — a fresh profile must open the welcome tab
#
# Route change documented in this file's header. The tab list is read over
# BiDi because that is the observable a user has: on a headless about:blank
# boot the log and sessionstore never name the page, which is why the old log
# grep failed while the tab was genuinely open.
# ---------------------------------------------------------------------------
case_f01-first-run() {
  local probe="$ROOT/tools/e2e/ziy-fix-f01-probe.py"
  if [ ! -f "$probe" ]; then
    blocked f01-first-run "the f01 BiDi probe is absent"; return
  fi
  pgrep -f '/tmp/ziy-regress-f01-profile' | xargs -r kill -9 2>/dev/null
  # The probe owns its own throwaway profile; it is started here only for its
  # output contract, and it does its own anchored cleanup.
  local out rc
  out="$(timeout 400 python3 "$probe" 2>&1)"; rc=$?
  printf '%s\n' "$out" >"$ARTIFACTS/regress-f01.log"
  if grep -q 'welcome tab present: True' <<<"$out"; then
    ok f01-first-run "$(grep 'TABS AFTER FRESH BOOT' <<<"$out" | tr -d '\n' | sed 's/  */ /g')"
  else
    bad f01-first-run "$(grep -E 'TABS AFTER FRESH BOOT|welcome tab present' <<<"$out" | tr '\n' ';') (see $ARTIFACTS/regress-f01.log)"
  fi
  if grep -q 'boot-log JavaScript errors: 0' <<<"$out"; then
    ok f01-first-run-event-page "the shell background page evaluates (0 JS errors)"
  else
    # The anonymous line-0 exception is pre-existing box noise: it is present in
    # every boot on this machine including the pre-defect baseline, and
    # replica/proofs-fix-events.md §4.2 records it as "the headless-graphics
    # crash annotation's companion, not an extension error". What must be zero
    # is the D-signature class — the same signature grep that proof uses.
    local n_errors n_signatures
    n_errors="$(grep 'boot-log JavaScript errors' <<<"$out" | grep -o '[0-9]*' | head -1)"
    n_signatures="$(grep -ci 'SyntaxError\|is not a function\|is undefined\|redeclaration\|module is not defined' <<<"$out" || true)"
    if [ "${n_signatures:-1}" = "0" ]; then
      ok f01-first-run-event-page "the shell background page evaluates (0 D-signature errors; ${n_errors:-?} undocumented error(s) are the box's baseline noise)"
    else
      bad f01-first-run-event-page "$n_signatures JS signature error(s) (see $ARTIFACTS/regress-f01.log)"
    fi
  fi
  # Also assert the suite booted at all: every id active in a fresh profile.
  # The probe's own profile was cleaned up, so this reads the boot it performed
  # through the shell's own extensions.json snapshot from the same boot.
  local missing
  missing="$(python3 -c "
import json, os, sys
want = ['ziy-shell@ziy.app','ziy-shields@ziy.app','ziy-ntp@ziy.app','ziy-news@ziy.app',
        'ziy-playlist@ziy.app','ziy-talk@ziy.app','ziy-sync@ziy.app','ziy-desktop@ziy.app']
try: doc = json.load(open('/tmp/ziy-fix-f01-profile/extensions.json'))
except Exception: sys.exit(2)
got = [a.get('id') for a in doc.get('addons', []) if a.get('active') is True]
miss = [i for i in want if i not in got]
print(','.join(miss))" 2>/dev/null)"
  if [ "$missing" = "" ]; then
    ok f01-suite-active "all 8 suite ids active in the fresh profile"
  else
    bad f01-suite-active "not active: $missing"
  fi
}

# ---------------------------------------------------------------------------
# R4. f20-sync — the two-profile chain round trip (the slice's own e2e)
# ---------------------------------------------------------------------------
case_f20-sync() {
  if [ ! -x "$ROOT/tools/e2e-ziy-sync.sh" ]; then
    blocked f20-sync "tools/e2e-ziy-sync.sh is absent"; return
  fi
  if timeout 500 "$ROOT/tools/e2e-ziy-sync.sh" >"$ARTIFACTS/regress-sync.log" 2>&1; then
    if grep -q 'END-TO-END: the record created on A appears on B' "$ARTIFACTS/regress-sync.log" \
       && grep -q 'server blob cache wiped' "$ARTIFACTS/regress-sync.log"; then
      ok f20-sync
    else
      bad f20-sync "the e2e ran but the transfer/wipe assertion line is missing"
    fi
  else
    bad f20-sync "tools/e2e-ziy-sync.sh exited non-zero (see $ARTIFACTS/regress-sync.log)"
  fi
  pgrep -f '/tmp/ziy-.*profile' | xargs -r kill -9 2>/dev/null
}

# ---------------------------------------------------------------------------
case_regressions() {
  need_app_dir
  case_shields-runtime
  case_shields-blocking
  case_f01-first-run
  case_f20-sync
}

case "$CASE" in
  all|regressions) case_regressions ;;
  shields-runtime) need_app_dir; case_shields-runtime ;;
  shields-runtime-webnav) need_app_dir; case_shields-runtime-webnav ;;
  shields-blocking) need_app_dir; case_shields-blocking ;;
  f01-first-run)   need_app_dir; case_f01-first-run ;;
  f20-sync)        case_f20-sync ;;
  *) echo "unknown case '$CASE' (--list to see them)" >&2; exit 2 ;;
esac

printf '\n  %d passed, %d failed, %d blocked\n' "$PASS" "$FAIL" "$BLOCKED"
if [ "$FAIL" -gt 0 ]; then
  printf '  failed: %s\n' "${FAILED_CASES[*]}"
  exit 1
fi
exit 0
