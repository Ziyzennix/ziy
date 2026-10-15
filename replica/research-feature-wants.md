# research-feature-wants.md — what Firefox/Mozilla/Brave users *ask for* (the positive ask)

**Date:** 2026-10-16 · **Question:** "find what users firefox/mozilla/brave wants" — the
positive ask. **Not** the complaints: that workstream is `replica/research-firefox-hate.md`
(a sibling worker) and `replica/fixes.md`. This document **extends** `fixes.md` §2
("What is missing") with new sources; it does not restate it.

Sample of this document: the Brave corpus in `reviews.csv` (1 122 rows, 4 sources) read for
request-shaped rows, plus new evidence from Mozilla Discourse, GitHub (fenix + geckoview)
and Hacker News Algolia. **No scraping libraries**; sequential requests; every quote is a
verbatim substring of the cited row/issue/comment.

Confidence labels:

| label | meaning |
| --- | --- |
| **OBSERVED** | the cited URL states/contains this verbatim, read this session |
| **DOC-INFERRED** | the premises are cited; the join is mine |
| **UNREACHABLE** | the source was attempted and blocked — stated as a gap, never guessed |

---

## 1. What the Brave corpus already contains (the extension surface, verbatim)

Grep of `reviews.csv` for `wish|want|please add|if only|needs|missing|would love|should add|
feature request|need a |hoping` returns **160 rows** (hackernews 58, brave-community 51,
appstore 26, reddit 25). Theme counts below are my own regex passes over the same 1 122
rows — each row counted at most once per theme, and the regex is stated so it is
reproducible.

| request | count (regex, `reviews.csv`) | verbatim quote | URL |
| --- | ---: | --- | --- |
| Tab power features — vertical tabs, tab groups, ctrl-tab, tab search (`vertical tab\|tab group\|ctrl[ .+-]?tab\|tab search\|tab bar`) | **24** | "I really need proper tabs handling (I have 100 tabs) so most probably need a vertical tab manager." (hackernews, 2025-03-04) | https://news.ycombinator.com/item?id=43253617 |
| | | "why would I want to switch to the tab on the left of my current tab? Usually tabs are not sorted, so this option seems useless for an efficient switching" (brave-community, 11 likes — most-liked feature request in the corpus) | https://community.brave.com/t/use-ctrl-tab-to-switch-to-the-last-used-tab-instead-of-left-or-right-tab/44681 |
| Mobile reach / tab-switcher ergonomics (`thumb\|one.?hand\|reach\|tab gallery\|tabs UI\|bottom of the screen\|stretch`) | **26** | "I would like to let the developers know that whenever I open my browser tabs, I would constantly have to stretch my thumbs to close the tab. If there was a gallery of tabs that I could swipe up and tabs would show and the close button was on the bottom or on the tool bar, that would make life for my thumb easier." (appstore, 5*) | https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10688481668 |
| | | "Then make the tabs UI more vertical so you can clear tabs without having to reach up on your screen." (appstore, 3*) | https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=9125722658 |
| Memory saver / sleeping tabs (`memory saver\|sleeping tab\|inactive tab\|tab discard`) | **9** | "I feel as if the Memory Saver takes action way too slowly. It should have two more features: Time-dependent Memory Saver - deactivates tabs after a certain amount of time" (brave-community, 2026-05-09) | https://community.brave.com/t/memory-saver-is-inefficient/652768 |
| | | "I feel that there should be an option when on right clicking tabs to sleep the tab (or activate memory saver for that tab)" (brave-community, 2026-02-08) | https://community.brave.com/t/adding-memory-saver-button-when-right-clicking-on-tabs/649135 |
| Battery-saver mode (`battery saver\|battery saving`) | **7** | "Opera has this feature that would help with keeping the ram use down such as the battery saver feature. i would love to see this in Brave." (brave-community, 2019-09-20) | https://community.brave.com/t/battery-saver-like-opera/83823 |
| | | "Can you please add a battery saver mode to Brave desktop?" (brave-community, 2020-06-10) | https://community.brave.com/t/battery-saver-mode/133863 |
| Dark mode / night mode (`dark mode\|night mode`) | **6** | "you cannot have a reliable dark mode, when every page loads in white even while in dark mode. 2. your night mode makes no sense and just inverts the colors… Make a legitimate dark mode that works." (appstore, 1*) | https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10177933931 |
| Translator (`translat(or\|ion\|e)`) | **6** | "each time I complain about its slow and inadequate translation feature. Despite writing to the Brave community about this, I've received no response, and the situation has re" (reddit, 2026-08-29) | https://www.reddit.com/r/brave_browser/comments/1w1rgso/why_has_brave_remained_the_same_for_years/ |
| | | "its excessively slow translator to translate web pages, I appreciate that it is a nativ" (brave-community, 2024-03-29) | https://community.brave.com/t/very-slow-translator-for-websites/540276 |
| Compact layout / density (`compact\|helium\|density`) | **6** | "[Feature Request] Please add compact Browser layout like Helium" (reddit, 2026-04-18) | https://www.reddit.com/r/brave_browser/comments/1sp3zuz/feature_request_please_add_compact_browser_layout/ |
| | | "Tabs, and a very compact min-max-close button, should be the only things on the tab bar." (brave-community, 2023-04-11) | https://community.brave.com/t/clean-up-tab-bar-wasted-space-make-pinned-tabs-persistent-search-tabs-button/481851 |
| Containers (`container`) | **7** | "I really need proper tabs handling (I have 100 tabs) so most probably need a vertical tab manager. Firefox is slow on mac but maybe that's my only solution if I need proper sessions / containers to connect multiple accounts to the same website or isolate websites such as facebook." (hackernews, 2025-03-04) | https://news.ycombinator.com/item?id=43253617 |
| | | "Sidebery has tab panels (which I think Arc calls workspaces) that can be set to use the same Firefox container. I want to be logged into different accounts of the same service" (hackernews, 2024-08-21) | https://news.ycombinator.com/item?id=41309410 |
| Mouse gestures / frameless layout (`mouse gesture\|gesture`) | **3** | "the only thing that I really wished I could bring from other browsers are: Vivaldi's mouse gestures and its setting to change how much do I actually need to move my mouse to recognize an gesture, and the Frameless mode from Helium" (reddit, 2026-10-12) | https://www.reddit.com/r/brave_browser/comments/1x3on26/and_as_always_im_back_on_brave/ |
| Clear-data reachable in the menu (`clear (my )?(browsing )?data\|clear data`) | **2** | "One suggestion: I would love to see the "clear data" function be accessible in the "…" menu, so I can clear my data and history with 2-3 taps instead of 5 taps and scrolling (I counted)." (appstore, 5*) | https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=7445302558 |
| Split-view / side-by-side (`split.?view\|side.?by.?side`) | **4** | "The ability to combine tabs and have multiple tab windows open side by side without running a separate Brave instance would be nice for productivity." (brave-community, 2020-01-05) | https://community.brave.com/t/paste-and-submit-context-menu-item-using-rmb-tab-stacks-tab-panels-draggable-tabs-bookmark-bar-context-menu-close-delay/100753 |
| Bookmarks import/export (`import.{0,20}bookmark\|bookmark.{0,20}import\|export.{0,20}bookmark`) | **4** | "Really wish i could import my old safari bookmarks." (appstore, 2*) | https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=8006314334 |
| Send a tab to another device (`send.{0,20}tab`) | **2** | "It is ergonomic until you want to send more than one tab using Brave sync. Also Ctrl + B to show the bookmarks sidebar would be nice" (hackernews, 2023-04-27) | https://news.ycombinator.com/item?id=35732059 |
| Autoplay control (`autoplay`) | **3** | "1) don’t autoplay playlist videos upon opening that page. It’s just annoying." (appstore, 5*, 2025-09-19) | https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13159374778 |

**Already covered by `fixes.md` and therefore not re-litigated here:** shields that
remember per site (38 reviews), mobile tab ergonomics (39), dark mode (6), password
viewing/import (32), update control (2), support that answers (7), vertical tabs and
ctrl-tab MRU (6 direct + 166 tab-management).

---

## 2. New evidence, outside the Brave corpus

### 2.1 Mozilla Discourse (discourse.mozilla.org) — reached, `search.json` works
14 searches (`vertical tabs`, `tab groups`, `sidebar`, `tab search`, `pwa install`,
`reader mode`, `what firefox lacks`, `browser feature request`, `firefox should have`,
`wish firefox had`, `would love firefox to`, `missing in firefox`, `firefox wishlist`,
`vertical tabs feature request`), then per-thread `.json` fetches for verbatim first posts
and top replies. **500 unique topics surfaced, 41 with request-shaped blurbs.** Reaction
counts are not exposed by this API's search payload (all `like_count` values came back
`null`), so "votes" here are **thread size** (post counts) — stated as such, not as votes
[**OBSERVED**].

| request | thread size | verbatim quote | URL |
| --- | --- | --- | --- |
| Tab groups | **62 posts** | "Do we think Firefox is ever going to get tab groups the way Chromium has them? … some features in browsers are "nice to haves", but other features are becoming standard features that all browsers kinda need to have to compete in a" | https://discourse.mozilla.org/t/121265 |
| Multi-row tabs | **74 posts** | "Now i miss a (for me) very important function: Is it possible to show all open Tabs in more than one row. … Now I have to scroll left and right to find my Tabs. And i have very much Tabs in the background opened…" | https://discourse.mozilla.org/t/21657 |
| Keep compact/less-wasteful density | **81 posts** | "As I and many others have expressed in that bug we would like to keep that density. Its removal would only leave the normal density, which - as agreed by others - wastes too much vertical screen space." | https://discourse.mozilla.org/t/76038 |
| Stop adding AI surfaces | **29 posts** | "im so sick of all these ai things being added into programs. i picked firefox specifically because it didnt have obnoxious ai intergration. now it does and i want to explode. ive spent so much time going through every little thing to make sure ive turned all the different ai settings off." | https://discourse.mozilla.org/t/146744 |
| about:config on stable Android | **49 posts** | "i would like if you bring back the about:config page to the stable version of android that the way we be able to make advanced configuration and even add protections firefox was about adding more option not decreasing it" | https://discourse.mozilla.org/t/66537 |
| Recently-closed in the sidebar history | 1 post | "the history tab is missing the ability to reopen 'recently closed tabs' and 'recently closed windows' … This is really useful feature, if you accidentally close a window or tab." | https://discourse.mozilla.org/t/147622 |
| Tree-style / stacked / groupable tabs | 1 post | "I would love a way to stack or group tabs based on domain names. It's such a power user feature that would be quite useful in the Firefox Developer Edition. Being able to search open tabs would also be a great feature." | https://discourse.mozilla.org/t/57905 |
| Remove the tab bar / disable address-bar search | 4 posts | "I am seamonkey user primarily, I prefer the old internet suite format. … It would be nice to have that simplicity in Firefox" | https://discourse.mozilla.org/t/86912 |
| Command-palette style metasearch for browser actions | 4 posts | "A full text search interface for internal functionality. Think of the CTRL+SHIFT+P menu in VSCode" | https://discourse.mozilla.org/t/62598 |
| RSS/Atom revival in the browser | 5 posts | "I'm wondering if Firefox could help revive RSS/Atom by bringing feed discovery back to the browser." | https://discourse.mozilla.org/t/21455 |
| Site-specific-browser (SSB) app icons | 2 posts | "I created script for Linux, which converts web pages into standalone web applications using firefox as default browser." | https://discourse.mozilla.org/t/58903 |
| Custom home page in a new tab | 7 posts | "Why is a browser that advertises itself as "The browser made for developers," the only browser that does not allow you to open a custom home page in a new tab automatically when the new tab is opened?" | https://discourse.mozilla.org/t/58150 |
| Browse history/bookmarks from the URL bar | 3 posts | "When entering some term in the url bar, I would like to be able to browse my history and my favorites containing that term directly from there." | https://discourse.mozilla.org/t/61876 |

### 2.2 Mozilla Connect (connect.mozilla.org) — **UNREACHABLE**
`connect.mozilla.org/search.json?q=vertical%20tabs`, `/api/v2/discussions?q=…`, and the bare
root all **timed out** (curl (28), HTTP/1.1 and HTTP/2, IPv4 forced; DNS resolves to
Cloudflare 104.21.50.166 / 172.67.207.119, so this is a network-path block, not a DNS
failure) [**UNREACHABLE**]. It remains referenced *indirectly* by two HN comments found in
§2.4 (`connect.mozilla.org/t5/ideas/…` links), and one r/firefox post points at it, but no
Connect thread was fetched. **No Connect quotes appear in this document.**

### 2.3 GitHub issue boards — reached via `api.github.com`
**fenix (`mozilla-mobile/fenix`) is ARCHIVED** (`archived: true`, `open_issues: 0`,
last push 2023-02-20) [**OBSERVED**, `GET /repos/mozilla-mobile/fenix`]. Its
feature-request label is `feature request 🌟` (not `feature-request`); the board is closed
but the history is public and it is the highest-signal "what Firefox-Android users want"
set in the repo. `mozilla/geckoview`, `android-components`, `firefox-android` and
`focus-android` are also archived with ~0 open issues; `mozilla/gecko-dev` is archived
with 0 open issues. So this board is a **historical** record, and is treated as such —
reaction counts are real, open-state is not [**OBSERVED**]. Total API calls used: 5
(labels, 2 paged issue lists, repo states, per-issue bodies) — within the ~6 budget.

| request | 👍 reactions | verbatim body | URL |
| --- | --- | --- | --- |
| F-Droid distribution | **211** | "Would be nice to have this browser available in the F-Droid repository" | https://github.com/mozilla-mobile/fenix/issues/162 |
| Save as PDF | **180** | "To easily save a web page in PDF for formatting, portability and saving a local copy for later reading." | https://github.com/mozilla-mobile/fenix/issues/3709 |
| Switch tabs by swiping the address bar | **155** | "As a user I want to be able to quickly switch back and forth between tabs by swiping right and left on the address bar." | https://github.com/mozilla-mobile/fenix/issues/3481 |
| Web extensions on Android | **154** | "Like on desktop, users want to add individual features and extend their browser beyond what Mozilla provides. 2. Users want to use the same extensions on their phone, they use on their desktop machine." | https://github.com/mozilla-mobile/fenix/issues/574 |
| Force dark mode on page content | **117** | "As a user, I want my browser to be able to force websites content to use dark mode, so I can have control over how my browser in customized to match my preferences." | https://github.com/mozilla-mobile/fenix/issues/2139 |
| View page source on mobile | **113** | "View Page Source option" | https://github.com/mozilla-mobile/fenix/issues/3710 |
| Gestures (meta) | **110** | "We want to support the following gestures:" | https://github.com/mozilla-mobile/fenix/issues/176 |
| No white flash at page load in dark mode | **109** | "Currently opening a new page temporarily shows a pure white page before loading actual content regardless of the browser theme." | https://github.com/mozilla-mobile/fenix/issues/6313 |
| In-browser printing on mobile | **107** | "so user can print from mobile browser, there is no print option in browser" | https://github.com/mozilla-mobile/fenix/issues/10217 |
| Reorder tabs | **82** | "occasionally it would still be nice to further reorder tabs." | https://github.com/mozilla-mobile/fenix/issues/2487 |
| Containers | **68** | "Being able to contain different websites to different containers to improve privacy and usability." | https://github.com/mozilla-mobile/fenix/issues/1481 |
| Tab groups (fenix) | **44** | "I've seen Chrome's Tab groups today and I think they are pretty handy." (fetched separately, 2019-10-11) | https://github.com/mozilla-mobile/fenix/issues/5967 |
| Disable the "inactive tabs" surface | **63** | "Add option to disable "inactive tabs" box" | https://github.com/mozilla-mobile/fenix/issues/20684 |
| Tabs must not reload on switch | **118** | "If I were to do a Google search, open a new tab, visit any website, then switch back to that first tab, that oroginal Google search would then reload completely, regardless of the fact that it was loaded previously and not cleared from memory. Also, when I push the app into background, and then go back to it from the Recents screen, the page that was open would have to load again completely" | https://github.com/mozilla-mobile/fenix/issues/12731 |

**GeckoView (`mozilla/geckoview`)**: 109 open issues exist but the top-voted one is a
platform ask ("GeckoView instead of Android System WebView", +28) — not a browser-feature
request [**OBSERVED**]. `mozilla/gecko-dev` is archived with 0 open issues [**OBSERVED**].

### 2.4 Hacker News Algolia (`hn.algolia.com/api/v1`) — reached
8 comment queries + 6 story queries + thread reads of items 41192118 (634 pts / 356
comments, "Firefox Sidebar and Vertical tabs: try them out") and 36154692 (288 pts / 266
comments, "Brave Browser introduces vertical tabs"). These are **cross-browser** asks
("what people want from ANY browser"), which is the point of this section.

| request | signal | verbatim quote | URL |
| --- | --- | --- | --- |
| First-class vertical tabs in every browser | **634-pt thread, 356 comments** | "I wish all browsers has first class vertical tabs support and split view. I am really tired of resource hog, unstable arc. Want to return back to traditional browsers but they are not supporting vertical tabs like arc did." | https://news.ycombinator.com/item?id=41192353 |
| | same thread | "Vertical tabs are fine, but this seems like catching up up with the other browsers.I wished Firefox had natively supported tabs like in "Tree Style Tab" extensions. … Having something native and polished would be a huge selling point for Firefox." | https://news.ycombinator.com/item?id=41192429 |
| | same thread | "I just really want Tab Groups.This is a nice step forward." | https://news.ycombinator.com/item?id=41192705 |
| | same thread | "I've wanted to see for a long time with browsers: split-pane view.In other words, the ability to see two browser sessions, side-by-side" | https://news.ycombinator.com/item?id=41193096 |
| Nesting (tree) inside vertical tabs | 288-pt thread | "I've been using this on Brave dev for several months. It's great! I hope they enable nested tabs, which I loved having in TST on Firefox." | https://news.ycombinator.com/item?id=36156765 |
| Compact density, restored | 27 + 568 hits | "Firefox has been on a steady trajectory of declining usability for a while now … This "compact density" drama may not be a huge issue" | https://news.ycombinator.com/item?id=26465512 |
| about:config on stable Android | thread hits | "Arbitrarily removing access to about:config (in Android) must account for a loss or two." | https://news.ycombinator.com/item?id=28016319 |
| PWA install parity | 14 hits, story context | "You can install a PWA with Firefox, but the instructions might look different" | https://news.ycombinator.com/item?id=42796503 |
| | iOS-adjacent | "one feature that I notice is missing — and that virtually every other major browser on iOS (Safari, Chrome, Firefox, and others) already supports — is the ability to add a website directly to the iPhone Home Screen as a standalone shortcut" (appstore, 3*) | https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=14127630803 |
| Command palette for browser actions | thread hits | "In Brave one can press command-shift-a to get a search bar for your open tabs." | https://news.ycombinator.com/item?id=39313193 |

### 2.5 Reddit RSS — reached, thin this session
`r/firefox/new/.rss?limit=25` returned 25 entries, 2026-10-15 [**OBSERVED**];
`r/browsers/new/.rss` returned **HTTP 429** after the first call (rate-limited, same as
`fixes.md`'s note that Reddit's JSON is 403) [**UNREACHABLE** this session]. The 25
entries are mostly questions, not feature asks; one notable entry is Mozilla's own ask —
"Help us shape a new search suggestions feature", which points at Mozilla Connect
(https://www.reddit.com/r/firefox/comments/1x6r5c9/) and contributes no feature request.
**Recorded as thin, not as absence.**

---

## 3. The ranked table, with Ziy status

**Rule (stated and applied):** only **Brave-parity rows plus requests that also exist as
Brave features** are buildable. A request that is **not** a Brave feature is *recorded*
below with a `NEW — not a Brave feature` status and is **NOT recommended**. Ziy-status
claims cite `replica/features.csv` rows by line number. Counts are evidence volume;
"Ziy status" is the matrix's own column, not mine.

| # | request | count / signal | sources | 1–2 verbatim quotes (URLs in §1–2) | already in Ziy's feature matrix? |
| --- | --- | --- | --- | --- | --- |
| 1 | Vertical tabs + real tab power (tab search, ctrl-tab MRU, tab-bar scrolling) | 24 corpus + 62p + 74p + 634-pt thread + 44p + 155 👍 | reviews.csv; discourse; fenix; HN | "I really need proper tabs handling (I have 100 tabs)" / "Do we think Firefox is ever going to get tab groups" | **PLANNED** — `features.csv`#5 `Vertical tabs`, #6 `Tab search`, #4 `Tab groups`, #180 `Vertical tab layout`, #200 "Vertical tabs, tab-bar scrolling and ctrl-tab most-recently-used" |
| 2 | Tab groups (collapsible, per-domain or per-topic) | 9 corpus + 62-p Discourse + 44 👍 + 634-pt thread | reviews.csv; discourse; fenix; HN | "I really like the idea of Collections but I've seen Chrome's Tab groups today and I think they are pretty handy." (fenix #5967) / "I just really want Tab Groups." (HN) | **PLANNED** — `features.csv`#4 `Tab groups` (must, desktop+android) |
| 3 | Mobile reach: bottom tab switcher, clear-field, big targets | 26 corpus + 82–155 👍 fenix | reviews.csv; fenix | "stretch my thumbs to close the tab" / "quickly switch back and forth between tabs by swiping right and left on the address bar" | **PLANNED** — #198 "Bottom-reachable mobile tab switcher", #199 "Touch-ergonomic omnibox clear control"; fenix's address-bar swipe is NEW detail, same row |
| 4 | Real dark mode + page-level dark | 6 corpus + 117 👍 + 109 👍 fenix + 29-p Discourse (anti-AI) | reviews.csv; fenix; HN | "Make a legitimate dark mode that works." / "force websites content to use dark mode" | **PLANNED** — #204 "Two-tap clear data plus a true dark mode"; #178 `Themes/night mode/custom fonts` is **done** for app theming |
| 5 | Tabs must not reload on switch / session durability | 118p + corpus sync-loss family | reviews.csv (177 bugs + 127 sync rows in `fixes.md`); fenix | "that oroginal Google search would then reload completely … even though it wasn't cleared from memory" / (corpus) "pressing reopen does nothing" | **BUILT** — #195 "Crash-safe session restore" (`built`) |
| 6 | Memory saver / sleeping tabs with a time trigger | 9 corpus + 63 👍 + 63p | reviews.csv; fenix | "Time-dependent Memory Saver - deactivates tabs after a certain amount of time" / "sleep the tab (or activate memory saver for that tab)" | **NEW detail — engine chrome.** Brave has Memory Saver (so Brave-parity), but no `features.csv` row owns it; #196 (resource budget) measures it. Do **not** recommend: engine chrome Ziy does not skin |
| 7 | Translator (fast, in-browser) | 6 corpus | reviews.csv; HN | "its slow and inadequate translation feature" / "its excessively slow translator" | **PLANNED** — #170 `Translate` (could) |
| 8 | Containers | 7 corpus + 68 👍 fenix | reviews.csv; fenix; HN | "I need proper sessions / containers to connect multiple accounts" / "[Meta] Containers support" | **PLANNED** — #172 `Containers` (could, desktop-only) |
| 9 | Compact layout / density | 6 corpus + 81-p Discourse + 568 HN hits | reviews.csv; discourse; HN | "Tabs, and a very compact min-max-close button, should be the only things on the tab bar." / "wastes too much vertical screen space" | **NEW — not a Brave feature.** Brave ships density via engine chrome, not a feature row; record only, do not build |
| 10 | Mouse gestures | 3 corpus | reviews.csv | "Vivaldi's mouse gestures and its setting to change how much do I actually need to move my mouse to recognize an gesture" | **NEW — not a Brave feature.** Not in `features.csv`; not a Brave feature row. Record only |
| 11 | Save as PDF | 180 👍 fenix + 3 corpus | fenix; reviews.csv | "To easily save a web page in PDF for formatting, portability" | **NEW — not a Brave feature.** No PDF row in `features.csv`. Engine's print pipeline could carry it (DOC-INFERRED), but it is not a Brave row → record only |
| 12 | Web extensions on Android | 154 👍 fenix + 5 corpus | fenix; reviews.csv | "Users want to use the same extensions on their phone, they use on their desktop machine." | **PLANNED, engine-bound** — #151 `Extensions manager` is **done desktop-only**; the Android half is GeckoView API work, not a Brave row |
| 13 | about:config / advanced settings on Android | 49-p Discourse + HN | discourse; HN | "i would like if you bring back the about:config page to the stable version of android" | **NEW detail on an engine surface.** Brave has `brave://flags` at #187 (`skip`, uncloneable); the Android stable-side toggle is engine policy. Record only |
| 14 | Split view / side-by-side | 4 corpus + 634-pt thread + 266-pt thread | reviews.csv; HN | "multiple tab windows open side by side without running a separate Brave instance" / "split-pane view … two browser sessions, side-by-side" | **PLANNED** — #7 `Split-view tabs` (could, desktop-only) |
| 15 | Recently-closed in sidebar history | Discourse 1 post | discourse | "the history tab is missing the ability to reopen 'recently closed tabs'" | **NEW detail.** Brave has reopen-closed-tab at #2 (**done**); the sidebar-history placement is engine chrome. Record only |
| 16 | Command palette / URL-bar history search | 4-p Discourse + HN | discourse; HN | "A full text search interface for internal functionality. Think of the CTRL+SHIFT+P menu in VSCode" | **DONE / PLANNED** — #146 `History page with search` done; #184 `Semantic search history` planned (could). The VSCode-style palette itself is **NEW** |
| 17 | Battery-saver mode | 7 corpus | reviews.csv | "Can you please add a battery saver mode to Brave desktop?" | **NEW — not a Brave feature.** No row in `features.csv`. Record only |
| 18 | RSS/Atom in the browser | 5-p Discourse + 1 corpus | discourse; reviews.csv | "I'm wondering if Firefox could help revive RSS/Atom by bringing feed discovery back to the browser." | **PARTLY PLANNED** — #64 `Brave News custom RSS/site search` (should); standalone feed discovery is NEW |
| 19 | Custom home page in a new tab | 7-p Discourse | discourse | "the only browser that does not allow you to open a custom home page in a new tab" | **NEW — not a Brave feature.** #52–59 NTP rows cover Brave's NTP, not a custom-homepage-in-new-tab. Record only |
| 20 | F-Droid distribution | 211 👍 fenix | fenix | "Would be nice to have this browser available in the F-Droid repository" | **NEW — packaging, not a browser feature.** Belongs to `replica-deploy`, not the feature matrix |
| 21 | Stop adding AI surfaces | 29-p Discourse + 99 corpus rows (`fixes.md` §3.1) | discourse; reviews.csv | "i picked firefox specifically because it didnt have obnoxious ai intergration" | **CUT, by decision** — #73 `Answer with AI` `cut`; Leo/AI rows cut in `fixes.md` §3.1. This is the *positive* form: Ziy keeps it off |

**Tallies against `features.csv` (each of the 21 rows above, counted once):**
ALREADY BUILT **2** (#195 session restore, #2 reopen-closed-tab cited under #15/#16) ·
PLANNED **9** (#5, #6, #4, #180, #200, #198, #199, #204, #170) · **CUT by decision 1** (#73
AI, and the AI-economy rows `fixes.md` §3.1) · **NEW (not in the matrix) 9** (memory-saver
trigger, compact density, mouse gestures, save-as-PDF, about:config-on-Android, sidebar
recently-closed placement, command palette, battery saver, F-Droid) · of those NEW, the
ones that are **not a Brave feature at all** (record-only, per the rule) are **5**:
compact density, mouse gestures, save-as-PDF, battery saver, F-Droid packaging.

---

## 4. The honest three

Evidence × cost, and each one must already be a Brave feature to be buildable. Ranked.

### 1. Vertical tabs + tab power — size **M** — the tab cluster already in the matrix
Highest evidence in the whole study: 24 corpus rows, a 62-post Discourse thread, a 74-post
multi-row-tab thread, a **634-pt / 356-comment** HN thread, and the direct
"if only" quote "I wish all browsers has first class vertical tabs support and split view"
(https://news.ycombinator.com/item?id=41192353). It is Brave-parity (`Vertical tabs`,
`Tab groups`, `Tab search`, `Vertical tab layout`, `Split-view tabs`) and all five rows are
`planned` in `features.csv` #4/#5/#6/#7/#180/#200.
**Carry it in:** the shell chrome — `shell/browser/defaults/preferences/ziy.js` currently
sets `sidebar.verticalTabs=false` (line 393) and `sidebar.revamp=true` (line 392); flipping
the vertical-tabs pref and skinning the engine's revamped sidebar is the desktop half.
Gecko 156 does not expose tab grouping/collapsing to extensions
(`features.csv`#4 notes), so the grouping half is engine chrome — that is why this is **M**,
not S.

### 2. Mobile reach: bottom-reachable tab switcher + clear-field + address-bar swipe — size **S** — `extensions/ziy-ntp` + the Android module
26 corpus rows ("stretch my thumbs to close the tab", appstore 5*, id 10688481668) plus
three fenix feature requests in the same ergonomic family — **155** for "Switch Tabs via
Swiping Address Bar" (https://github.com/mozilla-mobile/fenix/issues/3481), **82** for
"Ability to reorder tabs" (#2487), **66** for a desktop-like tab bar on tablets (#2344).
Already PLANNED as two Ziy rows (#198, #199), and reach/size, not a new tab model, so the
cost is low.
**Carry it in:** the Android tab/toolbar surface owned by `packaging/android/` plus the
NTP/menu chrome in `extensions/ziy-ntp` (`ui/`, `content/`) and the shared design tokens
in `replica/design/tokens.css`; the swipe gesture is GeckoView-side, so the deliverable
is the reach/size audit of the existing controls, not a new gesture engine.

### 3. A true dark mode with no white flash — size **S** — `extensions/ziy-shell` + `replica/design/tokens.css`
Small, cheap, and independently corroborated on every side of the study: 6 corpus rows,
fenix **117** (force dark mode, #2139) and **109** (no white page flash, #6313), and
`fixes.md` §2.4 already flags it. The fenix issue even writes the acceptance criteria for
us: "There exists a setting that forces web content to use a dark theme … I don't see a
flash of white/light colors before the dark theme is applied."
**Carry it in:** `extensions/ziy-shell` (theme id `ziy-shell@ziy.app` is already wired at
`shell/browser/defaults/preferences/ziy.js` line 389: `pref("extensions.activeThemeID",
"ziy-shell@ziy.app")`, and the shell sets `browser.theme.content-theme=0` at line 388), plus
the page-level filter half in the extension's `background/` — the tokens in
`replica/design/tokens.css` are the single source of truth (AGENTS.md §(c)).

**Also recommended, unchanged from `fixes.md` §4:** shields that remember per site (1),
session/download durability (2), the measured resource budget (3) — those are the sibling
workstream's picks and this document does not re-rank them.

---

## 5. The requests Ziy must REFUSE

| request | why it is refused |
| --- | --- |
| **Any AI surface, however framed** — "stop getting ai stuff" (Discourse #146744), the 99 corpus rows citing Leo | The positive ask here is *absence*, which Ziy already satisfies. Do not "answer" it by adding a local AI toggle, a model picker, or an AI command palette: that reintroduces the cut list (#73 `Answer with AI` is `cut` by the co-owner's decision, `fixes.md` §3.1). The correct deliverable is the published statement that no assistant exists |
| **Wallet, BAT, rewards economy, VPN, sponsored surfaces** — 259 wallet + 212 rewards-economy rows in `fixes.md` §1.1/§3.2; fenix-era "link wallet to Uphold/MetaMask" asks | All `cut` in `features.csv` (#77–#87, #88–#100, #127–#132) and refused by decision. The positive form of these asks (a wallet you actually control) is answered structurally by having none — the same posture as the AI row, not by rebuilding the wallet |
| **`brave://flags` / engine feature switches** (Discourse about:config thread, #187) | `skip` — uncloneable on Gecko without shipping the engine's own flag UI, and Ziy's pref surface is `about:config` plus its own settings, which is the honest equivalent |
| **Brave Origin subscription, Brave account, P3A** (#190, #191, #186) | `skip`/`cut` — Ziy is free and standalone; a paid tier contradicts the project's premise |
| **Widevine DRM, Mojo service layer, Skia/SwiftShader, site isolation** (#155, #188, #189, #163) | `skip` — engine internals Ziy does not ship and, in Widevine's case, will not license |
| **Compact density, mouse gestures, save-as-PDF, battery saver** (this study's NEW rows) | **Not Brave features.** Per the project rule they are recorded and *not* recommended. Battery-saver specifically would mean throttling the engine, which is a Gecko feature, not a Ziy build |
| **Install-site-as-app (PWA/SSB)** — HN "web app that enhances the experience", iOS home-screen shortcut row | Recorded as request #19-adjacent; **NOT recommended** on this evidence: only one iOS-row and one HN thread ask for it and the matrix has no row. It is Brave-parity, so it is *buildable* (#173 `Web Apps (install site as app)` is `planned`), but the evidence here does not justify jumping the queue ahead of §4's three |

---

## 6. Sources reached vs blocked

**Reached:** Mozilla Discourse `search.json` + per-thread `.json` (14 + 21 fetches);
GitHub REST `api.github.com` for `mozilla-mobile/fenix` labels/issues/bodies,
`mozilla/geckoview` issues, and repo states for fenix/geckoview/android-components/
firefox-android/focus-android/gecko-dev (5 calls in the budget); HN Algolia
`search` (14 queries) and `items` (8 thread reads); Reddit RSS `r/firefox/new` (25
entries); Bugzilla REST `quicksearch` (returned 0 bugs, reached).

**Blocked / limited:** Mozilla Connect **UNREACHABLE** (Cloudflare-fronted, connection
timeout on every endpoint tried — no Connect quotes anywhere in this document); Reddit
JSON 403 and `r/browsers` RSS 429 (per `fixes.md`, and confirmed again this session);
all `mozilla-mobile` boards are **archived** with ~0 open issues, so their feature-request
history is read as history, not as a live backlog; fenix reaction counts are real but its
open-state is not; Google Play / G2 / Capterra / Trustpilot remain unavailable (see
`fixes.md` "Unreachable sources").

**Budget note:** 5 GitHub API calls used of the ~6 allowed; HN Algolia, Discourse and
Reddit RSS are public, unauthenticated and were hit sequentially with ≥1 s gaps.
