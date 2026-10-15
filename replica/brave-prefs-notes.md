# Brave Preferences — Extracted Notes

- Source: `/home/zen/.config/BraveSoftware/Brave-Origin/Default/Preferences` (read-only; user’s own profile data)
- Size: **175,879 bytes** (~172 KB), single-line JSON, single object
- Top-level keys: **74** · flattened leaf keys: **2,926**
- Profile dir is **Brave-Origin** (not Brave-Browser). Browser: Brave Origin 153.1.95.104, Chromium 153.0.8010.53.
- Profile is lightly used: no sync signed in, no rewards/wallet/Leo state, shields metadata exists for ~100 visited sites.

## 1. Top-level keys containing "brave"

```
brave
brave_shields
brave_sync_v2
```

- Non-Brave top-level keys include: accessibility, announcement_notification_service_first_run_time, apps, autocomplete, autofill, bookmark, bookmark_bar, browser, commerce_daily_metrics_last_update_time, countryid_at_install, default_apps_install_state, devtools, domain_diversity, download_bubble, dual_layer_user_pref_store, enterprise, enterprise_profile_guid, ephemeral_storage, extensions, gaia_cookie, gcm, google, https_upgrade_navigations, in_product_help

## 2. brave.* namespace groups (leaf counts)

- `profile.content_settings.exceptions` — 221 keys (221 scalar)
- `brave.accelerators` — 78 keys
- `brave.default_accelerators` — 78 keys
- `brave.default_private_search_provider_data` — 38 keys (35 scalar)
- `brave` — 8 keys (8 scalar)
- `brave_shields` — 7 keys (7 scalar)
- `brave.stats` — 3 keys (2 scalar)
- `brave.new_tab_page` — 2 keys (1 scalar)
- `partition.per_host_zoom_levels.x` — 2 keys (2 scalar)
- `protection.macs.brave` — 2 keys (2 scalar)
- `brave.brave_search` — 1 keys (1 scalar)
- `brave.search` — 1 keys (1 scalar)
- `brave.sidebar` — 1 keys (1 scalar)
- `brave.weekly_storage` — 1 keys
- `brave_sync_v2` — 1 keys (1 scalar)

### Scalar values worth recording

```
brave.search.default_version = 33
brave.shields_settings_version = 4
brave.sidebar.sidebar_show_option = 3
brave.new_tab_page.show_stats = false
brave.brave_search.migrated-ntp-chat-from-search = true
brave.migrated_search_default_in_jp = true
brave_shields.p3a_first_reported_revision = 4
brave_sync_v2.reset_devices_progress_token_time = "13434656755539705"
brave.default_private_search_provider_guid = "485bf7d3-0215-45af-87dc-538868000550"
```

### Non-scalar brave.* blobs (names only, values elided)

- `brave.accelerators.33000` — list of 3
- `brave.accelerators.33001` — list of 3
- `brave.accelerators.33002` — list of 3
- `brave.accelerators.33003` — list of 2
- `brave.accelerators.33007` — list of 5
- `brave.accelerators.34012` — list of 2
- `brave.accelerators.34014` — list of 2
- `brave.accelerators.34015` — list of 3
- `brave.accelerators.34018` — list of 4
- `brave.accelerators.34019` — list of 4
- `brave.accelerators.34020` — list of 4
- `brave.accelerators.34021` — list of 4
- `brave.accelerators.34022` — list of 4
- `brave.accelerators.34023` — list of 4
- `brave.accelerators.34024` — list of 4
- `brave.accelerators.34025` — list of 4
- `brave.accelerators.34026` — list of 4
- `brave.accelerators.37001` — list of 2
- `brave.accelerators.37002` — list of 2
- `brave.accelerators.38001` — list of 3
- `brave.accelerators.38002` — list of 2
- `brave.accelerators.38003` — list of 3
- `brave.accelerators.39001` — list of 2
- `brave.accelerators.39002` — list of 3
- `brave.accelerators.39003` — list of 3
- `brave.accelerators.40009` — list of 2
- `brave.accelerators.40021` — list of 2
- `brave.default_accelerators.33000` — list of 3
- `brave.default_accelerators.33001` — list of 3
- `brave.default_accelerators.33002` — list of 3
- `brave.default_accelerators.33003` — list of 2
- `brave.default_accelerators.33007` — list of 5
- `brave.default_accelerators.34012` — list of 2
- `brave.default_accelerators.34014` — list of 2
- `brave.default_accelerators.34015` — list of 3
- `brave.default_accelerators.34018` — list of 4
- `brave.default_accelerators.34019` — list of 4
- `brave.default_accelerators.34020` — list of 4
- `brave.default_accelerators.34021` — list of 4
- `brave.default_accelerators.34022` — list of 4
- `brave.default_accelerators.34023` — list of 4
- `brave.default_accelerators.34024` — list of 4
- `brave.default_accelerators.34025` — list of 4
- `brave.default_accelerators.34026` — list of 4
- `brave.default_accelerators.37001` — list of 2
- `brave.default_accelerators.37002` — list of 2
- `brave.default_accelerators.38001` — list of 3
- `brave.default_accelerators.38002` — list of 2
- `brave.default_accelerators.38003` — list of 3
- `brave.default_accelerators.39001` — list of 2
- `brave.default_accelerators.39002` — list of 3
- `brave.default_accelerators.39003` — list of 4
- `brave.default_accelerators.40009` — list of 2
- `brave.default_accelerators.40021` — list of 2
- `brave.new_tab_page.p3a_new_tabs_created_daily` — list of 5
- `brave.stats.daily_saving_predictions_bytes` — list of 7
- `brave.weekly_storage.search_count` — list of 7

## 3. Other pattern-matching keys (shields, search, sync, ntp, sidebar…)

- **search/search_provider (44 keys)** — 44 key(s)
    - `brave.default_private_search_provider_data.alternate_urls` = []
    - `brave.default_private_search_provider_data.contextual_search_url` = ""
    - `brave.default_private_search_provider_data.created_from_play_api` = false
    - `brave.default_private_search_provider_data.date_created` = "0"
    - `brave.default_private_search_provider_data.doodle_url` = ""
    - `brave.default_private_search_provider_data.enforced_by_policy` = false
    - `brave.default_private_search_provider_data.favicon_url` = "https://cdn.search.brave.com/serp/favicon.ico"
    - `brave.default_private_search_provider_data.featured_by_policy` = false
    - `brave.default_private_search_provider_data.id` = "0"
    - `brave.default_private_search_provider_data.image_search_branding_label` = ""
    - `brave.default_private_search_provider_data.image_translate_source_language_param_key` = ""
    - `brave.default_private_search_provider_data.image_translate_target_language_param_key` = ""
    - `brave.default_private_search_provider_data.image_translate_url` = ""
    - `brave.default_private_search_provider_data.image_url` = ""
    - … 30 more
- **sync (79 keys)** — 79 key(s)
    - `brave.default_private_search_provider_data.synced_guid` = "485bf7d3-0215-45af-87dc-538868000550"
    - `brave_sync_v2.reset_devices_progress_token_time` = "13434656755539705"
    - `devtools.synced_preferences_sync_disabled.adorner-settings` = "[{\"adorner\":\"ad\",\"isEnabled\":true},{\"adorner\":\"container\",\"isEnabled
    - `devtools.synced_preferences_sync_disabled.syncedInspectorVersion` = "46"
    - `dual_layer_user_pref_store.user_selected_sync_types` = []
    - `extensions.settings.paponcgjfojgemddooebbgniglhkajkj.needs_sync` = true
    - `password_manager.account_store_migrated_to_os_crypt_async` = true
    - `password_manager.profile_store_migrated_to_os_crypt_async` = true
    - `sync.data_type_status_for_sync_to_signin.account_setting` = false
    - `sync.data_type_status_for_sync_to_signin.ai_chat_conversation` = false
    - `sync.data_type_status_for_sync_to_signin.ai_thread` = false
    - `sync.data_type_status_for_sync_to_signin.app_list` = false
    - `sync.data_type_status_for_sync_to_signin.app_settings` = false
    - `sync.data_type_status_for_sync_to_signin.apps` = false
    - … 65 more
- **shields/fingerprinting** — 96 key(s)
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://127.0.0.1,*.setting.farbling_token` = "37ADC5AAC9E4CAB1A6094ED481ACE178"
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://[*.]claude.com,*.setting.farbling_token` = "834FFCD3EC403FA647DAB3E80D1EC72A"
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://[*.]example.com,*.setting.farbling_token` = "C26608F32496622A5EF83B82625B4A38"
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://[*.]github.com,*.setting.farbling_token` = "E7B7BCB6C16F074602334F3974C5F853"
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://[*.]pelajarin.ai,*.setting.farbling_token` = "6E21A1EEB1C20FED7044C866D7F25D48"
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://[*.]x.com,*.setting.farbling_token` = "B52FB8CF2839B31672DF354A47279166"
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://[*.]ziylearn-ziy2.vercel.app,*.setting.farbling_token` = "4607A0C66AF2A5D2887F26274FEEB81B"
    - `profile.content_settings.exceptions.braveShieldsMetadata.http://localhost,*.setting.farbling_token` = "E47A72C1DD8D0B91FD2CB8D57C8DAB76"
    - `profile.content_settings.exceptions.braveShieldsMetadata.https://[*.]aiuxplayground.com,*.setting.farbling_token` = "FE172D253A774859B141521748F69607"
    - `profile.content_settings.exceptions.braveShieldsMetadata.https://[*.]anthropic.com,*.setting.farbling_token` = "BD2E9D7954A4E476F5FC70828A60AAC2"
    - `profile.content_settings.exceptions.braveShieldsMetadata.https://[*.]arxiv.org,*.setting.farbling_token` = "E2123D7E32E14F4DC4E6762B1599D415"
    - `profile.content_settings.exceptions.braveShieldsMetadata.https://[*.]better-auth.com,*.setting.farbling_token` = "5A3223B4B3330C15B21D1DB5C9EF50C0"
    - `profile.content_settings.exceptions.braveShieldsMetadata.https://[*.]brave.com,*.setting.farbling_token` = "8FBB187E7EA27B0E5E3DA8F25B1FDE9A"
    - `profile.content_settings.exceptions.braveShieldsMetadata.https://[*.]brevo.com,*.setting.farbling_token` = "B6050DBCC27E6DFCE86B768C92B0C115"
    - … 82 more
- **ntp / new_tab** — 6 key(s)
    - `brave.default_private_search_provider_data.new_tab_url` = ""
    - `brave.new_tab_page.p3a_new_tabs_created_daily` <5 items>
    - `brave.new_tab_page.show_stats` = false
    - `ntp.custom_background_inspiration` = false
    - `ntp.custom_background_local_to_device` = false
    - `ntp.num_personal_suggestions` = 12
- **sidebar** — 3 key(s)
    - `brave.sidebar.sidebar_show_option` = 3
    - `devtools.preferences.elements.styles.sidebar.width` = "{\"vertical\":{\"size\":0,\"showMode\":\"OnlyMain\"}}"
    - `devtools.preferences.styles-pane-sidebar-tab-order` = "{\"styles\":10,\"computed\":20}"
- **rewards / wallet / leo / vpn / tor / news / playlist / talk / widevine** — 213 key(s)
    - `bookmark.storage_computation_last_update` = "13436378449691108"
    - `brave.accelerators.33000` = ["BrowserBack", "Alt+ArrowLeft", "AltGr+ArrowLeft"]
    - `brave.accelerators.33001` = ["BrowserForward", "Alt+ArrowRight", "AltGr+ArrowRight"]
    - `brave.accelerators.33002` = ["Control+KeyR", "F5", "BrowserRefresh"]
    - `brave.accelerators.33003` = ["BrowserHome", "Alt+Home"]
    - `brave.accelerators.33007` <5 items>
    - `brave.accelerators.34000` = ["Control+KeyN"]
    - `brave.accelerators.34001` = ["Control+Shift+KeyN"]
    - `brave.accelerators.34012` = ["Control+Shift+KeyW", "Alt+F4"]
    - `brave.accelerators.34014` = ["AppNew", "Control+KeyT"]
    - `brave.accelerators.34015` = ["Control+KeyW", "Control+F4", "AppClose"]
    - `brave.accelerators.34016` = ["Control+PageDown"]
    - `brave.accelerators.34017` = ["Control+PageUp"]
    - `brave.accelerators.34018` = ["Control+Digit1", "Control+Numpad1", "Alt+Digit1", "Alt+Numpad1"]
    - … 199 more

### Search-engine / templated provider data (shapes only)

- `protection.macs.default_search_provider_data.template_url_data` = "575D258E47F940C6887685ABA99A5839CBFE4BA30863349DFE0D0C375AAB8816"
- `protection.macs.default_search_provider_data.template_url_data_encrypted_hash` = "djExvzOpn/qLtUxgViziJPZsz7oLdlhZ06WQ4MNE/KrjHHFKXoHa9ggmohyaRMCZCL1A"
- `default_search_provider_data.template_url_data`: 0-3 KLOC string (per-engine list, NOT dumped)
- `browser.search` sections absent — engine list lives in `brave.default_private_search_provider_data` (38 fields/std).

## 4. Shields/farbling evidence (what is actually configured)

- `profile.content_settings.exceptions.braveShieldsMetadata.*`: ~100 orgs, each with `farbling_token` (32-char hex) + `last_modified` — this is Brave’s per-origin fingerprint farbling store.
- Exception namespace counts: exceptions=2192

