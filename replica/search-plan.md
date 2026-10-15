# Ziy search plan: three options, sized honestly

**Date:** 2026-10-14
**Question from the co-owner:** "we make our own search engine" -- should Ziy ship its own
index/search backend?
**Status:** decision document. No engine code is written here; this is scope, size,
cost and the evidence behind a recommendation.

**Existing record this doc must answer to:**

| doc | what it already says |
| --- | --- |
| `replica/recon.md` section "Out of scope" | "Brave Search's index. The index, the Google-fallback-mixing arrangement, Goggles ranking and `Answer with AI` all depend on Brave's crawlers and corpus. A clone can build the search results page/filters/settings UI against a pluggable backend (SearxNG, local index, or a third-party API) but cannot clone the index itself. **`skip` for the index, `should` for the results UI.**" |
| `replica/features.csv:67` | `Brave Search results page,search,must,desktop+android,yes,no,planned` -- note: **"Index itself is out of scope; results UI is cloneable"** |
| `replica/architecture.md` 2.3 and its "Not built" list | the only Ziy-hosted server is the blind sync store (`server/`); the hosted model fleet and other hosted services are cut by product decision; the module table has **no search module** |
| `replica/fixes.md` 1.5 and 5 | positioning is "nothing in it but browsing"; AI/Leo is cut; "no ledger, wallet, AI or ad subsystem process in the resource budget" |
| `replica/proofs-ntp.md` rows 2-3 | Ziy already owns the NTP (`chrome_url_overrides.newtab`, permission set `{storage, topSites, search}`), and the NTP search widget already resolves engines through `browser.search.get()` / `browser.search.search()` with a **Ziy-owned fallback engine list** and URL navigation |

So the product decision this document has to make is not "do we build a results page"
(that is already `must`, row 67) but **what is on the other end of it**.

---

## 1. What the primary sources say (fetched 2026-10-14)

Twelve pages, all cited with what each one told us. One request per source, human pace,
`curl` / native reader, no crawler.

| # | URL | what it told us |
| --- | --- | --- |
| 1 | https://commoncrawl.org/overview | "The corpus contains raw web page data, metadata extracts, and text extracts... **stored on AWS Public Data Sets**... **Access to the corpus hosted by Amazon is free.**" Confirms petabytes, monthly crawls (CC-MAIN-2026-39 is the newest listed), and that the *data* is free but **you run the analysis and the egress on AWS** -- free access is not free hosting. |
| 2 | https://commoncrawl.org/cdxj-index | The CDXJ index is "an index to the WARC files and URLs... **served from index.commoncrawl.org, or alternatively the index files are available... below the prefix `s3://commoncrawl/cc-index/collections/`**... **the CDXJ index is free to access or download for anybody**." A record gives you `filename`, `offset`, `length`, from which you pull the actual bytes with an HTTP range request. **Live-probed:** `curl -r 0-2000 https://data.commoncrawl.org/...warc.gz` returns HTTP 206 with no credentials; `https://index.commoncrawl.org/CC-MAIN-2025-43-index?url=...&output=json` returned HTTP 200 with a real record (and, on other tries, 504 gateway timeouts -- it is not a production dependency for a browser). |
| 3 | https://commoncrawl.org/blog/index-to-warc-files-and-urls-in-columnar-format | The columnar/URL index is Parquet, "**free to access or download for anybody**", about **300 GB per monthly crawl** for the index table, and Athena costs "$5.0 per TiB" scanned. This is the number that fixes the shape of a web-scale index: one monthly crawl's *index alone* is hundreds of GB; the WARC corpus is petabytes. |
| 4 | https://docs.searxng.org/ | SearxNG "is a free internet metasearch engine which aggregates results from up to **261 search services**. Users are neither tracked nor profiled... SearxNG can be used over Tor for online anonymity." **It has no index of its own** -- its results are other people's results. Self-hosting is the first-class install path ("If you don't trust anyone, you can set up your own"). |
| 5 | https://docs.searxng.org/own-instance.html | The privacy statement we must copy into any Ziy Option A honestly: "**If someone uses a public instance, they have to trust the administrator of that instance. This means that the user... does not know whether their requests are logged, aggregated, and sent or sold to a third party.**" And: "public instances without proper protection are more vulnerable to abuse... which may cause the external service to enforce CAPTCHAs or to ban the IP address of the instance. Thus, search requests would return less results." Also: SearxNG removes private data by "Removing private data from requests going to search services / not forwarding anything... / removing private data from requests going to the results pages" -- no cookies, a random browser profile per request -- but "The IP address used will be the IP of the instance." |
| 6 | https://docs.searxng.org/dev/search_api.html | The programmatic surface is `GET /search?q=...&format=json` (json/csv/rss only when the operator enabled it -- "**Be aware that many public instances have these formats disabled**"; unset returns 403). No API key by design, which is exactly why public instances rate-limit and break. |
| 7 | https://about.marginalia-search.com/ and /article/crawler/ | **The proof a small index is feasible, from the operator's own numbers.** "Marginalia Search is an independent open source Internet search engine operating out of Sweden... principally developed and operated by Viktor Lofgren." It is **not** a metasearch layer: it runs its own crawler ("IP Address Range 193.183.0.162-193.183.0.174 / User Agent `search.marginalia.nu` / Crawl Interval 8-10 weeks... the system also polls RSS feeds daily"). Cost: "**The project currently has bills in the ballpark of $200/month**." The crawler is polite by design, with an opt-in submission repo, a published IP range and a contact address. Note the scope it *chooses*: "Prioritizes non-commercial content... Find lost old websites", and "isn't seeking to replace Bing or Google, but to complement them." |
| 8 | https://marginalia-search.com/ and https://about.marginalia-search.com/article/api/ | The software is open source (AGPL) with its own index and crawler; there is an API (`api2.marginalia-search.com`, `API-Key` header) with a **keyless `public` key** "for development" that "often hits a rate limit" -- **live-probed:** responses carry `Access-Control-Allow-Origin: *` (so an extension can call it directly) and repeated calls returned `429 QPM Limit Exceeded`, matching the docs' own warning. Free non-commercial keys are **CC-BY-NC-SA 4.0** with an email step; commercial is a metered paid key. Custom filters (the Goggles-equivalent) are a paid-key feature. |
| 9 | https://www.mojeek.com/services/search/web-search-api/ and https://www.mojeek.com/about/terms.html | **Mojeek's API is not free.** Pricing is 2 GBP CPM (Startup, 5 qps, 100k req/day) / 3 GBP CPM (Business, 10 qps, 400k req/day) / Enterprise custom; "Free trial version, with limited queries. Get in touch." Storage rights: "You can store results on Business plan and optionally on the Enterprise plan. **For other plans, you may store the results for 1 hour to enable caching.**" Re-ranking is allowed ("you are free to re-rank results as you wish"). The HTML *website* is not an API: Terms 3.5 -- "use or access Our Services by any automated means (unless you are an authorised Mojeek API user)... **scraping the Services without Our prior consent is expressly prohibited**"; and `robots.txt` (live-fetched) has `User-agent: *` / `Disallow: /search`. **Live-probed:** `GET https://www.mojeek.com/search?q=brave+browser` returns HTTP 200 with `<title>Captcha</title>`. So "Mojeek free keyless endpoint" is **false** as a plan input -- unless we pay for the API or send the user to the HTML page as a browser navigation. |
| 10 | https://duckduckgo.com/terms and https://duckduckgo.com/acceptable-use | DDG's terms point to an Acceptable Use Policy that forbids, among others: "**Frame, inline link, or similarly display any portion of the services within another service**", "**Sell or resell any portion of the services**", "Transmit any viruses, code, spam...", "Interfere with or disrupt the integrity or performance of the services". **Live-probed:** `GET https://html.duckduckgo.com/html/?q=...` returned HTTP 202 with `anomaly` / `challenge` in the body (a bot challenge), so the "DDG html" endpoint is not a dependable programmatic source, and rendering it inside our own results page is squarely the framing the AUP prohibits. |
| 11 | https://brave.com/search/api/ | Brave's own position: the API is "**powered by Brave's independent Web index, the same index that powers Brave Search**". Non-free: "**$5 per 1,000 requests**" for Search (with "$5 in free credits every month"), "$4 per 1,000 requests + $5 per [month]..." for Answers, 50 qps. Goggles is listed as an API feature ("Custom reranking & result filtering"). The free plan requires a **credit card** "as an anti-fraud measure". Even the option that gets us *Brave's* index is a paid, keyed, per-request service -- the opposite of a hosted-services-free product. |
| 12 | https://support.brave.app/hc/en-us/articles/4403624081805-How-do-I-use-customize-Brave-Search | How Brave itself describes the S31/S32 arrangement (the source-27 row of the recon, re-verified live): results page + images/news/videos tabs + date/location filters + Safe Search; settings for display language, region, theme, safe search, **Answer with AI**, open in new tab, units, **Anonymous local results**, **Discussions**, **Google fallback mixing** ("For queries where Brave Search is not yet refined, your browser will anonymously check Google for the same query, mix the results for you and send the query data back to us"), anonymous usage metrics. **The fallback is the honest bit to copy into our plan: Brave, with a web-scale index, still ships a fallback to Google.** |

**Corpus sources for Option B, verified.** The en-Wikipedia articles multistream dump is
`https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles-multistream.xml.bz2`
-- **live-checked `Content-Length: 26,917,225,724` (about 25 GiB)**; text is "licensed
under the Creative Commons Attribution-ShareAlike 4.0 License (CC BY-SA)". The Stack
Exchange data dump on archive.org is **371 `.7z` files totalling 99,091,734,110 bytes
(about 99 GB)** (per-site files, live-checked from the item metadata); Stack Overflow's
live API reports **24.2M questions / 36.1M answers**. The Software Heritage FAQ page did
not fetch (TLS certificate failure from this host) and is therefore **not** used as a
source in this doc.

### Query-engine comparison (for Option B), verified 2026-10-14

| engine | license (verified from the repo) | shape | self-host cost | notes for us |
| --- | --- | --- | --- | --- |
| **Tantivy** | MIT (GitHub API `mit`; LICENSE header "Copyright (c) 2018 by the project authors") | a Rust **library**: "closer to Apache Lucene than to Elasticsearch... **it is not an off-the-shelf search engine server**" | your binary, your box | We would write the server. Full control, no second process, no licensing to reason about. |
| **Meilisearch** | **split**: "Part of this work fall under the Meilisearch Enterprise Edition (EE) and are licensed under the **Business Source License 1.1**... The other parts... under the **MIT license**" (`SPDX-License-Identifier: MIT AND BUSL-1.1`) | a self-contained binary + HTTP API | Cloud from **$20/month** (their estimator: XS instance $18/mo plus about $5/mo disk for 32 GiB at 0.5 vCPU / 1 GB RAM) | Convenient, but the BSL/EE split and a cloud vendor are both wrong for a no-hosted-services product. |
| **Typesense** | **GPL-3.0** (GitHub API `gpl-3.0`) | self-contained binary, HTTP API, no free cloud tier published | self-host only | GPL is fine for a browser product; less convenient to embed than Tantivy. |
| **Stract** | **AGPL-3.0** (LICENSE.md verified) | a complete open-source search engine: "Fully independent search index with our own crawler", `site:` / `intitle:` syntax, DDG-style `!bang` syntax, Wikipedia + StackOverflow sidebar, de-ranks sites with third-party trackers, "**optics** to almost endlessly customize your search results" | self-host only | Interesting as a *reference implementation* (its bang syntax and "optics" map to our recon rows 77 and 76), but AGPL plus a full second engine is the heaviest possible choice for a browser that ships no server. |
| **YaCy** | free software (yacy.net: "YaCy is free software for your own search engine", P2P / own-portal / intranet modes) | Java | self-host | Java plus an optional P2P index network -- wrong shape for us. |

**A real size/latency measurement, run on this machine (throwaway, deleted after
reading).** "What does a small index actually feel like" is answerable with a small
measurement, so it was measured rather than asserted. An FTS5 index over synthetic
documents (about 800 words, roughly 4.5 KB text each, Porter stemming + unicode61):

| corpus | index build | index bytes | single-term query |
| --- | --- | --- | --- |
| 1,000 docs | 1.06 s | **12.96 MB** (about 13 KB/doc) | 0.34 ms |
| 50,000 docs | 50.8 s | **552 MB** (about 11 KB/doc) | 10.85 ms |

Extrapolating the measured bytes/doc: **1 M docs is about 11 GB, 5 M docs about 55 GB.**
Query latency at 50k docs is already in the tens of milliseconds, so the user-visible bar
(under about 150 ms) is easy; the hard parts are **storage and egress for the crawl and
index freshness**, not query speed. (FTS5/SQLite was used only because it is the offline
measurement instrument available here; Tantivy or Meilisearch has the same order of
magnitude. This measures *scale behaviour*, it does not endorse the engine.)

---

## 2. Option A -- Metasearch proxy

### Architecture

An extension (`ziy-search`) that sits behind our results page: the query goes to a
configurable list of public search backends and the results are merged and rendered by
**us** -- one results page, our DOM, our filters. Backends are OpenSearchDescription-shaped
URLs with a parser adapter per source.

```
NTP box / address bar -- ziy-search (results page we own)
                            |-- GET https://www.mojeek.com/search?q=...          (navigation only, never scraped)
                            |-- GET https://search.marginalia.nu/...            (keyless-ish, rate limited)
                            |-- GET https://<public searxng instance>/search?q=...&format=json
                            \-- GET https://api.search.brave.com/...            (paid key, optional)
```

The default MUST be **direct-from-browser requests with no Ziy server in the path**: each
backend is called by the page's own fetch or navigation, from the user's IP, and nothing of
ours sees the query. That is the only shape consistent with "nothing in it but browsing"
and with the fixes.md positioning.

### Size and cost

| dimension | value |
| --- | --- |
| Build size | **S** (weeks). The results page is already `must`; this adds one fetch-and-merge adapter per backend plus a merge/ranking pass. |
| Ongoing compute | none of ours |
| Ongoing money | $0 if we stay on keyless endpoints. Mojeek's API is 2-3 GBP CPM if we choose to pay; the Brave Search API is $5 per 1k requests with $5/month of free credit. |
| Storage | none |
| Bandwidth | the user's |

### What the terms actually allow

- **Mojeek** -- no keyless scraping. Terms 3.5 bars automated access unless authorised, robots.txt disallows `/search`, and a live GET returned a CAPTCHA page. The compliant shapes are (a) the paid Web Search API, or (b) a browser *navigation* to `mojeek.com/search?q=...`, which is a user action, not a scrape.
- **DuckDuckGo** -- the AUP bars "Frame, inline link, or similarly display any portion of the services within another service" and selling/reselling. `html.duckduckgo.com/html` is bot-challenged live. So DDG belongs behind a **navigation** (engine list / bang-style redirect), not inside our rendered results.
- **SearxNG public instances** -- the API is keyless by design but per-instance opt-in (`format=json` frequently off), and the docs themselves warn the instance operator may log or sell requests and may be forced into CAPTCHAs by upstream abuse.
- **Marginalia** -- a keyless `public` key exists for development and rate-limits (verified live: `429 QPM Limit Exceeded`, `Access-Control-Allow-Origin: *`). Free non-commercial keys are CC-BY-NC-SA; commercial use is a metered paid key. Attribution and NC terms are product-visible constraints.
- **Brave Search API** -- allowed and explicitly supports Goggles reranking, but keyed and paid.

### Privacy posture (honest, per option)

What we can say: "Ziy adds no server of its own to the search path; your query leaves your
machine only to the engine you picked." What we cannot say: "your queries are private" or
"nobody logs them" -- a public SearxNG operator may log, a keyed API provider logs by
contract, and every backend sees the user's IP.

### Risks

1. Instance trust -- the user must know which operator they are trusting. Mitigation: the engine list is user-editable, self-host is a documented first-class path, and the UI names the backend per result group.
2. Breakage is a third party's decision. CAPTCHA, ban or API changes (all three live-observed here) break results for everyone at once.
3. Terms churn -- the DDG framing position and the Mojeek scraping position are policy, not code, and can change under us.
4. Result quality is not ours to improve; no amount of our code fixes an upstream miss.

### First validation step

Two-day spike, no product code: (1) build one results page that merges Marginalia, one
public SearxNG instance and Mojeek-by-navigation, using each engine's real terms; (2) run
20 real queries through it and record latency, failure rate, CAPTCHA rate and which group
answered; (3) confirm in-gecko that a page fetch to `api2.marginalia-search.com` renders
(CORS was verified live as `Access-Control-Allow-Origin: *`; SearxNG instances vary per
operator).

---

## 3. Option B -- Own small index

### Architecture

```
crawler --> raw store (HTML/text) --> extractor/normaliser --> query engine --> same results page
   ^                                                                              ^
robots.txt + politeness                                          Tier 1 (local, no network) / Tier 2 (public backends)
```

Scoped to a corpus we can actually hold and licence: (a) **en-Wikipedia** multistream dump,
about 25 GiB compressed, CC-BY-SA; (b) **Stack Exchange** data dump, about 99 GB across
371 `.7z` files, CC-BY-SA; (c) a curated crawl of docs / encyclopedic / tech sites with a
Marginalia-style polite crawler (8-10 week refresh interval, an opt-in submission path, a
published IP range, a contact address). The query engine is a library (Tantivy, MIT) or a
sidecar (Meilisearch MIT+BSL, Typesense GPL-3.0, or Stract AGPL-3.0 as a reference).

Where it lives is the first decision, and it has to be made honestly:

- **Bundled with the browser** -- honest size, verified above: about 11 KB/doc, so a
  *useful* v1 corpus of 200k-1M docs is roughly 2-11 GB of shipped payload. That is a
  download-size decision for a browser, not a feature flag.
- **Ziy-hosted** -- a server, an index, a crawl schedule and a bandwidth bill. This is the
  shape the product decision removes, so it is out unless the co-owner reverses that.
- **User-self-hosted** -- a documented `ziy-searchd` the user runs locally (or on a box
  they control) with localhost as the default endpoint. Keeps the no-hosted-services
  promise and still gives a real index; the cost is that it is a power-user path.

### Size and cost

| dimension | value |
| --- | --- |
| Build size | **L to XL**, an honest **quarter** of focused work -- and Marginalia's existence proves one person can hold the small end of it (their bills are "in the ballpark of $200/month" for the whole engine). |
| Corpus acquisition | Wikipedia: download 25 GiB once, re-download on the dump cadence. Stack Exchange: 99 GB once, then quarterly deltas. |
| Storage | measured: about 11 KB/doc, so 1 M docs is about 11 GB and 5 M docs about 55 GB (see the section 1 measurement) |
| Crawl bandwidth | a 1M-page politeness-limited crawl at, say, 1 page/s is about 1 M requests/month, order of magnitude -- tens of GB of egress per month on a hosted box, and it is *our* bandwidth. |
| Serving cost | local: $0. Hosted by us: a small VPS (order of $10-40/mo for the box, plus egress) -- **exactly the cost category the product decision forbids** |
| Freshness | Wikipedia dumps: monthly. Stack Exchange: quarterly. A polite crawl: 8-10 weeks per Marginalia's own interval. |

### Honest coverage limits

This is **not** the web. It is encyclopedic plus docs plus Q&A plus a curated slice. It
answers "what is X", "how do I Y", "what did people say about Z" and misses fresh news,
most commercial product and pricing information, every non-curated long tail, and anything
non-English outside the Wikipedia dump. That is a *feature* if we say so plainly and a
*bug* if we let the NTP imply otherwise.

### Privacy posture (honest)

The strongest of the three **if** the index and the search run on the user's machine: no
query ever leaves the browser, no IP is exposed to any search backend for local hits, and
we can say something no other option can -- "we index nobody and log nothing, and the index
is yours". But it holds only if the query path is local by default. If the index is
Ziy-hosted, the honest statement inverts to "your queries go to our server", which is the
thing we promised not to do.

### Risks

1. Download size and disk (11 GB per M docs) -- the measured number is the argument that kills the "bundle everything" instinct early.
2. Freshness and refresh are a permanent operational cost, not a finish line.
3. Index quality is our problem forever: extraction bugs, duplicates, spam, robots.txt compliance, takedown requests. Marginalia's crawler page exists precisely because running a crawler means handling complaints.
4. Licensing: Wikipedia and Stack Exchange text is CC-BY-SA (attribution and share-alike on derivative indexes -- needs a written-down compliance path), Marginalia's own API data is CC-BY-NC-SA, and scraping arbitrary sites is a per-site permission question.
5. Relevance work is open-ended; a "better ranking" project has no end.

### First validation step

Two-day spike: (1) fetch a **1,000-document** slice (Wikipedia articles plus top Stack
Exchange Q&A) into Tantivy and measure exactly what a small index feels like -- the numbers
above are that measurement; (2) index the full en-Wikipedia *index file* (title plus first
paragraph) as a cheap middle ground and measure query latency and bytes; (3) answer the one
product question: "what percentage of 30 real Ziy-maintainer queries does a 200k-doc
encyclopedic corpus answer acceptably?" If the answer is under about 40%, Option B is not
a product, it is a research project.

---

## 4. Option C -- Hybrid, local-first aggregator

### Architecture

Ziy's own results page is a thin aggregator with **"your stuff" first**, then a
configurable mix of public backends, plus optional self-hosted SearxNG / Marginalia
endpoints the user can set. No Ziy-hosted servers, no index of our own.

Your stuff, all on-device, all free, all already ours: open tabs, bookmarks, history
(including the `Semantic search history` row 185 idea -- a local index over history, which
`features.csv` already scopes as `could` and notes "the index cost is materially higher on
mobile"), NTP top sites, downloads.

```
NTP box / address bar -- ziy-search results page
                            |-- Tier 0  Your stuff   (open tabs, bookmarks, history, top sites -- pure local, no network)
                            |-- Tier 1  Public backends the user enabled (Marginalia, public SearxNG, Mojeek/DDG by navigation)
                            \-- Tier 2  Optional self-hosted endpoint the user configures (their own SearxNG, their own Marginalia API key, their own Brave key)
```

Everything the user types that matches their own data is answered without a single packet
leaving the machine -- and that is the honest heart of the feature.

### Size and cost

| dimension | value |
| --- | --- |
| Build size | **M**. Tier 0 is the new engineering (a local query over history/bookmarks/tabs, ranked above web results, reusing `browser.history`, `browser.bookmarks`, `browser.tabs` and the IndexedDB pattern already established in `architecture.md` 2.4). Tier 1/2 is Option A's adapter work, smaller because the engine list is user-editable rather than curated. |
| Ongoing compute | none of ours |
| Ongoing money | $0 by default; optional user-paid keys are the user's money, not ours |
| Storage | a per-profile history/bookmark index, on-device, bounded by the user's own data |
| Bandwidth | the user's |

### What it means for each recon feature

| recon row | feature | Option A | Option B | Option C |
| --- | --- | --- | --- | --- |
| 67 | results page | build (shared) | build | build |
| 68 | vertical tabs (images/news/videos) | partial -- only as many as backends offer; images and news usually need a keyed API | build (we index what we crawl) | partial, same as A |
| 69 | date/location filters | thin -- only if the backend supports it | real for our corpus | thin |
| 70 | Safe Search | the backend's `safesearch` param (SearxNG `safesearch=0..2`, Marginalia `nsfw`, Mojeek API) | our filter over our corpus | the backend's param |
| 72 | Anonymous local results | **not reproducible honestly** -- it is Brave's "use your IP but do not store it" arrangement with *their* stack; a third-party API logs by contract, a public SearxNG operator may log | **yes, trivially and better** -- local index, no IP involved | yes for Tier 0 and for user-configured Tier 2 |
| 73 | Google fallback mixing | no -- that is Brave's arrangement, and a Ziy proxy pretending to be Google's client is exactly the DDG-AUP framing problem | not applicable | no; fallback is user-chosen backends, not a hidden Google call |
| 74 | Answer with AI | **cut** (row 74 is `could`, Leo already cut) | **cut** | **cut** |
| 75 | Discussions cluster | partial -- a SearxNG category might exist | buildable over the Stack Exchange dump (that corpus *is* discussions) | partial |
| 76 | Goggles custom ranking | possible as our own re-rank layer over merged results (the Mojeek API explicitly permits re-ranking; Marginalia filters are a paid-key feature) | possible over our corpus (Stract's "optics" is the reference) | **best fit** -- re-rank rules applied over Tier 0 + Tier 1, user-authored, on-device |
| 77 | !bangs | **best fit** -- pure client-side redirect to a URL template (Stract and SearxNG both implement DDG-style bangs); no backend needed | same | same |
| S32 settings panel | language/region/theme/units/safe search | theme, safesearch and the engine list are ours; language/region pass through to the backend | all ours | all ours |

### Privacy posture (honest)

Two clean statements, no hedging: (1) "Your own tabs, bookmarks and history are searched on
your machine; nothing about them leaves the profile." (2) "Any web search is performed by
the engine you selected, from your IP, with no Ziy server in between -- here is the engine
list, and you can point it at an instance you run yourself." We can also honestly say what
we do *not* have: no index of the web, no log of queries, no account.

### Risks

1. Tier 1 is still third parties (A's risk list applies) -- but the blast radius is smaller, because Tier 0 always answers and the engines are user-swappable.
2. Local history search has a privacy-ergonomics hazard the corpus already warned about: searching local history in a private window must not leak it into suggestions or the UI. This is the honest cost of Tier 0.
3. Result quality is still not ours, and a "your stuff" ranking that surfaces the wrong bookmark is a new complaint class ("why is my search showing my own junk").

### First validation step

Two-day spike: implement Tier 0 only (open tabs plus bookmarks plus history against 30 real
queries) behind the NTP search box, and measure what fraction of a normal day's queries are
already answered locally. That is the cheapest possible test of the *whole* recommendation,
because if Tier 0 alone answers a meaningful share, we have a feature; if it answers
nothing, we have a results page and should say so.

---

## 5. Option table

| | A -- Metasearch proxy | B -- Own small index | C -- Hybrid, local-first |
| --- | --- | --- | --- |
| Ziy-hosted server | none by default; possible if we proxy | **yes, or bundle about 11 GB per M docs** | none |
| Index of the web | none (uses others') | a curated slice (1 M docs is about 11 GB) | none |
| Size | **S** (weeks) | **L-XL** (a quarter or more) | **M** |
| Ongoing cost | $0 default; 2-3 GBP CPM or $5/1k if we pay for keys | $0 local; about $10-40/mo plus egress plus 99 GB/yr of fresh dumps if hosted | $0 |
| Honest privacy claim | "no Ziy server in the path" | "if local: no query leaves the machine" | "your stuff never leaves; web search is the engine you chose, from your IP" |
| Honest *false* claim we must NOT make | "private" | "it is a search engine" (it is an encyclopedic/Q&A index) | "private web results" |
| Coverage | whatever upstream gives | curated slice only | local plus whatever upstream gives |
| Answers rows 67-77 | partial | most, for our slice | partial, plus 76 and 77 best |
| Local / right-to-repair story | none | strong, expensive | **strong, cheap** |
| Failure mode | upstream breaks for everyone | we get stale or wrong forever | Tier 1 breaks, Tier 0 still answers |

---

## 6. Recommendation: Option C

**Recommended. Option A is the fallback position if the co-owner wants a results page with
no local search at all; Option B is not recommended in this product, full stop, but it
stays a documented `skip` row rather than a lie.**

The reasoning, tied to the four constraints:

**(a) Product positioning -- "nothing in it but browsing", no hosted services of ours.**
`architecture.md` 2.3 lists exactly one Ziy server (the blind sync store) and its "Not
built" list removes hosted services by decision. Option B, shipped honestly, is either a
hosted service (forbidden) or an 11 GB/M-doc payload we do not need. Option A's default
posture (no server of ours) is the only thing B and C share -- and C keeps it while adding
the one index we can honestly own: the user's own.

**(b) The cut list -- no AI answers.** Option C makes that cut cheap. There is no "Answer
with AI" (row 74), and more importantly there is no temptation to add one: the honest answer
to "what did I read last week about X" is a local hit, not a model. The corpus backs this:
the loudest search-adjacent complaints about Brave are about AI text appearing in search
results -- "Procedurally generated text will appear every time you search something, and it
clogs up the top of the search page" (appstore 3*) -- and Ziy has already cut that. Options
A and B would each need a separate reason not to grow an answer engine.

**(c) We cannot clone Brave's web-scale index.** `recon.md` says it in plain words (`skip`
for the index), and the primary sources put the scale beyond argument: one monthly Common
Crawl index table is about 300 GB of Parquet and the corpus is petabytes (source 3);
Marginalia -- a *deliberately* small, non-commercial-preferring engine with its own crawler
-- runs on "$200/month" bills and an 8-10 week refresh interval (source 7). Building a
web-scale index is not a quarter of work; Marginalia proves the *small* end is reachable by
one person, which is exactly why "own small index" is a research project and not a browser
feature. Brave itself, with a real index, still ships Google fallback mixing (source 12) --
that is the industry admitting the answer is never "one index".

**(d) What the user-feedback corpus says about search.** The counts are in section 7, and
the shape is unambiguous: users do not complain that Brave's index is too small. They
complain about (1) AI text clogging results, (2) search *reliability* (slow or non-loading
results, CAPTCHAs), and (3) the search product being a corporate thing at all -- including
the one direct "search engines and browsers should be separate entities" comment. An index
of our own answers none of those. A local-first aggregator answers (1) and partly (3), and
does not make (2) worse.

### Why C over A specifically

A and C have the same web half. C adds Tier 0 (local first) for the price of one
extension's worth of work, and Tier 0 is the only part of any option where Ziy can make a
privacy claim that is *stronger* than Brave's. It is also the only option whose failure mode
degrades gracefully: when a public instance CAPTCHAs (live-observed twice during this
research), the local tier still answers and the user still gets a results page.

### Why not B (stated so it is not re-litigated every quarter)

B is a real, honest, quarter-scale program with a real result -- and it is the wrong product
for this one. The decisive numbers are the measured ones: about 11 KB/doc of index bytes,
so 11 GB per million documents; a 99 GB Stack Exchange dump and a 25 GiB Wikipedia dump to
hold; a permanent refresh cadence (Marginalia 8-10 weeks, Wikipedia monthly, Stack Exchange
quarterly); and coverage that is encyclopedic/Q&A only. Against the positioning "nothing in
it but browsing", that is a second product. **B stays recorded as `skip` in `features.csv`,
on the same footing as Brave's own index -- with this document as the reason.**

---

## 7. Reviews.csv evidence (real quotes, no fabrication)

Counts are over `replica/reviews.csv`, **1,122 rows** (appstore 50, hackernews 309, reddit
164, brave-community 599), 2017-12-20 to 2026-10-14. Every quote below is a verbatim
substring of the row linked beside it.

| # | metric | count | what it means |
| --- | --- | --- | --- |
| 1 | rows mentioning "search" in any sense | **89** across all 4 sources (hackernews 34, brave-community 20, appstore 19, reddit 16) | search is *not* a hot complaint theme in Brave's corpus -- for comparison the fixes.md themes are 212 (ads/economy), 273 (performance), 177 (bugs), 82 (leaving). Search is roughly an order of magnitude below the themes that actually drive switching. |
| 2 | rows naming the Brave Search product (`Brave Search` or `search.brave.com`) | **20** | of which the ones that are actual product complaints rather than mentions are about 6 |
| 3 | rows where the complaint is about the search results page or search itself | **8** | AI slop 2, slow/failed search 3, captcha 2, goggles churn 1 |
| 4 | rows mentioning search plus AI/Leo together | **20** | the dominant search-adjacent complaint is AI, which Ziy has already cut |
| 5 | rows mentioning a metasearch or alternative engine (DDG, Startpage, Kagi, SearxNG, Mojeek, Marginalia) | **18** | users already treat engine choice as a *setting*, which is Option C's whole model |
| 6 | rows mentioning Goggles | **1** | Goggles interest is thin in the corpus; it is a `could` row and stays cheap or absent |
| 7 | rows mentioning `!bangs` | **0** | no user evidence for bangs as a *requested* feature (recon row 77 is Brave-doc-derived, not user-derived) |
| 8 | CAPTCHA rows | 3 (2 in the search context) | reliability, and it is a third-party-control failure, not an index-quality failure |
| 9 | "Google fallback" rows | 1 (and it is about Kagi, not Brave) | no user demand for a fallback-mixing engine |

The top search-related complaints, verbatim:

1. **AI text clogging the search page** -- "Procedurally generated text will appear every time you search something, and it clogs up the top of the search page, so if you don't want to read it, you need to scroll past it, and it tends to be long." (appstore, 3*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=11628981142
   -- Ziy: cut by design (row 74 `Answer with AI`, fixes.md 1.5).
2. **AI answers degrading into noise** -- "Answers are garbage slop, not properly researched, sometimes hallucinations, sometimes twisted info" (reddit, 2026-10-12) https://www.reddit.com/r/brave_browser/comments/1x3vk06/did_the_ai_just_suddenly_get_much_worse/
   -- Ziy: no answer engine to degrade.
3. **Search reliability** -- "I love Brave and have no complaints other than the slow or non-loading search results... When my search result fails to load in 6 - 8 seconds I close the tab and try again and it often comes right up." (reddit, 2026-07-14) https://www.reddit.com/r/brave_browser/comments/1uwba1c/seeking_info_about_the_slow_search_issue/
   -- Tier 0 (local) answers are not subject to this failure mode at all.
4. **First-search latency** -- "When I open brave the first search is always much slower than the others" (brave-community, 2022-11-01) https://community.brave.com/t/the-first-search-on-brave-is-too-slow/442050
   -- Ziy: local-first results render with no network at all.
5. **CAPTCHA from a VPN** -- "Brave Search now requiring Captcha to search from VPN." (reddit, 2021-11-19) https://www.reddit.com/r/brave_browser/comments/qxir6x/brave_search_now_requiring_captcha_to_search_from/
   -- exactly the Option A risk, live-confirmed during this research (Mojeek and DDG both CAPTCHA'd our probes; Marginalia rate-limited).
6. **Goggles churn** -- "I've recently switched away from Brave Search since the goggles subscriptions (the reason I've switched to Brave) have a big bar right at the top and the whole top settings+goggles shifts search results on load!" (hackernews, 2023-08-03) https://news.ycombinator.com/item?id=36990640
   -- if row 76 ships at all, it must not shift layout under the user.
7. **Browser and engine should be separate** -- "Browser and search engines should be separate entities, but for some reason search engines really want their own browser, and in the case of Brave, a browser company really wants a search engine." (hackernews, 2026-10-03) https://news.ycombinator.com/item?id=49946605
   -- the single most load-bearing quote for the recommendation: even Brave's users argue against a browser company owning a search engine, which is exactly the "we make our own search engine" question.
8. **Users already shop engines** -- "I use duckduckgo and don't see a need to switch to Brave search." (hackernews, 2021-10-20) https://news.ycombinator.com/item?id=28928082
   and "There aren't many search engines nowadays. Anyone that does not use Google will probably end up on Bing. DuckDuckGo and Yahoo are still repackaging Bing results last I checked, and alternatives like Brave Search or Kagi are still very niche." (hackernews, 2023-10-19) https://news.ycombinator.com/item?id=37948133
   -- the engine list is a normal setting; users are already doing Option C by hand.
9. **Search ergonomics is a real, cheap theme** -- "the placement of the X to clear the text is in a terrible position... there are times that I just switch to the Firefox Focus browser instead." (appstore, 4*) https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175?see-all=reviews&id=13351562548
   -- already a fix-plan item (fixes.md 2.2); it is about the search *box*, not the index.

**Reading of the corpus:** the searches users complain about are the *page* (AI in it,
layout churn, slow loads) and the *box* (ergonomics), never the *index*. There is no
"Brave's index missed X" complaint in 1,122 rows. Building an index would be solving a
problem the users did not report.

---

## 8. Minimum viable search (what ships in v1)

**Definition:** the smallest version of Option C that makes the NTP search box honest.

Ships in v1 -- all client-side, no Ziy server, no index of the web:

1. **A results page we own** (recon row 67, already `must`): query box, result list with title/URL/snippet/per-engine attribution, pagination, and empty/error states that name the engine that failed rather than showing a blank page.
2. **Tier 0 "Your stuff", ranked first**: open tabs, bookmarks and history matches, in a visually distinct group above web results. Local only; no packet leaves the profile. In private windows, Tier 0 is suppressed entirely.
3. **A user-editable engine list** with at least three defaults: one general engine (Mojeek by *navigation*, i.e. the engine-list mechanism Gecko already has through `browser.search`), one independent small engine (Marginalia, with its key and attribution terms documented), and one optional user-configured self-hosted endpoint (SearxNG JSON, or the user's own Marginalia API key). Show the engine's name next to its results -- that is the honest "here is who saw your query" surface.
4. **`!bangs`** (recon row 77): client-side redirect to a URL template, a static table, no backend. Stract and SearxNG both ship exactly this; it is the cheapest row in the search block.
5. **Safe Search** (row 70) as a three-state setting passed through to the engine's own parameter, plus applied to Tier 0's own history results.
6. **Settings page** (S32): engine list + order + enable toggles, safe search, theme, and an explicit statement of the honest limit -- "Ziy has no search index of its own; results come from the engines you choose." No "Answer with AI" row.

Explicitly **not** in v1: the Goggles-equivalent re-ranking (row 76 -- one corpus mention, and v1's job is not to be churn), image/news/video vertical tabs (row 68 -- needs a keyed API per vertical and per-engine support), date/location filters (row 69), the Discussions cluster (row 75), Anonymous local results (row 72 -- impossible to claim honestly over third parties), and every part of Option B.

**Later, if and only if v1's numbers justify it:** the two-day Tier-0 measurement is the
gate. If local hits answer a meaningful share of real queries, extend Tier 0 (a real local
full-text index over history -- row 185's `Semantic search history`, which already has a
`could` row and a documented cost note). If users ask for re-ranking, ship row 76 as a
user-authored on-device rule set. Option B is **never** a v2; it is a separate product
decision for a separate team.

---

## 9. What this doc changes in the repo

| file | change |
| --- | --- |
| `replica/features.csv` | no status changes are proposed here (row 67 stays `must`, rows 68-77 stay as they are). Row 76 and row 77 get a one-line note that bangs are v1-cheap and Goggles is v1-out per this doc -- **do that as a separate edit when the plan is accepted**, so the CSV stays the record of decisions rather than this doc. |
| `replica/architecture.md` 2.3 | add a `ziy-search` module row (results page + Tier 0 + engine list, size **M**) at the same time the plan is accepted. Not done here -- this is a scoping document, not the architecture edit. |
| `replica/recon.md` | unchanged: the `skip` row for the index stays, and section 1 of this doc is the reason *why* it stays. |

## 10. Verification notes (what was actually run)

- 12 fetches of primary sources (URLs cited in section 1), one request each, plus live probes: the Common Crawl WARC range request (HTTP 206, no credentials), the Common Crawl index API (HTTP 200 with a real record; also probed two 504s), Mojeek `/search` (HTTP 200, CAPTCHA page), the DDG html endpoint (HTTP 202, anomaly/challenge), Mojeek robots.txt (`Disallow: /search`), Marginalia api2 (`Access-Control-Allow-Origin: *`, then `429 QPM Limit Exceeded`), the Wikipedia dump `Content-Length` (26,917,225,724), the Stack Exchange item metadata (371 `.7z` files, 99,091,734,110 bytes) and the Stack Overflow API `/info`.
- License checks read from the repos' own LICENSE files or the GitHub API: Tantivy MIT, Meilisearch MIT+BSL-1.1, Typesense GPL-3.0, Stract AGPL-3.0, SearxNG AGPL-3.0.
- The size/latency measurement in section 1 was run and then **deleted**; it was a throwaway PoC in `/tmp`, not part of the repo.
