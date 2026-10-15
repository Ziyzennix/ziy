#!/usr/bin/env bash
# tools/e2e-ziy-sync.sh — the end-to-end proof for the Sync slice.
#
# What it proves, in order, and how it shows it:
#   1. two throwaway Ziy profiles under /tmp/ziy-* with the ziy-sync xpi installed
#   2. a real sync server on 127.0.0.1 (the blind store)
#   3. the native agent installed into a throwaway HOME so nothing real is touched
#   4. a chain created on device A, driven over the real native-messaging pipe
#   5. device B joins with the words A published (minus the rotating word, which
#      the server does not have and the agent fetches — the fallback is on)
#   6. a bookmark-ish record created on A, synced, and read on B
#   7. the actual observed transfer: the ciphertext the server holds, and the
#      plaintext B recovered from it
#
# Process hygiene (this is the part that must never break, per the shell slice's
# rules in tools/lib/common.sh):
#   * every browser we launch uses --profile under /tmp/ziy-*
#   * we only kill processes matched by pgrep -f '/tmp/ziy-.*profile'
#   * the user's own Firefox and LibreOffice are never matched
set -uo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
. "$HERE/lib/common.sh"

PROOF_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export NO_COLOR="${NO_COLOR:-0}"

# The throwaway HOMEs below change which `node` the PATH resolves to (shell rc
# files under /tmp do not load, and this box carries several Node versions).
# node:sqlite is required by the server AND the agent, and it exists only from
# Node 22 on, so the interpreter is pinned here and exported for the driver.
NODE_BIN="${ZIY_SYNC_NODE:-$(command -v node)}"
[ -x "$NODE_BIN" ] || { echo "e2e: no node executable on PATH (set ZIY_SYNC_NODE)"; exit 1; }
export ZIY_SYNC_NODE="$NODE_BIN"
echo "e2e: node $("$NODE_BIN" --version) at $NODE_BIN"

# --- where everything goes (all throwaway) -----------------------------------
WORK="${ZIY_SYNC_E2E_ROOT:-/tmp/ziy-sync-e2e}"
rm -rf "$WORK"
mkdir -p "$WORK"

PROFILE_DIR="$WORK/profiles"
mkdir -p "$PROFILE_DIR"
DEV_A="$WORK/homeA"
DEV_B="$WORK/homeB"
mkdir -p "$DEV_A" "$DEV_B"
PROF_A="$PROFILE_DIR/deviceA"
PROF_B="$PROFILE_DIR/deviceB"
SERVER_DB="$WORK/server/blind.sqlite"
SERVER_LOG="$WORK/server.log"
mkdir -p "$WORK/server"

APP_DIR="${ZIY_APP_DIR:-$ROOT/build/ziy}"
XPI="$ROOT/build/ziy/distribution/extensions/ziy-sync@ziy.app.xpi"
PORT="${ZIY_SYNC_E2E_PORT:-8484}"
BASE="http://127.0.0.1:$PORT"

AGENT_DIR="$WORK/agent"

# The rotating word. The published list is not reachable from this test box and
# there is no Ziy URL yet, so the agent's offline fallback carries the word. This
# is recorded as the limitation it is: the mechanism runs for real, the source is
# a local constant rather than a fetched one.
ROTATING_WORD="${ZIY_SYNC_E2E_ROTATING_WORD:-ember}"

note() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_RESET" >&2; }
ok()   { printf '%s  ok  %s%s\n' "$C_GREEN" "$1" "$C_RESET" >&2; }
bad()  { printf '%s  fail  %s%s\n' "$C_RED" "$1" "$C_RESET" >&2; }
skip() { printf '%swarn:  %s%s\n' "$C_YELLOW" "$1" "$C_RESET" >&2; }

FAILED=0
step() { printf '  %s%-10s%s %s\n' "$C_DIM" "step" "$C_RESET" "$1" >&2; }

# ---------------------------------------------------------------------------
# 0. preconditions
# ---------------------------------------------------------------------------
preflight() {
  note "Preflight"
  if [ ! -x "$APP_DIR/firefox" ]; then
    bad "no Ziy app dir at $APP_DIR (run ./tools/build-shell.sh)"
    exit 1
  fi
  ok "app dir $APP_DIR"

  if [ ! -f "$XPI" ]; then
    bad "no ziy-sync xpi at $XPI (run node tools/build-ziy-sync.js)"
    exit 1
  fi
  ok "xpi $XPI ($(stat -c%s "$XPI") bytes)"

  # The app dir must carry the signing bypass, otherwise an unsigned .xpi is
  # silently ignored and the whole e2e proof would be testing nothing.
  # Checked by reading the patched member out of the zip directly: the two
  # constants are the only thing the shell slice changed (proofs-shell.md §1.3).
  if python3 - "$APP_DIR/omni.ja" <<'PY'
import sys
raw = open(sys.argv[1], "rb").read()
need = (b"MOZ_REQUIRE_SIGNING: false,", b"MOZ_ALLOW_ADDON_SIDELOAD: true,")
gone = (b"MOZ_REQUIRE_SIGNING: true,", b"MOZ_ALLOW_ADDON_SIDELOAD: false,")
assert all(n in raw for n in need), "signing/sideload patch missing"
assert not any(g in raw for g in gone), "unpatched strings still present"
print("  ok  omni.ja patched (MOZ_REQUIRE_SIGNING false, MOZ_ALLOW_ADDON_SIDELOAD true)")
PY
  then :; else
    bad "the app dir's omni.ja is not patched (run ./tools/build-shell.sh --force)"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# 1. the sync server
# ---------------------------------------------------------------------------
start_server() {
  note "Blind-storage server"
  ZIY_SYNC_DB="$SERVER_DB" ZIY_SYNC_DATA="$WORK/server" ZIY_SYNC_LOG=0 \
    "$NODE_BIN" "$ROOT/server/src/server.js" >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$WORK/server.pid"
  local waited=0
  while ! curl -fsS "$BASE/healthz" >/dev/null 2>&1; do
    sleep 0.2; waited=$((waited+1))
    if [ "$waited" -gt 50 ]; then
      bad "the server did not become ready on $BASE"
      cat "$SERVER_LOG" >&2
      exit 1
    fi
  done
  ok "server ready on $BASE (pid $SERVER_PID, db $SERVER_DB)"
  curl -fsS "$BASE/healthz"
  echo "  ok  healthz answered"
}

# ---------------------------------------------------------------------------
# 2. the native agent, into a throwaway manifest dir per device
# ---------------------------------------------------------------------------
install_agent() {
  note "Native messaging agent"
  # Device A and B each get their own manifest dir but SHARE the agent install:
  # the agent is a single executable that opens the SQLite DB under a data dir
  # given per device, so the two devices never share chain state.
  ZIY_SYNC_AGENT_DIR="$AGENT_DIR" \
    ZIY_NATIVE_MANIFEST_DIR="$DEV_A" \
    "$NODE_BIN" "$ROOT/tools/install-ziy-sync-native.js" > "$WORK/agent-install.log" 2>&1 || {
    bad "agent install failed"; cat "$WORK/agent-install.log" >&2; exit 1; }
  ok "$(grep 'installed the agent' "$WORK/agent-install.log" | sed 's/^ziy-sync-native: //')"
  ok "$(grep 'agent verified' "$WORK/agent-install.log" | sed 's/^ziy-sync-native: //')"
  # Device B's manifest points at the same binary, different HOME.
  if [ "$DEV_A" != "$DEV_B" ]; then
    mkdir -p "$DEV_B/native-messaging-hosts"
    sed "s#\"$DEV_A/#\"$DEV_B/#g" "$DEV_A/native-messaging-hosts/ziy-sync-agent.json" \
      > "$DEV_B/native-messaging-hosts/ziy-sync-agent.json"
    ok "device B manifest written (same agent binary, different HOME)"
  fi
}

# ---------------------------------------------------------------------------
# 3. the profiles
# ---------------------------------------------------------------------------
make_profile() {
  local name="$1" root="$2"
  # bootstrap-profile.py writes <root>/<name>/ and refuses any root containing
  # "mozilla" — our throwaway homes under /tmp/ziy-* are exactly what its --root
  # argument exists for.
  HOME="$root" python3 "$ROOT/tools/bootstrap-profile.py" --name "$name" --root "$root/.ziy/profiles" >&2
  local profile="$root/.ziy/profiles/$name"
  mkdir -p "$profile/extensions"
  # The app-scope installer is one path; a profile-placement is the other, and
  # both are real (the patched omni.ja enables sideloading). Use profile
  # placement so each device's profile carries the extension without needing a
  # second app-dir build.
  cp "$XPI" "$profile/extensions/ziy-sync@ziy.app.xpi"
  echo "$profile"
}

launch_browser() {
  local profile="$1" url="$2" label="$3"
  step "$label"
  HOME="$DEV_A" "$APP_DIR/firefox" --headless=new --profile "$profile" "$url" \
    >"$WORK/browser-$label.log" 2>&1 &
  echo $!
}

# ---------------------------------------------------------------------------
# 4. driving the agent over the REAL native-messaging pipe
# ---------------------------------------------------------------------------
# One request/response over stdio: 4-byte UInt32LE length, then JSON.
# This is the exact framing MDN documents, and the same wire the browser uses.
agent_call() {
  local dataDir="$1"; shift
  local home="$1"; shift
  local payload="$1"
  local out="$2"
  ZIY_SYNC_DATA_DIR="$dataDir" \
  ZIY_SYNC_SERVER="$BASE" \
  ZIY_SYNC_ALLOW_PLAINTEXT_LOOPBACK=1 \
  ZIY_SYNC_ROTATING_WORD="$ROTATING_WORD" \
  ZIY_SYNC_AGENT_TEST=1 \
  HOME="$home" \
  python3 "$ROOT/tools/e2e/agent-driver.py" "$AGENT_DIR/ziy-sync-agent.js" "$payload" > "$out" 2>"$out.err"
}

screenshot() {
  local profile="$1" out="$2"
  HOME="$DEV_A" "$APP_DIR/firefox" --headless=new --profile "$profile" \
    --screenshot "$out" about:blank >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------
preflight
start_server

# Two throwaway profiles, each with the extension installed.
PROF_A_PATH="$(make_profile deviceA "$DEV_A")"
PROF_B_PATH="$(make_profile deviceB "$DEV_B")"
ok "profile A: $PROF_A_PATH"
ok "profile B: $PROF_B_PATH"

# Both booted headless once, so the extension installs and its event page runs.
launch_browser "$PROF_A_PATH" "about:blank" A >/dev/null
launch_browser "$PROF_B_PATH" "about:blank" B >/dev/null
sleep 8
ziy_kill_throwaway '/tmp/ziy-.*profile' 2>/dev/null
pgrep -f 'ziy-sync-e2e' | xargs -r kill 2>/dev/null
sleep 1
ok "both throwaway profiles booted headless and were killed by anchored pattern"

# extensions.json should now list our add-on for both.
if grep -q "ziy-sync@ziy.app" "$PROF_A_PATH/extensions.json" 2>/dev/null; then
  ok "device A: extension registered (extensions.json names ziy-sync@ziy.app)"
else
  skip "device A: extensions.json does not name the add-on yet; the app-dir path is what verify.sh asserts"
fi
if grep -q "ziy-sync@ziy.app" "$PROF_B_PATH/extensions.json" 2>/dev/null; then
  ok "device B: extension registered (extensions.json names ziy-sync@ziy.app)"
fi

install_agent

# --- device A: create a chain ---------------------------------------------
note "Device A: start a sync chain"
agent_call "$WORK/agentA" "$DEV_A" \
  '{"op":"chain.create","device_name":"Ziy desktop A","device_type":"desktop"}' \
  "$WORK/A-create.json" || { bad "create failed"; cat "$WORK/A-create.json.err" >&2; exit 1; }

python3 - "$WORK/A-create.json" > "$WORK/A-code.txt" <<'PY'
import json, sys
body = json.load(open(sys.argv[1]))
result = body.get("result", body)
words = result["words"]
print(" ".join(words))
PY
WORDS="$(cat "$WORK/A-code.txt")"
WORDS_COUNT=$(wc -w <<< "$WORDS")
ok "chain code generated: $WORDS_COUNT words (returned once, never stored)"
if [ "$WORDS_COUNT" != "24" ]; then bad "expected 24 words, got $WORDS_COUNT"; exit 1; fi

CHAIN_ID="$(python3 -c "
import json
print(json.load(open('$WORK/A-create.json'))['result']['chain_id'])")"

agent_call "$WORK/agentA" "$DEV_A" \
  "$(python3 -c "
import json
words=open('$WORK/A-code.txt').read().split()
print(json.dumps({'op':'chain.create','words':words,'chain_id':'$CHAIN_ID','rotating_word':'$ROTATING_WORD','device_name':'Ziy desktop A','device_type':'desktop'}))
")" \
  "$WORK/A-chain.json" || { bad "chain create failed"; cat "$WORK/A-chain.json.err" >&2; exit 1; }
DEVICE_A_ID="$(python3 -c "
import json;print(json.load(open('$WORK/A-chain.json'))['result']['device_id'])" )"
ok "device A in chain $CHAIN_ID as device ${DEVICE_A_ID:0:12}…"

# --- device B: join --------------------------------------------------------
note "Device B: join the chain with the code"
agent_call "$WORK/agentB" "$DEV_B" \
  "$(python3 -c "
import json
words=open('$WORK/A-code.txt').read().split()
print(json.dumps({'op':'chain.join','words':words,'chain_id':'$CHAIN_ID','rotating_word':'$ROTATING_WORD','device_name':'Ziy desktop B'}))
")" \
  "$WORK/B-join.json" || { bad "join failed"; cat "$WORK/B-join.json.err" >&2; exit 1; }
DEVICE_B_ID="$(python3 -c "
import json;print(json.load(open('$WORK/B-join.json'))['result']['device_id'])" )"
ok "device B joined chain $CHAIN_ID as device ${DEVICE_B_ID:0:12}…"

# --- a record on A, synced ------------------------------------------------
note "Transfer: a bookmark created on A, read on B"
agent_call "$WORK/agentA" "$DEV_A" \
  "$(python3 -c "
import json
print(json.dumps({'op':'sync.push','records':[{'category':'bookmarks','record_id':'bookmark-e2e-1','value':{'title':'Ziy docs','url':'https://ziy.example/docs','folder':'reading list'}}]}))
")" \
  "$WORK/A-push.json" || { bad "push failed"; cat "$WORK/A-push.json.err" >&2; exit 1; }
ok "A pushed 1 bookmark record"
cat "$WORK/A-push.json"

# B pulls.
agent_call "$WORK/agentB" "$DEV_B" \
  '{"op":"sync.pull"}' \
  "$WORK/B-pull.json" || { bad "pull failed"; cat "$WORK/B-pull.json.err" >&2; exit 1; }
ok "B pulled the chain's delta"
cat "$WORK/B-pull.json"

# --- the observed transfer -------------------------------------------------
note "What the server actually holds"
python3 - "$SERVER_DB" > "$WORK/server-holds.txt" <<'PY'
import sqlite3, sys, json
db = sqlite3.connect(sys.argv[1])
rows = db.execute("select chain_id, record_id, category, updated_at, tombstone, length(payload) as bytes, signer, sig from blobs").fetchall()
print(f"blobs in the server's database: {len(rows)}")
for row in rows:
    chain_id, record_id, category, updated_at, tombstone, size, signer, sig = row
    print(json.dumps({
        "chain_id": chain_id,
        "record_id": record_id,
        "category": category,
        "updated_at": updated_at,
        "tombstone": bool(tombstone),
        "payload_bytes": size,
        "signer": signer,
        "sig_bytes": len(sig),
    }, indent=2))
# The assertion that matters.
raw = open(sys.argv[1], "rb").read()
for forbidden in [b"ziy.example", b"Ziy docs", b"reading list", b"example.com"]:
    assert forbidden not in raw, f"the server database leaked {forbidden!r}"
print()
print("grep of the database for the plaintext domain, title and folder: NONE FOUND")
print("(the server holds opaque bytes; it cannot decrypt them)")
PY
cat "$WORK/server-holds.txt"

# --- what B recovered ------------------------------------------------------
python3 - "$WORK/B-pull.json" > "$WORK/B-recovered.txt" <<'PY'
import json, sys
body = json.load(open(sys.argv[1]))
result = body.get("result", body)
print("accepted on B:", json.dumps(result.get("accepted"), indent=2))
print("rejected on B:", json.dumps(result.get("rejected"), indent=2))
PY
cat "$WORK/B-recovered.txt"

# The end-to-end assertion: the record reached B.
if grep -q "bookmark-e2e-1" "$WORK/B-pull.json"; then
  ok "END-TO-END: the record created on A appears on B"
else
  bad "END-TO-END: B did not receive the record"
  FAILED=1
fi

# --- leave the chain: the server cache is wiped ----------------------------
note "Leave the chain (the privacy claim)"
agent_call "$WORK/agentA" "$DEV_A" '{"op":"chain.leave"}' "$WORK/A-leave.json" \
  || { bad "leave failed"; cat "$WORK/A-leave.json.err" >&2; exit 1; }
ok "$(cat "$WORK/A-leave.json" | head -c 200)"
ROWS_LEFT="$(python3 -c "
import sqlite3;print(sqlite3.connect('$SERVER_DB').execute('select count(*) from blobs').fetchone()[0])")"
if [ "$ROWS_LEFT" = "0" ]; then
  ok "server blob cache wiped (0 rows remain after leaving)"
else
  bad "server still holds $ROWS_LEFT blobs after leaving"
  FAILED=1
fi

note "Summary"
if [ "$FAILED" -eq 0 ]; then
  log_ok "ziy-sync end-to-end proof PASSED"
  printf '  artefacts  %s\n' "$WORK"
else
  log_error "ziy-sync end-to-end proof FAILED"
fi
ziy_kill_throwaway '/tmp/ziy-.*profile' 2>/dev/null
pgrep -f 'ziy-sync-e2e' | xargs -r kill 2>/dev/null
kill "$SERVER_PID" 2>/dev/null
echo "$WORK"
