# research-firefox-hate.md — what users hate about Mozilla/Firefox, and what Ziy can fix

**Date:** 2026-10-16 · **Workstream:** Firefox-hating patterns for the Ziy premium line ·
**Extended from:** `replica/reviews.csv` (1 120-row Brave corpus, 204 rows mention
Firefox/Mozilla) · **Mechanisms cited:** `shell/browser/defaults/preferences/ziy.js`,
`shell/mozilla.cfg`, `shell/distribution/policies.json`,
`tools/patches/newtab-strip.toml`, `shell/extensions.list`,
`replica/resource-budget.md`, `replica/architecture.md`.

**Labels.** **OBSERVED** = quoted verbatim from the cited URL below.
**DOC-INFERRED** = cited sources state the premises, the join is mine.
**INFERENCE** = my reasoning, no source asserts it.

---

## 0. Sources reached vs blocked

| # | source | method | result |
| --- | --- | --- | --- |
| 1 | `reddit.com/r/firefox/new/.rss` | RSS + UA | **read** — 25 entries |
| 2 | `reddit.com/r/firefox/top/.rss?t=year` | RSS + UA | **read** — 50 entries (two 429s; the third call after ~70 s) |
| 3 | `…/search/.rss?q=memory…&t=year` · `…/search/.rss?q=update%20broke…&t=year` | RSS + UA | **read** — 15 + 15 entries |
| 4 | `…/comments/1x6fanc/unfixed_memory_leak/.rss` | RSS + UA | **read** — 10 comments |
| 5 | `hn.algolia.com/api/v1/search?query=…&tags=comment` (11 queries) | JSON API | **read** — 440 unique comments |
| 6 | same API, `numericFilters=created_at_i>2024-01-01` (6 queries) | JSON API | **read** — 240 unique |
| 7 | `support.mozilla.org/en-US/questions/firefox` | curl + UA | **UNREACHABLE** — HTTP 200, but the 3 038-byte body is a JS **"Client Challenge"** page (`<title>Client Challenge</title>`). Zero thread content. **Nothing below cites it.** |
| 8 | `reddit.com/…/.json` | — | **BLOCKED by assignment** (403s on this box) |

Algolia queries, exactly as specified: `firefox slow`, `firefox memory`,
`firefox pwa`, `firefox ui`, `switched from firefox`, `firefox vs chrome`,
`firefox manifest v3`, `firefox addons`, `firefox drm widevine`, plus
`firefox cpu` and `firefox battery`.

**Counting method, so the numbers are reproducible.** 880 unique comments were
deduplicated by `url + first 80 chars`, filtered to those mentioning
`firefox|mozilla|\bFF\b|gecko|zen browser|librewolf|waterfox|floorp|icecat|
pale ?moon` (840 of 880), then classified by theme keyword inside a 200-character
window around the Firefox mention — so "Firefox" in a sentence about Chrome does
not fire. A theme is **not** a sentiment label; the *sentiment* column below
counts the subset that also carries complaint or switch-away language. These are
counts **of collected material**, not of the web: HN skews technical, r/firefox
skews engaged users, the Brave corpus is Brave's own audience.

---

## 1. The themes, ranked by count

| # | theme | count | sentiment | sources | the complaint |
| --- | --- | ---: | ---: | --- | --- |
| 1 | add-ons / extension ecosystem | 265 | 129 | HN 214, corpus 31, RD 20 | MV2/MV3 uncertainty, AMO review latency, signing limits — and Firefox being the *last* real ad blocker |
| 2 | memory / CPU / battery | 216 | 210 | HN 188, corpus 18, RD 10 | RAM growth across a session, fan spin-up, battery drain, "kill Firefox" as the fix |
| 3 | product-surface bloat | 132 | 84 | corpus 60, HN 67, RD 5 | Pocket, sponsored content, VPN, "what's new", accounts, forced features: "just a browser" |
| 4 | speed & UI jank | 123 | 106 | HN 108, corpus 14, RD 1 | perceived slowness of the *chrome*, not the page; hangs and freezing |
| 5 | update cadence & breakage | 80 | 55 | HN 54, RD 18, corpus 8 | every release "breaks something"; forced restarts; upgrades reset user choices |
| 6 | UI redesign churn | 71 | 37 | HN 65, RD 4, corpus 2 | forced redesigns with no opt-out (Nova, Proton); broken muscle memory |
| 7 | site compatibility | 68 | 59 | HN 50, corpus 10, RD 8 | forms, payments, games, video that work in Chromium and not in Gecko |
| 8 | Widevine / DRM | 41 | 11 | HN 40, corpus 1 | a *split*: object to the blob's presence, and to its absence on Linux |
| 9 | PWA / SSBs | 40 | 16 | HN 39, corpus 1 | desktop Firefox dropped installable web apps / site-specific browsers |

Source key: **HN** = Hacker News comment via Algolia · **RD** = Reddit post via RSS ·
**corpus** = a row in `replica/reviews.csv` (Brave's users comparing the two).

### 1. Add-ons / extension ecosystem (265, sentiment 129)
- "Firefox's Manifest V3 implementation arguably isn't ready for prime time (it has some pretty egregious bugs), but whenever they finally do get around to dropping Manifest V2 (which I have no idea when that would happen), I'm not really worried about extensions not being able to jump over." — HN `danShumway`, 2024-08-12 — https://news.ycombinator.com/item?id=41230223
- "Firefox keeps loosing customers to Chrome and yet Firefox fully supports Manifest V2 with proper Ad-Block support, which increases computer security." — HN `yndoendo`, 2026-06-18 — https://news.ycombinator.com/item?id=48587001
- "Also, FF extensions still don’t support service workers, only background pages" — HN `imbnwa`, 2025-08-06 — https://news.ycombinator.com/item?id=44807163

### 2. Memory / CPU / battery (216, sentiment 210)
- "Firefox and Firefox-derivative browsers have and continue to be seriously sluggish and memory and energy hogs. This should not be swept under the rug. … When I used to use them, almost every time my machine became slow the solution was to kill Firefox." — HN `prmph`, 2026-06-10 — https://news.ycombinator.com/item?id=48478646
- "Switched from FF to Brave, just because FF spins up my fans and uses far more battery than Brave on arch linux. Wish I could switch back." — corpus, 2023-02-03 — https://news.ycombinator.com/item?id=34640613
- "I love Firefox and I've been using it for years since 2017 because i hated how bloated chromium browsers are but the latest update of Firefox is insanely memory hungry, it's taking 3.5GB of my ram just for 4 tabs!!" — RD `u/tryku2`, 2026-10-03 — https://www.reddit.com/r/firefox/comments/1wwzwdq/firefox_1570_has_some_serious_memory_leaks/
- "attest to not destroying laptops. Video calls on Firefox usually had my fans spinning on maximum. They do not even bother to spin up with Brave." — corpus, 2021-11-25 — https://news.ycombinator.com/item?id=29342510

### 3. Product-surface bloat (132, sentiment 84)
- "Pocket was pushed pretty heavily and basically shoved down the throat of Firefox users. … Mozilla was basically mimicking Microsoft behaviour of just forcing products/features onto it's users." — HN `mrweasel`, 2025-05-22 — https://news.ycombinator.com/item?id=44065750
- "If they had listened to their users they would have delivered what every users wants - just a browser . Not some kind of "platform" stuffed with lot of unwanted crap that makes it bloated and introduces possibly new unnecessary attack vectors in it" — HN `thisislife2`, 2026-06-13 — https://news.ycombinator.com/item?id=48520135
- "it changes your new tab back to Firefox Home from blank and adds the geo-location annoying popups where you have to go to about:config and disable geo.enabled to stop it spamming you." — RD, 2026-04-24 — https://www.reddit.com/r/firefox/comments/1suounc/anyone_else_annoyed_with_v_150s_upgrade_breaking/

### 4. Speed & UI jank (123, sentiment 106)
- "I know Firefox is slower. I can feel it and have felt it on every system I've ever owned, and am constantly reminded once every few months or weeks or so when I open up Chrome to check something and am confronted with how much snappier it is—even without an ad blocker, which I don't have installed because I don't actually use Chrome." — HN `cxr`, 2026-09-07 — https://news.ycombinator.com/item?id=49604277
- "Just a shame its a tiny bit slower than chromium based browsers still (the ui, not the web page rendering) … I've tried switching multiple times but always end up back on a chromium variant because the firefox ui just doesn't feel like an upgrade." — HN `esskay`, 2026-06-16 — https://news.ycombinator.com/item?id=48556394
- "I switched from FireFox to Brave. The UX is just so much better. Launch is faster. Updates are faster (and smaller). And resource load is less." — corpus, 2022-07-15 — https://news.ycombinator.com/item?id=32112110

### 5. Update cadence & breakage (80, sentiment 55)
- "For example, Firefox updates by default and forces you to restart it, disabling using websites or seeing any site content before doing so." — HN `nicce`, 2026-10-12 — https://news.ycombinator.com/item?id=50061162
- "As a lot of people are posting here, 154 broke a bunch of sites with a weird cache storage bug, and that includes essential sites I use for work that I can't go without, such as whatsapp web, wetransfer and outlook." — RD, 2026-08-21 — https://www.reddit.com/r/firefox/comments/1vuithy/several_sites_are_broken_in_154_is_there_any_easy/
- "Since the update 149.0, Firefox broke some embedded video players, you get a loop of buffering and videos never start. … all add-on are disabled, tested different version (it's all fine under 149.0)" — RD, 2026-03-28 — https://www.reddit.com/r/firefox/comments/1s65pv9/1490_broke_embedded_video_players/

### 6. UI redesign churn (71, sentiment 37)
- "I think the main complaint is why the need to change the UI. I happened with Firefox not long ago. They redesigned the whole thing and the only workaround is installing the Firefox UI fix addon. … If you are going to make UI changes, make them optional, don't force them to your users" — HN `gonzalohm`, 2026-09-26 — https://news.ycombinator.com/item?id=49852311
- "> Firefox Nobody asked Mozilla for a redesign." — HN `hulitu`, 2026-09-11 — https://news.ycombinator.com/item?id=49656716
- "I wish Firefox would stop rolling out redesigns, color themes, and other visual tweaks every couple years and instead focus on features and bugs." — HN `hattar`, 2026-09-29 — https://news.ycombinator.com/item?id=49893432
- "The Firefox UI is getting worse and worse with every version, because they are constantly adding more useless features. … Maybe they should stop trying to turn their browser into an OS." — HN `this_user`, 2026-04-30 — https://news.ycombinator.com/item?id=47961406

### 7. Site compatibility (68, sentiment 59)
- "Firefox is slower than Chromium, and always will have some compatibility issues, because all websites are made with Chromium in mind." — HN `qweqwe14`, 2026-06-10 — https://news.ycombinator.com/item?id=48474324
- "I've run into a few restaurant sites whose ordering pages just do not work properly (or at all) in Firefox. Also webgl2 performance is unfortunately still much better in Chrome vs Firefox" — HN `nmeagent`, 2026-05-07 — https://news.ycombinator.com/item?id=48054242
- "Some forms just break in Firefox for me. I’ve been applying to a lot of tech companies, and roughly 10% of their application forms fail in Firefox but work fine in Chrome. I can’t figure out why it’s inconsistent." — HN `ksec`, 2025-07-22 — https://news.ycombinator.com/item?id=44647759

### 8. Widevine / DRM (41, sentiment 11)
- "On Firefox, you can disable DRM in about:config. Forks such as Librewolf and Tor Browser disable DRM by default." — HN `WhyNotHugo`, 2026-01-09 — https://news.ycombinator.com/item?id=46557555
- "Unless the browser is basically official Chrome or official Firefox (and even then it fails often on Firefox) it just barfs." — HN `speeder`, 2022-09-26 — https://news.ycombinator.com/item?id=32982996
- "Maybe it's not widevine L1 but Firefox has the widevine plugin enabled on my Debian 13. I don't remember I had to do anything except downloading Firefox from Mozilla and installing it." — HN `pmontra`, 2026-01-09 — https://news.ycombinator.com/item?id=46554735

### 9. PWA / SSBs (40, sentiment 16)
- "Firefox doesn't support PWAs on desktop and removed their previous self-designed equivalent years ago. It's the reason Brave is still running in the background on my machines." — HN `jeroenhd`, 2026-08-10 — https://news.ycombinator.com/item?id=49240551
- "Would love to give Firefox a chance but one thing that stops me (apart from occasional website loading bugs) is inability to install PWAs. Not sure why it’s not implemented like it has been for a long time in Chrome and all its forks." — HN `RockstarSprain`, 2025-07-13 — https://news.ycombinator.com/item?id=44546421
- "One feature that is missing, removed, from Firefox is PWA's/running sites as apps. This is super handy for low trust apps" — HN `beached_whale`, 2024-10-11 — https://news.ycombinator.com/item?id=41810008

**Both directions live inside these themes.** In the add-ons theme, `41230223`
and `48587001` say Firefox is the *last* browser with a real ad blocker; in DRM,
`46557555` wants the blob gone and `32982996` wants it present. A config layer
inherits both sides, and §3 says why that limits positioning.

---

## 2. Which of these Ziy can actually fix

### (a) Engine-level (memory/CPU, speed) — **partially, and only by not adding cost**

216 + 123 = 39% of the collection, and the least reachable by a fork: the
allocator, compositor, process model and JS engine are Gecko's, and
`replica/architecture.md` records that this program buys configuration and
extensions, not an engine fork. What Ziy controls is its own contribution, and
`replica/resource-budget.md` measured it:

| Ziy claim | measured figure | citation |
| --- | --- | --- |
| idle memory, whole 10-process tree on `about:blank` | **1.0 GiB** settled (target < 2.0 GiB, PASS) | `resource-budget.md` §1, §7 row 2 |
| idle network activity | **0** HTTP-fetch lines over 120 s of idle (PASS) | §1/§6b, §7 row 7 |
| cold start to Ziy's own NTP, first paint | **5.62 s** (target < 8 s, PASS) | §3, §7 row 5 |
| media playback, 20 s | 6.5% CPU, 1042.2 MiB RSS (PASS) | §2, §7 rows 3-4 |
| **the figure Ziy must not claim** | **idle CPU = CANNOT ASSESS** — the box's headless compositor is in a `RenderCompositorSWGL failed mapping default framebuffer, no dt` error loop, so 21.6%–88.6% over three windows is "a floor with a known error source", not the product | §1, §7 row 1, §8.1 |

Against `48478646` ("memory and energy hogs") and `34640613` ("spins up my
fans") the honest reading is: **Ziy can promise it adds no idle chatter and a
bounded RSS floor; it cannot promise its users' fans stop spinning** — those
complaints are about work Gecko performs that a config layer does not. What Ziy
*can* do is not add to it: zero HTTP at idle, one 15-minute sync alarm gated on
`state.inChain`, and news' 30-minute alarm that 304s on unchanged feeds
(`resource-budget.md` §6a/§6b).

### (b) Product-surface complaints — **already removed; Ziy's strongest section**

Themes 3 and 6 (132 + 71) are where the repo has work done, not planned. Every
row below is a file in this repo:

| complaint | mechanism | file |
| --- | --- | --- |
| Pocket | `extensions.pocket.enabled/.api/.oAuthConsumerKey/.siteURL` all off/empty | `ziy.js` §11 |
| NTP sponsored content | `…activity-stream.showSponsored`, `showSponsoredTopSites`, `feeds.snippets`, `feeds.section.topstories`, `browser.topsites.contile.enabled`, `…sponsoredShortcuts.enabled` — all false | `ziy.js` §8 |
| the engine's own new tab, in **three** layers | `browser.newtabpage.enabled=false` (routes `about:newtab` to the extension) + `browser.newtabpage.disableNewTabAsAddon=true` (stops mapping the built-in) + the byte patch bumping the built-in's `"manifest_version": 2,` → `3,` so its installer rejects it + the policy blocking `newtab@mozilla.org` | `ziy.js` §8; `tools/patches/newtab-strip.toml`; `policies.json` ExtensionSettings |
| Firefox Accounts / Sync | `identity.fxaccounts.enabled/.toolbar.enabled/.toolbar.pxiToolbarEnabled` false — the file documents that `browser-sync.js`'s `onFxADisabled()` hides all 14 `sync-ui-item` elements, so the app-menu block, sync card, "send tab to device" and the synced-tabs sidebar entry never render; locked by `DisableFirefoxAccounts` | `ziy.js` §10; `policies.json`:5 |
| "What's new" / onboarding / recommendations | `browser.aboutwelcome.enabled` false; `UserMessaging` policy with `WhatsNew`, `ExtensionRecommendations`, `FeatureRecommendations`, `UrlbarInterventions`, `FirefoxLabs`, `MoreFromMozilla`, `SkipOnboarding` all false and `Locked` | `ziy.js` §10; `policies.json`:28-36 |
| sponsored search / geo prompts / orange screens | `FirefoxHome` policy (`SponsoredTopSites`, `SponsoredPocket`, `Pocket`, `Snippets` false, `Locked`); `browser.urlbar.suggest.quicksuggest.sponsored` false; `CaptivePortal` false; `DisableSetDesktopBackground` | `policies.json`:45-57; `ziy.js` §8/§14 |
| telemetry, Normandy, studies, crash pings | `DisableTelemetry`, `DisableFirefoxStudies`, `DisableRemoteImprovements`, `DisableSystemAddonUpdate` policies + `toolkit.telemetry.*`, `app.normandy.*`, `app.shield.optoutstudies.*`, `browser.ping-centre.telemetry` locked | `policies.json`:3-4,:43-44; `mozilla.cfg`; `ziy.js` §8 |
| default bookmarks, import nag, default-browser nag, first-run welcome | `NoDefaultBookmarks`, `DisableProfileImport`, `DontCheckDefaultBrowser`; `startup.homepage_welcome_url`/`homepage_override_url` empty (locked); `browser.startup.homepage` is `about:newtab`, i.e. `ziy-ntp`'s origin | `policies.json`:40,:46-47; `ziy.js` §3; `mozilla.cfg` |

**The catch, plainly.** Theme 6's *root cause* — Mozilla shipping a redesign
without opt-out (`49852311`) — is **not** fixable here: Nova/Proton arrive with
the 4-week train and there is no local Gecko compile. Ziy's answer is that it
owns its own surfaces (`ziy-shell`'s theme, `ziy-ntp`'s page, the always-visible
bookmarks toolbar via `browser.toolbars.bookmarks.visibility`, `ziy.js` §13) — a
replacement for *its own* chrome, not a veto over Mozilla's. Likewise the forced
restart (`50061162`): `DisableAppUpdate`/`ManualAppUpdateOnly` (`policies.json`:41-42)
answer it for a curated install and trade away a security posture — a trade to
state, not hide.

### (c) Extension-ecosystem complaints — **partially reversed, only for Ziy's own suite**

The largest theme, and the mechanism is narrower than the theme. Ziy does not
restore AMO to unsigned authors; it makes **its own nine add-ons** installable
without Mozilla's signature and blocks everything it did not build:

- `MOZ_REQUIRE_SIGNING: true → false`, `MOZ_ALLOW_ADDON_SIDELOAD: false → true` — two
  same-length byte rewrites inside the app dir's own `omni.ja`, keeping every zip
  offset valid (`replica/architecture.md`:51; applied at `tools/build-shell.sh`:226/246,
  asserted by `tools/verify.sh`:125-130 and `tools/e2e-ziy-sync.sh`:99-103).
- `xpinstall.signatures.required` / `xpinstall.whitelist.required` false, plus
  `extensions.autoDisableScopes=0`, `extensions.installDistroAddons=true`,
  `extensions.enabledScopes=15` — the pref layer, so the suite installs from
  `distribution/extensions/` at app scope, unprompted (`ziy.js` §12).
- `ExtensionSettings` policy: the nine `ziy-*@ziy.app` ids at `normal_installed`,
  everything else `allowed`, `newtab@mozilla.org` **blocked** — "Ziy ships its own new
  tab page (ziy-ntp); Firefox's built-in new tab is not part of this product."
  (`policies.json`:74-127).
- The suite itself: `ziy-shell`, `ziy-shields`, `ziy-ntp`, `ziy-news`, `ziy-playlist`,
  `ziy-talk`, `ziy-sync`, `ziy-desktop`, `ziy-pwd` — nine ids, one list, ids derived
  from filenames (`shell/extensions.list`).

So: **the MV3 fear (`41230223`, `48587001`) does not apply to the nine add-ons Ziy
ships, because they do not go through AMO at all.** It still applies to a user's own
extensions, and Ziy's `ExtensionSettings` is *stricter* than stock about unlisted
add-ons. That is a deliberate trade, to be stated as one.

### (d) What Ziy genuinely cannot fix

| theme | why a config layer cannot reach it |
| --- | --- |
| the engine's code | `architecture.md`: Gecko by configuration, no engine fork in this program |
| Mozilla's release cadence | redesigns and forced restarts ship inside the engine build; Ziy can delay (`DisableAppUpdate`) but not decline a feature |
| Widevine | a proprietary GMP that ships or does not; only `gmp-clearkey` is present on this box (no widevine under `/usr/lib/firefox`), and `replica/premium-position.md` lists it as "not shipped" — a fact, not a fix |
| site compatibility | `48474324` is right: it is structural, and no fork moves it |
| desktop PWA/SSB | engine surface Firefox removed for maintenance reasons; the only path is a third-party extension plus a native helper (`44546421` notes the discomfort) |

---

## 3. What this means for positioning

### Claims Ziy can make — each with its evidence

1. **"Ziy is Firefox with the revenue surface removed."** A *surface* claim, not a
   speed claim, and the most defensible one in the corpus: `product-surface-bloat`
   (132) and `ui-redesign-churn` (71) are precisely what §2b answers, and every
   answer is a file. The corpus line behind it is `48520135` — "just a browser. Not
   some kind of 'platform' stuffed with lot of unwanted crap".
2. **"Ziy's own nine add-ons install unsigned, without AMO review."** True, via the
   `MOZ_REQUIRE_SIGNING: false` patch, `xpinstall.signatures.required` false and the
   `ExtensionSettings` policy. Phrase it about *Ziy's suite*, not "extensions".
3. **"Ziy idles without network activity."** Measured: **0** HTTP lines in 120 s
   (`resource-budget.md` §6b), against `44646434` ("constant and blatant attempts to
   reactivate telemetry data in Firefox updates").
4. **"The new tab page is ours — no sponsored tiles, no Pocket, no Firefox Home."**
   Three independent mechanisms, all cited in §2b.
5. **"Ziy ships on the engine that still runs a real ad blocker."** True and
   load-bearing (`48587001`, `41230223`); it is a reason to *stay on Gecko*, and Ziy
   inherits it.

### Claims Ziy must not make

1. **Never "faster than Firefox" / "lighter than Chrome", unless measured and
   controlled.** The corpus that would support it is anecdata from three platforms and
   two decades (`48478646` sluggish, `34640613` fans, `32112110` "resource load is
   less") — and its contraries: "I found that in general , Firefox works fast enough
   that I can't tell the difference in performance between it and Chromium-based
   browsers." (`48496910`, 2026-06-11). Ziy has no controlled A/B.
2. **Never "idle CPU under X%" — it is CANNOT ASSESS.** The measured 21.6%–88.6% sits
   on a compositor error loop and is reported as a floor with a known error source
   (`resource-budget.md` §7 row 1, §8.1). Claiming speed from it would be claiming a
   number measured on an error loop.
3. **Never "fixes Firefox's memory leaks."** `1x6fanc` (a ChatGPT WebGL case) and
   `1wwzwdq` (a per-release RSS regression) are engine and site bugs. Ziy can bound
   its own contribution — 1.0 GiB, zero polling — and nothing else.
4. **Never "sites work better here."** `site-compat` (68) is the one theme no fork
   moves.
5. **Never "kills MV3" / "extensions live forever."** The signing patch covers Ziy's
   nine add-ons; a user's own extensions still live under the engine's manifest
   policy, and Ziy's `ExtensionSettings` is stricter than stock.

### The one-sentence honest position

> Ziy is the same Gecko engine as Firefox with the revenue and telemetry surface
> removed at the config layer — every mechanism cited in §2b — shipping its own nine
> unsigned add-ons and a new tab page that is its own, idling with zero network
> activity and a measured 1.0 GiB RSS floor; it does not claim to be faster, and its
> idle CPU is explicitly not yet measurable on the box it was measured on.

Every performance number in that sentence is measured, not inherited from a thread.
