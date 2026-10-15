# Deep Shields Recon — from Brave's real source (brave-core, master)

**Method**: navigated via `api.github.com` (2 calls used for trees: `brave/brave-browser` + `brave/brave-core` recursive — the latter is truncated at 59 242 entries but covers all shields code), then raw.githubusercontent.com (separate rate-limit pool) for ~45 files. Also read `brave/adblock-lists` (the live list source) and `brave/adblock-rust` (the engine). Budget checked via `GET /rate_limit`: 22 core calls remaining at time of writing, so no further API calls were needed — everything below is raw-file backed.

*Process note (per the user's standing rule): the initial directory guesses at `components/brave_shields/core/{common,browser}` returned 404 because the code lives in the `brave-core` repo, not `brave-browser`. The fix was to read GitHub's contents endpoint semantics and fetch the recursive tree once (rather than guessing path-by-path), then switch to raw.githubusercontent.com — a different limit pool — for all file reads. When a directory guess failed, the tree index (`/tmp/brave-src/core-blobs.txt`) was consulted to find the real path instead of retrying the guess.*

**License note**: all source is MPL-2.0. Quotes below are ≤15 lines each, cited to file + function.

**Saved for reuse** (other workers): `/tmp/brave-src/core-blobs.txt` (index of 47 148 blobs in brave-core), `/tmp/brave-src/shortlist.txt`, `/tmp/brave-src/list_catalog.json` (live 62-list catalog), `/tmp/brave-src/regional.json`(404, ignore), `/tmp/brave-src/brave_shields_strings.grdp` (every UI string), `/tmp/brave-src/adblock-rust-README.md`, `/tmp/brave-src/ab-network.rs` (adblock-rust filter parsing), plus all files cited below under `/tmp/brave-src/components/...`, `/tmp/brave-src/third_party/...`, `/tmp/brave-src/chromium_src/...`, and the adblock-lists samples (`brave-firstparty.txt`, `brave-checks.txt`, `brave-sugarcoat.txt`, `query-filter.json`, `debounce.json`, `webcompat-exceptions.json`, `https-upgrade-exceptions.txt`).

---

## 1. `braveShieldsMetadata` content setting — the real schema

**Content-setting name constant**:
`components/brave_shields/core/common/brave_shield_constants.h:30`
```cpp
inline constexpr char kBraveShieldsMetadata[] = "braveShieldsMetadata";
```

**Storage type registration** (dict-valued, unsyncable, schemeful-site-scoped, does not inherit into incognito):
`chromium_src/components/content_settings/core/browser/content_settings_registry.cc:378`
```cpp
website_settings_registry_->Register(
    ContentSettingsType::BRAVE_SHIELDS_METADATA,
    brave_shields::kBraveShieldsMetadata, base::Value(),
    WebsiteSettingsInfo::UNSYNCABLE, WebsiteSettingsInfo::NOT_LOSSY,
    WebsiteSettingsInfo::REQUESTING_SCHEMEFUL_SITE_ONLY_SCOPE, ...
    WebsiteSettingsInfo::DONT_INHERIT_IN_INCOGNITO);
```

### The complete field list — **exactly one field: `farbling_token` (string)**

`components/brave_shields/core/browser/brave_shields_settings_service.cc:31-56` (`GetShieldsMetadata`/`SetShieldsMetadata`) and `:395-412` (`BraveShieldsSettingsService::GetFarblingToken`) are the only readers/writers:

```cpp
base::Token BraveShieldsSettingsService::GetFarblingToken(
    const GURL& url, base::span<const uint8_t> additional_entropy) {
  base::Token token;
  if (!url.SchemeIsHTTPOrHTTPS()) { return token; }
  // Get the farbling token from the Shields metadata.
  auto shields_metadata = GetShieldsMetadata(&*host_content_settings_map_, url);
  if (auto* farbling_token = shields_metadata.FindString("farbling_token")) {
    token = base::Token::FromString(*farbling_token).value_or(base::Token());
  }
  // If the farbling token is not set or failed to parse, generate a new one.
  if (token.is_zero()) {
    token = CreateFarblingToken(url);
    shields_metadata.Set("farbling_token", token.ToString());
    SetShieldsMetadata(&*host_content_settings_map_, url, std::move(shields_metadata));
  }
  ...
```

`base::Token::ToString()` renders as **32 uppercase hex chars** (`%016X%016X` of high/low) — exactly the shape observed in the user's profile (`"37ADC5AAC9E4CAB1A6094ED481ACE178"`), confirming the field and its type.

**Additional entropy mutations of the token (all after generation, not stored):**
1. **container nonce** — XOR with `base::FastHash(storage_key nonce)`:
   `third_party/blink/renderer/core/farbling/brave_session_cache.cc:275-287`
   ```cpp
   const size_t storage_key_nonce_hash = base::FastHash(storage_key->GetNonce()->AsBytes());
   default_shields_settings_->farbling_token = base::Token(
       ...farbling_token.high() ^ storage_key_nonce_hash, ...low() ^ storage_key_nonce_hash);
   ```
2. **profile-session entropy** (feature `kBraveFarblingTokenReset`, default ON) — XOR with a session-scoped token so the token differs across browser restarts:
   `brave_shields_settings_service.cc:418-425`
   ```cpp
   if (base::FeatureList::IsEnabled(brave_shields::features::kBraveFarblingTokenReset)) {
     if (profile_level_farbling_entropy_.is_zero()) { profile_level_farbling_entropy_ = CreateProfileLevelFarblingToken(); }
     token = base::Token(token.high() ^ ...high(), token.low() ^ ...low());
   }
   ```
3. explicit `additional_entropy` param (used for containers).

**Cleanup**: deleting site data wipes the token — `browser/ui/webui/settings/brave_site_settings_handler.cc:74-83` (`RemoveNonModelData`):
```cpp
settings_map->SetWebsiteSettingDefaultScope(
    url, url, ContentSettingsType::BRAVE_SHIELDS_METADATA, base::Value());
```
(`base::Value()` = null removes the setting.)

---

## 2. Shields row enum values (the actual constants)

`components/brave_shields/core/common/brave_shield_constants.h:22-35` — content-setting *names*:
```cpp
inline constexpr char kAds[] = "shieldsAds";
inline constexpr char kCosmeticFiltering[] = "cosmeticFilteringV2";
inline constexpr char kTrackers[] = "trackers";
inline constexpr char kHTTPUpgradableResources[] = "httpUpgradableResources";
inline constexpr char kHTTPSUpgrades[] = "httpsUpgrades";
inline constexpr char kJavaScript[] = "javascript";
inline constexpr char kFingerprintingV2[] = "fingerprintingV2";
inline constexpr char kBraveShields[] = "braveShields";
inline constexpr char kBraveShieldsMetadata[] = "braveShieldsMetadata";
inline constexpr char kReferrers[] = "referrers";
inline constexpr char kCookies[] = "shieldsCookiesV3";
inline constexpr char kBraveAutoShred[] = "braveAutoShred";
```
plus obsolete names kept only for migration: `kObsoleteAds="ads"`, `kObsoleteCookies="cookies"`, `kObsoleteShieldsCookies="shieldsCookies"`, `kObsoleteCosmeticFiltering="cosmeticFiltering"`, `kObsoleteFingerprinting="fingerprinting"` (line 99-107).

**Row value enum** (`brave_shields_settings_values.h:22-28`):
```cpp
enum ControlType { ALLOW = 0, BLOCK, BLOCK_THIRD_PARTY, DEFAULT };
```
String↔enum mapping (`brave_shields_utils.cc:156-180`, `ControlTypeToString`/`ControlTypeFromString`): `allow` / `block` / `block_third_party` / `default`.

**Per-row mode enums** (`components/brave_shields/core/common/shields_settings.mojom:38-56`):
```cpp
enum AdBlockMode { AGGRESSIVE, STANDARD, ALLOW };   // NO kAds; ads+trackers ONE control
enum FingerprintMode { STRICT_MODE, STANDARD_MODE, ALLOW_MODE };
enum CookieBlockMode { CROSS_SITE_BLOCKED, BLOCKED, ALLOW };
enum HttpsUpgradeMode { STRICT_MODE, STANDARD_MODE, DISABLED_MODE };
enum AutoShredMode { NEVER = 0, LAST_TAB_CLOSED, APP_EXIT };
```
and `enum FarblingLevel { OFF, BALANCED, MAXIMUM };` (line 9) — this is the one that drives farbling (see §5).

**How a UI mode maps onto stored content settings** — `brave_shields_settings_service.cc:117-147` (`SetAdBlockMode`):
```cpp
if (mode == mojom::AdBlockMode::ALLOW)      { control_type_ad = ControlType::ALLOW; }
else                                       { control_type_ad = ControlType::BLOCK; }
if (mode == AGGRESSIVE)      { control_type_cosmetic = ControlType::BLOCK;            }  // aggressive
else if (mode == STANDARD)   { control_type_cosmetic = ControlType::BLOCK_THIRD_PARTY; }  // standard
else                         { control_type_cosmetic = ControlType::ALLOW;            }  // allow
```
i.e. **one row "Trackers & ads" writes TWO content settings**: `BRAVE_ADS`/`BRAVE_TRACKERS` (allow/block) and `BRAVE_COSMETIC_FILTERING` (allow / block_third_party / block).

Scripts row = stock `ContentSettingsType::JAVASCRIPT` (`SetNoScriptControlType`, `brave_shields_utils.cc:738-751`), NOT a Brave-specific type.
Forget-me = `ContentSettingsType::BRAVE_REMEMBER_1P_STORAGE`, stored with `CreateDomainPattern(url)` (eTLD+1!) as primary and wildcard secondary:
`brave_shields_settings_service.cc:255-275`
```cpp
host_content_settings_map_->SetContentSettingCustomScope(
    primary_pattern, ContentSettingsPattern::Wildcard(),
    ContentSettingsType::BRAVE_REMEMBER_1P_STORAGE,
    is_enabled ? CONTENT_SETTING_BLOCK : CONTENT_SETTING_ALLOW);
```

**Registered defaults** — `content_settings_registry.cc:55-146` (`ContentSettingsRegistry::BraveInit`):
| type | name | default |
|---|---|---|
| `BRAVE_ADS` | `shieldsAds` | `CONTENT_SETTING_BLOCK` |
| `BRAVE_TRACKERS` | `trackers` | `CONTENT_SETTING_BLOCK` |
| `BRAVE_HTTP_UPGRADABLE_RESOURCES` | `httpUpgradableResources` | `CONTENT_SETTING_BLOCK` |
| `BRAVE_REFERRERS` | `referrers` | `CONTENT_SETTING_BLOCK` |
| `BRAVE_COOKIES` | `shieldsCookiesV3` | `CONTENT_SETTING_ALLOW` (default inferred, see `brave_shield_utils.h` cookie rules) |
| `BRAVE_FINGERPRINTING_V2` | `fingerprintingV2` | `CONTENT_SETTING_ASK` (= STANDARD) |
| `BRAVE_SHIELDS` | `braveShields` | `CONTENT_SETTING_ALLOW` (**shields on by default**) |
| `BRAVE_HTTPS_UPGRADE` | `httpsUpgrades` | `CONTENT_SETTING_ASK` (= standard/prefer) |
| `BRAVE_COSMETIC_FILTERING` | `cosmeticFilteringV2` | dict `{cosmeticFilteringV2: 1}` = `BLOCK_THIRD_PARTY` (`brave_shields_settings_values.h:119-123`) |
| `BRAVE_AUTO_SHRED` | `braveAutoShred` | `{braveAutoShred: 0}` = `NEVER` |
| all `BRAVE_WEBCOMPAT_*` | `brave-webcompat-*` | `CONTENT_SETTING_BLOCK` (= protection active) |

Scope/incognito behavior per registration: shields types are `TOP_ORIGIN_ONLY_SCOPE` + `INHERIT_IN_INCOGNITO`; `BRAVE_SHIELDS_METADATA` is `REQUESTING_SCHEMEFUL_SITE_ONLY_SCOPE` + `DONT_INHERIT_IN_INCOGNITO`; `BRAVE_COOKIES` is `REQUESTING_ORIGIN_WITH_TOP_ORIGIN_EXCEPTIONS_SCOPE`.

---

## 3. How the per-site settings render as rows (current panel UI)

The panel is a WebUI (React/TS) at `components/brave_shields/resources/panel_new/`. Row order is fixed in `advanced_settings.tsx:53-60`:
```tsx
<AdBlockControl showDetails={props.showAdsBlocked} />
<HttpsUpgradeControls />
<BlockScriptsControls showDetails={props.showScriptsBlocked} />
<FingerprintingControls showDetails={props.showFingerprintingDetails} />
<CookieBlockControls />
<ForgetFirstPartyStorageControls />
<BlockElementsControls />
```

**Exact current labels** (from `components/resources/brave_shields_strings.grdp`, mapped to the string keys the TSX uses):

| Row | Control | Keys / English labels |
|---|---|---|
| Trackers & ads | dropdown, 3 options | `BRAVE_SHIELDS_TRACKERS_AND_ADS_BLOCKED_STD` **"Block trackers & ads"**; `..._BLOCKED_AGG` **"Aggressively block trackers & ads"**; `..._ALLOW_ALL` **"Allow all trackers & ads"** |
| HTTPS upgrade | dropdown, 3 | `BRAVE_SHIELDS_HTTPS_UPGRADE_MODE_STANDARD` **"Upgrade connections to HTTPS"**; `..._STRICT` **"Only connect with HTTPS"**; `..._DISABLED` **"Don't upgrade HTTP connections"** |
| Scripts | toggle | `BRAVE_SHIELDS_SCRIPTS_BLOCKED` **"Block scripts"** (note: *not* "allow/block"); enforced note `..._OVERRIDDEN` **"(enforced)"**, `..._OVERRIDDEN_BY_ALLOWLIST` **"(enforced by allowlist)"**, `..._BY_EXTENSION`/`_BY_POLICY`/`_BY_SUPERVISOR`/`_BY_PWA` |
| Fingerprinting | toggle (or 3-way dropdown when `brave-show-strict-fingerprinting-mode`) | `BRAVE_SHIELDS_FINGERPRINTING_BLOCKED_STD` **"Block fingerprinting"**; `..._BLOCKED_AGG` **"Aggressively block fingerprinting"**; `..._ALLOW_ALL` **"Allow fingerprinting"** |
| Cookies | dropdown, 3 | `BRAVE_SHIELDS_THIRD_PARTY_COOKIES_BLOCKED` **"Block third-party cookies"**; `BRAVE_SHIELDS_COOKIES_BLOCKED` **"Block all cookies"**; `BRAVE_SHIELDS_COOKIES_ALLOWED_ALL` **"Allow all cookies"** |
| Forget me | toggle | `BRAVE_SHIELDS_FORGET_FIRST_PARTY_STORAGE_LABEL` **"Forget me when I close this site"** (sublabel: "Clears cookies and other site data when you close a site") |
| Element blocking | link | `BRAVE_SHIELDS_BLOCK_ELEMENTS` **"Block elements"** / `..._SHOW_ALL_BLOCKED_ELEMENTS` **"Clear all blocked elements"** |

Top-level: `BRAVE_SHIELDS_STATUS_UP` **"Shields up for this site"** / `..._DOWN`; count line `BRAVE_SHIELDS_TRACKERS_ADS_BLOCKED` **"$1 trackers, ads, and more blocked"**; `BRAVE_SHIELDS_ADVANCED_CTRLS` **"Advanced controls"**, `BRAVE_SHIELDS_CHANGE_DEFAULTS` **"Global defaults"**.

Script allow-once per-origin (JS APIs, `brave_shields_panel.mojom:47-48`): `AllowScriptsOnce(array<string> origins)` / `BlockAllowedScripts(array<string> origins)` — matches the `origins_to_allow_scripts` field in `ShieldsSettings`.

---

## 4. The adblock engine

### 4a. Which fork / which crate
`components/brave_shields/core/common/adblock/rs/Cargo.toml`:
```toml
[package] name = "adblock-cxx", version = "1.0.0"
[dependencies]
adblock = { version = "0.13.0", default-features = false,
            features = ["full-regex-handling", "debug-info", "css-validation"] }
```
→ upstream crate **`adblock` v0.13.x from Brave's own `github.com/brave/adblock-rust`** (MPL-2.0), wrapped by a CXX FFI shim named `adblock-cxx` living *inside* brave-core at `.../adblock/rs/`. Engine shape from `src/lib.rs` of adblock-rust: `pub mod {blocker, content_blocking, cosmetic_filter_cache, data_format, engine, filters, lists, network_filter_list, optimizer, regex_manager, request, resources, sourcemap, url_parser, utils}`; `pub use engine::Engine; pub use lists::FilterSet;`. The README lists the supported syntax: network blocking, cosmetic filtering, resource replacements, hosts syntax, **uBlock Origin syntax extensions**, iOS content-blocking conversion, regex handling.

### 4b. Two engines, not one
`components/brave_shields/content/browser/ad_block_service.cc:176-178`:
```cpp
engine_wrapper_(task_runner_, std::make_unique<AdBlockEngine>(true),
                                 std::make_unique<AdBlockEngine>(false))
```
`true` = **default engine** (Brave Default Adblock Filters + Brave Default Privacy Filters + Brave First Party Adblock Filters), `false` = **additional engine** (all other enabled lists: regional, custom subscriptions, cookie list, …). They are consulted in sequence with first-party logic:
`components/brave_shields/content/browser/ad_block_engine_wrapper.cc:55-115` (`AdBlockEngineWrapper::ShouldStartRequest`):
```cpp
adblock::BlockerResult fp_result = default_engine_->ShouldStartRequest(...);
fp_result.rewritten_url.has_value = false;  // removeparam from default engine always ignored
if (aggressive_blocking ||
    base::FeatureList::IsEnabled(features::kBraveAdblockDefault1pBlocking) ||
    !SameDomainOrHost(url, request_initiator, INCLUDE_PRIVATE_REGISTRIES)) {
  if (fp_result.important) return fp_result;
} else {
  // first-party request in "standard" mode: keep only the exception from engine 0
  fp_result = { .has_exception = fp_result.has_exception, .exception = std::move(fp_result.exception) };
}
```
→ **This is the "allow-list of major sites" mechanism**: it is *not* a site allow-list. It is (i) a **first-party-protection allow-list** — rules from the `default` list (which carries `first_party_protections: true` in the catalog) keep applying even for first-party requests, while ordinary first-party matches are dropped in Standard mode; and (ii) **`brave-unbreak.txt`**, "Brave Unbreak", shipped inside the default list as ordinary `$important`-free rules (`list_catalog.json` `sources[]` of uuid `default`). List membership: `kDefaultAdblockFiltersListUuid="default"` and `kFirstPartyAdblockFiltersListUuid="E99CBD02-FFD1-4651-9BDD-6A9ED7B87819"` (`brave_shield_constants.h:112-118`).

### 4c. Default list sources WITH URLs (live catalog, `/tmp/brave-src/list_catalog.json`)

Default-enabled lists (all `permission_mask: 1` where set):

1. **uuid `default` — "Brave Default Adblock Filters"** (hidden, `first_party_protections: true`, component `iodkpdagapdfkphljnddpjlldadblomo`). `sources[]`:
   - uBlock Origin Filters — `https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt`
   - uBlock Origin 2020–2026 Filters — `.../uAssets/filters/filters-2020.txt` … `filters-2026.txt` (8 files)
   - uBlock filters General / Badware risks / Resource abuse / Unbreak / Quick Fixes / link shorteners — `.../uAssets/filters/{filters-general,badware,resource-abuse,unbreak,quick-fixes,ubo-link-shorteners}.txt`
   - **EasyList** — `https://easylist.to/easylist/easylist.txt`
   - URLhaus Malicious URL Blocklist — `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-agh-online.txt`
   - Brave Unbreak — `https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt` and `.../brave-lists/brave-unbreak.txt`
   - Brave Specific / Brave Social / Brave Android-Specific / **SugarCoat Rules** — `.../brave-lists/{brave-specific,brave-social,brave-android-specific,brave-sugarcoat}.txt`
2. **uuid `4D715457-307C-4383-8873-73A2FD263F71` — "Brave Default Privacy Filters"** (hidden, `first_party_protections: true`, component `kihnoaefogbkmblfimmibknnmkllbhlf`): EasyPrivacy `https://easylist.to/easylist/easyprivacy.txt` + uBlock Origin Privacy `.../uAssets/filters/privacy.txt`.
3. **`E99CBD02-…` — Brave First Party Adblock Filters** (hidden, *not* 1P-protected — applies to first-party requests in every mode).
4. **iOS-only**, plus (opt-in by feature flag, default ON) **`AC023D22-…` Cookie notice blocker = EasyList Cookie** (`kBraveAdblockCookieListDefault`) and **`2F3DCE16-…` "Fanboy's Mobile Notifications"** (`kBraveAdblockMobileNotificationsListDefault`). `564C3B75` (Experimental ad blocker) is **default OFF except Nightly/Beta** (`kBraveAdblockExperimentalListDefault`).

**56 non-default lists** are selectable, funded by components — 27 language/regional ad blockers (Arabic bg zh cs/sk nl et fi fr de el he in hu is id it ja/jp ko lv lt mk nb/nn/… fa pl ro ru sv sl tr vi …), 15 YouTube/social/distraction blockers (AI suggestions, newsletter popups, social media, YouTube Shorts/Playables/recommendations/thumbnails/…, paywall, porn, chat apps, tracking URLs), and 3 embed-allow lists (Facebook, X/Twitter, LinkedIn embeds). Regional lists self-enable once by locale (`StartRegionalServices`, `ad_block_component_service_manager.cc:220-262`), guarded by prefs `brave.ad_block.checked_default_region` / `checked_all_default_regions`.

`FarblingConstants`-adjacent UUIDs for Adblock-Only mode: `kAdblockOnlyModeFilterListUUIDs = {default, first-party, 61C6046C-B040-… "Adblock Only Mode supplemental list"}`, English locale only (`brave_shield_constants.h:130-135`, `brave_shields_locale_utils.cc:25-29`).

### 4d. Update cadence & compilation
- **Catalog + components**: `features.cc:132` `constexpr base::FeatureParam<int> kComponentUpdateCheckIntervalMins{&kAdBlockDefaultResourceUpdateInterval, "update_interval_mins", 100};` — re-check **every ~100 min** (`ad_block_component_service_manager.cc:521-527`).
- **Custom subscriptions**: `ad_block_subscription_service_manager.h:52` `inline constexpr uint16_t kSubscriptionDefaultExpiresHours = 7 * 24;` re-downloaded when `until_next_refresh <= 0` (`…cc:200-211`), max 14 days (`kSubscriptionMaxExpiresHours`, `…cc:43`).
- **Compilation**: raw text → `FilterSet::add_filter_list(text, ParseOptions{permissions: PermissionMask})` → compiled into `Engine` → (feature `kAdblockDATCache`, default ON on desktop) **serialized to `engine0.dat` / `engine1.dat` under `<profile>/adblock_cache/`** and deserialized on next startup (`ad_block_dat_cache_manager.cc:36-38,73-89`; `ad_block_service.cc:320-364`).
- **engine → blocking** (`ad_block_engine.cc:100-124`): third-party is computed by Brave (`SameDomainOrHost` w/ private registries) and passed to `ad_block_client_->matches(url, host, initiator_hostname, resource_type, is_third_party, method, previously_matched_rule, force_check_exceptions)`.
- **Domain resolution**: Brave overrides eTLD+1 with the platform's registry list — `components/brave_shields/core/common/adblock/resolver/adblock_domain_resolver.cc:13-26`.
- **CNAME uncloaking**: feature `kBraveAdblockCnameUncloaking` **default ENABLED** (`features.cc:22`) — "Take DNS CNAME records into account when making network request blocking decisions"; backed by the list `brave-firstparty-cname.txt` in `adblock-lists`.
- **Rule-format details** (from `brave/adblock-rust/src/filters/network.rs:104-133`, `NetworkFilterMask`): supports `FROM_{IMAGE,MEDIA,OBJECT,OTHER,PING,SCRIPT,STYLESHEET,SUBDOCUMENT,WEBSOCKET,XMLHTTPREQUEST,FONT,HTTP,HTTPS,DOCUMENT}`, `THIRD_PARTY`/`FIRST_PARTY`, `IS_IMPORTANT`, `MATCH_CASE`, anchoring kinds, `IS_EXCEPTION`, regex. `$redirect`/`$redirect-rule`/`$csp`/`$removeparam` are mutually exclusive per rule (`network.rs:413`). Scriptlet injection permission via `PermissionMask` (`adblock-rust/src/resources/mod.rs:77-121`, e.g. `COOKIE_ACCESS = 0b00000001`).

---

## 5. Farbling / fingerprinting system — every farbled API

**Token generation** — see §1: one random 128-bit `base::Token` per schemeful-site, stored once in `braveShieldsMetadata` under key `farbling_token`.

**Seeded PRNG** — `components/brave_shields/core/common/farbling_prng.h:12-18`:
```cpp
// The seeded pseudo-random generator used across Brave's farbling code to
// deterministically derive farbling values for a given origin.
using FarblingPRNG = absl::random_internal::randen_engine<uint64_t>;
```
Per-context seed (`brave_session_cache.cc:474-482`):
```cpp
FarblingPRNG BraveSessionCache::MakePseudoRandomGenerator(FarbleKey key) {
  uint64_t seed = default_shields_settings_->farbling_token.high() ^
                  default_shields_settings_->farbling_token.low() ^
                  static_cast<uint64_t>(key);
  return FarblingPRNG(seed);
}
```
Session-cached so repeated reads within a page are stable (`farbled_integers_`, `farbling_levels_` members). **Excluded origins**: `file:`, `chrome-extension:`, `chrome-untrusted:` and display-isolated schemes (`brave_session_cache.cc:107-115`).

**Level → intensity** (`brave_shields_utils.cc:794-818`, `GetFarblingLevel`):
- feature `kBraveFarbling` OFF, or shields down → `FarblingLevel::OFF`
- fingerprinting control `ALLOW` → `OFF`
- fingerprinting control `BLOCK` (= Strict) → `MAXIMUM`
- `DEFAULT` (= Standard) → `BALANCED`

### The full farbled-API list (target enum + behavior)

From `chromium_src/components/content_settings/core/common/content_settings_types.mojom:32-51` (the 19 `BRAVE_WEBCOMPAT_*` targets) and the per-API implementations:

| # | Target (content setting name) | Implementation file / function | Balanced | Maximum |
|---|---|---|---|---|
| 1 | `brave-webcompat-audio` — **Audio** | `platform/brave_audio_farbling_helper.cc:FarbleAudioChannel` / `FarbleFloatTimeDomainData` / `FarbleByteTimeDomainData` / `FarbleConvertToByteData` / `FarbleConvertFloatToDb` | multiply by `fudge_factor = 0.999 + (token.high/U64MAX)/1000` | replace samples with LFSR stream `/10` |
| 2 | `brave-webcompat-canvas` — **Canvas** | `core/farbling/brave_session_cache.cc:PerturbPixelsInternal` | HMAC-SHA256 over pixels, flip bits pseudo-randomly | same algorithm (already maximal) |
| 3 | `brave-webcompat-device-memory` — **Device Memory** | `core/frame/navigator_device_memory.cc:FarbleDeviceMemory` | pick from {4,8,16,32} ≤ true value | pick from {2,4,8,16,32} |
| 4 | `brave-webcompat-event-source-pool` — **Event Source Pool** | `chromium_src/.../modules/eventsource/event_source.cc:EventSource::BraveConnect` | acquire a `ResourcePoolLimiter` in-use tracker; if exhausted → `AbortConnectionAttempt()` (connection refused) | same |
| 5 | `brave-webcompat-font` — **Font** | `brave_session_cache.cc:AllowFontFamily` + font whitelist | `prng.discard(hash%16); return (prng()%20)==0` (≈5% allowed) else blocked | same (non-whitelisted fonts blocked outright) |
| 6 | `brave-webcompat-hardware-concurrency` — **Hardware Concurrency** | `core/execution_context/navigator_base.cc:ApplyBraveHardwareConcurrencyOverride` | random in `[4, true_value]` | random in `[4, 8]` |
| 7 | `brave-webcompat-keyboard` — **Keyboard** | `modules/keyboard/navigator_keyboard.cc:NavigatorKeyboard::keyboard` | returns `nullptr` when farbled on | `nullptr` |
| 8 | `brave-webcompat-language` — **Language** | `core/frame/navigator_language.cc:EnsureUpdatedLanguage` | keep only first entry | replace with `["en-US","en"]` |
| 9 | `brave-webcompat-media-devices` — **Media Devices** | `modules/mediastream/media_devices.cc:FarbleMediaDevices` | shuffle from 2nd device on | shuffle from 2nd device on |
| 10 | `brave-webcompat-plugins` — **Plugins** | `modules/plugins/dom_plugin_array.cc:FarblePlugins` | fake names/descriptions/filenames + 2 fake plugins + shuffle | clear list, plus balanced behavior |
| 11 | `brave-webcompat-screen` — **Screen** | `core/frame/screen.cc` + `brave_session_cache.cc:BlockScreenFingerprinting`/`FarbledPointerScreenCoordinate` | `FarbleInteger(kWindowInnerWidth/InnerHeight/ScreenX/ScreenY/PointerScreenX/PointerScreenY, …, 0, 8)` | same, with `GetScreenInfos` override |
| 12 | `brave-webcompat-speech-synthesis` — **Speech Synthesis** | `modules/speech/speech_synthesis.cc:OnSetVoiceList` | real voices + 1 fake ("Hubert","Vernon",…14 names) | empty voice list |
| 13 | `brave-webcompat-usb-device-serial-number` — **USB serial** | `modules/webusb/usb_device.cc:USBDevice::serialNumber` | `GenerateRandomString(name+"WEBUSB_SERIAL_NUMBER", 16)` | same |
| 14 | `brave-webcompat-user-agent` — **User Agent** | `core/execution_context/navigator_base.cc:NavigatorBase::userAgent` | append 0–4 trailing spaces (`kFarbledUserAgentMaxExtraSpaces=5`) | same |
| 15 | `brave-webcompat-webgl` — **WebGL** | `bindings/core/webgl/webgl_farbled_extension_handler.cc` + `webgl_rendering_context_base.cc` | inject 1 fake extension name into `getSupportedExtensions()` (from 21 fakes) | (Scrubbing `vendor/architecture`) |
| 16 | `brave-webcompat-webgl2` — **WebGL2** | same handler for webgl2 | same | same |
| 17 | `brave-webcompat-webgpu` — **WebGPU** | `modules/webgpu/gpu_adapter.cc:BraveScrubWebGpuAdapterInfo` | empty `vendor`/`architecture`/`device` strings (if `kWebGLBalancedFingerprintingProtection`) | empty strings |
| 18 | `brave-webcompat-web-sockets-pool` — **Web Sockets Pool** | `chromium_src/.../modules/websockets/websocket_channel_impl.{h,cc}` (`ShouldDisallowConnection` override) | denies new WebSocket connections once a per-context pool budget is exhausted (mirrors EventSource pool behavior) | same |
| 19 | `brave-webcompat-none` | sentinel, means "global/default level" | — | — |

Key canvas implementation quoted (`brave_session_cache.cc:361-388`):
```cpp
void BraveSessionCache::PerturbPixelsInternal(base::span<uint8_t> data) {
  ...
  auto canvas_key = crypto::hmac::SignSha256(default_shields_settings_->farbling_token.AsBytes(), data);
  uint64_t v = base::U64FromNativeEndian(base::span(canvas_key).first<8u>());
  for (uint8_t key : canvas_key) {
    uint8_t bit = key;
    for (int j = 0; j < 16; j++) { ... data[pixel_index] = data[pixel_index] ^ (bit & 0x1); ... v = lfsr_next(v); }
  }
}
```
LFSR shared across canvas/audio: `((v >> 1) | (((v << 62) ^ (v << 61)) & (~(~zero << 63) << 62)))` (`brave_session_cache.cc:52`, `brave_audio_farbling_helper.cc:21`).

`Math.random` is **NOT** re-seeded by Brave; instead APIs are *farbled* (see `FarbledUserAgent`, `GenerateRandomString`), and `performance.now()` timing farbling was **not** found in this tree — mark **UNVERIFIED**.

### Sub-toggle list → target mapping
The "Block fingerprinting" details list is rendered dynamically from `ContentSettingsType` entries `BRAVE_WEBCOMPAT_NONE < t < BRAVE_WEBCOMPAT_ALL` (`fingerprinting_details.tsx:20-130`), so UI labels are exactly the grdp strings listed in the table above (Audio, Canvas, Device Memory, Event Source Pool, Font, Hardware Concurrency, Keyboard, Language, Media Devices, Plugins, Screen, Speech Synthesis, Usb Device Serial Number, User Agent, WebGL, WebGL2, WebGPU, Web Sockets Pool). Those toggles are stored **per-site** as `BRAVE_WEBCOMPAT_*` content settings written by `SetWebcompatEnabled` (`brave_shields_utils.cc:775-798`) and surfaced to the renderer through `SiteSettings.webcompat_settings` map (`brave_shields_panel.mojom:95-99`).

---

## 6. Where each privacy feature lives

| Feature | Path | Mechanism (one paragraph) |
|---|---|---|
| **SugarCoat** | list `brave-lists/brave-sugarcoat.txt` (385 B, shipped *inside* uuid `default`); engine-side redirect support in adblock-rust | A tiny hand-written list of `$script,important,domain=…,redirect=async-sugarcoat-<sha1>` rules: when a script the site needs to function is blocked, instead of killing it Brave serves a functionally-equivalent no-op shim script from the resource component, so the page still renders. |
| **CNAME uncloaking** | `components/brave_shields/core/common/features.cc:22` `kBraveAdblockCnameUncloaking` (default ON) + list `brave-firstparty-cname.txt` (428 KB) | DNS-resolve the request host; if a CNAME maps to a known tracker domain, re-run the engine match with the canonical name, so `tracker.example-cdn.net` CNAME'd to a blocked tracker still gets blocked. |
| **Ephemeral storage (1PES)** | `browser/ephemeral_storage/` (`tld_ephemeral_lifetime.cc`, `brave_ephemeral_storage_service_delegate.cc`, `ephemeral_storage_tab_helper.cc`) + `net::features::kBraveFirstPartyEphemeralStorage` | Storage for a third-party origin is bound to the lifetime of the first-party TLD-storage-area (key = `{storage_domain, storage_partition_config}` in a process-wide map). When all tabs for that eTLD+1 close, cookies/localStorage/sessionStorage for the third party are wiped. Also used automatically when a domain is on an adblock list and no data was stored yet (`kBraveDomainBlock1PES`). |
| **Forget first-party storage** | `ContentSettingsType::BRAVE_REMEMBER_1P_STORAGE`, eTLD+1-scoped rule, enforces `SESSION_ONLY` cookies + cleanup on `TLDEphemeralLifetime` destruction (`brave_shields_settings_service.cc:255-275`) | Same TLDEphemeralLifetime machinery as 1PES but user-toggled per site ("Forget me when I close this site"), stored as BLOCK on `BRAVE_REMEMBER_1P_STORAGE` for the domain pattern. |
| **Auto-Shred** | `ContentSettingsType::BRAVE_AUTO_SHRED` + `brave_shields::features::kBraveShredFeature` (newer feature) | Same eTLD+1 storage teardown, but with a mode (`NEVER`/`LAST_TAB_CLOSED`/`APP_EXIT`) instead of a boolean; the boolean per-site setting is *rewritten* to this at write time (`Remember1PStorageValueToAutoShredMode`, `brave_content_settings_pref_provider.cc:71-76`). |
| **Debouncing** | `components/debounce/` (`core/browser/debounce_service.cc`, `debounce_rule.cc`, `content/browser/debounce_navigation_throttle.cc`) + component `debounce.json` | A component ships URL patterns (`{"include":[...],"exclude":[...],"action":"redirect","param":"url"}`) for known affiliate/click-tracking redirectors. On navigation to a matched host the URL is rewritten to the target in `param`, skipping the tracking hop entirely (48 entries; hosts cached in `host_cache`). |
| **De-AMP** | `components/de_amp/` (`de_amp_util.cc`, `de_amp_body_handler.cc`) + feature `kBraveDeAMP` + pref `de_amp::kDeAmpPrefEnabled` | A `URFetchedResponseBody`-style net interceptor buffers the HTML head, regex-scans `<html>` for `amp`/`⚡` attributes and finds `<link rel=canonical href>`, then redirects the *top-level* navigation to the canonical URL. Pure regex, RE2, no JS (`kGetHtmlTagPattern`, `kDetectAmpPattern`, `kFindCanonicalLinkTagPattern`). |
| **Query-param stripping** | `components/query_filter/` (`utils.cc`, `query_filter_data.cc`, component `query-filter.json` = 4 include-rules) and `components/url_sanitizer/` (component-driven `include`/`params`/`allow`/`strip`) | The query filter strips a param either unconditionally (from the component's blocklist) or conditionally — only when a value/substring is *absent* (`kConditionalQueryStringTrackers`: `ck_subscriber_id` unless `/unsubscribe`, `h_sid`,`h_slt` unless `/email/`, `mkt_tok` unless unsubscribe/emailWebview). Hosts in `kExemptedHostnames` (e.g. `urldefense.com`) are never touched. URL Sanitizer is the same shape driven by a different component with `include`/`exclude`/`params`/`allow`/`strip` fields. |
| **Cookie-consent blocking** | list `AC023D22-AE88-4060-A978-4FEEEC4221693` = "Cookie notice blocker" (EasyList Cookie) + `brave-cookie-specific.txt` in adblock-lists | Ordinary cosmetic/hide rules that hide the consent banner and auto-click/`:-abp-has()` style rules; enabled by default via `kBraveAdblockCookieListDefault`. |
| **https-upgrade exceptions** | `components/https_upgrade_exceptions/` + list `https-upgrade-exceptions-list.txt` | A plain host list (one per line) of hosts where upgrading breaks the site; `ShouldUpgradeToHttps` consults `HttpsUpgradeExceptionsService::CanUpgradeToHTTPS(url)` in Standard mode (`brave_shields_utils.cc:686-712`). |
| **brave-checks (brand hiding)** | list `brave-checks.txt` (314 hosts, e.g. `github.io`, `techcrunch.com`, `gosugamers.net`) → `ShieldsSettings.hide_brave_brand` → `brave_session_cache.cc:213-226` (`MaybeHideBraveBrand`) and the browser's Sec-CH-UA rewriting | For hosts on the list, the `"Brave"` brand is renamed to `"Google Chrome"` in `navigator.userAgentData.brands` / `brand_full_version_list`, mirroring what the browser already rewrites in Sec-CH-UA headers for those sites. |

---

## 7. Shields-on-by-default & per-site precedence — resolver logic

**Global default**: `BRAVE_SHIELDS` is registered with `CONTENT_SETTING_ALLOW` (`content_settings_registry.cc:137-140`) ⇒ shields ON everywhere by default. Per-site "shields down" writes `CONTENT_SETTING_BLOCK` **only if it differs from the registered default**, otherwise it writes `CONTENT_SETTING_DEFAULT` (i.e. removes the override) — `brave_shields_utils.cc:204-262` (`SetBraveShieldsEnabled`):
```cpp
// this is 'allow_brave_shields' so 'enable' == 'allow'
const auto setting = enable ? CONTENT_SETTING_ALLOW : CONTENT_SETTING_BLOCK;
if (map->IsOffTheRecord() ||
    setting != map->GetDefaultContentSetting(ContentSettingsType::BRAVE_SHIELDS, nullptr)) {
  map->SetContentSettingCustomScope(primary_pattern, ContentSettingsPattern::Wildcard(),
                                    ContentSettingsType::BRAVE_SHIELDS, setting);
  ...
} else {
  map->SetContentSettingCustomScope(primary_pattern, ContentSettingsPattern::Wildcard(),
                                    ContentSettingsType::BRAVE_SHIELDS, CONTENT_SETTING_DEFAULT);
}
```

**Resolver** — `IsBraveShieldsEnabled` (`brave_shields_utils.cc:264-278`):
```cpp
ContentSetting setting = map->GetContentSetting(url, GURL(), ContentSettingsType::BRAVE_SHIELDS);
// see EnableBraveShields - allow and default == true
return setting == CONTENT_SETTING_BLOCK ? false : true;
```
Chromium's content-settings map already resolves specificity (exact host > domain > default) and **incognito inheritance**, so Brave gets per-site > global for free. Domain-wide "shields down" also propagates to parent domains: `IsShieldsDisabledOnAnyHostMatchingDomainOf` (`brave_shields_settings_service.cc:322-357`) walks all `BRAVE_SHIELDS` rules and compares `net::URLToEphemeralStorageDomain` (eTLD+1).

**Cookies resolve differently** — `BraveCookieRules::CalculateRules` (`brave_shields_utils.cc:64-152`) merges a *general* rule (`[*, <host>]` secondary) with a *first-party* rule (`[<domain>, <host>]`), falling back to Chromium's own cookie default; a policy-managed default wins outright.

**Per-site overrides survive later global changes — CONFIRMED, and structurally guaranteed.** Per-site settings are stored as *explicit host rules* in `profile.content_settings.exceptions.<name>` (pref path built by `GetShieldsSettingUserPrefsPath`, `brave_content_settings_utils.cc:92-94`: `"profile.content_settings.exceptions." + name`). A global change only rewrites the default (`SetDefaultContentSetting` / wildcard rule), never the per-host entries — see `SetCookieControlType`/`SetFingerprintingControlType` which take `url.is_empty()` to mean "global" and otherwise write `GetPatternFromURL(url)` patterns. The only exception: **wildcard entries are forcibly cleared for `BRAVE_SHIELDS`** so there is never a global shields-off rule — `brave_content_settings_pref_provider.cc:1047-1079` + `EnsureNoWildcardEntries`:
```cpp
void BravePrefProvider::EnsureNoWildcardEntries(ContentSettingsType content_type) {
  // ContentSettingsType::BRAVE_SHIELDS should not have wildcard entries, i.e.
  // there is no global disabled value.
  SetWebsiteSetting(ContentSettingsPattern::Wildcard(), ContentSettingsPattern::Wildcard(), content_type, base::Value(), {});
}
```
and `GetCookieRulesForShieldsDown` skips any wildcard shields rule explicitly (`bcsp.cc:1068-1074`). So the recon's assertion ("first visit inherits global defaults; per-site override survives later global changes") is **correct**, with the nuance that "global shields off" does not exist as a stored rule at all.

**Shields-down ⇒ everything off**: farbling OFF (`GetFarblingLevel`), cookies forced ALLOW via synthetic `[*, host] → ALLOW` rules (`bcsp.cc:1074-1089`), de-AMP/reduce-language/domain-block all bail out on `IsBraveShieldsEnabled`.

**"Allow once"** for scripts is session-scoped in the renderer/browser (`AllowScriptsOnce`, §3) and surfaced as `origins_to_allow_scripts`.

---

## 8. brave://flags that affect shields

Flag names from `browser/about_flags.cc` (Brave-specific section; format `name`, label, description):

| Flag | What it does |
|---|---|
| `brave-farbling` | "Enable Brave Farbling" — randomization of fingerprinting-susceptible WebAPIs (`kBraveFarbling`, ON) |
| `brave-farbling-token-reset` | "Enable Brave Farbling token reset" — resets the farbling token across browser restarts (`kBraveFarblingTokenReset`, ON) |
| `brave-block-screen-fingerprinting` | blink `kBraveBlockScreenFingerprinting` — screen dims + pointer coords |
| `brave-webgl-balanced-fingerprinting-protections` | enables the balanced WebGL fake-extension handler |
| `brave-show-strict-fingerprinting-mode` | exposes Strict (Aggressive) fingerprinting as a 3-way dropdown instead of a toggle |
| `brave-reduce-language` | `kBraveReduceLanguage` — reduces `navigator.languages` + font enumeration |
| `brave-webcompat-exceptions-service` | per-site feature exceptions (the sub-toggle disable list) |
| `brave-adblock-dat-cache` | serialize compiled engines to `engine0.dat`/`engine1.dat` |
| `brave-adblock-cname-uncloaking` | CNAME uncloaking |
| `brave-adblock-collapse-blocked-elements` | collapse `img`/`iframe` with blocked `src` |
| `brave-adblock-cookie-list-default` | EasyList Cookie on by default |
| `brave-adblock-cosmetic-filtering` | cosmetic filtering |
| `brave-adblock-procedural-filtering` | `:has-text()` / `:upward()` operators |
| `brave-adblock-csp-rules` | `$csp` support |
| `brave-adblock-default-1p-blocking` | block first-party requests that match a filter list in Standard mode |
| `brave-adblock-scriptlet-debug-logs` | scriptlet debug logging |
| `brave-adblock-show-hidden-components` | show hidden filter lists in `brave://settings/shields/filters` |
| `brave-adblock-mobile-notifications-list-default`, `brave-adblock-experimental-list-default` | default-enable Fanboy Mobile / Experimental lists |
| `brave-ad-block-only-mode` | Adblock-Only mode (English locale) |
| `brave-domain-block`, `brave-domain-block-1pes` | domain blocking + 1PES variant |
| `brave-debounce`, `brave-de-amp` | debouncing / De-AMP |
| `brave-first-party-ephemeral-storage`, `brave-ephemeral-storage-keep-alive`, `brave-provisional-tld-ephemeral-lifetime` | 1PES family |
| `brave-forget-first-party-storage` | "Forget me when I close this site" |
| `brave-shred` | Auto-Shred (data deletion modes) |
| `brave-shields-page-info` | moves the Shields panel into the Page Info bubble |
| `brave-show-updated-shields-panel` | the `panel_new` React UI (ON) |
| `brave-extension-network-blocking` | run shields on extension network requests |
| `brave-clean-link-js-api` / `brave-copy-clean-link-by-default` | query-param stripping JS API & copy behavior |

---

## Deltas from `replica/recon.md`

**Confirmed**
1. `recon.md:295` `ShieldRule.shield_enabled (bool)` — correct: `BRAVE_SHIELDS` is ALLOW/BLOCK (`content_settings_registry.cc:137`).
2. `ads_trackers (standard|aggressive|off)` — **structurally correct but two settings, not one**: `SetAdBlockMode` writes `BRAVE_ADS`/`BRAVE_TRACKERS` *and* `BRAVE_COSMETIC_FILTERING` (`brave_shields_settings_service.cc:117-140`). The third state is `ALLOW`, value `allow`.
3. `https_upgrade (auto|strict|off)` — real enum `HttpsUpgradeMode{STRICT_MODE, STANDARD_MODE, DISABLED_MODE}`; **rename**: `auto` → **standard** ("Upgrade connections to HTTPS").
4. `scripts (allow|block)` — stored on Chromium's `JAVASCRIPT` setting, label is "Block scripts" toggle.
5. `cookies (block_3p|block_all|allow_all)` — real enum `CookieBlockMode{CROSS_SITE_BLOCKED, BLOCKED, ALLOW}`, **exactly matching** those three labels.
6. `fingerprinting (on|off)` — real enum has **three** values: `FingerprintMode{STRICT_MODE, STANDARD_MODE, ALLOW_MODE}`; Strict is hidden behind `brave-show-strict-fingerprinting-mode` and `kBraveShowStrictFingerprintingMode`, which is **`FEATURE_DISABLED_BY_DEFAULT`** (`features.cc:91-92`) → *effectively two-state in release*. Control-type mapping in `GetFingerprintingControlType` collapses `CONTENT_SETTING_BLOCK` back to `DEFAULT` when strict mode is unavailable (`brave_shields_utils.cc:641-656`).
7. `fp_subtoggles (json)` — confirmed as 19 discrete `BRAVE_WEBCOMPAT_*` content settings (not one JSON blob) + a `SiteSettings.webcompat_settings` map for the UI.
8. `forget_me_on_close (bool)` — superseded by `AutoShredMode` (3 values) migrating from `BRAVE_REMEMBER_1P_STORAGE`; the boolean per-site setting is rewritten at write time.
9. Precedence claim at `recon.md:123` ("first visit inherits global defaults; per-site override survives later global changes") — **CONFIRMED** with the added fact that global shields-off is structurally impossible (`EnsureNoWildcardEntries`).
10. Filter lists are component/CRX-updated, not raw-URL-fetched, except user-added custom subscriptions (7-day expiry) — `recon.md:301` `FilterList.source_url` should be a **component id + uuid**, with `url` retained for catalog display only.
11. Row labels "Trackers and ads", "HTTPS upgrade", "Block scripts", "Block fingerprinting", "Block third-party cookies", "Forget me when I close this site" — confirmed verbatim as the *current* labels (they've shifted over time; e.g. fingerprinting now offers "Aggressively block fingerprinting" when strict mode is enabled).
12. "Shields on by default" — confirmed (`BRAVE_SHIELDS` default `CONTENT_SETTING_ALLOW`).
13. Farbleing token: 32-hex, per-site, `base::Token` — confirmed, and now fully specified (§1). The recon's `braveShieldsMetadata` observation is explained by exactly one key, `farbling_token`.
14. SugarCoat / CNAME uncloaking / ephemeral storage / de-AMP / debouncing / query-param stripping / cookie-consent blocking — all confirmed to exist as separate components with the mechanisms in §6.
15. uBO lists are used: Brave's default list is **uBlock Origin filters + EasyList + URLhaus + Brave's own lists** (not EasyList/EasyPrivacy alone) — this *sharpens* the recon's "adblock engine" story.
16. `AllowScriptsOnce` per-origin allow-once exists (`brave_shields_panel.mojom:47`), matching recon's "Allow" per script.

**Contradicted / corrected**
17. **No `block_aggressive` state on ads.** Aggressive vs Standard is expressed by `BRAVE_COSMETIC_FILTERING` = `BLOCK` vs `BLOCK_THIRD_PARTY` (`brave_shields_settings_service.cc:124-131`); the ads control itself is only allow/block.
18. **"kAds/kScripts/kCosmeticFiltering" naming in recon is close but the real content-setting names are** `shieldsAds`, `cosmeticFilteringV2`, `trackers`, `httpUpgradableResources`, `httpsUpgrades`, `javascript`, `fingerprintingV2`, `braveShields`, `referrers`, `shieldsCookiesV3`, `braveAutoShred` (`brave_shield_constants.h:22-35`). Several are versioned (`V2`, `V3`) because of migrations — a clone should pick unversioned names but must handle the obsolete aliases if it ever imports a Brave profile.
19. **`farbling_token` is not JSON-encoded metadata with several fields.** The per-site dictionary has exactly one field. Any "ShieldRule.farbling_token" column is right, but "metadata json blob" would be wrong.
20. **The fingerprinting sub-toggles are not a per-site JSON map stored in one place** — they're 19 independent content settings plus a remote-list provider, which is how they can be force-disabled remotely (`RemoteListProvider` returns `CONTENT_SETTING_ALLOW` for matched patterns and is read-only).
21. **Regional lists are enabled once by locale and then user-overridable** (`kAdBlockCheckedAllDefaultRegions`) — the recon's "regional language lists" is right, but they are *not* re-enabled when the locale changes unless untouched (`kAdBlockCheckedDefaultRegion`).
22. **Ephemeral storage is not "forget third-party cookies"** — it's TLD-partitioned storage whose lifetime follows the first-party tab set (`tld_ephemeral_lifetime.cc`), and there is a separate, *user-toggleable* "Forget me when I close this site".
23. **De-AMP is head-buffer regex only, no JS execution** (`de_amp_util.cc:22-45`) — narrower than "strips AMP links".
24. **Query-param stripping has conditional rules** (strip only when a URL does *not* contain a given substring) — the recon's "removes tracking params" understates it.
25. **SugarCoat is not a scriptlet library**; it's ~385 bytes of `redirect=rule` entries in the default list.
26. **There is no first-party site "allow-list of major sites" file** — the equivalent behavior is (a) `first_party_protections` on the default lists and (b) `brave-unbreak.txt` shipped in the default list (`ad_block_engine_wrapper.cc:66-84`). **This is the highest-value correction to the recon.**
27. **`Math.random` is not farbled** (it's Chromium's); Brave farbles APIs instead. Performance-timing farbling not found in this tree — treat as **UNVERIFIED**.
28. `AutoShredMode` (`braveAutoShred`) is a *newer* addition superseding `BRAVE_REMEMBER_1P_STORAGE`; the recon should model shred mode as an enum, not a bool.

**Could not verify (budget/coverage limits)**
- The browser-process consumer of `brave-checks.txt` (the `WebContents`/`WebContentSettingsClient` glue that sets `ShieldsSettings.hide_brave_brand`) — the list, the mojom field, and the renderer-side renamamer (`MaybeHideBraveBrand`) are all confirmed; the loading site is inferred, since it lives in `browser/` rather than `components/` and was outside the files I fetched.
- Cosmetic-filtering resource/scriptlet internals (`components/cosmetic_filters/`) and `ad_block_default_resource_provider.cc` were saved to `/tmp/brave-src/` but not read line-by-line.
- `RemoteListProvider`'s exact registration order vs. user rules for the webcompat sub-toggles (the read-only `ALLOW` semantics are confirmed from `remote_list_provider.cc`, but whether a user toggle can override a remote exception is not read).
