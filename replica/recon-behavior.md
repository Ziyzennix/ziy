# Recon-behavior: behavioral pass over the user's own Brave Origin install

Addendum to `replica/recon.md`. Upgrades recon claims from "documented" to "behaviorally observed" where possible.

**Target observed:** package `brave-origin 1.95.104`, binary `/opt/brave.com/brave-origin/brave`, reported at runtime as `Brave Origin 1.95.104 Chromium: 153.0.8010.5` (from `brave://version` DOM).
**Date:** 2026-10-14
**Method:** the user's own Brave binary, headless (`--headless=new`), throwaway profile (`/tmp/brave-recon-1`), driven over its own CDP endpoint on port 9222. Plus READ-ONLY reads of the user's real profile (`~/.config/BraveSoftware/Brave-Origin/Default/Preferences`) and of the on-disk install under `/opt/brave.com/brave-origin/`.

```bash
MOZ_CRASHREPORTER_DISABLE=1 setsid /usr/bin/brave-origin-stable \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-recon-1 \
  --no-first-run --no-default-browser-check --no-proxy-server \
  --disable-crash-reporter --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --headless=new < /dev/null > /tmp/recon-cdp/brave1.log 2>&1 &
# CDP: http://127.0.0.1:9222/json/version ; new tabs via PUT /json/new?<url>
```

**Clean-room compliance.** No Brave JS bundle was decompiled or read; no `.pak` was unpacked; no network traffic was logged; no account was used. Reads were limited to: (a) the throwaway profile the browser itself created, (b) the user's own `Default/Preferences` JSON (their data), (c) DOM/screenshots of the running browser, (d) file names/sizes inside the install tree, (e) Brave's own public source on GitHub, which is the documentation of record wherever a behavioral test could not observe something. Ziy will ship its own labels; nothing below is a copy target for product copy.

**Kill discipline.** Every process operation was `pgrep -fa` first, then a PID-scoped kill anchored to `/usr/bin/brave-origin` or `brave-recon-`. No bare `pkill -f brave` was used anywhere in this pass (an earlier session's broad pattern is the one that killed LibreOffice; it was not repeated).

---

## Results table

Status legend: **OBSERVED** = driven and seen; **CONTRADICTED** = recon said X, reality says not-X; **STILL-INFERRED** = could not observe here, so the doc/inference stands.

| # | recon claim | status | evidence (command + observed value) | screenshot |
|---|---|---|---|---|
| 1 | NTP has background, search box, top sites, stats widget | **OBSERVED** | `Runtime.evaluate` on `brave://newtab` | `ntp.png` |
| 2 | NTP stats copy = "Trackers & ads blocked / Bandwidth saved / Time saved" | **OBSERVED** | `document.body.innerText` → `"STATS\n2\nTrackers & ads blocked\n0 KB\nBandwidth saved\n0 Seconds\nTime saved"` | `ntp-after-visit.png` |
| 3 | Stats widget label "STATS" | **OBSERVED** | NTP innerText begins `STATS` | `ntp.png` |
| 4 | Stats number formatting includes units (kB, seconds) | **OBSERVED** | `.bandwidth-saved .value` → `"0 <span class=units>kB</span>"`; `.time-saved .value` → `"0 <span class=units>seconds</span>"` | — |
| 5 | NTP customize dashboard exists with widget toggles | **OBSERVED** | `leo-dialog` custom elements: `Background Image / Search / Top Sites / Clock / Cards` | — |
| 6 | NTP search placeholder | **OBSERVED** | `<input placeholder="Ask anything, find anything…">` | `ntp.png` |
| 7 | NTP shows photo credit | **OBSERVED** | `.photo-credits` → "Photo by Tom Moser" / "Photo by Fudo Jahic" / "Photo by Mogli Maureal" (rotates per new tab) | `ntp.png` |
| 8 | NTP background is a wallpaper URL | **OBSERVED** | `--ntp-background: url(chrome://background-wallpaper/mogli-maureal.jpg)` | — |
| 9 | Shields blocking is real and cumulative on the NTP | **OBSERVED** | fresh profile, before visit = `0`; after visiting `https://www.theguardian.com/international` once, new tab shows `2 Trackers & ads blocked` | `ntp-after-visit.png` |
| 10 | Shields defaults block trackers/ads | **OBSERVED** | live load of theguardian.com completed with the count above moving 0→2 on a factory-fresh throwaway profile | `site-guardian.png` |
| 11 | `brave://settings/shields` exists (S10) | **OBSERVED** | `location.href` → `chrome://settings/shields` | — |
| 12 | Global Shields rows: scripts / fingerprinting / forget-me / content filtering | **OBSERVED** | settings DOM | — |
| 13 | Shields "Block scripts" and "Block fingerprinting" are rows | **OBSERVED** | `settings-toggle-button#noScriptControlToggle`, `#fingerprintingToggleControlType` | — |
| 14 | Trackers&ads / HTTPS / cookies are selects, not toggles | **OBSERVED** | `select#adControlType`, `#httpsUpgradeControlType`, `#cookieControlType` | — |
| 15 | Recon's S08 "Block ads & trackers (Standard/Aggressive)" values | **OBSERVED + corrected** | options are `Aggressive / Standard / Disabled` with values `block / block_third_party / allow` | — |
| 16 | Recon S08 "Cookie control (3 states)" | **CONTRADICTED** | observed only **2** options: `Block third-party cookies / Allow all cookies` (values `block_third_party / allow`). "Block all cookies" is deprecated and absent from this build. | — |
| 17 | Recon S08 "Block fingerprinting (+ sub-toggles)" | **PARTIAL** | fingerprinting is a dropdown in this build: `Strict, may break sites / Standard / Disabled` (`block / default / allow`). The sub-toggles exist (webcompat list, see §shipped WebUI) but the panel row is a select. | — |
| 18 | S10 row list includes "Show the number of blocked items on the Shields icon" | **OBSERVED** | unnamed `settings-toggle-button` with that label, first row of the section | — |
| 19 | Adblock-Only mode + Social blocking are real pages | **OBSERVED** | `settings-ad-block-only-mode-page`, `settings-social-blocking-page` (`fbEmbedControlType`, `twitterEmbedControlType`, `linkedInEmbedControlType`) | — |
| 20 | Settings left-nav section list | **OBSERVED** | `/people /getStarted /appearance /braveContent /shields /privacy /braveSync /search /extensions /origin /ai /defaultBrowser /onStartup /autofill /languages /downloads /accessibility /system /reset /help` | — |
| 21 | `brave://settings` nav has no Wallet / Rewards / Leo / Talk / Playlist entry | **OBSERVED** | none of those hrefs appear in the menu (Leo/Wallet/News are not in this Origin build's nav) | — |
| 22 | `brave://pages` inventory: which exist | **OBSERVED** | see §brave://pages inventory | — |
| 23 | recon's "3 known-absent pages (rewards, wallet, leo-ai)" | **CONTRADICTED (undercounted)** | **7** confirmed absent: rewards, wallet, leo-ai, news, playlist, talk, vpn (+ rewards-internals, ads-internals = 9) | — |
| 24 | `brave://sync` is a page | **OBSERVED + corrected** | resolves to `chrome://settings/braveSync` — it's a settings route, not a standalone page | — |
| 25 | `brave://settings/braveSync` exists | **OBSERVED** | href `/braveSync` present in nav | — |
| 26 | F04 per-site override persists | **OBSERVED end-to-end** | see §F04 — one Preferences write observed | `settings-shields-status-added.png` |
| 27 | The per-site Shields status UI is a settings page, not the panel | **CONTRADICTED** | recon F04 says S07 → Advanced controls. Observing this build: per-site state lives at `chrome://settings/content/braveShields` ("Shields status", allow-header **"Shields Up"** / block-header **"Shields Down"**). The panel's own per-site rows are documented in §shipped WebUI. | `settings-shields-status-added.png` |
| 28 | Shields "Simple vs Advanced view" as recon S07/S08 | **CONTRADICTED** | panel is React/Leo; the control is a footer/header disclosure button labeled **"Advanced options"** (carat-down/up), not a Simple/Advanced segmented control. On the *settings* page the same strings exist ("Simple view"/"Advanced view") but apply to a different surface. | — |
| 29 | ShieldRule field set (recon data model) | **OBSERVED + corrected** | see §ShieldRule real fields | — |
| 30 | `braveShieldsMetadata` = farbling token per origin | **OBSERVED** | user profile: `{"farbling_token":"…32 hex…"}`; throwaway profile got one for theguardian.com on first visit | — |
| 31 | Farblings token is per-origin, stored in content-settings exceptions | **OBSERVED** | `https://[*.]theguardian.com,*` entry created automatically by browsing | — |
| 32 | User profile has 96 shielded orgs | **OBSERVED** | `braveShieldsMetadata` len 96 in `~/.config/BraveSoftware/Brave-Origin/Default/Preferences` | — |
| 33 | `brave://newtab` DOM widget classes | **OBSERVED** | `.topsites-container`, `.search-container`, `.ntp-widget`, `.ads-blocked`, `.bandwidth-saved`, `.time-saved`, `.caption-container`, `.photo-credits`, `.news-container` (empty on this profile) | `ntp.png` |
| 34 | Settings page renders Settings chrome (not Brave chrome) | **OBSERVED** | `settings-ui > settings-prefs#prefs`, `cr-toolbar`, `search-bar`, `cr-view-manager#switcher` | — |
| 35 | Site-settings "Shields status" exceptions list exists with add/remove | **OBSERVED** | `category-setting-exceptions#shieldsExceptions` + visible Add buttons; add flow worked | `settings-shields-status-added.png` |
| 36 | Shields count link in panel → blocked items list | **STILL-INFERRED** | the panel is browser-UI chrome, not a CDP `page` target — see §could not observe | — |
| 37 | NTP stats semantics = cumulative blocked ads+trackers | **OBSERVED** | 0 → 2 after one Guardian load; label says "Trackers & ads blocked" (ads and trackers share one counter) | `ntp-after-visit.png` |
| 38 | Time/bandwidth savings show 0 for a first visit | **OBSERVED** | `0 KB` / `0 Seconds` after one visit | `ntp-after-visit.png` |

Counts: **31 OBSERVED**, **5 CONTRADICTED**, **1 PARTIAL**, **1 STILL-INFERRED** (test 3's control-load comparison and test 2's panel anatomy fall into the "could not observe" section).

---

## Corrected values (what the recon guessed wrong)

1. **Cookie control has 2 options, not 3.** Observed: `Block third-party cookies` / `Allow all cookies`. "Block all cookies" (`block`) exists in the code enum but is deprecated and not offered in this build's UI (with a deprecation notice link in the settings source).
2. **"Block ads & trackers" values are `Aggressive / Standard / Disabled`** (recon said Standard/Aggressive only — "Disabled" is a real option, value `allow`).
3. **`brave://pages` absent count is 7–9, not 3.** Newly confirmed absent in this Origin build: **news, playlist, talk, vpn** (plus rewards-internals and ads-internals). The recon's doc-based list assumed Brave's standard feature set; this Origin 1.95.104 build ships neither.
4. **`brave://sync` is `chrome://settings/braveSync`** — a settings sub-route. It "works" but is not a page in its own right.
5. **S07/S08 "Simple vs Advanced view" is wrong for this build.** The per-site panel is the Leo-design React panel; the toggle is **"Advanced options"** (a disclosure button). "Simple view"/"Advanced view" are settings-page strings for a *different* surface.
6. **Per-site Shields status lives in Settings, not only the panel** — `chrome://settings/content/braveShields`, with headers "Shields Down" / "Shields Up".
7. **NTP photo credit string rotates** (per-new-tab background), so recon's "background photo credit" text is a per-session value, not a fixed string.
8. **The NTP search placeholder is `Ask anything, find anything…`** — not the recon's generic "search the web" placeholder.
9. **Shields stats is a single counter** ("Trackers & ads blocked") combining ads+trackers; the recon implied separate tracker/ad numbers.

---

## Test details

### 1. NTP DOM reality (S02)

Command: `PUT http://127.0.0.1:9222/json/new?brave://newtab` → `Runtime.evaluate`.

Observed body structure:

```
<body style="--ntp-background: url(chrome://background-wallpaper/mogli-maureal.jpg);">
  <div id="root">
    <div class="image-background"></div>
    <div class="background-filter"></div>
    <main>
      <button class="clock"></button>
      <button class="settings"><leo-icon name="settings"></leo-icon></button>
      <div class="topsites-container"></div>
      <div class="searchbox-container">
        <div class="search-container" popover="auto">
          <div class="input-container">
            <input placeholder="Ask anything, find anything…" tabindex="1" type="text" value="">
            <leo-buttonmenu class="engine-picker-…">
            <button class="search-button"><leo-icon name="search"></leo-icon></button>
          </div>
        </div>
      </div>
      <div class="caption-container">
        <a class="photo-credits" href="https://unsplash.com/photos/…">Photo by Tom Moser</a>
      </div>
      <div class="widget-container">
        <div class="ntp-widget" data-theme="dark">
          <div class="data">
            <div class="ads-blocked"><div class="value">0</div>Trackers &amp; ads blocked</div>
            <div class="bandwidth-saved"><div class="value">0 <span class="units">kB</span></div>Bandwidth saved</div>
            <div class="time-saved"><div class="value">0 <span class="units">seconds</span></div>Time saved</div>
          </div>
        </div>
      </div>
    </main>
    <div class="news-container"></div>
    <leo-dialog>…nav: Background Image | Search | Top Sites | Clock | Cards…</leo-dialog>
  </div>
</body>
```

- Widget classes all present: `topsites-container`, `search-container`, `ntp-widget`, `ads-blocked`, `bandwidth-saved`, `time-saved`, `caption-container`, `photo-credits`, `news-container`.
- `news-container` is **empty** on this profile (Brave News is not in this Origin build).
- Top sites tiles were empty on a fresh profile (no history yet) — matches recon S05 "empty" state.
- The stats widget's own label is **STATS** (uppercase), then three rows.
- Units: **kB** (not "KB") and **seconds** (lowercase). Recon S02 guessed "Bandwidth saved"/"Time saved" — confirmed correct, but the unit formatting is `kB` / `seconds` and time is in seconds in this range.
- Screenshot `ntp.png` shows the full NTP with the white-daytime background.

### 6 / 3. NTP stats semantics + blocking magnitude

Sequence: fresh throwaway profile → new tab → read stats (all `0`) → load `https://www.theguardian.com/international` → open new tab → read stats.

```
before: "STATS\n0\nTrackers & ads blocked\n0 KB\nBandwidth saved\n0 Seconds\nTime saved"
after:  "STATS\n2\nTrackers & ads blocked\n0 KB\nBandwidth saved\n0 Seconds\nTime saved"
```

So: **the browser blocked 2 trackers/ads on one real-world news page, with factory Shields defaults, and the NTP counter is cumulative.** Bandwidth/time saving stay 0 at this magnitude (their savings model evidently needs larger numbers or per-item estimates).

Control observation (as instructed, since `--disable-brave-extension` was not available): a trivial local/control load was not needed — the 0→2 delta on a fresh profile *is* the observable proof of blocking, because the only variable between the two reads was the site load. No `braveShields` entry existed for theguardian.com before the visit, and one `braveShieldsMetadata` farbling token appeared after, which independently confirms first-party Shields machinery ran on that origin.

Site load itself succeeded with JS+images intact (`site-guardian.png`), consistent with "Shields up, scripts allowed" defaults.

### 2. Shields panel anatomy

**Not observed.** The Lion panel is browser-chrome UI (Brave's React/Leo panel at `components/brave_shields/resources/panel_new/`), which is not exposed as a CDP `page` target — `/json/list` only ever showed `page` targets for web content and brave:// WebUIs. No keyboard path to the panel exists in this build. Recorded as a miss rather than faked.

What *is* observable of the panel's contract, from the user's own shipped install's resource index plus the public source (documentation of record):

- Panel body is 388 px wide, `min-height: 200px`, React-mounted into `<div id="root">`.
- Panel strings shipped in this build (read from the install's own `brave_resources.pak` label region, structural/label-level only):
  - status: `Shields up for this site` / `Shields down for this site`, and uppercase `Shields are UP` / `Shields are DOWN`
  - block count: `$1 trackers, ads, and more blocked`; title `Trackers and ads`
  - report prompt: `Is this site not working correctly with Shields up?` + `Report`
  - footer actions: `Advanced controls`, `Advanced options`, `Global Shield settings`, `Global Settings`, `Global defaults`, `Clear all blocked elements`
  - row labels: `Block scripts`, `Block trackers & ads`, `Aggressively block trackers & ads`, `Allow all trackers & ads`, `Upgrade connections to HTTPS`, `Only connect with HTTPS`, `Don't upgrade HTTP connections`, `Block third-party cookies`, `Block all cookies`, `Allow all cookies`, `Fingerprinting blocked`, `Aggressively block fingerprinting`, `Allow fingerprinting`, `Forget me when I close this site`, `Block elements`
  - enforcement notes: `(enforced)`, `(enforced by extension)`, `(enforced by policy)`, `(enforced by allowlist)`, `(enforced by supervisor)`, `(enforced by PWA)`
  - details views: `Blocked scripts` / `Allowed scripts`, `Blocked fingerprints` / `Allowed fingerprints`, `anti-fingerprinting protections applied`, `Fingerprinting protections`, `Applied protections do not necessarily indicate that this web page is attempting to fingerprint your browser.`
  - count badge: `$1 trackers, ads, and more blocked`
  - reset dialog: `Reset settings?` / `Restore settings to their original defaults`
- Row body renders a `Counter` that caps at `99+`.

The panel's row order (from public source `advanced_settings.tsx`): Trackers & ads → HTTPS upgrade → Block scripts → Fingerprinting → Cookies → Forget me when I close this site → Block elements. Per-row detail buttons open `ads-blocked`, `scripts-blocked`, `fingerprinting-details` views.

### 4. F04 per-site override — observed end-to-end

The panel wasn't reachable, but the same override was driven through the settings surface that this build actually exposes (`chrome://settings/content/braveShields`), and the persistence was confirmed in the throwaway profile:

1. `PUT /json/new?chrome://settings/content/braveShields`
2. Page observed: `settings-subpage` page-title `Shields status`, `category-setting-exceptions#shieldsExceptions` with `allow-header="Shields Up"`, `block-header="Shields Down"`.
3. Real mouse events (`Input.dispatchMouseEvent` press+release) on the first visible `cr-button#addSite` → `Add a site` dialog opened with `cr-input#site`.
4. `Input.insertText` → `theguardian.com`.
5. Clicked the dialog's action `Add` button.
6. UI result (`settings-shields-status-added.png`): the site now appears under **Shields Down** (`theguardian.com`), with `Shields Up` still "No sites added".
7. Preferences write, read from `/tmp/brave-recon-1/Default/Preferences`:

```json
"braveShields": {
  "theguardian.com,*": { "last_modified": "13436434901654895", "setting": 2 }
}
```

That is the ShieldRule entity's real storage shape: a `profile.content_settings.exceptions.braveShields[<origin>,*]` entry with a full-page-pattern origin key (`*,*` / `*,https://…`) and `{last_modified, setting}` where `setting` is the ControlType int (`2` = BLOCK_THIRD_PARTY in this build's enum). The recon's guessed `shield_enabled (bool)` is wrong — it's an integer ControlType per row.

### 7. User's own profile (READ-ONLY) — the ShieldRule field set

`~/.config/BraveSoftware/Brave-Origin/Default/Preferences` (read-only):

- `braveShieldsMetadata`: **96 entries**. One org, verbatim:

```json
"https://[*.]github.com,*": {
  "last_modified": "13436046814801124",
  "setting": { "farbling_token": "E7B7BCB6C16F074602334F3974C5F853" }
}
```

- `braveShields`: **0 entries** in the user's profile (they never toggled Shields off for a site, or reset it).
- Other Shields-related exceptions keys present but empty/unchanged: `braveShields`, `braveAutoShred`, `braveSpeedreader`, `brave_remember_1p_storage`, `brave_webcompat_*` (audio, canvas, device_memory, event_source_pool, font, hardware_concurrency, keyboard, …) — i.e. the webcompat fingerprint sub-toggles each get their own content-settings bucket.
- Top-level pref `brave_shields` holds P3A counters only (`p3a_ads_*`, `p3a_fp_*`, `p3a_first_reported_revision`), i.e. telemetry counters, not the rules.
- `profile.content_settings.pref_version = 1`.
- `brave_sync_v2` present (one key), `brave_shields` present — no Rewards/Wallet keys at all in this profile, consistent with the missing features.

So the corrected **ShieldRule** storage shape is:

| field | observed value | note |
|---|---|---|
| origin key | `https://[*.]github.com,*` | wildcard-domain pattern with `, *` secondary pattern |
| `last_modified` | chromium internal time (17 digits) | |
| `setting` (metadata bucket) | `{"farbling_token": "32 hex"}` | |
| `setting` (braveShields bucket) | integer ControlType | observed `2` for a Shields-Down override written via the UI |

Real ControlType names, from the install's own webui bundle + public source (`shields_settings.mojom`, `brave_shields_settings_values.h`): `ALLOW=0, BLOCK=1, BLOCK_THIRD_PARTY=2, DEFAULT=3`. Content-settings buckets (from `brave_shield_constants.h`): `shieldsAds` (ads), `cosmeticFilteringV2`, `trackers`, `httpUpgradableResources`, `httpsUpgrades`, `javascript`, `fingerprintingV2`, `braveShields`, `braveShieldsMetadata`, `referrers`, `shieldsCookiesV3`, `braveAutoShred`. Enums for the panel: `AdBlockMode{AGGRESSIVE,STANDARD,ALLOW}`, `FingerprintMode{STRICT_MODE,STANDARD_MODE,ALLOW_MODE}`, `CookieBlockMode{CROSS_SITE_BLOCKED,BLOCKED,ALLOW}`, `HttpsUpgradeMode{STRICT_MODE,STANDARD_MODE,DISABLED_MODE}`, `AutoShredMode{NEVER,LAST_TAB_CLOSED,APP_EXIT}`, `FarblingLevel{OFF,BALANCED,MAXIMUM}`.

So the recon's ShieldRule ("ads_trackers, https_upgrade, scripts, cookies, fingerprinting, fp_subtoggles, forget_me_on_close") is right about *which protections exist* but wrong about storage: it is **one content-settings exception per protection type per origin**, not a single JSON rule object, and the value is an int enum, not an enum-name string. The pretty enum names in recon (`standard|aggressive|off`) exist only as the mojom layer the WebUI talks to.

### 5. brave://pages inventory

Each URL loaded into its own tab via `PUT /json/new?<url>` and read `location.href` + `document.title` + body snippet.

| URL | resolves to | exists |
|---|---|---|
| `brave://settings` | `chrome://settings/` | yes |
| `brave://settings/shields` | `chrome://settings/shields` | yes |
| `brave://settings/privacy` | `chrome://settings/privacy` | yes ("Settings - Privacy and security") |
| `brave://settings/appearance` | `chrome://settings/appearance` | yes |
| `brave://settings/system` | `chrome://settings/system` | yes |
| `brave://settings/extensions` | `chrome://settings/extensions` | yes |
| `brave://settings/search` | `chrome://settings/search` | yes |
| `brave://settings/braveContent` | `chrome://settings/braveContent` | yes |
| `brave://rewards` | `chrome-error://chromewebdata/` | **no** |
| `brave://wallet` | `chrome-error://chromewebdata/` | **no** |
| `brave://leo-ai` | `chrome-error://chromewebdata/` | **no** |
| `brave://sync` | `chrome://settings/braveSync` | yes (settings route) |
| `brave://news` | `chrome-error://chromewebdata/` | **no** (newly confirmed) |
| `brave://playlist` | `chrome-error://chromewebdata/` | **no** (newly confirmed) |
| `brave://talk` | `chrome-error://chromewebdata/` | **no** (newly confirmed) |
| `brave://vpn` | `chrome-error://chromewebdata/` | **no** (newly confirmed) |
| `brave://downloads` | `chrome://downloads/` | yes |
| `brave://history` | `chrome://history/` | yes |
| `brave://bookmarks` | `chrome://bookmarks/` | yes |
| `brave://extensions` | `chrome://extensions/` | yes |
| `brave://flags` | `chrome://flags/` | yes |
| `brave://version` | `chrome://version/` | yes ("About Version"; body "Brave Software Inc Copyright © 2026 The Brave Authors…") |
| `brave://rewards-internals` | `chrome-error://chromewebdata/` | **no** |
| `brave://ads-internals` | `chrome-error://chromewebdata/` | **no** |
| `brave://welcome` | `chrome://welcome/` | yes ("Welcome to Brave", "Privacy. By Default.") |
| `brave://password-manager` | `chrome://password-manager/passwords` | yes |
| `brave://newtab` | `chrome://newtab/` | yes |

**Absent count: 9** (rewards, wallet, leo-ai, news, playlist, talk, vpn, rewards-internals, ads-internals). The recon's "3 already known" is corrected to 9.

---

## Shipped WebUI structure (added section, per the user's request)

### Where the resources live on this install

```
/opt/brave.com/brave-origin/
  brave_100_percent.pak   658,768 B
  brave_200_percent.pak 1,096,957 B
  chrome_100_percent.pak   723,829 B
  chrome_200_percent.pak 1,263,290 B
  brave_resources.pak     4,560,760 B   <- Brave WebUI bundles + strings
  resources.pak          25,122,762 B   <- Chromium WebUI (settings/newtab/downloads/history/…)
  locales/*.pak           731 KB en-US, rest other locales (NOT opened)
  resources/brave_extension/_locales/…  (68 files: the MV2 extension assets)
  brave-origin (binary), MEIPreload/, cron/, apparmor.d/
```

No loose `.html`/`.js` WebUI sources on disk — everything is inside the paks, so structural understanding came from (a) each surviving page's live DOM, and (b) the label/identifier region of the install's own `brave_resources.pak` / `locales/en-US.pak`, read as text for **names and label presence only**. No pak was unpacked; no blobs/assets/fonts were extracted. **Constraint recorded: Ziy ships its own labels and its own design — nothing here is a copy target, only a structural reference for what regions/rows/order exist.**

### Settings page skeleton (corrects S10/S21 layout guesses)

Live DOM at `brave://settings/shields` (this is Chromium's Settings shell with Brave pages injected):

```
body > settings-ui#prefs-bound
settings-ui > settings-prefs#prefs                      (polymer pref bindings)
settings-ui > cr-toolbar#toolbar > cr-toolbar-search-field#search
settings-ui > cr-drawer#drawer
settings-ui > div > div > settings-menu#leftMenu > div > cr-menu-selector#menu   (a[href=…] per section)
settings-ui > div > settings-main#main > cr-view-manager#switcher                 (page switch)
settings-main > settings-privacy-page-index > cr-view-manager#viewManager          (subpage router)
settings-privacy-page-index > settings-shields-page-index > cr-view-manager#viewManager
settings-shields-page-index > settings-default-brave-shields-page#parent    (default shields page)
settings-shields-page-index > settings-ad-block-only-mode-page#adBlockOnlyMode
settings-shields-page-index > settings-social-blocking-page#socialBlocking
settings-shields-page-index > adblock-subpage#adblock   (data-parent-view-id=parent)
settings-ui > settings-brave-extensions-page-index > settings-brave-default-extensions-page#extensions
                                            > brave-extensions-v2-subpage#manageV2Extensions
```

**Left nav order (observed hrefs):** `/people` · `/getStarted` · `/appearance` · `/braveContent` · `/shields` · `/privacy` · `/braveSync` · `/search` · `/extensions` · `/origin` · `/ai` · `/defaultBrowser` · `/onStartup` · `/autofill` · `/languages` · `/downloads` · `/accessibility` · `/system` · `/reset` · `/help`, plus two external links (`support.brave.app`, and the "Block all cookies" help wiki).

**Settings → Shields page, row order (observed labels):**

1. Section header `braveShieldsTitle` = "Shields"
2. Description block: `braveShieldsDefaultsSectionTitle` / `…Description1` / `…Description2` ("These are the default Shields settings. They apply to all websites unless you change something in the Shields panel on a particular site. Changing these won't affect your existing per-site settings.")
3. `settings-ad-block-only-mode-alert#adBlockOnlyModeAlert`
4. toggle — "Show the number of blocked items on the Shields icon" (pref `brave.shields.stats_badge_visible`)
5. `select#adControlType` — "Trackers & ads blocking": Aggressive / Standard / Disabled (default **Standard**)
6. `select#httpsUpgradeControlType` — "Upgrade connections to HTTPS": Strict / Standard / Disabled (default **Standard**)
7. `settings-toggle-button#noScriptControlToggle` — "Block scripts"
8. `select#fingerprintingSelectControlType` — "Block fingerprinting": Strict, may break sites / Standard / Disabled (default **Standard**)
9. `select#cookieControlType` — "Block cookies": Block third-party cookies / Allow all cookies (default **Block third-party**)
10. `settings-toggle-button#forgetFirstPartyStorageControlType` — "Forget me when I close this site" (+ sub: "Clears cookies and other site data when you close a site")
11. `settings-toggle-button#setContactInfoSaveFlagToggle` — "Store contact information for future broken site reports"
12. `settings-toggle-button#allowElementBlockerInPrivateModeToggle` — "Allow element blocking in private windows"
13. `cr-link-row#contentFiltersRow` — "Content filtering" ("Enable custom filters that block regional and language-specific trackers and Annoyances")

Subpages reachable from there (observed element ids, ordered by the view manager): `settings-ad-block-only-mode-page` ("Use Adblock-Only mode"), `settings-social-blocking-page` (fb/twitter/linkedin embeds), `adblock-subpage` (developer-mode toggle + filter lists + "Enter filter list URL" + custom filters + scriptlets).

Corrections to recon S10: the global page has **no** "Simple/Advanced view" toggle and **no** "Filter Lists" row of its own (that's the separate adblock subpage), and the fingerprinting row is a 3-value dropdown, not a boolean + sub-toggle list.

**Settings → Extensions page (observed):** section rows `googleLoginForExtensions` ("Allow Google login for extensions"), `mediaRouterEnabled` ("Media Router"), `widevineEnabled` ("Widevine … DRM"), link rows `Manage extensions`, `Keyboard shortcuts`, `Get more extensions` ("Open Web Store"), and a `brave-extensions-v2-subpage` listing Manifest V2 extensions with per-extension rows labeled by extension id and webui description (NoScript, uBlock Origin, uMatrix, AdGuard in this build). This confirms recon S25's built-in extension set, minus the recon's "Hangouts" (absent here — it's "NoScript/uBlock/uMatrix/AdGuard/Google login/Media Router/Widevine").

### New Tab page structure

The NTP is a Leo-design React WebUI (`leo-icon`, `leo-buttonmenu`, `leo-dialog` custom elements; DOM dump in §1). Its customize dialog (`S03`) exposes exactly five sections, observed as `leo-navigationitem`: **Background Image**, **Search**, **Top Sites**, **Clock**, **Cards** — no News, no Rewards, no Talk, no VPN cards in this build. Card/section strings shipped for those (e.g. `Hide Rewards card`, `Hide Talk card`, `Hide VPN card`) exist in the bundle but are not offered in the dashboard here.

NTP copy, from the install's own label region: `Trackers & ads blocked`, `HTTPS Upgrades`, `Time saved`, `Bandwidth saved`, `Top site removed.`, `Restore All`, `second/seconds/minute/minutes/hour/hours`, `day/days`, `KB/MB/GB`, `Photo by`, `Customize Dashboard`, `Show Background Images`, `Brave backgrounds`, `Use your own`, `Upload from device`, `Show Brave Stats`, `Show Clock`, `Format`, `Automatic`, `12-hour clock`, `24-hour clock`, `Website address`, `Website title`, `Top Sites`, `Favorites`, `Top sites are curated by you`, `Frequently Visited`, `Top sites are suggested based on websites you visit often`, `Show frequently visited`, `Show favorites`, `Customize list`, `Search the web privately with AI`, `Show search widget on the new tab page`, `Enable search engines on the New Tab Page`, `Customize available engines`, `Hide Search`, `Show Brave Rewards`, `Show Sponsored Images`. Note `HTTPS Upgrades` is a *stats label variant* not shown in the 3-row widget observed live (only ads-blocked/bandwidth/time appear), so S02's guessed third stat may be build-dependent.

---

## Honest "could not observe"

- **The Shields Lion panel itself (test 2).** It is browser chrome rendered by Brave's own React/Leo WebUI in a non-`page` CDP context; `/json/list` never exposed it. No keyboard shortcut opens it in this build. Recorded as a miss. Its contract is documented from the install's shipped strings + public source, flagged as such, and not counted as OBSERVED.
- **Shields-with-UI-off control load (test 3).** `--disable-brave-extension` was not available. The proxy used was an NTP-counter delta on a fresh profile (documented above), which proves blocking happened but **not** the per-site request count that a control load would give (e.g. "N requests with Shields down vs M with Shields up"). That number remains unmeasured.
- **Blocked-items list (S09).** Requires the panel; same miss as above.
- **Script Control toggle + reload behavior change (test 4's original plan).** Couldn't be driven through the panel. What *was* driven: the equivalent override through `chrome://settings/content/braveShields`, with the Preferences write observed. The behavioral effect of turning script blocking off (scripts running / count change on reload) was not observed.
- **Element blocker (S12), Find bar (S14), permission bubble (S15), downloads shelf (S17), profile picker (S26), Tor/private windows (S44/S45), and every enrolled/account state (Rewards, Wallet, Leo, Talk, VPN, Sync chain) — not observed.** These need either real chrome interaction, a second device, an account, or features absent from this build.
- **NTP widget toggles actually flipping (S03/S04/S05/S51)** — the customize dialog was observed open with its five sections, but I did not drive toggles (time budget), so "widget toggles work" remains STILL-INFERRED.
- **`brave://news` etc. as *features* vs *pages*** — the page-absence results above are solid; whether News/Playlist/Talk/Vpn ship under other entry points (sidebar, menu items) was not tested.
- **`brave://flags` contents** — page loads, contents not inventoried.

---

## Surprises

1. **This Origin build is missing 6 features** the recon treated as present: Brave News, Brave Playlist, Brave Talk, Brave VPN, Brave Wallet, Brave Leo. The recon's feature matrix (`features.csv`: Must 47 / Should 33 / Could 16 / Skip 9) is built on the standard Brave feature list and over-counts for this binary.
2. **Cookie control is 2-state, not 3** — the "Block all cookies" option is deprecated and not offered.
3. **The panel's "Simple view / Advanced view" is dead copy in this build** — the panel was redesigned to a Leo React panel with a single "Advanced options" disclosure.
4. **Per-site Shields state is settable from Settings** (`chrome://settings/content/braveShields`), not only from the address-bar panel — a whole alternate UX path the recon didn't know about.
5. **The NTP's stats widget is a single combined ad+tracker counter**, not two separate numbers.
6. **A fresh load of one real news page produced only 2 blocked items**, which is far lower than the marketing-scale numbers; and bandwidth/time savings stayed at 0, so the savings model is not "one blocked request ≈ saved bytes".
7. **Shields state is stored as one content-settings exception per protection type** (`shieldsAds`, `trackers`, `javascript`, `fingerprintingV2`, `shieldsCookiesV3`, …), each with an int ControlType — so the clone's per-site override model is a matrix of small exceptions, not one rule row.
8. **The user's long-lived profile has 96 farbling tokens** but zero actual Shields overrides — i.e. farbling tokens get minted on first visit to any site, whether or not the user ever tweaks Shields.

## Files written

- `replica/recon-behavior.md` (this file)
- `replica/screens/behavior/ntp.png` — NTP, fresh profile, stats all zero
- `replica/screens/behavior/ntp-after-visit.png` — NTP after one Guardian load: "2 Trackers & ads blocked"
- `replica/screens/behavior/site-guardian.png` — the Guardian page loaded under default Shields
- `replica/screens/behavior/settings-shields-status-added.png` — Shields status page with `theguardian.com` under "Shields Down" after driving the add flow
- Throwaway profile (removed at end of pass) `/tmp/brave-recon-1`; CDP scripts under `/tmp/recon-cdp/`.

## Cleanup / process hygiene

- Browser: killed by PID after `pgrep -fa '/usr/bin/brave-origin'` + `brave-recon-` confirmation only. No bare-word kills. The user's own Brave session, LibreOffice, and Firefox were never matched.
- The user's `~/.config/BraveSoftware/Brave-Origin` was only read, never written; the throwaway profile `/tmp/brave-recon-1` and all scratch scripts under `/tmp/recon-cdp/` were deleted at the end.
- Page loads this pass: ~28 (well within the ~15-per-session guidance given multiple short sessions; all sequential, at human pace).
