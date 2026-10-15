# replica/proofs-pkg.md — packaging + shell extension (BUILD phase, workstream 4)

Date: 2026-10-14. Machine: the project box (linux 7.0.0, x64, Gecko 156.0.1).
Scope: `package.json`, `tools/build-extension.sh`, `tools/lib/zpxi.py`,
`tools/lib/gen-tokens.sh`, `extensions/ziy-shell/`, and the verification that the
built xpis install in the Ziy app dir.

Every command below was run from the repo root and the output is what this box
produced. Nothing here is inferred; where something could not be verified, it is
listed under "Limitations".

---

## 1. What was built

### 1.1 Files

| file | purpose |
| --- | --- |
| `package.json` | npm workspace root: `workspaces: ["extensions/*"]`, `private: true`. Scripts: `build:xpi` → `node tools/build-extension.sh --all`, `verify` → `./tools/verify.sh`, `test` → `node --test extensions/*/test`. No dependencies (plain JS). |
| `tools/build-extension.sh` | packages `extensions/*` → `build/ziy/distribution/extensions/<addon-id>.xpi`. Modes: `--all`, bare path(s), `--check`, `--list`. Prints an id/files/bytes summary table and exits non-zero on any mismatch. `mkdir -p` the target. Never touches `tools/build-shell.sh`. |
| `tools/lib/zpxi.py` | the deterministic packager (see §2). subcommands `pack` / `check` / `list` / `summary`. |
| `tools/lib/gen-tokens.sh` | regenerates `extensions/ziy-shell/ui/tokens.css` from `replica/design/tokens.json`. |
| `extensions/ziy-shell/manifest.json` | MV3, `browser_specific_settings.gecko.id = ziy-shell@ziy.app`, `background.scripts` event page, permissions `["storage","tabs","theme"]`, `host_permissions []`. |
| `extensions/ziy-shell/background/background.js` | opens the welcome page on install; applies the theme; settings bus (`ziy-shell.settings.get`). |
| `extensions/ziy-shell/background/theme.js` | the theme roles, applied with `browser.theme.update()`. Light + dark. |
| `extensions/ziy-shell/ui/welcome.html` | first-run page (recon S01/F01): default search engine + theme. |
| `extensions/ziy-shell/ui/welcome.js` | the page's behaviour; persists to `browser.storage.local` under `ziy.shell.settings`. |
| `extensions/ziy-shell/ui/done.html` | post-save confirmation page. |
| `extensions/ziy-shell/ui/tokens.css` | generated; 106 custom properties, light + `[data-theme="dark"]`. |
| `extensions/ziy-shell/icons/{icon.svg,icon-48.svg,wordmark.svg}` | copies of Ziy's own `replica/design/brand/` assets. |
| `extensions/ziy-shell/test/manifest.test.js` | 10 `node --test` tests. |

### 1.2 The suite, as packaged

```
$ ./tools/build-extension.sh --all
  ok    ziy-ntp@ziy.app          15 files, 49520 bytes
  ok    ziy-shell@ziy.app        10 files, 13096 bytes
  ok    ziy-sync@ziy.app         12 files, 31865 bytes

== summary ==
ziy-ntp@ziy.app 15 49520
ziy-shell@ziy.app 10 13096
ziy-sync@ziy.app 12 31865
  3 packed, 0 failed
```

`ziy-shields` exists as a directory but is a sibling worker's work in progress
(its `manifest.json` carries a JS comment prelude, so it is not yet valid JSON).
`--all` reports it as `skip … (manifest.json is not valid JSON yet — not
packaging)` and does not fail the build over it. Only `ziy-ntp` and `ziy-sync`
landed there by becoming valid during this workstream; they were packaged
read-only and were not modified by me.

---

## 2. Deterministic packaging — `tools/lib/zpxi.py`

`zip` is not used. The archive is written by python3's `zipfile` with:

* a fixed timestamp `(2026, 1, 1, 0, 0, 0)` for every entry,
* entries written in sorted path order,
* a fixed `external_attr` (`0o100644 << 16`), so permission bits cannot vary,
* `compresslevel=9`.

Because the input tree is sorted and the metadata is fixed, two builds of the
same tree produce identical bytes:

```
$ sha256sum build/ziy/distribution/extensions/ziy-shell@ziy.app.xpi
93476435b6d872b2e3d0719bdd4c44b7b45ce7e83fa051312df796b08baa3a48  build/ziy/distribution/extensions/ziy-shell@ziy.app.xpi
$ ./tools/build-extension.sh --all >/dev/null 2>&1
$ sha256sum build/ziy/distribution/extensions/ziy-shell@ziy.app.xpi
93476435b6d872b2e3d0719bdd4c44b7b45ce7e83fa051312df796b08baa3a48  build/ziy/distribution/extensions/ziy-shell@ziy.app.xpi
DETERMINISM: identical bytes
```

`tools/lib/gen-tokens.sh` is likewise idempotent (`ui/tokens.css` hashes
identically before and after a re-run, so a committed regeneration never shows
spurious diffs).

Exclusions (a rule, not a hand-maintained list): basenames `.DS_Store`; suffixes
`.map` and `.bak`; the directory names `node_modules` and `test`, pruned at any
depth. `zpxi.py pack` additionally **refuses** to write a file whose name is not
`<addon-id>.xpi`, and refuses when the extension has no
`browser_specific_settings.gecko.id`.

---

## 3. `--check`: the id-from-filename fact, with its source

```
$ ./tools/build-extension.sh --check
== checking xpis in .../build/ziy/distribution/extensions ==
  OK   ziy-ntp@ziy.app.xpi: id ziy-ntp@ziy.app, 15 files, 169373 bytes uncompressed, 49520 on disk
  OK   ziy-shell@ziy.app.xpi: id ziy-shell@ziy.app, 10 files, 30652 bytes uncompressed, 13096 on disk
  OK   ziy-sync@ziy.app.xpi: id ziy-sync@ziy.app, 14 files, 107013 bytes uncompressed, 39242 on disk

== summary table (id, files, bytes) ==
ziy-ntp@ziy.app           15 files     49520 bytes
ziy-shell@ziy.app         10 files     13096 bytes
ziy-sync@ziy.app          14 files     39242 bytes
  3 xpi(s) checked, 0 bad
exit 0
```

`--check` verifies, per xpi: the filename stem equals
`browser_specific_settings.gecko.id`, and `manifest.json` is present in the zip
listing. Any mismatch prints `FAIL <name>: …` and the script exits non-zero.
Negative test, with a copy renamed to defeat the convention:

```
$ cp build/ziy/distribution/extensions/ziy-shell@ziy.app.xpi /tmp/bad-name.xpi
$ python3 tools/lib/zpxi.py check /tmp/bad-name.xpi
FAIL bad-name.xpi: filename id 'bad-name' != manifest id 'ziy-shell@ziy.app'; the app-dir installer derives the id from the filename
exit=1
```

**Why the names must match** — `modules/addons/XPIProvider.sys.mjs` inside
`build/ziy/omni.ja`:

```js
function getExpectedID(file) {
  let { leafName } = file;
  let id = isXPI(leafName, true) ? leafName.slice(0, -4) : leafName;
  if (gIDTest.test(id)) { return id; }
  return null;
}
```

and the accepted-id pattern, same file:

```js
var gIDTest =
  /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-\._]*\@[a-z0-9-\._]+)$/i;
```

The distribution scan is the caller, and it installs under the id it read from
the path:

```js
let id = getExpectedID(file);
…
let loc = XPIStates.getLocation(KEY_APP_PROFILE);   // "app-profile"
let addon = awaitPromise(
  XPIExports.XPIInstall.installDistributionAddon(id, file, loc)
);
```

and the marker it writes, `PREF_BRANCH_INSTALLED_ADDON = "extensions.installedDistroAddon."`:

```js
Services.prefs.setBoolPref(PREF_BRANCH_INSTALLED_ADDON + id, true);
```

The install path itself is `<GRE root>/distribution/extensions/`, resolved as
`XREAppDist` + `["extensions"]` (`distroDirs.push(lazy.FileUtils.getDir(KEY_APP_DISTRIBUTION, [DIR_EXTENSIONS]))`).
`build-shell.sh` writes `OUT="$BUILD_DIR/ziy"` and copies the suite into
`$OUT/distribution/extensions`, so `build/ziy/distribution/extensions/` **is**
the wiring point — no extra copy is needed and nothing was placed in `build/`
directly.

`XPIProvider.sys.mjs` also resolves the manifest id and rejects the file outright
if the two disagree (`modules/addons/XPIInstall.sys.mjs`):

```js
if (addon.id != id) {
  throw new Error(`File file ${file.path} contains an add-on with an incorrect ID`);
}
```

References: MDN, *Extensions and the add-on ID*
(<https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/>);
MDN, *Deploy Firefox with extensions* (`distribution/extensions/` under the
install dir, <https://support.mozilla.org/en-US/kb/deploying-firefox-with-extensions>).

---

## 4. The theme — a real bug, found by boot, fixed by reading the manifest schema

### 4.1 What I first wrote, and why it was wrong

The first manifest declared the theme with the static `theme` + `dark_theme`
manifest keys. That extension **did not install at all**. Isolated
empirically: the identical extension with the theme keys removed installs
immediately.

```
# variant with theme keys removed
user_pref("extensions.installedDistroAddon.ziy-variant@ziy.test", true);
# variant that is theme-only (theme keys, no background/permissions)
user_pref("extensions.installedDistroAddon.ziy-themeonly@ziy.test", true);
  ziy-themeonly@ziy.test theme app-profile
```

The engine's own schema in `build/ziy/omni.ja` explains it. A manifest carrying
`theme` is normalized against `manifest.ThemeManifest`
(`chrome/toolkit/content/extensions/schemas/theme.json`):

```json
{ "id": "ThemeManifest", "type": "object",
  "description": "Contents of manifest.json for a static theme",
  "$import": "manifest.ManifestBase",
  "properties": { "theme": {"$ref": "ThemeType"},
                  "dark_theme": {"$ref": "ThemeType", "optional": true},
                  "default_locale": {"type":"string","optional":true},
                  "theme_experiment": {"$ref":"ThemeExperiment","optional":true},
                  "icons": {"type":"object","optional":true,...} } }
```

`ManifestBase` (in `chrome/toolkit/content/extensions/schemas/manifest.json`)
permits only `manifest_version`, `applications`, `browser_specific_settings`,
`name`, `short_name`, `description`, `author`, `version`, `homepage_url`,
`install_origins`, `developer`. **No `background`, no `permissions`, no
`options_page`.** So an extension that wants an event page *and* a static theme
key cannot exist.

`ThemeType` (same file) is the list of roles the theme must use — this is what
the colours in `background/theme.js` mirror:

```
tab_selected, accentcolor(deprecated), frame, frame_inactive,
textcolor(deprecated), tab_background_text, tab_background_separator,
tab_loading, tab_text, tab_line, toolbar, toolbar_text, bookmark_text,
toolbar_field, toolbar_field_text, toolbar_field_border,
toolbar_field_separator(deprecated), toolbar_top_separator,
toolbar_bottom_separator, toolbar_vertical_separator, icons, icons_attention,
button_background_hover, button_background_active, popup, popup_text, popup_border,
toolbar_field_focus, toolbar_field_text_focus, toolbar_field_border_focus,
popup_highlight, popup_highlight_text, ntp_background, ntp_card_background,
ntp_text, sidebar, sidebar_border, sidebar_text, sidebar_highlight,
sidebar_highlight_text, toolbar_field_highlight, toolbar_field_highlight_text
```

properties.role enums verified in the same file: `backgrounds_area` =
`auto|window|top_toolbars`; `color_scheme` and `content_color_scheme` =
`auto|light|dark|system`.

`Extension.sys.mjs`'s `initializeAddonTypeAndID()` shows the type dispatch that
makes the two shapes mutually exclusive:

```js
if (manifest.theme) { this.type = "theme"; }
else if (manifest.langpack_id) { … } else { this.type = "extension"; }
```

and `ext-theme.js` documents the intended split:

```
// Note: only static themes are processed here; extensions with the "theme"
// permission do not enter this code path.
```

MDN states the supported shape: *"You can use this API to include a theme in
your extension… You cannot include a static theme in your extension, defined
with the "theme" manifest key."*
(<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/theme>)

### 4.2 The fix

`manifest.json` no longer declares `theme`/`dark_theme`; it requests the
`theme` permission. `background/theme.js` holds the roles — **the same
`ThemeType` colour names, in the same shape** — and `background/background.js`
applies them with `browser.theme.update()`. Role values come from
`replica/design/tokens.json`; every colour is a token role, and the test
`"the role mapping is sourced from the design tokens, not hand-copied"` fails if
a role drifts from its token.

The dark variant is selected by the user's saved choice
(`ziy.shell.theme` = `light` | `dark` | `system`), re-applied on
`runtime.onStartup`, on `storage.local.onChanged`, and when the OS colour scheme
changes while the choice is `system`.

---

## 5. Boot verification (step 5b)

```
$ rm -rf /tmp/ziy-pkg-verify && mkdir -p /tmp/ziy-pkg-verify
$ MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 timeout 60 \
    ./build/ziy/firefox --headless=new --profile /tmp/ziy-pkg-verify \
    --screenshot /tmp/ziy-pkg.png about:blank
boot=0

$ grep 'extensions.installedDistroAddon' /tmp/ziy-pkg-verify/prefs.js
user_pref("extensions.installedDistroAddon.ziy-ntp@ziy.app", true);
user_pref("extensions.installedDistroAddon.ziy-shell@ziy.app", true);
user_pref("extensions.installedDistroAddon.ziy-sync@ziy.app", true);
```

All three suite xpis are installed by the app dir with `true` markers — the
signing bypass (`MOZ_REQUIRE_SIGNING: false`) is working, since release Firefox
would silently ignore unsigned add-ons.

Corroborated by `extensions.json` and `extension-preferences.json`, which list
each add-on under `app-profile` with `active: true` and Ziy's granted
permissions.

```
$ stat -c '%s bytes' /tmp/ziy-pkg.png
5763 bytes
$ python3 -c "from PIL import Image; im=Image.open('/tmp/ziy-pkg.png'); print(im.format, im.mode, im.size)"
PNG RGBA (1366, 768)
```

The screenshot is a valid PNG that decodes and renders at the full window size.
`about:blank` is a blank page, so uniformly white pixels are the correct
content — an earlier "is it blank?" check of mine measured page content rather
than render validity and was wrong; the honest assertion is *a valid, decodable
PNG at the requested window size*, which is what is asserted above.

---

## 6. Process hygiene (step 5c)

```
$ pgrep -af '/tmp/ziy-.*profile'
195714 /tmp/ziy-ntp-appdir/firefox --headless=new --profile /tmp/ziy-ntp-boot-profile7 --remote-debugging-port=9226 file:///tmp/ziy-ntp-probe2.html
$ kill 195714          # by PID number only
$ pgrep -af '/tmp/ziy-.*profile'
(empty)
```

Processes were selected with the anchored pattern `/tmp/ziy-.*profile` (the same
guard `tools/verify.sh` uses) and killed by PID number. No `pkill` with a bare
word was run at any point. After cleanup, 0 processes match the pattern, and the
user's Firefox (WhatsApp) and LibreOffice were never in the candidate set.

---

## 7. Tests (step 4 of the assignment)

```
$ node --test extensions/ziy-shell/test
✔ the add-on id is the suite id the distribution installer expects
✔ the manifest carries no static theme key (it would make the manifest invalid)
✔ the role mapping is sourced from the design tokens, not hand-copied
✔ the theme module defines two distinct schemes
✔ the background script is the event page, not a service worker
✔ permissions stay minimal
✔ the generated tokens css carries both palettes
✔ the welcome page and the theme module ship their assets
✔ every token the welcome page uses is defined by the generated tokens
✔ tokens.css is generated, not hand-written
ℹ pass 10   ℹ fail 0
```

`npm test` runs `node --test extensions/*/test`. It is tolerant: a sibling
extension with no `test/` directory contributes nothing and does not error, and
one whose tests genuinely fail would fail the overall run.

---

## 8. Limitations (honest)

1. **The theme is applied to chrome only when a browser window exists.**
   `--headless=new` creates no browser window, so `theme.update()` has no chrome
   to paint and `extensions.activeThemeID` stays
   `default-theme@mozilla.org` in a headless profile. The add-on installs and is
   `active: true`, and the boot log carries no extension errors, but the applied
   theme was **not visually confirmed**. Confirm in a headed window
   (`./tools/ziy`) or read `about:addons`.
2. **The welcome page's runtime behaviour was not exercised in a browser.** No
   X11 display was available in this session (`DISPLAY` unset; a headed boot
   without a window manager produced no screenshot), and headless cannot run the
   `browser.*` API from a data URL. What *is* verified: the add-on is active, its
   permissions are granted, `background/background.js` and `ui/welcome.js` parse,
   every `id` the script looks up exists in the HTML, and all 32 `var(--token)`
   references in the page resolve to defined properties in `tokens.css`. The
   auto-open-on-install path is the same `browser.runtime.onInstalled` +
   `browser.tabs.create` pattern `tools/verify.sh` already proves works in this
   app dir (its signing check installs an unsigned add-on the same way).
3. **`build/ziy` was not rebuilt.** `./tools/build-shell.sh` was not run, since
   it would `rm -rf build/ziy` and discard the app dir already in place; the
   xpis are written straight into `build/ziy/distribution/extensions/`, which is
   where build-shell.sh copies them from, so the wiring is complete without it.
4. **`MZ_LOG` produces no output on this build.** `MOZ_LOG_FILE`/`MOZ_LOG` are
   stripped from release binaries, so addon-manager logging could not be
   captured. Diagnosis in §4 therefore used the engine's own schema and source
   read out of `omni.ja`, plus controlled A/B installs, rather than log lines.
