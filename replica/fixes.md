# Ziy: what Brave's users hate, what is missing, what is unsolved

Sample: 1120 reviews, 4 sources (appstore 50 rated reviews, hackernews 309 comments,
reddit 164 posts, brave-community 599 posts). Date range 2017-12-20 to 2026-10-14;
298 rows from the last 12 months. Full data: `reviews.csv`. Ranking produced by
`reviews.py` (`replica/feedback.md`), then re-cut by hand for this document.

Unreachable sources, stated honestly:

- **Google Play.** The listing HTML (`play.google.com/store/apps/details?id=com.brave.browser`)
  returns HTTP 200 but contains no review data: the "See all reviews" page is a
  client-side (JS) render. The public page payload has `reviewId` count 0. No official
  JSON endpoint exists. **Not collected.**
- **G2 / Capterra / Trustpilot.** All three return HTTP 403 with a bot challenge
  (G2 403 captcha, Capterra 403 captcha, Trustpilot 403 challenge) to a plain GET with a
  browser User-Agent. No JSON feed is offered. **Not collected.**
- **Reddit JSON API.** `www.reddit.com/search.json` and `/r/*/new.json` return
  `HTTP 403 'Blocked'` for every User-Agent tried (descriptive and browser-like UA,
  with and without `Accept: application/json`). Reddit's public RSS feeds
  (`/r/brave_browser/new/.rss`) **are** reachable and are used instead; they return
  post title + selftext per entry but no comment bodies, so rows are post-level, not
  comment-level. Requests were sequential with 8-45 s gaps.
- **Apple App Store RSS.** The `sortBy=mostRecent` JSON feed for id 1052879175 returns
  `entries: 0` in every storefront tried (us, gb, ca, au) and with `page=1..10`;
  `sortBy=mosthelpful` returns 50 entries. Only most-helpful was usable, so the iOS
  rows skew toward older, canonical complaints, not last week's.
- **Apple App Store per-review links.** Apple's RSS feed exposes no per-review URL.
  Rows link to the app page with the review id as a query parameter
  (`?see-all=reviews&id=<entryId>`); the review id is real, the anchor is not. Noted
  as a limitation, not a fabrication.
- **Brave's own board** (community.brave.com, a Discourse instance) has a public
  `search.json` and `t/<id>.json` API. Used as a fourth source: 599 posts across 599
  distinct threads, 2018-10-12 to 2026-10-11.

Method: official feeds and APIs only, sequential, roughly 30 requests total
(5 App Store, 9 HN Algolia, 17 Reddit RSS, 1 Google Play page, 4 review-site probes,
12 Brave community searches plus ~600 topic resolutions). No scraping libraries against
store terms. Every quote below is a verbatim substring of a row in `reviews.csv`.

---

## 1. What they hate

Ranked by the analyzer's weighted score, then hand-checked against the quotes.

### 1.1 Built-in ads, sponsorship and the crypto rewards economy — 212 reviews, 4 sources
This is the single biggest theme and it is not about ads being blocked. It is about
Brave *also* showing ads, and about a whole revenue layer (BAT, notification ads,
sponsored new-tab backgrounds, the paid VPN bundle) that sits inside a "private"
browser. It is the theme that most often appears in the same sentence as
"I left".
- "Brave blocks their own ads while not supporting private payments and it doesn't let you use the search premium in Vanadium" (hackernews) https://news.ycombinator.com/item?id=49388579
- "Firefox doesn't sell BATs, in-browser notification ads, or new tab takeovers." (hackernews) https://news.ycombinator.com/item?id=46291855
- "Deploying Brave at a company? That defaults to Crypto ads, Crypto "sponsored backrounds", Crypto wallet, Brave news instead of Firefox (that many orgs already have in sccm/intune) + ublock origin ? bruh" (hackernews) https://news.ycombinator.com/item?id=33262975
- "Update: I am dumbfounded how quickly the crypto ads nearly disappeared after posting this review." (appstore, 5*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10513479120

**What Ziy does instead:** the reward marketplace, notification ads, sponsored
backgrounds and the token economy are all in the cut list. Ziy ships no ad
marketplace of its own and no BAT. This is a free feature of the design, not a fix.
DECISION (co-owner): the rewards/ads economy is cut entirely, not reimplemented.

### 1.2 Performance: CPU, memory, battery, stutter — 273 matching reviews, 4 sources
(analyzer "Slow, laggy, heavy": 153 reviews, avg 2.5 stars, 4 sources — the
lowest-rated complaint theme in the whole sample, which is the number that matters).
The dominant, most emotionally loaded sub-theme is **CPU and memory use**, especially on
YouTube, and especially with the browser's own background services (the BAT ledger
service is named by name).
- "for the past 2 weeks the browser has been so slow" (brave-community, 2019) https://community.brave.com/t/for-the-past-2-weeks-the-browser-is-so-slow-i-havnt-been-getting-ads-and-the-ads-i-get-i-only-get-0-005-bat-for-each-ad/243260
- "Brave slows computer to a crawl" (brave-community) https://community.brave.com/t/brave-slows-computer-to-a-crawl/438764
- "Brave is MASSIVE being 3x the size of some of its competitors such as OperaGX and nearly 2x the size of the Duck browser" (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13273175759
- "doing anything in the interface lags and pages are freezing often. Edge? fine. Chrome? handles it well." (reddit, 2026-09-30) https://www.reddit.com/r/brave_browser/comments/1wtvwyq/brave_browser_has_gotten_too_slow/
- "[Linux] Severe Memory Leak in Normal Mode - 500MB+ while Incognito/Chrome use only 11MB" (brave-community) https://community.brave.com/t/linux-severe-memory-leak-in-normal-mode-500mb-while-incognito-chrome-use-only-11mb/648737
- "I sent myself $80 of usdc on the solana chain, it doesn't show me my assets" is a wallet bug, but the same thread family is what people mean by "it got heavy": "I have had an issue this week. I have been trying to fix it but I cannot even identify the issue. Brave takes up a large amount of my CPU capabilities." (reddit, 2026-10-03) https://www.reddit.com/r/brave_browser/comments/1ww97lg/brave_high_cpu_usage/
- "There is a performance bug in https://brave.com/latest/ Version 1.60.125 Chromium: 119.0.6045.199 (Official Build) (arm64) I'm on Macbook Air M2. It's coming from the Browser Helper (Renderer)" https://community.brave.com/t/brave-drained-my-macbook-air-m2-battery-to-0-overnight/519187
- "Why is the bookmark/delete button on the left? Why can't I move it to the right? I've been trying to use Brave for years, but each time I complain about its slow and inadequate translation feature. Despite writing to the Brave community about this, I've received no response, and the situation has re" (reddit, 2026-08-29) https://www.reddit.com/r/brave_browser/comments/1w1rgso/why_has_brave_remained_the_same_for_years/

**Why this is Ziy's biggest structural win.** Brave ships a ledger service, a crypto
wallet, a VPN helper, an ad-serving subsystem and Playlist *inside* the browser
process. Ziy's cut list already removes the ledger, the token economy and the hosted
model fleet. The CPU and memory complaints are largely **self-inflicted by Brave's own
background services** — the most-liked low-level complaint in the entire corpus is a
CPU thread about the BAT ledger service:
- "High CPU usage (not fixed by 1.5.114) -- Bat ledger service" (brave-community) https://community.brave.com/t/high-cpu-usage-not-fixed-by-1-5-114-bat-ledger-service/114319
- "Brave bat ledger service 100% cpu usage" https://community.brave.com/t/brave-bat-ledger-service-100-cpu-usage/97711
- "When youtube is open brave uses more than 13% of my cpu, i have Intel(R) Core™ i7-12700H 2.30 GHz and this is huge for this type of processor, sometimes brave jumps to 19% and this causes heat spikes in my cpu" https://community.brave.com/t/brave-is-using-too-much-cpu-and-memory-with-youtube/604843
- "Optimize Browser Memory Consumption" (3 likes, people agree with the title alone) https://community.brave.com/t/optimize-browser-memory-consumption/96583
- "Not enough memory and then crash" https://community.brave.com/t/not-enough-memory-and-then-crash/421833

A browser with no ledger, no token, no wallet process and no AI runtime is *fast by
construction*. That has to be measured and published, not claimed.

### 1.3 Bugs, crashes and silent data loss — 177 reviews (bugs), 127 (sync/lost data), 4 sources
The recurring, specific, repeatable complaints are about **tabs and session state
vanishing**, which reads to users as the browser deleting their work.
- "Really REALLY freaking annoying that ill leave tabs open in brave and sometimes when i open brave the tabs won’t load. It’ll still list the tab names but the url will b empty and can’t reload it. Lost a lot of tabs that way." (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=8006314334
- "Sometimes it deletes ALL of my tabs (including my normal tabs), and although offering to reopen them, pressing reopen does nothing" (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11264176913
- "edit2: i found the reason why it deleted all my tabs, it had crashed like three times in a row and it wasn’t prepared to handle that" (appstore, 3*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10564966503
- "loved this browser until a few days ago the download folder in my ipad pro files area, just disappeared. lost all of my downloads." (appstore, 1*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=9137762110
- "it doesn't seem like brave is deleting temporary containers cache" (reddit, 2026-10-11) https://www.reddit.com/r/brave_browser/comments/1x2u7vg/it_doesnt_seem_like_brave_is_deleting_temporary/
- "Password Manager Inexplicably Failed — All my saved passwords are no longer in the password manager. What would cause this? Are they recoverable?" (reddit, 2026-10-11) https://www.reddit.com/r/brave_browser/comments/1x3m9gd/password_manager_inexplicably_failed/

### 1.4 Shields breaking the web, then a per-site whack-a-mole — 38 matching reviews, 4 sources
This is the sharpest "love it, but" in the corpus: the most upvoted iOS complaint that
mentions the product is a 2-star review whose whole thesis is that the ad blocker is
too aggressive to be usable, and that there is no way to remember what worked.
- "This is a nice effort by the developers, but it simply breaks too many websites to be useful. I would say I had to turn the Brave shields off on about 40% of the sites I visited that had any kind of complexity to them at all." (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10949756251
- "The only way something like this is going to work is if the browser can learn which websites work with which shield functions" (appstore, 2*) — the same review, and it is the most actionable single sentence in the whole corpus: https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10949756251
- "all YouTube videos fail to load on Brave v1.97.56 on macOS unless I explicitly disable "Disable Fingerprinting" under the Shields advanced config" (reddit, 2026-10-11) https://www.reddit.com/r/brave_browser/comments/1x2yfvq/youtube_not_working_with_block_fingerprinting/
- "The content only plays like 20s of any episode then stops. Will not go past that." (reddit, PeacockTV, 2026-10-11) https://www.reddit.com/r/brave_browser/comments/1x3icmp/peacocktv_ads_blocked_but_peacock_says_turn_off/
- "RedShelf, an electronic textbook library, cannot be accessed from the Canvas webpage, as it tells me that cookies have to be enabled. Even going through the settings and fully turning off Brave Shields cannot solve the issue." (appstore, 4*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11683125228
- "I've just swapped from Firefox to Brave and signed into HBO MAX and for some reason the video on it doesn't playback." (reddit, 2026-09-13) https://www.reddit.com/r/brave_browser/comments/1wf5j5j/brave_browser_is_not_allowing_streaming_to_play/

### 1.5 Forced-in features you cannot switch off — 7 direct "cannot turn off" rows, 99 rows mentioning AI/Leo across 4 sources
Leo is the flagship case, and it is a **retention** complaint, not a feature complaint:
people say they installed a privacy browser to escape Google's forced AI and then found
the same thing inside.
- "now even brave has forcibly integrated AI into the browser without a way to turn it off. I’ll be looking for something else." (appstore, 1*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11197237131
- "Why are you shoving this AI garbage down our throats? If I wanted an AI assistant, I would install one. I do not want one. I do not want it to learn from my data. I don't want it taking up space or using my CPU. I don't want it making suggestions or" (brave-community, 13 likes — the single most-liked complaint in the corpus) https://community.brave.com/t/how-do-i-remove-leo/544520
- "I wish this was made optional, and you could turn it off instead of it being stuck there." (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11264176913
- "Additionally the ai integrations aren’t needed, the product is strong and is able to deliver without buzzword features that pose unnecessary security risks." (appstore, 3*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13660609792
- "Procedurally generated text will appear every time you search something, and it clogs up the top of the search page, so if you don’t want to read it, you need to scroll past it, and it tends to be long." (appstore, 3*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11628981142
- "Answers are garbage slop, not properly researched, sometimes hallucinations, sometimes twisted info" (reddit, 2026-10-12) https://www.reddit.com/r/brave_browser/comments/1x3vk06/did_the_ai_just_suddenly_get_much_worse/
- "Most of the time, LEO AI is incredibly slow and sometimes freezes without completing its response" (brave-community) https://community.brave.com/t/brave-leo-ai-is-not-working-properly/659303

Brave's own answer to this was to charge $59.99 for a version with the revenue
features removed — the "Brave Origin" subscription is quoted in the corpus and it is
evidence that users wanted a lean browser badly enough to pay for one:
- ""Brave Origin is a minimalist version of Brave that allows users to disable the revenue-generating features that otherwise support Brave as a business" * Leo * News * Playlist (iOS only) * Rewards ... * Talk * Tor * VPN * Wallet ... * Wayback Machine * Web Discovery Project $59.99" (hackernews) https://news.ycombinator.com/item?id=47813286
- "Brave Origin is lovely." (reddit, 2026-09-16) https://www.reddit.com/r/brave_browser/comments/1wibbxj/brave_origin_is_lovely/

**Ziy's position:** the AI assistant is already gone from the product. Ziy is that
lean browser for free. This complaint is *answered*, and it becomes positioning.

### 1.6 Trust and privacy-reputation damage — 14 reviews citing affiliate-link rewriting, ad replacement and hidden monetisation
Concentrated on Hacker News (13 of 14) but it is the theme that stops recommendation,
which is why it matters commercially even at low volume.
- "Wasn't Brave browser caught replacing ads with its own? And the Honey extension replacing / injecting referral codes?" (hackernews, 2026-10-08) https://news.ycombinator.com/item?id=50012486
- "In 2020, the company was found to be appending affiliate referral codes to the end of certain cryptocurrency exchange URLs typed into the browser's address bar." (hackernews) https://news.ycombinator.com/item?id=46513502
- "In 2022, Brave faced further criticism for bundling its paid virtual private network (VPN) product, Brave Firewall + VPN, into installation" (hackernews) https://news.ycombinator.com/item?id=46513502
- "all my devices that on my network I took the browser off everything because these guys are using the we value privacy and are different than google and all them" (appstore, 1*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13475032771
- "Brave has certainly said a lot of good things while doing quite [0] a lot [1] of bad [2] things [3] that make me think it's mostly just marketing to lower-knowledge users that's carrying it forward." (hackernews) https://news.ycombinator.com/item?id=49321631

---

## 2. What is missing

Named asks, in the users' own words.

### 2.1 A shields state that is per-site and remembered — 38 reviews, 4 sources
Not a feature request for a new feature: a request that the current one remember.
- "The only way something like this is going to work is if the browser can learn which websites work with which shield functions" (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10949756251
- "I wish this was made optional, and you could turn it off instead of it being stuck there." (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11264176913
- "One suggestion: I would love to see the "clear data" function be accessible in the "…" menu, so I can clear my data and history with 2-3 taps instead of 5 taps and scrolling (I counted)." (appstore, 5*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=7445302558

### 2.2 A usable mobile tab switcher and one-handed reach — 39 matching reviews, 4 sources
- "Need a gallery of browser tabs — Brave is an amazing browser for iOS! It comes in with the best ad blocker and most private search ... I would like to let the developers know that whenever I open my browser tabs, I would constantly have to stretch my thumbs to close the tab. If there was a gallery of tabs that I could swipe up and tabs would show and the close button was on the bottom or on the tool bar, that would make life for my thumb easier." (appstore, 5*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10688481668
- "Then make the tabs UI more vertical so you can clear tabs without having to reach up on your screen." (appstore, 3*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=9125722658
- "the placement of the X to clear the text is in a terrible position. I can’t tell you how often I try to tap to place my cursor on the right near the X in order to delete a couple of characters near the end of the text as I type and see typos, and tapping near the X (not even directly on it) clears all of the text in the window. It’s so frustratingly often that there are times when I just switch to the Firefox Focus browser instead." (appstore, 4*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13351562548
- "I love the Brave Browser with one massively annoying UI issue" — the whole 4-star review is one placement bug (appstore) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13351562548

### 2.3 Vertical tabs and real power-user tab handling — 6 direct "vertical tabs" mentions, 166 tab-management reviews
- "Moved the whole house to Brave earlier this year and finally started using vertical tabs on my work laptop. Screen real estate is nice, but muscle memory from fifteen-plus years of horizontal tabs is real. I find myself hunting for the close button and losing track of which tab is active" (reddit, 2026-10-12) https://www.reddit.com/r/brave_browser/comments/1x3ti76/vertical_tabs_in_brave_worth_the_switch_from/
- "I really need proper tabs handling (I have 100 tabs) so most probably need a vertical t" (hackernews) https://news.ycombinator.com/item?id=43253617
- "why would I want to switch to the tab on the left of my current tab? Usually tabs are not sorted, so this option seems useless for an efficient switching" (brave-community, 11 likes — most-liked feature request in the corpus) https://community.brave.com/t/use-ctrl-tab-to-switch-to-the-last-used-tab-instead-of-left-or-right-tab/44681
- "A tab bar scrolling feature like FF would be handy, an" (brave-community, 2 likes) https://community.brave.com/t/85-open-tabs-and-then-any-new-tabs-just-disappear/62279

### 2.4 A working dark mode and a real page-level night mode — 6 matching reviews, 4 sources
Small count but it is pure product hygiene and cheap:
- "you cannot have a reliable dark mode, when every page loads in white even while in dark mode. 2. your night mode makes no sense and just inverts the colors….so on pages that are white they go black, but on pages that are black because they are in dark mode, they go white. all images are inverted as well. I could just invert the app through ios accessibility, this is not a feature guys. Make a legitimate dark mode that works." (appstore, 1*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10177933931

### 2.5 Password viewing, autofill and import on mobile — 32 password reviews, 4 sources
- "there is no way to view my Brave passwords on mobile (at least for iOS). This is extremely annoying because then I have to hop on my computer and spend a couple minutes opening up my passwords and finding the correct one." (appstore, 4*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=7581005738
- "Really wish i could import my old safari bookmarks." (appstore, 2*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=8006314334
- "one feature that I notice is missing — and that virtually every other major browser on iOS (Safari, Chrome, Firefox, and others) already supports — is the ability to add a website directly to the iPhone Home Screen as a standalone shortcut" (appstore, 3*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=14127630803

### 2.6 Update control — thin (2 matching reviews, 1 source)
- "There should be an option for determining if updates are automatically downloaded or not. If they are, allow setting days/times or anytime to do so. For those of us on metered connections this matters...." (brave-community, 5 likes) https://community.brave.com/t/option-to-turn-on-off-auto-update-downloads-and-when-to-install-the-updates/67409
Thin. Two reviews in one source. It is on this list because it is cheap, not because
it is a trend.

### 2.7 Support that answers — thin (7 reviews, 3 sources)
- "I commented these suggestions in the community forum, but this company seems to not care." (appstore, 1*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10177933931
- "Despite writing to the Brave community about this, I've received no response, and the situation has re" (reddit, 2026-08-29) https://www.reddit.com/r/brave_browser/comments/1w1rgso/why_has_brave_remained_the_same_for_years/
Thin. Do not build a support system; do fix the two named, specific, repeatedly
reported items (translation slowness, bookmark-side placement) that nobody answered.

---

## 3. What is unsolved (and what Ziy deliberately does differently)

### 3.1 The AI assistant — unsolved by Brave, removed by Ziy. 99 reviews across 4 sources.
Brave never solved "AI I did not ask for". Its three attempts — a toggle that does not
go far enough, a slower model, and finally a paid $59.99 build with Leo stripped out —
are all visible in the corpus. Ziy's cut list already removed the assistant entirely,
and the hosted model fleet went with it. Complaints here are ranked **unsolved for
Brave / solved by design for Ziy**, and are not a build request.
- "Most of the time, LEO AI is incredibly slow and sometimes freezes without completing its response" https://community.brave.com/t/brave-leo-ai-is-not-working-properly/659303
- "Leo should let me upload different types files like Claude does. I want to paste code, documents, or zips into conversations." https://community.brave.com/t/file-uploads-leo-should-let-me-upload-different-types-of-files-like-claude-does/657887 — the clearest proof that Leo's job is being done better elsewhere.
- "What a great and superior product, now we just need an app or home system for Leo." (appstore, 5*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13494682858

### 3.2 The crypto wallet and BAT — unsolved by Brave, mapped to Ziy's local wallet slice. 259 reviews, 4 sources.
Brave's wallet complaints are a mix of real product bugs and structural confusion
between a *local* wallet and a *custodial* reward ledger. The redeemable part is the
local wallet: a wallet that shows assets, sends, and connects to hardware without an
account, a region check or a Uphold intermediary.
- "I sent myself $80 of usdc on the solana chain, it doesn't show me my assets, and it doesn't even send them to other addresses, but I know they're there because I tried to bridge between eth and usdc, but it tells me that I have insufficient money, how do I solve it?" (reddit, 2026-09-21) https://www.reddit.com/r/brave_browser/comments/1wm3d43/brave_wallet/
- "Wallet linking failed Your wallet cannot be verified because you’ve reached the maximum verified device limit." (brave-community) https://community.brave.com/t/wallet-linking-failed-your-wallet-cannot-be-verified-because-youve-reached-the-maximum-verified-device-limit/292447
- "Error: Region not supported Unfortunately, your Brave Rewards cannot be verified because your region is not supported for Brave Rewards verification" (brave-community) https://community.brave.com/t/error-region-not-supported-unfortunately-your-brave-rewards-cannot-be-verified-because-your-region-is-not-supported-for-brave-rewards-verification-at-this-time/398056
- "Brave wallet and brave rewards so much confusion — So I can't connect breve rewards with brave wallet(salona or ethicaten smthng I don't know the exact spelling) until i already have some money inside it ?" (reddit, 2026-08-28) https://www.reddit.com/r/brave_browser/comments/1w0m1pf/brave_wallet_and_brave_rewards_so_much_confusion/
- "I have a problem with accessing a Ledger Hardware Wallet with the Brave browser. I've tried using Lace, Eternl and SecondFi and they all connect via USB in Chrome but won't connect in Brave." (reddit, 2026-06-16) https://www.reddit.com/r/brave_browser/comments/1u70ryj/brave_browser_and_ledger_hardware_wallet/
Ziy's local wallet slice must therefore ship three specific guarantees Brave's does not
have: no region check, no device limit, no intermediary. All three are named in the
complaints above.

### 3.3 A browser that is not a company — unsolved by Brave, structural in Ziy
Every one of the themes above eventually resolves to the same sentence: the browser has shareholders.
82 reviews across 4 sources are literally about leaving. Ziy's structure (no account,
no token, no hosted model fleet, no marketplace) is the answer, but only if the proof
is measurable and published.
- "Every time brave gets walked out as some good alternative I cant get past the vc / crypto coin / brave-reward holding garbage." (hackernews) https://news.ycombinator.com/item?id=46865734
- "I just turned off all the crypto stuff." (hackernews) https://news.ycombinator.com/item?id=49515148
- "I switched from brave(ios) to Orion about a month ago and almost I didn't look back." (hackernews) https://news.ycombinator.com/item?id=48978453
- "After 6 Months Switched Back to Chrome" (appstore, 2* title) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10949756251

---

## 4. The fix plan

Ranked by evidence x cheapness. "Skill" is which existing skill builds it.

### 1. Shields that remember, per site — size **S** — `replica-build`
The cheapest high-value fix in the corpus, and users wrote the spec for it. Store a
per-origin shields override (default off/on per filter class), surface a "site is
degraded, relax shields?" prompt when a page fails to load or a video stalls, and
remember the answer. Removes the whack-a-mole that produced the 2-star
"After 6 Months Switched Back to Chrome" review. Evidence: 38 reviews, 4 sources
(theme 1.4 / 2.1).

### 2. Session and download durability — size **M** — `replica-build`
Tabs, sessions, downloads and the password store must survive a crash, an update and
a force-quit, and the reopen button must actually work. Brave's recurring failure is
"pressing reopen does nothing". Write the restore point on every state change, verify
it with a kill-the-renderer test in CI. Evidence: 177 + 127 reviews, 4 sources
(theme 1.3).

### 3. A measured resource budget, published — size **S** — `replica-diff`
There is no ledger, no wallet process, no AI runtime and no ad subsystem in Ziy, so
the baseline is already better than Brave's *before* any tuning. Turn that into a
number: idle RSS and CPU, CPU+memory on a fixed YouTube page, cold start, and put all
four on the project's parity page, refreshed each release. Evidence: 273 matching
reviews, 4 sources; the lowest-rated complaint theme in the sample (avg 2.5 stars).

### 4. Mobile tab ergonomics — size **M** — `replica-design` + `replica-build`
A bottom-reachable tab switcher (close on the bottom edge, swipe up), a clear-field
button that does not sit under the typing thumb, and correct one-handed reach for the
main controls. Directly answers the "stretch my thumbs" and "X is in a terrible
position" reviews. Evidence: 39 reviews, 4 sources (theme 2.2).

### 5. Tab power features: vertical tabs, ctrl-tab MRU, tab-bar scrolling — size **L** — `replica-build`
Three named asks, one cluster, cheap in design terms and expensive in the tab model.
Ctrl-tab to last-used is the single most-liked feature request in the whole corpus
(11 likes, 2019, still open). Vertical tabs handle the "100 tabs" case. Evidence:
6 direct + 166 tab-management reviews, 4 sources (theme 2.3).

### 6. Local wallet guarantees: no region check, no device limit, no intermediary — size **M** — `replica-build`
**ARCHIVED — cut, superseded by the co-owner's product decision (2026-10-14): Ziy ships
no crypto wallet at all**, so there are no wallet guarantees left to make; see §3.2,
`replica/features.csv` (status `cut`) and the §2.3 "Not built" note in
`replica/architecture.md`. Kept for the research record: 259 reviews, 4 sources
(theme 3.2); the original ask below.
Ziy's wallet slice already exists in the plan; this adds three specific guarantees the
complaints name explicitly, plus Ledger/hardware USB connectivity. Evidence: 259
reviews, 4 sources (theme 3.2).

### 7. Credible privacy posture by construction — size **M** — `replica-brand`
No token, no marketplace, no affiliate rewriting, no sponsored new-tab. Make it
auditable: a published, machine-readable list of every network endpoint the browser
phones home to (none, by default) and a first-run screen that says so. This is the
answer to the 14 reviews about affiliate links and ad replacement, and to the
"marketing to lower-knowledge users" distrust. Evidence: 14 reviews, 4 sources
(theme 1.6) plus 82 leaving reviews (theme 3.3).

### 8. Real dark mode, and per-site shields surfaced in one tap — size **S** — `replica-design`
A dark mode that themes the app and forces a page-level dark filter that is not blind
colour inversion, plus "clear data" reachable in 2 taps from the main menu. Evidence:
6 + 3 reviews, 4 sources (themes 2.4, 2.1). Small, visible, cheap, and currently
answered with "not a feature guys" by Brave.

**Deliberately not on the plan:** an AI assistant (removed from Ziy; complaints about
Leo rank under 3.1), a token economy or ad marketplace (cut list), and a hosted model
fleet (gone). VPN is not in this plan either — Brave's VPN complaints are mostly
billing and bundling, which belong to `/replica-launch`, not to the browser.

---

## 5. Three positioning options

```
For {{who}} who {{hate this about the original, in plain words}},
{{your app}} {{does this instead}}.
Evidence: {{theme}}, {{n}} reviews across {{n}} sources.
```

**Option A — the lean browser (recommended).**
For people who installed an ad-blocking browser to escape Google's forced features and
then watched it grow an AI assistant, a crypto wallet, a token, a news feed and a VPN
inside the same process — who hate that the browser they chose for being small is now
the heaviest thing on their machine — Ziy is a browser with nothing in it but browsing:
no assistant, no token, no marketplace, no hosted models, and a measured CPU and memory
budget instead of a claim.
Evidence: "Slow, laggy, heavy" 153 reviews across 4 sources (avg 2.5 stars, the
lowest-rated complaint theme) plus 99 reviews naming AI/Leo across 4 sources, including
the most-liked complaint in the corpus: "Why are you shoving this AI garbage down our
throats?" https://community.brave.com/t/how-do-i-remove-leo/544520

**Option B — the browser that does not break the web.**
For people who want the ads blocked *and* the site working — who are tired of turning
shields off on half the sites they visit, and of a browser that cannot remember which
sites needed the exemption — Ziy blocks by default, learns per site, and asks once
instead of making you repeat the whack-a-mole.
Evidence: "After 6 Months Switched Back to Chrome" (2*) 38 reviews across 4 sources:
"I would say I had to turn the Brave shields off on about 40% of the sites I visited
that had any kind of complexity to them at all."
https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=10949756251

**Option C — the browser that is not a company.**
For people who stopped trusting a browser the moment they found it rewriting URLs for
affiliate money, shipping a token, and charging $59.99 for a build with the revenue
features taken out — who want a browser with no shareholders to answer to — Ziy has no
account, no token, no ad network and no hosted model, and publishes every endpoint it
would ever contact (none by default).
Evidence: 14 reviews across 4 sources citing affiliate rewriting and ad replacement,
plus 82 leaving reviews:
"Every time brave gets walked out as some good alternative I cant get past the vc /
crypto coin / brave-reward holding garbage." https://news.ycombinator.com/item?id=46865734

### Recommendation: **Option A, carrying Option C's proof inside it.**
Option A is the only one that is already true before a single line of new code — the
cut list is the feature, and the corpus shows the demand is for a *small* browser more
than for a particular one ("Brave Origin is lovely", 5-star reviews that still complain
about size and forced features). Option B is the strongest product argument but is a
fix, not an identity; it belongs on the parity page under Option A. Option C is the
sharpest differentiator for the Hacker News audience but is a belief, not a demo, and
beliefs need evidence — so C's auditable-endpoint-list requirement ships as part of A.

Risks to manage: "fast by construction" must be measured (fix 3) or it is just
marketing, which is precisely the accusation in theme 1.6. And a browser with no AI,
no wallet and no VPN will read as feature-poor to a store listing audience — the NTP,
the shields panel and the measured numbers have to carry the story instead.
