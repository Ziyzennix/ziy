# /tmp/brave-sync source assets

Fetched 2026-10-14 by the `re-sync` deep-recon workstream for
`replica/re-deep-sync.md` (Brave Sync real implementation).

## How it was obtained

`brave/brave-browser` is only the issue tracker; the source is **`brave/brave-core`**.

```
git clone --filter=blob:none --no-checkout --depth 1 --single-branch --branch master \
    https://github.com/brave/brave-core.git /tmp/brave-src/bc      # 3.1M, no blobs
cd /tmp/brave-src/bc && git sparse-checkout init --cone
git sparse-checkout set components/sync components/brave_sync components/sync_device_info
                         components/constants components/sync_preferences
                         chromium_src/components/sync chromium_src/chrome/browser/sync
                         chromium_src/components/sync_device_info
                         patches rewrite browser/sync browser/ui/webui/settings
                         browser/infobars browser/net browser/ui/android/strings
                         android/java browser/resources browser/ui/android
git checkout master
```

Same for the **server**: `git clone --depth 1 --filter=blob:none --no-checkout
--single-branch --branch master https://github.com/brave/go-sync.git /tmp/brave-src/gs`
(full checkout, ~9 s).

**GitHub API budget used: 0 calls to api.github.com/repos/*/contents/** — only
`git clone` (pack transfer, separate, much higher limit) plus `git ls-tree`/`cat-file`.
The `raw.githubusercontent.com` path was never needed.

Revisions read:
- brave-core `51c0ffe2d398f099f0e3e0cbfdd48683368f8a6da` ("1.99.40", 2026-10-14)
- go-sync `master` @ clone time

To re-read a file later: `cd /tmp/brave-src/bc && git show HEAD:<path>` works for *any*
path in the repo (tree objects are all local), e.g.
`git show HEAD:components/sync/service/brave_sync_service_impl.cc`. Missing blobs fetch on
demand.

## /tmp/brave-src/key-files/ — 36 files, 372K

Paths are repo-relative (kept with `cp --parents`).

### Client — brave-core

| file | why it matters |
| --- | --- |
| `components/brave_sync/crypto/crypto.cc` | HKDF-SHA512, Ed25519, XSalsa20 nonce/secretbox, BIP39 word<->bytes |
| `components/brave_sync/crypto/crypto.h` | API contracts incl. the 24-byte nonce layout |
| `components/brave_sync/time_limited_words.cc` | the rotating 25th word: local `BIP39[round(days since 2022-05-10) % 2048]`, ±1-day window |
| `components/brave_sync/time_limited_words.h` | `ValidationStatus` enum (kVersionDeprecated/kExpired/kValidForTooLong) |
| `components/brave_sync/qr_code_validator.cc` | QR path, 30-min validity, 60-min "valid for too long" cap |
| `components/brave_sync/qr_code_data.h` | QR JSON `{version, sync_code_hex, not_after}` shape |
| `components/brave_sync/brave_sync_prefs.cc` / `.h` | `brave_sync.sync_v2_seed`, `kCustomSyncServiceUrl`, leave-chain detail log |
| `components/brave_sync/brave_sync_p3a.cc` | **the authoritative category list** (`all_brave_supported_types`) |
| `components/brave_sync/features.cc` | `kBraveSyncDefaultPasswords` (enabled by default) |
| `components/brave_sync/BUILD.gn` | **`brave_sync_endpoint = "https://sync-v2.brave.com/v2"`** |
| `components/sync/service/brave_sync_auth_manager.cc` | the whole key tree + the bearer token (`ts\|sig\|pubkey`) |
| `components/sync/service/brave_sync_service_impl.cc` | seed storage, sync code, default selected types, delete-account retries |
| `components/sync/service/brave_sync_stopped_reporter.cc` | sync-stopped reporting disabled (empty override) |
| `components/sync/engine/brave_sync_server_commands.cc` | `CLEAR_SERVER_DATA` commit |
| `components/sync/engine/brave_sync_manager_impl.cc` | `RefreshTypes(All())` on start (no FCM push) |
| `components/sync/engine/brave_data_type_worker.cc` | progress-marker reset after 7 failed commits |
| `components/sync/protocol/brave_device_info_specifics.proto` | `BraveSpecificFields.is_self_delete_supported` |
| `components/sync/protocol/ai_chat_specifics.proto` | per-entity 400 KB budget, `c:`/`e:` record-id prefixes |
| `chromium_src/components/sync/base/sync_util.h` | prod and dev URLs both bound to `BRAVE_SYNC_ENDPOINT` |
| `chromium_src/components/sync/base/user_selectable_type.cc` | `kAIChatTypeName = "aiChat"` |
| `chromium_src/components/sync/service/sync_user_settings_impl.cc` | **`BraveAdjustPreferredDataTypes`** — the two removals |
| `chromium_src/components/sync/service/sync_service_impl.cc` | URL override (GPO pref > `--sync-url`), error reporting disabled |
| `chromium_src/components/sync_device_info/device_info_sync_bridge.cc` | `DeleteDeviceInfo` ack loop, `GetAllBraveDeviceInfo` |
| `chromium_src/components/sync_device_info/device_info.cc` | device record → UI value (`name`, `id`, `os`, `type`, ...) |
| `chromium_src/components/sync/base/data_type.cc` | `EncryptableUserTypes` += DEVICE_INFO/HISTORY/AI_CHAT_CONVERSATION; history made low-priority |
| `browser/ui/webui/settings/brave_sync_handler.cc` | code display/validation/join, reset, delete account, device list |
| `browser/net/brave_network_audit_allowed_lists.h` | prod/staging/dev sync hosts |
| `components/constants/network_constants.h` | `BraveServiceKey` header name |
| `browser/android/brave_sync_worker.cc` | mobile join path, same `TimeLimitedWords::Parse` |

### Server — brave/go-sync

| file | why it matters |
| --- | --- |
| `auth/auth.go` | token format, Ed25519 verify over ASCII decimal timestamp, ±1 day, BLOCKED_CLIENT_IDS |
| `controller/controller.go` | single `POST /command/`, 10 MB cap, gzip, protobuf in/out |
| `command/command.go` | GetUpdates / Commit / ClearServerData handlers, quotas, poll cache, conflict path |
| `command/item_size_monitor.go` | `LargeSizeThreshold = 400 * 1024` |
| `command/device_limit.go` | 50 active devices (100 allow-listed) |
| `datastore/sync_entity.go` | **`SyncEntity` (what the server actually stores)** + `CreateDBSyncEntity` (UUID re-key, 14-day history TTL, `DisableSyncChain`) |
| `datastore/datastore.go` | the Datastore interface (contract for the blind store) |

## Full trees (not copied into key-files/)

- `/tmp/brave-src/bc` — brave-core, sparse checkout + all git trees (~44 MB + git objects)
- `/tmp/brave-src/gs` — go-sync server, full working tree

Both are throwaway clones; delete with `rm -rf /tmp/brave-src` when no longer needed.
