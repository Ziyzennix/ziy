# BUILD / PACKAGING / CONFIG — agent section

Area owner: build-config. Everything here is read from the tree on 2026-10-15 and
cited to file:line. No code was changed. Paths are repo-relative; the repo lives at
`/home/zen/Documents/brave but not chrome or firefox`.

---

## 1. THE BUILD PIPELINE, END TO END

### 1.1 `tools/build-shell.sh` — one script, 12 ordered stages

`./tools/build-shell.sh [--engine PATH] [--force]`. Idempotent-by-default: if
`build/ziy/` exists and `--force` is absent it exits 0 with "already built"
(`tools/build-shell.sh:70-75`). Anything else `rm -rf build/ziy` and rebuilds (`:76-77`).

Order, with the line each stage starts at:

| # | line | stage | what happens |
|---|---|---|---|
| 0 | `:25-33` | args | `--engine PATH` / `--engine=PATH` / `--force` / `-h`; `set -euo pipefail` |
| 1 | `:50-51` | engine discovery | `$ZIY_ENGINE`, then `ziy_find_engine` in `tools/lib/common.sh:31-43`: `$ZIY_ENGINE`, `/usr/lib/firefox`, `/opt/firefox`, `/usr/local/firefox`, then any `firefox*` dir under `/usr/lib`, `/usr/local/lib`, `/opt` |
| 1 | `:54-66` | engine validation | dies unless the candidate has `firefox` (executable), `omni.ja` **and** `browser/omni.ja` |
| 1 | `:68` | version probe | `"$ENGINE/firefox" --version` into the log |
| 2 | `:70-77` | output tree | `rm -rf build/ziy; mkdir -p build/ziy` |
| 3 | `:79-86` | copy the engine | `cp -a "$ENGINE/." "$OUT/"` — a copy, never a symlink, because omni.ja is modified and the operator's Firefox must not be touched; `chmod -R u+w` for a root-owned read-only engine |
| 4 | `:88-90` | app identity | `install -Dm 0644 shell/browser/application.ini build/ziy/browser/application.ini` (own `Name=Ziy`, own UUID `ID={3B4A3FF9-…}`, `RemotingName=ziy`, engine version pinned `156.0.1` both ways) |
| 4 | `:92-96` | pref defaults | installs `shell/browser/defaults/preferences/ziy.js` and `ziy-hardening.js` |
| 4 | `:98-100` | autoconfig | `install shell/mozilla.cfg build/ziy/mozilla.cfg` then `chmod 0644` — autoconfig requires the file be world-readable |
| 4 | `:104-110` | **preflight gate** | `python3 shell/preflight-prefs.py` (see §1.2) |
| 5 | `:112-123` | branding | see §6 |
| 6 | `:125-128` | window chrome | `shell/chrome/userChrome.css` → `build/ziy/browser/chrome/userChrome.css` |
| 7 | `:130-160` | omni.ja patch | `shell/omni.ja.patch/patch-omni.py "$ENGINE/omni.ja" "$OUT/omni.ja"` → log `build/omni.ja.patch.log`, then an **independent re-read** of the written file asserting both new strings present, both old strings absent (`:139-160`) |
| 7b | `:163-205` | browser/omni.ja patch | `tools/lib/omni-ja.py "$ENGINE/browser/omni.ja" "$OUT/browser/omni.ja" --patch ziy-browser` (newtab strip), then an independent re-read via `oj.verify_archive` proving the patch is on disk (`:202-205`) |
| 8 | `:207-210` | policies | `python3 shell/policies-gen.py` (regenerates **and** validates `shell/distribution/policies.json`; see §1.4) |
| 8 | `:212-216` | distribution.ini | `shell/distribution/distribution.ini` + the generated `policies.json` |
| 8 | `:218-244` | suite xpis | drops Firefox's own `langpack-*@*.xpi` from the copied tree, then copies `*.xpi` from `shell/distribution/extensions/` and `build/ziy/distribution/extensions/` into `build/ziy/distribution/extensions/`, with a `readlink -f` same-file guard (`:230-233`). **Zero xpis is a warning, not an error** (`:241`) |
| 9 | `:246-248` | launcher | `shell/launcher.sh` → `build/ziy/ziy` (mode 0755) |
| 10 | `:250-251` | desktop entry | `shell/ziy.desktop` → `build/ziy/ziy.desktop` |
| 10 | `:253-268` | hicolor tree | brand PNGs → `build/share/icons/hicolor/<size>x<size>/apps/ziy.png` (16,22,24,32,48,64,96,128,256), with a fallback that reuses `build/ziy/ziy.png` for any missing size (`:263-268`) |
| 11 | `:271-285` | report | prints app dir, launch command, xpi count, omni.ja log path |

Log line style comes from `tools/lib/common.sh:19-21` (`log_step` / `log_ok` / `log_warn` / `die`).

Verification hook: `tools/verify.sh:93-126` (section 1) re-parses `build/ziy/omni.ja`
with `patch_omni.py`'s own `locate_central_directory`/`parse_central_directory` and
fails if `MOZ_REQUIRE_SIGNING` is still true or `MOZ_ALLOW_ADDON_SIDELOAD` is not true.

### 1.2 `shell/preflight-prefs.py` — the pref-layer gate, and why it exists

Purpose (`shell/preflight-prefs.py:1-10`): catch an un-parseable pref value **at build
time** instead of at launch. The concrete incident it was written for is in the file's
header and `tools/build-shell.sh:104-108`: `privacy.fingerprintingProtection.granularOverrides`
must be a JSON ARRAY; putting `true`/a bare string in it makes
`FingerprintingWebCompatService`'s `JSON.parse` throw, the prefs service refuses the
write, and a refused `lockPref` inside autoconfig **aborts the rest of mozilla.cfg** —
leaving the engine half-configured and crashing the graphics compositor
("RenderCompositorSWGL failed mapping default framebuffer" + startup hang; the note is
also at `shell/browser/defaults/preferences/ziy.js:129-141` and `shell/mozilla.cfg:46-49`).

What it validates (six checks):

1. `:113-127` — parse the three layers with `parse_calls` (`:74-96`, regex
   `CALL_RE:71`, continuation lines joined first because mozilla.cfg wraps calls).
   Flags a layer with **zero** parsable `pref|defaultPref|lockPref` calls, and
   requires `mozilla.cfg` to contain at least one `lockPref`.
2. `:129-159` — `JSON_PREFS` (`:58-63`: `privacy.fingerprintingProtection.granularOverrides`,
   `privacy.baselineFingerprintingProtection.granularOverrides`): value must be a
   quoted, valid JSON **array**, and every entry must be an object carrying
   `firstPartyDomain`.
3. `:161-178` — `RFP_TARGET_PREFS` (`:66-71`): must match the `+Target,-Target`
   grammar (deliberately shallow — the vocabulary lives in engine-side `RFPTargets.inc`).
4. `:180-194` — every pref locked in `mozilla.cfg` must also be declared in
   `ziy.js`/`ziy-hardening.js`, so no lock is the only definition of a value.
5. `:196-216` — a pref present in more than one layer must carry the same value
   (JSON-array prefs are exempt: the prefs files legitimately start empty and the
   lock ships the global entry).
6. `:218-226` — `shell/mozilla.cfg` must be world-readable (mode & 0o004).

Exit 0 = clean, 1 = stop the build. `--list` prints the per-layer counts.
`tools/verify.sh:645-651` (section 8) re-runs it as an acceptance check.

### 1.3 The omni.ja byte patchers

There are **two containers and two patchers**, and they are deliberately separate:

* `omni.ja` (toolkit modules) → `shell/omni.ja.patch/patch-omni.py`, the **signing bypass**.
* `browser/omni.ja` (browser chrome) → `tools/lib/omni-ja.py` with
  `tools/patches/newtab-strip.toml`, the **newtab strip**.

Why omni.ja at all: the engine is a shipped release binary; the only engine code
reachable on the box is code shipped as **stored (uncompressed) members** inside those
containers, where the bytes on disk *are* the content, so a same-length rewrite keeps
every central-directory offset valid (`replica/deep-fork.md` §1).

#### `shell/omni.ja.patch/patch-omni.py` — the two-boolean signing bypass

Container format: omni.ja is a 4-byte-enveloped zip (byte map in
`shell/omni.ja.patch/README.md`); the parser locates the real EOCD by testing every
`PK\x05\x06` candidate for the one whose recorded `cd_size` ends exactly at its own
position and whose central directory starts `PK\x01\x02`
(`patch-omni.py:67-110`, mirrored in `tools/lib/omni-ja.py:91-115`). Local-header
offsets are absolute file offsets, not zip-relative.

The two substitutions (`patch-omni.py:51-56`, specs in `tools/lib/omni-ja.py:219-234`):

| member | before | after | effect |
|---|---|---|---|
| `modules/AppConstants.sys.mjs` | `MOZ_REQUIRE_SIGNING: true,` | `false,` | app-scope unsigned add-ons may install |
| same member | `MOZ_ALLOW_ADDON_SIDELOAD: false,` | `true,` | `extensions.sideloadScopes` honoured |

`true→false` is +1 byte and `false→true` is −1 byte, so the pair **cancels** and the
file length is unchanged; both the constructor (`tools/lib/omni-ja.py:174-181`) and the
patcher (`tools/lib/omni-ja.py:341-345`) refuse a net length change. Verified on this
box: `strings` finds neither constant in `firefox-bin` or `libxul.so` — they exist only
in that JS module (`shell/omni.ja.patch/README.md` "Verified on this box").

Steps, in order (`patch-omni.py:168-313`):
read → locate CD → parse CD → assert member present and `method == 0` (stored) →
verify the member's stored CRC against a recomputed CRC-32 → **precondition check**:
both old strings must be present exactly once, else `PRECONDITION FAILED` and a loud
non-zero exit (engine bump, or an already-patched source) → rewrite → assert
`len(patched) == len(source)` → recompute CRC-32 and write it into **both** the
central-directory header (`entry["cd_offset"] + 16`) and the local file header
(`entry["lho"] + 14`) (`:235-242`) → full re-parse of the output (CD unmoved, entry
count unchanged, every local header still present and name-matching) → re-verify the
new strings are present and the old ones gone → recompute the stored CRC and compare
it against what the central directory now claims → **byte-diff against the input** and
allow only the member body plus the two 4-byte CRC fields to differ (`:293-299`) →
only then write. Exit codes: 0 ok, 1 precondition, 2 verification, 3 usage/IO
(`:58-60`); refuses to patch in place (`:322-324`).

#### `tools/lib/omni-ja.py` + `tools/patches/newtab-strip.toml` — the newtab strip

`tools/patches/newtab-strip.toml` (comments + one `[[member]]` table) declares one member patch:
`chrome/browser/builtin-addons/newtab/manifest.json`, `"manifest_version": 2,` →
`"manifest_version": 3,`. Effect: Gecko's add-on installer rejects the built-in at
install time (its MV2 `background.scripts` is invalid under MV3), so Firefox's own new
tab never registers `chrome_url_overrides.newtab` and **ziy-ntp is the only newtab**.
Why a bump and not deletion: omni.ja members are fixed-position, so deleting or
resizing one relocates every later member and the container is dead
(`tools/patches/newtab-strip.toml:3-8`).

`tools/lib/omni-ja.py` is the generalised patcher over the same parsing contract:
`Substitution` (`:163-181`), `MemberPatch` (`:183-190`), built-in sets `ZIY_PATCHES`
(`:219-235`, the AppConstants pair) and `ZIY_BROWSER_PATCHES` (`:237-249`, the newtab
bump), TOML loader `load_patch_file` (`:251-274`), `apply_member_patch` (`:276-361`),
`reparse_and_check` (`:363-380`), `verify_member` (`:382-414`), `patch_archive`
(`:416-457`), read-only `verify_archive` (`:460-503`), CLI (`:505-579`) with
`--patch ziy|ziy-browser|ziy-all`, `--patch-file TOML` (repeatable) and `--verify`.
Its loud-failure rules, all stronger than silent success: absent member →
`PRECONDITION FAILED` (`:277-284`); compressed member → refusal, "a recompressing
patch needs a different tool" (`:286-292`); CRC mismatch → "refusing to patch a corrupt
archive" (`:299-305`); pattern absent → `PRECONDITION FAILED` (`:317-325`); pattern
present more than once → "the patch is ambiguous and would rewrite the wrong bytes"
(`:326-334`); net length change → refusal (`:341-345`); stray bytes changed outside the
patched members and their CRC fields → "aborted before writing" (`:447-453`); touching
an untouched member's CRC in either header → refusal (`:352-361`).

Confirmed live on this box: `verify_archive(build/ziy/browser/omni.ja,
newtab-strip.toml)` returns the newtab member as patched (run 2026-10-15).

#### The 4-layer pref/autoconfig stack

Load order (`shell/browser/defaults/preferences/ziy.js:6-19`, `shell/mozilla.cfg:1-25`):

1. `browser/defaults/preferences/ziy.js` — user-changeable `pref()` defaults (~21 KB,
   commented with the engine's own file:line for each pref).
2. `browser/defaults/preferences/ziy-hardening.js` — same values as `pref()` defaults,
   no locks; the "must never differ" set. Every pref here is repeated as `lockPref` in
   mozilla.cfg and `tools/verify.sh` asserts the two agree (its own header).
3. `mozilla.cfg` at the GRE root (autoconfig) — all locks. Enabled by
   `general.config.filename=mozilla.cfg` + `general.config.obscure_value=0` set in
   ziy.js; helpers (`pref`/`defaultPref`/`lockPref`/`unlockPref`/`getPref`/…)
   come from the engine's `defaults/autoconfig/prefcalls.js`. Sections: 1 fingerprinting
   (`:36-56`), 2 disabled platform APIs (`:58-86`), 3 WebRTC identity (`:88-93`),
   4 network privacy (`:95-105`), 5 telemetry (`:107-129`), 6 FxA/sync (`:131-137`),
   7 Mozilla surfaces incl. the newtab pref layer (`:139-163`), 8 add-on signing and
   scope bitmap 15 (`:165-179`), 9 tracking protection/cookies (`:181-197`),
   10 Ziy identity (`:199-205`), 11 feature flags (`:207-211`).
4. `distribution/policies.json` — enterprise-shaped, validated against the engine's
   own schema.

The **newtab strip is three independent layers**: the browser/omni.ja byte patch
(build-shell §7b), the prefs `browser.newtabpage.enabled=false` +
`browser.newtabpage.disableNewTabAsAddon=true` (`shell/mozilla.cfg:157-162`,
`tools/bootstrap-profile.py:81-89`), and the policy
`ExtensionSettings["newtab@mozilla.org"] = {"installation_mode": "blocked"}`
(`shell/policies-gen.py:225-231`).

### 1.4 `shell/policies-gen.py` — policies.json, validated against the engine's own schema

Order in `main` (`:458-490`): `read_engine_schema()` → `build_policies()` (or
`--check` reads the existing file) → `validate(doc, schema)` → on failure print every
error and exit 1 → on success write `shell/distribution/policies.json` (2-space indent).

`read_engine_schema` (`:150-176`) pulls `modules/policies/policies-schema.json` out of
the **engine's own** `browser/omni.ja` — the slices are `SCHEMA_SOURCE_HINTS`
(`/usr/lib/firefox/browser/omni.ja`, `/opt/firefox/browser/omni.ja`) plus
`$ZIY_ENGINE`; extraction is `member_from_omni` (`:178-201`), which re-implements the
envelope-aware zip read (`cd_start = eocd's cd_off` + 4, then local header at
`4 + header_offset`). The bytes are cached to
`shell/omni.ja.patch/policies-schema.json` and reused if no engine is found
(`:169-171`); if neither exists it **exits non-zero** rather than shipping
unvalidated JSON (`:172-176`). `validate` (`:434-456`) uses `jsonschema`
(lazy `pip install jsonschema -q` if the import fails).

`build_policies` (`:203-433`) composes: `ExtensionSettings` (`:208-232`) — Mozilla ids
`allowed`, the nine suite ids `normal_installed` with `default_area: navbar` +
`private_browsing: true` and **no `install_url`** (the XPI already ships in our own
distribution dir; fetching over the network would be a privacy regression),
`newtab@mozilla.org` `blocked`; a locked `Preferences` map from the audited lists
`DISABLED_APIS`, `LOCKED_TELEMETRY`, `LOCKED_NETWORK`, `LOCKED_TRACKING_PROTECTION`,
`LOCKED_MISC` (`:295-347`); and the top-level policy keys `DisableTelemetry`,
`DisableFirefoxStudies`, `DisableFirefoxAccounts`, `HttpsOnlyMode: "force_enabled"`,
`EnableTrackingProtection` (locked, all sub-lists on), `Cookies` (reject-tracker,
expire at session end), `UserMessaging` all off, `NewTabPage: true`, `FirefoxHome`
locked, `DisableAppUpdate`/`ManualAppUpdateOnly`, `SearchEngines` (with Bing/Amazon.com/eBay/DuckDuckGo removed — **Google is NOT removed**: it is the shipped default engine, co-owner decision 2026-10-15, see `replica/proofs-ntp.md` §3.1a), `DisableFormHistory`, `NoDefaultBookmarks`
(`:349-433`).

The dead-pref audits are inline and must not be reverted: `dom.serial.enabled` is
really `dom.webserial.enabled`; `dom.filesystem.enabled` is really `dom.fs.enabled`;
`dom.webbluetooth.enabled`, `dom.nfc.enabled`, `dom.idle-detector.enabled` and
`dom.security.featurePolicy.enabled` do not exist in 156.0.1 and were deleted
(`:55-67`, `shell/mozilla.cfg:58-86`); `network.cookie.lifetimePolicy`,
`privacy.partition.network_state.ocsp_cache`/`.cookie_cache`, `privacy.partition.serviceWorkers`
do not exist either (`:119-127`, `shell/mozilla.cfg:191-197`); the real WebGL override
pref names are `webgl.override-unmasked-renderer`/`-vendor`, not
`webgl.renderer-string-override` (`shell/mozilla.cfg:52-56`, `shell/policies-gen.py:321-328`).
Provenance doc: `replica/proofs-cpp-privacy.md` §2.1/§2.5.

`build-shell.sh` step 8 (`:207-210`) runs `policies-gen.py` as part of every build, so the checked-in
`shell/distribution/policies.json` (429 lines) is always schema-fresh.
`--check` is the standalone verification mode.

---

## 2. PROFILES AND THE LAUNCHER

### 2.1 `tools/bootstrap-profile.py`

Creates `~/.ziy/profiles/<name>/` — never `~/.mozilla` (`--root` is checked and
**refuses** any Mozilla path, `:436-449`). `PROFILE_SCHEMA_VERSION = 1` (`:48`);
a profile from a newer shell is refused rather than downgraded (`:306-315`).

Layout it writes: `chrome/` (plus `chrome/collapsed/`, `bookmarkbackups/`),
`extensions/` (`:318-320` — the profile-level sideload dir, enabled by
`extensions.sideloadScopes=15`), `user.js`, `prefs.js` (seeded only if absent/blank —
never clobbers an engine-written file, `:331-344`), `chrome/userChrome.css` +
`chrome/userContent.css` **and** root-level copies of both (`:346-357`, because some
Gecko builds look for them at the profile root), `local-settings.js` (the autoconfig
marker pointing back at `mozilla.cfg`, `:244-254`), `ziy-profile.json` (metadata:
`compat`, created time, suite id list, "nothing else on the box references it"),
`chrome/.ziy-profile-owned` marker.

Values: `USER_PREFS` (`:58-118`) — these are **user** prefs, which beat app-dir
defaults *and* policy locks (a lock only blocks changing an already-set value), so
anything that must be un-changeable lives in `mozilla.cfg` instead (`:52-56`).
Includes `toolkit.legacyUserProfileCustomizations.stylesheets=true` (without it
`userChrome.css` is ignored), profile-migration off, welcome/first-run prefs, the
newtab-off trio, telemetry-ID blanking, extension scope bitmaps, `extensions.activeThemeID`
= `ziy-shell@ziy.app`. `SEED_PREFS` (`:120-124`) seeds `prefs.js` well-formed enough
to boot before the engine writes it once.

Idempotency: `user.js` is **merged**, not clobbered — `load_existing_user_js`
(`:261-283`) parses the current file and existing values win over the script's
(`:325-328`); the file header says an edit by hand will be fought on re-run. Flags:
`--name` (default `default`), `--root`, `--reset` (destructive), `--list`, `-v`.

### 2.2 `tools/ziy` — the ONE launcher

App-dir resolution (`tools/ziy:150-161`): `$ZIY_APP_DIR`, then the first of
`$ROOT/build/ziy`, `$ROOT/shell/app-dir` that has an executable `firefox`; otherwise
`die "no Ziy app dir found. Run ./tools/build-shell.sh first"`.

Informational args answered **without** an app dir (a user asking for `--version` may
not have built anything yet): `--ziy-version` and `--version` (`:47-77`) print
"Ziy 156.0.1" plus the engine version **labelled as the engine's** — the engine's own
`--version` says "Mozilla Firefox 156.0.1" and cannot be remapped from `App:Name`, so
handing it on unlabelled would be a lie about whose product this is; `--install-native`
(`:78-92`) only *prints* the sync-agent install command, never runs it; `--help` as the
first arg prints Ziy's own help (an engine-targeted `--help` stays reachable as
`--engine-help`, `:135-145`).

Argument handling: `--engine-help` is rewritten to the engine's `--help` (`:135-141`);
`--profile NAME` / `--profile=NAME` select `~/.ziy/profiles/NAME` (default from
`$ZIY_PROFILE`, else `default`, `:165`); `-H`/`--headless` prepend `--headless=new`
(`:179`, applied at `:207-209`); `--no-profile` passes no `--profile` at all
(`:181`); `--` ends Ziy's own parsing; everything else accumulates into `EXTRA` and is
passed through untouched (`:183-188`), so URLs, `--screenshot`, `--window-size`
behave as on Firefox.

Profile bootstrap-on-demand: a missing profile is created by calling
`bootstrap-profile.py` and the run continues (`:191-199`).

Exec (`:211-221`): exports `MOZ_APP_LAUNCHER`, `ZIY_HOME`, `ZIY_ICON`, then
`exec "$APP/firefox" "${PROFILE_ARG[@]}" "${EXTRA[@]}"`. Kill discipline for scripts
is anchored on the throwaway profile path, never a bare `pkill`
(`tools/lib/common.sh:45-75`; the project path contains "brave").

---

## 3. EXTENSION PACKAGING AND DESKTOP INSTALL

### 3.1 `tools/build-extension.sh` + `tools/lib/zpxi.py`

`tools/build-extension.sh --all` (or bare paths, or default `--all` when no target is
given, `:88-91`). Output `build/ziy/distribution/extensions/<addon-id>.xpi`
(`OUT_DIR`, `:33`, overridable with `--out`). Modes `--all` / DIRs / `--check` /
`--list XPI` (`:44-54`).

The id-from-filename rule: the app-scope distribution installer derives the add-on id
from the **filename** (`XPIProvider.sys.mjs` `getExpectedID()` strips `.xpi` and
requires the result to match), so `zpxi.pack` **refuses** to write anything not named
`<addon-id>.xpi` (`tools/lib/zpxi.py:86-91`, and the reason is restated in the
docstring `:6-9` and `shell/extensions.list:5-8`). `check` (`:121-153`) re-opens each
xpi and fails when the filename id and the manifest's
`browser_specific_settings.gecko.id` disagree.

Determinism (`tools/lib/zpxi.py`): fixed timestamp `ZIP_DATE = (2026, 1, 1, 0, 0, 0)`
(`:33`), fixed `external_attr = (0o100644 & 0xFFFF) << 16` (`:107`), every entry
ZIP_DEFLATED level 9 (`:102-108`), entries **sorted** by POSIX path (`:65-81`),
`os.replace` of a `.tmp` file so a crash never leaves a half-written xpi (`:116`),
and an assertion that `manifest.json` is inside (`:112-114`). Excluded by rule:
`*.map`, `*.bak`, `.DS_Store`, and the `node_modules` / `test` directories at any
depth (`:14-29, 78-80`). Result: the same tree byte-identical across builds, which is
what makes `sha256sum` of an xpi a stable release identifier (`replica/proofs-pkg.md`
§2).

`--all` collection (`:65-83`) is tolerant of in-flight work: a directory with no
`manifest.json`, or an invalid one, is reported as `skip … (manifest.json is not valid
JSON yet — not packaging)` and the build still succeeds on everything real.

`build-extension.sh` never touches `build-shell.sh`; the shell build copies xpis from
the same `build/ziy/distribution/extensions/` directory into the app dir (`:181-188`).

Related: `tools/build-ziy-sync.js` builds `ziy-sync`'s xpi by delegating to the same
Python packer, and `tools/build-selftest-xpi.py` builds the unsigned `ziy-selftest`
xpi `tools/verify.sh` uses to prove the signing bypass is really effective
(`tools/verify.sh:355`).

### 3.2 `tools/install-desktop.sh`

Two per-user destinations only: `~/.local/share/applications/ziy.desktop` and
`~/.local/share/icons/hicolor/<size>x<size>/apps/ziy.png`
(`APPS_DIR`/`ICONS_DIR`/`DESKTOP_DST`, `:84-86`). Icon sources in order
(`ICON_SOURCES`, `:77-82`): `build/share/icons/hicolor` (the build's own tree — "the
same bytes the build certified, with no re-derivation of sizes", `:73-76`), then
`build/ziy/browser/chrome/icons/default`, then `build/ziy/chrome/icons/default`;
`has_icons()` (`:153-162`) accepts a hicolor layout (`<size>x<size>/apps`) or a flat
render dir, and if none is found the script says so and points at `build-shell.sh`.

The `.desktop` write (`:126-138`) is a targeted `sed` that rewrites only the main
entry's `Exec`/`TryExec` to `$ROOT/tools/ziy` (so the installed entry launches *this*
checkout) and rewrites only the per-action `Exec=/usr/bin/ziy ` prefix — a blanket
`s/^Exec=/` would have turned "New Window" into a copy of the default entry
(`:126-131`). The entry itself is `shell/ziy.desktop` (`Type=Application`, `Name=Ziy`,
`Icon=ziy`, three actions: new-window / new-private-window / profile-manager).

Icons: hicolor layout copied size-by-size and renamed to `ziy.png` regardless of the
source name (`:181-225`), each slot then **pixel-verified** with PIL against its
directory's size; a mismatched slot is reported and LANCZOS-resampled
(`:206-216`) — the same honesty rule the build applies in its fallback loop.
Flat layout derives the size from the filename (`:227-255`, both `logo-48.png` and
`default48.png` naming). The scalable mark is copied to
`hicolor/scalable/apps/ziy.svg` when present (`:262-272`). `update-desktop-database`
and `gtk-update-icon-cache` run only if installed and each absence is reported
(`:273-296`).

Idempotency and honesty: it is safe to re-run (writes are plain overwrites), and every
step it could not take is listed under "what this could NOT do" with the reason rather
than silently skipped (`:322-352`). It **never** runs `xdg-settings`/`xdg-mime` or
writes under `/usr`; `--set-default` prints the command
(`xdg-settings set default-web-browser ziy.desktop`) instead (`:94-113`). Other flags:
`--dry-run`/`-n` (prints every would-be action, changes nothing, `:51`,
`:273-281`, `:353-358`), `--uninstall` (removes only what this script wrote,
`:303-320`).

---

## 4. CI — WHAT EXISTS AND WHAT IS PLANNED

### 4.1 `.github/workflows/build-gecko.yml` (written; the only file under `.github/`)

Why it exists: this is the **only** permitted compile path for the engine
(`replica/deep-fork.md` §0 — local Gecko compilation is prohibited; see §7 below).

Trigger (`:66-86`): `workflow_dispatch` (free-text `note`, no build knobs — those live
in the version-controlled `.mozconfig`) and `push` on tags `["v*", "gecko-*"]` — never
a branch push, because a force-push sprint would queue a dozen multi-hour jobs and eat
the metered minutes the repo's other workflows depend on.

The cost reality (the file's header, `:1-58`, and step `j`, `:824-863`): the repo is
**private**, so `ubuntu-latest` = **2 CPU / 8 GB** metered at 2,000 min/month on
GitHub Free (the 4 CPU / 16 GB table is the public-repo one). A cold Gecko build is
12–28 h ≈ 720–1,680 min = the whole monthly allowance; `timeout-minutes: 720`
(`:146`) is GitHub's maximum, and the estimate exceeds it, so the first hosted run may
end in a plain cap timeout rather than a compile error. Past the quota it is
$0.006/min, and with no payment method on file usage *blocks* at the quota.
The free path is the commented-out `runs-on: self-hosted` block (`:114-142`).

Steps: `a` checkout with `fetch-depth: 0` (`:151-157`, because `git apply` needs the
tree the patches were made against); `b` the apt toolchain — the exact list that
satisfied `./mach configure` on this box, each package's failure named in a comment
(clang-19/llvm-19, cbindgen, nasm/yasm, ccache, mercurial, autoconf2.13, GTK/ALSA/XT
dev headers, `/usr/lib/llvm-19/bin` onto PATH) (`:164-204`); `c`/`c2` rustup with
`--default-toolchain none` so the **source's own** `rust-version` (1.90.0) decides,
then `cargo install cbindgen --locked` (`:206-237`); `d1` `curl -C -` resumable
download (`:238-249`); `d2` **checksum verification against Mozilla's published
`SHA512SUMS`, read at workflow time, never hardcoded** — plus a cross-check against the
locally recorded sha512 so a re-cut release fails loudly instead of building something
else (`:250-281`); `d3` full extraction and a hard assert on every subtree the local
box had to dig out on demand, `browser toolkit modules config python mach dom security
build intl testing` plus `configure.py`/`GNUmakefile`, with the stale nested
`firefox-156.0.1/` duplicate removed (`:282-331`); `e1` ccache restore keyed on
`GECKO_VERSION` + `hashFiles('patches/*.patch','patches/*.toml')` with deliberately
**stable** keys (no `run_id` in the restore key — a key that changes every run can
never hit) and prefix restore-keys (`:332-351`); `e2` the `.mozconfig`, every option
commented with its source citation — `--enable-application=browser`, `MOZ_OBJDIR=obj-ziy`,
`MOZ_PARALLEL_BUILD=2` (the runner's core count; `-j4` on 2 cores oversubscribes),
`--disable-artifact-builds` (artifact mode downloads prebuilt C++ and cannot change
C++/Rust, which is the whole point of the job), `--disable-tests`,
`--disable-optimize`, `--disable-debug-symbols`, `MOZ_TELEMETRY_REPORTING=`,
`--without-wasm-sandboxed-libraries`, `--with-ccache`, and the gate
`--enable-ziy-fingerprinting` **on by default** "because a patch set that never runs is
a patch set nobody notices is broken" (`:352-497`); `f` the patch loop — `git apply
--check` dry-run **first** so a rejected patch writes nothing, then `--stat`, then the
apply, collecting failures instead of aborting on the first (`:498-586`), then the
**post-apply assertion**: `toolkit/ziy-fingerprinting.configure` and
`nsRFPService.cpp` exist, `toolkit/moz.configure` contains
`include("ziy-fingerprinting.configure")`, and `nsRFPService.cpp` carries
`MOZ_ZIY_FINGERPRINTING` — because the failure that looks like success is the file
landing on disk while configure never read it (`:555-586`); an empty patch set is a
clean no-op (`:591-594`); TOML patches are listed but **not** applied here (they belong
to packaging, `:595-602`); `g1` `./mach configure` (`:587-596`); `g2` `mach build`
under `/usr/bin/time -v` with `PIPESTATUS` checked through the pipe (`:597-609`);
`g3` `ccache --show-stats` (`:610-614`); `g4` `mach package`, reading
`dist/package_name.txt` rather than guessing the tarball name, printing the
`libxul.so` path as the relinkability evidence (`:615-656`); `g5`/`g5b` the ccache save
with `if: always()` — three keys, the stable one first so the next run gets an
exact-key hit, the run-scoped one as versioned history, so a **timed-out** run's
compilation is not thrown away (`:657-690`); `h` artifact upload of the dist tarballs
plus `build-time.log`, 7-day retention, `if-no-files-found: error` — the objdir is
deliberately not uploaded (`:691-718`); `i` the smoke test: throwaway `mktemp -d`
profile, `HOME` redirected, `--headless=new --screenshot --window-size=1280,720`,
assert on the output rather than the exit code (headless can exit non-zero after a
good screenshot), then a PIL non-blank check (more than one colour, dominant share
< total) (`:719-793`); `i2` the engine identity: the built `firefox --version` must
contain `GECKO_VERSION` — this job asserts the **engine** half, `build-shell.sh`
asserts the Ziy half (`:795-823`).

### 4.2 `replica/architecture.md` §0.5 — the other workflows (planned, NOT yet written)

`replica/architecture.md:147-203`. Decision: small builds local, heavy platform builds
on GitHub Actions. The header explicitly says these files "come later, in the build
plan — this section documents the shape only; nothing under `.github/workflows/` exists
yet" (`:163-165`), and today only `build-gecko.yml` exists (verified
`find .github -type f`).

| file | trigger | content |
|---|---|---|
| `ci.yml` | push + PR | `ubuntu-latest`: `npm ci`, node tests for the extension suite, then `tools/verify.sh`, plus an off-box `tools/build-shell.sh` run so every push is verified on a clean machine — same script, no fork |
| `build-windows.yml` | push / release / manual | `windows-latest`: `tools/build-shell.ps1` + `build-extension.sh` + `install-native.ps1` + `bootstrap-profile.py`, then Inno Setup or NSIS in `packaging/windows/`; artifacts portable zip + installer |
| `build-android.yml` | push / release / manual | `ubuntu-latest`: Android SDK setup, Gradle build of the `android/` module, GeckoView from Mozilla's Maven repo, `actions/upload-artifact`; artifacts unsigned + signed APK, the signed one gated on repo secrets |

Recorded mitigation for minutes: run the heavy workflows on release tags and manual
dispatch, not on every PR. Signing material never enters the repo.

---

## 5. THE C++ PATCH SET

Directory: `patches/` — 4 patches + `README.md`. **All authored and apply-verified;
none compiled.** The compile-first happens in `build-gecko.yml` step `f`/`g2`.

| patch | touches | one-line delta |
|---|---|---|
| `0001-rfp-colorscheme-carveout.patch` | `toolkit/components/resistfingerprinting/nsRFPService.cpp` | Reads the engine's own overrides pref inside `HandleExceptionalRFPTargets()` and returns `false` for `CSSPrefersColorScheme` under RFP: `IsRFPEnabledFor()` (`:335`) returns true for **every** target in RFP mode before it consults the override set, which made the shell's `+AllTargets,-CSSPrefersColorScheme` pref dead code |
| `0002-ziy-fingerprinting-option.patch` | new `toolkit/ziy-fingerprinting.configure` + one `include()` line in `toolkit/moz.configure` | Declares `--enable-ziy-fingerprinting` and `set_define("MOZ_ZIY_FINGERPRINTING", …)`; adds `include("ziy-fingerprinting.configure")` to `toolkit/moz.configure` (configure loads exactly one entry point — a file that merely exists is never executed) and a `configure_error()` sanity check that fails if the gate and the shipped `-CSSPrefersColorScheme` override disagree |
| `0003-webgpu-adapter-strings.patch` | `dom/webgpu/Adapter.cpp` (3 hunks) | Empties the four unreachable-by-RFP `[ChromeOnly]` adapter strings `wgpuName`/`wgpuDeviceType`/`wgpuDriver`/`wgpuDriverInfo` under RFP, reusing the engine's existing `WebGPUIsFallbackAdapter` target (the standard `vendor`/`architecture`/`device`/`description` are already empty in stock Gecko). Deliberately no new RFPTarget, which would change the meaning of the locked target string |
| `0004-webgl-fake-extension.patch` | `dom/canvas/ClientWebGLContext.cpp` (1 hunk, +58) | Appends one fake extension name to `getSupportedExtensions()` under RFP, drawn from the real Khronos namespace but **not** in the `GetExtensionName()` table so `getExtension(fake)` returns null; an `alreadyListed` guard keeps it idempotent. Partial versus Brave's row 15 by design: Brave draws the fake name per site from 21 candidates, which needs a per-site entropy source not yet implementable on the Gecko side |

The privacy workstream's contribution is 0003+0004 (both cite
`replica/proofs-cpp-fingerprint.md`); 0001+0002 are the fingerprinting workstream's.
Each of 0003/0004 asserts in its commit message that the `#ifdef` blocks are shaped so
stripping the gate from the patched file yields a file **byte-identical** to pristine.

**The gate macro is `MOZ_ZIY_FINGERPRINTING`**, set from
`--enable-ziy-fingerprinting`, ON by default in the CI `.mozconfig`. Why a *declared
option* and not a bare `-D`: `./mach configure` hard-fails on any option it does not
recognise (`"Unknown option: %s"`), so an undeclared `-D` aborts configure before a
single file compiles. The macro reaches every TU through `mozilla-config.h`.

**`patches/README.md` — how to add one** (steps, `README.md` "How to add one"):
ground the change in real source with line numbers first; edit a scratch copy;
generate the diff with `diff -u --label a/tree-relative/path --label b/…` against a
pristine copy (never `git diff` in a dirty tree); prepend a commit header carrying the
why and the citations; verify with
`git init && git add -A && git commit -qm base && git apply --check -v` against a real
extraction — "a patch you have not checked against the real tree is not finished";
prove the gate-off path (`cmp` clean against pristine); add an index row and update
`replica/deep-fork.md` §6.6. Format rules enforced by CI: `a/`/`b/` prefixes, paths
relative to the source-tree root, strictly increasing `NNNN-<slug>.patch` numbering,
one file per logical change, commit-message header strongly preferred. **Idempotency
is explicitly NOT required or assumed** for source patches (unlike the omni.ja
patches): a re-applied source patch fails `git apply --check` and stops the build on
purpose. Two patch kinds live in the repo and are applied at different times —
`*.patch` (C++/configure) by CI step `f` against the pristine source tree, `*.toml`
(omni.ja byte rewrites) by `build-shell.sh` §7b against the packaged app dir; TOMLs
are **not** re-applied in CI and do not belong in `patches/`.

Known staleness to fix when touching this file: `patches/README.md`'s status line and
index say "2 patches" and list only 0001–0002; 0003 and 0004 are on disk and are not
yet in the index (the CI loop `for p in patches/*.patch` picks all four regardless).

---

## 6. THE BRAND PIPELINE

Where brand assets come from (`tools/build-shell.sh:112-123`):
`BRAND_SRC="$ROOT/brand"`; if `brand/logo.svg` exists it is `ICON_SOURCE`, else
`shell/brand-fallback/logo.svg` (`:115-119`). Then
`shell/brand-fallback/render-icons.py` rasterises into
`build/ziy/chrome/icons/default/` (`:121`), the chosen SVG is installed as
`chrome/icons/default/ziy.svg` (`:122`), and the largest produced PNG becomes
`build/ziy/ziy.png` (`:123`).

`shell/brand-fallback/render-icons.py` picks its backend in this order
(`:130-141`): **(1) `brand/ziy.png` passthrough** — copy the master PNG byte-for-byte
into every size slot (`passthrough_brand_png`, `:33-43`), because the co-owner's
decision (2026-10-15) is that their master PNG *is* the icon, so every consumer reads
identical bytes; **(2) cairosvg** rasterising `source_svg()` (brand/logo.svg, else the
fallback SVG) at the nine sizes (`:45-63`); **(3) a Pillow fallback** that draws the
geometric shield/lion mark with primitives when cairosvg is absent (`:65-127`). It then
also writes a plain `ziy.png` at the largest size the backend produced
(`:142-147`). Sizes: 16, 22, 24, 32, 48, 64, 96, 128, 256 (`:28`). Verified on this
box: `cmp brand/ziy.png build/ziy/chrome/icons/default/logo-256.png` is identical —
the passthrough path is what produced the current build, and the master is
1103×1104 RGBA.

`build-shell.sh:253-268` then lays the same PNGs into
`build/share/icons/hicolor/<size>x<size>/apps/ziy.png`, falling back to `build/ziy/ziy.png`
for any size the renderer did not produce. `tools/install-desktop.sh:77-82` consumes
that tree verbatim (§3.2).

Brand repo rules: `brand/README.md` (488 B) names the drop-in filenames
(`logo.svg`, `logo-{16,22,24,32,48,64,96,128,256}.png`, `ziy.png` (256),
`logo-dark.svg`, `logo-inactive.svg`, `wordmark*.svg`) and says to
"replace the placeholder 1:1, don't delete anything else". The **app icon is the
sealed-eye shield**; the cat mascot (`brand/MASCOT.md`, palette measured from the
co-owner's own art) is personality surfaces only — welcome screen, about panel,
empty/loading states — and must never be the app icon, a toolbar icon, a hicolor
entry, a manifest `icons{}` entry, a favicon, or a state indicator
(`replica/AI-BRIEF.md` §3, "Icon / mascot").

**How to replace brand assets 1:1:** drop the new master at `brand/ziy.png`
(256×256 is the documented slot; it is copied unchanged into every size) and the
vector at `brand/logo.svg` (it becomes `chrome/icons/default/ziy.svg` and the hicolor
`scalable/apps/ziy.svg`), then re-run `./tools/build-shell.sh --force`. Nothing else
in the tree names the icon; a missing `brand/` falls back to
`shell/brand-fallback/logo.svg` automatically, and `install-desktop.sh` re-installs
from the build's tree. To replace a raster at a specific size only, overwrite the
matching `brand/logo-<size>.png` — but note the passthrough rule means `brand/ziy.png`
wins for every slot whenever it exists.

---

## 7. THE NO-LOCAL-GECKO-COMPILE POLICY

`replica/deep-fork.md` §0 (co-owner decision). **This box never compiles Gecko**: no
`./mach build`, no `./mach configure`, no `autoconf`, no rustc/cargo Gecko builds, no
ccache-heavy jobs — "not occasionally, not 'just once for a proof', not in the
background". Compilation happens ONLY on CI
(`.github/workflows/build-gecko.yml`, `workflow_dispatch` or a `v*`/`gecko-*` tag) or
on a future self-hosted runner registered explicitly by the co-owner.

Reason (measured, `replica/AI-BRIEF.md` §2.3 and `deep-fork.md` §0): the co-owner uses
the machine interactively and a heavy build lags it to unusability. The box is a
**4-core Haswell i5 with ~3.4 GB available RAM** (7.6 GiB total, 5.8 GiB swap), 228 GB
disk with 115 GB free, and a **1 MB/s** network; the `libxul` link is a single ~5 GB
process, which is the named OOM risk (§6.5/§6.6) — a multi-hour `-j4` build would pin
every core for 6–14 h and thrash swap while someone is trying to work.

Still allowed, because it is CPU-light and sub-minute: `git apply` against `/tmp`
copies of the source, byte-level omni.ja patching, pref/layer checks, and
`tools/build-shell.sh`. Anything unavoidable above ~60 s of sustained CPU must run
`nohup` + `nice`/`ionice` and be declared in its report line. Any `tools/` or `shell/`
script that would launch a local Gecko build must carry a policy guard — a loud error
naming `replica/deep-fork.md` and the workflow, then `exit 1`.

Also relevant: the source tarball is ~800 MB at ~1 MB/s (~2 h, acceptable exactly
once), and `/tmp` is reboot-volatile — anything worth keeping must be consumed into a
proof doc or moved into the tree (`AI-BRIEF.md` §5 rule 12). `compile-readiness.md`
§5/§5b records the runner-cost analysis and the near-ready self-hosted path.

---

## 8. `.gitignore` — GENERATED VS SOURCE

Rules, with the reason each exists (`.gitignore:1-54`):

| pattern | state | why |
|---|---|---|
| `build/` | **generated** by `tools/build-shell.sh` (plus the xpi build and `verify.sh` artifacts) | 323 MB as of 2026-10-15, containing files of 177/53/44 MB that exceed GitHub's 100 MB per-file limit; everything is derived from tracked `tools/`, `shell/`, `extensions/`, so committing it only guarantees disagreement. `replica/compile-readiness.md` §6 is the measurement |
| `*.xpi` | **generated** by `tools/build-extension.sh` — but note the install point | outputs, not inputs; deliberately commit one with `git add -f` if ever needed. The xpis in `build/ziy/distribution/extensions/` are build outputs **and** the install point build-shell.sh step 8 copies from |
| `node_modules/`, `**/node_modules/` | absent today, listed so a future `npm install` cannot sneak one in | — |
| `.ziy/`, `shell/.ziy/` | runtime/state | `bootstrap-profile.py` profile state, build scratch |
| `__pycache__/`, `*.py[cod]`, `.mypy_cache/`, `.pytest_cache/` | caches | `tools/lib/*.py` themselves are tracked |
| `.DS_Store` `Thumbs.db` `*.swp` `*~` `.idea/` `.vscode/` | OS/editor cruft | — |
| **not** ignored: `replica/screens/` (4.8 MB), `patches/`, `tools/`, `shell/`, `extensions/`, `.github/` | **source** | screenshots are documents, not binaries; the rest is hand-written source |

Tracked input is `extensions/`, `shell/`, `tools/`, `server/`, `native/`; tracked
build configuration is `shell/` (application.ini, prefs, mozilla.cfg, ziy.desktop,
launcher.sh, distribution/*, brand-fallback/) and `shell/omni.ja.patch/` (the patcher +
its README + the cached policies schema). `package.json` has **no dependencies**
(npm workspaces only; `npm test` = `node --test extensions/*/test`) and there is no
lockfile on disk — `npm ci` in `replica/deploy.md` is aspirational for now; `npm test`
works without it.

Empty placeholder dirs exist at the repo root (`but/`, `chrome/`, `firefox/`, `not/`,
`or/`) — artifacts of the path name, not build inputs.

---

## 9. CLEAN REBUILD FROM A FRESH CLONE — THE EXACT SEQUENCE

Prerequisites on the box (already present): `python3` 3.12 (stdlib only; `jsonschema`
4.26 and `Pillow` 10.2 installed), a Firefox install at `/usr/lib/firefox` (156.0.1
verified), `node` (optional, tests only). Nothing in the sequence writes to the
Firefox install or to `~/.mozilla`.

```bash
# 0. get the tree (no git remote exists yet; gh repo create is the co-owner's action)
git clone <repo> ziy && cd ziy        # or unzip the tree

# 1. unit tests for the extension suite (optional but recommended, ~1 min)
npm test                              # = node --test extensions/*/test

# 2. build the app dir — this is the whole product shell
./tools/build-shell.sh --force        # -> build/ziy/
#    discovery/validation of the engine at /usr/lib/firefox, cp -a the tree,
#    install application.ini + prefs + mozilla.cfg, PREFLIGHT the pref layer,
#    render brand icons, patch omni.ja (signing) and browser/omni.ja (newtab),
#    generate + schema-validate policies.json, install the launcher, desktop entry
#    and the hicolor tree under build/share/icons/hicolor/

# 3. package the suite — one deterministic xpi per extension
./tools/build-extension.sh --all      # -> build/ziy/distribution/extensions/<id>.xpi
./tools/build-extension.sh --check    # id/filename agreement + manifest present

# 4. the shell build no longer has to run again for the suite to be installed;
#    step 2 copies from the same directory, so re-run 2 only when step 3 changes:
./tools/build-shell.sh --force        # only if you want the xpis re-copied

# 5. create the profile the product owns
./tools/bootstrap-profile.py          # -> ~/.ziy/profiles/default/

# 6. the full acceptance harness (11 sections; --help filters)
./tools/verify.sh                     # or: npm run verify

# 7. launch
./tools/ziy                           # boots ~/.ziy/profiles/default
./tools/ziy --profile work            # a different profile
./tools/ziy --headless -H URL         # headless, for scripts and CI

# 8. optional per-user desktop integration (idempotent; never changes defaults)
./tools/install-desktop.sh --dry-run  # see what it would do
./tools/install-desktop.sh            # install .desktop + hicolor icons
./tools/install-desktop.sh --set-default   # prints the xdg-settings command

# 9. optional: the sync agent's native registration (asks; never automatic)
node tools/install-ziy-sync-native.js --dry-run
node tools/install-ziy-sync-native.js
```

Engine bumps / patching the engine source: read `replica/deep-fork.md` §7 for the
`update-engine.sh` procedure (note: that script is **not yet on disk**) and §0 for the
no-local-compile rule. The C++ patch set is applied by CI only; locally,
`git apply --check` against a `/tmp` copy is allowed and is the documented
verification (`patches/README.md` step 5).

---

## 10. THE 3 THINGS MOST LIKELY TO BREAK ON A REBUILD

1. **A missing or non-standard engine install** — `build-shell.sh` dies at stage 1
   (`:54-66`) unless the candidate has an executable `firefox` **and both**
   `omni.ja` and `browser/omni.ja`. Symptoms: "no Firefox install found (use --engine
   PATH, or set ZIY_ENGINE)". Fix by pointing at the real install with
   `--engine PATH` or `ZIY_ENGINE=...`. A snap/flatpak Firefox, or a partial copy,
   trips the second check. Same failure mode for `policies-gen.py`, which needs a
   `browser/omni.ja` to read `policies-schema.json` from (`:150-176`; it falls back to
   the cached `shell/omni.ja.patch/policies-schema.json` only if no engine is found).

2. **The omni.ja precondition failures on an engine bump** — both patchers refuse
   loudly rather than shipping an unpatched engine. If Firefox moves or rewords either
   AppConstants boolean, `patch-omni.py` exits 1 with
   `PRECONDITION FAILED: modules/AppConstants.sys.mjs does not contain
   'MOZ_REQUIRE_SIGNING: true,'` and `build-shell.sh:176-181` dies with "browser/omni.ja
   newtab strip failed"; if the newtab member's `manifest_version` is no longer 2, the
   same happens for the newtab strip. The re-verification in `verify.sh:119-123` will
   also fail. Both are deliberately loud: a silent no-op would ship an unpatched
   engine. The fix is to re-derive the patch against the new engine, not to delete the
   check.

3. **The pref layer tripping the preflight gate (or an engine that reads a pref
   differently)** — `preflight-prefs.py` stops the build on an unparseable
   `granularOverrides` (must be a quoted JSON array), a bad RFP target string, a lock
   in `mozilla.cfg` with no matching default in `ziy.js`/`ziy-hardening.js`, two layers
   giving a pref different values, or a non-world-readable `mozilla.cfg`. This is the
   class of bug that previously cost a debugging session (JSON array vs `true` aborting
   autoconfig and crashing the graphics layer), so a failure here is the gate doing its
   job — but it will also break a rebuild after an engine upgrade if a pref name is
   renamed upstream. The dead-pref audits in `policies-gen.py:55-127` and
   `mozilla.cfg:58-86` are the record of that hunt; do not re-add the deleted names.

Runners-up worth watching: `--force` is required once `build/ziy` exists (stage 2
exits 0 early without it, `:70-75`), and `Pillow` must be importable for
`install-desktop.sh`'s icon-size verification (`:200-216`) — absence is reported as
"could NOT do", not a hard failure.
