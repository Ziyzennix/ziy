# Deep source recon: Brave Sync (real implementation)

Date: 2026-10-14. Sources: `brave/brave-core` @ `51c0ffe`/"1.99.40" (client, MPL-2.0) and
`brave/go-sync` @ `master` (server, MPL-2.0). Both shallow-cloned with
`git clone --filter=blob:none` (tree + file fetch, GitHub blob-raw limit — **0 api.github.com/
contents calls used**). Raw files: `/tmp/brave-src/key-files/` (36 files, 372K) — see the
announcement in `replica/re-deep-sync.assets.md`. Full trees at `/tmp/brave-src/bc` and
`/tmp/brave-src/gs`.

Note on repo naming: `brave/brave-browser` is only the issue tracker ("This repository is not
needed for building the browser and only holds issues, releases and the wiki. The source code
and contributions are at https://github.com/brave/brave-core"). Everything below is from
brave-core.

**Confidence legend:** `high` = read from the source named; `medium` = follows from a
verified fact plus a documented pattern; `UNVERIFIED` = could not reach it; never guessed.

---

## 1. Chain code format and key derivation

**The 24 words are not a BIP39 seed — they ARE the raw entropy.** `PassphraseFromBytes32`
(BIP39 wally-core `bip39_mnemonic_from_bytes`) turns a 32-byte CSPRNG value into the words;
`PassphraseToBytes32` (`bip39_mnemonic_to_bytes`) reverses it. There is **no PBKDF2, no
BIP39 seed, no passphrase extension**. The 32 bytes are used directly as HKDF input keying
material (IKM):

- `components/brave_sync/crypto/crypto.cc:22-29` `PassphraseFromBytes32`:
  `CHECK_EQ(bip39_mnemonic_from_bytes(nullptr, bytes.data(), bytes.size(), &words), WALLY_OK);`
  (comment in crypto.h: `"Convert a 32 bytes array into passphrase using bip39"`)
- `components/brave_sync/crypto/crypto.cc:145-155` `PassphraseToBytes32`: `bip39_mnemonic_to_bytes(...)`
- Validation is exactly "is it a valid BIP39 mnemonic with a valid checksum"
  (`IsPassphraseValid`, crypto.cc:158-161). `SetSyncCode` trims `" \n\t"` then calls it
  (`components/sync/service/brave_sync_service_impl.cc:250-268`).
- The 32 bytes live in one OS-encrypted pref, base64'd:
  `brave_sync.sync_v2_seed` → `kSyncV2Seed` (`brave_sync_prefs.cc:31,34`), written via
  `encryptor_->EncryptString(seed, &encrypted_seed)` then `Base64Encode`
  (`brave_sync_service_impl.cc:159-169`).

**The whole key tree is exactly three derivations, HKDF-SHA512, and all three are signing keys:**

```
seed (32 bytes = the 24 words, no further KDF)
  └─ HKDF-SHA512(ikm=seed, salt=FIXED_64B_CONST, info="sync-auth-key", L=32)
        └─ Ed25519 keypair from the 32-byte HKDF output  ← THE ONLY KEYS DERIVED
```

- `components/brave_sync/crypto/crypto.cc:31-43` `HKDFSha512` — BoringSSL `HKDF(...)`,
  `EVP_sha512()`, salt/info optional, `CHECK(result)`.
- `crypto.cc:44-57` `DeriveSigningKeysFromSeed`: `HKDFSha512(seed, salt, info, DEFAULT_SEED_SIZE)`
  (DEFAULT_SEED_SIZE=32) then `ED25519_keypair_from_seed(public, private, output.data())`.
- `components/sync/service/brave_sync_auth_manager.cc:41-57` `DeriveSigningKeys` — the fixed
  64-byte HKDF salt (a literal byte array, identical in the unit test at
  `components/brave_sync/crypto/crypto_unittest.cc:121-149`) and
  `const std::string info_str = "sync-auth-key";`.

**There is no category key tree, no per-record key, no per-chain salt, no chain id.**
Verified: `grep -rn "salt\|chain_id\|chainId"` across `components/sync/`,
`components/brave_sync/`, `browser/sync/` returns only the crypto.h parameter docs and the
one fixed salt literal. There is no `HKDF` call anywhere except `DeriveSigningKeysFromSeed`.

**Why:** Brave does **not** design its own record encryption. It reuses Chromium's sync engine
unchanged (see §2), including Chromium's Nigori/keybag. The unit test proves it — it builds a
real Chromium `Nigori`:

- `components/sync/service/brave_sync_service_impl_unittest.cc:75-90`:
  `std::unique_ptr<Nigori> nigori = Nigori::CreateByDerivation(...);`
  `encrypted.set_key_name(nigori->GetKeyName()); *encrypted.mutable_blob() = nigori->Encrypt(unencrypted);`

**The 25th word derives nothing.** It is stripped before any crypto. `ParseImpl` splits the
input, validates the first 24 as a BIP39 passphrase, and returns `recombined_pure_words` —
the 25th is used only as a date witness and then discarded (`time_limited_words.cc:143-197`).
The pure words then go to `SetSyncCode` → `SetSeed` → the *same* pref the 24 words alone would
have. **So the 25th word gates access to joining only — never to the keys.** (It does gate
*time*, see §6.) Note `Parse` rejects bare 24 words after
`kWordsv1SunsetDay = "Mon, 1 Aug 2022 00:00:00 GMT"` with `kVersionDeprecated`
(`time_limited_words.cc:152-166`).

---

## 2. Record encryption

**It is Chromium's sync protocol, byte for byte.** Brave adds no transport, no record format,
no blob format of its own. Evidence:

- `patches/components-sync-engine-BUILD.gn.patch` adds exactly three files to Chromium's
  engine: `brave_sync_server_commands.cc`, `brave_data_type_worker.cc`,
  `brave_sync_manager_impl.cc` (via `brave_components_sync_engine_sources`).
- `components/sync/service/brave_sync_stopped_reporter.cc:12-18` —
  `SyncStoppedReporter::ReportSyncStopped` is **overridden to be an empty no-op** (Brave does
  not report sync-stopped events).
- No patch to `sync.proto`/`entity_specifics.proto` other than adding Brave's own
  `ai_chat_conversation = 10000001` field
  (`patches/components-sync-protocol-entity_specifics.proto.patch`).

**Cipher: NOT AES-256-GCM as we designed.** Brave's own crypto module uses
**NaCl secretbox = XSalsa20-Poly1305**, but it is used for *nothing in the record path* —
its only consumer in the shipped product is `DeriveSigningKeysFromSeed` (which uses only the
HKDF + Ed25519). Verified: `grep -rn "crypto::Encrypt(\|crypto::Decrypt("` across
`components/` and `browser/` (excluding unittests) returns **zero call sites**.

- `components/brave_sync/crypto/crypto.h:60-73`: `"Encrypts and authenticates a message using
  Nacl secretbox. (xsalsa20-poly1305)"`; `Encrypt`/`Decrypt` at crypto.cc:91-131 use
  `crypto_secretbox` / `crypto_secretbox_open` with `crypto_secretbox_NONCEBYTES` (24).
- `GetNonce` (crypto.cc:79-89): 24 bytes = `counter(2B BE) || random(20B) || implied zero(2B)`.
  No AAD — XSalsa20-Poly1305 in secretbox construction takes no additional data.
- So: **the record cipher in reality is whatever Chromium's Nigori produces** (currently
  AES-256-GCM via `Nigori::Encrypt`, wrapped per-type), not Brave's XSalsa20. We should treat
  "Brave's record cipher" as *Chromium's Nigori cipher*.

**Record id scheme: client-chosen, server-renamed.** From the server
(`datastore/sync_entity.go:792-833`, `CreateDBSyncEntity`):

- On a create (`*entity.Version == 0` and a `cache_guid` present) the server **replaces** the
  client's id: `id = uuid.New().String()`, and keeps `OriginatorClientItemID`/`OriginatorCacheGUID`
  to map client-generated ids to server-generated ones (`command/command.go:325-329, 377-379`
  `idMap`) — this is Chromium's originator-client-item-id scheme, used for re-linking local
  commits to the server id. Parent ids are rewritten through the same map
  (`command/command.go:322-326`).
- Exception: history uses `id = *entity.ClientTagHash` (the client-tag hash — this is how
  history visits get de-duplicated) — `sync_entity.go:824-826`.
- The **25th-word/AIChat record id** is `"c:"+uuid` or `"e:"+uuid` for conversation vs entry
  (`components/sync/protocol/ai_chat_specifics.proto:6-11`).

**Blob shape the server stores** — `datastore/sync_entity.go:45-60` `SyncEntity` (DynamoDB):
`ClientID, ID, ParentID, Version, Mtime, Ctime, Name, NonUniqueName, ServerDefinedUniqueTag,
Deleted, OriginatorCacheGUID, OriginatorClientItemID, Specifics []byte, DataType *int, Folder
*bool, ClientDefinedUniqueTag, UniquePosition []byte, DataTypeMtime, ExpirationTime`.
`Specifics` is `proto.Marshal(entity.Specifics)` — the whole `EntitySpecifics` oneof, which
contains the `EncryptedData{key_name, blob}` for encrypted types.

**Updates/tombstones**, from `handleCommitRequest` (`command/command.go:264-452`):
- `*entityToCommit.Version = *entityToCommit.Mtime` (a new mtime = a new version), then
  `isUpdateOp := oldVersion != 0`.
- History is special-cased: `isUpdateOp, err = db.HasItem(ctx, clientID, *entity.ClientDefinedUniqueTag)`
  — history "updates" are decided by client-tag existence, not version.
- **Conflict detection is pessimistic-version, not LWW**: `db.UpdateSyncEntity(ctx, entityToCommit, oldVersion)`
  returns `conflict=true` → `CommitResponse_CONFLICT`, entry skipped and *not* stored
  (`command/command.go:414-424`).
- Delete = the client sends `Deleted=true`; the server just stores the flag
  (`sync_entity.go:830-838`). Chromium's delete-directive machinery carries the actual
  tombstone semantics; see §5.
- History items TTL out automatically: `ExpirationTime = now + HistoryExpirationIntervalSecs`
  where `HistoryExpirationIntervalSecs = 14*24*60*60` (14 days) — `sync_entity.go:34-35`.

---

## 3. Server protocol

**Base URLs** — `components/brave_sync/BUILD.gn:12-14`:

```
declare_args() { brave_sync_endpoint = "https://sync-v2.brave.com/v2" }
```

Both the prod URL and the dev URL are overridden to the same value —
`chromium_src/components/sync/base/sync_util.h:12-13`:
`inline constexpr char kSyncServerUrl[] = BUILDFLAG(BRAVE_SYNC_ENDPOINT);`
`inline constexpr char kSyncDevServerUrl[] = BUILDFLAG(BRAVE_SYNC_ENDPOINT);`
Other hosts only appear in the network-audit allow-list (`browser/net/brave_network_audit_allowed_lists.h:49,52,55`):
prod `https://sync-v2.brave.com/v2`, staging `https://sync-v2.bravesoftware.com/v2`, dev
`https://sync-v2.brave.software/v2`. A group-policy pref `brave_sync.sync_service_url`
(`kCustomSyncServiceUrl`) overrides it for enterprise, must be HTTPS
(`chromium_src/components/sync/service/sync_service_impl.cc:16-42`).

**One endpoint: `POST /command/`.** `controller/controller.go:26-32` —
`r.Method("POST", "/command/", ...)`. There is no fetchblob, no poll path, no separate
auth path. The request body is a **protobuf `ClientToServerMessage`**, optionally
`Content-Encoding: gzip`, capped at `payloadLimit10MB = 10 MiB`; the response is a protobuf
`ClientToServerResponse`. Three message contents are handled
(`command/command.go:543-566`): `GET_UPDATES`, `COMMIT`, `CLEAR_SERVER_DATA`.

**Auth is a signed challenge-free bearer token, not a server challenge.** Client
(`brave_sync_auth_manager.cc:109-131`):

```cpp
brave_sync::crypto::Sign(timestamp_bytes, private_key_, &signature);
const std::string access_token = timestamp_hex + "|" + signed_timestamp_hex + "|" + public_key_hex;
encoded_access_token = base::Base64Encode(access_token);
access_token_info.token = encoded_access_token + AppendBraveServiceKeyHeaderString();
```

- The timestamp is **not** local time: it comes from Chromium's `NetworkTimeTracker`
  (`OnNetworkTimeFetched`, `brave_sync_auth_manager.cc:133-138`,
  `base::NumberToString(int64_t(time.InMillisecondsFSinceUnixEpoch()))`), via
  `brave_sync::NetworkTimeHelper::GetNetworkTime`. So clock skew is neutralised for auth.
- Server (`auth/auth.go:33-96`): decodes base64 (**URLEncoding**, so `-`/`_`), matches
  `^(TimestampHex)\|(SignedTimestampHex)\|(PublicKeyHex)$`, does
  `ed25519.Verify(publicKey, timestampBytes, signedTimestamp)` — **the signed message is the
  ASCII decimal timestamp** (`strconv.ParseInt(string(timestampBytes), 10, 64)`), then
  `abs(now - timestamp) > TokenMaxDuration` with `TokenMaxDuration = 86400 * 1e3` ms
  (**±1 day**). Then `BLOCKED_CLIENT_IDS` env check. Returns the public key hex as `clientID`.
- **The chain id IS the device's Ed25519 public key hex** — there is no separate chain
  identifier and no account. `client_id = base::HexEncode(public_key_)`
  (`brave_sync_auth_manager.cc:89-92` `DetermineAccountToUse`). Everything for that chain is
  stored under `pk = clientID`.
- A second static header: `BraveServiceKey` (`kBraveServicesKeyHeader`) appended to the token
  for any `*.brave.com` / `*.bravesoftware.com` host
  (`brave_sync_auth_manager.cc:20-25`, `components/constants/network_constants.h:57`,
  `brave_services_key_helper.cc:14-19`). The value `BUILDFLAG(BRAVE_SERVICES_KEY)` is a
  build-time constant (default `""`, asserted non-empty in official builds).

**Privacy boundary — refuting part of our claim.** What the server can see:

| server sees | server does NOT see |
| --- | --- |
| `clientID` (the Ed25519 pubkey hex) as the partition key, and its SHA-linked device count | any key, any word, any passphrase |
| `DataType` (a plain int per entity — **so which categories are in the chain**, 963985=history etc.) | plaintext of any record (`Specifics` is opaque protobuf) |
| `ID`, `ParentID`, `Name` (**the plaintext entity name! e.g. a bookmark's title**), `NonUniqueName` | which records are folders' *contents* semantics |
| `Version`, `Mtime`, `Ctime` (server-generated `now.UnixMilli()`) | |
| `Deleted`, `Folder`, `Specifics` size, item counts | plaintext URLs/titles (those live inside encrypted specifics) |
| `OriginatorCacheGUID` (the Chromium `cache_guid`, sent by the client — a per-device random id, *not* the pubkey) | correlation of a device to a human |
| per-type mtime cache for polling; `ClientDefinedUniqueTag` for history | |

Refutations / corrections to `architecture.md` §4.3's "It never sees a key, a word, or a
domain":
1. **The server DOES see entity names.** `SyncEntity.Name` is stored in the clear
   (`sync_entity.go:52`, `datastore.CreateDBSyncEntity` → `Name: entity.Name`) and
   `Name`/`NonUniqueName` are returned by `CreatePBSyncEntity`. Bookmark titles, folder names
   and history URL-tier data are therefore **plaintext on the server**. Our claim "The server
   can read nothing either way" is too strong.
2. **The server sees the data-type id per entity** — i.e. which categories a chain holds, and
   (for `nigoriTypeID`) that a chain is initialised. "The server's ignorance of categories is
   the whole privacy claim" is **false** in Brave's design: categories are *not* hidden from
   the server.
3. It does see `Mtime`/`Ctime` — timestamps — so "ids+sizes+timestamps only" is right about
   those three, but **names** is the missing fourth. `Deleted`/`Folder` flags are also visible.
4. Nothing key-related is ever sent: keys live only in the client (Chromium's Nigori keybag),
   so the *content* confidentiality claim holds.

Batch/limit facts (`command/command.go:19-26`): `maxGUBatchSize = 500`,
`maxClientObjectQuota = 50000`, `maxClientHistoryObjectQuota = 30000`,
`maxCommitBatchSize = 90`; `LargeSizeThreshold = 400 * 1024` (`command/item_size_monitor.go:11`)
matches the AIChat proto's "400 KB-per-entity server limit"
(`ai_chat_specifics.proto:7-9`). Device cap: `maxActiveDevices = 50` (100 for allow-listed
chains) — `command/device_limit.go:11-13`, enforced in `setupNewClient`
(`command/command.go:38-65`) with `SyncEnums_THROTTLED`.

---

## 4. Per-device category toggles

**Brave syncs Chromium's stock `UserSelectableType` set plus exactly one addition
(`kAIChat`); it removes exactly two data types.** This is the authoritative list
(`components/brave_sync/brave_sync_p3a.cc:19-24`, `all_brave_supported_types`):

```
bookmarks, history, extensions, apps, passwords, preferences, themes, tabs, autofill
```
plus `AIChat` (`UserSelectableType::kAIChat`, added by
`rewrite/components/sync/base/user_selectable_type.h.yaml` — "Append kAIChat to the
UserSelectableType enum as the new kLastType", and mapped in
`chromium_src/components/sync/base/user_selectable_type.cc` as
`kAIChatTypeName = "aiChat"`).

Two removals, unconditional (`chromium_src/components/sync/service/sync_user_settings_impl.cc:11-21`):

```cpp
void BraveAdjustPreferredDataTypes(DataTypeSet* types, bool is_local_sync) {
  types->Remove(AUTOFILL_VALUABLE);
  types->Remove(AUTOFILL_VALUABLE_METADATA);
  if (is_local_sync) { types->Remove(AI_CHAT_CONVERSATION); }
}
```

Called from `SyncUserSettingsImpl::GetPreferredDataTypes`
(`patches/components-sync-service-sync_user_settings_impl.cc.patch`).

**Default selection on chain create/join** — bookmarks, passwords, and AI-chat if the build
enables it (`components/sync/service/brave_sync_service_impl.cc:313-324`):

```cpp
selected_types.Put(UserSelectableType::kBookmarks);
if (base::FeatureList::IsEnabled(brave_sync::features::kBraveSyncDefaultPasswords))
  selected_types.Put(UserSelectableType::kPasswords);
#if BUILDFLAG(ENABLE_AI_CHAT)
if (ai_chat::features::IsBraveSyncAIChatEnabled())
  selected_types.Put(UserSelectableType::kAIChat);
#endif
GetUserSettings()->SetSelectedTypes(false, selected_types);
```

`kBraveSyncDefaultPasswords` is `FEATURE_ENABLED_BY_DEFAULT` (`components/brave_sync/features.cc:11-13`).
**So the default is bookmarks + passwords (+ AI chat) — not everything.** This differs from
the recon's S27 list, which omits `preferences`, `tabs`, `apps`, `ai_chat`.

Also relevant: `EncryptableUserTypes()` adds `DEVICE_INFO`, `HISTORY`, `AI_CHAT_CONVERSATION`
to Chromium's encryptable set (`chromium_src/components/sync/base/data_type.cc:16-24`) — i.e.
Brave forces encryption on for those, and comments "Brave sync has encryption setup ready
when sync chain created."

**"Off for a category" = no send AND no receive.** This is **exactly what our architecture
says (§4.4) and it is correct.** Mechanism: the per-device selection is
`SyncUserSettings::SetSelectedTypes` → `DataTypeManager` only configures/plumbs the selected
types; GetUpdates `from_progress_marker` then contains no marker for a deselected type, and
no commits are produced for it. There is **no Brave patch** restricting types — verified:
no `GetConfiguredDataTypes`/`DataTypeManager::Configure` override and no
`data_type_registry` patch exists in `patches/`. So it is stock Chromium behaviour, and stock
Chromium's behaviour is "type not selected ⇒ not synced in either direction."

One caveat we should not lose: `BraveSyncServiceImpl::GetPreferredDataTypes()`
(`brave_sync_service_impl.cc:186-200`) returns `DataTypeSet::All()` when the encryptor is not
ready yet, specifically so `ClearMetadataWhileStoppedExceptFor()` cannot wipe DeviceInfo
metadata before auth is established. That's a startup ordering detail, not a toggle semantic.

Also: Brave's iOS/Android list matches the desktop list (it reuses the same
`mSyncTypeSwitchPreferencesMap` map keyed by `UserSelectableType`,
`android/java/.../BraveManageSyncSettings.java:118-128`).

**UNVERIFIED:** the exact desktop settings UI that renders these toggles. Brave's own
`brave_sync_configure.html` just embeds Chromium's `<settings-sync-controls>`
(`browser/resources/settings/brave_sync_page/brave_sync_configure.html`, section
`.settings`), i.e. **Brave reuses Chromium's category UI** rather than writing its own (its
own `brave_sync_page_*` files are device-list / code-dialog / leave-chain only). I could not
read Chromium's own `people_page/sync_controls.ts` (out of this repo), so the precise labels
Chromium shows per type are **UNVERIFIED**.

---

## 5. Cadence, commit, conflict resolution, leave, delete account

**Cadence:** Brave keeps Chromium's scheduler. `BraveSyncManagerImpl::StartSyncingNormally`
forces a full nudge after start because there is no FCM push:
`components/sync/engine/brave_sync_manager_impl.cc:14-18` —
```cpp
SyncManagerImpl::StartSyncingNormally(last_poll_time);
// Remove this hack when we have FCM invalidation integrated.
RefreshTypes(DataTypeSet::All());
```
The server supports that with a **poll short-circuit cache**: `isPoll` requests consult
`cache.IsTypeMtimeUpdated(clientID, typeId, token)` and skip a type entirely if unchanged
(`command/command.go:120-124`, `command/command.go:227-231`). `changesRemaining != 0` makes
the client poll again immediately; the cache deliberately is *not* updated in that iteration
to avoid a missed update (`command/command.go:209-220`).
A comment in `brave_sync_service_impl.cc:513-518` states "Typical cycle takes 30 sec", used
only to pace P3A reporting (update every ~30 min / first at ~5 min). **The actual poll
interval constant is Chromium's `SyncScheduler` and is UNVERIFIED here** (Brave patches
`sync_scheduler_impl.cc` only to add a logging hook,
`patches/components-sync-engine-sync_scheduler_impl.cc.patch`).

**Commit protocol:** Chromium's `CommitMessage` (protobuf) over `POST /command/`, batched to
`maxCommitBatchSize = 90` (`command/command.go:536`). Server assigns
`Version = Mtime = now.UnixMilli()` server-side (`sync_entity.go:850-851`), returns
`Entryresponse{IdString, Version, Mtime}` per entry.

**Conflict resolution — NOT LWW by `updated_at`, and NOT a device_id tie-break.** Two
layers:
1. **Server rejects a stale write.** `UpdateSyncEntity(ctx, entity, oldVersion)` is a
   conditional write; a version mismatch returns `conflict=true` →
   `CommitResponse_CONFLICT` and the entry is **not stored** (`command/command.go:414-424`).
   The server's own `Mtime` is generated by the server, not taken from the client, so a
   client cannot backdate.
2. **The client then resolves.** That is Chromium's own sync engine (per-type conflict
   resolution: bookmarks use a merge/`UniquePosition` + server-tag-based dedup; passwords use
   a credential-pojo comparison; history dedups by client tag). **Which specific algorithm
   each Brave-synced type uses is UNVERIFIED** — it lives in Chromium's
   `components/sync/...` model code, which this repo only patches in two places
   (`data_type.cc` for the encryptable/low-priority sets; `common_controller_builder.cc` for
   Brave's history controllers). The only Brave-authored conflict behaviour I found is
   `BraveDataTypeWorker::OnCommitResponse` → after 7 failed commits it resets the progress
   marker (rate-limited to once per 30 min) so the client re-fetches instead of wedging
   (`components/sync/engine/brave_data_type_worker.cc:27-34, 65-90`).

**"Leave the chain" (= one device leaves):** the local device deletes its own DeviceInfo
record and stops. `brave_sync::ResetSync`
(`components/brave_sync/sync_service_impl_helper.cc:13-38`) suspends the device observer,
`tracker->DeleteDeviceInfo(local_device_info->guid(), ...)` then `OnSelfDeviceInfoDeleted` →
`StopAndClear(kResetLocalData)`. The server is *not* told to clear anything — only the
device's own record is committed as deleted, and `DeleteDeviceInfo` re-polls until
`change_processor()->IsEntityUnsynced(client_id)` is false, 1s apart, 5 attempts
(`chromium_src/components/sync_device_info/device_info_sync_bridge.cc:56-88`). Local data
(deleting it is `DeleteDevice`) survives; the **chain's server data stays**. The recon's F20
edge note "leaving the chain deletes the server cache" is therefore **wrong for
leave-this-device** and right for **delete-account**.

**"Delete account" (= the whole chain's server data):** `CLEAR_SERVER_DATA`.
`BraveSyncServiceImpl::PermanentlyDeleteAccount` (`brave_sync_service_impl.cc:448-452`) →
`engine_->PermanentlyDeleteAccount` → `BraveSyncServerCommands::PermanentlyDeleteAccount`
(`components/sync/engine/brave_sync_server_commands.cc:26-51`) sets
`message.set_message_contents(ClientToServerMessage::CLEAR_SERVER_DATA)` and
`message.set_share(cycle->context()->account_email())` — note `account_email` for a Brave
chain is the *client id hex* with a space inserted in the middle (see §3). Server side
(`command/command.go:461-505`): `DisableSyncChain(clientID)` inserts a
`DisabledMarkerItem{ID: "disabled_chain", Reason: "deleted"}`, then `ClearServerData(clientID)`
paginated-queries and transactionally deletes every item under `pk = clientID`, and deletes
the mtime cache keys. Retries: 5 attempts, 500 ms apart (`brave_sync_service_impl.cc:400-435`).
After success the initiator does `StopAndClear(kDisabledAccount)`; other devices in the chain
learn about it from the DimissedChain middleware and are cleaned by `ResetEngine`
(`brave_sync_service_impl.cc:455-492`). The `DisabledChain` middleware rejects *any* further
request against a disabled chain — so **a device trying to join a deleted chain fails**
(`controller/controller.go:30`, `synccontext`), surfaced as
`IDS_BRAVE_SYNC_JOINING_DELETED_ACCOUNT` and `sync_disabled_by_admin_` handling
(`brave_sync_handler.cc:298-306`). That is exactly the recon's F20 "deleting the account is
irreversible".

---

## 6. The rotating word mechanism

**Format: the 25th word is `BIP39_WORDLIST[ round(days_since_epoch) mod 2048 ]` — computed
locally, no network fetch. There is no Brave-published URL and no endpoint.**

- Epoch: `kWordsv2Epoch = "Tue, 10 May 2022 00:00:00 GMT"` (`time_limited_words.cc:31`).
- `TimeLimitedWords::GenerateForDate` (`time_limited_words.cc:117-148`):
  ```cpp
  int days_since_words_v2_epoch = GetRoundedDaysDiff(GetWordsV2Epoch(), not_after);
  std::string last_word = GetWordByIndex(days_since_words_v2_epoch);
  std::string time_limited_code = base::StrCat({pure_words, " ", last_word});
  ```
- `GetRoundedDaysDiff` = `std::round((time2-time1).InMillisecondsF() / kMillisecondsPerDay)`
  (`time_limited_words.cc:106-113`) — **rotation period ≈ 24 h, bucketed by rounding**, so a
  code is valid for roughly ±12 h around its day boundary, i.e. the effective window is
  "the current word, the previous word, or the next word".
- `GetWordByIndex` is a pure lookup: `bip39_get_word(nullptr, index % BIP39_WORDLIST_LEN, &word)`
  with `BIP39_WORDLIST_LEN == 2048` (`time_limited_words.cc:49-64`). Unit test pins it:
  `GetWordByIndex(0)=="abandon"`, `(1)=="ability"`, `(2047)=="zoo"`, `(2048)=="abandon"`
  (`time_limited_words_unittest.cc:57-62`); and `GenerateForDate(kValidSyncCode, epoch) ==
  kValidSyncCode + " abandon"`, `epoch+1 day → " ability"` (`...unittest.cc:64-78`).
- Validity (`ParseImpl`, `time_limited_words.cc:175-197`): the 25 words are split, the first
  24 validated as BIP39, and then
  `days_abs_diff = abs(days_actual - days_encoded); if (days_abs_diff <= 1) return pure_words;`
  plus `kValidForTooLong` (encoded is >1 day ahead — the code was minted for the future) and
  `kExpired` (encoded is >1 day behind). A `kIntervalForValidForTooLong = base::Minutes(60)`
  constant exists in `qr_code_validator.cc:24` but applies to QR, not words.

**How a joining device uses it:** it just strips it. `BraveSyncHandler::HandleSetSyncCode`
(`brave_sync_handler.cc:246-284`) calls `TimeLimitedWords::Parse(time_limited_sync_code)` and
passes `pure_words_with_status.value()` (the 24 words) to `SetSyncCode`; the 25th word never
touches the key derivation. QR is a separate, parallel path: the code is hex-encoded (64 chars)
into `{"version":"2","sync_code_hex":...,"not_after":<epoch secs>}` valid 30 minutes
(`qr_code_data.h:24-25`, `kMinutesFromNowForValidCode = 30`;
`brave_sync_handler.cc:191-220`), and the QR path rejects codes valid for more than 60 minutes
(`qr_code_validator.cc:24, 82-85`). This matches the recon's F20 "words alone now need a
rotating 25th word ... mobile join uses QR".

---

## 7. Deltas from architecture.md §4 (highest-value section)

| our design choice | does Brave do it differently? (citation) | should we adjust? |
| --- | --- | --- |
| **BIP39 mnemonic → seed = PBKDF2(...) → HKDF master** | **Yes, materially.** Brave skips PBKDF2 and the seed entirely: the 24 words *are* the 32-byte IKM (`crypto.cc:145-155`). | **Yes — simplify.** Keep the BIP39 mnemonic + checksum validation (that is genuinely Brave's format and is user-facing), but make the words→bytes step a plain reversal, then feed those 32 bytes straight into HKDF. **Do not add PBKDF2.** It costs 2048 rounds of SHA-512 per derivation, protects nothing here (the mnemonic is not a password), and it is not what Brave does. Also: do **not** accept a BIP39 passphrase/25th-word-as-passphrase — Brave's 25th word is not a passphrase. |
| **HKDF-SHA256 for the whole tree** | **No, different: HKDF-SHA512.** `crypto.cc:31-43` — `EVP_sha512()`, the only KDF in Brave. | **Yes — switch to SHA-512.** One-character-ish change, and it removes a gratuitous divergence. It also matters for the Ed25519 seed: Brave derives a 32-byte HKDF output and feeds it to `ED25519_keypair_from_seed`; with SHA-256 output that's fine, but the *hash* choice is a wire-incompatible difference for anyone ever testing against Brave vectors. |
| **chain id (random 128-bit) as HKDF salt, travels outside the word code** | **Yes — Brave has no chain id and no per-chain salt.** The HKDF salt is a hard-coded 64-byte constant, identical in every build (`brave_sync_auth_manager.cc:41-54`); the chain is identified by the derived public key hex, and the client has no secret chain identifier at all. | **Keep ours, but change the justification — it is a divergence, not a match.** Our chain-id salt is a *strictly better* design: it means one leaked 24-word code cannot be replayed into a second chain with the same keys, which Brave genuinely cannot do. The cost is that the chain id must be transported; Brave's answer to that is "the chain is the pubkey", which is simpler but weaker. Recommendation: **keep the chain id, keep it out of the words, and stop describing it as "Brave's scheme"** — describe it as our hardening over Brave. If shipping speed matters more, note that dropping it entirely is Brave-compatible. |
| **3-level tree: master → category key → record key** | **Yes.** Brave derives exactly **one** keypair (`info="sync-auth-key"`), used for *server auth only*. Record encryption is Chromium's Nigori (`Nigori::CreateByDerivation` in `brave_sync_service_impl_unittest.cc:75-90`). | **Partly.** Our category/record subtree is not Brave's and buys little (Brave gets its confidentiality from one Nigori + per-type keys the engine manages). Two options: (a) **recommended — collapse to two levels**: `HKDF-SHA512(seed, salt=chain_id, info="ziy-sync/v1")` → one master, then derive per-category keys from the master; (b) if we want maximum simplicity, mirror Brave and let the sync layer own record keys. **Do not ship a 3-level tree that no test exercises.** |
| **`info = "ziy-sync/v1\|rot=<word>"`, UTC-day bucket** | **Different mechanism, same shape.** Brave's 25th word is `BIP39_WORDLIST[round(days since 2022-05-10) mod 2048]`, computed locally, and is *discarded before any crypto* (`time_limited_words.cc:117-148, 143-197`). | **Yes, adjust the bucket, keep the gate.** Two bugs to avoid: (1) `round()` on a day difference means a code is valid for ±1 day, so "the bucket is a UTC day" must mean *accept today's, yesterday's and tomorrow's word* — a single-day bucket will reject valid codes. (2) Brave's word is **not** mixed into the key derivation at all; ours is. If we mix it in, then a device that joined yesterday cannot decrypt records written today unless the derivation is time-independent per record — **that is a real design hazard**, and Brave sidesteps it by not deriving anything from it. **Recommendation: keep the rotating word as a *join gate* only (validate then discard), exactly like Brave, and do not put it in `info`.** |
| **AES-256-GCM records, 96-bit CSPRNG nonce, no AAD** | **Cipher: yes, matches Chromium's Nigori (AES-256-GCM), not Brave's unused XSalsa20.** But Brave's nonce is 24 bytes `counter(2B)‖random(20B)` with a per-interval counter as replay defence (`crypto.cc:79-89`, crypto.h:56-58 "increments every time interval T (TBD) to partially defend against replay attacks"), and there is **no AAD** — XSalsa20-Poly1305 takes none. | **Keep AES-256-GCM** (WebCrypto-available, matches Nigori). **Change the nonce**: use `counter(2B BE) ‖ random(20B)` padded to 12 for GCM (Brave's exact construction) instead of 12 random bytes, and add the replay counter. **Add AAD that we currently lack** — bind `(category, record_id, updated_at)`. Brave can't (secretbox has none), but AES-GCM can, and it is free integrity for exactly the fields our §4.2 already signs. Small, cheap, strictly better. |
| **Ed25519 device auth; pubkey = device id; sign `(category, record_id, updated_at)`** | **Ed25519 + pubkey-as-id: yes, exactly right** (`brave_sync_auth_manager.cc:55-56, 89-92`; server `auth.go:64-70`). **What is signed: no.** Brave signs a single **network-time timestamp in ASCII decimal**, nothing per-record; the token is `timestamp_hex|sig_hex|pubkey_hex`, valid ±1 day (`auth.go:33-96`). | **Keep Ed25519 and pubkey-as-device-id (good match). Change two things:** (1) get the timestamp from network time, not the local clock — Brave explicitly routes it through `NetworkTimeTracker` (`brave_sync_auth_manager.cc:133-138`), because a skewed device produces a token the server rejects. (2) Our per-record signature over `(category, record_id, updated_at)` is **better than Brave's** (Brave has no per-record authenticity at all — the ciphertext's integrity is the whole story). Keep it; it costs one extra signature per record. |
| **LWW with `device_id` tie-break on `updated_at`** | **No.** The server generates its own `Mtime = now.UnixMilli()` (`sync_entity.go:850-851`) and **rejects stale writes with `CONFLICT`** via conditional version compare (`command.go:414-424`). Client-side per-type conflict resolution is Chromium's and is UNVERIFIED. | **Adjust.** LWW-on-client-`updated_at` is not what happens and is the weakest link in our design: client clocks are the untrusted input, and a client that can pick `updated_at` can win any tie. Align with Brave: server stamps the version on write, conditional-write on version, and let the *client* decide the merge. Where a deterministic tie is unavoidable, prefer **server order (mtime) then a stable record-id ordering**, not device_id — device_id is a public key, so it is unique and stable, but it is also forgeable-by-construction (join any chain by learning 24 words) so it is a weak tiebreaker for "who wrote last". |
| **Blind SQLite store; server stores `{category, record_id, updated_at, tombstone, nonce, payload, signer, sig}`** | **Partly.** The store is blind to *content* — yes. But the real server also stores **`Name`/`NonUniqueName` in plaintext** and the plaintext `DataType` id (`sync_entity.go:52-56`). And tombstones are a `Deleted bool` on the entity (plus Chromium's delete directives), not a separate tombstone record with an empty payload; history entities expire after 14 days via DynamoDB TTL (`sync_entity.go:34-35, 852-858`). | **Two concrete changes.** (1) **Do not store `Name` in the clear.** Our schema stores only ciphertext — that is *better* than Brave and we should keep it and stop claiming parity. Update the privacy claim in architecture.md §4.3: our store is stricter than Brave's (Brave leaks entity names + type ids). (2) **Tombstones**: keep the tombstone-record form (it is simpler on SQLite than a `deleted` flag modelled through a delete-directive protocol), but add Brave's TTL: expire history tombstones after ~14 days, and GC a tombstone only after every known device has acked past it — Brave's own comment in `data_type.cc:29-35` explains exactly why (processing history delete directives before retrieving history wrongly deletes entries). |
| **TLS 1.3 + cert pinning** | **Not Brave's approach.** Brave relies on TLS plus a build-time `BraveServiceKey` static header and, for sync, the per-request signature. There is no pinning in the sync path that I found. | **Keep pinning** — it is free and strictly better than Brave. Just do not describe it as parity. |
| **Categories enforced client-side, server's ignorance = the privacy claim** | **Toggles: yes, identical semantics (§4)** — off ⇒ no send and no receive, and this is stock Chromium behaviour. **The privacy claim: refuted.** The server sees the type id per entity. | **Keep the toggles as designed (they are right). Rewrite the rationale.** Say: categories are enforced client-side so a toggle can never *read* another device's data; the server does see which types a chain holds. Our server is *stricter* than Brave's here (no plaintext names, no type ids if we bucket categories into the ciphertext) — so make that the claim. |
| **Node 22 + Fastify + SQLite, single binary** | **Different.** Brave's server is Go + DynamoDB + Redis (`datastore/dynamo.go`, `cache/redis.go`) with a 10 MB protobuf POST, gzip support, 50k/30k quotas, 90-commit batches, 500-entry GetUpdates. | **Keep SQLite** (correct for a blind KV store, and this is a product decision not a protocol one). **Adopt the operational numbers** as our limits so we fail the same way Brave does: 10 MB request cap, 90 entries per commit batch, 500 per GetUpdates batch, 50k total / 30k history item quota, 50-device chain cap, and reject writes >400 KB per entity. Our single binary then has a documented ceiling instead of an accidental one. |

### The five things to actually change in the build (priority order)

1. **Nonce construction** — `counter(2B BE) ‖ random(20B)` (Brave's exact `GetNonce`), plus a
   per-record replay counter, and use the free AES-GCM AAD on `(category, record_id, updated_at)`.
2. **HKDF-SHA512 everywhere, and drop the PBKDF2 seed step.** The 24 words are the IKM.
3. **Take the rotating word out of `info`.** It is a join gate with a ±1-day window
   (`round(days)` ⇒ accept previous/current/next word); it derives nothing.
4. **Get the auth timestamp from network time, not `Date.now()`.**
5. **Server-stamped version + conditional write (CONFLICT) instead of client-clocked LWW**, and
   drop the `device_id` tie-break in favour of server order then record id.

### Two claims in architecture.md to correct verbatim

- §4.3 "It never sees a key, a word, or a domain" → it *does* see **entity names** and **data
  type ids** in Brave's design; ours need not, and should not.
- §4.3 / §4.4 "the server's ignorance of categories is the whole privacy claim" → the server
  sees categories; the privacy claim that survives is *content* blindness.

---

## Explicit UNVERIFIED list

1. **Chromium's poll interval constant** (`SyncScheduler`'s polling period). Brave inherits it
   and only logs in `HandleFailure`; the value lives in Chromium's tree, not here.
2. **Per-type conflict-resolution algorithms** (bookmark merge, password comparison, history
   dedup). Chromium-owned; only `BraveDataTypeWorker`'s failure-recovery is Brave's.
3. **The exact desktop settings labels Chromium renders for each category** — Brave reuses
   `<settings-sync-controls>` (`brave_sync_configure.html`), so the UI strings are Chromium's.
4. **The per-entity encryption details of Chromium's Nigori** (key-bag layout, key-name
   derivation, which types use which key). I verified Brave *uses* `Nigori::CreateByDerivation`
   and that `EncryptableUserTypes()` force-enables DEVICE_INFO/HISTORY/AI_CHAT_CONVERSATION;
   I did not read Chromium's `nigori.cc`.
5. **`BUILDFLAG(BRAVE_SERVICES_KEY)`'s value** — a build-time secret, default `""`.
6. **The rotating word's presentation surface** ("Brave's published page"). The recon's claim
   of a published page is **not supported by the source**: the word is computed locally from a
   hard-coded 2022-05-10 epoch and the BIP39 wordlist. Any Brave help page that shows "today's
   word" is a convenience page, not a dependency. Treat the recon's "published page" wording as
   a UX observation, not a protocol element.
7. **Live server behaviour** — no requests were made. Everything in §3/§5 about the server is
   read from `brave/go-sync` source, not observed traffic.
