# TODAY.md — the delta for the next Ziy session

**Written:** 2026-10-16, end of the native-helpers + compliance + packaging batch (the batch
that ends with the first `build-gecko.yml` dispatch). **Reads after:** `replica/HANDOFF.md`
(yesterday's baseline) and `replica/AI-BRIEF.md`. This file is the DELTA only — the baseline
sections in HANDOFF are not repeated here.

---

## 1. THIS BATCH'S WINS

- **`ziy-blocks` (T1) — the third native host, Rust, DONE.** `adblock 0.13.3` (default
  features; `embedded-domain-resolver` is required — `url_parser/mod.rs:104-106` panics
  without it), verdicts only, no store. Engine `dist/ziy-blocks-engine.dat` = 7,864,005 B.
  `node --test native/ziy-blocks/test` → **13/13** (real binary over a real pipe, 860 ms).
  Bench (`bench/verdict-bench.mjs`): block **0.0577**, clean **0.0571**, combined
  **0.0574 ms/request** (warmup 200 in 69 ms). Installer verified into a sandbox HOME
  (`ZIY_NATIVE_MANIFEST_DIR`/`ZIY_BLOCKS_DIR`): manifest written, probe answered
  "ziy-blocks 0.1.0, engine 7864005 bytes loaded in 40 ms". Documented deviations:
  `filter`/`exception` always null (engine built without their debug info), so the verdict
  is `block = important || (filter && !exception)` etc. Proof: `replica/proofs-native-blocks.md`.
- **T1b — the server's durability posture, measured.** `server/src/store.js`: WAL +
  `synchronous=NORMAL` (they are the reason `putBlob` was 144.059 ms/blob — the rollback
  journal's fsyncs — vs 0.13 ms now). `node --test server/test` → **18/18 in 11.15 s** (was
  fsync-bound 47–120 s). SIGKILL test: 200/200 acknowledged rows survived, 3.36 MB WAL
  replayed. Tripwire proof without the pragma: 47.1 s, 17 pass + 1 fail. Power-loss limb and
  NFS/SMB untested — recorded, not smoothed. Proof: `replica/proofs-native-blocks.md` (T1b).
- **Compliance pass — the notices now ship and the gate asserts them.** `shell/LICENSES.txt`
  (2,775 B) + all 5 patches + `patches/README.md` land in the app dir via build-shell stage
  8b; `tools/verify.sh` §1 gained six checks (notice bytes, four pointers, ≥5 patches);
  `extensions/ziy-shields/LICENSES` now carries all seven list rows with the EasyList
  dual-licence branch stated; the welcome footer carries the not-affiliated notice; the
  parser carries its provenance header. Proof: `replica/proofs-compliance.md`.
- **`privacy.spoof_english = 2` landed** — it was genuinely missing; the T2 fingerprint
  row was a partial. Locked in `shell/mozilla.cfg`, defaulted in `ziy.js` +
  `ziy-hardening.js`. Record: `replica/proofs-fix-prefs.md` §6 + `proofs-cpp-fingerprint.md` §5b.
- **A silent-data-loss sync bug found and fixed.** The two-device e2e failed 2/2 after the
  WAL speedup compressed join→push→pull into one wall-clock second: `putChain` seeds
  `last_sync_at = createdAt`, the store filters pulls with a STRICT `updated_at > since`, so
  a record stamped in the cursor's own second was dropped, and `touchSync` then advanced the
  cursor past it — silently, forever. Fix: `pullSince()` in
  `extensions/ziy-sync/lib/client.js` (`max(0, last_sync_at - 1)`), used by both the agent's
  `handlePull` and `SyncClient.pull`, with its own unit test; the e2e re-run is **PASSED**
  with the record delivered. Two same-family gaps recorded, not fixed (join backfill,
  >500-record delta truncation): `replica/proofs-sync.md` §7.
- **The packaging layer written.** `packaging/linux/DEPS.md` (473 lines of ldd/readelf/dpkg
  evidence, 65 packages), `.github/workflows/build-packages.yml` (489 lines; dispatch/tag
  only, `contents: read`, no Release), and six real script defects fixed — each with its
  probe in the script's own comment: the `/usr/bin/ziy` self-loop (a symlink to itself —
  every installed `ziy` would have died with "Too many levels of symbolic links"), the
  `dpkg-deb --contents` symlink pattern, the CHECKSUMS.sha256 self-hash, both `.sha256`
  files naming absolute build paths, the `dpkg-shlibdeps -O`/`substvars` mismatch, both
  `--help` ranges. **First real execution: `make-tarball.sh` runs locally in this batch** —
  see §2 for its result. Neither script had ever executed anywhere before.
- **Test numbers, measured at the end of this batch:** `npm test` → **674 tests, 674 pass,
  0 fail** (the 674th is `extensions/ziy-sync/test/pull-since.test.mjs`, added with the
  cursor fix). `node --test server/test` → **18** (11 s). `node --test native/ziy-blocks/test`
  → **13**. `node --test native/ziy-pwd/test` → **35**. `./tools/verify.sh` → **54 passed,
  0 failed, 2 skipped** (recorded before the sync fix; see §3.3).

## 2. IN FLIGHT RIGHT NOW

- **`make-tarball.sh`, first real run** (`nice -n 19`, background): started 2026-10-16 after
  the app-dir rebuild + suite repackage.
  every self-check up to the archive round-trip passed (application.ini = Ziy, both omni.ja
  patches in the shipped bytes, 9 XPIs, launcher, 9 icon sizes, README.md +
  CHECKSUMS.sha256 written) and it was compressing
  `build/packaging/ziy-156.0.1-linux-x86_64.tar.xz` (xz, multithreaded) at the time this
  file was written. Its round-trip verification prints the final verdict. **Do not start a
  second xz on this box while it runs** (4 cores).
- Nothing else is in flight. The packaging subagent completed; its deliverables are the
  DEPS.md / workflow / script fixes above.

## 3. THE NEXT ACTIONS (ordered)

1. **Push + dispatch the ONE Gecko compile** — this batch's endpoint. `git push` (HEAD was
   `094d497`; this batch adds everything in §1), then
   `gh workflow run build-gecko.yml --ref main` (workflow id 385699008; `workflow` OAuth
   scope verified present). Record the run id. Expectations: cold Gecko build **12–28 h**;
   the job's time cap may kill it at the limit — **that is a documented acceptable outcome**
   (re-dispatch with a raised cap after reading the log; private-repo metering ~2,000
   min/month). The first compile is what moves `patches/0001–0005` from AUTHORED to
   COMPILED in `patches/README.md` + `replica/proofs-cpp-privacy.md`.
2. **While it runs, locally:** `bash packaging/linux/make-deb.sh` (its first run; lintian is
   absent on this box — the workflow's run is where lintian + apt-install happen); boot the
   produced tarball headless through its own `./ziy` with a throwaway
   `/tmp/opencode/ziy-*` profile and record the screenshot result; `bash
   replica/test/regressions.sh f20-sync` for the regression row.
3. **Re-run `./tools/verify.sh`** after the sync fix — the recorded 54/0/2 predates it; the
   sync-e2e row should flip to PASS, leaving `--version` as the only skip.
4. **Sync follow-ups from `proofs-sync.md` §7** (both need tests before patches): the
   join-backfill question (a device joining an existing chain never receives pre-join
   records) and `handlePull` pagination (a delta > 500 records is silently truncated).
5. **Co-owner actions:** apply the Ko-fi page copy (`replica/kofi-page-copy.md`) before any
   public build announcement; the AMO smoke-test offer (install one real signed extension
   into a throwaway profile and record it) is still open.

## 4. THE THINGS NOT TO REDO

- **omni.ja byte-preserving member swap for the menu icon** — 5 same-length attempts failed
  (icon16.png is 722 B, a minimal shield SVG ~560; padding breaks the XML or the path data).
  The shipped fix is a relative `url()` in our own stylesheet (`replica/proofs-chrome-redesign.md` §5).
- **`[data-theme="dark"]` as a chrome dark-mode selector** — dead; the engine sets
  `:root[lwt-toolbar="dark"]` (`LightweightThemeConsumer.sys.mjs`).
- **`--in-content-*` CSS tokens** — gone from the engine; `userContent.css` retargets the
  real names in the engine's `light-dark()` idiom (§9.4 of the same proof).
- **Flutter for the Android app** — `webview_flutter` is the system WebView (Chromium); no
  maintained GeckoView bridge. `replica/research-android.md` §2.
- **Any `ziy-chrome.toml` patch set** — no such file exists and none is to be added.
- **Reverting the searches-policy tightening** — removing `DuckDuckGo`/`Bing` from
  `Remove` was the fix, not the defect.
- **"Simplifying" the `-1` out of `pullSince()`** — the strict server filter over a
  whole-second cursor makes the backstep load-bearing; the e2e is the proof
  (`replica/proofs-sync.md` §7).
- **Flipping the server's `>` to `>=` as the "cleaner" fix** — the strict semantics are
  pinned by `server/test/server.test.mjs` ("since= returns only newer records"); the client
  bias is the fix. If a future migration makes the server stamp versions, revisit both ends
  together.
- **Setting the server back to the rollback journal "for durability"** — the trade-off is
  documented in `store.js`: WAL+NORMAL can lose the newest commits only to OS crash/power
  loss, never to a process kill; an operator wanting power-loss durability raises
  `synchronous` to FULL (and accepts 144 ms/blob). The pragma is the one place that choice lives.

## 5. ONE-LINE STATE OF THE WORLD

Built and verified: the branded app dir + 9-extension suite + blind server (WAL, 18/18 in
11 s) + three native helpers (ziy-blocks real-binary tests 13/13; ziy-pwd 35; sync e2e
**green again** after the cursor fix) + compliance notices shipping and gated (verify
54/0/2, pre-sync-fix) + the packaging scripts and workflow written and making their first
local run; at: the push and the ONE `build-gecko.yml` dispatch are the immediate next
actions; launch blockers remain: a produced-and-booted artifact (first local run in §2),
the user update channel, the About-surface not-affiliated notice, the patent skim, the
Ko-fi page; open sync follow-ups: join backfill + pull pagination (`proofs-sync.md` §7).
