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

- **`make-tarball.sh` — ~~in flight at the time this file was written~~ → the first run
  FAILED at its final assertion, the checker was fixed (defect 9.8), the re-run PASSED
  end to end; the tarball artifact is DONE and verified.** The first run (2026-10-16,
  `nice -n 19`, background, started after the app-dir rebuild + suite repackage) passed
  every self-check up to the archive round-trip (application.ini = Ziy, both omni.ja
  patches in the shipped bytes, 9 XPIs, launcher, 9 icon sizes, README.md +
  CHECKSUMS.sha256 written) and was compressing
  `build/packaging/ziy-156.0.1-linux-x86_64.tar.xz` (xz, multithreaded) at the time this
  file was written. Its final re-read then FAILED — `BadZipFile: Bad magic number for
  central directory`, surfaced as "the shipped omni.ja lost the signing patch somewhere in
  packaging" — it had not; stdlib `zipfile` cannot read omni.ja at all (defect 9.8,
  `packaging/linux/DEPS.md` §9.8). Fixed to verify both containers in the unpacked
  archive with the official reader (`tools/lib/omni-ja.py`); the re-run then **PASSED end
  to end**, including `ok the shipped omni.ja still carries both patches`.
  ~~**Do not start a second xz on this box while it runs** (4 cores).~~ **Artifact:**
  `build/packaging/ziy-156.0.1-linux-x86_64.tar.xz`, **95,995,124 B ≈ 92M compressed /
  336M unpacked**, `.sha256` beside it (`3e23d599…1511db2`).
- **The tarball boots.** Fresh extraction, throwaway HOME + profile: the screenshot was
  written and is non-blank (1280x720, 256 colours — `/tmp/opencode/tarball-boot-shot.png`),
  all 9 `ziy-*@ziy.app` add-ons are `active=True` in the fresh profile, and the engine
  reports `--version` = `Mozilla Firefox 156.0.1` (known behaviour, `replica/deploy.md`
  §4). One caveat: the headless process can hang after writing the screenshot — it needed
  `timeout` here, and the CI smoke step wraps it in `timeout 180` too. Log (volatile):
  `/tmp/opencode/tarball-boot.log`.
- **`./tools/verify.sh` after the sync fix: exit 0, 54 passed / 0 failed / 2 skipped.**
  The sync rows are now PASS — `sync two-profile e2e transferred the record A wrote to B`
  and `sync unit suite passes (52 assertions)` — and the hygiene check `no Ziy processes
  left running` is PASS. The two SKIPs: the known `--version does not say Ziy`, and the
  known headless-media playlist panel probe (its log ends `FAILED: 1 assertion(s):
  ['playback']` — re-run before concluding it broke). Log (volatile):
  `/tmp/opencode/verify-post-sync-fix.log`.
- ~~Nothing else is in flight.~~ The one thing in flight now is compile run 4 (§3); the
  packaging subagent completed, its deliverables are the DEPS.md / workflow / script
  fixes above.

## 3. THE NEXT ACTIONS (ordered)

1. **The ONE Gecko compile is dispatched — run 4 in flight after three fixed setup bugs
   (all `workflow_dispatch`, branch `main`; workflow id 385699008).** The push and the
   dispatch are DONE as of 2026-10-16. Run history (GitHub timestamps are UTC,
   2026-10-15 evening = 2026-10-16 local):
   - **38794333725** (19:29:34Z): failed 59 s at step c2 — ordering bug, `cd _src` ran
     before the download existed → fixed in commit `6217634`.
   - **38795215736** (19:35:59Z): failed 1m47s at step d2 — `SHA512SUMS` fetched from
     `source/` → 404; it lives at the release root → fixed in `87dc04a`.
   - **38795875890** (19:40:54Z): failed 2m12s at step d3 — `mach` asserted as a
     directory; it is a 6887-byte file → fixed in `b7eec82`, which also pre-emptively
     fixed step i's smoke (about: pages produce no headless screenshot — switched to a
     `file://` probe page; exit capture via `|| BOOT_RC=$?`) and e2's dead ccache config
     path (`~/.ccache/config` → `~/.cache/ccache/ccache.conf`, `compiler_check = content`).
   - **38797207327** (19:51:01Z, headSha `b7eec82`): **IN FLIGHT as this lands**,
     monitored. The 12–28 h compile has NOT started yet; total metered spend so far
     ≈ 5 minutes of fast setup failures. The cache-resume design is intact
     (`~/.cache/ccache` paths consistent).
   Expectations unchanged: cold Gecko build **12–28 h**; the job's time cap may kill it
   at the limit — **that is a documented acceptable outcome** (re-dispatch with a raised
   cap after reading the log; private-repo metering ~2,000 min/month). The first compile
   is what moves `patches/0001–0005` from AUTHORED to COMPILED in `patches/README.md` +
   `replica/proofs-cpp-privacy.md`.
2. **While it runs, locally:** `bash packaging/linux/make-deb.sh` (its first run; lintian is
   absent on this box — the workflow's run is where lintian + apt-install happen);
   ~~boot the produced tarball headless through its own `./ziy` with a throwaway
   `/tmp/opencode/ziy-*` profile and record the screenshot result~~ → **DONE 2026-10-16**
   (non-blank 1280x720 screenshot, 9/9 add-ons `active=True` — §2); `bash
   replica/test/regressions.sh f20-sync` for the regression row.
3. **Re-run `./tools/verify.sh` after the sync fix — DONE 2026-10-16.** The recorded
   54/0/2 predated it; the re-run is also **54 passed / 0 failed / 2 skipped**, exit 0,
   with the sync-e2e row now PASS (`sync two-profile e2e transferred the record A wrote
   to B`; `sync unit suite passes (52 assertions)`). ~~leaving `--version` as the only
   skip~~ → the prediction was off: the second SKIP is the playlist panel probe (the
   known headless-media flake; its log ends `FAILED: 1 assertion(s): ['playback']`),
   beside `--version does not say Ziy`. Hygiene check `no Ziy processes left running`
   PASS. Log (volatile): `/tmp/opencode/verify-post-sync-fix.log`.
4. **Sync follow-ups from `proofs-sync.md` §7** (both need tests before patches): the
   join-backfill question (a device joining an existing chain never receives pre-join
   records) and `handlePull` pagination (a delta > 500 records is silently truncated).
5. **Co-owner actions:** apply the Ko-fi page copy (`replica/kofi-page-copy.md`) before any
   public build announcement; the AMO smoke-test offer (install one real signed extension
   into a throwaway profile and record it) is still open.

**Known gaps recorded, not fixed in this batch:** (1) the packaged launcher stub
`shell/launcher.sh` is a documented pass-through and does NOT bootstrap a
`~/.ziy/profiles` first-run profile — the tarball boot in §2 ran on the engine's default
profile mechanics under the redirected HOME. Whether the shipped stub should own
first-run profile creation is a co-owner decision, not changed in this batch. (2)
`tools/verify.sh` prints `the whole node suite passes (pass assertions)` — the literal
word "pass" where a count is expected (observed verbatim in
`/tmp/opencode/verify-post-sync-fix.log`); cosmetic, not fixed.

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
54/0/2, post-sync-fix — both sync rows PASS) + the packaged tarball produced,
round-trip-verified and booted (`build/packaging/ziy-156.0.1-linux-x86_64.tar.xz`
≈ 92M + `.sha256`; §2); at: compile run 4 (`38797207327`, headSha `b7eec82`) is in
flight after three fixed setup bugs (§3) — the 12–28 h compile itself has not started;
launch blockers remain: ~~a produced-and-booted artifact (first local run in §2)~~ →
done 2026-10-16 (§2), the user update channel, the About-surface not-affiliated notice,
the patent skim, the Ko-fi page; open sync follow-ups: join backfill + pull pagination
(`proofs-sync.md` §7).
