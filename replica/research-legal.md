# Legal & IP research — Ziy's posture, verified 2026-10-15

Every claim below carries a URL or a `file:line` in this tree. Where a fact could not be
verified, it says **UNVERIFIED** instead of guessing. This document is the single source of
truth for the **filter-list license table** (§6) — `premium-position` cites it rather than
producing a second one.

**Not legal advice.** This is engineering reconnaissance against primary sources. Three
findings below are genuine risks (§2.3, §3.4, §6.3), and one of them (§2.3) is a hard blocker
for the current distribution path.

---

## 1. MPL-2.0 in practice — the five rules Ziy's distribution must follow

### 1.1 The licence obligations

**Rule 1 — Selling is allowed; the MPL puts no price on distribution.**
The MPL FAQ answers directly: distributable MPL software "is available for anyone (including
individuals and companies) to use for any purpose", and §3.2 of the licence says the Executable
Form may be "distribute[d] … under the terms of this License, **or sublicense it under
different terms**". MPL FAQ Q5/Q10: <https://www.mozilla.org/en-US/MPL/2.0/FAQ/>. There is no
"non-commercial" clause anywhere in the text: <https://www.mozilla.org/en-US/MPL/2.0/> §3.2.
**Charging for Ziy does not waive or trigger any extra MPL duty.** (MPL §3.5 does let us charge
for *warranty/support/indemnity* — but only in our own name, never "on behalf of any
Contributor". If Ziy sells a support plan, the disclaimer must say Ziy alone offers it.)

**Rule 2 — Proprietary code may be combined; only *modified* MPL files must be published.**
This is the "file-level copyleft" the FAQ describes: "The MPL's 'file-level' copyleft is
designed to encourage contributors to share modifications they make to your code, while still
allowing them to combine your code with code under other licenses (open or proprietary) with
minimal restrictions" (FAQ Q1). FAQ Q11 is explicit for our exact case: "new files containing no
MPL-licensed code are not Modifications, and therefore do not need to be distributed under the
terms of the MPL, even if you create a Larger Work … by using, compiling, or distributing the
non-MPL files together with MPL-licensed files", citing "statically linked to and distributed as
part of a larger proprietary piece of software". Definitions: <https://www.mozilla.org/en-US/MPL/2.0/>
§1.7 (Larger Work), §1.10 (Modifications = "any file in Source Code Form that results from an
addition to, deletion from, or modification of the contents of Covered Software; or any new
file … that contains any Covered Software").

**Rule 3 — Every Covered file we change must have its source published, MPL-licensed.**
§3.1: "All distribution of Covered Software in Source Code Form, including any Modifications
that You create … must be under the terms of this License. You must inform recipients that the
Source Code Form … is governed by the terms of this License, and how they can obtain a copy of
this License." <https://www.mozilla.org/en-US/MPL/2.0/#section-3>

**Rule 4 — The Executable Form must ship a source-availability notice (this is §3.2(a)).**
§3.2 verbatim: "If You distribute Covered Software in Executable Form then: (1) such Covered
Software must also be made available in Source Code Form, as described in Section 3.1, and You
must **inform recipients of the Executable Form how they can obtain a copy of such Source Code
Form by reasonable means in a timely manner, at a charge no more than the cost of
distribution**." <https://www.mozilla.org/en-US/MPL/2.0/#section-3>. FAQ Q10 restates it for our
case: "You must make available the MPL-licensed portions of the source code … and inform the
recipients how they can obtain such source code." The obligation is a *notice*, not a bundled
copy: a pointer suffices if it is "reasonable means in a timely manner". FAQ Q26 also kills any
cost-barrier theory: a courier or other costly mechanism "adds cost and complexity without a
specific, necessary purpose [and] is not reasonable, and so does not comply with … 3.2(a)".

**Rule 5 — Never strip or alter the notices already inside the source.**
§3.4: "You may not remove or alter the substance of any license notices (including copyright
notices, patent notices, disclaimers of warranty, or limitations of liability) contained within
the Source Code Form of the Covered Software, except … to remedy known factual inaccuracies."
<https://www.mozilla.org/en-US/MPL/2.0/#section-3>. FAQ Q19 permits *runtime-displayed* notices
to change but §3.4-licensed source notices are sacrosanct.

Two adjacent rules worth knowing: §3.2(b) — our EULA "does not attempt to limit or alter the
recipients' rights in the Source Code Form"; and §5.1 — **the licence terminates automatically
on non-compliance** (with the 30/60-day cure path). Getting the notices wrong is not a curable
marketing tweak; it is a licence-loss event for the whole engine.

FAQ caveat, quoted from the source itself: this FAQ "*is not the license* … reading the FAQ
should not serve as a substitute for reading the license itself, or for seeking legal advice
from a lawyer" (<https://www.mozilla.org/en-US/MPL/2.0/FAQ/>).

### 1.2 Checklist — what ships where

| artifact | MPL character | duty | status in tree | action |
| --- | --- | --- | --- | --- |
| `patches/0001–0005*.patch` | **Modifications** (§1.10.1) of MPL files | Publish as MPL source (§3.1) + point at it from the app dir (§3.2(a)) | Files exist and apply cleanly (`patches/README.md:8-16`) but **nothing ships them** | Ship `patches/` verbatim with the product + include the notice |
| patched `omni.ja` / `browser/omni.ja` | Executable Form of **modified** Covered Software | §3.2(a) notice pointing to source | Patched at `tools/build-shell.sh:210-211` and `:255-256`; **no notice anywhere in `build/ziy/`** (see §2.3) | Add `LICENSES/` or `about` entry with the source pointer |
| engine binary we redistribute (`libxul.so`, `libmoz*.so`, `omni.ja`) | Unmodified Executable Form of Covered Software | §3.2(a) notice — ours to carry even though the upstream binary already complied (FAQ Q7/Q8) | Fetched and verified at `tools/lib/fetch-engine.sh`; no notice in the shipped app dir | Ship the notice; the source is Mozilla's published tarball |
| our own extensions (`extensions/ziy-*`, MV3 suite) | **Larger Work** — new files, no MPL code | None from MPL; our own licence choice | Suite ships as `.xpi` in `distribution/extensions/` (`tools/build-shell.sh:297-310`) | Declare Ziy's own licence; the LICENSES file exists only for shields (§6) |
| our shell layer (`shell/`, `tools/`, `brand/`, `native/`, `server/`) | Larger Work, our authorship | None from MPL | Already tracked in git | No change |
| filter-list snapshots | Not MPL — GPL/CC list data (§6) | Their own duties | `LICENSES` covers 3 of 7 lists | **§6.3** |
| `patches/README.md`, proof docs | Documentation, not Covered Software | None | Present | No change |

The MPL obligations land on **two artifacts that are currently invisible to a recipient**: the
C++ patch set and the patched omni.ja. Both are fixed by one action: ship the patch set and a
notice that says where the engine source and our modifications are.

---

## 2. Redistribution of a patched Firefox binary

### 2.1 The two regimes, stated plainly

Mozilla splits the question into *code rights* (MPL) and *brand rights* (trademark), and says so
on the face of the distribution policy: "What you can and cannot do with our software products
and code – **independent of our trademarks** – is governed by the relevant software licenses …
The Mozilla Public License does not contain grant permission to use Mozilla trademarks, as is
set out in its section 2.1" (<https://www.mozilla.org/en-US/foundation/trademarks/distribution-policy>).

**Unaltered binary redistribution is permitted, with a no-charge rule.** The Unaltered Software
Distribution Policy (<https://www.mozilla.org/en-US/foundation/trademarks/distribution-policy>)
allows unaltered copies "without express permission from Mozilla" subject to:

- "You may not charge for the software. That means: Distribution may not be subject to any fee.
  Distribution may not be tied to purchasing a product or service."
- no personal-information collection in the distribution context;
- "You may not add to, remove, or change any part of the software, including the Mozilla
  trademarks themselves. For example, you may not add any extensions to Firefox, change default
  settings, or alter search codes";
- unmodified installation process;
- you must ship the latest stable version.

**Any change flips it to "prior written permission".** "Modified Versions Require Prior Written
Permission": "if you make *any* changes to Firefox or other Mozilla software, you may not
redistribute that product using *any* Mozilla trademark without Mozilla's prior written consent
and, typically, a distribution agreement with Mozilla. **For example, you may not distribute a
modified form of Firefox and continue to call it Firefox.**" The enumerated list of changes
requiring permission includes exactly our three modifications: "Adding, modifying, or deleting
source files", "File location changes", "Adding extensions, add-ons or plugins". Contact for a
request: <trademark-permissions@mozilla.com> (same page).

### 2.2 Applied to `tools/build-shell.sh`'s tarball path

The path is: fetch Mozilla's official binary tarball → checksum-verify against Mozilla's
published SHA512SUMS → extract → rename/rebrand the app dir → patch omni.ja → add our extensions
and prefs. Script: `tools/lib/fetch-engine.sh:2-14` (the "NOT a Gecko compile … unzip" note and
the provenance rationale), invoked from `tools/build-shell.sh:98`.

Verdict, by modification:

| our modification | policy character | trademark consequence |
| --- | --- | --- |
| checksum-verified **extraction** of the official tarball | redistribution of an unaltered copy | allowed, **but** the no-charge rule applies to *that copy* — irrelevant once it stops being that copy |
| app-dir rename + `application.ini` (`Name=Ziy`, `Vendor=Ziy`, own UUID — `build/ziy/browser/application.ini`) | "File location changes" + branding change | permission-triggering, and **it is also what saves us**: we do not call it Firefox |
| omni.ja patches (`MOZ_REQUIRE_SIGNING`, `MOZ_ALLOW_ADDON_SIDELOAD` — `tools/build-shell.sh:210-211`) | "Adding, modifying, or deleting content from" the software | permission-triggering if any Mozilla mark survives |
| built-in New Tab strip (`tools/patches/newtab-strip.toml`, applied at `tools/build-shell.sh:255-256`) | content deletion | permission-triggering if any Mozilla mark survives |
| our 9 XPIs in `distribution/extensions/` | "Adding extensions, add-ons or plugins" | permission-triggering if any Mozilla mark survives |
| pref/policy layer, `mozilla.cfg`, userChrome | "change default settings" | same |

**So the tarball path is clean *only* in the brand sense: it is a modified distribution, and we
must not present it as Firefox.** It is not "unaltered redistribution" for any purpose — the
moment we rename the app dir we are in the modified regime.

The path itself, with correct citations: `tools/lib/fetch-engine.sh:2-14` (the "NOT a Gecko
compile … unzip" note and the provenance rationale), the manifest fetch and per-line digest
check at `tools/lib/fetch-engine.sh:24-28`, invoked from `tools/build-shell.sh:98`; the omni.ja
signing/sideload patch at `tools/build-shell.sh:210-211`; the built-in New Tab strip at
`tools/build-shell.sh:255-256` using `tools/patches/newtab-strip.toml`; the suite install at
`tools/build-shell.sh:297-310`; the `ziy` launcher at `tools/build-shell.sh:326-327`.

The Open Source Project Guidelines add the naming rule we already satisfy and two we partially
satisfy: "Choose branding, logos, and trademarks that denotes your own unique identity"; "You
Must NOT … Use any Mozilla trademark in connection with the user-facing name or branding of your
project", with the concrete examples "please do **not** name your project, [Something]-fox,
Moz-[Something], or [Something]-zilla" — "Ziy" is clean
(<https://www.mozilla.org/en-US/foundation/trademarks/policy/>). And the permitted credit line:
we "may state that your project is based on Mozilla open source technology, if that is true,
**as long as you also include the statement equally prominently: '[Brand Name] and [Product
Name] are not officially associated with Mozilla or its products.'**" (same page).

### 2.3 Residual Mozilla marks in the shipped tree — the real finding

`tools/build-shell.sh` rebrands name, vendor, icons and app id, but the **engine's own version
string still reports the Mozilla mark**, and this is recorded as a known unfixable limitation:
the `--version` SKIP in `replica/deploy.md:144` — "the engine's `--version` string comes from
`libxul`, and does not remap from `App:Name` in `application.ini`". Verified live on the built
tree: `./build/ziy/firefox --version` → **`Mozilla Firefox 156.0.1`**.

Residual marks measured in `build/ziy/` (this tree, 2026-10-15):

- `updater.ini` — the only non-binary file at depth ≤2 containing "Mozilla Firefox".
- `firefox`, `firefox-bin`, `firefox.sig`, `firefox-bin.sig`, `firefox.dbg` (string inside the
  launcher ELF), `pingsender`, `updater`, `crashhelper`, `crashreporter` — executable filenames
  that are engine filenames, not ours.
- MPL §3.4 notices *inside* the binaries (`libxul.so`, `libplc4.so`, `libplds4.so`, `omni.ja`,
  `browser/omni.ja`) — these we **must keep** (Rule 5), not remove.

**Assessment:** under the modified-version regime, distributing a binary whose `--version`
still says "Mozilla Firefox 156.0.1", with a `firefox` executable and `updater.ini` naming
"Mozilla Firefox", is using a Mozilla trademark in connection with the product — the thing the
distribution policy and the Open Source Project Guidelines both prohibit absent prior written
consent. This is a **genuine, current risk**, not a theoretical one. It is cheap to fix: patch
the version banner strings (the same C++ layer as `patches/0003`/`0004`), or at minimum ship a
clear "Ziy is not affiliated with Mozilla" notice plus a `ziy`-named entry point (the `ziy`
launcher exists — `tools/build-shell.sh:326-327`). It cannot be fixed by the JS/omni.ja layer,
because the string comes from `libxul`.

### 2.4 The missing source-availability notice

`build/ziy/` contains **no license.txt and no notice file at any depth ≤3** (verified by
`find`), and the upstream tarball ships none either — all 24 members are binaries/config
(`tar -tJvf build/engine/firefox-156.0.1.tar.xz`). So MPL §3.2(a) is currently **unmet in the
shipped product**, for both the modified omni.ja and the engine binary. Rule 4 fix: add a
`LICENSES/` file (or `about` entry) at the app-dir root that (a) carries the MPL text or a link
to <https://mozilla.org/MPL/2.0/>, (b) states Ziy is not affiliated with Mozilla, and (c)
points to where the engine source and the five patches are available. Note the MPL header we
already distribute inside the binaries is Exhibit A's — "If a copy of the MPL was not
distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/" — so a pointer is
the native form of compliance here.

### 2.5 Selling is not the problem

**Moot as of 2026-10-15 — kept because it is the reason the free model carries no
licence penalty.** Mozilla's Unaltered policy forbids charging for *an unaltered copy with
Mozilla marks*; it says nothing about charging for a modified product under your own brand. The
paid path was therefore built on our own branding, and the no-charge rule did not bite — the
trademark exposure and the MPL §3.2(a) notice were the two real constraints, never the price.

The co-owner's final decision removes the price from the model entirely
(`replica/premium-position.md` §2 — free, Ko-fi donations, no tiers), which makes the point
cleaner still: **with no sale, there is no pricing question at all, and the two real
constraints are unchanged.** The trademark exposure and the MPL §3.2(a) notice are the whole
cost of shipping a modified Firefox-derived browser — and a free download inherits both in
full.

---

## 3. Clean-room posture vs Brave

### 3.1 Does using Brave's browser forbid building a competitor?

The Brave Terms of Use (<https://brave.com/terms-of-use/>, last updated 11 May 2023) grant a
"personal, non-exclusive license to install and use the executable code version of the Brave
browser" and reserve all other IP to Brave. Reading the whole document for the clauses that
could bear on our project:

- **Rules and Conduct** prohibits using the Service for unlawful purposes, infringing IP,
  abusive/threatening conduct, spam, malware, impersonation, overloading Brave's infrastructure,
  interfering with the Service, and bypassing Brave's access measures. **Nothing prohibits
  building a competing product from public information.**
- **Trademarks & Patents** — "All Brave logos, marks and designations are trademarks or
  registered trademarks of Brave … may not be used without the prior written consent" and
  "Portions, features and/or functionality of Brave's products may be protected under Brave
  patent applications or patents." This is an asset-use and patent clause, not a no-compete
  clause.
- **Indemnification** — user indemnifies Brave for the user's use/violation, i.e. it runs
  against misuse of Brave's service, not against writing other software.
- **Brave Browser License** — "You may not remove or alter any trademark, or logo … copyright
  or other proprietary notice on the Brave browser" and "This license does not grant you any
  right to use Marks of Brave or its licensors."

**Conclusion: nothing in the ToU the co-owner accepted by installing and using Brave forbids
this project.** The exposure that does exist is asset-level (Brave's marks, logos, and any
patents covering "features and/or functionality") and source-level (their MPL-2.0 code, which we
may read — for which the ToU is irrelevant because the MPL, not the ToU, governs that code;
`evidence.md` "Not evidence" section records that no JS bundle was decompiled and no `.pak`
unpacked).

### 3.2 The idea/expression ground

US Copyright Office, "What is Copyright?": copyright "protects **original works of
authorship**", and "copyright protects **expression**, and never **ideas, procedures, methods,
systems, processes, concepts, principles, or discoveries**"
(<https://www.copyright.gov/what-is-copyright/>). So the *ideas* Ziy cloned — shields with
per-site controls, a stats widget counting blocked items, a shred/clear-on-close model, a
24-word sync phrase — are not Brave's property. Brave's property is its *expression*: its code,
its labels' exact wording as a creative selection, its images, its UI as implemented.

That distinction is exactly how `evidence.md` frames the work: "Ziy's own code, labels and
design are clean-room: the `re-deep-*` documents are the documentation of record for *what*
Brave does, never a copy target for *how* Ziy does it", with the confidence classes separating
OBSERVED-SOURCE (read MPL code "for understanding only") from DOC-INFERRED (public
documentation) from INFERRED. Note the honest limitation in the same file: "No JS bundle was
decompiled or read; no `.pak` was unpacked" — good, because a decompiled bundle is *expression*.

**The residual risk is not the doctrine, it is the labels.** `re-deep-shields.md:439` records
row labels "confirmed verbatim as the *current* labels" (Trackers and ads, HTTPS upgrade, Block
scripts, …) and `re-deep-shields.md:160` records that the panel's row order is fixed in Brave's
own source. Verbatim copying of a competitor's UI strings is copying expression, and the
idea/expression line does not help there. Ziy's own strings are already re-authored per the
evidence record — but this must stay true for every string, including the ones in
`extensions/ziy-*/ui/`.

### 3.3 Risk assessment, honestly

| risk | severity | why | mitigation status |
| --- | --- | --- | --- |
| Trademark: product name/branding | **low** | "Ziy" is not confusingly similar to Brave's marks; our own UUID app id and icons | controlled — keep Brave marks/images out of the product |
| Copyright: code | **low** | Clean-room; no decompiled bundles, no `.pak` reads (`evidence.md`) | controlled — keep the rule |
| Copyright: **exact label strings / UI wording** | **medium** | `re-deep-shields.md:439,160` records verbatim label strings and a fixed row order; those are expression | **partially controlled** — must be re-authored per-string, not per-feature; re-check the UI layer |
| Patent: Brave's feature patents | **unknown, unquantifiable** | ToU says features "may be protected under Brave patent applications or patents"; we have not searched any patent | **unmitigated** — a patent search for the core features is the honest next step for a paid product |
| MPL: our engine fork | **medium** | §2.3/§2.4 above | **unmitigated today** — needs the notice and the version-string fix |
| Contract: ToU breach | **low** | §3.1 — nothing in the ToU forbids competing | controlled |

### 3.4 The three things to strengthen it

1. **Keep and publish the provenance chain we already have — and make it shippable.**
   `evidence.md`, `recon.md`, the `re-deep-*` docs and the confidence classes *are* the
   clean-room defence; they show the sequence (public docs → behavioral observation →
   documented understanding → independent implementation). Keep them current, and add a dated
   record for **every** Ziy-authored string and design element so "we wrote this" is provable
   per-element, not per-product. Store them where a buyer or a challenger can read them.
2. **Harden the string/asset boundary, since that is the live medium risk.** Zero Brave assets
   is already enforced by the repo (`.gitignore` excludes `replica/screens/*.png` +
   `behavior/`; `AI-BRIEF.md` §2.2a records zero tracked PNGs from Brave, and the three
   `brave`-named files are Ziy's own text). Extend the same discipline to **text**: every
   user-visible string in `extensions/ziy-*/ui/` and `shell/` must be Ziy-authored, and the
   `re-deep-*` docs must stay records of *what* Brave does rather than copy sources. The
   screenshots stay out of the repo (already true).
3. **Do the two things nobody has done: a patent skim and an MPL/EULA notice pass.** (a) Search
   Brave's granted/pending patents for the handful of features we ship (shields model, sync
   phrase handling, farbling) and record the result — "features and/or functionality of Brave's
   products may be protected under Brave patent applications or patents" is an explicit
   warning in their own ToU and cannot be waved away. (b) Ship the MPL §3.2(a) notice, the
   "not affiliated with Mozilla" statement, and the trademark rules in §2 — a *publicly
   distributed* product is a higher-profile target than a hobby repo, and both gaps are
   trivially closable now.

---

## 4. What makes a PAID browser app legally special — EU + global

> **Superseded in part, 2026-10-15.** The co-owner's final decision is that Ziy
> ships **FREE**, with a Ko-fi donation link and no paid tier
> (`replica/premium-position.md` §2). This section's EU consumer-law analysis
> (§4.2–§4.3, and the withdrawal/VAT items in §4.4) therefore **does not apply**
> to the shipping product, and each item is marked
> **NOT-APPLICABLE-now-sale** where it appears. **Everything else applies
> unchanged** — the DMA reading (§4.1), the MPL obligations (§1) and the
> trademark/notice findings (§2) are all about *distribution*, not about price.
> This section is kept in full because it is the reason the pivot is defensible:
> a subscription would have imported obligations the product could not honour.

### 4.1 DMA: mostly not ours

The DMA "establishes a set of clearly defined objective criteria to identify 'gatekeepers' …
Gatekeepers are large digital platforms providing so called **core platform services**, such as
for example online search engines, app stores, messenger services". Obligations attach to
designated gatekeepers, "do's" and "don'ts": allow third-party interoperability, let business
users access their data, provide ad-verification tools, let business users conclude contracts
off-platform; and "don'ts": no self-preferencing in ranking, no preventing un-installation of
pre-installed software, no tracking outside the core platform service for targeted ads without
consent (<https://digital-markets-act.ec.europa.eu/about-dma_en>).

Enforcement is real: fines up to 10% of worldwide annual turnover (20% for repeat infringements),
periodic penalties up to 5% of average daily turnover, and structural remedies as a last resort
(same page). Relevance to Ziy: **Ziy is a browser, not a designated gatekeeper, so the DMA
imposes no direct duty on us.** It matters in two indirect ways: (i) browser choice screens and
default-browser prompts exist *because* gatekeepers must enable them — that is a distribution
opportunity for us, not an obligation; (ii) if Ziy ever pre-installs anything, or is a
"core platform service" at scale, the self-preferencing and un-installation rules would start to
apply. Selling a browser does not make us a gatekeeper; selling a *platform* would.

### 4.2 Consumer-protection reality of selling digital goods

Directive 2011/83/EU (consumer rights) — the EUR-Lex summary
(<https://eur-lex.europa.eu/EN/legal-content/summary/consumer-information-right-of-withdrawal-and-other-consumer-rights.html>) —
covers "contracts concluded … at a distance (e.g. online …)" and expressly "online digital
content or digital services", so selling Ziy online to EU consumers is in scope:

- **Right of withdrawal: 14 days.** "Consumers can withdraw from distance and off-premises
  contracts within 14 days … without any explanation or cost." **If the consumer is not told
  about it, the period extends by 12 months.**
- **The digital-content exception, correctly stated.** "Exceptions also apply, under certain
  circumstances, to **contracts for the supply of digital content that is not supplied on a
  tangible medium, if the performance has begun**" — i.e. the exception is conditional, not
  automatic; and once a consumer withdraws "they must refrain from using the digital content or
  digital service and from making it available to third parties."
- **Pre-contract information duties** (clear language): identity and contact details, the
  product's main characteristics, payment terms, delivery time, performance/duration,
  termination conditions.
- **Amending Directive (EU) 2024/825** — for digital content and digital services, inform the
  consumer of the **legal guarantee of conformity**, after-sales service conditions, and "the
  **minimum period** during which the producer or the provider will provide **software
  updates**". That last one is a real product commitment for a browser: state an update period.
- **Amending Directive (EU) 2023/2673** — distance contracts must offer an "easy-to-find
  **withdrawal function**" in the interface. Applies from 19 June 2026.
- **No dark patterns / no pre-ticked boxes** for paid add-ons; complaints handling must be
  disclosed.
- **Penalties**: coordinated cross-border infringements can draw fines of at least 4% of annual
  turnover in the Member State(s) concerned, or at least €2 million where turnover is unknown.

Practical shape for Ziy: sell with an explicit, functioning 14-day withdrawal (and honour it —
"refrain from using" is not enforceable against a downloaded binary, so a refund policy is the
honest reading), disclose identity/price/terms/updates, and do not rely on the digital-content
exception without the consumer's express consent to immediate performance.

### 4.3 VAT / sales tax

EU OSS (<https://europa.eu/youreurope/business/taxation/vat/one-stop-shop/index_en.htm>):

- "You **charge VAT at the rate of the customer's country**, which is also called
  destination-based VAT."
- "You only need to submit **one OSS return quarterly or monthly** that lists all your EU sales
  and pay VAT once in the country that you're registered in", and "You will need to keep your
  records for **up to 10 years** in case of audits."
- Scheme choice depends on establishment: the **Union scheme** (EU-established; cross-border
  goods and services to consumers) vs the **Non-Union scheme** (business "established outside
  the EU, with no EU fixed establishment", covering "services supplied to EU consumers (for
  example, **digital** … services)"). Ziy shipping a download to EU consumers from a non-EU
  entity is the **Non-Union scheme** case: register once in any one EU country, quarterly
  return, charge each buyer their own country's VAT rate.
- Note the marketplace carve-out: selling through a marketplace can make the marketplace the
  VAT-collecting seller for certain goods — not our case for direct sales, but relevant if Ziy
  is ever distributed through an app store (Apple/Google take payment, as Brave's own ToU
  describes for Brave Premium).

Global obligations beyond the EU (US sales tax nexus, UK VAT, etc.) are **out of scope of the
fetched sources**; the honest position is that the EU rules above are the documented minimum
and any other market needs its own check before launch, not an assumption.

### 4.4 Distribution checklist — **updated 2026-10-15 for the co-owner's FINAL
decision: Ziy ships FREE with a Ko-fi donation link. The "paid" framing below is
superseded; the EU consumer-law items are marked, and nothing else changes.**

**Ziy is free to download and free to build. It is still a modified Mozilla
distribution, so the MPL §3.2(a) notice, the not-affiliated notice, the residual
`Mozilla Firefox` marks problem, the filter-list gaps and the Brave-patent skim
all still apply — free distribution is still distribution. The EU consumer-law
items attached to a *sale*, and there is no sale: donations are gifts on a
third-party platform, not sales of digital content, so the withdrawal and VAT
duties do not attach. Marked below rather than deleted, so the evidence stays
readable if the model ever changes.**

**Product / brand**
- [ ] Keep "Ziy" free of Mozilla and Brave marks; ship the not-affiliated statement (Mozilla
      Open Source Project Guidelines, §2.2). **APPLIES — a free build is still a distribution.**
- [ ] Fix `--version` still reporting "Mozilla Firefox 156.0.1" (§2.3) before the first public
      release. **APPLIES — unchanged by the model.**
- [ ] Give the engine a `ziy`-named entry point in every shipped artefact, not just `build/ziy/ziy`.
      **APPLIES — unchanged.**

**Licence notices (ships with the binary)**
- [ ] MPL §3.2(a) notice in the app dir: where to get engine source + the five patches (§2.4).
      **APPLIES — free distribution does not waive §3.2(a); the notice is now the primary
      obligation rather than a sale-side cost.**
- [ ] Ship `patches/` with the product, MPL-licensed, source notices intact (§1.1 Rule 5).
      **APPLIES.**
- [ ] Keep Exhibit A notices inside binaries untouched. **APPLIES.**
- [ ] Declare Ziy's own licence for the extensions/shell (they are Larger Works). **APPLIES.**

**Filter lists**
- [ ] Complete the LICENSES table for all seven lists (§6.3). **APPLIES — a download page is a
      public display surface for list names, so this is a launch blocker under the free model.**

**Patent / clean-room**
- [ ] The Brave-patent skim (§3.4 action 3, §3.3's unmitigated row). **APPLIES, and grows in
      weight: the free product is the public one, so it is the higher-profile target. Still
      UNVERIFIED — no patent search has been run.**

**EU consumer law**
- [ ] ~~14-day withdrawal, with a working withdrawal function; refund policy for a downloaded
      binary; **no reliance on the digital-content exception without express consent**.~~
      **NOT-APPLICABLE-now-sale.** Directive 2011/83/EU's withdrawal right attaches to a
      *contract for the supply of digital content for a price*, not to a gift. Ko-fi donations
      are voluntary, carry no product entitlement, and buy no digital content — there is no
      performance that has "begun" (§4.2). **If the model ever changes, this returns immediately.**
- [ ] ~~Pre-contract disclosure: identity, price, main characteristics, update period, guarantee
      of conformity, complaint route.~~ **NOT-APPLICABLE-now-sale** for the same reason — no
      price, no pre-contract information duty. Voluntary good-practice replacements that cost
      nothing and are worth keeping anyway: identity of the publisher, what the product does
      and does not ship, and where the source and the patches live.
- [ ] ~~Register VAT: Non-Union OSS if sold from outside the EU; charge the buyer's country rate;
      quarterly return; 10-year records.~~ **NOT-APPLICABLE-now-sale.** VAT attaches to a
      consideration for a supply of goods or services; an unsolicited donation is not one
      (§4.3). **If the model ever changes, this returns immediately.**
- [ ] ~~Refund/withdrawal flow tested before launch~~ (directive applies 19 June 2026 for the
      withdrawal function). **NOT-APPLICABLE-now-sale.**

**Ko-fi-specific (new, and the only consumer-law-adjacent item the free model adds)**
- [ ] **UNVERIFIED and worth a check before the page goes live:** Ko-fi's own terms as they apply
      to donation-supported software projects — what a supporter receives, whether any refund
      mechanism exists for a donation, and what the page copy may say about the product. Ko-fi's
      terms were **not fetched in this pass**; this is flagged, not asserted. The design rule
      that follows from it: the Ko-fi page must promise nothing deliverable, which is what
      `replica/premium-position.md` §2.4 records ("donations buy time, not influence").
- [ ] Whether the Ko-fi link belongs in the shipped app (an "about" surface) is a **distribution
      and trademark question, not a tax one** — no obligation attaches, and adding it is a
      product decision for the brand pass (§3.4, §6.3).

---

## 5. Engine-binary licensing, for premium-position's citation

One-line answer to "can we sell a patched Firefox binary": **the MPL lets us sell it (§1.1 Rule
1); Mozilla's distribution policy lets us modify it, but only under our own branding with prior
written permission to keep any Mozilla mark (§2.1); and we currently ship residual Mozilla marks
and no §3.2(a) notice (§2.3–§2.4).** The tarball path in `tools/lib/fetch-engine.sh` is a
legitimate *provenance* mechanism (Mozilla's own SHA512SUMS manifest, verified per line —
`fetch-engine.sh:24-28`), not a distribution licence.

**Update, 2026-10-15:** the question is now "can we **give away** a patched Firefox binary" —
the co-owner's final decision drops the paid tier entirely
(`replica/premium-position.md` §2). **The answer changes in exactly one place: §2.5's "Selling is
not the problem" becomes moot, and §1.1 Rule 4 / §2.4's source-availability notice becomes more
important, not less.** With no sale, Mozilla's "you may not charge" rule for *unaltered* copies
(§2.1) never engages at all — and the modified-regime findings (no Mozilla marks, the
not-affiliated notice, the residual `--version` marks problem) are unchanged, because they are
about modification and distribution, never about price.

---

## 6. Filter-list licence table — the single source of truth

**Ownership:** this section is Ziy's authoritative filter-list licence record. Cite it; do not
rebuild it elsewhere.

### 6.1 The table

Snapshot files: `extensions/ziy-shields/lib/filterlist/snapshots/` (7 lists). Registry:
`extensions/ziy-shields/lib/filterlist/lists.js`. Attribution file:
`extensions/ziy-shields/LICENSES`.

| list id | shipped snapshot | licence it declares | obligation created | where we satisfy it | status |
| --- | --- | --- | --- | --- | --- |
| `easylist` | `easylist.txt` | **GPL-3.0** (header line 14: `! Licence: https://easylist.to/pages/licence.html`; upstream: EasyList repository "dual licensed under the GNU General Public License version 3 … **and** Creative Commons Attribution-ShareAlike 3.0 Unported … if required, 'The EasyList authors' should be attributed as the source" — <https://easylist.to/pages/licence.html>) | Attribution ("The EasyList authors"); if treated as GPL: source availability for the list data. Note the dual licence lets us choose **either** GPLv3 or CC-BY-SA 3.0 | `LICENSES:15-30` (homepage, licence, sha256 `2e86ae8d…`, line count); registry `lists.js:113-122`; options page shows licence link (`ui/options.js:149-166`) | **satisfied (attribution)** — see §6.2(b) on the compiled ruleset |
| `easyprivacy` | `easyprivacy.txt` | **GPL-3.0 / CC-BY-SA 3.0 dual**, same as EasyList (header line 14) | same as above | `LICENSES:32-44`; `lists.js:126-133` | **satisfied (attribution)** |
| `easylist-cookie` (Fanboy's Cookie Monster) | `fanboy-cookiemonster.txt` | **CC-BY 3.0** (header line 6: `! License: http://creativecommons.org/licenses/by/3.0/`) | Attribution, share-alike is **not** in CC-BY 3.0 (BY only); credit + link | `LICENSES:46-59` (homepage, licence, source URL, sha256); `lists.js:135-146`; homepage `https://easylist.to/` | **satisfied** |
| `uabo-filters` (uBlock Origin `filters.txt`) | `uabo-filters.txt` | **GPL-3.0** (header line 6: `! License: https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE`; upstream LICENSE file is the GPLv3 text — <https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/LICENSE>) | Attribution; copyleft question for the compiled form (§6.2(b)) | **NOT in `LICENSES`** — only `lists.js:149-157` (id, licence string, licenceUrl) and the options page | **GAP** — add to LICENSES |
| `urlhaus` (AdGuard-Home variant) | `urlhaus.txt` | **CC0-1.0 + MIT, dual** (header line 5: `! License: https://gitlab.com/malware-filter/urlhaus-filter#license`; upstream README "License": "Creative Commons Zero v1.0 Universal **and** MIT License", with URLhaus itself CC0 — <https://gitlab.com/malware-filter/urlhaus-filter/-/raw/main/README.md>) | Attribution is *not* required by CC0, but the project asks for the upstream credit; MIT notice should be preserved | **NOT in `LICENSES`** — `lists.js:160-168` declares `CC0-1.0` only | **GAP** (cosmetic, low risk) — record the dual licence and keep the homepage link |
| `antiadblock-warning-removal` | `antiadblock-warning-removal.txt` | **GPL-3.0 / CC-BY-SA 3.0 dual**, EasyList repo family (header line 8: `! Licence: https://easylist.to/pages/licence.html`) | same as EasyList | **NOT in `LICENSES`** — `lists.js:171-178` only | **GAP** — add to LICENSES |
| `brave-unbreak` | `brave-unbreak.txt` | **`MPL-2.0` — asserted by us, NOT declared upstream.** Header of the shipped file carries **no** `! Licence:` line at all (verified: `grep -i 'licen' brave-unbreak.txt` → no match; the file opens `[Adblock Plus 2.0; uBlock Origin]`, `! Title: Brave Unbreak`). The repo-level licence is real: GitHub reports the `brave/adblock-lists` repository as "License: Mozilla Public License 2.0" and ships a `LICENSE` file (<https://github.com/brave/adblock-lists>) | If MPL-2.0 governs: §3.2(a) notice + source pointer; the §1.1 rules apply to this data too | `lists.js:182-190` declares `MPL-2.0` + MPL URL; **no entry in `LICENSES`** | **GAP + mislabel risk** — the licence is correct at repo level but nothing in the file or our tree lets a reader verify it; add the repo LICENSE reference to LICENSES |

Attribution currently surfaced in-product: `ui/options.js:149-166` renders each list's
`licenceUrl`/`homepage` and shows `licence || 'licence not declared'` per record — a solid
per-list UI credit for all seven, driven by `lists.js`. `LICENSES:61-78` additionally documents
the compile step (`tools/gen-static-ruleset.js` → `rules/static-ruleset.json`, "what ships in the
xpi") and the per-list URL/licence/sha-256 recording in `lib/filterlist/lists.js`.

### 6.2 The two questions you flagged

**(a) The request-parser's own provenance.** `lib/filterlist/parser.js` is Ziy-authored and its
header documents exactly that: "Ziy shields — Adblock Plus / uBlock-Origin filter-list parser …
Reads the **public** EasyList-family syntax" with the syntax inventory (network rules, `@@`
exceptions, cosmetic `##`/`#@#`/`#?#`, `$`-options, `$domain=` handling) listed as *a format
specification*, not as copied code. Note what it says about MPL: "manifest.json in this
directory is PURE JSON … the engine's JSON.parse of a manifest carrying a comment header fails
silently" — that is why provenance commentary lives in `parser.js` comments rather than a
manifest notice (`parser.js:1-20`, `parser.js:468` for header-metadata extraction). The
provenance gap is *documentary*, not behavioural: the parser has no licence/attribution note
saying which upstream syntax documents it was written against. Add a one-line provenance
pointer (the public EasyList syntax doc URL) next to the parser header; the clean-room rule in
`evidence.md` already covers "nothing copied".

**(b) Does EasyList's GPL/LGPL family status affect shipping the compiled ruleset?** — **state
the honest answer: this is unclear at our confidence level; take the safe default.**

What is clear: we ship the **verbatim list bodies** (data), which is exactly what
`LICENSES:61-78` describes, and GPLv3 §0 treats "the output from running a covered work [as]
covered … only if the output, given its content, constitutes a covered work" — a *mechanical
transform of data* is generally not a new creative work, and CC-BY-SA's own framing of the
lists as data with attribution supports the attribution-only reading.

What is not clear, and what we should not bluff: whether `rules/static-ruleset.json` (generated
from those bodies by `tools/gen-static-ruleset.js`; measured live on this tree: **28 907
top-level entries** in the file) is a **derivative work** of GPLv3/CC-BY-SA-3.0 content, which
would carry the share-alike and source-availability duties onto a file that ships inside a
narrowed-transform build. Nobody on this workstream has done that analysis, and the two
licences in the dual grant have different answers, so the choice-of-licence matters too.

**Safe default, recommended: keep attribution + source pointer for every list, and ship the
verbatim snapshot bodies alongside the compiled ruleset** (which we already do —
`LICENSES:61-78` states the snapshots ship "because they are the input to the update mechanism
and to the offline first-run"). That is the low-cost posture that is defensible under *either*
branch of the dual licence: attribution + the source data being present + a pointer to the
upstream licence is what both GPL and CC-BY-SA would want of a redistributor that is not
claiming the transform is the original. If we want certainty, the one action that resolves it is
choosing the **CC-BY-SA 3.0** branch of the EasyList dual licence for the compiled artefact and
noticing it as such — or asking the EasyList maintainers. Until then: attribution + snapshots +
pointers, and no claim in product copy that the ruleset is Ziy's own authorship.

### 6.3 Action items

1. **Add four missing entries to `extensions/ziy-shields/LICENSES`**: `uabo-filters` (GPL-3.0,
   <https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE>), `urlhaus` (CC0-1.0 + MIT dual,
   <https://gitlab.com/malware-filter/urlhaus-filter>), `antiadblock-warning-removal`
   (GPL-3.0/CC-BY-SA-3.0 dual, <https://easylist.to/pages/licence.html>), `brave-unbreak`
   (MPL-2.0 **at repository level**, <https://github.com/brave/adblock-lists>, with the note
   that the list file itself declares no licence). Same shape as the existing three entries:
   homepage, licence, licence URL, bundled-as path, sha256, line count. **Cheapest, highest-value
   fix in this document — it makes the commercial product's attribution complete.**
2. **Record the dual-licence choice explicitly** for the EasyList family in `LICENSES` (state
   which branch of "GPLv3 or CC-BY-SA 3.0" we rely on; today §6.2(b) shows this is undecided).
3. **Add the parser provenance pointer** to `lib/filterlist/parser.js` (§6.2(a)).
4. **Verify `lists.js` licence strings against the list headers on every snapshot refresh** —
   `brave-unbreak`'s MPL-2.0 claim currently rests on the GitHub repo page, not on the file we
   ship. A one-line CI check comparing each snapshot's `! Licence:` header to its registry record
   would catch the next drift (the snapshots are refreshed, per `LICENSES:66-71`).
5. **Keep the verbatim snapshots shipping with the compiled ruleset** (§6.2(b) safe default) and
   do not add product copy claiming the ruleset as Ziy authorship.

---

## 7. What we have not verified

- Brave's actual patent portfolio (no patent search performed; §3.4 action 3).
- Non-EU sales-tax obligations (US nexus, UK, etc.) — EU documented, others not.
- Whether Mozilla would grant written permission for a modified distribution that keeps any
  mark — a request to <trademark-permissions@mozilla.com> is a human step, not a research step.
- Whether the Brave Unbreak *file* carries a licence header in a different upstream revision
  than the snapshot we hold (the snapshot is dated 2026-10-15; only this revision was read).
- The exact current text of MPL FAQ answers after its "Last updated on January 30th, 2024"
  stamp was checked against the licence text itself (both read, 2026-10-15).
