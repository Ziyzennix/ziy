# Proofs — what was verified on this machine, and how

Date: 2026-10-14 · machine: i5-4590 (4c), 7.6 GB RAM, Linux Mint (X11/Cinnamon),
Firefox **156.0.1** at `/usr/bin/firefox` → `/usr/lib/firefox/firefox`
(Mint wrapper). Every claim in `architecture.md` §1 and §2 traces to a row here.

## Engine facts (fetched docs)

| claim | source |
| --- | --- |
| Firefox 156 released 2026-09-15; `theme.backgrounds_area` added for add-on devs | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/156 |
| MV3 key list: `action`, `browser_action` is MV2-only, `sidebar_action`, `declarative_net_request`, `theme`, `user_scripts` MV2-only, `externally_connectable` **not supported in Firefox**, `storage` manifest key **not supported in Firefox** | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json |
| DNR: blocking/upgrading needs **no host permissions**; full rule/action/priority semantics; ruleset precedence session > dynamic > static (Gecko); cross-browser rule ordering documented | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest |
| `webRequest` blocking listeners (`webRequestBlocking`) documented as supported — this is what uBO-on-Firefox uses | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest |
| `sidebarAction`: Firefox has **no** `setBadgeText`/`onFocus`/`onBlur`; Chrome's `sidePanel` is not compatible | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction |
| `background.service_worker` **not supported** (bug 1573659); `scripts` supported in MV3; cross-browser recipe declares both | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background |
| `scripting` supported in MV2 **and** MV3 on Firefox | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting |
| `storage.local` quota = IndexedDB quota on Firefox; cleared on uninstall unless `keepStorageOnUninstall` | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local |
| Native messaging: `allowed_extensions` in the app manifest (Firefox) vs `allowed_origins` (Chrome); stdio framing | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging |
| Policy `Preferences` supports `privacy.fingerprintingProtection.*` and `privacy.baselineFingerprintingProtection.*` (Firefox 141+), `Status` in `default|locked|user|clear` | https://firefox-admin-docs.mozilla.org/reference/policies/preferences/ |
| `Extensions.Install` accepts URLs or native paths; `ExtensionSettings` is the successor with `installation_mode`/`install_url` | https://firefox-admin-docs.mozilla.org/reference/policies/extensions/ |
| `/etc/firefox/policies` and `<install>/distribution` locations; `3rdparty` policy for `chrome.storage.managed` | https://mozilla.github.io/policy-templates/ |
| Fingerprint targets incl. `CanvasRandomization`, `WebGLRenderInfo`, `NavigatorHWConcurrency`, `JSLocale`, `ScreenRect`, `ReduceTimerPrecision`; `granularOverrides` syntax `+AllTargets,-CSSPrefersColorScheme` | https://searchfox.org/firefox-main/source/toolkit/components/resistfingerprinting/RFPTargets.inc and .../FingerprintingWebCompatService.sys.mjs |

## Local mechanism facts (commands run, 2026-10-14)

| # | claim | command / evidence | result |
| --- | --- | --- | --- |
| 1 | A copied Firefox tree runs as our own app | `cp -a /usr/lib/firefox/. ziyapp/`, added `browser/application.ini` (`Name=Ziy`, `ID={a7f2…}`), `browser/defaults/pref/ziy.js`, `mozilla.cfg`; `cd ziyapp && ./firefox --headless --profile /tmp/…/prof3 --screenshot s.png about:blank` | `ps` showed `firefox … -greomni /tmp/lhprobe/ziyapp/omni.ja -appomni /tmp/lhprobe/ziyapp/browser/omni.ja -appDir /tmp/lhprobe/ziyapp/browser`; 5.7 KB PNG produced → **our own app dir runs** |
| 2 | `browser/defaults/preferences/` is a real load path | read `nsXREDirProvider.cpp` from source: `kAppendPrefDir = {"defaults","preferences"}` appended to `mXULAppDir` unconditionally in `GetFiles(NS_APP_PREFS_DEFAULTS_DIR_LIST)` | confirmed by source (note: `pref()` *default* values never appear in `prefs.js`, so this is not observable in a headless prefs dump — that is expected, not a failure) |
| 3 | `distribution/` resolves from the **GRE root**, not the app dir | `nsXREDirProvider.cpp`: `XRE_APP_DISTRIBUTION_DIR = GetFile(NS_GRE_DIR) + "distribution"` | confirmed by source |
| 4 | `distribution/extensions/<id>.xpi` is installed | probe profile gained `user_pref("extensions.installedDistroAddon.ziy-probe@ziy.local", true)` in `prefs.js`, and `XPIProvider.sys.mjs` `installDistributionAddons()` + `getExpectedID()` shows the filename must equal the add-on id | **verified end-to-end** |
| 5 | Release build enforces add-on signing | extracted from `/usr/lib/firefox/omni.ja`: `modules/AppConstants.sys.mjs` → `MOZ_REQUIRE_SIGNING: true, MOZ_ALLOW_ADDON_SIDELOAD: false`; `modules/addons/AddonSettings.sys.mjs` turns them into constants in release builds; `XPIDatabase.sys.mjs isCorrectlySigned()` rejects `signedState <= SIGNEDSTATE_MISSING` for `app-profile` | **explains why a hand-placed xpi is silently ignored** |
| 6 | Those constants exist **only** in the JS module | `strings -a /usr/lib/firefox/firefox-bin \| grep -c MOZ_REQUIRE_SIGNING` → `0`; `libxul.so` → no match; `omni.ja` → present | **patchable by configuration** |
| 7 | The module is stored (uncompressed) and byte-length-patchable | parsed `omni.ja` central directory manually (zipfile fails on the 4-byte-prefixed archive); `AppConstants.sys.mjs` had `method 0, csize 6084`; rewrote it in place with the two booleans flipped, same length, all offsets intact | `patched-test.ja` written, byte size unchanged |
| 8 | `--profile <existing dir>` works; `--CreateProfile` does not (headless) | `firefox --headless --CreateProfile "…"` on our binary → "Could not find profile folder"; `--profile` against a copied profile dir → worked, PNG produced | drives the bootstrap design: **we create the profile skeleton ourselves** |
| 9 | `about:home` cannot be screenshotted headless on 156 | several `--screenshot … about:home` runs all timed out / exited "channel error" while `about:blank` succeeded every time | recorded as risk #3; NTP is verified by DOM + a headed run |
| 10 | WebCrypto is sufficient, no external crypto dep | `node -e "… subtle.generateKey({name:'Ed25519'}) … HKDF deriveBits …"` | `Ed25519 OK`, `X25519 OK`, `P-256 OK`, `HKDF OK 32 bytes` (secp256k1 is **not** available → the wallet uses a native helper for EVM signing) |

## Not verified / known limits

- Autoconfig (`mozilla.cfg`) could not be confirmed *behaviourally* headless: a
  `pref()` default never lands in `prefs.js`, and the only high-signal probe
  (a homepage override screenshotting `about:home`) is blocked by fact (9). The
  mechanism itself is documented in `nsReadConfig`/`Preferences.cpp` and in bug
  861775 (`browser/defaults/preferences`, plural). **`tools/verify.sh` must
  assert this on the first headed run** — that is the first acceptance item in
  slice 1.
- Whether `--install-global-extension` or `extensions.sideloadScopes` provide a
  second install path was not exercised; `distribution/extensions/` (fact 4) is
  sufficient and is the path the build script uses.
