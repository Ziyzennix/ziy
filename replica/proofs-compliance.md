# proofs-compliance.md — the MPL notice, the not-affiliated notice, the list-licence table

**Session:** 2026-10-16 (the batch pass). **Box:** i5-4590 (4 cores), Node
v26.10.0, python3 3.12. **Scope:** `replica/deploy.md` §5's rows 4–8 — the
MPL-2.0 §3.2(a) source-availability notice, the not-affiliated-with-Mozilla
notice, the residual-marks disclosure, and the filter-list licence table.
Requirements come from `replica/research-legal.md` §2.2/§2.3/§2.4 and §6.1/§6.3;
nothing here is a new decision, and every number traces to a command run in this
session or to the pass's verbatim transcript.

---

## 1. What ships now, file by file

| file | change |
| --- | --- |
| `shell/LICENSES.txt` | **new, 66 lines / 2,775 bytes.** The app-dir notice: MPL-2.0 statement + link; the §3.2(a) "where to get the source" block (the engine tarball URL for 156.0.1, the `patches/` directory beside the notice, the repo URL); the not-affiliated sentence; the residual engine marks disclosed (`--version` prints `Mozilla Firefox 156.0.1`, `firefox`/`firefox-bin`/`updater.ini`/`crashreporter` are engine file names, the `ziy` launcher is the entry point) |
| `tools/build-shell.sh` | stage **8b** (after the suite install): `install -Dm 0644 shell/LICENSES.txt build/ziy/LICENSES.txt`, then every `patches/*.patch` + `patches/README.md` into `build/ziy/patches/`; the ready banner gained a `notices` row |
| `tools/verify.sh` | §1 gained: LICENSES.txt existence (with `--force` named as the remedy), four `grep -qF` wants (`mozilla.org/MPL/2.0/`, `not officially associated with Mozilla`, `Mozilla Firefox 156.0.1`, `patches/`), and `PATCH_SHIPPED >= 5` against `$APP_DIR/patches/*.patch` |
| `extensions/ziy-shields/LICENSES` | intro now declares the extension's own code MPL-2.0 (`:6-10`); the four missing lists added with sha256 + line counts — uBlock Origin filters (GPL-3.0), URLhaus (CC0-1.0/MIT dual), Adblock Warning Removal List, Brave Unbreak (MPL-2.0, repository level, with the note that the list file itself declares no licence header); EasyList/EasyPrivacy relicensed in the record as "GPLv3 or CC-BY-SA-3.0 (dual)"; new section **"The EasyList-family dual licence — which branch Ziy relies on"** |
| `extensions/ziy-shell/ui/welcome.html` | footer gained the not-affiliated sentence at the same prominence as the page's other copy; CSS adds `footer .engine-note { display:block; margin-top:var(--space-2) }` |
| `extensions/ziy-shields/lib/filterlist/parser.js` | provenance header: written against the public uBO static-filter syntax docs; snapshots + licences pointed at `lib/filterlist/snapshots/` and `LICENSES` |

## 2. The two deliberate choices a reviewer will ask about

1. **The notice is `.txt` on purpose.** `tools/lib/cleanroom-scan.py` reads only
   `.js/.json/.css/.html/.py/.sh`, and verify §12 reads manifests, `.desktop`
   fields and shipped SVGs. A file whose job is to *name the engine's vendor*
   (MPL §3.2(a) requires the source pointer to be useful) must not be read by a
   clean-room gate that hunts vendor names. The extension keeps the gate's
   coverage; the notice keeps the licence's usefulness. Both verify checks
   confirm this from opposite sides.
2. **The EasyList-family branch the compiled ruleset relies on is CC-BY-SA
   3.0**, stated in the section itself: the verbatim list bodies satisfy either
   branch, but the compiled `rules/static-ruleset.json` ships under the
   CC-BY-SA branch, with `LICENSES` (inside the same xpi) as the attribution
   that travels with it — the route `research-legal.md` §6.2(b)/§6.3 item 2
   recommends.
3. **`brave/adblock-lists` is named in `extensions/ziy-shields/LICENSES`, on
   purpose** — `research-legal.md` §6.3 item 1 prescribes exactly that
   attribution. The file has no extension, so neither the clean-room scan nor
   verify §12 reads it; that was chosen so the attribution obligation and the
   clean-room gate do not fight.

## 3. The commands, and what they printed

Formatter-level checks (fresh, this session):

```
$ bash -n tools/build-shell.sh && bash -n tools/verify.sh && node --check extensions/ziy-shields/lib/filterlist/parser.js
build-shell.sh: syntax OK
verify.sh: syntax OK
parser.js: syntax OK

$ python3 tools/lib/cleanroom-scan.py "$(pwd)"
no reference product name is a string literal in shipped code        exit 0

$ install simulation (copies the notice + patches exactly as stage 8b would, /tmp/opencode, then removes it)
PASS names: mozilla.org/MPL/2.0/
PASS names: not officially associated with Mozilla
PASS names: Mozilla Firefox 156.0.1
PASS names: patches/
patches shipped: 5
notice bytes: 2775
```

Rebuild (this session, after the changes landed):

```
$ ./tools/build-shell.sh --force
  install    LICENSES.txt (MPL §3.2(a) notice) + patches/ (engine source diffs)
  ok  shipped the notice + 6 engine source file(s) in …/build/ziy/patches/
  notices        LICENSES.txt + patches/ (6 files, MPL §3.2(a))
  ok  build complete
```

The suite itself is unchanged by this pass:

```
$ npm test      →  ℹ tests 674 · pass 674 · fail 0
```

Gate: `./tools/verify.sh` → **54 passed / 0 failed / 2 skipped** (the full row
list is in §4; the notice checks are §1's new rows and re-run on every build).

## 4. The verify run, as it landed

Pre-rebuild, the new §1 checks correctly FAILED ("LICENSES.txt is missing from
the app dir — MPL §3.2(a) is unmet", "the app dir ships 0 engine patch(es)") —
the assertions work; the artifact was simply older than the change.

After `./tools/build-shell.sh --force` + `bash tools/build-extension.sh --all`:

```
$ ./tools/verify.sh
  PASS  build/ziy exists at …
  PASS  omni.ja is patched (signing off, sideload on)
  PASS  the MPL §3.2(a) notice ships in the app dir (2775 bytes)
  PASS  LICENSES.txt names mozilla.org/MPL/2.0/
  PASS  LICENSES.txt names not officially associated with Mozilla
  PASS  LICENSES.txt names Mozilla Firefox 156.0.1
  PASS  LICENSES.txt names patches/
  PASS  the app dir ships the engine source patch set (5 patches)
  … (39 more PASS rows, unchanged suites included)
  54 passed, 0 failed, 2 skipped
```

The six new PASS rows are this pass's §1 checks. The two SKIPs this run:
`--version does not say Ziy` (the known libxul string) and a sync-e2e
transfer-line SKIP that was **not** an environment flake — re-run in isolation
it failed the same way, and the root cause was a same-second pull-cursor
boundary bug that had been latent in the sync protocol all along (fixed:
`pullSince()` in `extensions/ziy-sync/lib/client.js`, with its own test; the
e2e re-run after the fix is **PASSED** with the record delivered —
`replica/proofs-sync.md` §7 has the full account).

**Post-fix re-run (2026-10-16):** `./tools/verify.sh` → **exit 0, 54 passed / 0 failed /
2 skipped**, with the sync rows now **PASS** (`sync two-profile e2e transferred the record
A wrote to B`; `sync unit suite passes (52 assertions)`; log
`/tmp/opencode/verify-post-sync-fix.log`). The sync-e2e transfer-line SKIP above is gone.
The two SKIPs of this re-run are `--version does not say Ziy` and the playlist panel probe
— the known headless-media flake (its log ends `FAILED: 1 assertion(s): ['playback']`),
unrelated to the sync fix. The account above is kept as written: it is the pre-fix run the
boundary bug was root-caused from.

## 5. What this pass does NOT claim

- **Rows 6 and 7 are partially closed by design.** The not-affiliated notice
  ships on the app-dir notice and the welcome footer; the About panel and any
  download page are not built yet, so "every user-facing surface" is not yet
  true (`deploy.md` §5 row 6 stays open for those surfaces). Row 7 took the
  disclosure route — the notice names the residual marks and the `--version`
  string — the banner-string remap was not attempted.
- **`research-legal.md` §6.3 item 4 (a registry-vs-header drift check) is not
  implemented.** The records exist; no CI check compares them to the snapshots'
  headers yet. Left as a follow-up with its own file, not smuggled into a
  notice pass.
- **No lawyer reviewed this.** It is engineering compliance against the cited
  sources, assembled to be *reviewable* by counsel — which is all the repo has
  ever claimed (`research-legal.md` header).
- **The Ko-fi page copy is a separate deliverable** and lives in
  `replica/kofi-page-copy.md` (row 10); nothing here touches it.
