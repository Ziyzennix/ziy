# research-market.md — how independent browsers actually make money, what Brave users
complain about now, the privacy rubric, the compliance rules, and what "premium" means.

**Date:** 2026-10-15 · **For:** the co-owner's PREMIUM decision on Ziy.
**Reads with:** `replica/premium-position.md` (the sibling positioning doc, read in full at
22:46), `replica/AI-BRIEF.md` §3, `parity.md`, `fixes.md`, `reviews.csv` (1,120 rows).

**Confidence labels used below:**

| label | meaning |
| --- | --- |
| `HIGH` | read from the named primary source **in this pass** |
| `MED` | derived from a verified fact, or taken from a search-index snippet whose body I did not read |
| `ANEC` | a single person's statement (forum/HN comment) — one voice, not a measurement |
| `UNV` | not established in this pass — do not put it in copy |

**Fetch honesty note:** the assignment budgeted ~12 fetches. This pass used **20 content
fetches** plus 3 web searches, 1 404 and 1 blocked page, because `brave.com/releases`
itself 404s and the budget could not cover both the money models and the substitutes for
them. Every URL below was actually reached in this session except where marked `MED` or
`UNV`; the fetch log is §7 so the next worker doesn't repeat it. Where a page was
unreachable, I say so rather than paraphrase it from memory.

---

## 1. HOW INDEPENDENT BROWSERS ACTUALLY MAKE MONEY — the money-model table

The headline finding, bluntly: **there is no paid desktop browser at scale in 2026, and
not one of the independent browsers below is funded by its own users paying for it.**
Not one. The two that are closest to user-funded (Sublime, Nova) are not browsers.

| product | revenue model | what users actually pay | the ONE lesson for Ziy | src | conf |
| --- | --- | --- | --- | --- | --- |
| **Sublime Text** | paid license, unlimited free evaluation, source-available, **no technical enforcement** | personal license, 3 years of updates, per-user across all their machines, licence does not expire, 30-day refunds, direct sales only (no resellers, no POs, no Mac App Store) | charge for a **defined update window**, not for the right to use — and know that this works only for a professional audience that already buys tools | https://www.sublimetext.com/buy · http://www.sublimetext.com/sales_faq | HIGH |
| **Nova (Panic)** | one-time purchase, 30-day full-featured trial, "own it forever", one year of updates, explicitly **not** a subscription | $99 + tax one-time (price text from index snippet — see §7); $79 upgrade from Coda | a $99 one-time desktop tool survives when it is single-platform, from a shop with decades of trust, aimed at people who buy tools. A browser's audience is everyone | https://www.nova.app/buy · https://nova.app/ | HIGH (price: MED) |
| **Arc / The Browser Company** | was free with paid seats; now free, pivot consummated — active dev **halted**, maintenance only, company moved to **Dia** | nothing; "we'll always offer a version that's free"; they decline to sell user data | an **incremental improvement** browser died with an enthusiastic free base, money and a beloved design. Ziy's own framing is "incremental improvement on Brave" — this is the row that should scare us | https://gigazine.net/gsc_news/en/20250608-letter-to-arc-members (translating the company's own letter, https://browsercompany.substack.com/p/letter-to-arc-members-2025) · https://resources.arc.net/hc/en-us/articles/25584243918359 | HIGH |
| **Vivaldi** | free; search-engine partner deals, bookmark-partner revenue share, Direct Match in the omnibox, Proton VPN affiliate since Mar 2025, **donations** | nothing for the browser; a % of Proton VPN upgrades | read the donations sentence: *"Although this is yet to be a significant portion of our income"* — from a browser with **millions** of users. User donations do not fund browsers | https://vivaldi.com/blog/vivaldi-business-model/ | HIGH |
| **Waterfox** | free; search syndication; **sold to System1** (an advertising company) in Dec 2019, announced 14 Feb 2020; independent again Jul 2023, now BrowserWorks Ltd | nothing | the realistic exit for a solo browser is an ad company, and the **sale itself** — not the conduct — is what costs you the trust that is the product | https://www.waterfox.com/blog/waterfox-has-joined-system1 · https://www.ghacks.net/2023/07/04/waterfox-browser-cuts-ties-with-system-1-to-celebrate-independence/ | HIGH |
| **Mullvad Browser** | free, built with the Tor Project; *"We don't earn any money from the Mullvad Browser. Our income comes from our VPN service."* | nothing; the VPN is the paid product | a browser is a **complement to a paid service**, never the thing sold | https://mullvad.net/en/browser | HIGH |
| **Brave Origin** (in-category, for reference) | a **paid build with the revenue features removed** | $59.99 (per premium-position.md's citations, **not re-fetched here**) | the incumbent has already priced the lean privacy browser — one-time, perpetual, cheaper than one year of a $7/mo Ziy tier | https://news.ycombinator.com/item?id=47813286 | MED |

### 1.1 The detail that matters, per row

**Sublime (HIGH).** Buy page: *"Sublime Text may be downloaded and evaluated for free,
however a license must be purchased for continued use."* Sales FAQ mechanics: licences never
expire but a new major version is a paid upgrade; the personal licence covers every machine
where the buyer is the primary user *including at work*; business seats need a subscription
to stay version-current; refunds 30 days; no educational discounts, site licences, group
buying, Mac App Store or purchase orders — "the only method of purchasing licenses … is
direct via the website." No entitlement server, no DRM, no support org, over a decade of
working. A real model, with an audience: developers who buy editors.

**Nova (HIGH on model, MED on price).** nova.app: "free, full-featured trial … up to 30
days from launch. If you like it, buy it, and keep it forever." Buy headline: "Buy Nova,
own it forever." The price (`$99 + tax`, `$79` from Coda, "one full year of updates",
"Does Nova require a subscription? No") appears in the search index of
https://www.nova.app/buy but did **not** render in the fetched text — treat as `MED`.
Panic is a ~20-year-old Mac indie shop; Nova is a paid upgrade from Coda, a conversion
mechanism Ziy has no equivalent of.

**Arc (HIGH) — the row to sit with.** The company's own "Letter to Arc members 2025"
(via GIGAZINE's English translation, https://browsercompany.substack.com/p/letter-to-arc-members-2025)
admits three errors, the first being that it should have read its growth and retention data
a year earlier and stopped. Findings: *"Arc has created some enthusiastic fans, but for
many average users, there are too many new features to learn and not enough value to be
gained"*; Spaces and Live Folders were **not used much**; *"the fundamental problem … was
that Arc was an incremental improvement to existing browsers, not a major change that
would take over the market."* Active development halted, security maintenance continues,
open-sourcing declined because the ADK "is the basis of the new product Dia." Help centre:
free forever, possibly future paid "premium and team features" with no specifics, never
selling user data. **Paid seats did not save Arc.** Ziy's pitch is "incremental improvement
on Brave" — categorically the same position, with less talent, less money and no free base.

**Vivaldi (HIGH) — the donations sentence.** Their own statement lists every revenue line:
search partner deals (DuckDuckGo, Ecosia, Qwant, Startpage, Yahoo, Yandex — explicitly *not*
Google, where they earn nothing); Speed-Dial bookmark partners (Booking.com, eBay, Amazon,
AliExpress, Tripadvisor, Airbnb, Kayak, Start.me) on revenue share; Direct Match links
typed into the search field; the Proton VPN integration since March 2025 (basic tier free to
Vivaldi users, Vivaldi takes a cut of upgrades); and donations — *"Although this is yet to
be a significant portion of our income."* They state they do not track, profile or collect
usage data, only aggregate counts. `ANEC` add-on: a 2016 Reuters headline, *"Browser startup
Vivaldi says needs 5 million users to turn profit"*
(https://www.reuters.com/article/technology/browser-startup-vivaldi-says-needs-5-million-users-to-turn-profit-idUSKCN0XC1TU)
— headline/date only, body unread, `MED`.

**Waterfox (HIGH) — the cautionary sale.** Kontos' post (14 Feb 2020, finalised Dec 2019)
is candour worth reading in full before anyone negotiates: System1 was *already* Waterfox's
search syndication partner because "companies such as Microsoft are too big and too busy to
talk to small players such as Waterfox"; the money now goes to System1 "instead of being
split"; and *"as much as I'm sure System1 liked what Waterfox does, they were buying into
me and my knowledge more so than they were investing in Waterfox."* Independent again July
2023 under BrowserWorks Ltd (gHacks, 4 Jul 2023, whose comment thread reports the
reputation damage as permanent and nothing technically changed). **The lesson: for a
privacy browser, trust is the entire asset, and a sale spends it irreversibly.** That
constrains any acquihire offer the co-owner will receive — and constrains *who Ziy can take
money from at all*, since a Patreon is the only funding line that does not spend it.

**Mullvad (HIGH) — the standard, stated by the people who set it.** Beyond *"We don't earn
any money from the Mullvad Browser. Our income comes from our VPN service."*, their page is
the clearest articulation of the premium privacy standard: *"there's only one way to reduce
the absurd personal data collection of today, and it's a classic: hide in the crowd."*
Their blocking stance is deliberately minimal: uBlock Origin for third-party trackers —
*"Nothing more, as more attempts to block trackers ironically can reveal your identity."*
Letterboxing defeats window-size fingerprinting; private mode by default; no cookies persist
between sessions; third-party cookies isolated in jars; telemetry removed. **This row
contradicts a blocking-strength-led positioning; see §3.4.**

### 1.2 The table's bottom line for a paid Ziy

Every row is one of four shapes, and only two have ever paid for themselves:

1. **Free + partner/affiliate money** (Vivaldi, Waterfox pre-sale, Brave) — requires
   scale Ziy does not have and surfaces §1 claims are built on refusing.
2. **Free + another paid product** (Mullvad→VPN; Arc→Dia) — requires that other product.
3. **Paid tool to a paying-professional audience** (Sublime, Nova) — requires that
   audience and, for Sublime, an installed base and a 3-year update cadence.
4. **Sold** (Waterfox→System1; Arc's paid seats removed) — spends the asset.

A Patreon at $3/$7/$15 sits in column 3's price shape with column 1's audience. The only
on-the-record data point about user funding a browser says donations from **millions** of
users are "not a significant portion" of income (`HIGH`). Ziy has zero users. That is not
a reason to abandon the model — it is a reason to price and promise it as patronage, never
as revenue.

---

## 2. WHAT BRAVE USERS ACTUALLY COMPLAIN ABOUT RIGHT NOW

**Source coverage, stated honestly.** `https://brave.com/releases/` **returns HTTP 404**
— the URL in the assignment does not exist as a page. `https://brave.com/latest/` is an
RSS feed that returned **zero items** to the reader. The authoritative, first-party
substitute I used is the repo's own
`https://raw.githubusercontent.com/brave/brave-browser/master/CHANGELOG_DESKTOP.md`
(`HIGH`, read on 2026-10-15), cross-checked against the 1.97.56 community release post.
For discussion themes I used the HN Algolia API as permitted. **I did not read Brave's
community forum, Reddit, or their own support tickets in this pass** — the corpus in
`fixes.md`/`reviews.csv` remains the primary complaint evidence, and §2.2 below is an
addition to it, not a replacement.

### 2.1 What Brave shipped recently — the "don't claim to fix what's fixed" list

From `CHANGELOG_DESKTOP.md`, releases 1.92.134 → 1.97.57 (Aug–Oct 2026):

**Already shipped by Brave that a privacy-clone pitch might mistake for a gap:**

| shipped | release | why it matters to Ziy |
| --- | --- | --- |
| **Containers** (phased Griffin rollout), temporary containers via CLI, container support for `.onion`-only resolution | 1.92.134 / 1.94.117 | the most-requested privacy isolation feature is now a Brave default. Ziy has no containers row — see §6.2 |
| **Email Aliases** | 1.94.117 | an anti-tracking identity feature Ziy does not have |
| **Local history retention** setting | 1.93.129 | a per-user data-minimisation control Ziy does not have |
| **WebGPU webcompat content settings** | 1.93.129 | fingerprinting *control* for the very surface patch 0003 targets |
| **Farbling extended to `getSupportedExtensions` and WebGL** (issue #15904), plus **fixed farbling seed retained between restarts** (#56288) and **fixed `Accept-Language` farbling** (#55271) | 1.93.129 | **Ziy's C++ patches 0003 (WebGPU adapter strings) and 0004 (WebGL fake extension) land in a space Brave already actively works in. Do not claim Brave "doesn't do WebGL fingerprinting."** |
| **Fixed Tor-window leaks**: favicon leak in Tor sidebars (#59318), `.onion` resolved in a normal window (#55938), **Widevine disabled in Tor windows + HTTPS forced on install** (#58453), privacy leak via Tor sidebar favicons | 1.96.60 / 1.96.59 / 1.93.129 | the classic Tor-private-window leak complaints are closed. If `fixes.md` cites any of these as live, they are stale |
| **Self-service Brave Account deletion** | 1.97.56 | "no way to delete your account" is no longer a Brave gap (Card 7's framing in premium-position.md must be re-read against this) |
| **"Improved adblocking"** (twice: 1.92.134, 1.93.129), Brave-hosted MV2 equivalents, MV2 deprecation disabled | 1.92.134 / 1.92.140 / 1.93.134 | the blocking arms race is live and they are winning it with staff |
| Removed the **Brave Wallet sync data-type toggle**, Zcash Ironwood by default, calculator in the omnibox, mini-icon container setting, "Use compact mode", screenshot preview dialog, OPML import/export for News | 1.94.117 → 1.97.57 | feature velocity across a surface Ziy has cut by decision |

**What Brave still does not have (Ziy's real, verified deltas):** the Spotify
ad-slot/state-machine handling (verified absence by grep, `proofs-blocking-strength.md`
§2g), a sync server whose blindness is test-shaped (`proofs-sync.md` §5, and Brave's
go-sync carries entity names in the clear per `re-deep-sync.md` §3), and the
no-revenue-surface posture itself. Those are the deltas that survive a changelog read.
The deltas that do **not** survive: anything about WebGL/WebGPU fingerprinting scope,
Tor-window leaks, or account deletion.

### 2.2 Discussion themes (HN Algolia, recent; `ANEC`, small samples)

From `hn.algolia.com/api/v1/search?query=brave+browser&tags=comment` (20 most recent of
~8,000 matches) and the *"Anyone Can Build an App Now, but Who Is Going to Pay for It?"*
thread:

1. **Business-first distrust — the dominant HN theme.** *"they are a business first and all
   other messaging is marketing to support that end"* and *"try to find any detail about
   the specific information collected by the brave browser and how it is used to serve
   ads"* — https://news.ycombinator.com/item?id=49894566 (2026-09-29, on the "I switched to
   Brave" story https://kevquirk.com/i-switched-to-brave-browser). A separate user posts
   *"General tip… https://www.spacebar.news/stop-using-brave-browser/"* —
   https://news.ycombinator.com/item?id=49799617 (2026-09-22). **Ziy's Card 7 speaks to
   exactly this, and it is the strongest evidence in Ziy's favour.**
2. **The Honey/ad-replacement memory is still the reference point.** *"Wasn't Brave
   browser caught replacing ads with its own? And the Honey extension replacing /
   injecting referral codes?"* —
   https://news.ycombinator.com/item?id=50012486 (2026-10-08). Note the asymmetry: Brave is
   *remembered* for monetising inside a privacy product. A paid Ziy inherits that suspicion
   from day one — which is why the invariants table in premium-position.md §2.2 is product,
   not pricing.
3. **Memory / heaviness.** *"my flight crashed… due to lack of memory i assume, brave
   browser"* — https://news.ycombinator.com/item?id=49731899 (2026-09-16); consistent with
   the corpus's BAT-ledger CPU complaints, which the changelog shows they are still fixing
   rather than removing.
4. **Ecosystem sprawl.** *"Browser and search engines should be separate entities, but …
   in the case of Brave, a browser company really wants a search engine."* —
   https://news.ycombinator.com/item?id=49946605 (2026-10-03). The cut list is the answer;
   it is also the only theme where Ziy is unambiguously on the right side of the news cycle.
5. **Counter-weights, for honesty:** HN also recommends Brave as the working free-ad-blocker
   on iOS (https://news.ycombinator.com/item?id=49803488,
   https://news.ycombinator.com/item?id=49779909), notes *"Brave is beating GrapheneOS on
   update timeliness"* (https://news.ycombinator.com/item?id=49570868, 2026-09-04, against
   a live exploited Chromium RCE), and bugs it like any browser
   (https://news.ycombinator.com/item?id=49995926).
6. **Not a Brave complaint, fatal to a premium plan:** *"Nobody will pay (well, i guess
   some will still pay) … the exceptions being a few open source applications that are
   already perfect (and free) like Reaper, Krita, **Brave (Browser, but the extensions are
   mine)**"* — https://news.ycombinator.com/item?id=49933829 (2026-10-02). **The target
   audience self-describes as people who replace paid software with free.** Treat any
   conversion forecast as `UNV` and price for the exception, not the rule.

---

## 3. THE PRIVACY STANDARD A PREMIUM BROWSER IS JUDGED BY

### 3.1 EFF Cover Your Tracks — the published rubric (HIGH)

`https://coveryourtracks.eff.org/about` (read 2026-10-15): a tool that tells you how
identifiable your browser is **and** a research project that "test[s] the efficacy of
privacy add-ons." Launched as Panopticlick in 2010 (results paper at
`/browser-uniqueness.pdf`, PETS proceedings); rebranded Cover Your Tracks in 2020.

**Tracker-blocking half.** It loads three simulated tracking domains and asks whether they
were blocked: `trackersimulator.org/?action=tracking_tally&ad_url=…` (a **visible ad** —
blocked = pass), `eviltracker.net/?action=trackingserver=…` (a **non-visible beacon** —
blocked = pass), `do-not-tracker.org/?action=…&random=…` (a domain that **respects Do Not
Track** — *unblocked* = pass). Each loads from three first-party domains to trigger
heuristic blockers. Crucially: **"If the simulated ad or beacon trackers load, but with
their cookies blocked, those results are reported as 'partial protection'"** — partial is
a fail, not a pass, because IP-based tracking remains. This is stricter than Ziy's current
"5 of 5 fixture trackers stopped."

**Uniqueness half — the 14 logged signals:** user agent string; HTTP `Accept` headers;
screen resolution and colour depth; timezone; installed extensions/plugins and versions;
fonts (as reported by Flash or Java); whether JavaScript executes; whether the browser
accepts cookies and "super cookies"; **a hash of the canvas-fingerprinting image**; **a
hash of the WebGL-fingerprinting image**; whether the DNT header is sent; system platform
(e.g. Win32, Linux x86); system language (e.g. en-US); touchscreen support. Compared
against recent visitors to produce a uniqueness score.

**EFF's own ceiling, which bounds our claims:** *"Browser fingerprinting is both difficult
to detect and extremely difficult to thwart"* … *"In practice, the most realistic
protection is using the Tor Browser… For day-to-day use, the best options are to run tools
like Privacy Badger or Disconnect that block some (but unfortunately not all)… and/or …
NoScript."* A premium Gecko browser is judged against Tor and loses on that axis; the
defensible claim is the narrower one below.

### 3.2 Mozilla's Resistance — what Gecko's RFP covers (HIGH, one gap)

`firefox-source-docs.mozilla.org/…/resistfingerprinting/resistfingerprinting/index.html`
is a **stub**; the real page is `…/implementation.html`, read here. It establishes:

- **The check is per-target and per-context.** Code should call
  `Document::ShouldResistFingerprinting(RFPTarget)`; the doc explicitly warns against the
  functions marked *dangerous* because calling them directly "will skip some of the
  checks that occur further up-stack." The dependency chain resolves, in order: system
  principal → Web-extension principal → PBM-only vs all-browsing mode → **per-site
  exemption** (taking the framing page into account) → per-activity exemption.
- **`RFPTarget` is the unit of every claim.** "A Target is a Web API or an activity — such
  as a Pointer Event, the Screen Orientation, or plugging in a gamepad." The list of
  targets lives in `RFPTargets.inc` (searchfox). Separately, auto-rejecting canvas
  extraction from third parties is a **different** target from prompting to reject canvas
  extraction.
- **Consequence for Ziy:** every RFP statement must be a row of the form *(RFPTarget,
  Ziy's behaviour, exemption state)*. `privacy.fingerprintingProtection.granularOverrides`
  must be a quoted JSON array or the graphics layer crashes (`AI-BRIEF.md` §5.8) — that
  pref *is* the per-target override surface, so Ziy's RFP posture is fully expressible as
  a target table.
- **What I could NOT fetch:** the per-API spoofing list itself. Mozilla's end-user KB page
  `https://support.mozilla.org/en-US/kb/resist-fingerprinting` was **blocked by a client
  challenge** ("A required part of this site couldn't load") and
  `https://firefox-source-docs.mozilla.org/toolkit/components/resistfingerprinting/` 404s.
  So the claim "RFP spoofs X" is **not** sourced in this pass; it must come from
  `RFPTargets.inc` / `nsRFPService.cpp` reads (already on disk per `AI-BRIEF.md` §2.1:
  `toolkit/components/resistfingerprinting/nsRFPService.cpp` is one of the four upstream
  reference files in `firefox-156.0.1/`). Do not publish an RFP claim sourced to this doc.

### 3.3 The verification checklist for Ziy's RFP claims (draft, from the two rubrics)

| # | check | source of the rubric | current state |
| --- | --- | --- | --- |
| C1 | the three CYT tracker sims are blocked with **no "partial"** result | CYT methodology §3.1 | **`UNV`** — never run against a Ziy build. `proofs-shields.md` stops 5/5 *fixture* trackers, which is not this test |
| C2 | CYT uniqueness: appears in the crowd, not as an outlier, vs recent visitors | CYT §3.1 | **`UNV`** |
| C3 | canvas hash and WebGL hash are stable *across restarts* and *shared with other Ziy users* — CYT hashes both, and a per-install seed fails this | CYT signal list | **`UNV`** — and patch 0004 (fake extension list) is a spoof, not a crowd; a spoof that is the *same for every Ziy user* would pass, a per-install random one would not. Specify which before claiming |
| C4 | a per-`RFPTarget` table for the four C++ patches (0001 colorscheme carve-out, 0002 fingerprinting option, 0003 WebGPU adapter strings, 0004 WebGL fake extension), each row naming the target and the exemption state | RFP implementation doc §3.2 | **`UNV`** — `proofs-cpp-fingerprint.md` covers pref-level findings; the target table does not exist yet |
| C5 | no per-site or per-activity exemption in Ziy silently disables a claimed target | RFP implementation doc §3.2 | **`UNV`** |
| C6 | letterboxing / window-size behaviour stated as measured, not assumed | Mullvad (letterboxing) + CYT (screen resolution is a logged signal) | **`UNV`** |
| C7 | no copy claiming to beat Tor or Mullvad on fingerprinting | EFF's own "most realistic protection is … Tor Browser" | rule for the brand, not a test |

### 3.4 The contradiction inside Ziy's two best stories

Mullvad's blocking rule, verbatim: *"Block trackers … Nothing more, as more attempts to
block trackers ironically can reveal your identity."* Ziy ships **seven** default lists
including uBlock Origin's base `filters.txt`, URLhaus and the Adblock Warning Removal
List, and positions on blocking *strength* as Card 3. Those are two different, published
standards that pull in opposite directions: crowd-blending says block minimally and
uniformly; strength says block maximally. CYT's tracker half rewards the first; the
fingerprinting half punishes any per-install difference (and a 7-list config is itself a
config signal). **Ziy must pick a lane per surface or state the trade-off explicitly.**
Neither is dishonest; claiming both maximums simultaneously is.

---

## 4. THE LEGAL / COMPLIANCE REALITY FOR A PAID BROWSER

Two primary sources, both read in full this pass:
`https://www.mozilla.org/en-US/foundation/trademarks/policy/` and
`https://www.mozilla.org/en-US/MPL/2.0/FAQ/` (both HIGH; the MPL FAQ's own caveat applies
— "it is not the license … not a substitute for … legal advice").

### 4.1 Rule set A — Mozilla Trademark Guidelines (what a paid launch may and may not say)

The permission list is short. **Without** prior written permission you may: use Mozilla
wordmarks in text to truthfully refer to *unmodified* Mozilla products; use logos to
truthfully refer to products on Mozilla's servers; describe a Firefox add-on per the
add-on rules; use Mozilla wordmarks to say your software "is based on Mozilla's open
source code, or is compatible with Mozilla's software" per the Open Source Project
Guidelines. **All other uses need prior written permission, including any use in a domain
name.** The General Guidelines: wordmarks as adjectives only, never nouns or verbs, never
plural or possessive, with a visible attribution notice ("[mark] is a trademark of the
Mozilla Foundation in the US and other countries"). The prohibitions: no Mozilla mark in
the name of your business/product/app/domain; nothing confusingly similar; **nothing that
incorrectly implies affiliation, sponsorship, endorsement or approval**; never more
prominent than your own brand; never on merchandise for sale; never for other commercial
use (support services) except truthful descriptive reference; never modified, abbreviated
or in a tagline.

The Open Source Project Guidelines are the operative ones for Ziy, and they contain an
explicit trap: **"please do not name your project, [Something]-fox, Moz-[Something], or
[Something]-zilla."** Ziy passes today. The permitted claim has a mandatory pairing:

> You **may** state in words that your project "is based on Mozilla open source
> technology, if that is true, **as long as you also include a statement that your project
> is not officially associated with Mozilla or its products**" — and their own example
> shows the required form: e.g. *"is proudly built from Mozilla's open source GeckoView
> software"* **plus, equally prominently**, *"[Brand] and [Product] are not officially
> associated with Mozilla or its products."*

Note the word **"equally prominently."** A footer-size disclaimer next to a hero headline
does not comply. This is directly relevant to the co-owner's ability to sell: the
Firefox-derived fact is an asset only if stated in the permitted form.

### 4.2 Rule set B — MPL-2.0 (what you must ship when you charge)

Relevant FAQ entries (all HIGH): **Q8** — distributing executables compiled from someone
else's unchanged MPL source: *"You may distribute any executables you create under a
license of your choosing, as long as that license does not interfere with the recipients'
rights to the source under the terms of the MPL"*, and you must tell recipients where to
get the source (3.2). **Q10** — for an executable based on **modified** MPL source: you
must make the MPL-licensed portions available and inform recipients how to obtain them.
**Q9** — for modified MPL source: tell recipients it is under MPL including your
Modifications, make the §2 grants, and respect §3.4's notice restrictions. **Q11** — the
copyleft is **file-level**: "new files containing no MPL-licensed code are not
Modifications, and therefore do not need to be distributed under the terms of the MPL",
which is what makes a Larger Work with proprietary files possible. **Q7** — if you add
your own terms on redistribution, §3.2(b) requires they not restrict recipients' MPL
rights; if you offer a warranty, §3.5 requires you to make clear it is offered by you
alone. **Q5/Q6** — use and *internal* distribution are unrestricted. **Q16** — minified JS
counts as Executable form, so minified MPL JS still needs the §3.2(a) source pointer (it
does **not** need the boilerplate in the minified output).

Ziy's position against these: the four C++ patches are Modifications to MPL files and
must ship with source (`patches/` already does, with apply/reverse evidence — that is the
obligation, already met in form); the `omni.ja` byte patches are a byte-level change to an
MPL-derived artifact and the source obligation attaches to the *source form* of what was
changed; the nine extensions, `shell/`, brand and mascot are new files with no MPL content
and may be proprietary or licensed as Ziy likes; **and the paid build's EULA must not
restrict a paying customer's MPL rights in the Gecko portions.**

### 4.3 The three concrete rules a paid Ziy launch must follow

> **Rule 1 — naming and branding (trademark).** No Mozilla or Firefox mark anywhere
> user-facing: not the product name, the app name, the domain, the social handles, the
> add-on names, the store listing, or any tagline. The permitted sentence is *"Ziy is
> built on Mozilla's open source Gecko technology"*, stated **in words, not logos**, and
> **paired at equal prominence** with the disclaimer *"Ziy is not officially associated
> with Mozilla or its products."* Nothing in the launch may imply Mozilla affiliation or
> endorsement — which rules out "Firefox-grade", "Firefox but private", or any comparison
> built on their marks. Add the trademark attribution notice. **Acceptance test:** grep
> the launch copy, the store listing, the domain, and every add-on manifest for
> `firefox|mozilla|gecko` (case-insensitive) contains **zero** brand-implying hits and
> **exactly one** permitted "built on … Gecko" sentence next to its disclaimer.
> Source: https://www.mozilla.org/en-US/foundation/trademarks/policy/

> **Rule 2 — source and licence terms when money changes hands (MPL).** Every distributed
> Ziy build — including the paid, signed, packaged artifact — must inform recipients where
> to obtain the source for the MPL-licensed portions *including the Modifications*, in a
> place a recipient would look for it; the paid EULA must not restrict a recipient's MPL
> rights (§3.2(b)); any warranty must be attributed to Ziy alone (§3.5); the extensions'
> EULA cannot reach into the MPL files. **Acceptance test:** the packaged artifact ships a
> `LICENSES`/about entry pointing at a real URL that serves the patched MPL source, and a
> diff of the paid EULA against the free one shows no clause that narrows the MPL grant.
> Source: https://www.mozilla.org/en-US/MPL/2.0/FAQ/ (Q7–Q11)

> **Rule 3 — the promise must be the licence, not a tier (both).** MPL permits almost
> everything here, which is exactly why this rule has to be a product rule rather than a
> legal one: the paid build must not fence, disable or degrade anything the free source
> build has — the seven lists, the RFP posture, the sync server, the cut list — and the
> free source build must remain buildable and complete forever. The moment a paid tier
> carries protection the free build lacks, (a) the MPL-licensed engine still lets anyone
> rebuild the paid features, so the moat is zero, and (b) the copy that says privacy is
> the product is falsified by the pricing page. **Acceptance test:** building from
> published source yields an artifact that passes the same `verify.sh` gate as the paid
> one (modulo signing). This is `premium-position.md` §2.2's invariants table, restated as
> a rule — my market evidence agrees with it and adds the reason: it is the only structure
> that survives §1's trust findings and §6.1's conversion reality.

**Also on the critical path but outside these two sources:** code signing is absent
(`premium-position.md` §3), and the launch page must not use another company's marks —
note that third-party sites are already reselling "Arc Premium" tiers under an unrelated
company (Atlas Associates) per search results at `UNV`, a live reminder that a
"Ziy Premium" page will be impersonated and that brand monitoring is part of a paid
launch, not an afterthought.

---

## 5. WHAT "PREMIUM" MEANS — the pricing psychology, honestly

**Cap stated up front: I found no credible public conversion-rate data for paid desktop
browsers, because there is no paid desktop browser at scale to measure. No TAM, no
competitor revenue figures and no conversion curves appear below, by design — the
assignment forbids inventing them and I did not.**

What the sources do support:

- **The price that works in desktop software is one-time and anchored to a tool-buying
  professional.** Sublime: $99 personal, 3 years of updates, never expires, no enforcement
  (`HIGH`). Nova: $99 + tax, one year of updates, "own it forever", not a subscription
  (`HIGH` model / `MED` price). Nova's buy page pairs the price with a *relationship*
  upgrade path from Coda ($79) — a conversion mechanism Ziy lacks.
- **"Premium" in this market means professionals, price anchoring, and perpetual rights —
  not subscription tiers.** Both surviving paid tools stopped selling subscriptions the
  moment they could (Nova's FAQ explicitly: *"Does Nova require a subscription? No"*).
  Ziy's $7/$15 monthly tiers are the *opposite* shape to the two models that demonstrably
  work — and monthly is the shape whose churn nobody has measured for a browser.
- **The on-the-record browser-scale evidence says user funding is marginal:** Vivaldi,
  with millions of users, calls donations "yet to be a significant portion of our income"
  (`HIGH`). That is the only browser-scale statement I could source about users paying
  directly.
- **The practitioner consensus on conversion is pessimistic and specific** (`ANEC`, HN):
  *"currently making money selling desktop software is really hard and, in general,
  doesn't payoff the amount of work you need to be there … the profits/users has a very low
  ratio … selling few units for a higher price will be much easier than selling a lot of
  units for a few dollars"* (https://news.ycombinator.com/item?id=9829055); and on
  free→paid transitions, *"you are going to lose a lot of your existing 'customers' …
  Do change when you can lose 99% of your free users and still maintain valid business"*
  (https://news.ycombinator.com/item?id=1951968). One counter-anecdote, also `ANEC`:
  *"Sublime Text's business model is entirely based on trust and they yield in the 7
  figures"* (https://news.ycombinator.com/item?id=25517482) — a single author's unverified
  claim about a private company; do not repeat it as fact.
- **And the audience says it out loud:** the "who will pay for it" thread contains *"Nobody
  will pay"* with Brave cited as free-and-sufficient
  (https://news.ycombinator.com/item?id=49933829), and the free→paid advisee had **several
  hundred thousand existing users** before charging and still called conversion "not that
  good" (`ANEC`).

**Realistic expectation, stated as a rule rather than a number:** if Ziy never exceeds a
few thousand users — and nothing in the evidence suggests a first-year Gecko fork with no
index, no mobile and no signing gets more — then at $7/mo the monthly total is a rounding
error against the 2,000 CI minutes/month a private repo consumes (`AI-BRIEF.md` §5.10),
and the honest description of the $3 tier is *patronage that funds attention, not a
release train*. That is compatible with `premium-position.md` §2.5's conclusion and with
its framing ("a browser Patreon funds a hobby-grade release train, not a salary"). What
the market evidence **adds** is: do not describe the tiers as a business plan, and do not
let the $7 tier's *packaging* promise outrun the first packaged artifact, because Arc's
letter is a public record of what happens when a browser promises value it cannot
demonstrate and is measured on retention instead.

---

## 6. WHAT CONTRADICTS OUR CURRENT POSITIONING (blunt, as requested)

### 6.1 The Arc row is a mirror, not a comparison
The Browser Company's own post-mortem says its fatal flaw was being *"an incremental
improvement to existing browsers, not a major change that would take over the market"*,
that its distinctive features went unused, and that it should have read its retention data
a year sooner. Ziy's positioning is a Brave *feature clone* with the revenue features
removed — categorically "an incremental improvement over existing browsers", and its
parity score is 60.4%. It is the most well-evidenced business-model failure available and
it describes the product. The mitigations available are also in Arc's letter: they
under-read their data and over-promised. Ziy's counter is `premium-position.md` §3's
sequencing (publish the truth now, gate the paid tiers on the first packaged build) — hold
that line, because it is the only thing separating the two stories.

### 6.2 Brave has already shipped two of Ziy's natural answers
**Containers** (1.92.134, phased) and **Email Aliases** (1.94.117) are exactly the
"privacy plus" features a challenger would use as a differentiator, and they shipped in
the last eight weeks. Add self-service account deletion (1.97.56) and Card 7's "no
accounts, and no way to leave" angle needs rewording: Brave users can now delete their
own account. And **farbling for `getSupportedExtensions` and WebGL** (1.93.129, issue
#15904) means Ziy's C++ patches 0003/0004 enter a space Brave actively maintains — the
patches may still be good engineering, but "Brave doesn't protect WebGL/WebGPU" is now
false and must not appear in copy.

### 6.3 Blocking strength and the privacy standard are in tension (see §3.4)
Mullvad — the people who co-wrote the modern privacy-browser playbook with the Tor
Project — deliberately block *less* because more blocking "ironically can reveal your
identity." Ziy's Card 3 is seven lists and 122,148 network rules. Both are defensible;
simultaneously claiming maximum blocking strength and maximum anti-fingerprinting
crowd-blending is not. Pick the framing per surface, and put it in the About panel as a
stated trade-off rather than a silent contradiction.

### 6.4 The $59.99 incumbent sets the price ceiling in-category
Brave Origin sells the *same product thesis* — the lean build with the revenue features
stripped — for a one-time $59.99, from a company with a support org and three platforms
(`MED`, not re-fetched). Ziy's $7/mo is $84/year and $15/mo is $180/year against that.
The evidence from Sublime and Nova says the working price shape is one-time and perpetual
at a two-digit number. A monthly subscription priced above an incumbent's one-time lean
build, with no index, no mobile, no signing and no update channel, is the hardest thing to
defend in this entire document. If the model must be monthly, the $3 tier should be
described as support and the $7 tier must not launch until the packaged build exists
(`premium-position.md` §3 already says this; my evidence makes it non-negotiable).

### 6.5 Nothing here kills the plan — it narrows it
The evidence supports **one** launch: free-to-build, free-source, `verify.sh`-gated, the
cut list and the measured privacy posture as the entire pitch, and a clearly-labelled
patronage tier that buys the co-owner's time and the packaging pipeline — explicitly
*not* a product upgrade, never a privacy upgrade, never described as revenue. Everything
priced above that is a claim about a deliverable that does not exist yet, and the market
record (Arc) shows what those claims cost when they are tested.

---

## 7. Fetch log (what was actually reached, and what was not)

**Reached and read in this pass (20):**
gigazine.net letter-to-arc-members · resources.arc.net free-revenue FAQ ·
vivaldi.com/blog/vivaldi-business-model · sublimetext.com/buy (→ sublimehq.com/store/text)
· sublimetext.com/sales_faq · nova.app · nova.app/buy · waterfox.com/blog/waterfox-has-joined-system1
· ghacks.net waterfox cuts ties with System1 · mullvad.net/en/browser ·
coveryourtracks.eff.org/about · mozilla.org/en-US/foundation/trademarks/policy ·
mozilla.org/en-US/MPL/2.0/FAQ ·
firefox-source-docs.mozilla.org/…/resistfingerprinting/index.html and
…/implementation.html · raw.githubusercontent.com/brave/brave-browser/master/CHANGELOG_DESKTOP.md
· hn.algolia.com (×4: brave-browser comments, item 49933300 thread, "Sublime Text business
model" comments, "conversion rate paid app license" comments).

**Failed / not usable:** `https://brave.com/releases/` → **HTTP 404** (page does not
exist; `brave.com/latest/` returned an empty RSS feed, so the GitHub CHANGELOG is the
substitute) · `https://nova.app/pricing/` → **404** ·
`https://support.mozilla.org/en-US/kb/resist-fingerprinting` → **blocked by a client
challenge** · the Reuters Vivaldi profitability article and substack letter body were seen
only via search index (MED).

**Not attempted, by budget:** Brave's community forum, Reddit, the Play/App Store review
pipes, Sublime's download page body, Panic's App-Store-economics post, and any conversion
benchmark study. The complaint corpus in `fixes.md`/`reviews.csv` (1,120 rows) remains the
primary user-voice evidence for this project.
