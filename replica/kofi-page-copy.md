# replica/kofi-page-copy.md — the launch copy for the Ko-fi page

**Status: DRAFT — the co-owner applies it by hand.** The page exists
(<https://ko-fi.com/ziyzenix>) and its current copy still reads as a personal
hardware ask. `replica/deploy.md` §5 row 10 makes the page a launch **ordering
rule**: it goes live *before* the first public build announcement, so the
donation link is present on day one rather than arriving later as a paywall.
Everything below is assembled from `replica/premium-position.md` §2.4–§2.5
(what a donation buys — and does not), §2.3 (no gating), and `replica/deploy.md`
§5 rows 6 + 10. Nothing here is a new decision.

---

## 1. The rules the copy has to satisfy

1. **Donations buy time, not influence.** Stated plainly, "in the spirit of
   §2.3 Rule 3" — one sentence, no hedging (`premium-position.md` §2.4).
2. **The free download and the build instructions sit beside the donation link,
   in the same breath** (§2.5). The link is never alone.
3. **Nothing deliverable is promised** (`premium-position.md` §2.4 opening;
   `deploy.md` §5's closing note: "the page must promise nothing deliverable").
4. **No tiers, no perks, no early access, no roadmap influence** — there is no
   second build for them to live in (`premium-position.md` §2.3).
5. **Trademark shape, same as every other surface:** at most one permitted
   "built on … Gecko" sentence, with the not-affiliated disclaimer at equal
   prominence next to it (`research-market.md` §4.3 Rule 1;
   `research-legal.md` §2.2).

## 2. The draft copy (paste-ready)

### Page headline / title

> Ziy — a free, privacy-first browser, built in the open

### About (short block)

> Ziy is a free browser for Linux with no accounts, no telemetry, and no
> sponsored anything. It reimplements the privacy features people actually use
> — ad and tracker blocking, private search, a sync that the server cannot read
> — and every claim it makes is measured in public: the proof documents ship in
> the source tree.
>
> Ziy is built on Mozilla's open source Gecko technology. Ziy is not officially
> associated with Mozilla or its products.

### What a donation buys

> Donations buy time, not influence. Concretely, they fund:
>
> - re-verifying the engine patches against every new release of the engine —
>   if the patches stop applying, the browser stops shipping;
> - packaging and signing builds for each platform;
> - the update pipeline, which does not exist yet — building it is the work;
> - the licensing and trademark pass that any distributed build needs.
>
> No feature, no access, no priority, no say over the roadmap. There is one
> build and everyone gets it. One-off or monthly, the same sentence holds.

### Where the build lives

> Free download and build-from-source instructions: **<repo URL>**
> Source builds today; packaged builds arrive with the first release. Both
> free, both always.

### The one-liner (footer / short bio field)

> No company, no ads to sell you, nothing to upsell. Just a browser that minds
> its own business.

## 3. What must NOT appear (each line is a promise the product cannot keep)

| do not write | why |
| --- | --- |
| "get early access" / "priority support" / "supporter badge" | implies a second build; none exists (`premium-position.md` §2.3) |
| "help me buy a GPU/VGA" / any hardware ask | the funded costs are patch maintenance, packaging, signing, the update pipeline (§2.4 items 1–5) — not hardware; it also reads as a personal gift, not project funding |
| any date ("coming this month", "v1 soon") | the launch is artifact-gated (`deploy.md` §5 rows 1–3); no date may be promised |
| "your name in the credits" | a deliverable — forbidden by the page rule (`deploy.md` §5's closing note) |
| a Ko-fi membership with "perks" | same as row 1; keep to one-off and plain monthly tips if monthly is offered at all |

## 4. Apply checklist (co-owner)

1. Paste §2 into the page fields; keep the not-affiliated sentence and the
   built-on sentence together (one line apart at most).
2. Add the download + build URL in the same block as the donation ask
   (it can be the repo URL now; swap it for the release page when one exists).
3. **Before going live:** read Ko-fi's own terms as they apply to
   donation-supported software — still **UNVERIFIED**
   (`deploy.md` §5 closing note; `premium-position.md` §2.5 item list).
4. The page is upstream of the first public build announcement; the
   announcement itself waits on rows 1–3 of `deploy.md` §5.
