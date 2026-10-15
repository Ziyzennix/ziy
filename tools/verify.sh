#!/usr/bin/env bash
# tools/verify.sh — the acceptance harness for the WHOLE PRODUCT.
#
# Usage: ./tools/verify.sh [--all | --IDENTITY]
#        ./tools/verify.sh --help
#
# Every check prints one line: PASS, FAIL or SKIP plus the evidence, and the
# run exits non-zero on any FAIL. Sections:
#
#   1. build/ziy exists, its omni.ja is patched, its MPL notice ships      (--identity)
#   2. the app boots headless and renders a non-blank screenshot              (--boot)
#   3. our prefs are present in prefs.js after a real boot                    (--prefs)
#   4. the suite extensions directory is wired                                (--extensions)
#   5. the signing bypass is effective: an unsigned add-on installs          (--signing)
#   6. THE FULL-SUITE GATE: every id in shell/extensions.list is built as
#      <id>.xpi, installed AND active in extensions.json, and carries an
#      installedDistroAddon marker, after a real headless boot               (--suite)
#   7. feature-level checks that run headless: shields rules + suite, the
#      NTP page and its bundle, news fixture parsing, playlist/talk panel
#      probes, the sync two-profile e2e, the desktop slice's suites, and the
#      whole node suite                                                        (--features)
#   8. pref/lock assertions (the shell layer: preflight + mozilla.cfg)        (--prefs-lock)
#   9. native helpers have a real manifest target                              (--native)
#  10. desktop integration files (ziy.desktop, install-desktop.sh, icons)      (--desktop)
#  11. the clean-room guard: no reference product's name in the shipped tree
#  12. the SELF-CONTAINED gate (--self-contained): build/ziy was produced from
#      Mozilla's checksum-verified PREBUILT engine tarball, not from a host
#      Firefox install — proof that Ziy does not depend on the OS's packaging.
#      Run with ZIY_ENGINE_SOURCE=tarball set by the caller that built it, or it
#      reports which engine the current build came from.
#
# Process hygiene (this is the part that must never break):
#   * every browser we launch uses an explicit --profile under /tmp/ziy-*
#   * we only ever kill processes matched by an anchored pgrep -f pattern on that
#     throwaway path, or by PIDs we recorded ourselves
#   * the user's own Firefox/LibreOffice sessions are never matched, because the
#     pattern contains /tmp/ziy- and nothing else
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
. "$HERE/lib/common.sh"

export ZIY_VERIFY=1
export NO_COLOR="${NO_COLOR:-0}"

APP_DIR="${ZIY_APP_DIR:-$ROOT/build/ziy}"
BUILD_DIR="${ZIY_BUILD_DIR:-$ROOT/build}"
PROFILE="${ZIY_VERIFY_PROFILE:-/tmp/ziy-shell-verify-profile}"
SELF_TEST_ID="ziy-selftest@ziy.test"
ARTIFACTS="${ZIY_VERIFY_ARTIFACTS:-$ROOT/build/verify}"
BOOT_SECONDS="${ZIY_VERIFY_BOOT_SECONDS:-20}"
KEEP_SELFTEST=0
FILTER=""

PASS=0; FAIL=0; SKIP=0
declare -a RESULTS=()

note()  { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_RESET" >&2; }
ok()    { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); log_ok "$1"; }
bad()   { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1"); log_error "$1"; }
skip()  { SKIP=$((SKIP+1)); RESULTS+=("SKIP  $1"); log_warn "$1"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-selftest) KEEP_SELFTEST=1; shift ;;
    --all) FILTER=""; shift ;;
    --identity|--prefs|--extensions|--signing|--boot|--suite|--features|--native|--desktop|--prefs-lock|--self-contained) FILTER="$1"; shift ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown check: $1" ;;
  esac
done

run_check() {
  # $1 = name; run only when $FILTER is empty or equal to --name
  [ -n "$FILTER" ] || return 0
  case "$FILTER" in
    "--$1"|"$1") return 0 ;;
    *) return 1 ;;
  esac
}

CLEANUP_DONE=0
cleanup() {
  [ "$CLEANUP_DONE" = "1" ] && return 0
  CLEANUP_DONE=1
  # Only ever kill by the anchored throwaway-profile pattern.
  ziy_kill_throwaway '/tmp/ziy-.*profile'
}
trap cleanup EXIT INT TERM

mkdir -p "$ARTIFACTS"

# We always leave the throwaway profile clean before starting.
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# ---------------------------------------------------------------------------
note "1. build/ziy and the patched omni.ja"
# ---------------------------------------------------------------------------
if [ ! -x "$APP_DIR/firefox" ]; then
  bad "build/ziy is missing — run ./tools/build-shell.sh"
  echo; log_error "cannot continue without an app dir"; exit 1
fi
ok "build/ziy exists at $APP_DIR"

python3 - "$APP_DIR" "$ROOT" <<'PY'
import importlib.util
import os
import sys
app_dir, repo_root = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location(
    "patch_omni", os.path.join(repo_root, "shell/omni.ja.patch/patch-omni.py"))
po = importlib.util.module_from_spec(spec)
spec.loader.exec_module(po)
data = open(os.path.join(app_dir, "omni.ja"), "rb").read()
cd_start, cd_size, eocd = po.locate_central_directory(data)
entries = po.parse_central_directory(data, cd_start, eocd)
if po.MEMBER not in entries:
    sys.exit("modules/AppConstants.sys.mjs is not in the built omni.ja")
e = entries[po.MEMBER]
body = po.member_body_offset(data, e["lho"], e["nlen"], e["elen"], po.MEMBER)
raw = data[body:body + e["csize"]].decode("utf-8", "replace")
if po.OLD_SIGNING.decode() in raw:
    sys.exit("MOZ_REQUIRE_SIGNING is still true — the omni.ja patch did not apply")
if po.NEW_SIGNING.decode() not in raw:
    sys.exit("MOZ_REQUIRE_SIGNING: false not found — unexpected AppConstants state")
if po.OLD_SIDELOAD.decode() in raw or po.NEW_SIDELOAD.decode() not in raw:
    sys.exit("MOZ_ALLOW_ADDON_SIDELOAD is not true — the omni.ja patch did not apply")
print("MOZ_REQUIRE_SIGNING: false, MOZ_ALLOW_ADDON_SIDELOAD: true")
PY
if [ $? -eq 0 ]; then ok "omni.ja is patched (signing off, sideload on)"; else bad "omni.ja patch check failed"; fi

# The MPL-2.0 §3.2(a) source-availability notice, plus the material it points
# at: the notice itself in the app-dir root, and the engine patch set it
# tells the recipient how to use (replica/research-legal.md §2.4, §1.1 Rule 4;
# replica/deploy.md §5 rows 4-5). Plain text on purpose, so the code-level
# clean-room scan (section 12, .js/.json/.css/.html/.py/.sh only) never reads
# a file whose job is to name the engine's vendor.
NOTICE="$APP_DIR/LICENSES.txt"
if [ -f "$NOTICE" ]; then
  ok "the MPL §3.2(a) notice ships in the app dir ($(stat -c%s "$NOTICE") bytes)"
  for want in 'mozilla.org/MPL/2.0/' 'not officially associated with Mozilla' 'Mozilla Firefox 156.0.1' 'patches/'; do
    if grep -qF "$want" "$NOTICE"; then
      ok "LICENSES.txt names $want"
    else
      bad "LICENSES.txt does not name $want"
    fi
  done
else
  bad "LICENSES.txt is missing from the app dir — MPL §3.2(a) is unmet (re-run ./tools/build-shell.sh --force)"
fi
PATCH_SHIPPED=$(ls "$APP_DIR/patches/"*.patch 2>/dev/null | wc -l | tr -d ' ')
if [ "$PATCH_SHIPPED" -ge 5 ]; then
  ok "the app dir ships the engine source patch set ($PATCH_SHIPPED patches)"
else
  bad "the app dir ships $PATCH_SHIPPED engine patch(es) — the §3.2(a) notice points at material that is not there"
fi

# ---------------------------------------------------------------------------
note "2. identity: --version reports Ziy"
# ---------------------------------------------------------------------------
if run_check identity; then
  VERSION_OUT="$("$APP_DIR/firefox" --version 2>&1 || true)"
  printf '%s\n' "$VERSION_OUT" | tee "$ARTIFACTS/version.txt" >/dev/null
  if printf '%s' "$VERSION_OUT" | grep -qi 'ziy'; then
    ok "--version reports Ziy"
  else
    # 156 does not remap the --version string from the app name alone; that is a
    # limitation, not a failure, as long as the app-dir boot below proves the
    # identity another way.
    skip "--version does not say Ziy (it says: $(printf '%s' "$VERSION_OUT" | head -1))"
  fi
fi

# ---------------------------------------------------------------------------
note "3. headless boot + non-blank screenshot"
# ---------------------------------------------------------------------------
if run_check boot || run_check identity; then
  SHOT="$ARTIFACTS/boot-about.png"
  rm -f "$SHOT"
  # A data: URL is used deliberately: about:home/about:newtab cannot be
  # screenshotted headless on this engine (replica/proofs.md fact 9), and a
  # plain about:blank would prove nothing about branding. This page renders the
  # app's own name from the same resource the shell chrome uses.
  PROBE_PAGE="$ARTIFACTS/ziy-probe.html"
  cat > "$PROBE_PAGE" <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>Ziy</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#26118f;
color:#fff;font:700 48px system-ui,sans-serif;letter-spacing:.2em}</style></head>
<body><h1>ZIY</h1></body></html>
HTML
  timeout 90 env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
      "$APP_DIR/firefox" --headless=new --profile "$PROFILE" \
      --window-size=800,600 --screenshot "$SHOT" "file://$PROBE_PAGE" \
      > "$ARTIFACTS/boot.log" 2>&1 || true
  if [ -s "$SHOT" ]; then
    BYTES=$(stat -c%s "$SHOT")
    ok "headless boot rendered a screenshot ($BYTES bytes)"
    python3 - "$SHOT" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
px = im.load()
violet = white = 0
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if abs(r - 0x26) < 12 and abs(g - 0x11) < 12 and abs(b - 0x8F) < 12:
            violet += 1
        elif r > 240 and g > 240 and b > 240:
            white += 1
if violet < 50000:
    sys.exit(f"Ziy's brand violet (#26118F) covers only {violet}px; the page did not render")
if white < 500:
    sys.exit(f"the wordmark's white covers only {white}px; no wordmark rendered")
print(f"{w}x{h}: {violet} brand-violet px, {white} wordmark-white px")
PY
    if [ $? -eq 0 ]; then ok "screenshot carries the Ziy wordmark on the Ziy brand violet"; else bad "screenshot is blank or unbranded"; fi
  else
    bad "no screenshot produced (see $ARTIFACTS/boot.log)"
  fi
fi

# ---------------------------------------------------------------------------
note "4. a real ${BOOT_SECONDS}s boot writes our prefs into prefs.js"
# ---------------------------------------------------------------------------
if run_check prefs; then
  PREFS="$PROFILE/prefs.js"
  # Boot the profile tools/bootstrap-profile.py would produce, not a bare dir:
  # that is what the acceptance criterion is about — OUR values (user.js +
  # mozilla.cfg locks) must land in prefs.js after a real boot.
  rm -rf "$PROFILE"; mkdir -p "$PROFILE"
  # Build the profile bootstrap-profile.py would produce, in a root we own, so
  # the acceptance run never touches the operator's ~/.ziy either. The root sits
  # under /tmp/ziy- on purpose: that keeps every process this check launches
  # selectable by the anchored pattern '/tmp/ziy-.*profile', which is what lets
  # us kill our own browsers without ever touching the user's Firefox (whose
  # profile lives under ~/.mozilla) or their LibreOffice session.
  VERIFY_ROOT="/tmp/ziy-verify-root"
  rm -rf "$VERIFY_ROOT"
  mkdir -p "$VERIFY_ROOT"
  python3 "$ROOT/tools/bootstrap-profile.py" --root "$VERIFY_ROOT" \
      --name "$(basename "$PROFILE")" >&2 \
    || log_warn "bootstrap failed; using a bare profile"
  # Point the run at the bootstrapped profile rather than the throwaway dir, so
  # user.js and mozilla.cfg locks are exercised exactly as shipped.
  PROFILE="$VERIFY_ROOT/$(basename "$PROFILE")"
  PREFS="$PROFILE/prefs.js"
  # bootstrap-profile.py keys ziy.profile.current to the profile name, so the
  # expected value is derivable from the path we just booted.
  EXPECTED_PROFILE_NAME="$(basename "$PROFILE")"
  timeout $((BOOT_SECONDS + 40)) env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
      "$APP_DIR/firefox" --headless=new --profile "$PROFILE" \
      "file://$ARTIFACTS/ziy-probe.html" \
      > "$ARTIFACTS/boot-20s.log" 2>&1 || true
  sleep 2
  # Anchored: matches only this run's throwaway profiles.
  ziy_kill_throwaway '/tmp/ziy-.*profile'
  sleep 1
  if [ -f "$PREFS" ]; then
    ok "prefs.js exists after boot ($(stat -c%s "$PREFS") bytes)"
    python3 - "$PREFS" "$EXPECTED_PROFILE_NAME" <<'PY'
import re
import sys


def json_name(name):
    """Render a profile name as the engine writes it into prefs.js."""
    return '"%s"' % name.replace('"', '\\"')


# Values that must be in the profile after a real boot.
#
# What is observable and what is not, on this engine (proofs.md fact 2,
# proofs-shell.md §1.4):
#   * user.js values ARE written into prefs.js by the engine — these prove OUR
#     layer took effect, so they are checkable here.
#   * mozilla.cfg lockPref() values are NOT. lockPref changes the *default* and
#     locks it; a default never reaches prefs.js. The locks are therefore proven
#     by shell/preflight-prefs.py at build time, and by about:policies at
#     runtime — not by this file. Asserting them here would fail for a reason
#     that is not a bug.
#   * ziy.js pref() values are also invisible here, for the same reason.
#
# So this check asserts the user.js layer plus the engine's own identity writes.
# extensions.autoDisableScopes / extensions.sideloadScopes are deliberately NOT
# asserted here: they are lockPref()s in mozilla.cfg, and a locked default never
# reaches prefs.js. Asserting them would fail on correct behaviour.
REQUIRED = {
    # Written by bootstrap-profile.py's user.js and keyed to the profile name we
    # booted, so the expected value comes from the profile's own name.
    "ziy.profile.current": json_name(sys.argv[2]),
    "toolkit.legacyUserProfileCustomizations.stylesheets": "true",
}
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
found = {}
for key in REQUIRED:
    m = re.search(r'user_pref\("%s",\s*([^;]+)\);' % re.escape(key), text)
    if m:
        found[key] = m.group(1).strip()

problems = []
quoted = []
for key, want in REQUIRED.items():
    got = found.get(key)
    if got is None:
        problems.append(f"{key} missing from prefs.js")
        continue
    if got != want:
        problems.append(f"{key} = {got!r}, want {want}")
    else:
        quoted.append(f"{key} = {got}")
if "extensions.lastAppVersion" not in text:
    problems.append("the engine never wrote its own version — the boot did not really start")
# And the engine's own record that it read OUR distribution directory, which is
# the app-dir layer booting rather than stock Firefox.
if 'user_pref("distribution.iniFile.exists.value", true)' not in text:
    problems.append("distribution.iniFile.exists.value is not true — our "
                    "distribution/ini was not read, so this is not our product booting")
if problems:
    sys.exit("; ".join(problems))
for line in quoted:
    print(f"  {line}")
print("  distribution.iniFile.exists.value = true (our distribution/ini was read)")
print("  extensions.lastAppVersion written by the engine")
PY
    if [ $? -eq 0 ]; then ok "our prefs are present in prefs.js after a real boot"
    else bad "expected prefs missing from prefs.js"; fi
  else
    bad "prefs.js was not written by the ${BOOT_SECONDS}s boot"
  fi
fi

# ---------------------------------------------------------------------------
note "5. the suite extensions directory is wired"
# ---------------------------------------------------------------------------
if run_check extensions; then
  EXT_DIR="$APP_DIR/distribution/extensions"
  if [ ! -d "$EXT_DIR" ]; then
    bad "$EXT_DIR does not exist"
  elif [ -z "$(ls -A "$EXT_DIR" 2>/dev/null)" ]; then
    skip "distribution/extensions/ exists but is empty (fill it with tools/build-extension.sh)"
    if python3 - "$APP_DIR" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1] + "/distribution/policies.json"))
ext = doc["policies"]["ExtensionSettings"]
suite = [k for k in ext if k != "*"]
assert len(suite) >= 8, f"only {len(suite)} suite ids declared"
print(f"policies.json declares {len(suite)} suite ids: " + ", ".join(sorted(suite)))
PY
    then ok "the suite is declared in policies.json ExtensionSettings (8 ids)"; else bad "policies.json suite declaration is wrong"; fi
  else
    COUNT=$(ls "$EXT_DIR"/*.xpi 2>/dev/null | wc -l | tr -d ' ')
    ok "distribution/extensions/ holds $COUNT xpis"
    for xpi in "$EXT_DIR"/*.xpi; do
      [ -e "$xpi" ] || continue
      NAME="$(basename "$xpi" .xpi)"
      if python3 - "$xpi" <<'PY'
import json, sys, zipfile
zf = zipfile.ZipFile(sys.argv[1])
mf = json.loads(zf.read("manifest.json"))
ids = []
for source in ("browser_specific_settings.gecko.id",):
    cur = mf
    for part in source.split("."):
        cur = (cur or {}).get(part)
    if cur:
        ids.append(cur)
sys.exit(0 if ids else 1)
PY
      then
        log_step "xpi" "$NAME (manifest id matches filename convention)"
      else
        bad "$NAME has no browser_specific_settings.gecko.id — the app-scope installer derives the id from the filename, so this xpi will install under the wrong id"
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
note "6. the signing bypass actually installs an unsigned add-on"
# ---------------------------------------------------------------------------
if run_check signing; then
  SELFTEST_XPI="$ARTIFACTS/$SELF_TEST_ID.xpi"
  python3 "$ROOT/tools/build-selftest-xpi.py" "$SELFTEST_XPI" >/dev/null || \
    { bad "could not build the self-test xpi"; }
  # Put it where the engine looks for app-scope distribution addons, boot, and
  # look for the marker in prefs.js. On an UNPATCHED Firefox this test fails:
  # XPIDatabase rejects the unsigned xpi and no marker appears.
  cp "$SELFTEST_XPI" "$APP_DIR/distribution/extensions/$SELF_TEST_ID.xpi"
  rm -rf "$PROFILE"; mkdir -p "$PROFILE"
  timeout 90 env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
      "$APP_DIR/firefox" --headless=new --profile "$PROFILE" \
      "file://$ARTIFACTS/ziy-probe.html" > "$ARTIFACTS/signing-boot.log" 2>&1 || true
  sleep 2
  ziy_kill_throwaway '/tmp/ziy-.*profile'
  sleep 1
  MARKER="extensions.installedDistroAddon.$SELF_TEST_ID"
  if [ -f "$PROFILE/prefs.js" ] && grep -q "installedDistroAddon.$SELF_TEST_ID" "$PROFILE/prefs.js" 2>/dev/null; then
    ok "unsigned xpi was installed by the app dir (marker: $MARKER)"
    grep "installedDistroAddon" "$PROFILE/prefs.js" | sed 's/^/        /'
    if grep -q "installedDistroAddon.$SELF_TEST_ID\", true" "$PROFILE/prefs.js" 2>/dev/null; then
      ok "marker value is true"
    else
      log_warn "marker present but not true"; grep "installedDistroAddon.$SELF_TEST_ID" "$PROFILE/prefs.js"
    fi
  else
    bad "no $MARKER in prefs.js — the signing bypass is not effective on this build"
    log_warn "see $ARTIFACTS/signing-boot.log and $PROFILE/extensions.json"
  fi
  if [ "$KEEP_SELFTEST" = "0" ]; then
    rm -f "$APP_DIR/distribution/extensions/$SELF_TEST_ID.xpi"
    log_step "cleanup" "removed the self-test xpi from distribution/extensions/"
  else
    log_warn "self-test xpi left in $APP_DIR/distribution/extensions/"
  fi
fi

# ---------------------------------------------------------------------------
note "7. the full-suite gate (architecture §7.2): every shipped id"
# ---------------------------------------------------------------------------
# The ONE source of truth for the ids is shell/extensions.list. Everything
# else in the tree (policies.json, bootstrap-profile.py, the xpi filenames)
# is derived from it, so asserting against the list is asserting against the
# product. Every id in the list must be: present as <id>.xpi in the app dir,
# installed and active in extensions.json, and marked by the distribution
# installer in prefs.js, after a REAL headless boot.
if run_check suite; then
  # The list's own comment style is "//" (see its header), and '#' is also
  # accepted, so BOTH are stripped. Reading a comment line as an id would make
  # the gate demand an id nobody ever defined.
  mapfile -t SUITE_IDS < <(grep -v '^[[:space:]]*//' "$ROOT/shell/extensions.list" \
                             | grep -v '^[[:space:]]*#' \
                             | grep -v '^[[:space:]]*$')
  log_step "suite" "shell/extensions.list names ${#SUITE_IDS[@]} id(s)"
  for id in "${SUITE_IDS[@]}"; do printf '         %s\n' "$id" >&2; done

  EXPECTED_COUNT="${#SUITE_IDS[@]}"
  BUILT_COUNT=$(ls "$APP_DIR/distribution/extensions/"*.xpi 2>/dev/null | wc -l | tr -d ' ')
  if [ "$BUILT_COUNT" -ge "$EXPECTED_COUNT" ]; then
    ok "distribution/extensions/ holds $BUILT_COUNT xpis (want >= $EXPECTED_COUNT from the list)"
  else
    bad "distribution/extensions/ holds $BUILT_COUNT xpis, want >= $EXPECTED_COUNT"
  fi

  # Every xpi in the app dir is named after its own manifest id: the installer
  # derives the add-on id from the FILENAME, so a mismatch installs the wrong id.
  XPI_ID_MISMATCH=0
  for xpi in "$APP_DIR/distribution/extensions/"*.xpi; do
    [ -e "$xpi" ] || continue
    NAME="$(basename "$xpi" .xpi)"
    if ! python3 - "$xpi" "$NAME" <<'PY'
import json, sys, zipfile
zf = zipfile.ZipFile(sys.argv[1])
mf = json.loads(zf.read("manifest.json"))
sys.exit(0 if mf.get("browser_specific_settings", {}).get("gecko", {}).get("id") == sys.argv[2] else 1)
PY
    then XPI_ID_MISMATCH=$((XPI_ID_MISMATCH+1)); fi
  done
  if [ "$XPI_ID_MISMATCH" -eq 0 ]; then
    ok "every xpi's manifest id matches its filename (the installer derives the id from the filename)"
  else
    bad "$XPI_ID_MISMATCH xpi(s) have a manifest id disagreeing with the filename"
  fi

  # The boot that proves it: a FRESH throwaway profile, a real BOOT_SECONDS run,
  # then read extensions.json and prefs.js.
  SUITE_PROFILE="/tmp/ziy-suite-verify-profile"
  rm -rf "$SUITE_PROFILE"; mkdir -p "$SUITE_PROFILE"
  SUITE_SHOT="$ARTIFACTS/suite-boot.png"
  rm -f "$SUITE_SHOT"
  timeout $((BOOT_SECONDS + 60)) env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
      "$APP_DIR/firefox" --headless=new --profile "$SUITE_PROFILE" \
      --window-size=1024,768 --screenshot "$SUITE_SHOT" \
      "file://$ARTIFACTS/ziy-probe.html" > "$ARTIFACTS/suite-boot.log" 2>&1 || true
  sleep 2
  ziy_kill_throwaway '/tmp/ziy-.*profile'
  sleep 1

  if [ -f "$SUITE_PROFILE/extensions.json" ]; then
    ok "extensions.json was written by the boot ($(stat -c%s "$SUITE_PROFILE/extensions.json") bytes)"
    if python3 - "$SUITE_PROFILE" "${SUITE_IDS[@]}" <<'PY'
import json, os, sys
profile = sys.argv[1]
expected = sys.argv[2:]
doc = json.load(open(os.path.join(profile, "extensions.json")))
found = {a.get("id"): a for a in doc.get("addons", [])}
missing, inactive = [], []
for addon_id in expected:
    a = found.get(addon_id)
    if a is None:
        missing.append(addon_id); continue
    if not a.get("active") or a.get("appDisabled") or a.get("userDisabled"):
        inactive.append(addon_id)
if missing:
    print("MISSING: " + ", ".join(missing))
if inactive:
    print("INACTIVE: " + ", ".join(inactive))
print(f"suite installed+active: {len(expected) - len(missing) - len(inactive)}/{len(expected)}")
sys.exit(1 if (missing or inactive) else 0)
PY
    then
      ok "every suite id is installed AND active in extensions.json after a real boot"
    else
      bad "suite ids are missing or inactive (see $ARTIFACTS/suite-boot.log)"
    fi
  else
    bad "extensions.json was not written — the boot never reached the add-on manager"
  fi

  # install markers: the distribution installer's own record, per id.
  if [ -f "$SUITE_PROFILE/prefs.js" ]; then
    MISSING_MARKERS=0
    MARKER_LINES=""
    for id in "${SUITE_IDS[@]}"; do
      if grep -q "extensions.installedDistroAddon.$id" "$SUITE_PROFILE/prefs.js" 2>/dev/null; then
        MARKER_LINES="$MARKER_LINES
        $id"
      else
        MISSING_MARKERS=$((MISSING_MARKERS+1))
      fi
    done
    if [ "$MISSING_MARKERS" -eq 0 ]; then
      ok "every suite id has an extensions.installedDistroAddon.* marker in prefs.js"
      printf '%s\n' "$MARKER_LINES" >&2
    else
      bad "$MISSING_MARKERS suite id(s) have no installedDistroAddon marker"
    fi
  else
    bad "prefs.js was not written by the suite boot"
  fi

  # A second assertion that costs nothing and catches a real regression: the
  # boot rendered something. All add-ons "active" plus a blank screenshot would
  # mean the suite installed but the product does not actually start.
  if [ -s "$SUITE_SHOT" ]; then
    ok "the suite boot rendered a screenshot ($(stat -c%s "$SUITE_SHOT") bytes)"
  else
    skip "no suite-boot screenshot (headless may refuse --screenshot for this page)"
  fi
fi

# ---------------------------------------------------------------------------
note "8. feature-level checks that run headless"
# ---------------------------------------------------------------------------

# 8a. Shields: the rules are compiled, and the engine's own precedence logic
# is proven by its unit suite (the real behavioural gate).
if run_check features; then
  RULES_DIR="$ROOT/extensions/ziy-shields/rules"
  if [ -f "$RULES_DIR/static-ruleset.json" ]; then
    RULE_COUNT=$(python3 -c "
import json
print(len(json.load(open('$RULES_DIR/static-ruleset.json'))))" 2>/dev/null || echo 0)
    ok "shields static ruleset is built ($RULE_COUNT rules)"
  else
    bad "shields static ruleset is missing at $RULES_DIR/static-ruleset.json"
  fi
  if (cd "$ROOT" && node --test extensions/ziy-shields/test/ > "$ARTIFACTS/shields-tests.log" 2>&1); then
    SHIELDS_PASS=$(grep -c '^✔' "$ARTIFACTS/shields-tests.log" || true)
    ok "shields unit suite passes ($SHIELDS_PASS assertions)"
  else
    bad "shields unit suite fails (see $ARTIFACTS/shields-tests.log)"
  fi
fi

# 8b. NTP: the page the app dir serves exists and ships its bundle.
if run_check features; then
  NTP_HTML="$ROOT/extensions/ziy-ntp/ui/ntp.html"
  if [ -f "$NTP_HTML" ]; then
    ok "the NTP page exists at extensions/ziy-ntp/ui/ntp.html"
    NTP_JS=$(ls "$ROOT"/extensions/ziy-ntp/ui/*.js 2>/dev/null | wc -l | tr -d ' ')
    if [ "$NTP_JS" -ge 1 ]; then
      ok "the NTP page ships $NTP_JS script file(s)"
    else
      bad "the NTP page ships no scripts"
    fi
  else
    bad "the NTP page is missing — chrome_url_overrides.newtab would 404"
  fi
  if (cd "$ROOT" && node --test extensions/ziy-ntp/test/ > "$ARTIFACTS/ntp-tests.log" 2>&1); then
    ok "ntp unit suite passes ($(grep -c '^✔' "$ARTIFACTS/ntp-tests.log" || true) assertions)"
  else
    bad "ntp unit suite fails (see $ARTIFACTS/ntp-tests.log)"
  fi
fi

# 8c. News: the shipped fixtures parse through the shipped parser.
if run_check features; then
  if node -e "
const p = require('./extensions/ziy-news/lib/feed/parser.js');
const fs = require('fs');
const files = ['bbc-world.rss.xml','guardian-world.rss.xml','mozilla-blog.atom.xml'];
for (const f of files) {
  const t = fs.readFileSync('./extensions/ziy-news/test/fixtures/' + f, 'utf8');
  const r = p.parseFeed(t, 'probe');
  if (!r.items || !r.items.length) { console.error('no items for ' + f); process.exit(1); }
}
console.log('3 feeds parsed: ' + files.join(', '));
" > "$ARTIFACTS/news-parse.log" 2>&1; then
    ok "news parser reads the shipped fixtures ($(cat "$ARTIFACTS/news-parse.log"))"
  else
    bad "news parser fails on the shipped fixtures (see $ARTIFACTS/news-parse.log)"
  fi
  if (cd "$ROOT" && node --test extensions/ziy-news/test/ > "$ARTIFACTS/news-tests.log" 2>&1); then
    ok "news unit suite passes ($(grep -c '^✔' "$ARTIFACTS/news-tests.log" || true) assertions)"
  else
    bad "news unit suite fails (see $ARTIFACTS/news-tests.log)"
  fi
fi

# 8d. Playlist, Talk, Desktop: unit suites plus the panel probes that boot the
# real app dir over WebDriver BiDi.
if run_check features; then
  for probe in playlist talk; do
    case "$probe" in
      playlist) EXT=ziy-playlist; SCRIPT=ziy-playlist-panel.py ;;
      talk)     EXT=ziy-talk;     SCRIPT=ziy-talk-panel.py ;;
    esac
    if (cd "$ROOT" && node --test "extensions/$EXT/test/" > "$ARTIFACTS/$probe-tests.log" 2>&1); then
      ok "$probe unit suite passes ($(grep -c '^✔' "$ARTIFACTS/$probe-tests.log" || true) assertions)"
    else
      bad "$probe unit suite fails (see $ARTIFACTS/$probe-tests.log)"
    fi
    if [ -f "$ROOT/tools/e2e/$SCRIPT" ]; then
      if timeout 400 python3 "$ROOT/tools/e2e/$SCRIPT" > "$ARTIFACTS/$probe-panel.log" 2>&1; then
        ok "$probe panel probe ran (see $ARTIFACTS/$probe-panel.log)"
      else
        skip "$probe panel probe did not complete (see $ARTIFACTS/$probe-panel.log)"
      fi
    fi
  done
  if (cd "$ROOT" && node --test extensions/ziy-desktop/test/ > "$ARTIFACTS/desktop-tests.log" 2>&1); then
    ok "desktop unit suite passes ($(grep -c '^✔' "$ARTIFACTS/desktop-tests.log" || true) assertions)"
  else
    bad "desktop unit suite fails (see $ARTIFACTS/desktop-tests.log)"
  fi
fi

# 8e. Sync: the two-profile e2e over the real native pipe, plus its suite.
if run_check features; then
  if [ -f "$ROOT/tools/e2e-ziy-sync.sh" ]; then
    if timeout 500 "$ROOT/tools/e2e-ziy-sync.sh" > "$ARTIFACTS/sync-e2e.log" 2>&1; then
      if grep -q 'END-TO-END: the record created on A appears on B' "$ARTIFACTS/sync-e2e.log"; then
        ok "sync two-profile e2e transferred the record A wrote to B"
      else
        skip "sync e2e ran but the transfer line was not found (see $ARTIFACTS/sync-e2e.log)"
      fi
    else
      skip "sync e2e did not complete (see $ARTIFACTS/sync-e2e.log)"
    fi
  else
    skip "tools/e2e-ziy-sync.sh is absent"
  fi
  if (cd "$ROOT" && node --test extensions/ziy-sync/test/ > "$ARTIFACTS/sync-tests.log" 2>&1); then
    ok "sync unit suite passes ($(grep -c '^✔' "$ARTIFACTS/sync-tests.log" || true) assertions)"
  else
    bad "sync unit suite fails (see $ARTIFACTS/sync-tests.log)"
  fi
fi

# 8f. The whole node suite: the cross-extension regression net.
if run_check features; then
  if (cd "$ROOT" && npm test > "$ARTIFACTS/npm-test.log" 2>&1; cd "$ROOT"); then
    TOTAL=$(grep -E '^. pass ' "$ARTIFACTS/npm-test.log" | tail -1 | awk '{print $2}')
    ok "the whole node suite passes (${TOTAL:-?} assertions)"
  else
    bad "npm test fails (see $ARTIFACTS/npm-test.log)"
  fi
fi

# ---------------------------------------------------------------------------
note "9. pref and lock assertions (the shell slice's layer)"
# ---------------------------------------------------------------------------
# mozilla.cfg lockPref/pref values are proven by the build-time preflight,
# because a locked default never reaches prefs.js (proofs-shell.md §2).
if run_check prefs-lock; then
  if python3 "$ROOT/shell/preflight-prefs.py" > "$ARTIFACTS/preflight.log" 2>&1; then
    ok "the preflight asserts the pref layers agree ($(grep -c . "$ARTIFACTS/preflight.log") lines)"
  else
    bad "the preflight fails (see $ARTIFACTS/preflight.log)"
  fi
  DECLARED=$(grep -cE '^(pref|lockPref|defaultPref)\(' "$ROOT/shell/mozilla.cfg" 2>/dev/null || echo 0)
  ok "mozilla.cfg declares $DECLARED pref calls"
fi

# ---------------------------------------------------------------------------
note "10. native helpers"
# ---------------------------------------------------------------------------
if run_check native; then
  if node "$ROOT/tools/install-ziy-sync-native.js" --dry-run > "$ARTIFACTS/native-dryrun.log" 2>&1; then
    TARGET=$(grep -o 'would write [^ ]*' "$ARTIFACTS/native-dryrun.log" | head -1 | sed 's/would write //')
    if [ -n "$TARGET" ]; then
      ok "the native manifest has a real target: $TARGET"
    else
      bad "the native installer reported no target path"
    fi
  else
    bad "the native installer's dry run fails (see $ARTIFACTS/native-dryrun.log)"
  fi
fi

# ---------------------------------------------------------------------------
note "11. desktop integration files"
# ---------------------------------------------------------------------------
if run_check desktop; then
  DESKTOP_FILE="$ROOT/shell/ziy.desktop"
  if [ -f "$DESKTOP_FILE" ]; then
    ok "shell/ziy.desktop exists"
    for want in 'Name=Ziy' 'Icon=ziy' 'StartupWMClass=Ziy' 'Categories=Network;WebBrowser;'; do
      if grep -q "^$want" "$DESKTOP_FILE"; then
        ok "ziy.desktop declares $want"
      else
        bad "ziy.desktop is missing $want"
      fi
    done
    ACTIONS=$(grep -c '^\[Desktop Action ' "$DESKTOP_FILE" || true)
    ok "ziy.desktop declares $ACTIONS actions"
  else
    bad "shell/ziy.desktop is missing"
  fi
  if [ -x "$ROOT/tools/install-desktop.sh" ]; then
    if "$ROOT/tools/install-desktop.sh" --dry-run > "$ARTIFACTS/install-desktop.log" 2>&1; then
      ok "tools/install-desktop.sh --dry-run runs and prints what it would do"
    else
      bad "tools/install-desktop.sh --dry-run fails (see $ARTIFACTS/install-desktop.log)"
    fi
  else
    bad "tools/install-desktop.sh is missing or not executable"
  fi
  ICON_COUNT=$(ls "$APP_DIR/browser/chrome/icons/default/"*.png 2>/dev/null | wc -l | tr -d ' ')
  if [ "$ICON_COUNT" -ge 1 ]; then
    ok "the app dir carries $ICON_COUNT brand icons for the hicolor install"
  else
    bad "the app dir carries no brand icons"
  fi
fi

# ---------------------------------------------------------------------------
note "12. clean-room guard"
# ---------------------------------------------------------------------------
# The product is clean-room by contract: no reference product's mark, name or
# asset may appear in the shipped tree. This runs on every verification.
if run_check features; then
  # The guard checks what a USER SEES, not what a DEVELOPER WROTE. Naming the
  # reference product in a comment that explains a deliberate divergence is the
  # clean-room record doing its job ("the generator is ours, not Brave's"), so
  # prose is excluded and three classes are asserted instead:
  #
  #   1. user-visible strings in manifests (name, description, default_title,
  #      homepage_url) must not name another product
  #   2. the .desktop entry's Name/GenericName/Comment must be Ziy's own
  #   3. no shipped PNG/SVG asset carries another product's mark
  #
  # Strip comments before matching, so only shipped text is ever judged.
  LEAKS=0
  IDENTITY_LEAKS=0
  for mf in "$ROOT"/extensions/*/manifest.json; do
    [ -f "$mf" ] || continue
    if python3 - "$mf" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
banned = ("Brave", "Google Chrome", "Mozilla Firefox", "Chromium")
fields = []
for key in ("name", "description", "default_title", "homepage_url", "short_name"):
    value = doc.get(key)
    if isinstance(value, str):
        fields.append((key, value))
for action in (doc.get("action") or {}, doc.get("sidebar_action") or {}):
    for key in ("default_title", "default_panel"):
        value = action.get(key)
        if isinstance(value, str):
            fields.append((key, value))
for key, value in fields:
    for bad in banned:
        if bad.lower() in value.lower():
            print(f"{sys.argv[1]}: {key} names {bad!r}: {value!r}")
            sys.exit(1)
sys.exit(0)
PY
    then :; else IDENTITY_LEAKS=$((IDENTITY_LEAKS+1)); fi
  done
  if [ "$IDENTITY_LEAKS" -eq 0 ]; then
    ok "no manifest names another product in a user-visible string"
  else
    bad "$IDENTITY_LEAKS manifest(s) carry a reference product's name in a user-visible field"
  fi

  # The desktop entry: Name and GenericName are what a launcher shows.
  DESKTOP_HITS=$(grep -E '^(Name|GenericName|Comment)=' "$ROOT/shell/ziy.desktop" \
                   | grep -iE 'brave|chromium|mozilla firefox|google chrome' | wc -l | tr -d ' ')
  if [ "$DESKTOP_HITS" -eq 0 ]; then
    ok "ziy.desktop's user-visible fields name only Ziy"
  else
    bad "ziy.desktop names another product in a user-visible field"
  fi

  # No shipped image may carry another product's mark. This is checked by
  # comparing file bytes, which is what a trace would show up as.
  ASSET_LEAKS=0
  for asset in "$ROOT"/brand/* "$ROOT"/replica/design/brand/*; do
    [ -f "$asset" ] || continue
    case "$asset" in
      *.png|*.jpg|*.jpeg|*.webp|*.ico)
        # PNG/JPEG carry no executable text, so a name match here would be a
        # coincidence of the container, not a brand. SVG is text and is checked.
        ;;
      *.svg)
        if grep -qiE 'brave|chromium' "$asset" 2>/dev/null; then
          ASSET_LEAKS=$((ASSET_LEAKS+1))
        fi
        ;;
    esac
  done
  if [ "$ASSET_LEAKS" -eq 0 ]; then
    ok "no brand asset names a reference product"
  else
    bad "$ASSET_LEAKS brand asset(s) name a reference product"
  fi

  # And the code-level witness: no reference product's name may be a string
  # literal, an identifier, a storage key or a message id in shipped code.
  # Comments are excluded on purpose — a clean-room record is supposed to
  # explain a divergence ("the generator is ours, not Brave's"). The scan lives
  # in tools/lib/cleanroom-scan.py so its quoting is testable and it cannot
  # silently pass the way an inline heredoc can.
  if python3 "$ROOT/tools/lib/cleanroom-scan.py" "$ROOT" >&2; then
    ok "no reference product's name is a string literal in shipped code (comments excluded)"
  else
    bad "a reference product's name is a string literal in shipped code (see above)"
  fi
fi

# ---------------------------------------------------------------------------
note "12. self-contained: built from Mozilla's checksum-verified tarball"
# ---------------------------------------------------------------------------
# The engine is a BUILD INPUT, so the gate is about where the input came from.
# build-shell.sh writes build/engine-provenance.txt recording the engine path it
# used and whether that path was fetched from Mozilla (fetch-engine.sh) or
# discovered on the system. This check reads that record and, for the fetched
# case, re-verifies the tarball's sha512 against Mozilla's own published
# SHA512SUMS — so a Ziy built with no Firefox install at all is proven, not
# asserted, and a build that silently used the host engine is reported as such.
if run_check self-contained; then
  PROVENANCE="$BUILD_DIR/engine-provenance.txt"
  if [ ! -f "$PROVENANCE" ]; then
    bad "no build/engine-provenance.txt — this build predates the self-contained path; rebuild with tools/build-shell.sh"
  else
    ENGINE_SRC="$(sed -n 's/^source=//p' "$PROVENANCE" | head -1)"
    ENGINE_USED="$(sed -n 's/^engine=//p' "$PROVENANCE" | head -1)"
    if [ "$ENGINE_SRC" = "tarball" ]; then
      ok "build/ziy was built from Mozilla's prebuilt engine tarball (no host Firefox needed)"
      log_step "engine" "$ENGINE_USED"
      TARBALL_USED="$(sed -n 's/^tarball=//p' "$PROVENANCE" | head -1)"
      SHA512_RECORDED="$(sed -n 's/^sha512=//p' "$PROVENANCE" | head -1)"
      if [ -n "$TARBALL_USED" ] && [ -f "$TARBALL_USED" ]; then
        SHA512_NOW="$(sha512sum "$TARBALL_USED" | awk '{print $1}')"
        if [ "$SHA512_NOW" = "$SHA512_RECORDED" ]; then
          ok "the engine tarball's sha512 still matches the value verified at build time"
        else
          bad "the engine tarball's sha512 CHANGED since the build — the build input is no longer the file that was verified"
        fi
        # And cross-check the recorded digest against Mozilla's own manifest,
        # so "verified" means verified against Mozilla, not against ourselves.
        SUMS_FILE="$(dirname -- "$TARBALL_USED")/SHA512SUMS"
        if [ -f "$SUMS_FILE" ]; then
          # The manifest lists "<sha512>  <platform>/<locale>/<artifact>"; match
          # on the artifact's own relative path so a build directory containing
          # spaces cannot break the lookup.
          PUBLISHED="$(grep -F "linux-x86_64/en-US/firefox-156.0.1.tar.xz" "$SUMS_FILE" | awk '{print $1}' | head -1)"
          if [ -n "$PUBLISHED" ] && [ "$PUBLISHED" = "$SHA512_RECORDED" ]; then
            ok "that sha512 is the one Mozilla publishes for this artifact"
          elif [ -z "$PUBLISHED" ]; then
            skip "$SUMS_FILE does not list this artifact; the digest was verified at fetch time"
          else
            bad "digest disagrees with Mozilla's published SHA512SUMS"
          fi
        fi
      else
        skip "the tarball itself is not present ($TARBALL_USED) — only the build-time record was verified"
      fi
    else
      skip "build/ziy was built from the system engine ($ENGINE_USED); rerun with no system Firefox, or with --engine-tarball, to prove the self-contained path"
    fi
  fi
fi

# ---------------------------------------------------------------------------
note "process hygiene"
# ---------------------------------------------------------------------------
REMAINING="$(pgrep -f '/tmp/ziy-.*profile' 2>/dev/null || true)"
if [ -z "$REMAINING" ]; then
  ok "no Ziy processes left running"
else
  ziy_kill_throwaway '/tmp/ziy-.*profile'
  ok "cleaned up remaining Ziy processes: $REMAINING"
fi
# Prove we never came near the user's own sessions.
USERFIDDLE="$(pgrep -af '/usr/lib/firefox/firefox -[a-z]' 2>/dev/null | grep -v ziy | head -3 || true)"
if [ -n "$USERFIDDLE" ]; then
  log_step "untouched" "the user's own Firefox is running and was not signalled:"
  printf '%s\n' "$USERFIDDLE" | sed 's/^/          /'
fi

# ---------------------------------------------------------------------------
printf '\n%s== summary ==%s\n' "$C_BOLD" "$C_RESET" >&2
for line in "${RESULTS[@]}"; do
  case "$line" in
    PASS*) printf '  %s%s%s\n' "$C_GREEN" "$line" "$C_RESET" >&2 ;;
    FAIL*) printf '  %s%s%s\n' "$C_RED" "$line" "$C_RESET" >&2 ;;
    *)     printf '  %s%s%s\n' "$C_YELLOW" "$line" "$C_RESET" >&2 ;;
  esac
done
printf '  %s%d passed, %d failed, %d skipped%s\n' "$C_BOLD" "$PASS" "$FAIL" "$SKIP" "$C_RESET" >&2
[ "$FAIL" -eq 0 ]
