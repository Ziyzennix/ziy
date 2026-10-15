# Recon map: Brave Browser (Linux desktop)

Scope: "Everything Brave owns" — Brave Shields, Brave Search, Brave Talk, Brave Firewall + VPN, Brave Wallet, Brave Leo, Brave Rewards/BAT + privacy-preserving ads, Brave News, Brave Playlist, Tor/private windows, Brave Sync, profiles, plus core browser UX (tabs, tab groups, bookmarks, history, downloads, extensions, settings, permissions, find bar, sidebar). Engine-level facts (Mojo, brave://flags, Skia, SwiftShader) are recorded as clone behavior targets only — see "Engine stance".
For: an independent Linux desktop browser clone built on the Gecko engine.
Date: 2026-10-14

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Brave Help Center — full feature list | https://support.brave.com/hc/en-us/articles/15872271230221-What-are-all-the-features-Brave-Browser-offers | Primary/Additional/Standard feature taxonomy; the spine of the feature matrix. Updated Feb 2026. |
| 2 | Brave Help Center — Quickstart | https://support.brave.com/hc/en-us/articles/360035410812-Quickstart-guide-New-to-Brave-Start-here | Onboarding/Welcome Tour steps, Rewards, Creators. |
| 3 | Brave Help Center — Shields while browsing | https://support.brave.com/hc/en-us/articles/360022806212-How-do-I-use-Shields-while-browsing | Shields panel anatomy, blocked-item counts, fingerprinting sub-toggles, "Forget me when I close this site". |
| 4 | Brave Help Center — global/site-specific Shields | https://support.brave.com/hc/en-us/articles/360023646212-How-do-I-configure-global-and-site-specific-Shields-settings | Simple vs Advanced view, per-site override precedence. |
| 5 | Brave Shields marketing page | https://brave.com/shields/ | SugarCoat resource replacement, CNAME uncloaking, ephemeral storage, Standard vs Aggressive. |
| 6 | Brave Help Center — Chromium removals | https://support.brave.com/hc/en-us/articles/10742158329613-What-does-Brave-remove-from-the-Chromium-engine | Engine-level deviations: cookie lifetimes, referrer cap, fingerprint randomization list, disabled APIs. Architecture context only. |
| 7 | Brave Help Center — New Tab Page | https://support.brave.com/hc/en-us/articles/360040912932-How-do-I-customize-my-New-Tab-Page | NTP dashboard widgets: background, search, top sites, news, clock, cards, NTP ads. |
| 8 | Brave Help Center — Top Sites | https://support.brave.com/hc/en-us/articles/360057909891-How-do-I-Customize-Top-Sites-on-the-New-Tab-Page | Favorites vs Frequently Visited, tile counts, add/edit/remove/reorder. |
| 9 | Brave Help Center — Brave News | https://support.brave.com/hc/en-us/articles/360056341952-How-do-I-use-Brave-News | Sources, channels, RSS, "open links where" setting. |
| 10 | Brave Help Center — Sidebar | https://support.brave.com/hc/en-us/articles/5181998802061-How-do-I-use-Brave-Sidebar | Sidebar items (Leo, Wallet, Talk, Bookmarks, custom sites), modes, reorder. |
| 11 | Brave Help Center — Leo | https://support.brave.com/hc/en-us/articles/20958609786637-How-do-I-use-Brave-Leo | Opt-in, sidebar + full page (`brave://leo-ai`), model picker, Premium/BYOM. |
| 12 | Brave Help Center — Leo models | https://support.brave.com/hc/en-us/articles/26727364100493-What-are-the-differences-between-Leo-s-AI-Models | Free vs Premium model lists, rate limits, unlinkable subscription tokens. |
| 13 | Brave Help Center — Sync setup | https://support.brave.com/hc/en-us/articles/360021218111-How-do-I-set-up-Sync | Sync chain, 24-word code (+25th rotating word), QR, syncable categories. |
| 14 | Brave Help Center — Rewards contributions | https://support.brave.com/hc/en-us/articles/360021123971-How-do-I-make-contributions-to-websites-and-content-creators-with-Brave-Rewards | BAT icon in URL bar, verified creator checkmark, on-demand vs recurring, auto-contribute removed in 1.75x. |
| 15 | Brave Help Center — Rewards FAQ | https://support.brave.com/hc/en-us/articles/360027276731-Brave-Rewards-FAQ | Ads + contributions composition, custodial vs self-custody linking, restricted jurisdictions. |
| 16 | Brave Help Center — Brave Ads FAQ | https://support.brave.com/hc/en-us/articles/360026361072-Brave-Ads-FAQ | On-device matching, anonymous-but-accountable confirmations, notification-ad ceiling, NTP ads. |
| 17 | Brave Help Center — Wallet FAQ | https://support.brave.com/hc/en-us/articles/4415497656461-Brave-Wallet-FAQ | Chains, `window.ethereum` provider choice in brave://settings/web3, on-ramps, self-custody. |
| 18 | Brave Help Center — Wallet features | https://support.brave.com/hc/en-us/articles/14380262951053-What-features-are-available-in-Brave-Wallet | Per-platform feature grid: swaps, NFT gallery, hardware wallets, market data. |
| 19 | Brave VPN / Firewall + VPN page | https://brave.com/firewall-vpn/ | Pricing ($9.99/mo, $99.99/yr, 7-day trial), 300+ servers/40+ regions, 10 devices, killswitch, Guardian backend. |
| 20 | Brave Help Center — Brave Talk | https://support.brave.com/hc/en-us/articles/4409911923261-How-do-I-use-Brave-Talk- | Jitsi-based, free 1:1, Premium $7/mo for 3+, control bar, security options, VBE. |
| 21 | Brave Help Center — Playlist | https://support.brave.com/hc/en-us/articles/360060768611-How-do-I-use-Brave-Playlist | Nightly-only on desktop, add-to-playlist prompt, playback controls, settings. |
| 22 | Brave Help Center — Private windows | https://support.brave.com/hc/en-us/articles/360017840332-What-is-a-Private-Window | What is and isn't saved; bookmarks/downloads persist. |
| 23 | Brave Help Center — Tor windows | https://support.brave.com/hc/en-us/articles/360018121491-What-is-a-Private-Window-with-Tor-Connectivity | Tor-as-proxy model, disabled APIs, shared global state caveats. |
| 24 | Brave Help Center — built-in extensions | https://support.brave.com/hc/en-us/articles/360035025231-What-extensions-are-built-into-Brave | Settings → Extensions: Google login, Hangouts, Media Router, Widevine, Manage, Shortcuts. |
| 25 | Brave Help Center — keyboard shortcuts | https://support.brave.com/hc/en-us/articles/360032272171-What-keyboard-shortcuts-can-I-use-in-Brave | Full Linux shortcut table; customizable in Settings → System → Shortcuts. |
| 26 | Brave Help Center — import/export data | https://support.brave.com/hc/en-us/articles/360019782291-How-do-I-import-or-export-browsing-data | Import from detected browsers, CSV password import, HTML bookmark export. |
| 27 | Brave Help Center — Brave Search | https://support.brave.com/hc/en-us/articles/4403624081805-How-do-I-use-customize-Brave-Search | Result filters, settings panel, Goggles, !bangs, discussions, fallback mixing. |
| 28 | brave/brave-core public source (MPL-2.0) | https://github.com/brave/brave-core | Read for understanding via raw.githubusercontent.com + shallow clone. The source-of-record citations for every mechanism claim — see "Source-level evidence" below. |
| 29 | `replica/recon-behavior.md` | local | Behavioral pass over the user's own Brave Origin 1.95.104 install driven over its own CDP endpoint. OBSERVED. |
| 30 | `replica/re-deep-*.md` | local | The four source-level studies (`re-deep-shields.md`, `re-deep-core.md`, `re-deep-sync.md`, `re-deep-sync.assets.md`). OBSERVED-SOURCE. |

Method note: the help-center pages (rows 1–27) were fetched with plain HTTP GET at human reading pace (one page per request, no crawler). No JS bundles were read, no binary decompiled, no network traffic logged, no account used. The later passes (rows 28–30) are behavioral CDP against the user's own install, plus reads of Brave's public source — full index and confidence classes in `replica/evidence.md`.

## Core loop

A privacy-paranoid user opens a new tab (Shields already on by default, NTP showing no third-party trackers), browses with per-site controls one click away in the lion panel, and optionally earns BAT / talks / asks Leo without any data leaving the device — the product is "the browser that protects you by default and gives the controls back if you want them".

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | First-run / Welcome Tour | automatic on first launch | import data, pick default search engine, theme, enroll Rewards | multi-step tour card, import picker, skip | skipped, completed, import failed |
| S02 | New Tab Page (NTP) | new tab / Ctrl+T | start page with widgets | background image, search box, top sites tiles, NTP cards, Brave News feed, clock, Talk camera icon, NTP ad | empty (all widgets off), filled, sponsored-image on every 4th tab |
| S03 | NTP customize dashboard | gear icon top-right of NTP | toggle widgets | toggles for background/search/top sites/news/clock/cards; NTP ad toggle | open, closed |
| S04 | NTP background picker | NTP customize → Background Image | choose background | source picker (own / Brave / solid / gradient), refresh-on-new-tab, show-ads toggle | selected, blank gradient, custom upload |
| S05 | Top sites widget (Favorites) | NTP top sites widget → dropdown | curated shortcuts | tile grid (6→12/24), pager, Add Site dialog, drag reorder, right-click edit/remove | empty, one page, multi-page, Frequently-Visited mode (auto, no manual add) |
| S06 | Browser window / tab strip | always | browse | tab strip, tab groups, pinned tabs, vertical tabs option, toolbar, address bar, Lion icon, BAT icon, VPN icon, Wallet icon, sidebar rail | loading, loaded, error page, Tor-styled, private-styled |
| S07 | Shields panel (site) | Lion icon in address bar | per-site protection state + controls | Shields up/down toggle, domain + block count, ~~Simple vs Advanced view~~ **OBSERVED (behavioral): a single view with an "Advanced options" disclosure button**, Advanced controls button | ~~Simple (read-only) view, Advanced view~~ **OBSERVED: single view; Advanced-options disclosure; Shields down (grey icon)** |
| S08 | Shields panel — Advanced view | S07 → Advanced controls | per-site overrides | Block ads & trackers (Standard/Aggressive), HTTPS upgrade, Script control, ~~Cookie control (3 states)~~ **OBSERVED (behavioral): 2 states — Block third-party cookies / Allow all cookies**, Block fingerprinting (+ sub-toggles), Forget me on close, Filter Lists, Global Defaults | default-inherited, overridden, per-fingerprint toggled off |
| S09 | Blocked items list | click the count next to a Shields row | show what was blocked | scrollable list of blocked trackers/scripts | empty (0 blocked), populated |
| S10 | Global Shields settings | Menu → Settings → Shields | default protections for all sites | same rows as S08 | factory defaults, user-modified |
| S11 | brave://adblock (filter lists) | S08 → Filter Lists | manage filter lists | enable/disable/add custom list | default lists, custom added, empty |
| S12 | Element blocker ("block elements on this page") | Shields panel → block element tool | hide page elements by click | element picker overlay, create rule dialog | picking, rule saved, rule list |
| S13 | Main menu | hamburger / Alt+F | app-level entry | New tab/window, private window, Tor window, Zoom, Find, Print, Cast, History, Downloads, Bookmarks, Brave Sync, Wallet, Talk, Playlist, Leo, Settings, Help | closed, open, "Show All" expanded |
| S14 | Find bar | Ctrl+F | in-page search | input, match count, prev/next, case toggle, highlight | open, no matches, wrap-around |
| S15 | Permissions bubble | triggered by a site permission request | grant/deny | origin, allow/deny, "always allow" style options, geolocation high-accuracy note | camera, mic, location, notifications, clipboard, multiple-requests |
| S16 | Site details / connection popup | click the padlock area of the address bar | connection info | HTTPS state, certificate, site settings shortcut | secure, insecure, certificate error, connection help |
| S17 | Downloads shelf + brave://downloads | auto-shelf on download / Ctrl+J | manage downloads | file row, progress, pause/resume, open folder, malware warning | in progress, complete, failed, blocked |
| S18 | History page | Ctrl+H | browse history | search box, day groups, delete, clear browsing data link | empty, populated |
| S19 | Bookmarks manager | Ctrl+Shift+O | organize bookmarks | folder tree, import, export, add folder, search | empty, nested, imported |
| S20 | Bookmarks bar | Ctrl+Shift+B to toggle | quick access | folder + item rows, drag-to-reorder, "show other bookmarks" | hidden, shown, overflow |
| S21 | Settings (shell) | Menu → Settings | configure everything | left nav sections (Appearance, Shields, Privacy, Sync, Leo, Wallet, News, Playlist, Extensions, System, Search, etc.), search box | loading, section, search filtered |
| S22 | Settings → Appearance | Settings nav | chrome look | themes, night mode, show bookmarks bar, Sidebar mode, show tab count / vertical tabs, Leo AI Assistant toggle | default, customized |
| S23 | Settings → Privacy & Security | Settings nav | privacy knobs | clear browsing data options, Do Not Track, safe browsing, secure DNS, certificates, social-media blocking | default, hardened |
| S24 | Settings → System → Shortcuts | Settings nav | rebind keys | command list, edit shortcut per command | default, customized |
| S25 | Extensions manager | Menu → Settings → Extensions (or brave://extensions) | manage built-ins + add-ons | allow Google login, Hangouts, Media Router, Widevine, Manage Extensions, Keyboard Shortcuts per extension; details panel, enable/disable, remove, incognito toggle | no extensions, several, details open |
| S26 | Profile picker / profile menu | Ctrl+Shift+M / avatar on titlebar | switch identity | profile list, add profile, guest mode, sign-out | single profile, many, guest |
| S27 | Brave Sync page | Menu → Brave Sync | chain management | Start a new chain / Enter a chain code, QR code, 24-word code, Categories toggles, Add another device, Remove this device, Leave Sync Chain, Delete Sync account | not syncing, chain active, connected devices list |
| S28 | Brave Rewards panel | BAT icon in URL bar / brave://rewards | earnings + tipping | balance, monthly est. earnings, Ads panel, contribution panel, verified-creator checkmark, tip amount, recurring toggle | not enrolled, enrolled-unlinked, connected, flagged |
| S29 | Brave Ads notification | OS notification (if enabled) | ad delivery + earn | notification card, thumb, dismiss/learn-more | delivered, dismissed, expired |
| S30 | NTP sponsored image | on every 4th new tab when enabled | branded background + earn | sponsored background with brand logo + info link | shown, opted out |
| S31 | Brave Search results page | search.brave.com / default engine | search | results, image/news/video tabs, date+location filters, safe search, settings menu, Goggles, !bangs, discussions cluster, AI answer | no results, mixed fallback, filtered |
| S32 | Brave Search settings | results page menu → See all settings | search prefs | display language, region, theme, safe search, answer with AI, open in new tab, units, anonymous local results, discussions, Google fallback mixing, anonymous usage metrics | defaults, customized |
| S33 | Leo sidebar panel | sidebar Leo icon / "Ask Leo" in address bar | AI chat | model picker, 3-dot settings menu, prompt box, send, expand to full page, page-context chip | first-run opt-in, empty chat, streaming, error, temporary chat |
| S34 | Leo full page | brave://leo-ai | dedicated chat workspace | same as S33, full width, chat history list | empty, history, expanded from sidebar |
| S35 | Settings → Leo | Settings nav | Leo config | default model, autocomplete, clear Leo data, tab focus opt-in | default, customized, history cleared |
| S36 | Brave Wallet panel | Wallet icon in toolbar / sidebar | crypto | Portfolio, accounts per chain, send/receive, swap, buy (on-ramp), NFT gallery, market tab, locked/unlock | locked, unlocked, importing, no accounts |
| S37 | Wallet onboarding / restore | first Wallet open / restore from lock screen | create or import | create wallet flow, recovery phrase backup, import (BIP39), lock screen, hardware-wallet connect | create, restore, locked, wrong passphrase |
| S38 | Wallet settings (web3 provider) | brave://settings/web3 | choose `window.ethereum` provider | radio list (Extensions fallback / Brave Wallet / Crypto Wallets deprecated / Extensions no fallback) | default, changed (needs restart) |
| S39 | Brave Talk call | NTP camera icon / talk.brave.com | video meeting | control bar: mute, camera, screen share, chat, raise hand, participants, tile view; advanced actions; owner-only security options | pre-meeting screen, in-call, lobby waiting, disconnected, recording |
| S40 | Talk settings | in-call Settings (devices/profile/sounds/more) | call prefs | device pickers, display name + gravatar, sounds, pre-meeting screen, shortcuts, language, frame rate, moderator controls | default, customized |
| S41 | VPN / Firewall panel | VPN icon in address bar → expand | tunnel control | connect toggle, region list (300+ servers / 40+ regions), subscription state, killswitch note | disconnected, connecting, connected, trial expired |
| S42 | Brave News page | NTP scroll-down / brave://news | read feed | source/channel management, Following list, Popular carousel, search for RSS, open-links-where dropdown | disabled, default sources, custom sources |
| S43 | Brave Playlist | Menu → Playlist (Show All…) | media queue | add prompt in address bar, item list, reorder, player controls (play/pause, ±15s, speed, sleep timer, PiP, fullscreen) | empty, has items, playing, Nightly-only on desktop |
| S44 | Private window | Menu → New private window / Ctrl+Shift+N | no-history session | private-styled chrome, banner, downloads still saved | empty, active |
| S45 | Private window with Tor | Menu → New private window with Tor | anonymized proxy session | Tor connect status, onion-indicator, bridges config, reduced feature set | connecting, connected, disconnected, blocked network |
| S46 | Tor bridges config | Tor window → bridges | censorship circumvention | built-in bridge list, custom bridge field, request bridges | no bridges, custom |
| S47 | Page info / Speedreader | reader-mode entry | decluttered reading | reader view, font/width controls | extracted, fallback to page |
| S48 | Clear browsing data dialog | Ctrl+Shift+Delete | wipe data | time range, data type checkboxes, per-site cookie clearing | default, advanced tab |
| S49 | Password manager | brave://password-manager | credentials | save prompt bubble, list, export/import CSV, settings | empty, populated, import |
| S50 | Autofill settings | Settings → Autofill | form data | addresses, payment methods, toggles | empty, populated |
| S51 | New Tab Page cards | NTP card widget | Brave's own NTP cards | card list, disable all | shown, hidden |
| S52 | Split view / Web Apps / Containers | toolbar / sidebar / tab menu | layout + identity features | split-view toggle, web app shortcut install, container tabs | off, active |

**Panel anatomy limitation (S07–S09).** The Shields panel is a React/Leo WebUI rendered as browser chrome, not a web content target, so it is **not observable via CDP** — `/json/list` never exposes it as a `page` target and no keyboard path to it exists in this build. Its anatomy above therefore remains **INFERRED** except where marked **OBSERVED (behavioral)**; the observed facts about it (row order, label strings, the "Advanced options" disclosure, the counter cap at 99+) are documented in `recon-behavior.md` §shields-panel-anatomy from the install's own shipped strings plus the public source. The blocked-items list (S09) is separately recorded as STILL-INFERRED for the same reason.

**S02 NTP stats widget — OBSERVED (behavioral), exact strings.** The widget's own label is the uppercase `STATS`, then exactly three rows, in this order, with these exact strings and units (from `brave://newtab` `innerText`): `Trackers & ads blocked` (single combined ad+tracker counter — no separate tracker and ad numbers), `Bandwidth saved` (value `N <span class=units>kB</span>` — **kB**, not "KB"), `Time saved` (value `N <span class=units>seconds</span>` — lowercase, seconds). DOM classes `.ads-blocked`, `.bandwidth-saved`, `.time-saved`, `.ntp-widget[data-theme]`. Cumulative across sessions: 0 before a page load, 2 after one Guardian load. See `recon-behavior.md` §1 and §6.

**brave:// pages on this Origin build — CONTRADICTED and corrected.** ~~3 known-absent pages (rewards, wallet, leo-ai)~~ → **9 absent** in this build: rewards, wallet, leo-ai, news, playlist, talk, vpn, rewards-internals, ads-internals — each resolves to `chrome-error://chromewebdata/` (`ERR_INVALID_URL`). **OBSERVED (behavioral)** by loading each URL over CDP. Present and resolving: settings (+ shields/privacy/appearance/system/extensions/search/braveContent subpages), downloads, history, bookmarks, extensions, flags, version, welcome, password-manager, newtab. `brave://sync` **does not exist as a standalone page**: it resolves to `chrome://settings/braveSync`, a settings route (`/braveSync` in the nav). Brave Talk is **build-flag-gated out of Origin-branded builds** (`enable_brave_talk = !is_brave_origin_branded`, `re-deep-core.md` §1.6); News/Playlist/VPN/Wallet/Leo are flag-or-channel gated in this build (Playlist is desktop-Nightly, `kPlaylist` default OFF on desktop). Full inventory table: `recon-behavior.md` §brave://pages inventory.

## Flows

```
F01 First run: install, import, and reach a protected first page
    S01 -> (import from detected browser) -> pick default search engine + theme -> S02
    happy path clicks: 4-6 (skip tour: 1)
    edge: import source not detected; Safari import needs macOS full-disk access; password import from Chrome must be done manually via CSV; user skips tour entirely

F02 Browse with Shields up and read what was blocked
    S02 -> type URL -> S06 -> click Lion (S07) -> read block count -> click the count (S09)
    happy path clicks: 3
    edge: Shields down for this site persists; count resets on navigation/reload; ~~Simple view is read-only except Shields up/down~~ **OBSERVED (behavioral): the panel is a single view whose "Advanced options" disclosure exposes the same rows as S08; only the Shields up/down toggle lives in the top-level view**

F03 Turn Shields down for one broken site, then restore defaults
    S06 -> S07 -> toggle Shields down -> site works -> optionally "Report a broken site"
    happy path clicks: 2
    edge: forgets later; other sites unaffected; report flow depends on network

F04 Per-site override a single protection (script blocking)
    S07 -> Advanced controls (S08) -> Script Control off -> reload
    happy path clicks: 3
    edge: Advanced view exposes the same rows as global Shields; first visit inherits global defaults; per-site override survives later global changes
    **OBSERVED (behavioral):** the same override is also settable from Settings (`chrome://settings/content/braveShields`, headers "Shields Up"/"Shields Down"), not only from the address-bar panel. The write is one content-settings exception per protection type — see the ShieldRule correction in the data model.

F05 Block a page element by hand
    S06 -> element blocker -> click the element -> confirm -> rule saved
    happy path clicks: 3
    edge: rule lost if the page structure changes; multiple rules accumulate

F06 Manage filter lists (add/remove custom)
    S08 -> Filter Lists (S11) -> toggle/list -> add custom URL
    happy path clicks: 3
    edge: bad list URL; list needs fetch; conflicts between lists

F07 Set global Shields defaults once
    S10 -> change rows -> leave settings (auto-saved)
    happy path clicks: 2
    edge: existing per-site overrides are not rewritten

F08 Customize the New Tab Page
    S02 -> S03 -> toggles -> S04 background -> S05 top sites mode
    happy path clicks: 4
    edge: background ads still show when "Show new tab page ads" is on; every 4th tab carries a sponsored image

F09 Curate Favorites top sites
    S05 -> Add Site -> name + URL -> Save -> drag to position
    happy path clicks: 4
    edge: Favorites and Frequently Visited keep independent lists; >24 tiles paginate

F10 Read Brave News and tune sources
    S02 scroll -> S42 -> add source via + -> add channel -> add RSS via search -> set open-links-where
    happy path clicks: 5
    edge: sources must be discoverable; ranking anonymized/locally curated; feed disabled hides NTP section

F11 Start a Brave Talk call and invite people
    S02 camera icon -> S39 -> copy link from address bar -> share
    happy path clicks: 2
    edge: 3+ participants needs Premium ($7/mo); lobby/passcode/VBE are owner options; recordings deleted 24h after call

F12 Ask Leo about the current page
    S06 -> "Ask Leo" in address bar (or sidebar Leo) -> S33 -> type prompt -> send
    happy path clicks: 3 (first run: +1 opt-in)
    edge: opt-in gate before any data is processed; tab focus requires explicit opt-in; model picker can switch mid-chat; BYOM needs own API key

F13 Move a Leo chat to the full-page workspace
    S33 -> expand icon -> S34 (or type in address bar -> "Ask Leo")
    happy path clicks: 1
    edge: chat history stays local; temporary chats; "Clear Leo data" in Settings

F14 Create a Brave Wallet and receive crypto
    S36 -> create -> save recovery phrase -> account address -> copy/share address
    happy path clicks: 4
    edge: restore overwrites existing wallet; hardware wallet needs updated firmware + blind signing; wrong mnemonic scheme (legacy 24-word non-BIP39) gives a different address

F15 Swap and send from the wallet
    S36 -> select account -> Send/Swap -> amount -> review -> confirm
    happy path clicks: 5
    edge: gas fees; 0x/Jupiter routing; on-ramp availability varies by country

F16 Connect a wallet to a dApp
    site requests window.ethereum -> S38 choice -> approve session in S36
    happy path clicks: 3
    edge: only one provider may expose window.ethereum; changes need a restart; Crypto Wallets option is deprecated

F17 Enable Brave Rewards and earn from ads
    S28 -> enable Rewards -> link custodial account or self-custody wallet -> opt into ad formats
    happy path clicks: 5
    edge: eligibility varies by jurisdiction; unlinked account cannot contribute; recurring contributions require custodial linking; profile can be flagged

F18 Tip a verified creator (on-demand contribution)
    visit verified site -> click BAT icon (S28) -> blue check shown -> Contribute -> amount -> Send BAT
    happy path clicks: 4
    edge: site not verified = no contribution panel; recurring toggle for monthly (custodial only); auto-contribute was removed in 1.75x

F19 Subscribe to Brave VPN and connect
    S41 -> Start free trial / subscribe -> connect -> pick region
    happy path clicks: 4
    edge: Linux support is "coming soon" in Brave's own copy; 10-device limit; region choice affects speed; killswitch always on for Windows

F20 Set up Sync across two desktops
    S27 -> Start a new sync chain -> choose Computer -> copy 24-word code -> enter on second device -> wait for chain
    happy path clicks: 6
    edge: words alone now need a rotating 25th word from Brave's published page; mobile join uses QR; leaving the chain deletes the server cache; deleting the account is irreversible

F21 Open a Tor window when a site blocks normal browsing
    S13 -> New private window with Tor -> S45 -> browse -> (optionally set bridges in S46)
    happy path clicks: 3
    edge: slow; some sites demand captchas; several APIs disabled (geolocation, WebRTC, WebShare, media router, plugins); bookmarks/global settings written in a Tor window leak into normal windows

F22 Clear cookies for one site, or everything on exit
    S48 -> range + types -> clear; or Shields "Forget me when I close this site"
    happy path clicks: 3
    edge: permanent; no undo

F23 Import and export bookmarks/passwords
    S19 -> Import Bookmarks and Settings -> pick browser -> pick data -> Import; Export as HTML
    happy path clicks: 5
    edge: Chrome passwords need a manual CSV round trip

F24 Manage an extension's permissions and shortcut
    S25 -> details -> adjust site access / incognito / shortcut
    happy path clicks: 4
    edge: built-ins (Hangouts, Media Router, Widevine, Google login) are toggles in the same page; shortcuts page only lists extensions that declare commands

F25 Create a second profile (or guest window)
    S26 -> Add profile -> new window -> import or start fresh
    happy path clicks: 3
    edge: each profile has its own data dir; Sync is per-profile

F26 Customize keyboard shortcuts
    S24 -> click a command -> press new keys -> save
    happy path clicks: 3
    edge: conflicts with browser-reserved shortcuts

F27 Add a media item to Playlist and play it
    S43 -> prompt in address bar on a compatible site -> add -> play -> use PiP
    happy path clicks: 3
    edge: desktop availability is Nightly-channel only; media added without cookies; "Reset Playlist" wipes items

F28 Use sidebar panels without leaving the page
    S06 -> sidebar Leo / Wallet / Talk / Bookmarks -> add a site via + -> reorder by drag
    happy path clicks: 3
    edge: modes are Always / On mouseover / Never

F29 Grant a permission for one visit
    S15 appears -> Allow -> reload site
    happy path clicks: 2
    edge: geolocation request discloses high-accuracy intent; clipboard needs a gesture; Tor windows deny several by default
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Shields lion button | up (orange), down (grey), with block-count badge | default, hover, active, disabled | S06 |
| Shields panel | ~~Simple view, Advanced view~~ **OBSERVED (behavioral): single view + "Advanced options" disclosure** | open, read-only, overridden | S07, S08 |
| Permission-style toggle row | on/off | default, on, off, indeterminate | S08, S10, S22, S23, S35 |
| Segmented control | 2-3 options (Standard/Aggressive, Favorites/Frequently Visited, light/dark) | unselected, selected | S08, S05, S32 |
| Dropdown setting | ~~Cookie control (3 states)~~ **OBSERVED (behavioral): Cookie control (2 states — Block third-party cookies / Allow all cookies)**, region list, open-links-where | closed, open, selected | S08, S32, S42 |
| Blocked-items count link | numeric, zero/nonzero | clickable, disabled | S07, S09 |
| Address bar / omnibox | with search, with "Ask Leo" suggestion | idle, typing, dropdown, error, Tor, private | S06, S33 |
| Permission bubble | camera, mic, location, notifications, clipboard | requesting, granted, denied, dismissed | S15 |
| URL bar page-info popup | secure, insecure, cert error | expanded, collapsed | S16 |
| New Tab Page widget | background, search, top sites, news, clock, cards | visible, hidden, empty | S02, S03, S51 |
| Top-site tile | favicon + label | default, hover, edit, remove, drag, paged | S05 |
| Tile grid | compact (6), expanded (12x2, paginated) | one page, multiple pages | S05 |
| Add/Edit site dialog | name + URL | open, invalid, saved | S05 |
| Sidebar rail | Leo, Wallet, Talk, Bookmarks, custom sites, add button | expanded, collapsed, mouseover-only | S06, S28, S36, S39 |
| Sidebar panel | Leo chat, Wallet, Talk, Bookmarks tree | empty, filled, loading | S06, S33, S36 |
| Chat message bubble | user, assistant, streaming, error, temporary | sent, streaming, failed | S33, S34 |
| Model picker | free list, premium list, BYOM | automatic, manual, premium-locked | S33, S35 |
| Sync code display | QR code, 24-word code | fresh, used, copied | S27 |
| Sync category toggle | bookmarks, passwords, autofill, history, open tabs, extensions, themes, apps | on, off | S27 |
| Confirm/destructive dialog | leave chain, delete account, reset settings, clear data | open, confirming | S27, S48 |
| Contribution panel | verified, unverified, tip amount, recurring | not enrolled, linked, flagged | S28 |
| Talk control bar | mute, camera, screen, chat, raise hand, participants, tiles | active, muted, camera off, sharing | S39 |
| Talk advanced-actions menu | participant options, owner options | open, owner-only | S39 |
| VPN connect button + region list | connect toggle, region picker | disconnected, connecting, connected, error | S41 |
| Wallet NAV / portfolio row | per-chain asset | loaded, loading, empty, no-network | S36 |
| Recovery-phrase grid | 12/24 words | displayed, hidden, revealed | S37 |
| Find bar | match count, prev/next | open, 0 matches, wrapped | S14 |
| Downloads row | progress, actions | queued, downloading, paused, done, failed, blocked | S17 |
| Toast / notification | OS notification (Talk, ads, download done) | shown, dismissed, expired | S29, S17 |
| Settings section nav | collapsible groups | current, other, search-filtered | S21 |
| Tab strip | horizontal, vertical tab mode, tab groups, pinned tabs | normal, loading, crashed, group-collapsed, private, Tor | S06 |
| Keyboard shortcut editor | command row + capture | idle, capturing, conflict | S24 |

## Settings → Shields (`brave://settings/shields`) — observed row order

**OBSERVED (behavioral), 2026-10-14.** The page is Chromium's Settings shell with Brave pages injected (`settings-ui > settings-shields-page-index > settings-default-brave-shields-page`), reachable at `brave://settings/shields` (resolves to `chrome://settings/shields`). Row order, top to bottom, with the observed control type and options:

1. Section header `braveShieldsTitle` = "Shields"; then the description block ("These are the default Shields settings…").
2. `settings-ad-block-only-mode-alert` — Adblock-Only mode alert (the mode is ENABLED_BY_DEFAULT on desktop).
3. **Stats badge toggle** — "Show the number of blocked items on the Shields icon" (pref `brave.shields.stats_badge_visible`, default true). **Badge toggle comes first.**
4. `select#adControlType` — "Trackers & ads blocking": **Aggressive / Standard / Disabled** (default Standard).
5. `select#httpsUpgradeControlType` — "Upgrade connections to HTTPS": Strict / Standard / Disabled (default Standard).
6. `settings-toggle-button#noScriptControlToggle` — "Block scripts" (a toggle, not a select).
7. `select#fingerprintingSelectControlType` — "Block fingerprinting": Strict, may break sites / Standard / Disabled (default Standard).
8. `select#cookieControlType` — "Block cookies": **Block third-party cookies / Allow all cookies** (default Block third-party) — 2 options, not 3.
9. `settings-toggle-button#forgetFirstPartyStorageControlType` — "Forget me when I close this site".
10. `settings-toggle-button#setContactInfoSaveFlagToggle` — "Store contact information for future broken site reports".
11. `settings-toggle-button#allowElementBlockerInPrivateModeToggle` — "Allow element blocking in private windows".
12. `cr-link-row#contentFiltersRow` — "Content filtering" link.

Subpages, in the view manager's order: `settings-ad-block-only-mode-page` ("Use Adblock-Only mode"), `settings-social-blocking-page` (fb/twitter/linkedin embeds), `adblock-subpage` (developer-mode toggle, filter lists, "Enter filter list URL", custom filters, scriptlets). The global page has **no** "Simple/Advanced view" toggle and **no** "Filter Lists" row of its own — that is the separate adblock subpage. Source: `recon-behavior.md` §shipped-WebUI-structure; the matching enums in `re-deep-shields.md` §2.

Per-site state lives at `chrome://settings/content/braveShields` ("Shields status", allow-header "Shields Up" / block-header "Shields Down"), with add/remove — **OBSERVED (behavioral)**. Note `brave://sync` resolves to `chrome://settings/braveSync`, a settings route rather than a standalone page.

## Inferred data model

```
Profile        id, name, avatar, data_dir, theme, created_at
               evidence: S26 profile picker, "Add profile" flow
               confidence: high (profiles are standard; Brave-specific storage layout is a guess)

ShieldRule     id, first_party_domain, shield_enabled (bool),
               ads_trackers (standard|aggressive|off),
               https_upgrade (auto|strict|off),
               scripts (allow|block), cookies (block_3p|block_all|allow_all),
               fingerprinting (on|off), fp_subtoggles (json),
               forget_me_on_close (bool)
               evidence: S07/S08 rows, S10 global defaults, help article on per-site precedence
               confidence: high for the field set, medium for exact storage names

ShieldRule — storage CORRECTED (OBSERVED-STORAGE behavioral; OBSERVED-SOURCE for the enum names):
~~one JSON rule per site~~ The real storage is **one content-settings exception per protection type
per origin**, each keyed by an origin pattern (`https://[*.]github.com,*`, or `*,*` for the
global default) and carrying `{last_modified, setting}` where `setting` is an **integer
ControlType**: `ALLOW=0, BLOCK=1, BLOCK_THIRD_PARTY=2, DEFAULT=3`. Observed write from the UI:
`"braveShields": {"theguardian.com,*": {"last_modified": "13436434901654895", "setting": 2}}`.
Buckets: `shieldsAds`, `trackers`, `cosmeticFilteringV2`, `httpUpgradableResources`,
`httpsUpgrades`, `javascript`, `fingerprintingV2`, `braveShields`, `braveShieldsMetadata`,
`referrers`, `shieldsCookiesV3`, `braveAutoShred` (plus one `brave-webcompat-*` bucket per
fingerprint sub-toggle). `braveShieldsMetadata` holds exactly one field, `farbling_token`
(32 uppercase hex). Pretty enum names (`standard|aggressive|off`) exist only in the mojom layer
the WebUI talks to. The clone's per-site override model is therefore a matrix of small typed
exceptions, not one rule row. Evidence: `recon-behavior.md` §4/§7; `re-deep-shields.md` §1-§3.

FilterList     id, name, source_url, enabled, is_custom, uuid
               evidence: S11, "manage adblock filters" article
               confidence: high

BlockedItemLog first_party_domain, category (ad|tracker|script|fp), resource_url,
               count, session_reset_on_navigation
               evidence: S09 counts reset on reload/navigation
               confidence: high for behavior, medium for what is persisted (probably nothing)

ElementRule    id, domain, selector, created_at
               evidence: S12 element blocker
               confidence: medium

NewTabPage     profile_id, background_source (own|brave|solid|gradient|off),
               background_refresh_on_new_tab, show_ntp_ads,
               widgets { search, top_sites, news, clock, cards } enabled,
               search_engines_in_widget, top_sites_mode (favorites|frequently_visited),
               clock_24h, cards_enabled
               evidence: S03/S04/S05 and NTP article
               confidence: high

TopSite        id, mode (favorite|frequent), url, title, position, favicon
               evidence: S05 add/edit/reorder, Frequently Visited auto-populate
               confidence: high

Bookmark       id, parent_id, title, url, position, added_at, is_folder
               evidence: S19/S20, import/export HTML
               confidence: high

HistoryEntry   id, url, title, visited_at, visit_count, typed_count
               evidence: S18, Syncable categories
               confidence: high

Download       id, url, target_path, state, received_bytes, total_bytes, danger_level
               evidence: S17
               confidence: high

Extension      id, name, version, enabled, permissions, site_access, incognito_allowed,
               command_shortcuts, is_builtin
               evidence: S25, built-ins article (Google login, Hangouts, Media Router, Widevine)
               confidence: high

SyncChain      id, device_id, device_name, device_type, sync_code (24 words + rotating word),
               categories { bookmarks, passwords, autofill, history, open_tabs, extensions, themes, apps },
               joined_at, last_sync_at
               evidence: S27, Sync setup article
               confidence: high
SyncChain/SyncRecord — CORRECTED to **OBSERVED-SOURCE** (`re-deep-sync.md`, brave-core):
the 24 words ARE the raw 32-byte entropy (BIP39 encode/decode only — no PBKDF2, no BIP39 seed);
the key tree is one HKDF-SHA512 → Ed25519 signing key (`info="sync-auth-key"`, fixed 64-byte salt)
and nothing else; the 25th word is stripped before any crypto and gates join time only; records use
**Chromium's** Nigori cipher (AES-256-GCM), not Brave's XSalsa20-Poly1305 (`crypto::Encrypt` has
zero call sites outside key derivation); `device_id` is the Ed25519 public-key hex; the per-device
category set is Chromium's `UserSelectableType` set **minus** AUTOFILL_VALUABLE(_METADATA) **plus**
kAIChat (bookmarks/history/extensions/apps/passwords/preferences/themes/tabs/autofill/aiChat), with
default-on = bookmarks + passwords (+ AI chat); the server sees entity names, data type, mtimes and
ids in the clear but never keys or plaintext specifics. Auth: base64(timestamp|signature|pubkey),
ed25519 over the ASCII timestamp, ±1 day from `NetworkTimeTracker`; single `POST /command/`.

SyncRecord     device_id, entity_type, entity_id, encrypted_blob, updated_at, tombstone
               evidence: "local data retained but server cache deleted" on leave
               confidence: medium (encrypted payload shape is a guess)

RewardsProfile profile_id, state (not_enrolled|enrolled|linking|connected|flagged),
               custodial_provider, self_custody_address, payment_id,
               wallet_balance_bat, earnings_this_month, ad_free_claimed,
               tips_enabled, regions_allowed
               evidence: S28, Rewards FAQ, Ads FAQ
               confidence: high for state machine, medium for field names

AdCatalog      ad_id, format (notification|ntp_image), creative, segment, region,
               confirmed (locally), expires_at
               evidence: Ads FAQ (on-device matching, ad confirmation, NTP every 4th tab)
               confidence: medium; delivery/confirmation protocol is explicitly out of scope to clone

Creator        id, name, channel_or_site, verified, verified_at, provider (youtube|twitch|twitter|site)
               evidence: S28 blue checkmark, "How to verify" articles
               confidence: high

Contribution   id, creator_id, amount_bat, type (on_demand|recurring), interval_days,
               status, created_at
               evidence: S28, contributions article (recurring = every 30 days, custodial only)
               confidence: high

LeoChat        id, profile_id, title, model, messages[], is_temporary, created_at, cleared_at
               evidence: S33/S34/S35 (local-only history, temporary chats, Clear Leo data)
               confidence: high

LeoModel       id, display_name, provider, tier (free|premium), context_window
               evidence: Leo models article
               confidence: high

WalletAccount  id, profile_id, chain, address, name, imported_from (created|recovery|hardware),
               encrypted_seed, index
               evidence: S36/S37/S38, Wallet FAQ (self-custody, BIP39, hardware)
               confidence: high

WalletAsset    account_id, chain, contract_address, symbol, amount, decimals, nft_metadata
               evidence: Wallet features grid (SPL/ERC-20/ERC-721/NFT gallery)
               confidence: high

WalletTx       id, account_id, hash, direction, counterparty, amount, chain, status, submitted_at
               evidence: transaction history rows
               confidence: high

Web3Setting    profile_id, default_ethereum_provider (extensions_fallback|brave|crypto_wallets|extensions_no_fallback)
               evidence: S38 brave://settings/web3 radio list
               confidence: high

VpnSubscription profile_id, state (trialing|active|expired), region, credential_blob,
                  device_slot (1 of 10)
               evidence: S41, VPN page (10 devices, trial, region list)
               confidence: high for UI state; credential/backend is a partner system (Guardian)

TalkRoom       id, room_path (high entropy), owner_device, passcode, lobby_enabled,
               vbe_enabled, participants[], recording_enabled, ended_at
               evidence: S39/S40 (pseudo-random 256-bit room path, erasure on last leave,
               recordings deleted 24h)
               confidence: high for fields, medium for exact lifecycle

SyncableSetting profile_id, key, value, synced (bool)
               evidence: Settings sections + Sync categories
               confidence: medium

PermissionGrant profile_id, origin, permission, state (allow|block|ask), expires
               evidence: S15, per-site permissions article
               confidence: high
```

Relationships: Profile 1-n ShieldRule (keyed by domain — in reality one content-settings exception per protection type per origin, see the ShieldRule storage correction above), 1-n NewTabPage (exactly 1 active), 1-n Bookmark/HistoryEntry/Download, 1-n RewardsProfile (1:1), 1-n WalletAccount 1-n WalletAsset/WalletTx, 1-n LeoChat 1-n LeoModel, Profile 1-n PermissionGrant, SyncChain n-n Profile (via SyncRecord).

## Engine stance

The clone runs on **Gecko** (the Firefox engine). The original engine facts of the original app — Chromium's Mojo services, `brave://flags`, Skia raster, SwiftShader software rendering — are recorded in this recon as **clone behavior targets only**: each is a policy the clone must reproduce in the shell/network layer (e.g. "disable this API", "cap this header", "randomize this value"), not a component to port. Parity is judged on Brave's user-facing features and flows, never on web-compatibility test scores.

Per-feature engine dependency, marked explicitly:

- **Shell/network-layer policy (achievable without engine changes):** ad/tracker blocking via filter lists, HTTPS upgrade mode, third-party cookie blocking, query-parameter stripping, referrer capping, De-AMP/redirect debouncing, cookie-consent blocking, CNAME uncloaking (needs DNS), NTP ads, Brave News delivery, Talk (web app), Leo (web app over an API), Sync (own protocol), Playlist (media pipeline), permissions UI, tabs/bookmarks/history/downloads UI, profiles, find bar, shortcuts, Wallet UI, VPN UI (OS-level tunnel on Linux).
- **Engine-coupled (needs Gecko modifications):** fingerprint randomization across canvas/audio/WebGL/fonts/`hardwareConcurrency`/`deviceMemory`/enumerateDevices; partitioned ephemeral storage for third-party frames; cookie lifetime capping (7d JS-set, 6mo HTTP) and session-cookie cleanup on restart; the full list of API removals/disables (Battery, WebBluetooth, Serial, NFC, Idle Detection, File System, Digital Goods, Network Information, Motion Sensors, Web Environment Integrity, Trust Tokens, Privacy Sandbox); Storage Access API auto-reject; geolocation permission dialog enrichment; `document.location.ancestorOrigins()` onion scrubbing.
- **Not cloneable as a behavior, only as a partial substitute:** Brave's own hosted model fleet, Brave's ad marketplace and campaign demand, Guardian's VPN backbone, Jitsi-as-a-Service capacity, the Brave Creators/verification network, BAT settlement rails. These are recorded as `skip` rows in `features.csv`.

## Feature matrix

See `features.csv` (193 rows). Must: 57, should: 58, could: 65, skip: 13.

The `original` column is honest about the observed install: **142 `yes`** and **51 `partial`** — every News, Wallet, Talk, Playlist and VPN row (6+13+18+8+6 = 51) is `partial`, because those six features are absent from the Origin-branded install this recon was observed against, while Brave's full product ships them. The rows are kept (the clone targets the full product) and each carries the note `[absent from Origin build (observed); full Brave feature per source re-deep-*]`. Leo rows are separately deleted from the matrix (Leo is not shippable by this clone — see "Out of scope").

## Source-level evidence (brave-core public source)

Four documents are the **source-of-record citations** for the claims above that a behavioral pass could not observe, plus the ones the behavioral pass contradicted. All are read from **`brave/brave-core` public source (MPL-2.0)** — public code read for understanding, with `re-deep-*` paths quoted verbatim. **Ziy's implementation is clean-room**: it is built from the behavior contracts in this recon, never by porting code or labels.

| document | what it establishes | authority |
| --- | --- | --- |
| `re-deep-shields.md` | Shields storage schema (`braveShieldsMetadata.farbling_token`, the content-setting buckets), `ControlType`/per-row mode enums, panel row order and exact labels, the two adblock engines and default list catalog with live URLs, farbling API list and levels | **OBSERVED-SOURCE** |
| `re-deep-core.md` | Feature-flag inventory and desktop defaults (feature `features.cc` per component), pref names/defaults, wallet keyring prefs, Talk's Origin build-flag gate, ad caps — how the product is assembled | **OBSERVED-SOURCE** |
| `re-deep-sync.md` | Sync protocol: 24 words are raw entropy (no KDF beyond one HKDF-SHA512 → Ed25519), the 25th word derives nothing, records are Chromium Nigori-encrypted, `POST /command/` auth, server-visible vs not-visible surface, per-device category toggles | **OBSERVED-SOURCE** |
| `re-deep-sync.assets.md` | Fetch manifest and provenance for the sync source files (clone commands, blob-limit method) | **OBSERVED-SOURCE** (provenance) |

The behavioral evidence is `recon-behavior.md` (**OBSERVED**), the doc-based spine is the Sources table above (**INFERRED / documentation**), and the install data is `screens/`, `brave-prefs-notes.md` and `proofs-pkg.md`. `replica/evidence.md` is the index of all of them.

## Out of scope (cannot or should not be cloned)

- **The BAT token economy and settlement rails.** BAT is a real cryptocurrency with custodial partners, Solana/EVM on-chain movement, payout-country restrictions and Uphold-style linking. A clone can simulate an internal balance and a tipping ledger, but cannot move BAT between real accounts. `skip`.
- **Brave's ad demand network.** Brave Ads work because advertisers buy campaigns on Brave. A clone can implement the on-device matching + display mechanics against a local catalog, but has no campaign inventory, no region inference at Fastly's edge, and no ad-confirmation accounting that advertisers trust. `skip` for the market, `must` for the on-device/UI mechanics of NTP images + notification ads.
- **Guardian's VPN backbone.** 300+ physical servers in 40+ regions, independently audited no-logs claims, ephemeral credential store per node. A clone can implement the Linux client (WireGuard-style tunnel + UI + region picker) but must not claim an equivalent server network; partnering with another provider is a business decision, not a clone feature. `skip`.
- **Jitsi-as-a-Service.** Brave Talk is Google-free Jitsi Meet hosted by 8x8. A clone can embed a self-hosted Jitsi Meet (open source, AGPL — license terms must be respected) or another WebRTC stack, but the free-forever-1:1 and Premium-hundreds economics are Brave's deals. `skip` for capacity/pricing, `should` for the in-call control surface.
- **Brave Search's index.** The index, the Google-fallback-mixing arrangement, Goggles ranking and "Answer with AI" all depend on Brave's crawlers and corpus. A clone can build the search results page/filters/settings UI against a pluggable backend (SearxNG, local index, or a third-party API) but cannot clone the index itself. `skip` for the index, `should` for the results UI.
- **Brave-hosted LLMs.** Qwen/Llama/Claude Haiku/Sonnet/Opus/GPT/Grok/Mistral hosted on Brave infrastructure with unlinkable subscription tokens. A clone can implement the Leo panel, model picker, BYOM (bring your own API key) and local-only history against any provider or a local model; it cannot clone Brave's hosted fleet or the unlinkable-token account system. `skip` for hosted models, `must` for the panel + privacy posture.
- **Verified-creator network.** creators.brave.com registration, blue checkmarks, YouTube/Twitch/Twitter channel linking, payout-country rules. A clone can implement a creator registry and verification UI for a local/own network. `skip`.
- **Brave's NTP background photo library and the user-submitted photo pipeline.** Curated branded imagery. A clone ships its own images or user uploads. `skip`.
- **Widevine CDM and the browser-wide content licensing that comes with Chromium.** DRM licences are per-binary, per-vendor agreements. Note that the clone's own engine choice changes this calculation entirely (see Engine stance). `skip`.

## Size

Screens 52, flows 29, entities 22. Hard parts: (1) the per-site Shields override model plus fingerprint randomization and partitioned ephemeral storage — deep engine work on Gecko; (2) a from-scratch encrypted Sync chain with the same zero-knowledge posture (24-word code + rotating word, per-category toggles, server-side blind storage); (3) Brave Talk's real-time control surface plus an acceptable self-hosted WebRTC backend; plus significant-but-mechanical work in Wallet (multi-chain account/asset/tx model, `window.ethereum` provider arbitration) and the NTP widget system.

Size: **XL** for "everything Brave owns at parity" — realistically a multi-quarter program, and honest scoping is required before building. Recommended sequence for the architect to consider: core browser UX + Shields (S06-S12, F01-F07) first, then Sync, then NTP/News/Playlist/Sidebar, then Rewards+Ads, then Wallet, then Talk, with Leo and VPN last because they depend on external backends.

## Limitations of this recon

- ~~**No reference screenshots.** No browser tool was available in this environment, so `replica/screens/` is empty and no attempts were made to fabricate one.~~ **CORRECTED (OBSERVED, 2026-10-14):** `replica/screens/` now holds real captures from the user's own install (9 in `screens/` root per `MANIFEST.md`, 4 more in `screens/behavior/`), taken via Brave's own CDP endpoint. Layout specifics remain low-confidence for the sparse-body pages; the documented limitation at the time of the original writing is kept struck-through here rather than deleted.
- **The observed install is an Origin-branded build and it is missing 6 of the features this recon treated as present** — Brave News, Playlist, Talk, VPN, Wallet, Leo (**OBSERVED, behavioral**: `brave://news`, `/playlist`, `/talk`, `/vpn`, `/wallet`, `/leo-ai` all resolve to `chrome-error://chromewebdata/`; the Settings left-nav has no Wallet/Rewards/Leo/Talk/Playlist entry; the NTP customize dialog offers only Background Image / Search / Top Sites / Clock / Cards). The clone targets the full Brave product — `features.csv` keeps every row and marks the affected areas `original=partial` — but the counts in this recon describe the full product, not this binary.
- **No live account.** No Brave account was used; enrolled states (Rewards connected, VPN active, Wallet funded) are described from help-center copy only.
- **Some articles are mobile-first.** Playlist and parts of Wallet coverage in the help center are iOS/Android-oriented; desktop behavior is inferred and marked medium-confidence.
- **The Shields panel itself was never rendered** — browser-chrome React WebUI, not a CDP `page` target (see the S07–S09 note above). Its row order and label strings come from the install's shipped strings plus public source, not from a live screenshot.
- **Dates on help articles range widely** (some updated 2023, several 2025-2026). Where an article is old, the feature may have moved (e.g. Auto-contribute was removed in release 1.75x; Talk/Wallet/Leo pricing and feature gates have shifted).
- **Confidence legend:** `high` = stated in a source; `medium` = inferred from one source or from a partial/platform-specific source; `guess` = standard browser convention with no Brave-specific evidence. Claims touched by the later passes use the explicit markers **OBSERVED (behavioral)**, **OBSERVED-SOURCE** (cited brave-core public source), and **INFERRED**; contradicted claims are struck through in place with the correction beside them.
