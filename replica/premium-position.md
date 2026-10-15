# premium-position.md — Ziy's positioning, the free model, and the honest story

**Date:** 2026-10-15 · **For:** the co-owner's two asks — (1) make it PREMIUM,
(2) a defensible "dramatically better than Brave" story. **Answer to (1), per the
co-owner's FINAL decision: PREMIUM BY CRAFT, FREE BY PRICE. The paid/tier model
was dropped; a single Ko-fi donation link funds the work (§2).**
**Reads with:** `parity.md`, `diff-summary.md`, `fixes.md`, `reviews.csv` (1,120
rows), `resource-budget.md`, `proofs-blocking-strength.md`, `re-deep-*.md`,
`AI-BRIEF.md` §3, `brand/MASCOT.md`, `replica/design/brand/colors.md`,
`patches/README.md`, `replica/deploy.md`.

**Rules held to:** every claim carries a citation or the label `UNVERIFIED`; no
unsourced competitor bashing; the cut list is the product, not a compromise; no
invented market data (no TAM, no competitor prices, no conversion curves, and no
donation forecast).
Confidence: `high` = measured here or read from a named source · `medium` =
derived from verified facts · `UNVERIFIED` = not established.
**Other workers' deliverables, cited not duplicated:** the money-model evidence
and the blunt headline finding (no paid desktop browser at scale):
`replica/research-market.md` · **Patreon's fee math and platform rules — the
record of WHY subscription gating was rejected, kept as evidence and cited, not
as the plan:** `replica/research-patreon.md` · the packaging and update-pipeline
evidence: `replica/research-tech.md` · list-licensing obligations, the MPL
§3.2(a)/trademark facts and the EU/VAT analysis:
`replica/research-legal.md` · full brand work: `replica-brand`
(§4 is implications only).

---

## 1. THE CLAIM CARDS

### Card 1 — "Nothing in it but browsing"

No AI assistant, no crypto wallet, no rewards/ads economy, no VPN.

- **A decision with rows, and a gate.** 36 `cut` + 12 `skip` of 207 matrix rows
  (`parity.md` §1: wallet 13, sidebar 4, rewards 11 of 12, vpn 5 of 6 `cut`;
  `engine`, `business`, `ads`, `P3A`, Brave's account system `skip`). Absence
  is enforced: a grep over the shipped XPIs and boot log for `AI assistant /
  Leo / wallet / rewards / BAT / VPN / brave` returns **NONE** —
  `test-report.md` "The cut features must stay absent ✅ PASS", re-run at every
  `tools/verify.sh`.
- **Why it matters — the corpus.** Ads/sponsorship/crypto rewards: **212
  reviews, 4 sources**, the biggest theme and the one most often in the same
  sentence as "I left" (`fixes.md` §1.1). AI/Leo: **99 reviews, 4 sources**
  (§1.5). Verbatim:
  - *"Firefox doesn't sell BATs, in-browser notification ads, or new tab
    takeovers."* — https://news.ycombinator.com/item?id=46291855
  - *"Deploying Brave at a company? That defaults to Crypto ads, Crypto
    'sponsored backrounds', Crypto wallet, Brave news instead of Firefox … + ublock
    origin ? bruh"* — https://news.ycombinator.com/item?id=33262975
  - *"now even brave has forcibly integrated AI into the browser without a way
    to turn it off. I'll be looking for something else."* (1★) —
    https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11197237131
  - *"Why are you shoving this AI garbage down our throats? If I wanted an AI
    assistant, I would install one. I do not want it to learn from my data. I
    don't want it taking up space or using my CPU."* — 13 likes, the most-liked
    complaint in the corpus, https://community.brave.com/t/how-do-i-remove-leo/544520
- **Counter-evidence, included:** Brave's revenue features are opt-in and its
  defenders say so — *"Many opponents of Brave online are thoroughly convinced
  that Brave Rewards … is on by default, when it isn't"*
  (https://news.ycombinator.com/item?id=49530269). Ziy's claim is not that
  Brave force-feeds ads; it is that a browser that can sell you anything has a
  reason to want your attention, and Ziy has no such surface. **Confidence:
  high.**

### Card 2 — "Fast by construction, measured"

| # | metric | measured | target | verdict |
| --- | --- | --- | --- | --- |
| 1 | idle CPU (about:blank, 60 s) | **CANNOT ASSESS** — 21.6%→88.6%, rising with idle time; the headless compositor is in a framebuffer error loop (`RenderCompositorSWGL failed mapping default framebuffer, no dt`) | < 5% | CANNOT ASSESS |
| 2 | idle RSS (settled, 10 processes) | **1.0 GiB** | < 2.0 GiB | PASS |
| 3 | media-playback CPU (20 s, real decode) | **6.5** | < 25% | PASS |
| 4 | media-playback RSS | **1042.2 MiB** | < 1.5 GiB | PASS |
| 5 | cold start to the Ziy NTP's first paint | **5.62 s** | < 8 s | PASS |
| 6 | extension-suite RSS baseline | **1287.5 MiB** | < 1.6 GiB | PASS |
| 7 | idle network activity | **0** HTTP lines in 120 s | 0 | PASS |

(Source: `resource-budget.md` §7.) Also measured: the shields request path at
**0.147 ms/request** on the indexed residual tier (cited, not re-measured —
`proofs-shields.md` §5/§7.5) and **1–8 ms** on the static tier with a **191 ms**
one-time index build (`resource-budget.md` §5).

**The causal argument.** Brave ships a ledger service, a wallet, a VPN helper,
an ad subsystem and an AI runtime *inside the browser process* (`fixes.md`
§1.2), and its users name it: *"High CPU usage (not fixed by 1.5.114) -- Bat
ledger service"*
(https://community.brave.com/t/high-cpu-usage-not-fixed-by-1-5-114-bat-ledger-service/114319)
· *"Brave bat ledger service 100% cpu usage"* (start Brave, open the task
manager, see 100%)
(https://community.brave.com/t/brave-bat-ledger-service-100-cpu-usage/97711)
· *"Brave slows computer to a crawl"*
(https://community.brave.com/t/brave-slows-computer-to-a-crawl/438764).
**Ziy cannot have that bug because it has no ledger service** — a structural
claim that does not depend on tuning, with the figures above as the floor
*before* any tuning. Idle CPU stays CANNOT ASSESS until a headed box measures
it, so no idle-CPU comparison belongs in marketing until then. **Confidence:
high** on every figure, with the headless limitation stated.

### Card 3 — "The blocking strength is real and it is measured"

Seven default lists; the four additions fetched by URL and sha256-recorded
(`proofs-blocking-strength.md` §1): EasyList (57,233 net / 24,659 cosmetic),
EasyPrivacy (56,278 / 36), Fanboy Cookie Monster (2,110 / 23,186) +
**uBlock Origin base `filters.txt`** (1,775 / 4,334, `3bde7d558863ea24`),
**URLhaus** (1,781 / 0, `43ddcd40a0379062`), the **Adblock Warning Removal
List** — the "turn off your ad blocker" walls — (2,531 / 444,
`22b6f442b2fc8787`), **Brave Unbreak** (440 / 454, `57c08f868a2a8861`).
**Total: 122,148 network + 53,113 cosmetic rules.**

- **The anti-adblock wall:** Brave's defence is entirely list-driven — `grep
  -rni 'antiadblock|adblock_notification|adblock.detect|blockadblock'` over
  `components/brave_shields/**` returns **nothing** (§2f). Brave ships the same
  list as `brave-adblock-warning-removal`; Ziy ships it and lets the same tiers
  consume it — that **is** Brave's approach, not an approximation. Brave Unbreak
  likewise ships *inside* Brave's default list (§1 table) — the same component.
- **Static tier: 28,907 rules** with salience ranking (§5.3 PASS line; D-5
  records 28 923 → 28 907 after the four lists landed, `STATIC_RULESET_CAP.
  headroom = 512`, 1,019 `@@` exceptions placed first because they are
  `mustHave` — "the salience ranking behaved exactly as designed"), plus the
  203,510-rule `webRequest` residual tier behind it (`parity.md` §4).
- **Measured live: 5 of 5 fixture trackers stopped, 0 reached the page** —
  `proofs-shields.md` §7.3, a real headless boot. Two refused at the network
  layer (`onerror`); three never opened a channel, the DNR signature. With the
  static tier deliberately dropped by the quota, the residual path still
  stopped 4 of 5.
- **Brave decision-parity, tested** (`test/brave-parity.test.js`, 12 tests):
  every `@@` exception above every ordinary block (Brave's `has_exception`);
  every `!important` rule above every ordinary rule (Brave's `result.important`
  OR-merge); per-site and session allows beat every list rule (Brave's
  `aggressive_blocking`); and **no shipped rule can block a Spotify ad host**
  — Card 4. Ziy is deliberately *stricter* once: it keeps `:has(` procedural
  cosmetics in standard mode, which Brave drops (§3).
- **Honestly not parity:** SugarCoat resource replacement — not implemented and
  not implementable as a diff, because `dnr-compile.js` emits
  `block`/`allow`/`upgradeScheme` and a replacement needs `redirect` (§2e).
  Brave's update cadence is 2.4× faster (100 vs 240 min), left alone
  deliberately (§2d).
- **Confidence: high** per component; **medium** on the blanket "at least
  Brave's", since SugarCoat, CNAME uncloaking and scriptlets are not replicated.

### Card 4 — "The Spotify slot works — and Brave has nothing here at all"

- **Brave's verified absence:** `grep -rni 'spotify|spotifycdn|audio-fa'` over
  `components/brave_shields` and `components/adblock` returns **nothing** (§2g).
  Brave blocks Spotify ads through the ordinary list path with no ad-slot
  awareness. **A Ziy-own delta, not a Brave parity gap.**
- **The mechanism, from the module's own header**
  (`extensions/ziy-shields/lib/engine/spotify-adslot.js`): *"The Spotify Web
  Player … is a state machine with an AD SLOT … the slot ends on that element's
  `ended`/timeout event, and only then does the player navigate the element to
  the real song on `p.scdn.co`. A hard network block of the ad URL means the
  media element never loads anything, so its `ended` event never fires, so the
  slot never ends, so the player sits in the ad slot forever — 'the song won't
  play'."* The fix: *"the network tier does NOT block the ad-delivery media
  request … the content script mutes the media element while the slot is active
  … when the slot ends, the same code that mutes unmutes, so the song that
  follows plays at full volume."* That is the co-owner's lived uBlock
  experience written into the code as the problem statement.
- **Proven at unit level:** 211 shields tests, 23 Spotify — host classification
  (lookalike host `audio-fa.spotifycdn.com.attacker.test` rejected), the
  mute/restore machine with real elements (including "a user-muted element
  stays muted"), the tri-state per-site row default-on, and the no-block
  regression guard (§4, §5.1).
- **NOT proven in-browser — UNVERIFIED:** the end-to-end returned
  `{"action":"no-extension-api"}` → `INCONCLUSIVE` because the content script
  did not inject in the throwaway profile; the cause was never established
  (§5.4). **This claim must not appear in public copy until `prove-adwall.py`
  returns a clean PASS.** Scope: the Web Player only, never the desktop client;
  Spotify's terms restrict ad circumvention and the module says so.
- **Confidence: high** on Brave's absence and the unit proof; the live
  behaviour is **UNVERIFIED**.

### Card 5 — "Sync that is actually blind" — a real win over Brave

- **The proof is a test, not a promise** (`proofs-sync.md` §5):
  `server/test/server.test.mjs` writes a real record with a real client, reads
  the server's SQLite off disk the way an attacker holding it would, and greps
  it: `✔ THE BLINDNESS PROOF: after a sync, nothing in the DB reveals the
  payload` — `grep of the database for the plaintext domain, title and folder:
  NONE FOUND`. The server hands back exactly `{category, nonce, payload,
  record_id, sig, signer, size_bytes, tombstone, updated_at}` — **no plaintext
  name field at all**. Leaving a chain wipes it: `server_cache_wiped: true`,
  0 rows remain.
- **The 24-word chain:** the 24 BIP-39 words *are* the raw 32-byte entropy used
  directly as HKDF IKM — no PBKDF2, no seed, no extension word
  (`extensions/ziy-sync/lib/bip39.js:24-39,140-146`); all eight Trezor vectors
  and the canonical wordlist pinned; Ed25519 device keys verified
  cross-boundary (WebCrypto signs, `node:crypto` verifies — §1).
- **The win over Brave, read from their source** (`re-deep-sync.md` §3):
  record content is opaque on both sides; **but Brave's server stores
  `SyncEntity.Name` and `NonUniqueName` in the clear**
  (`datastore/sync_entity.go:52`), so **bookmark titles and folder names are
  plaintext on Brave's server** — Ziy puts them **inside the AES-256-GCM
  ciphertext**. Brave also sees the plaintext `DataType` id per entity; Ziy
  sees only a narrower `category` bucket label. Neither ever sees a key or a
  word. `re-deep-sync.md` records this as an explicit **refutation** of a claim
  the project had made too strongly, and `proofs-sync.md` §6 gives the
  corrected honest form: **the server is blind to record contents**, not to the
  fact that a chain has bookmarks. Stricter by choice, not by parity.
- **Confidence: high** — the one privacy claim checkable in both directions
  (Brave by source grep, Ziy by its own attack-shaped test).

### Card 6 — "No sponsored anything"

- The recon's own must-list names the surfaces: notification ads (`recon.md`
  S29, "ad delivery + earn"), NTP sponsored images (S30, "branded background +
  earn … shown, opted out"), the `AdCatalog` entity (`ad_id, format
  (notification|ntp_image), creative, segment, region`). All `cut` with reasons
  (`features.csv` 80–82), the marketplace `skip` (193).
- **Ziy's NTP has no ad surface to remove — and says so in its own voice:**
  *"Cards are switched on. Ziy ships nothing to put in them yet — there is no
  sponsored-image network behind this page, and nothing is fetched to fill
  it."* (`proofs-ntp.md` §7 copy table.)
- Even the *engine's* sponsored surfaces are off and locked: `showSponsored`,
  `showSponsoredTopSites`, `feeds.section.topstories`, `feeds.snippets`,
  `asrouter.providers.snippets`, `topsites.sponsoredShortcuts`, contile
  (`deep-fork.md` §4, `shell/mozilla.cfg:156-159`), with the three-layer
  newtab strip (§3) making activity-stream inert. The absence is gated by the
  same grep as Card 1. **Confidence: high** on Ziy's absence; the framing is a
  positioning choice, not a claim about Brave's defaults.

### Card 7 — "A browser with no company inside it"

No accounts, no token, no hosted models, no marketplace, no telemetry — the
structural answer to the **82 reviews that are literally about leaving**
(`fixes.md` §3.3, whose summary is *"the browser has shareholders"*).

- The `skip` set is what cannot be cloned even if wanted: BAT rails, the ad
  marketplace and campaign trust model, the Guardian backbone, P3A, Brave's
  account system (`parity.md` §3). The honesty note: `kBraveAccount` and
  `kEnablePsst` are default-OFF in brave-core too (`re-deep-core.md` delta 12),
  so this is not a Brave-vs-Ziy difference.
- Ziy's own choice rather than an engine limit: no token, no marketplace, no
  affiliate rewriting, no sponsored new tab — the answer to the 14-review trust
  theme (§1.6).
- **Still outstanding, and named:** *"the posture is locked and documented, but
  no machine-readable list and no first-run statement ship"* (`parity.md` §5.1).
  Until they do, this card's strongest form is the grep gate plus the
  0-idle-fetches measurement. **Confidence: medium** — structure verified,
  auditable form partly outstanding.

### The honest counterweights — where Brave wins

1. **Web-compat depth.** 1,287 Chromium patch files, 2,082 `chromium_src/`
   overrides, 845 `rewrite` yaml rules (`re-deep-core.md` §1, delta 10) against
   Ziy's **5 C++ patches, none compiled** (`patches/README.md`); the five
   hardest couplings named in that delta have no Gecko surface.
2. **Their index.** Ziy ships an engine picker with Google default and **no
   index at all** — search is the weakest area at 23.5% (`parity.md` §1;
   `AI-BRIEF.md` §3).
3. **Their scale.** 1,120 reviews is evidence about a browser with a support
   organisation, a release train and multiple platforms; Ziy is one box, Linux
   desktop, 42 of 79 yes-rows observed live (`parity.md` §4).
4. **Mobile.** Brave ships iOS + Android; Ziy's Windows/Android are required
   targets with **nothing verified on those platforms** — `low — unverified`
   (`architecture.md` §0). Android's GeckoView path cannot have the app dir,
   `mozilla.cfg`, the `omni.ja` patch, `chrome_url_overrides.newtab`,
   `sidebar_action` or a private window.
5. **73 genuinely unbuilt rows** — tab groups, the clear-data dialog, Tor
   private windows, vertical tabs (locked OFF deliberately), autofill,
   site-as-app, translate (the engine's own is OFF), speedreader,
   cookie-consent blocking, CNAME uncloaking, param filtering, de-AMP,
   SugarCoat (`parity.md` §5.1).
6. **Idle CPU is measured for neither product** — Brave's is not measured here;
   ours cannot be measured headless. No idle-CPU comparison either way until a
   headed box exists.

---

## 2. THE MODEL — **co-owner FINAL decision: Ziy ships FREE. The paid/tier
model is DROPPED. A single Ko-fi donation link funds the work.**

**What changed, and why this file still holds the tier evidence.** An earlier
pass of this document recommended a Patreon membership ($3 / $7 / $15) and
worked out real fee math for it. **The co-owner's final decision removes that
model entirely.** The tier tables and the Patreon analysis are **not deleted**
— they are the record of *why* subscription gating was rejected. `replica/research-patreon.md`
(Patreon's own policy pages, fetched live on 2026-10-15) and `replica/research-market.md`
(the money-model table) stay in the repo as that negative case: read them as the
reason free wins, never as the plan. Nothing verified in them is discarded —
§2.2 cites them as evidence.

### 2.1 The model, stated plainly

- **Free to download.** No paid tier, no feature gating, no trial, no "Pro"
  anything, no time limit. There is no artifact a paying user gets that a free
  user does not get, because there is no paying user class.
- **Free to build from source.** `tools/build-shell.sh`,
  `tools/build-extension.sh --all` and `tools/ziy` produce a running product
  today (status checked in §2.4). The engine input is Mozilla's own
  checksum-verified release tarball (`tools/lib/fetch-engine.sh`, SHA512
  against Mozilla's published SHA512SUMS), so a build needs no paid dependency,
  no account and no Ziy-hosted service.
- **No accounts, no entitlements, no DRM.** There is no account system to gate
  anything with — none exists or is planned (`AI-BRIEF.md` §3) — and the
  measured posture is **0 HTTP lines in 120 s at idle**
  (`resource-budget.md` §7). Nothing in Ziy could phone home even if asked to,
  which is also why an entitlement server was never a possibility: it would be
  the one piece of infrastructure that could compromise §1.
- **"Premium" means craft, not a paywall.** The quality is in the build and it
  is in every copy: gloam teal `#0b6e6e` chosen because it *means* "sealed" and
  clears 4.5:1 on every measured neutral (`colors.md`); the mascot that is
  never a status light, a failing cat is a warning lamp not a personality
  (`MASCOT.md` rules); deterministic packaging that yields identical bytes from
  the same tree (`tools/lib/zpxi.py`, `replica/proofs-pkg.md` §2). None of that
  is behind a price.
- **One Ko-fi donation link funds the work.** No tiers, no reward levels, no
  items promised in exchange. §2.3 states exactly what a donation buys and what
  it does not.

**The invariants survive — they were never pricing rules.** Every item below was
written for the tier model and holds unchanged under free; each is now a
property of the product, not a rule a tier could have broken:

### 2.1.1 No feature gating of anything that matters — identical in every
build, including free, with no exceptions

- **Telemetry / accounts / data-collection posture.** No telemetry, no
  P3A-style analytics, no crash reporting, no accounts anywhere (no account
  system exists or is planned — `AI-BRIEF.md` §3), the measured 0-idle-network
  posture (`resource-budget.md` §7: **0 HTTP lines in 120 s**).
- **All protections.** All seven default lists — EasyList, EasyPrivacy, Fanboy
  Cookie Monster, uBlock Origin base `filters.txt`, URLhaus, Adblock Warning
  Removal, Brave Unbreak — **122,148 network + 53,113 cosmetic rules**
  (`proofs-blocking-strength.md` §1), on every surface, in every build.
- **The whole cut list**, gated by the same grep (`test-report.md` "The cut
  features must stay absent ✅ PASS", re-run at every `tools/verify.sh`).
- **The full product surface**: password manager, sync, playlist, talk, NTP,
  news, the RFP pref layer, the C++ patch set.

**What would have varied by tier, exhaustively: packaging, update channel,
support, and early access. Never privacy. Never blocking strength. Never
protections.** A tier with *more blocking* makes the free tier a downgrade of
the safety claim, and a tier that *collects* something the free build does not
makes §1 a lie told by the pricing page. **A gated protection is not a pricing
decision — it is the product saying the opposite of §1.** There is no "upgrade
to be private" string anywhere in the product.

### 2.1.2 The licensing facts the whole model rests on

- **MPL-2.0 is file-level copyleft.** Modifications to Mozilla's files — the
  C++ patch set, the `omni.ja` byte patches, any JS layer we change — **must
  ship with source available**. Already satisfied: `patches/` holds all five as
  unified diffs with apply/reverse evidence (`patches/README.md`,
  `compile-readiness.md` §2–§3), and the engine is Mozilla's own
  checksum-verified release tarball (`deep-fork.md` §6.2). Free distribution
  does not waive a single one of these duties (§2.5).
- **Our own code could be proprietary, and now never needs to be.** The nine
  extensions, `shell/`, the brand assets and the mascot are Ziy-authored with no
  upstream file incorporated; the clean-room record says the implementation is
  built from behaviour contracts, never by porting code (`recon.md` header,
  `evidence.md`). With no revenue to protect, the "source-available engine /
  proprietary product" split is a right the project simply does not exercise.
- **Consequence:** everything stays source-available, and **money never buys
  capability — there is no money in the model at all.** The one time a paid
  split would have been reachable, it was dropped rather than exercised. That
  is the only structure the §1 privacy claims survive.
- **Pending, not asserted:** the shipped filter lists' attribution obligations
  (several are CC-BY-bearing). list-licensing obligations:
  `replica/research-legal.md`. Every place a list-attribution requirement would
  matter (About panel, NTP, download page) is **ASSUMED-pending-legal-review**
  until that lands.

### 2.2 Why free wins — the evidence, cited

**(a) The market evidence — `replica/research-market.md` §1.** The headline is
blunt: **there is no paid desktop browser at scale in 2026, and not one of the
independent browsers surveyed is funded by its own users paying for it.** The
rows that matter for the decision:

- **Sublime Text and Nova (Panic)** are the only two that pay for themselves,
  and they are **one-time professional tools** — $99 licence, 3 years of
  updates, "own it forever", *explicitly not a subscription* — aimed at people
  who already buy tools (https://www.sublimetext.com/buy ·
  https://www.nova.app/buy). A browser's audience is everyone, not developers
  who buy editors.
- **Arc / The Browser Company** — **died with money, an enthusiastic free base
  and a beloved design**; its own "Letter to Arc members 2025" names the fatal
  flaw: *"Arc was an incremental improvement to existing browsers, not a major
  change that would take over the market."* Active development **halted**,
  maintenance only, and paid seats did not save it
  (https://browsercompany.substack.com/p/letter-to-arc-members-2025 via
  https://gigazine.net/gsc_news/en/20250608-letter-to-arc-members). Ziy's own
  framing is *incremental improvement on Brave* — the same position, with less
  talent and no free base.
- **Vivaldi**, with **millions** of users, says its donations are *"yet to be a
  significant portion of our income"* — the only browser-scale on-record
  statement about users paying directly
  (https://vivaldi.com/blog/vivaldi-business-model/).
- **Mullvad Browser** is free *by design*: *"We don't earn any money from the
  Mullvad Browser. Our income comes from our VPN service."* A browser is a
  complement to a paid service, never the thing sold
  (https://mullvad.net/en/browser).
- **Brave already priced the lean privacy browser** — **Brave Origin is a
  $59.99 one-time** build with the revenue features removed
  (https://news.ycombinator.com/item?id=47813286). The incumbent has set the
  in-category ceiling for the *same product thesis Ziy is built on*, from a
  company with a support organisation and three platforms. A solo fork asking
  for more than that monthly has nothing to point at but the subscription
  itself.

**(b) The Patreon evidence — `replica/research-patreon.md`, the reason a
subscription is the wrong shape even before the market question.** Read as a
cost/obligation ledger:

- **The fees are real and they tax the small amounts.** Patreon's standard plan
  for a new creator page is **10% platform fee + 2.9% + $0.30 payment
  processing** per payment, on top of a ~$0.25 ACH payout fee, and +2.5% more
  if a patron pays in another currency (Q3,
  https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees-overview).
  The flat $0.30 costs **23% of a $3/mo tier**. Patronage at the size this
  project can realistically see is mostly the fee.
- **Chargebacks can leave the creator net-negative.** Patreon is the merchant of
  record; chargebacks are **not** refunded, and fees already incurred "may not
  be refunded to you" — the shortfall is recovered from future payouts (Q4).
  A donation is a gift; a subscription is a recurring obligation that can cost
  the creator money.
- **A subscription creates delivery obligations the product cannot yet honour.**
  The Commerce Guidelines require every tier to describe **how the benefit is
  accessed, downloaded or delivered**, and "vague tier copy" is a takedown risk
  (S2, https://www.patreon.com/policy/benefits) — so the tier copy is a
  contractual promise. Patreon's platform enforces no cadence, which means
  **every missed month is a breach toward patrons**, not a platform rule (Q2).
  Ziy has no user-facing update channel (§2.4, `replica/research-tech.md` §4's
  ten missing pieces) and no packaging stage — the honest deliverable did not
  exist when the tiers were written.
- **The attachment formats fight the artifact.** Shop attachments are
  **.zip/.7-Zip only (max 5 GB, 25 files)**; **.exe, .dmg, .deb and .AppImage
  are NOT in the listed formats** (S4), while the build directory is 361 MB and
  every platform wants a different archive (`replica/research-tech.md` §3).
- **Members may not share builds with non-payers** (Q2/S1) — but sharing a build
  file is technically trivial, so the only real protection would be an
  account-gated delivery channel: accounts, entitlements, and one more promise
  to keep. Q5 confirms the gating is legal *only when* the code stays public,
  which is precisely what makes it indefensible here: **the gate would protect
  nothing but the gate.**

**(c) The strongest reason — no tier section is left with anything legitimate to
gate, and everything gateable is exactly what a privacy browser must give away
free to be trustworthy.** Rule 1 above already lists what must stay identical:
protections, all seven lists, the whole cut list, the full product surface, no
telemetry. What remained as honest tier content was **packaging, the update
channel, support, and early access** — the same list the tier model itself
invented, because there is nothing else. Look at what those four are:

- **Packaging** is the sign of a privacy browser's honesty: the reproducible,
  checksum-verified, no-build-step path is the reason a user does not have to
  trust whoever handed them a binary (`tools/lib/fetch-engine.sh` verifies
  Mozilla's own SHA512SUMS; `tools/lib/zpxi.py` yields identical bytes from the
  same tree, `replica/proofs-pkg.md` §2).
- **The update channel** is the security surface: gating it means the users who
  need the patch fastest get it last — and §2.5's gate #2 exists because a
  browser whose security fixes are behind a price is not a privacy product
  (`replica/research-tech.md` §4 on Mozilla's "Bulletproof" and "Malware
  Resistance" principles).
- **Support** for a no-accounts, no-telemetry product is the public tracker,
  which is free by construction.
- **Early access** to builds of a product whose value proposition is "you can
  verify what you run" is inverted: builds an insider gets early get studied
  last.

**So the gate is not a pricing decision that survived the evidence — it is a
product decision that refuted the pricing.** The free path is not a consolation
prize for people who won't pay; it *is* the product promise, stated in §1 and
delivered in §2.5's gate.

### 2.3 THE TIER CONTRACT, RE-EXPRESSED FOR FREE — the product's integrity,
written as rules

**These are not pricing notes. There are no tiers; there are only rules the
product must break nothing.** Every rule below came from the tier model and
holds unchanged under free — the free build satisfies each one trivially, which
is the point: **the rules were always product rules, and the tiers were the
thing that made them awkward.**

**Rule 1 — No feature gating of anything that matters.**

The complete and permanent invariant list. Identical in **every** build, with no
exceptions:

- **Telemetry / accounts / data-collection posture.** No telemetry, no
  P3A-style analytics, no crash reporting, no accounts anywhere (no account
  system exists or is planned — `AI-BRIEF.md` §3), the measured 0-idle-network
  posture (`resource-budget.md` §7: **0 HTTP lines in 120 s**).
- **All protections.** All seven default lists — EasyList, EasyPrivacy, Fanboy
  Cookie Monster, uBlock Origin base `filters.txt`, URLhaus, Adblock Warning
  Removal, Brave Unbreak — **122,148 network + 53,113 cosmetic rules**
  (`proofs-blocking-strength.md` §1), on every surface, in every build.
- **The whole cut list**, gated by the same grep (`test-report.md` "The cut
  features must stay absent ✅ PASS", re-run at every `tools/verify.sh`).
- **The full product surface**: password manager, sync, playlist, talk, NTP,
  news, the RFP pref layer, the C++ patch set.

**What varies between users: nothing. Ever.** Not packaging, not the update
channel, not support, not early access — because there is no second class of
user to vary between. Never privacy. Never blocking strength. Never protections.
A build with *more blocking* makes every other build a downgrade of the safety
claim, and a build that *collects* something another does not makes §1 a lie
told by the product's own code. **Gating a protection is not a pricing decision
— it is the product saying the opposite of §1.** There is no "upgrade to be
private" string anywhere, in any build, in the UI or the docs.

**Rule 2 — The free path is the ONLY path, so it must stay real and complete.**

There is no paid artifact behind a curtain: the free source path is not a
consolation, it is the deliverable. Its honest status, checked 2026-10-15:

| what | state | file checked |
| --- | --- | --- |
| self-contained **engine fetch** with checksum verification (`build-shell.sh` header: fetches Mozilla's prebuilt tarball via `tools/lib/fetch-engine.sh`, verifies its SHA512 against Mozilla's published SHA512SUMS; no `./mach`, no rustc, no clang) | **DONE — code present** | `tools/build-shell.sh` header + `tools/lib/fetch-engine.sh` |
| the self-contained **verify gate** (check 12: build from Mozilla's checksum-verified tarball, not a host Firefox install) | **DONE — code present** | `tools/verify.sh:26-30, 809-858` |
| a **proof file** `replica/proofs-self-contained.md` | **NOT DONE — the file is referenced by `build-shell.sh`'s header but does not exist in the repo.** The `self-contained` worker owns it and it is in flight | `grep -r proofs-self-contained .` → only the reference at `tools/build-shell.sh:9` |
| a **packaged, shippable artifact** (`packaging/linux/` tarball stage) | **NOT DONE — `packaging/` does not exist** (`glob packaging/**` → path not found; `replica/architecture.md` §0.1 lists it as the English "tarball stage (`packaging/linux/`)") | `glob packaging/**` |

So the free path's honest status is: **the build machinery for a self-contained
build from a checksum-verified Mozilla tarball is written and gated, and the
tarball-stage artifact a user downloads does not yet exist.**
`tools/build-shell.sh` + `tools/build-extension.sh --all` + `tools/ziy` produce
a running browser from source-equivalent inputs today; a `packaging/linux/`
stage that turns that into a one-command artifact is the remaining work.

**The contract clause:** *the free path builds the whole product, and the
packaged artifact — when it exists — is the same bytes.* Both are the same
browser, which is what makes the donation ask honest: nobody is being sold the
version they could not build. Two consequences, both binding:

1. **The engine is and stays free-input.** The build consumes **Mozilla's own
   checksum-verified release tarball**, fetched and verified by
   `tools/lib/fetch-engine.sh` (SHA512 against Mozilla's published SHA512SUMS —
   `tools/build-shell.sh` header; the check-12 gate re-verifies the digest at
   `tools/verify.sh:819-858`). No part of the build requires a paid dependency,
   an account, or a Ziy-hosted service.
2. **Reproducibility is the trust substitute for signing.** `tools/lib/zpxi.py`
   is deterministic — fixed timestamp `(2026, 1, 1, 0, 0, 0)`, sorted entries,
   fixed `external_attr`, `compresslevel=9` — proven byte-identical across two
   builds of the same tree (`replica/proofs-pkg.md` §2: "DETERMINISM: identical
   bytes"). Anyone can therefore build the same bytes from source and compare
   them against the published artifact's hash. That is the honest substitute
   for a code signature until signing exists (§3 item 2).

**Rule 3 — The honesty clause: "fund the build," never "buy the best browser."**

There are no tiers, so there is no tier copy to police — but the delivery
discipline that Patreon's rules forced is worth keeping on its own merits, and
it is what §2.4's donation section cites:

- **Software distribution as a paid membership benefit was permitted**
  (`replica/research-patreon.md` Q1 — the Commerce Guidelines' 11 prohibited
  categories do not include software or digital files), so nothing external
  forced this pivot. The pivot was a product decision, which is the strongest
  kind.
- **The obligation that mattered was the tier description itself.** Patreon's
  Commerce Guidelines require a listing to "clearly describe[] the item being
  sold, including how it will be accessed, downloaded, or delivered", and vague
  tier copy is a takedown risk (S2,
  https://www.patreon.com/policy/benefits) — but Patreon enforces no delivery
  cadence, so **a skipped month was a breach toward patrons, not a platform
  rule** (`replica/research-patreon.md` Q2). Ziy had no user-facing update
  channel and no packaging stage to promise against, which is why the tier
  promises would have been promises, not descriptions.
- **The attachment formats fought the artifact** (`.zip`/`.7-Zip` only, max
  5 GB / 25 files — no `.exe`, `.dmg`, `.deb` or `.AppImage`; S4) while the
  build directory is **361 MB** and every platform wants a different archive
  (`replica/research-tech.md` §3). A free, direct download has none of those
  constraints — which is one more thing the subscription was paying an
  inconvenience fee for.

**The delivery discipline kept from the tier model, now applied to a free
artifact:** whatever ships is published with a **SHA-256 + SHA-512 digest line
and a build date** beside the download, so a user who fetched from the wrong
mirror is told so by arithmetic rather than by trust. That practice was invented
to satisfy a paid tier's "described delivery" rule; it is simply good hygiene
now, and it costs nothing.

**The honest-weaknesses list stays in the story, permanently.** The §1
counterweights (Brave's 1,287 Chromium patch files against our 5 un-compiled C++
patches, their index, their mobile, 73 unbuilt rows, unmeasured idle CPU), the
six `research-market.md` §6 contradictions (the Arc mirror, Brave's
already-shipped Containers and Email Aliases, the blocking-strength vs
crowd-blending tension, the $59.99 ceiling), and `research-tech.md` §4's ten
missing updater items are **part of the marketing, filed next to the pitch, not
hidden**. A premium product that hides its weaknesses is the Arc failure mode:
over-promise, under-read the data, get measured on retention. Ziy's copy leads
with the measured wins and the named gaps in the same breath — which is what
makes the wins checkable.

Also binding on every user-facing surface, paid or otherwise: **no Brave and no
Mozilla/Firefox marks anywhere user-facing** (`replica/research-patreon.md`
gotcha 3 — the "imitation" tripwire under the Commerce Guidelines IP rule #7 —
and `replica/research-market.md` §4.3 Rule 1,
https://www.mozilla.org/en-US/foundation/trademarks/policy/). The permitted
"built on Mozilla open source technology" sentence must appear **at equal
prominence** with the "not officially associated with Mozilla" disclaimer
(same policy). With no paying customer class, there is no EULA that narrows
anyone's MPL rights in the Gecko portions — nobody's rights are narrowed at all,
which is §2.1.2's licensing consequence in practice.

### 2.4 What a Ko-fi donation actually buys

**No promises are made in exchange.** A donation is not a purchase, buys no
feature, buys no access, buys no place in a queue, and confers no influence —
there is nothing to grant influence over, because there is no second build. It
buys engineering time on work that is otherwise unfunded. Stated plainly, in the
spirit of §2.3 Rule 3: **donations buy time, not influence.**

In plain engineering terms, the costs a donation offsets:

1. **The per-engine-bump patch-set maintenance.** Every Firefox release means
   re-verifying the **`omni.ja` byte patches** against the new engine and
   re-applying the **C++ patch set**, or hard-stopping. `tools/update-engine.sh`
   is that procedure: discover and validate the new install (executable,
   `omni.ja`, `browser/omni.ja`); **version agreement** — the install's own
   `application.ini` must say what the bump declares or the script stops; re-run
   both omni.ja patchers **in write mode against the NEW engine** so a moved
   member or string fails *there, named, before anything is installed*; the
   pref-layer preflight; rebuild `build/ziy`; and with `--extract-source`,
   `git apply --check` each C++ patch against the checksum-verified tarball,
   **any failure a hard stop naming the patch** (`tools/update-engine.sh`;
   `patches/README.md` "How update-engine.sh re-applies this per bump"). The five
   C++ patches are real, apply-verified forward and reverse, and **none is
   compiled** — `patches/README.md`'s own status line — so each bump is a
   genuine re-verification, not a rebase.
2. **The packaging / signing / update channel per platform.** The per-platform
   recommendation and its blockers are in `replica/research-tech.md` §3: Linux
   `.deb` primary, AppImage secondary (GPG-signed, "artifact signing is not
   required… it can be used to increase trust"); Windows NSIS `-setup.exe` or
   MSI, where **signing is mandatory and reputation is a cold start** — no
   signature means SmartScreen blocks the installer and Win 11 Smart App Control
   blocks unsigned files outright, while a fresh signature still warns for
   "several weeks and hundreds of clean installs" (EV is explicitly *not* worth
   buying to avoid that); macOS DMG with Developer-ID signing **plus
   notarization**. `replica/research-market.md` §6.4 records the in-category
   price mirror: Brave Origin already sells the lean build one-time at $59.99.
3. **Self-contained installer distribution.** Today the engine is fetched as
   Mozilla's own prebuilt tarball and verified (`tools/build-shell.sh` header);
   the artifact a user downloads is the not-yet-existing `packaging/linux/`
   stage (Rule 2 above). Distribution cost is real: the build directory is
   **361 MB** (`research-tech.md` §3) and every platform wants a different
   archive format — which is also the un-fun side of free distribution: with no
   subscription, **bandwidth and hosting are donated, not recovered**.
4. **The trademark and licensing pass before the first public release.** The
   name was chosen for no known collision (`architecture.md` header), but a
   *distributed* build is when it matters — the launch surfaces must clear two
   rule sets: no Mozilla/Firefox mark anywhere user-facing, with the permitted
   "built on Mozilla open source technology" sentence stated **in words and at
   equal prominence** with the "not officially associated with Mozilla"
   disclaimer (`research-market.md` §4.3 Rule 1), and no Brave name, logo,
   Shields or BAT branding in the product or its marketing
   (research-patreon.md gotcha 3). The About panel, the download page and the
   domain are the three surfaces a clearance has to cover. **This work does not
   shrink because the browser is free — §2.1.2 and §2.6 say why: free
   distribution is still distribution.**
5. **The update pipeline.** `tools/update-engine.sh` maintains *engine bumps*
   (checksum → omni.ja patch → C++ re-apply → hard stop). A *user-facing*
   updater does not exist, and `replica/research-tech.md` §4 is the gap list
   against Mozilla's own design principles: no artifact channel, no signing
   identity beyond a hash, no staging/atomic swap, no rollback, no elevation
   story, no scheduled task, no update UI/consent/failure surface, no update
   path for the extension suite, no success/failure record (we ship no
   telemetry), and no answer yet to the fact that **any update check is an HTTP
   request that would break the measured 0-idle-network posture**. The safe
   shape that section assembles: disable Gecko's update channel by policy
   (`DisableAppUpdate` — its updater only accepts Mozilla-signed builds, and the
   first update would silently un-patch the product), own the whole artifact
   pipeline, HTTPS + EdDSA-signed deltas and full artifacts, staged swap with
   rollback, user- or alarm-triggered check with an explicit prompt, local-only
   log. **Gap-list items 1 and 3 are the blockers for everything after them.**

### 2.5 THE PRE-LAUNCH GATE — status-checked, not asserted

**Nothing public happens until every one of these is true. This gate was never
about money and nothing in it changes because the browser is free** — it is
about whether a public release page is honest. Each item is stated with the file
it was checked against on 2026-10-15.

| # | gate item | status | file checked |
| --- | --- | --- | --- |
| i | **a self-contained packaged build exists and boots** | **NOT DONE.** The self-contained *engine* path exists and is gated (`build-shell.sh` header; `verify.sh` check 12 at `:809-858`), but `replica/proofs-self-contained.md` **does not exist** — it is referenced by `tools/build-shell.sh:9` and absent from the repo — and `packaging/linux/` **does not exist** (`glob packaging/**` → path not found; `replica/architecture.md` §0.1 lists it as "tarball stage (`packaging/linux/`)"). The `self-contained` worker owns the proof and the artifact; both are in flight. | `replica/proofs-self-contained.md` (absent) · `glob packaging/**` (absent) · `tools/build-shell.sh` (header present) · `tools/verify.sh:809-858` |
| ii | **an update channel exists** | **NOT DONE.** `tools/update-engine.sh` is the engine-*bump* discipline for the maintainer, not a user-facing update channel. `replica/research-tech.md` §4 numbers ten missing pieces (artifact channel, signing identity, staging, rollback, elevation, scheduled task, UI/consent, extension-suite updates, update log, the zero-network contradiction) and names **items 1 and 3 the blockers for everything after them**. | `tools/update-engine.sh` · `replica/research-tech.md` §4 |
| iii | **`replica/deploy.md`'s gate passes** | **DONE, with one documented skip — but documented against the dev-tree build, not the packaged artifact.** Last full run: **46 passed, 0 failed, 1 skipped** (`./tools/verify.sh`; `replica/deploy.md` §3). The single SKIP is `--version does not say Ziy` (an engine limitation — the `--version` string comes from `libxul` and does not remap from `App:Name`), with the app-dir boot and the branded screenshot passing instead, and `tools/ziy --ziy-version` answering with Ziy's branding and the engine version labelled. §7 the full-suite gate and §12 the self-contained gate are the ones that matter
for a public release; §4's limitations table must be re-read so nothing in
packaging contradicts a documented engine limit. **The re-run against the
packaged artifact has not happened.** | `replica/deploy.md` §3 · `tools/verify.sh` |

**Until then, the product is announced as what it is: a source-build browser
with its proofs public.** The build path, the measured budget, the blocking
tests and the sync proof are public today; a packaged, self-contained artifact
announcement starts when that artifact exists. Nothing is sold, so there is
nothing to promise late — only things to announce early.

**The Ko-fi page goes live BEFORE the first public build announcement.** Two
reasons, and both are the point rather than a marketing detail: so the early
users who want to support the work have somewhere to send it on day one, and so
the donation link never appears as a paywall that *arrived later*. A browser
whose funding appears only after it has an audience is a browser that turned a
price on for everyone who came early — the exact suspicion §2.2(c) rejects.
Ko-fi is one link on a page that also carries the free download and the build
instructions, in the same breath.

**Also on the gate, and none of them yet done:** the **compliance action list**
below — the licensing work grows rather than shrinks when distribution is free
(§2.6); signing material (ASSUMED-pending-legal-review — every platform wants a
different answer, and `research-tech.md` §3 records Artifact Signing at
$9.99/month as Microsoft's recommended non-Store route, with macOS notarization
mandatory and the Apple Developer Program cost **not fetched**); the
**trademark pass** before the first public release (research-market.md §4.3
Rule 1's acceptance test: grep the launch copy, download listing, domain and
every add-on manifest for `firefox|mozilla|gecko` case-insensitive — zero
brand-implying hits, exactly one permitted "built on … Gecko" sentence beside
its equal-prominence disclaimer); and the **list-licensing table** before the
first public About panel or download page that displays a list name
(`replica/research-legal.md`).

### 2.6 The other options, each ruled out — the record of what was considered

- **A — free, co-owner absorbs the cost.** **This is the adopted model, and the
  cost side is real.** CI on a private repo runs 2,000 min/month and a cold
  Gecko build eats 720–1,680 of them (`deep-fork.md` §6.7; `AI-BRIEF.md`
  §5.10). What makes it affordable rather than merely principled: runners are
  **free on a public repo**, the build inputs are free
  (§2.3 Rule 2 — Mozilla's own checksum-verified tarball), and the packaging
  effort is the same work a paid model would have needed anyway. Ko-fi exists
  so the co-owner is not personally funding strangers' browsing alone — it is a
  supplement, not a revenue line.
- **B — paid app, one-time or annual. RULED OUT, not deferred.** The earlier
  passes called this an "upgrade path once the pipeline is proven"; the
  co-owner's decision closes it. Everything §2.2(c) says applies: a paid tier
  would have to gate something, and every gateable thing is exactly what a
  privacy browser hands out free to be believable. A license-key mechanism
  would also need an entitlement server — the one piece of infrastructure that
  could compromise §1's no-accounts claim, and therefore the one thing Ziy
  should never build.
- **C — source-available + paid binaries.** Not a different model; it is the
  licensing description §2.1.2 establishes that this project already
  satisfies. Publishing the patches and the notice is the MPL obligation either
  way.
- **D — voluntary support only. ADOPTED, as the whole model.** It funds
  engineering time — patch re-verification per engine bump, packaging, signing,
  the update pipeline — and explicitly not any entitlement. There are no tiers
  for it to hide inside, which is what makes it honest.
- **E — a Patreon membership ($3/$7/$15 with real fee math).** The model this
  document recommended before the co-owner's final decision, kept here as the
  negative case with its arithmetic intact: `replica/research-patreon.md`
  computes the standard-plan stack (10% platform + 2.9% + $0.30, a $0.25 ACH
  payout fee, +2.5% FX) and its own recommendation table. Ruled out on §2.2's
  evidence — no paid desktop browser at scale, the subscription creates
  delivery obligations the product cannot yet honour, and there is nothing
  left to gate that a privacy browser may gate.

### 2.7 The cost reality check — honest, unquantified, and no revenue promise

**Ziy has no revenue model and does not need one stated as a forecast.**
Donations are treated as patronage, not income: what they cannot be forecast,
and must not be claimed, is in `replica/research-market.md` §5 — no public
conversion-rate data exists for paid desktop browsers because there is no paid
desktop browser at scale to measure, so no TAM, no conversion curves and no
donation figures appear here by design. The only on-record browser-scale
statement about users paying directly is Vivaldi's, with **millions** of users,
calling donations *"yet to be a significant portion of our income"*
(https://vivaldi.com/blog/vivaldi-business-model/). **Any donation expectation
for Ziy is therefore UNVERIFIED and is not stated.**

**Verifiable on the cost side:** 1) **the pipeline** — CI minutes on a private
repo or a self-hosted runner (8–16 h wall / 180–420 runner minutes per cold
build; free on a *public* repo); 2) **signing** — none exists, every platform
needs a different answer, **ASSUMED-pending-legal-review** and a real cost line
(`research-tech.md` §3 — Artifact Signing $9.99/month on Windows, developer-ID
signing plus notarization on macOS); 3) **the update channel** —
`tools/update-engine.sh` exists for *engine bumps* (checksum → omni.ja patch →
C++ patch re-apply → hard stop), a *user-facing* updater does not, and it is the
largest unbuilt engineering piece (§2.5 gate item ii); 4) **distribution** — the
build directory is **361 MB** per artifact per platform.

**The framing, unchanged in substance from the earlier passes:** a donation
funds engineering time on a hobby-grade release train, **not a salary, and not
a promise**. The browser ships free either way — the artifact exists for people
who cannot build it, and the source path exists so nobody has to trust whoever
did.

---

## 3. SEQUENCING — publish now, or wait?

**The state, flatly, checked 2026-10-15:** no self-contained packaged binary
(`tools/build-shell.sh` builds an app dir; the `packaging/linux/` tarball stage
**does not exist** — `replica/architecture.md` §0.1, confirmed by
`glob packaging/**` returning path-not-found); no code signing; no user-facing
auto-update channel; no installer. The self-contained *engine fetch* path and
its verify gate are written (`tools/build-shell.sh` header;
`tools/verify.sh:809-858`), but `replica/proofs-self-contained.md` does not
exist and the tarball artifact it would document is not built. `.desktop`
integration exists but is not a packaged artifact.

**A product that promises a deliverable it does not have teaches its users,
permanently, that its promises are marketing** — and the promises are the
product. Card 5's whole value is that it is checkable. That rule survives the
pivot untouched: with no tiers there is nothing to buy, but there is still a
public page, and the page must not announce a packaged artifact that does not
exist.

### Recommendation: **the free product is announced when §2.5's gate passes;
the Ko-fi page goes up first (before the first build announcement).**

1. **Now:** the Ko-fi page — the donation link, and the sentence that says what
   donations are (**time, not influence**) and what they are not (access,
   features, priority). It carries the free download and the build
   instructions beside it, so the link reads as support and not as a store.
2. **Now:** the pre-launch page, which says exactly what is true — *"the
   blocking lists, the measured budget and the sync proof are public today;
   the packaged, self-contained build starts when the first signed tarball
   exists."* No artifact is announced that does not exist. There is no insider
   list to promise a place on, because there are no insiders — only readers of
   the public tracker.
3. **When the first packaged build exists:** the release page, with the
   SHA-256/SHA-512 digests and the build date beside the download (§2.3 Rule 3),
   the free download and the source-build instructions side by side.
4. **When signing exists:** signed builds for every platform, published the same
   way — the coercion-free choice that reproduces what the old model promised
   nobody could get without paying.

### 3.1 Patreon compliance — obsolete as a model question, kept as evidence

**Nothing here binds a free product.** A donation on Ko-fi is not a membership
and carries no tier description, no delivery obligation and no reward. It is
recorded here because `replica/research-patreon.md`'s findings are the reason
the subscription was rejected, and because they still inform two things that
apply to a free launch:

- **The delivery discipline survives.** Whatever ships still gets its digest
  line and build date beside the download (§2.3 Rule 3), so a user fetching
  from a wrong mirror is told by arithmetic, not trust.
- **The marks discipline survives.** No Brave and no Mozilla/Firefox marks
  anywhere user-facing, with the permitted "built on Mozilla open source
  technology" sentence at equal prominence with the "not officially associated
  with Mozilla" disclaimer (`replica/research-market.md` §4.3 Rule 1) — which
  applies to every free distribution too (§2.1.2).
- **The no-anti-paywalling finding (Q5)** is worth remembering as the reason
  the withdrawal was voluntary: nothing external forced the pivot, which is
  what makes the free promise credible rather than tactical.

The design consequence of the old tier rules still holds in the only form that
applies now: **there is no entitlement to deliver, so there is nothing that can
be promised unkeepable** — no build, no channel, no credits, and above all no
open-ended "all future support" claim.

---

## 4. BRAND & VOICE IMPLICATIONS (`replica-brand` owns the work)

1. Two voices are already decided: the **cat carries identity** (app icon,
   welcome, about, empty states) and the **shield carries function** (toolbar,
   shields state) — and they must never share a surface (`MASCOT.md` rules
   1–2). The free posture fits: the cat is what you keep, the shield is what
   you trust, and neither has a price tag.
2. The teal earns the positioning: gloam teal `#0b6e6e` was chosen because it
   means "sealed" — wax, watertight joins, cold storage — and clears 4.5:1 on
   every measured neutral (`colors.md`). A brand whose one signature colour
   *means the promise* needs no second accent, and needs no upsell either.
3. The mascot's palette is a story: the cat keeps its own measured ginger
   palette while every brand mark stays teal (`MASCOT.md` palette policy) —
   warm living creature, cool sealed machinery. That is the craft story.
4. The voice is plain, specific, unhurried: number-heavy status lines in Ziy's
   own words ("Blocking is on for this site. 42 requests stopped this visit.")
   and empty states with one real action (`components.md` copy rule). It states
   facts and lets the reader draw the conclusion.
5. No competitor names, ever — the mascot SVGs already carry no competitor name
   in their `aria-label`, and the hero copy obeys the same rule.
6. What the name and mark must not do: no lion or crown vocabulary (another
   product's silhouette family), no "shield first, product second" lockup, and
   the cat is never a status light — a mascot that turns red on failure has
   made its personality a warning lamp.

### Worked hero copy

> **Ziy is a browser.**
>
> That is the whole thing: no assistant, no wallet, no rewards, no VPN, no
> sponsored new tab, and nothing to pay for. Not a trial, not a tier, not a
> "Pro." Everything you see is in the build you can download free or compile
> yourself from source.
>
> Seven blocking lists ship on by default — including the one that takes down
> "turn off your ad blocker" walls — and the shields panel tells you what
> stopped. Measured on this box: 1.0 GiB idle, 5.62 s to a painted new tab,
> zero network requests left idle for 120 seconds, 5 of 5 trackers stopped.
> Your sync server cannot read your bookmarks; we tested that by holding the
> database and grepping it.
>
> **It's free. If it's useful to you, there's a Ko-fi link. That's all there
> is.**

No competitor appears; every number is a §1 citation; the free version and the
source build are stated in the same breath as the download; and the last
sentence is the one a skeptic can go check — which is what makes the rest
believable. **The rule the copy obeys:** the hero says what Ziy *refuses to
be*, never what it *charges*. There is no price in the copy because there is
no price in the product; the donation line is a link, not an offer.

**Why the hero got simpler.** The old hero led with "That's the whole thing" —
a refusal already. Under the tier model it needed the pricing qualifier
("premium craft, sold on Patreon") bolted to the end to be accurate; under free
there is none to bolt on. The strongest sentence in the copy is now the one
needing no defence: nothing to pay for.

---

## 5. THE "1000x" FRAMING, MADE DEFENSIBLE

**Recommendation: concept (b) — "the things Brave ships that Ziy refuses to" —
with a quantified register as its appendix. Not a multiplier table.** Why not
(a): there is no unit in which a browser is 1000× another browser. The honest
version of "1000×" is *counting the things one product carries that the other
refuses*, and every refusal is a row with a number. A multiplier table also
invites the reader to fill the gaps in our favour (idle CPU, mobile, index) —
which the counterweights exist to prevent.

**The register — every line is a `features.csv` row (207 total; 36 cut,
12 skip):**

| what Brave ships | what Ziy does | rows |
| --- | --- | ---: |
| the crypto wallet end to end (create/import/lock/portfolio/send/networks/NFTs/swaps/on-ramps/off-ramps/market data/hardware/`window.ethereum`) | no wallet code in the tree | **13** |
| the rewards/BAT economy (enablement, earning, tips, recurring, creator registry, profile states, confirmation accounting) | no marketplace, no token, no ledger | **12** |
| the VPN (toggle, regions, subscription, devices, killswitch) + Guardian backbone | no tunnel code | **6** |
| the wallet sidebar and its modes, shortcuts, bookmark panel | no sidebar shortcuts chrome | **4** |
| NTP sponsored images, notification ads, ad confirmation, the ad marketplace | no ad surface, no sponsored NTP | **5** |
| P3A analytics, the Brave account, Widevine, Chromium site isolation, Mojo/Skia, `brave://flags` | not shipped | **7** |
| the AI assistant, including answer-in-search | no LLM backend anywhere | **1** |
| Brave Origin — a $59.99 build with the revenue features removed | **the lean build is the free build** | **1** |

**Sum of the named refusals: 36 cut + 12 skip = 48 rows of Brave's own
catalogue that Ziy declines to ship.** That is the honest "1000×" story: not
that Ziy has 1000× more of something, but that **Brave's catalogue contains a
revenue infrastructure and Ziy's answer to it is zero rows** — presented as a
register in the About panel and on the download page, beside the Ko-fi link, not
a slogan. The slogan is one line: **"Ziy is a browser."** The reverse
register stays attached: no index, no mobile, 73 unbuilt rows, 5 un-compiled
patches against Brave's 1,287.

---

## 6. THE LAUNCH SEQUENCE — in order, each with its gate

1. **Self-contained tarball build, reproducible.** In flight (`packaging/linux/`
   absent; the `self-contained` worker owns it). Gate: `build-shell.sh` +
   `build-extension.sh --all` on a clean box, `verify.sh` green, and a boot of
   the *packaged* artifact, not the dev tree.
2. **Signing — or reproducibility as its honest substitute.** Gate: platform
   signing material exists (cost line, ASSUMED-pending-legal-review), **or** the
   build is bit-reproducible from published source — `tools/lib/zpxi.py` is
   already deterministic (fixed timestamps, sorted entries; `deploy.md` §1's
   "the same tree gives the same bytes"), so anyone can build the same bytes
   and compare them against the published download's hash.
3. **An update path exists.** Gate: a channel that actually delivers builds,
   with `tools/update-engine.sh`'s four-step bump discipline wired into the
   release, not just the engine.
4. **The deploy gate passes.** `verify.sh` = 46 passed / 0 failed / 1 skipped
   (the SKIP is the engine `--version` string, with the fallback passing),
   including §7 the full-suite gate and §12 the clean-room guard (`deploy.md`
   §3) — run against the *packaged* artifact, with §4's limitations table
   re-read so nothing in packaging contradicts a documented engine limit.
5. **The compliance and trademark pass.** The name was chosen for no known
   collision (`architecture.md` header), but a *distributed* build is when it
   matters. Gate: (a) the MPL §3.2(a) source-availability notice shipping in
   the app dir, with the five patches shipped and the notices inside the
   binaries untouched (§2.1.2; `replica/research-legal.md` §2.4); (b) the
   "not officially associated with Mozilla" notice at equal prominence with the
   permitted credit line (`research-market.md` §4.3 Rule 1); (c) no Brave
   marks anywhere user-facing (research-patreon.md gotcha 3); (d) the residual
   `Mozilla Firefox` marks problem from `replica/research-legal.md` §2.3
   addressed for the packaged artifact. **ASSUMED-pending-legal-review** — a
   trademark clearance is a human step.
6. **The Ko-fi page is live**, with the donation line stating plainly that
   donations buy time, not influence, and with the free download and the build
   instructions beside it (§2.5). **This gate is BEFORE the build announcement,
   not after** — so it never reads as a paywall arriving later.
7. **The list-licensing table** lands before the first public About panel or
   download page that displays a list name — list-licensing obligations:
   `replica/research-legal.md`. **Free distribution does not remove this duty**
   (§2.1.2).
8. **The two open claim-card proofs.** (a) The Spotify in-browser proof
   (`proofs-blocking-strength.md` §5.4) must PASS before that claim is used
   publicly. (b) The machine-readable endpoint list and first-run privacy
   statement (fix plan 7) must ship before Card 7's strongest form is used.

**Then, in order of value:** the Ko-fi page; the pre-launch page stating what is
public today; the release page with digests when the packaged build exists;
and, when signing exists, signed builds for every platform, published the same
free way. There is no "next tier" — the launch sequence ends with the product
being given away as well as it can be given away.

---

*Report line for the co-owner: 7 claim cards + 6 counterweights; **model =
FREE, PREMIUM QUALITY, KO-FI DONATIONS** — the co-owner's final decision
replaces the Patreon $3/$7/$15 tier model, whose fee math and contract rules are
preserved as the cited negative case (`replica/research-patreon.md`,
`replica/research-market.md`) rather than deleted; the tier-contract rules
survive unchanged as product invariants — nothing is gated, for anyone, ever;
donations buy engineering time (the per-engine-bump patch maintenance, the
packaging/signing pipeline, the update pipeline) and explicitly buy **time, not
influence**; the pre-launch gate is unchanged and was never about money, with
one added line — **the Ko-fi page goes live before the first public build
announcement**; the compliance work does not shrink for free distribution (MPL
§3.2(a) notice, the not-affiliated-with-Mozilla notice, the residual
`Mozilla Firefox` marks problem, the filter-list license gaps, the
Brave-patent skim), while the EU withdrawal/VAT rules become
NOT-APPLICABLE-now-sale because there is no sale; remaining launch blockers =
no packaged artifact, no signing, no user-facing update channel, the deploy gate
against a packaged artifact, the compliance/trademark pass, the list-licensing
table, and the two open claim-card proofs (Spotify in-browser, endpoint
list/first-run statement).*
