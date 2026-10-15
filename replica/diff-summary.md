# diff-summary.md — the Ziy replica in five lines

1. **Parity score: 60.4%** of the deliverable set (159 rows, `skip` and `cut`
   priced out) — 48.0% against Brave's full 207-row feature set. Must-rows:
   **40 yes, 5 partial, 8 no of 53** on the deliverable set (80.2% weighted);
   40 yes, 5 partial, 17 no of 62 against Brave's full must-set (68.5%), and
   39 of 57 in the skill tool's narrower Brave-only denominator.
   Per-area: sync, NTP, new tab page and downloads at 100%; shields and core
   browsing at 64.5%; talk 51.7%; privacy 43.2%.

2. **Top gaps:** (a) the per-site shields **auto-relax prompt** — the memory
   half is proven, the prompt is unbuilt, and it is the highest-value fix in
   the review corpus; (b) **the shields count** — defect D-7 means a page whose
   trackers the static DNR tier stopped reports 0, which holds 3 must-rows at
   `partial`; (c) **crash-safe session restore and durable downloads/password
   store**; (d) the **published resource budget** (idle CPU/RSS, YouTube CPU,
   cold start); (e) **password manager and autofill**, which the engine blocks
   at the API level and needs a native helper.

3. **Deliberately absent (36 cut, 12 skip):** the AI assistant, crypto wallet
   (all 13 rows), rewards/BAT economy, VPN (all 5 cut rows), the wallet
   sidebar and its modes; uncloneable by nature — BAT settlement rails, Brave's
   ad marketplace and campaign trust model, Guardian's VPN backbone,
   Widevine, Chromium site isolation, Mojo, Skia/SwiftShader, P3A, Brave's
   account system, and desktop Playlist's Nightly-only availability.

4. **Verified live (42 of 79 yes-rows) vs not (37):** live in a browser are
   shields blocking (5 of 5 trackers stopped, per-site overrides persisted
   with the decoded IndexedDB proof), the NTP (17 in-browser checks + news
   rows rendering), sync (two-profile e2e with a server-cache wipe), talk (17
   panel checks, QR zbar-verified, honest degradation), playlist (a real mp4
   decode + play + seek, reorder and resume surviving a reload), the welcome
   tab, and the whole hardening pref set landing in a real boot. The other 37
   are proven by tests and schema reads only — chiefly the engine-inherited
   rows Ziy configures rather than builds (tabs, print, view-source, devtools,
   bookmarks bar, history, downloads, find bar, permissions, extensions
   manager, shortcuts, Safe Browsing) plus a handful of Ziy surfaces whose
   model is pinned but whose click-through was never driven.

5. **Next action: build the shields auto-relax prompt and close D-7.** They
   are one prompt plus a degraded-page detector and a one-line counting fix,
   and between them they convert three `partial` must-rows to `yes`, take
   shields to 100%, and clear the largest single block of must-gap weight —
   after which the must-set is shippable and the remaining must-rows are the
   two session/durability items that need a native helper.
