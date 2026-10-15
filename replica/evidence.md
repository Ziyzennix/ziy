# Evidence index — every source behind the Ziy replica

One row per evidence source in the project. This is the index a reader checks **before** trusting
any claim in `recon.md`, `architecture.md`, `features.csv`, or any `proofs-*.md`.

**Confidence classes** (two axes: how it was obtained, and how far it can be pushed):

| class | meaning |
| --- | --- |
| **OBSERVED (behavioral)** | Driven against the user's own Brave Origin install over its own CDP endpoint, or driven against Ziy's own build; the claim was seen, not deduced. |
| **OBSERVED-SOURCE** | Read from Brave's public MPL-2.0 source (`brave/brave-core`, `brave/go-sync`, `brave/adblock-lists`, `brave/adblock-rust`) with a quoted file path and line range. Public code read **for understanding only** — Ziy's implementation is clean-room from the behavior contracts. |
| **OBSERVED-INSTALL** | Read out of the on-disk install / the user's own profile (their data, read-only) or captured from its running UI. |
| **DOC-INFERRED** | Taken from Brave's public documentation (help center, marketing pages). Describes the intended product; can be stale or outranked by an OBSERVED row. |
| **BUILT-EXERCISED** | A Ziy artifact that was actually run and asserted on this machine. |
| **INFERRED** | Derived by reasoning from the above; no direct observation. |

Every row is dated. Where a document contradicts another, the higher class wins and the
contradiction is recorded in `recon.md` (struck through in place, with the correction beside it).

---

## Index

| file | what it proves | method | date | confidence |
| --- | --- | --- | --- | --- |
| `recon.md` | The clean-room record: 52 screens, 29 flows, 22 inferred entities, engine stance, out-of-scope list, feature-matrix pointer. Upgraded in place by the behavioral and source passes (contradicted claims struck through). | docs | 2026-10-14 (corrected same day) | DOC-INFERRED, with every updated claim marked OBSERVED (behavioral) / OBSERVED-SOURCE / INFERRED |
| `recon-behavior.md` | Behavioral pass over the user's own install: 31 OBSERVED / 5 CONTRADICTED / 1 PARTIAL / 1 STILL-INFERRED. Corrects cookie control to 2 states, "Simple vs Advanced view" to a single view + "Advanced options" disclosure, absent pages to 9, `brave://sync` → `chrome://settings/braveSync`, per-site override also settable from Settings, ShieldRule storage as one int ControlType exception per protection type, NTP stats exact strings and units, `settings/braveShields` row order. Also records what could NOT be observed (the Shields panel is browser-chrome React WebUI, not a CDP `page` target). | behavioral CDP | 2026-10-14 | OBSERVED (behavioral) |
| `screens/MANIFEST.md` | 9 of 12 target brave:// pages exist on this install (NTP, shields, settings, history, downloads, bookmarks, extensions, version, settings/system) and 3 genuinely do not (rewards, wallet, leo) — each verified by live DOM (`location.href`, `document.title`, body text), not by a blank image. Records the honest misses: Brave's own `--screenshot` flag hangs, Playwright cannot finish Brave's chrome-UI init. | behavioral CDP + screenshots | 2026-10-14 | OBSERVED (behavioral) |
| `screens/*.png` (9 files) | Real captures of Brave's own UI at 1440×900 (design references only, never shipped): `brave.png` (NTP with STATS widget), `shields-panel.png`, `settings-main.png`, `sync.png`, `history.png`, `downloads.png`, `bookmarks.png`, `extensions.png`, `version.png`. | behavioral CDP | 2026-10-14 | OBSERVED-INSTALL |
| `screens/behavior/*.png` (4 files) | Second behavioral pass: `ntp.png` (fresh profile, stats all zero), `ntp-after-visit.png` ("2 Trackers & ads blocked"), `site-guardian.png` (Shields up, scripts allowed), `settings-shields-status-added.png` (`theguardian.com` under "Shields Down" after driving the add flow). | behavioral CDP | 2026-10-14 | OBSERVED (behavioral) |
| `brave-prefs-notes.md` | The user's own profile's Preferences shape: 74 top-level keys, 2 926 leaf keys, `brave_shields` holds P3A counters only, `braveShieldsMetadata` ~96 farbling tokens, zero actual Shields overrides, no Rewards/Wallet/Leo keys at all — independent confirmation the install lacks those features. | install data (read-only) | 2026-10-14 | OBSERVED-INSTALL |
| `proofs.md` | The engine facts the whole design rests on: Firefox 156.0.1 at `/usr/bin/firefox`, MV3 key support matrix (`sidebar_action` ✓, `storage` manifest key ✗, `externally_connectable` ✗, `user_scripts` MV2-only), DNR semantics and ruleset precedence, blocking `webRequest`. | docs + local binary strings | 2026-10-14 | OBSERVED-INSTALL (binary) / DOC-INFERRED (MDN) |
| `proofs-shell.md` | Workstream 1 (shell) verified: app dir layout, prefs/locks, branding, launcher, profile bootstrap, verify harness — all exercised against the installed Firefox 156.0.1. | built + exercised | 2026-10-14 | BUILT-EXERCISED |
| `proofs-ntp.md` | Workstream 3 (NTP) verified: the built `extensions/ziy-ntp` behavior against Gecko 156.0.1 in `build/ziy/`, including the shields-stats contract (real zeros, honest "shields absent" state rather than a fake cross-extension read). | built + exercised | 2026-10-14 | BUILT-EXERCISED |
| `proofs-pkg.md` | Workstream 4 (packaging) verified: `package.json`, build scripts, the zpxi token generator, `extensions/ziy-shell/`, and that built XPIs install into the Ziy app dir. Also the record of the install/data facts about the on-disk install tree (`.pak` file names and sizes read as structure, never unpacked). | built + exercised + install data | 2026-10-14 | BUILT-EXERCISED / OBSERVED-INSTALL |
| `proofs-sync.md` | Workstream 5 (sync) verified: 67/67 unit tests pass and the two-device end-to-end proof passes, against the real protocol read from `re-deep-sync.md`. | built + exercised | 2026-10-14 | BUILT-EXERCISED |
| `proofs-shields.md` | Workstream 2 (shields) verified: the filter-list parser, the DNR rule compiler (static/dynamic tiers and caps), and the Shields precedence model — including the per-site-override rule that an unchosen row stays absent rather than frozen, so a later global change inherits cleanly. | built + exercised | 2026-10-14 | BUILT-EXERCISED |
| `re-deep-shields.md` | Source-of-record for everything Shields: `braveShieldsMetadata` has exactly one field (`farbling_token`, 32 uppercase hex); the `ControlType` enum `ALLOW=0, BLOCK=1, BLOCK_THIRD_PARTY=2, DEFAULT=3`; the content-setting bucket names; per-row mode enums; the panel's fixed row order and exact label strings; the two adblock engines and the live default-list catalog with URLs; update cadence (~100 min) and `engine0.dat`/`engine1.dat` caching; the farbled-API list (19 `brave-webcompat-*` targets) with balanced/maximum behavior. | source code (brave-core, MPL-2.0) | 2026-10-14 | OBSERVED-SOURCE |
| `re-deep-core.md` | How the product is actually assembled: the ~180-flag inventory and desktop defaults (`kAdblockOnlyMode` ON on desktop, `kBlockAllCookiesToggle` iOS-only, `kBraveShowStrictFingerprintingMode` OFF, `kBraveShredFeature` mobile-only, `enable_brave_talk = !is_brave_origin_branded`), all pref names/defaults, wallet keyring prefs, rewards/ads/VPN/sync/news/playlist flag defaults. The shallow clone quoted against is HEAD `436c2286` (2026-10-12), byte-identical to the raw-fetched copies. | source code (brave-core, MPL-2.0) | 2026-10-14 | OBSERVED-SOURCE |
| `re-deep-sync.md` | The real Brave Sync protocol: the 24 words are the raw 32-byte entropy (BIP39 only, no PBKDF2, no BIP39 seed); the whole key tree is one HKDF-SHA512 → Ed25519 signing key with `info="sync-auth-key"`; the 25th word is stripped before any crypto and gates join time only; records are encrypted with **Chromium's** Nigori cipher (AES-256-GCM), not Brave's XSalsa20-Poly1305; `device_id` is the Ed25519 pubkey hex; auth is `base64(timestamp\|signature\|pubkey)` verified against `NetworkTimeTracker` time, ±1 day; single `POST /command/` at `https://sync-v2.brave.com/v2`; the synced-type set and default-on (bookmarks + passwords + AI chat); what the server can and cannot see. | source code (brave-core + brave/go-sync, MPL-2.0) | 2026-10-14 | OBSERVED-SOURCE |
| `re-deep-sync.assets.md` | Provenance for the sync source: exact `git clone --filter=blob:none` commands, the sparse-checkout set, the blob-limit workaround, and the 36 raw files fetched. | source code (provenance record) | 2026-10-14 | OBSERVED-SOURCE (provenance) |
| `features.csv` | The feature matrix: 193 rows, 9 columns (`feature, area, priority, platforms, original, clone, status, ziy_feature, notes`), 29 areas. Distinct `original` values: `yes` (142) and `partial` (51). The 51 `partial` rows are every News, Wallet, Talk, Playlist and VPN row — absent from the observed Origin build while present in the full product. Leo rows are deleted (Leo is not shippable by this clone). | derived matrix, reconciled against OBSERVED evidence | 2026-10-14 | DOC-INFERRED, reconciled to OBSERVED (behavioral) for the `original` column |

## How to read a contradiction

`recon.md` was written first, from help-center documentation only. Two later passes — one
behavioral (`recon-behavior.md`) and three source-level (`re-deep-*.md`) — contradicted parts of it.
The rule applied throughout:

1. **OBSERVED (behavioral)** beats **OBSERVED-SOURCE**, which beats **DOC-INFERRED**.
2. A contradicted claim is **never silently deleted**. It is struck through in place
   (`~~wrong claim~~`) with the correction and its confidence class beside it.
3. Where a claim could not be observed at all (the Shields panel's own rendering, the
   per-site request counts under a control load), it stays marked STILL-INFERRED and the miss is
   recorded, rather than being smoothed into an observation.

## Not evidence (explicitly)

- No JS bundle was decompiled or read; no `.pak` was unpacked; no network traffic was logged; no
  Brave account was used. Pak files were read for **file names and sizes only**, and the
  user's own Preferences only ever read.
- Ziy's own code, labels and design are clean-room: the `re-deep-*` documents are the
  documentation of record for *what* Brave does, never a copy target for *how* Ziy does it.
