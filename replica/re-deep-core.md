# Deep core recon: how Brave's product is actually assembled

Source of truth: **github.com/brave/brave-core** (branch `master`). MPL-2.0.
Note on navigation: `brave/brave-browser` is *only* the issue tracker — its README says
"This repository is not needed for building the browser… The source code and contributions are
at https://github.com/brave/brave-core." All paths below are `brave-core` paths.

Method: one recursive git-tree API call gave all ~63,831 tracked paths (this is the documented
"list everything at once" move — far better than guessing filenames), then all file bodies came
from `raw.githubusercontent.com`. **API calls used: 11 of 60** (repo probe, 10 raw/https +
`rate_limit`). A complete shallow clone also exists at `/tmp/brave-src/bc` (HEAD `436c2286`,
2026-10-12) which was diffed against the raw copies for the files we rely on — **identical**.

Cache: `/tmp/brave-src/`
- `core-tree.json` (18 MB) — full recursive tree, all paths, sizes
- `bc/` — full git clone (63,831 files) incl. all 1,287 patches
- `src/` — raw-fetched bodies for the files cited here
- `features/` — all 30 product `features.{cc,h}` files
- `prefs/` — all product `pref_names.h` files
- `patches/` — the 9 patches quoted verbatim in §3
- `feat-paths.txt`, `fetch{,2,3}.txt` — fetch manifests

Confidence: every claim below is quoted from source with a file path. `[UNVERIFIED]` marks
anything I could not reach. Nothing is guessed.

---

## 1. Feature flag inventory

Two-layer answer, because this is what the recon inferred from docs and got wrong:

`browser/brave_browser_features.cc` is **NOT** the product flag list — it holds only 14
`BASE_FEATURE`s, mostly platform/A-B knobs. The real inventory is ~30 per-component
`components/<area>/.../features.cc` files. Total product surface enumerated here: **~180 flags**,
of which the shipped-by-default set is below.

### 1.1 `browser/brave_browser_features.cc` — the 14 flags (all of them)

```cpp
BASE_FEATURE(kBraveNewTabPageRefreshEnabled, base::FEATURE_ENABLED_BY_DEFAULT);
BASE_FEATURE(kBraveCleanupSessionCookiesOnSessionRestore, base::FEATURE_ENABLED_BY_DEFAULT);
BASE_FEATURE(kBraveCopyCleanLinkByDefault, "brave-copy-clean-link-by-default",
#if BUILDFLAG(IS_MAC)
             base::FEATURE_DISABLED_BY_DEFAULT
#else
             base::FEATURE_ENABLED_BY_DEFAULT
#endif
);
BASE_FEATURE(kBraveCopyCleanLinkFromJs, base::FEATURE_DISABLED_BY_DEFAULT);
BASE_FEATURE(kBraveRoundedCornersByDefault, "brave-web-view-rounded-corners", base::FEATURE_DISABLED_BY_DEFAULT);
BASE_FEATURE(kBraveOverrideDownloadDangerLevel, "brave-override-download-danger-level", base::FEATURE_DISABLED_BY_DEFAULT);
BASE_FEATURE(kBraveDayZeroExperiment, base::FEATURE_DISABLED_BY_DEFAULT);
BASE_FEATURE(kBraveEnableShieldsForWebSocketsFromWorkers, base::FEATURE_ENABLED_BY_DEFAULT);
BASE_FEATURE(kBraveWebAssemblyJitless, base::FEATURE_DISABLED_BY_DEFAULT);   // BRAVE_V8_ENABLE_DRUMBRAKE
BASE_FEATURE(kBraveV8JitlessMode, base::FEATURE_DISABLED_BY_DEFAULT);
BASE_FEATURE(kBraveAndroidDynamicColorsByDefault, base::FEATURE_ENABLED_BY_DEFAULT);       // Android
BASE_FEATURE(kBraveFreshNtpAfterIdleExperiment, base::FEATURE_ENABLED_BY_DEFAULT);         // Android
BASE_FEATURE(kBraveCustomSearchEngines, base::FEATURE_ENABLED_BY_DEFAULT);                 // Android
BASE_FEATURE(kBraveAndroidTabGroupsSettings, base::FEATURE_ENABLED_BY_DEFAULT);            // Android
```
(`kBraveDayZeroExperimentVariant` param default `""`; `kBraveFreshNtpAfterIdleExperimentVariant` default `"B"`.)

### 1.2 Shields — `components/brave_shields/core/common/features.cc` (36 flags)

Shipped **ENABLED_BY_DEFAULT** (desktop): `kAdBlockDefaultResourceUpdateInterval`,
`kBraveAdblockCnameUncloaking`, `kBraveAdblockCollapseBlockedElements`,
`kBraveAdblockCookieListDefault`, `kBraveAdblockCosmeticFiltering`,
`kBraveAdblockProceduralFiltering`, `kBraveAdblockCspRules`,
`kBraveAdblockMobileNotificationsListDefault`, `kBraveDomainBlock`, `kBraveDomainBlock1PES`,
**`kBraveFarbling`**, **`kBraveFarblingTokenReset`**, **`kBraveReduceLanguage`**,
`kBraveShieldsContentSettingsIOS`, `kBraveIOSEnableFarblingPlugins`,
`kCosmeticFilteringSyncLoad`, `kBraveShieldsElementPicker`, `kCosmeticFilteringJsPerformance`,
`kWebKitGlobalPrivacyControl` (iOS navigation requests), `kShowUpdatedShieldsPanel`,
and `kAdblockOnlyMode` (desktop only — see below).

Shipped **DISABLED_BY_DEFAULT**: `kBraveAdblockDefault1pBlocking`, `kBraveAdblockScriptletDebugLogs`,
`kBraveAdblockShowHiddenComponents`, `kBraveAdblockExperimentalListDefault`,
`kBraveExtensionNetworkBlocking`, `kBraveShredFeature` (**ON** on iOS/Android, **OFF** on desktop),
`kBraveShredCacheData` (**ON** on iOS, **OFF** elsewhere), `kBraveIOSDebugAdblock`,
`kBraveShowStrictFingerprintingMode`, `kBraveAdblockOnlyMode` (**OFF** on iOS/Android,
**ON** on desktop — see below), `kWebKitAdvancedPrivacyProtections`,
`kTransitionToUpstreamHttpsUpgrades`, `kAdblockOverrideRegexDiscardPolicy`,
`kAdblockDATCache`, `kCosmeticFilteringExtraPerfMetrics`.

Build-flag-split values, verbatim from the cached file
(`/tmp/brave-src/features/components/brave_shields/core/common/features.cc:68-132`) — these are the
ones whose default depends on platform, and the desktop column is what our clone must match:
```cpp
// When enabled, brave shred feature will be available
BASE_FEATURE(kBraveShredFeature,
#if BUILDFLAG(IS_IOS) || BUILDFLAG(IS_ANDROID)
             base::FEATURE_ENABLED_BY_DEFAULT);
#else
             base::FEATURE_DISABLED_BY_DEFAULT);
#endif
// When enabled, brave shred will clear all cache data when shredding.
BASE_FEATURE(kBraveShredCacheData,
#if BUILDFLAG(IS_IOS)
             base::FEATURE_ENABLED_BY_DEFAULT);
#else
             base::FEATURE_DISABLED_BY_DEFAULT);
#endif
// When enabled, show Strict (aggressive) fingerprinting mode in Brave Shields.
BASE_FEATURE(kBraveShowStrictFingerprintingMode,
             base::FEATURE_DISABLED_BY_DEFAULT);
// If the feature flag is on, we show the Block all Cookies toggle
BASE_FEATURE(kBlockAllCookiesToggle,
#if BUILDFLAG(IS_IOS)
             base::FEATURE_ENABLED_BY_DEFAULT);
#else
             base::FEATURE_DISABLED_BY_DEFAULT);
#endif
BASE_FEATURE(kAdblockOnlyMode,
#if BUILDFLAG(IS_IOS) || BUILDFLAG(IS_ANDROID)
             base::FEATURE_DISABLED_BY_DEFAULT);
#else
             base::FEATURE_ENABLED_BY_DEFAULT);
#endif  // BUILDFLAG(IS_IOS) || BUILDFLAG(IS_ANDROID)
```
Other params in the same file: `kComponentUpdateCheckIntervalMins` default `100` (on
`kAdBlockDefaultResourceUpdateInterval`).

Notable for our engine-coupled list:
- `kAdblockOnlyMode` is **ENABLED_BY_DEFAULT on desktop** (disabled only on iOS/Android) — i.e.
  Brave ships a mode in which Shields is ad-blocking-only (no cookie/fingerprinting controls shown),
  with an opt-in prompt (`brave.shields.adblock_only_mode_was_enabled_for_supported_locale`,
  `brave.shields.adblock_only_mode_prompt_dismissed`). This is a real product default we don't have.
- `kBraveShowStrictFingerprintingMode` **default OFF** — "Strict" fingerprinting mode is opt-in,
  not shipped (recon's "Standard vs Aggressive" framing maps to blocking level, not this).
- `kBraveAdblockExperimentalListDefault` **default OFF** — the experimental filter list ships off.
- `kBlockAllCookiesToggle` is **iOS-only** — the "Block all cookies" toggle is not a desktop surface
  (desktop's cookie control is the 3-state per-site control in S08 instead).
- `kBraveShredFeature`/`kBraveShredCacheData` are **mobile-only**; the desktop shred pref still
  exists (`brave.shields.shred_browsing_history`, default false) but the feature is flag-gated off.

### 1.3 Wallet — `components/brave_wallet/common/features.cc`

| flag | default |
| --- | --- |
| `kBraveWalletBitcoinFeature` | **ON** |
| `kBraveWalletBitcoinImportFeature` | **ON** |
| `kBraveWalletBitcoinLedgerFeature` | **ON** |
| `kBraveWalletZCashFeature` | **ON** |
| `kBraveWalletPolkadotFeature` | platform-split (desktop OFF) |
| `kBraveWalletCardanoFeature` | platform-split (desktop ON) |
| `kBraveWalletDebugFeature` | OFF |
| `kBraveWalletAnkrBalancesFeature` | OFF |
| `kBraveWalletTransactionSimulationsFeature` | OFF |
| `kBraveWalletMojoForLedgerFeature` | **ON** |
| `kBraveWalletAccountHidingFeature` | platform-split (desktop ON) |
| `kBraveWalletSnapFeature` | OFF |
| `kBraveWalletSidePanel` | OFF |
| `kBraveWalletFilecoinLedger` | **ON** |

### 1.4 VPN — `components/brave_vpn/common/features.cc`

`kBraveVPN` **ON** (desktop), `kBraveVPNExperimentalV2` OFF, `kBraveVPNLinkSubscriptionAndroidUI` ON,
`kBraveVPNDnsProtection` **ON**, `kBraveVPNUseWireguardService` **ON**,
`kBraveVPNEnableWireguardForOSX` OFF.

### 1.5 Rewards — `components/brave_rewards/core/features.cc`

`kBraveRewards` **ENABLED** (desktop; disabled on Android buildflag),
`kVerboseLoggingFeature` OFF, `kAllowUnsupportedWalletProvidersFeature` OFF,
`kAllowSelfCustodyProvidersFeature` **ON**, `kAnimatedBackgroundFeature` OFF,
`kPlatformCreatorDetectionFeature` mobile-only.

### 1.6 Sync / News / Playlist / Speedreader / Origin / Talk / Account

| component | flag | default |
| --- | --- | --- |
| sync | `kBraveSync` | **ON** |
| sync | `kBraveSyncDefaultPasswords` | **ON** |
| news | `kBraveNewsCardPeekFeature` | **ON** |
| news | `kBraveNewsSidebar` | **ON** |
| news | `kBraveNewsFeedUpdate` | ON desktop / OFF Android |
| news | `kBraveNewsNewUserOptIn` | **OFF** |
| playlist | `kPlaylist` | **OFF on desktop**, ON iOS |
| playlist | `kPlaylistFakeUA` | OFF |
| speedreader | `kSpeedreaderFeature` | **ON** |
| origin | `kBraveOrigin` | **ON** |
| account | `kBraveAccount` | **OFF** |
| psst | `kEnablePsst` | OFF |

Params on `kBraveNewsFeedUpdate`: `kBraveNewsMinBlockCards` default `1`.
Params on `kSpeedreaderFeature`: `kSpeedreaderMinOutLengthParam`, `kSpeedreaderTTS`,
`kSpeedreaderDebugView`, `kSpeedreaderExplicitPref`.

**Tor and WebTorrent have no `BASE_FEATURE` at all** — both are build-flag-gated
(`ENABLE_TOR`, and WebTorrent is a registered pref, `kWebTorrentEnabled`, added 05/2025 in
`brave_profile_prefs.cc`). Same for Talk (`enable_brave_talk = !is_brave_origin_branded` in
`components/brave_talk/buildflags/buildflags.gni`).

### 1.7 Leo — `components/ai_chat/core/common/features.cc` (FOR THE RECORD ONLY)

`kAIChat` **ON**, `kAIChatHistory` **ON**, `kAIChatUserChoiceTool` **ON**,
`kAIChatGlobalSidePanelEverywhere` **ON**, `kAIChatMoveFullPageToSidePanel` **ON**,
`kCustomSiteDistillerScripts` **ON**, `kContextMenuRewriteInPlace` **ON**,
`kOpenAIChatFromBraveSearch` **ON** (desktop), `kPageContextEnabledInitially` **ON**,
`kTabOrganization` **ON**, `kTabManagementTool` **ON**, `kBraveSummaryModel` **ON**,
`kRichSearchWidgets` **ON**, `kCodeExecutionTool` **ON**, `kAIChatMathRendering` **ON**,
`kAIChatConversationShare` **ON**.
OFF: `kAIChatRemoteModelsConfig`, `kAIChatFirst`, `kAIChatWorkspaceTools`,
`kAIChatAgentProfile`, `kAIChatDetailedPageContentExtraction`, `kAllowPrivateIPs`,
`kNEARModels`, `kShowAIChatInputOnNewTabPage`, `kAIChatDeepResearch`, `kBraveSyncAIChat`,
`kAIChatThreads`, `kAIChatExportJSON`.
Params: `kFreemiumAvailable` default `true`, `kAIChatSSE` default `true`,
`kOmniboxOpensFullPage` default `true`, `default_model`/`default_premium_model` =
`kChatAutomaticModelKey`, premium vision default = Claude Sonnet key.

---

## 2. Pref inventory

Real pref strings are in per-component `pref_names.h`; `brave_profile_prefs.cc` is the
registration hub. Everything below is the literal string.

### 2.1 Shields / adblock (`components/brave_shields/core/common/pref_names.h`)
```
brave.ad_block.checked_default_region        brave.ad_block.checked_all_default_regions
brave.ad_block.cookie_list_opt_in_shown      brave.ad_block.cookie_list_setting_touched
brave.ad_block.mobile_notifications_list_setting_touched
brave.ad_block.custom_filters                brave.ad_block.regional_filters
brave.ad_block.list_subscriptions            brave.ad_block.debug_mode
brave.ad_block.developer_mode
brave.shields.fb_embed_default               brave.shields.twitter_embed_default
brave.shields.linkedin_embed_default         brave.reduce_language
brave.https_upgrade_settings_migrated        brave.shields.adblock_only_mode_enabled
brave.shields.adblock_only_mode_was_enabled_for_supported_locale
brave.shields.disabled_count                 brave.shields.adblock_only_mode_prompt_dismissed
brave.allow_element_blocker_in_private_mode  brave.shields.shred_browsing_history
```
Registered in `brave_profile_prefs.cc` with defaults: `kAdControlType`=true,
`kShieldsAdvancedViewEnabled`=false, `kShieldsStatsBadgeVisible`=true,
`kBraveHistoryRetentionDays`=90, `kTrackingQueryParametersFilteringEnabled`=true,
`kGlobalPrivacyControlEnabled`=true, `kAdBlockDeveloperMode`=false,
`kShieldsDisabledCount`=0, `kAdBlockOnlyModePromptDismissed`=false,
`kBraveWaybackMachineEnabled`=true, `kBraveWaybackMachineAutoCheckEnabled`=false.

Engine-coupled global overrides (same file, `OverrideDefaultPrefValues`):
```cpp
registry->SetDefaultPrefValue(omnibox::kAIModeSettings, base::Value(-1));
registry->SetDefaultPrefValue(prefs::kWebRtcEventLogCollectionAllowed, base::Value(false));
registry->SetDefaultPrefValue(prefs::kWebRtcTextLogCollectionAllowed, base::Value(false));
```

### 2.2 Wallet (`components/brave_wallet/browser/pref_names.h`, 46 strings)
```
brave.wallet.keyrings                  brave.wallet.encrypted_mnemonic
brave.wallet.encryptor_salt            brave.wallet.aes_256_gcm_siv_nonce (deprecated)
brave.wallet.encrypted_seed (deprecated) brave.wallet.pref_version (deprecated)
brave.wallet.opted_in (deprecated)     brave.wallet.mnemonic_backed_up
brave.wallet.default_wallet2           brave.wallet.default_solana_wallet
brave.wallet.default_cardano_wallet    brave.wallet.default_base_currency
brave.wallet.default_base_cryptocurrency
brave.wallet.auto_lock_minutes         brave.wallet.wallet_last_unlock_time_v2
brave.wallet.show_wallet_icon_on_toolbar  brave.wallet.should_show_wallet_suggestion_badge
brave.wallet.private_windows_enabled   brave.wallet.disabled_by_policy
brave.wallet.custom_networks           brave.wallet.eip1559_chains
brave.wallet.hidden_networks           brave.wallet.hidden_accounts
brave.wallet.selected_networks         brave.wallet.selected_networks_origin
brave.wallet.selected_eth_dapp_account brave.wallet.selected_sol_dapp_account
brave.wallet.selected_ada_dapp_account brave.wallet.selected_wallet_account
brave.wallet.user_assets_list          brave.wallet.eth_allowances_cache
brave.wallet.nft_discovery_enabled     brave.wallet.last_discovered_assets_at
brave.wallet.polkadot_chain_metadata   brave.wallet.transaction_simulation_opt_in_status
brave.wallet.keyring_encryption_keys_migrated  brave.wallet.legacy_eth_seed_format
brave.wallet.localhost_networks_migrated
```
Defaults (`components/brave_wallet/browser/pref_names.cc`):
```cpp
constexpr int kDefaultWalletAutoLockMinutes = 10;
registry->RegisterIntegerPref(kDefaultEthereumWallet,
    static_cast<int>(brave_wallet::mojom::DefaultWallet::BraveWalletPreferExtension));
registry->RegisterIntegerPref(kDefaultSolanaWallet,   /* same */);
registry->RegisterIntegerPref(kDefaultCardanoWallet,  static_cast<int>(...::BraveWallet));
registry->RegisterStringPref(kDefaultBaseCurrency, "USD");
registry->RegisterStringPref(kDefaultBaseCryptocurrency, "BTC");
registry->RegisterBooleanPref(kShowWalletIconOnToolbar, true);
registry->RegisterDictionaryPref(kBraveWalletKeyrings);          // <-- keyring blob lives here
registry->RegisterStringPref(kBraveWalletEncryptorSalt, "");
registry->RegisterIntegerPref(kBraveWalletAutoLockMinutes, kDefaultWalletAutoLockMinutes);
registry->RegisterBooleanPref(kBraveWalletPrivateWindowsEnabled, false);
registry->RegisterBooleanPref(kBraveWalletDisabledByPolicy, false);
```

### 2.3 Rewards + Ads (`components/brave_rewards/core/pref_names.h`, `components/brave_ads/core/public/prefs/pref_names.h`)
```
brave.rewards.enabled                       brave.rewards.parameters
brave.rewards.ac.enabled                    brave.rewards.ac.amount
brave.rewards.ac.allow_video_contributions  brave.rewards.ac.allow_non_verified
brave.rewards.ac.min_visits                 brave.rewards.ac.min_visit_time
brave.rewards.ac.next_reconcile_stamp       brave.rewards.ac.score.a/.b
brave.rewards.wallets.brave                 brave.rewards.wallets.gemini
brave.rewards.wallets.bitflyer              brave.rewards.wallets.solana
brave.rewards.wallet.payment_id             brave.rewards.wallet.seed
brave.rewards.external_wallets              brave.rewards.external_wallet_type
brave.rewards.self_custody_available        brave.rewards.user_has_funded
brave.rewards.declared_geo                  brave.rewards.tos_version
brave.rewards.creation_stamp                brave.rewards.user_version
brave.rewards.version                       brave.rewards.use_staging_server
brave.rewards.inline_tip_buttons_enabled    brave.rewards.inline_tip.{github,reddit,twitter}
brave.hide_brave_rewards_button             brave.rewards.disabled_by_policy

brave.brave_ads.ads_per_hour                brave.brave_ads.notification_ads
brave.brave_ads.notifications.enabled       brave.brave_ads.sponsored.enabled
brave.brave_ads.catalog_id / catalog_version / catalog_last_updated / catalog_ping
brave.brave_ads.issuers / issuer_ping       brave.brave_ads.ohttp.key_config.public_key
brave.brave_ads.ads_subdivision_targeting_code
brave.brave_ads.automatically_detected_ads_subdivision_targeting_code
brave.brave_ads.should_allow_ads_subdivision_targeting
brave.brave_ads.reactions.{ads, marked_as_inappropriate, saved_ads, segments}
brave.brave_ads.diagnostics.id              brave.brave_ads.serve_ad_at
brave.brave_ads.rewards.next_time_redemption_at
brave.brave_ads.should_show_my_first_ad_notification
brave.brave_ads.ever_enabled_any_profile    brave.brave_ads.enabled_last_profile
brave.search.search_result_ad.should_show_clicked_infobar
```

### 2.4 Everything else (literal namespaces)

```cpp
// brave_vpn  (components/brave_vpn/common/pref_names.h)
brave.brave_vpn                          // kBraveVPNRootPref — the whole tree hangs here
brave.brave_vpn.show_button / .disabled_by_policy / .migrated
brave.brave_vpn.device_region_name / .selected_region_name / .selected_region_name_v2
brave.brave_vpn.region_list_version / .wireguard_enabled / .wireguard_allow_lan_traffic
brave.brave_vpn.wireguard.profile_credentials / .smart_proxy_routing_enabled / .env

// news
brave.new_tab_page.show_brave_news      brave.today.sources      brave.news.channels
brave.today.userfeeds                   brave.today.intro_dismissed
brave.today.opted_in                    brave.news.opt_in_trial
brave.today.should_show_toolbar_button  brave.news.open-articles-in-new-tab
brave.news.disabled_by_policy

// ai_chat
brave.ai_chat.enabled_by_policy         brave.ai_chat.storage_enabled
brave.ai_chat.autocomplete_provider_enabled  brave.ai_chat.context_menu_enabled
brave.ai_chat.user_memory_enabled / user_memories / user_customizations
brave.ai_chat.last_accepted_disclaimer / user_dismissed_storage_notice
brave.ai_chat.smart_modes / toolbar_button_opens_full_page / show_toolbar_button
brave.ai_chat.oblivious_http_key_configs  brave.ai_chat.remote_models_cached_at

// speedreader
brave.speedreader.feature_enabled       brave.speedreader.enabled_for_all_sites
brave.speedreader.ever_enabled / .toggle_count / .prompt_count
brave.speedreader.theme / .font_size / .font_family / .column_width
brave.speedreader.tts_voice / .tts_speed / .page_views
brave.speedreader.enabled  (DEPRECATED 08/2025, migrated)

// talk
brave.new_tab_page.show_together        brave.talk.disabled_by_policy

// origin / account / sidebar / tor / playlist
brave.origin.*  (components/brave_origin/pref_names.h)
brave.account.* (components/brave_account/pref_names.h)
sidebar.*       (components/sidebar/browser/pref_names.h — incl. kSidePanelWidth)
tor.*           (components/tor/pref_names.h)
playlist.*      (components/playlist/core/common/pref_names.h)
```

NTP/appearance block in `brave_profile_prefs.cc` (defaults verbatim):
```cpp
registry->RegisterBooleanPref(kBraveAutofillPrivateWindows, true);
registry->RegisterBooleanPref(kShowBookmarksButton, true);
registry->RegisterBooleanPref(kShowSidePanelButton, !BUILDFLAG(IS_BRAVE_ORIGIN_BRANDED));
registry->RegisterBooleanPref(kShowScreenshotButton, false);
registry->RegisterBooleanPref(kNewTabPageShowClock, false);
registry->RegisterBooleanPref(kNewTabPageShowStats, true);
registry->RegisterBooleanPref(kNewTabPageShowRewards, true);
registry->RegisterBooleanPref(brave_talk::prefs::kNewTabPageShowBraveTalk, true);
registry->RegisterBooleanPref(kNewTabPageShowBraveVPN, true);
registry->RegisterIntegerPref(kNewTabPageShowsOptions,
    static_cast<int>(NewTabPageShowsOptions::kDashboard));
registry->RegisterBooleanPref(kAskEnableWidvine, true);
registry->RegisterBooleanPref(kEnableWindowClosingConfirm, true);
registry->RegisterBooleanPref(kEnableClosingLastTab, true);
registry->RegisterBooleanPref(kShowFullscreenReminder, true);
registry->RegisterBooleanPref(kBraveSubtleAppMenuLogo, false);
registry->RegisterBooleanPref(prefs::kPinShareMenuButton, true);
registry->RegisterBooleanPref(prefs::kPinPwaInstallButton, true);
```

**Delta for `ziy.*` / features.csv:** our ziy.* list is roughly the right *shape* but is missing the
whole `.brave_ads.*` namespace (ads state machine: catalog, issuers, ohttp key config, reactions,
serve_ad_at), the whole `.brave_speedreader.*` namespace (7 prefs incl. TTS voice/speed and
page_views), `.brave.brave_vpn.*` region + wireguard credentials, and
`brave.shields.shred_browsing_history` / `.adblock_only_mode_enabled`.

---

## 3. The Chromium patch surface

**1,287 `.patch` files** in `patches/`, plus **2,082 `chromium_src/` override files** and
**845 `rewrite/*.yaml`** file-rewrite rules. Distribution by target:

| area | patches | what it tells us |
| --- | --- | --- |
| `chrome/browser/...` | 496 | UI, profiles, signin, extensions |
| `components/...` | 242 | content settings, permissions, autofill, history, sync, omnibox |
| `third_party/...` | 95 | **Blink (73), ffmpeg, devtools, tflite** |
| `chrome/android/...` | 57 | Android UI |
| `content/...` | 47 | renderer/browser plumbing |
| `chrome/installer/...` | 32 | install layout |
| `ios/...` | 33 | iOS |
| `ui/...` | 33 | views |
| `net/...` | 20 | **cookies, referrer, url_request** |
| `extensions/...` | 18 | **identity, cookies API** |
| `base/`, `build/`, `services/`, `media/` | ~60 | plumbing/build |

### The 15 most interesting patches (verbatim hunks)

1. **`net-cookies-cookie_monster.cc.patch`** (42 KB, the largest privacy patch) — Brave replaces
   Chromium's `CookieMonster` class with its own `CookieMonster_ChromiumImpl` so it can enforce
   its own cookie lifetimes/ephemeral storage:
   ```diff
   -void MaybeRunDeleteCallback(base::WeakPtr<net::CookieMonster> cookie_monster,
   +void MaybeRunDeleteCallback(base::WeakPtr<net::CookieMonster_ChromiumImpl> cookie_monster,
   -const size_t CookieMonster::kDomainMaxCookies = 180;
   +const size_t CookieMonster_ChromiumImpl::kDomainMaxCookies = 180;
   ```

2. **`components-content_settings-core-common-cookie_settings_base.cc.patch`** — injects Brave's
   third-party-cookie decision into Chromium's core cookie gate:
   ```diff
   +  BRAVE_COOKIE_SETTINGS_BASE_DECIDE_ACCESS
      if (!is_third_party_request) {
   ```

3. **`chrome-browser-ui-views-page_info-page_info_cookies_content_view.cc.patch`** — the padlock
   "cookies in use" view is Brave's own surface.

4. **`chrome-browser-media-webrtc-webrtc_log_uploader.cc.patch`** — WebRTC log upload hard-disabled
   (paired with the pref override in §2.1):
   ```diff
    void WebRtcLogUploader::UploadCompressedLog(
        WebRtcLogUploader::UploadDoneData upload_done_data,
        std::unique_ptr<std::string> post_data) {
   +  return; // feature disabled in Brave
   ```

5. **`components-safe_browsing-content-browser-safe_browsing_network_context.cc.patch`** — reroutes
   every Safe Browsing request through Brave's loader (the proxy/anonymisation point):
   ```diff
   -        std::move(loader), request_id, options, request, std::move(client),
   +        std::move(loader), request_id, options, BRAVE_CREATE_LOADER_AND_START, std::move(client),
   ```

6. **`chrome-browser-signin-chrome_signin_helper.cc.patch`** — GAIA Mirror-header processing
   (Google account sync into Chromium profiles) is compiled out:
   ```diff
   +  BRAVE_PROCESS_MIRROR_HEADERS_IF_FALSE
      if (service_type == GAIA_SERVICE_TYPE_INCOGNITO) {
   ```

7. **`chrome-browser-extensions-api-identity-identity_get_auth_token_function.cc.patch`** (4.3 KB) —
   the extension `identity.getAuthToken` path is overridden (this is how Google login in extensions
   is neutered/replaced).

8. **`third_party-blink-renderer-modules-canvas-canvas2d-base_rendering_context_2d.cc.patch`** —
   farbling hooks in canvas readback and text metrics:
   ```diff
    ImageData* BaseRenderingContext2D::getImageDataInternal(
   +    BRAVE_GET_IMAGE_DATA_PARAMS
   ...
   +  BRAVE_GET_IMAGE_DATA
   ...
   +    BRAVE_BASE_RENDERING_CONTEXT_2D_MEASURE_TEXT
   ```

9. **`third_party-blink-renderer-modules-webgl-webgl_rendering_context_base.cc.patch`** (9 KB) —
   WebGL farbling (`readPixels`/params).

10. **`third_party-blink-renderer-bindings-core-v8-referrer_script_info.{cc,h}.patch`** — the
    referrer ScriptInfo path in Blink (the `Referrer-Policy`/trimming hook).

11. **`components-content_settings-browser-ui-cookie_controls_controller.cc.patch`** +
    `chrome-browser-extensions-api-cookies-cookies_api.{cc,h}.patch` — Brave's cookie-control UI
    and the extension cookies API.

12. **`chrome-browser-storage_access_api-storage_access_grant_permission_context.cc.patch`** —
    Storage Access API (third-party storage grant) rewritten for ephemeral storage.

13. **`content-browser-service_worker-service_worker_content_settings_proxy_impl.{h}.patch`** +
    `.../service_worker_context_wrapper.cc.patch` + the Blink-side
    `service_worker_content_settings_proxy.cc` — Shields applied to Service/Shared Worker
    requests (the `kBraveEnableShieldsForWebSocketsFromWorkers` flag's other half).

14. **`chrome-browser-permissions/...` (21 patches) + `components-permissions-...` (14)** —
    permission prompt/context rewritten, incl. Brave's own permission-lifetime prefs.

15. **`chrome-browser-speech-on_device_speech_recognition_impl.cc.patch`** +
    `content-browser-speech-speech_recognition_manager_impl.cc.patch` — on-device speech
    recognition plumbing.

**Fingerprint-randomisation patch names** (for the engine-coupled list):
`third_party/blink/renderer/modules/webgl/webgl{,_2}_rendering_context_base.cc`,
`.../canvas/canvas2d/base_rendering_context_2d.cc`, `.../core/html/canvas/html_canvas_element.{cc,h,idl}`,
`.../modules/canvas/canvas2d/canvas_2d_recorder_context.idl`,
`third_party/blink/common/client_hints/client_hints.cc`,
`net/url_request/url_request_http_job.cc` (+ `redirect_util.cc`, `url_request_job.cc`),
`net/cookies/*` (7 files).

---

## 4. Speedreader (reader mode) — the distiller

Speedreader is a **Rust** readability distiller wrapped by C++ and applied to the *document* in an
isolated world, not a separate rendering mode.

Pipeline (all verbatim from the files):

1. **Feature gate** — `components/speedreader/common/features.cc`:
   `BASE_FEATURE(kSpeedreaderFeature, "Speedreader", base::FEATURE_ENABLED_BY_DEFAULT);`

2. **"Does this URL look readable?"** — `components/speedreader/common/url_readable_hints.cc`:
   ```cpp
   constexpr char kReadablePathSingleComponentHints[] =
       "(?i)/" "(blogs?|news|story|entry|articles?|posts?|amp|technology|politics|business)/";
   constexpr char kReadablePathMultiComponentHints[] = "/\\d\\d\\d\\d/\\d\\d/";
   constexpr char kReadableBlogSubdomain[] = "blog.";
   bool IsURLLooksReadable(const GURL& url) {
     if (!url.SchemeIsHTTPOrHTTPS()) return false;
     // @pes research has shown basically no landing pages are readable.
     if (!url.has_path() || url.path() == "/") return false;
     if (url.host().starts_with(kReadableBlogSubdomain)) return true;
     if (re2::RE2::PartialMatch(url.path(), *path_single_component_hints) ||
         re2::RE2::PartialMatch(url.path(), *path_multi_component_hints)) return true;
     return false;
   }
   ```

3. **Get the original HTML out of the page** — `browser/speedreader/page_distiller.cc`:
   ```cpp
   static constexpr char16_t kGetDocumentSource[] = uR"js( document.documentElement.outerHTML )js";
   static constexpr char16_t kGetBodySource[]     = uR"js( document.body.outerHTML )js";
   rfh->ExecuteJavaScriptInIsolatedWorld(
       (state_ != State::kDistilled) ? kGetDocumentSource : kGetBodySource, ...,
       ISOLATED_WORLD_ID_BRAVE_INTERNAL);
   ```

4. **Distill + re-wrap** — `components/speedreader/speedreader_util.cc`:
   ```cpp
   int written = rewriter->Write(data.c_str(), data.length());
   if (written != 0) { return {DistillationResult::kFail, std::move(data), std::string()}; }
   rewriter->End();
   const std::string& transformed = rewriter->GetOutput();
   // If the distillation failed, the rewriter returns an empty string. Also,
   // if the output is too small, we assume that the content of the distilled
   // page does not contain enough text to read.
   if (transformed.length() < 1024) { return {DistillationResult::kFail, std::move(data), std::string()}; }
   ```
   The rewriter is built per page in `components/speedreader/speedreader_rewriter_service.cc`:
   ```cpp
   auto rewriter = speedreader_->MakeRewriter(url.spec());
   rewriter->SetMinOutLength(features::kSpeedreaderMinOutLengthParam.Get());
   rewriter->SetTheme(theme);   rewriter->SetFontFamily(font_family);
   rewriter->SetFontSize(font_size);  rewriter->SetColumnWidth(column_width);
   rewriter->SetDebugView(features::kSpeedreaderDebugView.Get());
   ```

5. **Stylesheet is injected under a strict CSP** (same file) — this is the distillation *contract*:
   ```cpp
   constexpr const char kCSP[] = R"html(
     <meta name="referrer" content="no-referrer">
     <meta http-equiv="Content-Security-Policy"
       content="default-src 'none'; script-src 'none'; img-src *; font-src 'none';
                form-action 'none'; upgrade-insecure-requests;">
   )html";
   ```
   plus SHA-256-integrity `<script type="brave-style-data">` payloads for the desktop style,
   Atkinson Hyperlegible and Open Dyslexic fonts. A dev switch `--speedreader-stylesheet` hot-reloads
   the CSS from disk.

6. **Renderer-side** — `components/speedreader/renderer/speedreader_render_frame_observer.cc`
   installs `SpeedreaderJSHandler` in the main frame only, in a dedicated isolated world; the
   in-page toolbar talks back over `components/speedreader/common/speedreader.mojom`:
   ```mojom
   interface SpeedreaderHost {
     OnShowOriginalPage();
     OnTtsPlayPause(int32 paragraph_index);
   };
   ```

**Behaviour contract for Ziy's clone:** URL heuristic (blog subdomain / article-ish path segment /
`/YYYY/MM/`) → extract `documentElement.outerHTML` from an isolated world → run a Rust-style
readability pass → reject if output < 1024 chars → re-inject as an isolated-world document with
`default-src 'none'; script-src 'none'`, no-referrer, `img-src *`, fonts hashed inline →
theme/font-family/font-size/column-width are user prefs (not per-page). TTS exists as a first-class
feature (`tts_voice`, `tts_speed`, `OnTtsPlayPause(paragraph_index)`).

---

## 5. Brave Wallet: `window.ethereum` arbitration + keyring

### 5.1 The arbitration is a ProfileKeyedService pushing mojo `DynamicParams` to renderers

The single source of truth is **`browser/profiles/brave_renderer_updater.cc`**,
`BraveRendererUpdater::UpdateRenderer()` (a `KeyedService` built by
`browser/profiles/brave_renderer_updater_factory.cc`, seeded from
`BraveWalletServiceFactory`'s `keyring_service`):

```cpp
  bool is_wallet_allowed_for_context_ = brave_wallet::IsAllowedForContext(profile_);
  bool can_install_providers = is_wallet_allowed_for_context_ && is_wallet_created_;

  auto default_ethereum_wallet =
      static_cast<brave_wallet::mojom::DefaultWallet>(brave_wallet_ethereum_provider_.GetValue());
  bool install_window_brave_ethereum_provider =
      can_install_providers &&
      default_ethereum_wallet != brave_wallet::mojom::DefaultWallet::None;
  // The unprefixed `window.ethereum` is additionally yielded to MetaMask when
  // the user asked to prefer the extension.
  bool install_window_ethereum_provider =
      can_install_providers &&
      (default_ethereum_wallet == brave_wallet::mojom::DefaultWallet::BraveWallet ||
       (default_ethereum_wallet ==
            brave_wallet::mojom::DefaultWallet::BraveWalletPreferExtension &&
        !has_installed_metamask));
  bool allow_overwrite_window_ethereum_provider =
      default_ethereum_wallet == brave_wallet::mojom::DefaultWallet::BraveWalletPreferExtension;
```

`has_installed_metamask` is a live extension-registry lookup:
```cpp
  extensions::ExtensionRegistry* registry = extensions::ExtensionRegistry::Get(profile_);
  bool has_installed_metamask =
      registry && registry->enabled_extensions().Contains(brave_wallet::kMetamaskExtensionId);
```
with `components/brave_wallet/common/brave_wallet_types.h`:
```cpp
inline constexpr char kMetamaskExtensionId[] = "nkbihfbeogaeaoehlefnkodbefgpgknn";
```

The params are pushed over `brave/common/brave_renderer_configuration.mojom`:
```mojom
struct DynamicParams {
  [EnableIf=enable_brave_wallet] bool install_window_brave_ethereum_provider = false;
  [EnableIf=enable_brave_wallet] bool install_window_ethereum_provider = false;
  [EnableIf=enable_brave_wallet] bool install_window_brave_cardano_provider = false;
  [EnableIf=enable_brave_wallet] bool install_window_brave_polkadot_provider = false;
  [EnableIf=enable_brave_wallet] bool allow_overwrite_window_ethereum_provider = true;
  [EnableIf=enable_brave_wallet] bool brave_use_native_solana_wallet = false;
  [EnableIf=enable_brave_wallet] bool allow_overwrite_window_solana_provider = true;
  bool de_amp_enabled = true;
  bool onion_only_in_tor_windows = true;
  bool widevine_enabled = false;
  bool playlist_enabled = false;
};
interface BraveRendererConfiguration { SetConfiguration(DynamicParams params); }
```
Receiver: `renderer/brave_render_thread_observer.cc` →
`*GetDynamicConfigParams() = std::move(*params);`
The updater also recomputes on every pref change and on
`brave_wallet::IsAllowedForContext(profile_)` (`browser/brave_wallet/brave_wallet_context_utils.cc`:
false in Tor; incognito only if `brave.wallet.private_windows_enabled`).

### 5.2 The settings radio list → code paths

Enum, `components/brave_wallet/common/brave_wallet.mojom:3151`:
```mojom
enum DefaultWallet {
  AskDeprecated = 0,
  None = 1,
  CryptoWalletsDeprecated = 2,
  BraveWalletPreferExtension = 3,
  BraveWallet = 4,
};
```
Default registered value: **`BraveWalletPreferExtension` (3)** for Ethereum *and* Solana;
**`BraveWallet` (4)** for Cardano. Pref: `brave.wallet.default_wallet2`.

| radio option (brave://settings/web3) | enum | `install_window_brave_ethereum_provider` | `install_window_ethereum_provider` | `allow_overwrite_window_ethereum_provider` |
| --- | --- | --- | --- | --- |
| Brave Wallet | `BraveWallet` (4) | true | true | false |
| Extensions fallback *(default)* | `BraveWalletPreferExtension` (3) | true | **only if MetaMask NOT installed** | **true** |
| Extensions (no fallback) | `None` (1) | false | false | false |
| Crypto Wallets (deprecated, migrated) | `CryptoWalletsDeprecated` (2) | true | false | false |

Pushing the objects into the page — `components/brave_wallet/renderer/js_ethereum_provider.cc`,
`JSEthereumProvider::Install(install_ethereum_provider, allow_overwrite_window_ethereum_provider, render_frame)`:

```cpp
  // Check window.braveEthereum existence.
  if (!brave_ethereum_value->IsUndefined()) { return; }     // idempotent, never double-injects
  ...
  // Set window.braveEthereum
  SetProviderNonWritable(context, global, ethereum_proxy, gin::StringToV8(isolate, kBraveEthereum), true);
  // Set window.ethereumProvider
  if (install_ethereum_provider) {
    v8::Local<v8::Value> ethereum_value = global->Get(context, gin::StringToV8(isolate, kEthereum)).ToLocalChecked();
    if (ethereum_value->IsUndefined()) {
      if (!allow_overwrite_window_ethereum_provider) {
        SetProviderNonWritable(context, global, ethereum_proxy, gin::StringToV8(isolate, kEthereum), true);
      } else {
        global->Set(context, gin::StringToSymbol(isolate, kEthereum), ethereum_proxy).Check();
      }
    }
  }
```
So: `window.braveEthereum` is **always** set (non-writable) whenever a provider is installed;
`window.ethereum` is set **only** if nothing already owns it, and when the user picked
"prefer extension" the assignment is a *writable* set (so an extension's later write wins);
otherwise it's non-writable. `isMetaMask` is deliberately left **writable** (issue #22213).

Gating in `renderer/brave_wallet/brave_wallet_render_frame_observer.cc::DidClearWindowObject()`:
```cpp
  if (!dynamic_params.install_window_brave_ethereum_provider &&
      !dynamic_params.install_window_ethereum_provider && ... ) { return; }
  if (!dynamic_params.install_window_brave_ethereum_provider &&
      dynamic_params.install_window_ethereum_provider) { NOTREACHED(); }
  if (dynamic_params.install_window_brave_ethereum_provider &&
      web_frame->GetDocument().IsDOMFeaturePolicyEnabled(isolate, context, "ethereum")) {
    JSEthereumProvider::Install(dynamic_params.install_window_ethereum_provider,
                                dynamic_params.allow_overwrite_window_ethereum_provider,
                                render_frame());
  }
```
and `CanCreateProvider()` additionally requires HTTP(S), a secure context, and a non-provisional frame.

**Nothing is injected until the user has actually created a wallet** — the comment at
`brave_renderer_updater.cc:233` says so explicitly:
```cpp
  // Nothing is injected until the user has actually created a wallet. A
  // provider with no keyring behind it can't serve a dApp anyway, and its mere
  // presence is observable by page scripts, so users who never opted into the
  // wallet get no page-world properties at all.
```

### 5.3 The keyring: a local encrypted blob, not the OS keyring

It is a **profile-pref dictionary**, encrypted locally. Evidence:
- `brave.wallet.keyrings` — `registry->RegisterDictionaryPref(kBraveWalletKeyrings);`
- `brave.wallet.encrypted_mnemonic` — `registry->RegisterDictionaryPref(kBraveWalletMnemonic);`
- `brave.wallet.encryptor_salt` — `registry->RegisterStringPref(kBraveWalletEncryptorSalt, "");`
- legacy/deprecated (code removed 05/2025): `brave.wallet.aes_256_gcm_siv_nonce`,
  `brave.wallet.encrypted_seed`, `brave.wallet.pref_version`, `brave.wallet.opted_in` — i.e. the
  cipher was **AES-256-GCM-SIV** with a stored nonce and a stored salt.
- `components/brave_wallet/browser/keyring_service_prefs.h` — per-keyring *dict keys*:
  `encrypted_private_key`, `account_metas`, `account_name`, `account_index`, `imported_accounts`,
  `bitcoin.xpub`, `bitcoin.next_receive/next_change`, `zcash.account_birthday.block_id`.
- `constexpr int kDefaultWalletAutoLockMinutes = 10;` → `brave.wallet.auto_lock_minutes` default 10,
  plus `brave.wallet.wallet_last_unlock_time_v2` and
  `brave.wallet.wallet_report_unlock_time_ping`.

**Design takeaway for ziy-wallet:** keep the seed in our own profile-store blob under a
salted AEAD (their legacy scheme is literally AES-256-GCM-SIV + stored salt/nonce) with an
auto-lock timer; do **not** depend on an OS keyring. Gate injection on "wallet exists" and expose a
`window.<our-ethereum>` alias that is always non-writable, plus a writable `window.ethereum` only
when no other provider owns it and the user chose extension-fallback.

---

## 6. Brave Talk

Talk is **not** in brave-core beyond the entry points — the call itself is a hosted web app. What
the browser side owns:

- **URL constants** — `components/sidebar/browser/constants.h`:
  ```cpp
  #if BUILDFLAG(ENABLE_BRAVE_TALK)
  inline constexpr char kBraveTalkURL[]  = "https://talk.brave.com/widget";
  inline constexpr char kBraveTalkHost[] = "talk.brave.com";
  #endif
  ```
  Build flag: `components/brave_talk/buildflags/buildflags.gni` →
  `enable_brave_talk = !is_brave_origin_branded` (i.e. **off** on Brave Origin builds).
- **NTP entry point** — `browser/resources/brave_new_tab_page_refresh/components/widgets/talk_widget.tsx`:
  ```tsx
  <Button size='small' onClick={() => openLink('https://talk.brave.com/widget')}>
  ```
  plus pref `brave.new_tab_page.show_together` (default `true`) and
  `brave.talk.disabled_by_policy`.
- **Room path shape** — from `browser/ui/sidebar/sidebar_unittest.cc`:
  ```cpp
  GURL talk("https://talk.brave.com/1Ar1vHfLBWX2sAdi");
  ```
  → a **15-character base62 room id** appended to the host (≈89 bits of entropy). The browser only
  ever *recognises* such URLs (mapping `talk.brave.com/<room>` → the canonical widget URL so the
  sidebar item survives), it does not generate them:
  `browser/ui/sidebar/sidebar_utils.cc`:
  ```cpp
  if (url.host() == kBraveTalkHost) { return GURL(kBraveTalkURL); }
  ```
- **Extension API** — `common/extensions/api/brave_talk.json` defines a single function
  `braveTalk.isSupported()`; the implementation
  `browser/extensions/api/brave_talk_api.cc` is the whole browser-side policy:
  ```cpp
  ExtensionFunction::ResponseAction BraveTalkIsSupportedFunction::Run() {
    Profile* profile = Profile::FromBrowserContext(browser_context());
    if (profile->IsTor()) { return RespondNow(Error("Not available in Tor profile")); }
    return RespondNow(WithArguments(true));
  }
  ```
- **iOS** observes the injected iframe (`ios/browser/brave_talk/resources/brave_talk_launcher.ts`
  watches for `HTMLIFrameElement` additions and forwards `node.src`).

**Contract for ziy-talk:** NTP/sidebar button opens `<talk-host>/widget`; room URLs are
`<talk-host>/<15-char base62>`; the browser contributes (a) a pref-gated entry point, (b) a
`braveTalk.isSupported()` equivalent that returns false in Tor, and (c) nothing else — the Jitsi
service, room creation, lobby, recording and encryption are all server-side. Brave ships no
`jitsi` code in brave-core (`git grep -i jitsi` matches only `ios/third_party/JitsiMeet/`).
`[UNVERIFIED]`: the exact room-id generation algorithm and any URL encryption/JWT parameters,
because they live in the closed `talk.brave.com` service, not in this repo.

---

## 7. Brave Ads: on-device matching + "anonymous but accountable" confirmations

Architecture is split `components/brave_ads/core/public` (client API), `core/internal` (engine:
catalog → eligible ads → permission rules → exclusion rules → serve → confirm → redeem), and
`components/brave_ads/browser/ads_service_impl.cc` (the profile service). Local persistence is
**SQLite** (`kDatabaseFilename[] = "database.sqlite"`) plus a `client.json` state file
(`components/brave_ads/core/public/ads_constants.h`).

### 7.1 On-device matching
- Targeting/segmentation is local: prefs `brave.brave_ads.reactions.segments`,
  `.reactions.saved_ads`, `.reactions.marked_as_inappropriate`, and the ad-history/category data
  live in the local DB (`components/brave_ads/core/public/prefs/pref_names.h`).
- The **catalog** (campaigns/creatives/segments) is fetched and cached locally
  (`brave.brave_ads.catalog_id/version/last_updated`).
- Geo is coarse and locally detected: `brave.brave_ads.ads_subdivision_targeting_code`,
  `brave.brave_ads.automatically_detected_ads_subdivision_targeting_code`,
  `brave.brave_ads.should_allow_ads_subdivision_targeting`; refetch cadence
  `kFetchSubdivisionAfter` default `base::Days(1)`
  (`components/brave_ads/core/internal/common/subdivision/subdivision_feature.h`).
- Ads fetch/redemption network calls go through **Oblivious HTTP**
  (`components/brave_ads/core/browser/network/oblivious_http_client_impl.cc`,
  prefs `brave.brave_ads.ohttp.key_config.public_key` / `.expires_at`) — the relay cannot see
  client↔server pairing.
- `kAdHistoryFeature` **ENABLED_BY_DEFAULT** caps what an advertiser can learn about one device.

### 7.2 The caps (hard numbers, from source)

`components/brave_ads/core/public/ad_units/notification_ad/notification_ad_constants.h`:
```cpp
// Brave Ads per hour are user configurable within the brave://rewards ads UI.
#if !BUILDFLAG(IS_IOS)
inline constexpr int64_t kDefaultBraveRewardsNotificationAdsPerHour = 10;
#else
inline constexpr int64_t kDefaultBraveRewardsNotificationAdsPerHour = 2;
#endif
// Default ad notification timeout in seconds.
inline constexpr base::TimeDelta kDefaultNotificationAdTimeout = base::Minutes(2);  // desktop
```
`.../notification_ad_feature.h`:
```cpp
const base::FeatureParam<base::TimeDelta> kNotificationAdTimeout{
    &kNotificationAdFeature, "notification_ad_timeout", kDefaultNotificationAdTimeout};
const base::FeatureParam<int> kDefaultNotificationAdsPerHour{
    &kNotificationAdFeature, "default_ads_per_hour", kDefaultBraveRewardsNotificationAdsPerHour};
// Set to 0 to never cap.
const base::FeatureParam<size_t> kMaximumNotificationAdsPerDay{
    &kNotificationAdFeature, "maximum_ads_per_day", 100};
```
`components/brave_ads/core/public/ad_units/new_tab_page_ad/new_tab_page_ad_feature.h`:
```cpp
const base::FeatureParam<size_t> kMaximumNewTabPageAdsPerHour{..., "maximum_ads_per_hour", 4};
const base::FeatureParam<size_t> kMaximumNewTabPageAdsPerDay{..., "maximum_ads_per_day", 20};
const base::FeatureParam<base::TimeDelta> kNewTabPageAdMinimumWaitTime{..., "minimum_wait_time", base::Minutes(1)};
```
`components/brave_ads/core/internal/serving/notification_ad_serving_feature.h`:
```cpp
kServeFirstNotificationAdAfter{..., "serve_first_ad_after", base::Minutes(2)};
kMinimumDelayBeforeServingNotificationAd{..., "minimum_delay_before_serving_an_ad", base::Minutes(1)};
kRetryServingNotificationAdAfter{..., "retry_serving_ad_after", base::Minutes(2)};
```
`.../permission_rules/permission_rule_feature.h` (when ads are allowed at all):
```cpp
kShouldOnlyServeAdsInWindowedMode{..., true};
kShouldOnlyServeAdsWithValidInternetConnection{..., true};
kShouldOnlyServeAdsIfMediaIsNotPlaying{..., true};
kShouldOnlyServeAdsIfBrowserIsActive{..., true};
kDoNotDisturbFromHour{..., "do_not_disturb_from_hour", 21};
kDoNotDisturbToHour{..., "do_not_disturb_to_hour", 6};
```
`.../serving/eligible_ads/exclusion_rules/exclusion_rule_feature.h`:
```cpp
kShouldExcludeAdIfCreativeInstanceWithinTimeWindow{..., base::Hours(1)};
kShouldExcludeAdIfCreativeInstanceExceedsPerHourCap{..., 1};
kShouldExcludeAdIfCreativeSetExceedsConversionCap{..., 0};
```
`.../account/confirmations/confirmations_feature.h` (retry policy for confirmations):
```cpp
kProcessConfirmationInitialBackoffDelay{..., base::Seconds(15)};
kProcessConfirmationMaxBackoffDelay{..., base::Hours(6)};
```
Notification-ad timeout semantics: `base::Minutes(2)` desktop / `base::Seconds(30)` mobile.
Serving versions: NTP `kNewTabPageAdServingVersion` = 2, notification `kNotificationAdServingVersion` = 2.
The ad-unit *keys* sent to the service (i.e. the confirmation payload shape) are in
`notification_ad_constants.h`: `type`, `uuid` (placement id), `creative_instance_id`,
`creative_set_id`, `campaign_id`, `advertiser_id`, `segment`, `title`, `body`, `target_url`.

### 7.3 The confirmation protocol
`components/brave_ads/core/internal/account/README.md`: "Confirmation tokens are deposited into the
user's account. Transactions are recorded, and the resulting balance is paid out."
`components/brave_ads/core/internal/account/confirmations/README.md`: "These anonymous requests
enable Brave to generate aggregate statistics, allowing advertisers to evaluate the performance of
their campaigns in terms of total impressions, click-through rates, and conversion rates."
The cryptographic primitive is **challenge-bypass-ristretto** batch DLEQ proofs + blinded/signed
tokens (`components/brave_ads/core/internal/common/challenge_bypass_ristretto/`: `blinded_token`,
`signed_token`, `batch_dleq_proof`, `credential_builder`), redeemed in
`components/brave_ads/core/internal/account/utility/redeem_confirmation/` (separate
reward / non-reward paths), over Oblivious HTTP with the 15 s → 6 h backoff above.

### 7.4 What a clone CAN replicate locally vs what needs their marketplace

**Replicable locally (no Brave servers):** the whole *serving* engine — local SQLite schema plus
`client.json`, the catalog cache, URL/subdivision/segment matching, every cap and exclusion rule
above (per-hour 10 notification / 4 NTP; per-day 100 / 20; 1 creative-instance per hour;
min-wait 1 min; DND 21:00–06:00; first ad after 2 min; retry after 2 min), ad history, the
opt-in prefs (`brave.brave_ads.notifications.enabled`, `brave.brave_ads.sponsored.enabled`,
`brave.brave_ads.ads_per_hour`), and the confirmation *record* structure.

**Needs their marketplace (cannot be clean-room'd):** the ad catalog itself (campaigns, creatives,
advertiser accounts), the anonymous-but-accountable token issuer (ristretto signing key +
confirmation server), the BAT ledger/payout side of Rewards, and the OHTTP relay + key config.
A clone can implement the identical local state machine and the identical *shape* of
confirmation, but without an issuer there is no earning — the practical clone is "ads off by
default, NTP sponsored-image slot empty, Rewards panel local-only".

---

## 8. Leo — FOR THE RECORD ONLY (feature is CUT from Ziy)

Contract only, kept brief:

- **Endpoint scheme** — `components/ai_chat/core/browser/engine/conversation_api_client.cc`:
  ```cpp
  constexpr char kRemotePath[] = "v1/chat/completions";
  ...
  bool premium_enabled = credential.has_value();
  const GURL api_url = GetEndpointUrl(premium_enabled, kRemotePath);
  ```
  so the API is an **OpenAI-compatible `POST …/v1/chat/completions`** with SSE
  (`kAIChatSSE` default true; `headers.emplace("Accept", "text/event-stream")`), and the
  free/premium *host* differs by whether a premium credential is cached
  (`brave.ai_chat.premium_credential_cache`).
- **Request authentication** is a signed-header scheme, not a bearer token:
  ```cpp
  auto headers = GetBraveHeaders(credential);
  const auto digest_header = brave_service_keys::GetDigestHeader(request_body);
  headers.emplace(digest_header.first, digest_header.second);
  auto auth_header = brave_service_keys::GetAuthorizationHeader(
      BUILDFLAG(SERVICE_KEY_AICHAT), headers, api_url, net::HttpRequestHeaders::kPostMethod, {"digest"});
  ```
- **Opt-in / permission at the component level:** `brave.ai_chat.enabled_by_policy` (policy gate),
  `brave.ai_chat.last_accepted_disclaimer` (the first-run disclaimer), and per-request page context
  is opt-in and on by default (`kPageContextEnabledInitially` = true). Premium paywall is
  `kFreemiumAvailable` = true, with model choice via `default_model` / `default_premium_model`.
- **What is sent as page context** — `components/ai_chat/core/common/mojom/page_content_extractor.mojom`:
  ```mojom
  enum PageContentType { Text, VideoTranscriptYouTube, VideoTranscriptVTT };
  union PageContentData { string content; url.mojom.Url content_url; YoutubeInnerTubeConfig youtube_inner_tube_config; };
  interface PageContentExtractor {
    ExtractPageContent() => (PageContent? page_content);
    GetSearchSummarizerKey() => (string? key);
    GetOpenAIChatButtonNonce() => (string? nonce);
    ExecuteContentTool(string name, string input_json) => (string? result);
    SetContentToolsListener(pending_remote<ContentToolsListener>? listener);
  };
  ```
  i.e. either inline text, a URL for the server to fetch, or a YouTube InnerTube transcript
  config; extraction happens in the renderer
  (`components/ai_chat/renderer/page_content_extractor.{h,cc}`).
- Preferenced off in brave-core's own defaults for anything that leaves the device beyond that
  call: `kAIChatRemoteModelsConfig` OFF (model list is not fetched remotely by default),
  `kAIChatDetailedPageContentExtraction` OFF, `kAllowPrivateIPs` OFF, `kNEARModels` OFF,
  `kBraveSyncAIChat` OFF, `kAIChatThreads` OFF, `kAIChatExportJSON` OFF.
- The extension/UI side (`components/ai_chat/resources/...`, `brave_wallet_ui`-style React) is a
  large surface (`components/ai_chat/**`); full-panel, history, memories, tab-focus and
  tab-organization are all component-level. `[UNVERIFIED]` the exact host names behind
  `GetEndpointUrl` (the definition was not in the files I fetched; only its two call sites and the
  `kRemotePath` are quoted here).

---

## Deltas from `replica/recon.md` / `replica/architecture.md`

1. **"Brave ships Shields ON by default"** → confirmed and now quantified: farbling
   (`kBraveFarbling`, `kBraveFarblingTokenReset`) and language reduction
   (`kBraveReduceLanguage`) are `ENABLED_BY_DEFAULT`; but **"Strict fingerprinting mode" is NOT** —
   `kBraveShowStrictFingerprintingMode` is `DISABLED_BY_DEFAULT`. Recon's S08 "Block
   fingerprinting (+ sub-toggles)" is closer to the truth than "Aggressive" being default.
   **New finding:** `kAdblockOnlyMode` is **`ENABLED_BY_DEFAULT` on desktop** — an
   ad-blocking-only Shields presentation with a locale-gated opt-in prompt — and
   `kBraveExtensionNetworkBlocking` (Shields applied to extension requests) is OFF, and the
   experimental filter list is OFF. Our Shields default set should be: standard blocking +
   cosmetic + CSP + CNAME uncloaking + farbling + language reduce + element picker, with
   extension-network blocking and experimental lists off.
2. **Playlist is off on desktop.** `kPlaylist` is `FEATURE_DISABLED_BY_DEFAULT` outside iOS —
   recon S43's "Nightly-only on desktop" note is directionally right but the mechanism is a
   default-off feature flag, not a channel gate. Our features.csv should treat Playlist as
   OFF-by-default with a toggle, not as a Nightly artifact.
3. **Brave News ships an opt-in trial path**: `kBraveNewsNewUserOptIn` default OFF +
   `brave.news.opt_in_trial` "cleared 30 days post-install". Our News onboarding needs that
   trial/dismissal state machine; recon doesn't have it.
4. **Wallet `window.ethereum` default is "Brave Wallet with extension fallback"** (enum 3), and
   the fallback only yields `window.ethereum` when **MetaMask is not installed** (extension id
   `nkbihfbeogaeaoehlefnkodbefgpgknn`). Recon S38's four options are right; the *arbitration
   rule* (registry lookup + writable-vs-non-writable set) is new and is exactly what
   `ziy-wallet` must implement.
5. **Wallet keyring is a local encrypted pref blob**, AES-256-GCM-SIV (legacy names still present),
   with salt + nonce stored and a 10-minute auto-lock — *not* an OS keyring. This changes
   architecture.md's "key custody" assumptions toward a profile-store blob + our own AEAD.
6. **Nothing is injected until the wallet exists** — no `window.ethereum`/`window.braveEthereum`
   at all for users who never created a wallet. Strong privacy property worth cloning verbatim.
7. **Speedreader is a Rust distiller over an isolated-world document with a `default-src 'none'`
   CSP**, threshold 1024 chars, URL heuristic = blog subdomain / `/blog|/news|/story|/entry|
   /article|/post|/amp|/technology|/politics|/business` / `/YYYY/MM/`. It also has **TTS**
   (`tts_voice`, `tts_speed`, per-paragraph play/pause) which recon's S47 omits entirely.
8. **Brave Talk's room ids are 15-char base62** (`https://talk.brave.com/1Ar1vHfLBWX2sAdi`) and the
   only browser-side code is the entry URL, a pref, and a `braveTalk.isSupported()` that returns
   false in Tor. Recon's S39/S40 (control bar, VBE, lobby, recording) is all server-side — our
   clone needs a Jitsi-compatible host, not browser code.
9. **Ad caps are now exact** (10 notification ads/hour user-configurable, 100/day; NTP 4/hour,
   20/day, 1-minute min wait; 1 creative instance per hour; DND 21:00–06:00; first ad after
   2 min; retry after 2 min; confirmations backoff 15 s→6 h). Recon only had "notification-ad
   ceiling / every 4th tab". The "every 4th tab" mapping is really the *4 per hour NTP cap*
   interacting with the sponsored-background cadence.
10. **The engine-coupled feature list is now grounded**: 1,287 patches + 2,082 `chromium_src`
    overrides + 845 `rewrite` yaml rules. The five hardest couplings for a Gecko port are
    (a) `CookieMonster` class replacement, (b) Blink canvas/WebGL farbling hooks, (c) Blink
    referrer-script-info, (d) Storage-Access-API permission context, (e) Service/Shared-Worker
    content-settings proxy. All five are engine-internal in Chromium and have **no Gecko
    equivalent surface** — they must be re-expressed as DNR rules, `webRequest`,
    `browserSettings`/privacy prefs, or content-script injection instead.
11. **GAIA/Mirror-header and Safe Browsing reroute are compile-time patches**, not runtime prefs —
    a clean-room Gecko product simply never has that code, which is a *simplification* our
    architecture already assumed; now it's evidenced.
12. **Brave Account (`kBraveAccount`) is default-OFF** and **psst** (`kEnablePsst`) default-OFF —
    neither should appear in our v1 features.csv. `kBraveOrigin` IS default-ON, which is the
    branded-build gate (`!is_brave_origin_branded` also disables Talk and the side-panel button).

---

## UNVERIFIED / not reached

- The exact free/premium **host names** behind Leo's `GetEndpointUrl` (definition file not
  fetched; only call sites and `v1/chat/completions` quoted).
- Brave Talk room-id generation and any JWT/encryption parameters — server-side only.
- Brave Rewards' `core/engine` BAT ledger internals (deliberately sampled out per the brief —
  only `components/brave_rewards/core/features.cc` and `pref_names.h` were read).
- Brave Search / Brave VPN backend API shapes (out of scope for this pass).
- All per-flag `#if BUILDFLAG` splits in the shields list **have now been read and are quoted
  verbatim** in §1.2 — nothing in §1 remains unresolved.
