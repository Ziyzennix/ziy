# Patreon research: distributing software builds as membership rewards (Ziy)

Research date: 2026-10-15. Method: live fetches of Patreon's own policy/help pages.
Fetches used: 4 successful (1 404 on old help URL, 1 404 on guessed ToU slug). Current
policy pages verified as of the dates shown on the pages.

## Sources (all fetched and read)

| # | Source | URL | Status |
|---|--------|-----|--------|
| S1 | Terms of Use (last updated May 27, 2026) | https://www.patreon.com/policy/legal | Reachable |
| S2 | Commerce Guidelines | https://www.patreon.com/policy/benefits | Reachable |
| S3 | Creator fees overview (updated Sep 11, 2026) | https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees-overview | Reachable |
| S4 | Selling one-time purchases on Patreon (updated Sep 11, 2026) | https://support.patreon.com/hc/en-us/articles/16303719836813-Selling-one-time-purchases-on-Patreon | Reachable |
| S5 | "What can I offer as a Patreon benefit?" help article | https://support.patreon.com/hc/en-us/articles/204922215 | **Unreachable (HTTP 404)** |
| S6 | `/policy/terms` slug | https://www.patreon.com/policy/terms | **Unreachable (HTTP 404)** — current ToU lives at S1 |

Note: the old `patreon.com/policy/terms` URL 404s; the live Terms of Use is at
https://www.patreon.com/policy/legal. S5's replacement article number was not found
within the fetch budget; the Terms themselves define permissible benefits (quoted below).

## Q1 — Can a creator distribute software builds as a membership benefit?

YES, with conditions. Verified answers:

- The Terms (S1) expressly contemplate "additional access, merchandise, exclusive
  creations, and engaging community experiences" as member benefits, and set the
  compliance gate: benefits must be permissible under the Community Guidelines and the
  **Commerce Guidelines** (S1 → S2).
- The Commerce Guidelines (S2) enumerate 11 prohibited categories (alcohol, drugs,
  financial products, food/health, gambling, gift cards, infringing IP, recalled goods,
  sexual material, hate, weapons). **Software / digital files are NOT on the prohibited
  list.** No rule in the current Commerce Guidelines or Terms excludes digital goods as
  the sole content of a tier.
- Historical caveat: Patreon has previously debated "digital-goods-only" restrictions,
  but no such rule appears in the CURRENT policy set (S1, S2, S3, S4). Current state:
  permitted. I could not locate any current page stating a digital-goods-only ban.
- Sales are one-time ("offerings") or auto-renewing subscriptions ("memberships") (S1).
  Monthly builds fit the membership model directly; Patreon is the billing entity.
- Hard requirements that do affect software (S2): every product/benefit must have a
  listing that "clearly describes the item being sold, **including how it will be
  accessed, downloaded, or delivered**" — vague tier descriptions ("browser stuff") are
  a takedown risk.
- Delivery mechanics (S4): member-only posts and Shop products carry file attachments.
  Supported downloadable formats include **.zip and .7-Zip (max 5 GB, 25 files)** —
  but **.exe / .dmg / .deb / .AppImage are NOT in the listed attachment formats**.
  Ship builds as archives. (Exact membership-post attachment list links to article
  204606055, NOT fetched — unverified; only the Shop list in S4 is confirmed.)
- Export control (S1): "you will not use Patreon to distribute any creations or other
  materials — including any commodities, **software, or technology** — in violation of
  such laws." Software distribution is explicitly contemplated, subject to sanctions law
  (S1 sanctions policy; creators/members in comprehensively sanctioned territories are
  barred).

## Q2 — Ongoing delivery obligations

There is NO platform-mandated delivery cadence in the Terms. What actually binds you:

- What you sell is the **tier description**. S2 requires listings to describe access/
  download/delivery clearly; the contract is between creator and member. If the tier
  says "monthly build," skipping a month is a breach toward your patrons, not a Patreon
  rule violation — Patreon's own ToU disclaims liability: "We are specifically not liable
  for loss associated with unfulfilled offerings and benefits" (S1).
- Member license (S1): patrons get a "non-exclusive, non-transferable, non-sublicensable,
  **revocable**, limited license to access and view" creations — access may be revoked.
  Patrons may not share the creations (including your builds) with non-payers (S1). Your
  builds should be account/license-gated accordingly.
- Practical enforcement lever: Patreon handles billing, fraud and chargebacks "typically"
  (S1); if payments fail, members are auto-downgraded to free membership (S1). So the
  monthly obligation is: keep delivering what the tier copy promises, and everything
  about money is handled upstream.
- The only explicit good-faith delivery duty in the Terms concerns Gift Memberships (S1).

## Q3 — Fees and honest net math (standard 10% plan)

Ziy is a new page → standard plan applies (S3: "If you published your creator page after
August 4, 2025... you are on our standard 10% pricing plan"). Components:

- **Platform fee: 10%** of successfully processed payments, excluding sales tax (S3).
- **Payment processing (USD payout): 2.9% + $0.30** per payment (credit card/Apple Pay,
  any location; PayPal US same; PayPal non-US 3.9% + $0.30) (S3).
- **Payout fee (extra, not per-transaction): $0.25** ACH direct deposit per payout, or
  PayPal 1% (min $0.25, cap $20) (S3).
- Currency conversion: +2.5% if a member pays in a currency other than your payout
  currency (S3). Patreon may add sales tax on top of your fees in some jurisdictions (S3).

Net per member per month (10% + 2.9% + $0.30, USD payout, no FX, no payout fee):

| Tier (gross) | Platform 10% | Processing 2.9%+$0.30 | Total fees | **Net** | Net % |
|---|---|---|---|---|---|
| $3  | $0.30   | $0.387          | $0.687  | $2.31  | 77.1% |
| $5  | $0.50   | $0.445          | $0.945  | $4.06  | 81.1% |
| $7  | $0.70   | $0.503          | $1.203  | $5.80  | 82.8% |
| $10 | $1.00   | $0.590          | $1.590  | $8.41  | 84.1% |
| $15 | $1.50   | $0.735          | $2.235  | $12.77 | 85.1% |
| $25 | $2.50   | $1.025          | $3.525  | $21.48 | 85.9% |

Subtract the payout fee (~$0.25/month ACH) from each. The flat $0.30 punishes small
tiers: a $3 tier loses ~23% to fees; $15+ tiers keep ~85%. Patreon's Shop price floor
is $3 for one-time purchases (S4) — minimum membership tier price not verified.

## Q4 — Refunds and chargebacks (software-seller impact)

- Patreon is the merchant of record: "Patreon is the billing entity that is associated
  with this charge" (S1). Patreon "typically" handles fraud, chargebacks, payment
  disputes (S1).
- Default member-facing policy: "Our policy is not to provide refunds... though we may
  allow for some exceptions where refunds are granted at our sole discretion" (S1,
  refund policy article linked therein).
- **You can eat chargebacks** (S1): refunds and chargebacks can push your balance
  negative; "any fees you've incurred from Patreon or the platforms... may not be
  refunded to you"; Patreon may recover the shortfall from future payouts. So a
  chargeback on a $5 tier can net you less than zero after fees.
- One-time digital purchases: creator-issued refunds allowed up to **90 days** after
  purchase; refunded customers **immediately lose access**; refunds take 5–7 business
  days and cannot be undone; funds must be available in your balance first (S4).
- If you delete a purchased product, Patreon prompts you to refund all or selected
  buyers (S4) — relevant if you ever pull a bad Ziy build.
- iOS App Store purchases are handled by Apple's systems and refund flow, not Patreon
  (S1, S4) — another reason to steer patrons to web checkout.

## Q5 — Selling a "premium version" of something public / open-source

Permitted to gate CONVENIENCE. The relevant rules are narrow:

- Nothing in S1/S2 prohibits selling a product whose code (or a similar product) is
  public. The Commerce Guidelines' IP rule (S2 #7) only bars offerings that "infringe
  upon or violate the intellectual property rights of any third party, including
  copyright or trademark... includ[ing]... products... that imitate genuine products."
- The ToU's summary of disallowed benefits: illegal, abusive, **misleading or deceptive**,
  infringing others' IP, sexual (S1).
- Therefore gating packaging/support/earlier builds while the code stays public is
  allowed **provided**: (a) you hold the rights in what you distribute — i.e., you comply
  with the upstream license (Chromium/BSD-style and any Brave-derived MPL obligations:
  preserve attribution and license notices); (b) **no Brave trademarks** — the name
  "Brave," its logo, Shields, BAT, etc. must not appear in the paid product or its
  marketing (that is the "imitation/infringement" tripwire, and also a deceptive-listing
  risk); (c) your tier copy accurately describes what patrons get. There is no
  anti-paywalling-of-public-content rule found in the current policy set.
- Creator ownership is confirmed: "Creators keep full ownership of their creations" (S1).

## Recommended tier table (computed with real fees)

Pricing logic: keep the $0.30 flat from dominating; anchor value on conveniences an
open-source project cannot easily offer (signed installers, auto-update, insider builds,
priority support). Net = 10% platform + 2.9% + $0.30 processing, before payout fee.

| Tier | Price | What it gates (convenience, not code) | Platform | Processing | Fees total | Net/member/mo |
|---|---|---|---|---|---|---|
| Public | $0 | Source + release builds (everywhere) | $0 | $0 | $0 | $0 |
| Insider | $5 | Early-access builds, changelog access | $0.50 | $0.445 | $0.945 | $4.06 |
| Supporter | $7 | Signed installers + auto-update channel | $0.70 | $0.503 | $1.203 | $5.80 |
| Priority | $15 | Above + priority fixes/support + insider vote | $1.50 | $0.735 | $2.235 | $12.77 |

Recommended floor: **$5 minimum** (a $3 tier nets only $2.31/member). If one paid tier
only: **$7** (balance of conversion vs. $5.80 net). Annual memberships are allowed on
Patreon (S1) and discount the flat-fee pain — worth offering at $70/yr.

## Gotchas for Ziy (blunt)

1. **No executable attachments in Shop products.** The confirmed attachment formats are
   .zip/.7-Zip etc. (S4); .exe/.dmg/.deb are not listed. Ship builds as archives or
   link out — but out-links weaken the "described delivery" requirement in S2. Verify
   the membership-post attachment list (article 204606055) before launch: **not fetched,
   unverified**.
2. **Vague tier copy = removal risk.** S2: listing must clearly describe how the product
   is accessed/downloaded/delivered. "Premium Ziy access" is not a deliverable.
3. **Trademark landmine.** Ziy is a Brave-derived fork; using Brave's name, logo,
   Shields branding, or "Brave but…" marketing in the paid listing risks the S2 #7
   infringement/"imitation" rule and the deceptive-benefit rule. Rebrand completely.
4. **Chargebacks can make you net-negative** (S1: fees not refunded, clawback from
   future payouts). Refunds for digital purchases are allowed up to 90 days (S4).
5. **Sanctions/export control** (S1): no software distribution in violation of export
   law; sanctioned-territory creators/members barred — plan geo-gating of builds.
6. **Member sharing is prohibited by ToU** (S1) but technically trivial for build files;
   your protection is the account-gated delivery channel, not Patreon enforcement.
7. **No cadence enforcement from Patreon** — the monthly build promise is yours alone;
   Patreon disclaims liability for unfulfilled benefits (S1).
8. **Tax/VAT on your fees** may apply based on your location (S3) — add to the net math
   if you're VAT-liable. FX members cost an extra 2.5% (S3).
9. Prices for one-time purchases are $3–$5,000 (S4); membership-tier minimum price
   unverified. Payout minimums exist per method (e.g., PayPal $10, S3).
