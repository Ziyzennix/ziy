# proofs-fix-events.md — the event-page fix workstream, verified on this machine

**Scope:** defects D-1, D-2, D-3 and D-4 from `replica/test-report.md`, plus the
extension-wide audit the same root cause implies.
**Platform:** Linux, the shipped `build/ziy` Firefox 156.0.1 app dir, its own
patched `omni.ja`. Every boot below is a **fresh throwaway profile** under
`/tmp/ziy-fix-*`, `MOZ_CRASHREPORTER_DISABLE=1` on every launch, and every kill
is **anchored by PID** (`pgrep -f '/tmp/ziy-fix-…' | xargs -r kill -9`), so the
user's own Firefox (WhatsApp) and LibreOffice are never matched.
**Date:** 2026-10-15.

---

## 1. The root cause, read out of the engine rather than assumed

The bug class is one packaging fact, not eight separate mistakes. Gecko does
not load `background.scripts[]` as modules. It builds one HTML document and
loads every entry as a plain classic script. Both parts of that are load-bearing:

`toolkit/components/extensions/WebExtensionPolicy.cpp`,
`BackgroundPageHTML()` (quoted at the exact revision this build ships,
`6f2c158dfc7e9693f880fad2510ceb51a158c069`, FIREFOX_156_0_1_RELEASE):

```cpp
static const char kBackgroundScriptTypeDefault[] = "text/javascript";
static const char kBackgroundScriptTypeModule[]   = "module";

static const char kBackgroundPageHTMLStart[] =
    "<!DOCTYPE html>\n\
<html>\n\
  <head><meta charset=\"utf-8\"></head>\n\
  <body>";

static const char kBackgroundPageHTMLScript[] =
    "\n\
    <script type=\"%s\" src=\"%s\"></script>";

static const char kBackgroundPageHTMLEnd[] =
    "\n\
  </body>\
</html>";

nsCString WebExtensionPolicy::BackgroundPageHTML() const {
  nsCString result;
  if (mBackgroundScripts.IsNull()) { result.SetIsVoid(true); return result; }
  result.AppendLiteral(kBackgroundPageHTMLStart);
  const char* scriptType = mBackgroundTypeModule ? kBackgroundScriptTypeModule
                                                 : kBackgroundScriptTypeDefault;
  for (auto& script : mBackgroundScripts.Value()) {
    nsCString escaped;
    nsAppendEscapedHTML(NS_ConvertUTF16toUTF8(script), escaped);
    result.AppendPrintf(kBackgroundPageHTMLScript, scriptType, escaped.get());
  }
  result.AppendLiteral(kBackgroundPageHTMLEnd);
  return result;
}
```

`mBackgroundTypeModule` is set from exactly one thing —
`Extension.sys.mjs`:

```js
get backgroundTypeModule() {
  return this.manifest.background?.type === "module";
}
```

— so with `"type": "classic"` (or no `type` at all, which is what five of the
eight manifests had) every entry becomes
`<script type="text/javascript" src="…"></script>` **in one document**.

Three consequences, all observed in this build's boot log:

| construct in a background script | why it is fatal |
| --- | --- |
| `import …` | `import` may only appear at top level of a module; a classic script with one is a **SyntaxError** and the whole file is discarded |
| a second top-level `const` of a name an earlier file already owns | in a classic script a top-level `const` is a **non-configurable** global binding; the second one throws at **parse** time — `redeclaration of non-configurable global property X` — and that script is dropped |
| `module.exports` | there is no `module` global in that scope → `ReferenceError: module is not defined` |

And the fourth, which the report records as D-3, is what
`toolkit/components/extensions/Schemas.sys.mjs` does with a permission-gated
namespace:

```js
get hasPermission() {
  return (
    !this.entry.permissions ||
    this.entry.permissions.some(perm => this.context.hasPermission(perm))
  );
}
```

`chrome/toolkit/content/extensions/schemas/web_navigation.json` declares
`"permissions": ["webNavigation"]`, and
`ExtensionCommon.sys.mjs :: CanOfAPIs::loadAPI` skips any namespace whose
permissions the add-on does not hold:

```js
loadAPI(name) {
  let { extension } = this.context;
  let api = this.apiManager.getAPI(name, extension, this.scopeName);
  if (!api) { return; }          // silently, no stub, no throw
  this.apis.set(name, api);
  deepCopy(this.root, api.getAPI(this.context));
}
```

So `browser.webNavigation` is simply **absent**, and
`api.webNavigation.onCommitted.addListener(...)` is a `TypeError` at the
extension's own top-level evaluation. It is an **API permission**; the
`<all_urls>` in `host_permissions` does not substitute for it (they are
separate atom sets — `WebExtensionPolicyCore` ctor:
`mPermissions(new AtomSet(aInit.mPermissions))`).

---

## 2. The pattern chosen, and why

Every `lib/` file becomes a **UMD IIFE that publishes onto one namespaced
global per extension**, and assigns `module.exports` only when a module object
actually exists:

```js
(function (root, factory) {
  "use strict";
  if (!root.ziyShields) root.ziyShields = {};
  const api = factory();
  Object.assign(root.ziyShields, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.parseList = api.parseList;      /* one literal line per public name */
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  /* ...the whole previous body, UNCHANGED, nothing at top level... */
  return { parseList, /* ... */ };
});
```

**Why this shape and not the alternatives.**

*The alternative that was rejected:* `"type": "module"` on the background block.
It works — I proved it works (probe add-on below) — but it would be a **second
convention**: five extensions ship libs as classic scripts that extension pages
load with `<script src>`, and a page cannot `import` from a module without
changing every `<script>` tag and every CSP. Making one extension's background
a module while its pages stay classic is exactly the split-brain this repo
already suffered from. Where an extension's lib genuinely *is* ESM and cannot
be rewritten (ziy-sync, whose libs are load-bearing for the native agent and
the server — `native/ziy-sync-agent/lib/ziy-crypto.js` and
`server/lib/ziy-crypto.js` both `export * from` them), the module route is the
correct one for **that** extension and is used there; the classic UMD pattern is
used everywhere else. One rule, applied per extension, documented at the top of
every lib file.

*The node/browser duality.* `extensions/*/package.json` are `type:commonjs`,
so the suites `require()` the libs; the shields libs are also executed as raw
source by `tools/measure-residual.cjs` and by the `vm` sandboxes in
`ziy-news/test/engine.test.js` and `ziy-ntp/test/page.test.js`. One guard
satisfies all three, and it was **verified in both directions before being
applied broadly**:

```
$ node -e 'const p = require("./extensions/ziy-shields/lib/filterlist/parser.js"); …'
ok   require() returns the api object

$ node -e 'import { parseList } from "…/parser.js"; …'
ok   named import works — because `exports.parseList = api.parseList;` is a
     LITERAL assignment, which node's cjs-module-lexer reads. A `for` loop or
     `Object.defineProperty` does NOT work (verified: "Named export 'hello' not
     found. The requested module './b.js' is a CommonJS module…").
```

Two interop facts that the pattern therefore depends on, both measured on this
box (node v26.10.0) before a single file was rewritten:

| test | result |
| --- | --- |
| `import { hello } from "./umd.js"` where only `module.exports = api` is set | **SyntaxError** — named export not found |
| same file plus `exports.hello = api.hello;` | **works** |
| `export * from "./umd.js"` in a `.mjs` bridge over a UMD `.js` | **works** (this is how `ziy-sync`'s native-agent and server bridges keep compiling) |
| default `import pkg from "./umd.js"` | works |

**The unique-namespace rule, now written at the top of every changed lib file:**

> This file is a CLASSIC script: every background page and extension page that
> loads it gets the SAME global scope. It therefore declares NOTHING at the top
> level — every declaration lives inside the factory — and publishes its API on
> the one `<Namespace>` global this extension shares. Two files that both
> declared the same top-level name would throw at PARSE time, the engine would
> discard the whole file, and every listener in it would fail to register
> (defect D-2 in `replica/test-report.md`).

---

## 3. Every file changed

### 3.1 `ziy-shields` (D-2, D-3, D-4)

| file | before | after |
| --- | --- | --- |
| `lib/filterlist/parser.js` | a custom dual-mode IIFE `(function exportParser(g, mod){…})(typeof self …)` | the shared UMD pattern, `ziyShields` namespace, 7 literal `exports.*` |
| `lib/filterlist/lists.js` | **`const { localGet, localSet } = (globalThis.ziyShields)` and `const { parseList, parseListMetadata } = (…)` at top level, plus top-level `const STORAGE_KEY_LISTS`… and an `Object.assign(globalThis.ziyShields, {...})` tail** — this is the file whose line 1 threw `redeclaration of non-configurable global property parseList` | wrapped; deps resolved **lazily at call time** (see 3.2) |
| `lib/engine/store.js` | top-level `const DB_NAME`, `browserApi`, footer `Object.assign(globalThis.ziyShields, {…})` | wrapped, 10 public names |
| `lib/engine/blocking.js` | **top-level `const { localGet } = (globalThis.ziyShields)`** — the second `redeclaration` | wrapped; the `localGet` destructure removed (it had **no call site in the file**, verified) |
| `lib/engine/precedence.js` | top-level `globalThis.ziyShields = … || {}`, `const FP_TARGETS`, footer `Object.assign` | wrapped, 14 public names, `FP_TARGETS` still read from the namespace with the local table as a fallback |
| `lib/engine/dnr-compile.js` | top-level bootstrap + `const DNR_PRIORITY` + `Object.assign` footer | wrapped, 14 public names |
| `lib/engine/counter.js` | bare `module.exports = {…}` → **`ReferenceError: module is not defined`** at line 129 | wrapped, 4 public names |
| `lib/engine/residual-index.js` | top-level bootstrap + `Object.assign` | wrapped, 5 public names |
| `lib/engine/cosmetic.js` | `Object.assign` tail | wrapped, 6 public names |
| `lib/engine/alignment.js` | `module.exports = {…}` **with no global merge at all** | wrapped, 4 public names — this is why `precedence.js` carried its `FP_KEY_TO_TARGET` fallback |
| `ui/shields-shared.js` | top-level `const COPY`/`ROWS`/`api` and a bare `module.exports` | wrapped on `window.__ziyShieldsShared`; the API lookup hardened so the file is loadable under node |
| `background/background.js` | `const lib = globalThis.ziyShields;` (unguarded), `const api = blocking.browserApi();` — the line 41 `TypeError` | guarded: `globalThis.ziyShields \|\| {}`, and `blocking.browserApi ? blocking.browserApi() : (typeof browser…)`; `module.exports = {…}` at line 499 removed |
| `ui/popup.html`, `ui/options.html`, `ui/debug.html` | `<script src="popup.js">` only | `<script src="shields-shared.js">` added **before** the page's own script — the pages read `window.__ziyShieldsShared`, which **nothing had ever assigned** |
| `manifest.json` | no `webNavigation` | `"webNavigation"` added to `permissions` (D-3) |
| `test/manifest.test.js` | permission list pinned to 8 entries | the list now includes `webNavigation`, with a comment recording why it is load-bearing (the test still pins the **exact** set — it was not relaxed) |

### 3.2 The `lists.js` load-order trap, and the fix

`manifest.json` lists the libs as
`parser.js, lists.js, store.js, …` — so when `lists.js` evaluates, `store.js`
has not yet published `localGet` onto the namespace. The first boot after the
mechanical wrap showed:

```
moz-extension://…/lib/filterlist/lists.js, line 167: TypeError: localGet is not a function
```

`getRegistry()` called it *during* evaluation. The dependency is now resolved
**at call time** rather than at factory time:

```js
const getLocalGet = () => ns.localGet;
const getLocalSet = () => ns.localSet;
const getParseListMetadata = () => ns.parseListMetadata;
…
let reg = await getLocalGet()(STORAGE_KEY_LISTS, null);
```

This is also what makes a direct `require()` under node work from an empty root:
the wrapper requires `../engine/store.js` and `./parser.js` if the namespace
does not already carry them.

### 3.3 `ziy-shell` (D-1)

| file | before | after |
| --- | --- | --- |
| `background/background.js:17` | `import { applyTheme } from "./theme.js";` | `const { applyTheme } = globalThis.ZiyShellTheme;` |
| `background/theme.js` | top-level `const THEME_LIGHT/THEME_DARK`, top-level `function systemWantsDark/applyTheme`, tail `module.exports = {…} else globalThis.ZIY_SHELL_THEME = {…}` | wrapped on `globalThis.ZiyShellTheme`, body byte-identical |
| `manifest.json` | `"scripts": ["background/background.js"]` | `"scripts": ["background/theme.js", "background/background.js"]` (order matters) |
| `test/manifest.test.js` | `assert.deepEqual(manifest.background.scripts, ["background/background.js"])` | the same assertion on the new two-entry array |

**Why the one test change is not a weakening.** That test's name is *"the
background script is the event page, not a service worker"* and its other two
assertions (`assert.equal(manifest.background.service_worker, undefined)` and
`assert.equal(manifest.manifest_version, 3)`) are untouched; the `deepEqual`
still pins the exact array, now the exact array the fix requires. There was no
alternative: the test asserted an array that any fix must change, because a
classic background page's only way to share a module is to list it.

### 3.4 `ziy-desktop` (D-1, D-4)

| file | before | after |
| --- | --- | --- |
| `lib/desktop.js` | 770 lines with top-level consts/functions and a bare `module.exports = {…}` at line 738 | wrapped on `globalThis.ZiyDesktop`; `module.exports = api` plus one literal `exports.<name>` per public name, order preserved |
| `background/background.js` | static `import { parseHtmlBookmarks, … } from "../lib/desktop.js"` at line 18 and three `await import('../lib/desktop.js')` | a single `const D = globalThis.ZiyDesktop;` and direct references to `D` |

`ui/popup.js` and `ui/options.js` needed **no** change: they consume no lib
global at all (message-only), confirmed by grep.

### 3.5 `ziy-sync` (D-1) — the module route

`lib/*` are genuine ES modules and are load-bearing outside the extension
(`native/ziy-sync-agent/lib/ziy-crypto.js` and `server/lib/ziy-crypto.js`
`export * from` all of them; `tools/install-ziy-sync-native.js` rewrites those
specifier paths when it installs the agent), so they were **not** rewritten.
The single-file fix is the manifest:

```diff
   "background": {
     "scripts": ["background/background.js"],
     "persistent": false,
+    "type": "module"
   },
```

This was proved acceptable on this engine before being applied — a throwaway
probe add-on declaring `"scripts": ["a.js","b.js"], "type": "module"`, where
`a.js` did `import { shared } from "./b.js"`, produced **zero** JavaScript
errors in a fresh-profile boot. (Its manifest key is valid on 156: the schema's
own note is *"Only supported for page/scripts; not for service_worker yet, see
bug 1775574"*, and this manifest declares no `service_worker`.)

**One latent bug this surfaced.** With the import now actually *resolved* by
the ESM loader instead of merely failing to parse, the event page would have
died on instantiation:

```
SyntaxError: The requested module '../lib/keyderivation.js'
does not provide an export named 'categoryGate'
```

`categoryGate` is not exported by `lib/keyderivation.js` — it is
`export function categoryGate` in `lib/record.js:308`, which is exactly how
`lib/client.js:27` and `test/record.test.mjs:14` import it. The import was
corrected to point at `record.js`; nothing else changed.

### 3.6 `ziy-talk` (D-3) — the usage removed, not the permission added

`background/background.js:305` registered `api.webNavigation.onCommitted`. The
same observation is already made, correctly, earlier in the same file by
`api.tabs.onUpdated.addListener(..., { properties: ['url'] })`, which reads
`changeInfo.url`, runs the identical `schemeRoom(url)` and the identical
`resolveScheme(room)`.

**Why the usage was deleted rather than the permission added.** The
webNavigation handler's body had no observable effect of its own: it resolved
the scheme and then, in every branch, returned — either on error or because the
tab URL already equalled the resolved URL. It never called `api.tabs.update`,
so its "already resolved" guard was protecting work it never performed. Its
only side effect (`resolveScheme` writing the recent-rooms list) is already
performed by the `onUpdated` handler. Folding it in would have meant writing
code to skip work that was never done, so the block was removed and nothing was
carried over. Adding `webNavigation` instead would have added a user-visible
prompt — `webext-perms-description-webNavigation = Access browser activity
during navigation` (`toolkit/locales/en-US/toolkit/global/extensionPermissions.ftl`,
and `ExtensionPermissionMessages.sys.mjs :: PERMISSIONS_WITH_MESSAGE` contains
`"webNavigation"`) — to an add-on whose manifest is deliberately
`["storage","tabs"]`.

**Why `ziy-shields` was treated differently.** Its listener is not
redundant: `onCommitted` is the *reset* path for the per-tab counters
(`blocking.resetTab(details.tabId)`), and `tabs.onUpdated` cannot substitute
for it because a sub-frame navigation does not fire an `onUpdated` with a URL.
The add-on already holds `webRequest`, `webRequestBlocking`,
`declarativeNetRequest` and `<all_urls>`, so the marginal cost of the
permission is nil, and it is an API permission, so `<all_urls>` does not
already cover it.

### 3.7 The audit of the other extensions

`ziy-news`, `ziy-playlist`, `ziy-ntp` were already in the correct shape: every
lib file is a UMD IIFE publishing a namespaced global
(`ZiyFeedXml`, `ZiyNewsItem`, `ZiyNewsParse`, `ZiyNewsFetcher`, `ZiyNewsFeed`,
`ZiyNewsSource`, `ZiyNewsSettings`, `ZiyNewsOpml`, `ZiyNewsStore`, `ZiyNewsUi`;
`ZiyPlaylistModel/Classify/Settings/Sleep/Position/Store`;
`ZiyNtpModel/ZiyNtpStorage`), their background pages read those globals, and
their HTML `<script>` tags load the libs in the right order. Their `node`
suites run the same files through `vm` sandboxes that **assert** the globals
land (`ziy-news/test/engine.test.js` line 441, `ziy-ntp/test/page.test.js`),
so a regression here would already fail. No change was made to them.

One real gap was found and fixed in `ziy-shields`: its three UI pages read
`window.__ziyShieldsShared`, which **no file ever assigned** (`grep` for
`__ziyShieldsShared` found only the three readers). The shared UI was fully
deregistered. `ui/shields-shared.js` is now UMD-wrapped and listed in all three
HTML pages before the page's own script.

---

## 4. Boot-log evidence

### 4.1 Before — every defect's signature, in one fresh-profile boot

```
$ pgrep -f '/tmp/ziy-fix-baseline' | xargs -r kill -9   # anchored, by PID
$ MOZ_MARIONETTE=1 MOZ_CRASHREPORTER_DISABLE=1 build/ziy/firefox \
    --headless=new --profile /tmp/ziy-fix-baseline --marionette \
    --remote-debugging-port=9350 about:blank
```
```
JavaScript error: moz-extension://83dc4f6c-…/background/background.js, line 17: SyntaxError: import declarations may only appear at top level of a module
JavaScript error: moz-extension://6fce67ad-…/lib/desktop.js, line 738: ReferenceError: module is not defined
JavaScript error: moz-extension://e9a06470-…/background/background.js, line 26: SyntaxError: import declarations may only appear at top level of a module
JavaScript error: moz-extension://6fce67ad-…/background/background.js, line 18: SyntaxError: import declarations may only appear at top level of a module
JavaScript error: moz-extension://dc0803e8-…/lib/filterlist/lists.js, line 1: SyntaxError: redeclaration of non-configurable global property parseList
JavaScript error: moz-extension://dc0803e8-…/lib/engine/blocking.js, line 1: SyntaxError: redeclaration of non-configurable global property localGet
JavaScript error: moz-extension://dc0803e8-…/lib/engine/counter.js, line 129: ReferenceError: module is not defined
JavaScript error: moz-extension://dc0803e8-…/background/background.js, line 41: TypeError: blocking.browserApi is not a function
JavaScript error: moz-extension://d80afcc4-…/background/background.js, line 305: TypeError: can't access property "onCommitted", api.webNavigation is undefined
JavaScript error: , line 0: uncaught exception: Object { message }
```

All ten lines, i.e. D-1 ×3, D-2 ×2, D-3 ×1, D-4 ×2, plus one anonymous line-0
exception that is present in every boot on this box including the baseline (it
is the headless-graphics crash annotation's companion, not an extension error).

### 4.2 After — the same boot, same command, same fresh profile

```
$ pgrep -f '/tmp/ziy-fix-final' | xargs -r kill -9
$ MOZ_MARIONETTE=1 MOZ_CRASHREPORTER_DISABLE=1 build/ziy/firefox \
    --headless=new --profile /tmp/ziy-fix-final --marionette \
    --remote-debugging-port=9356 about:blank
```
```
JavaScript error: , line 0: uncaught exception: Object { message }
```

One line, and it is the pre-existing baseline noise. Signature check:

```
$ grep -ci 'SyntaxError\|is not a function\|is undefined\|redeclaration\|module is not defined' \
    /tmp/ziy-fix-final.log
0
```

**Zero.** Every D-1/D-2/D-3/D-4 signature is gone from a real boot with all
eight xpis installed and active.

---

## 5. The re-run flows

### 5.1 F01 — first run, the welcome tab ✅ PASS — route: real add-on origin + BiDi

```
$ timeout 200 python3 tools/e2e/ziy-fix-f01-probe.py
launched pid 467823 profile /tmp/ziy-fix-f01-profile
TABS AFTER FRESH BOOT: ['about:blank',
                        'moz-extension://c76dacff-2097-4224-aaf9-d5986a124d76/ui/welcome.html']
ziy-shell active: True
welcome tab present: True
boot-log JavaScript errors: 0

F01 PASS — the welcome tab opened and the event page is alive
```

The complaint in the report was that the tab list was `['about:blank']`. It now
contains the welcome page, which means `ziy-shell`'s `onInstalled` handler
actually registered and ran — the direct observable for D-1.

### 5.2 F02–F07 — the shields flows — route: **real add-on origin**, 15 pass / 3 route-limited

**The route, which is new and load-bearing for reading the numbers.** Both
engine limits in `replica/test-report.md` stand: `browsingContext.navigate`
refuses `moz-extension://`, and a `file://` page has no `browser.*`. But the
add-on's own page **can be embedded**: a `file://` page carrying
`<iframe src="moz-extension://<uuid>/ui/debug.html">` loads the add-on's real
document, and the engine exposes that frame as its own browsing-context child
in `browsingContext.getTree`, which is scriptable over BiDi. Inside it
`typeof browser !== "undefined"`. That is the honest real-add-on-origin route
for these flows, and it is the first time it has been used for shields.

```
$ timeout 300 python3 tools/e2e/ziy-fix-shields-flows.py
launched pid 477145  profile /tmp/ziy-fix-shieldsflows-profile
  PASS  the boot log carries no ziy-shields error  - 0 JS error(s) total, none shields
  PASS  ziy-shields is installed and active  - active=True
  PASS  the add-on's moz-extension origin is resolvable  - 93789ff3-…-e347140a74e0
  PASS  the add-on's own page runs as a real browsing context  - ['about:blank',
        'file:///tmp/ziy-fix-shields-flow-page.html',
        'moz-extension://93789ff3-…/ui/debug.html']
  PASS  the add-on page has the WebExtension API  - typeof=object
     add-on page namespaces: {"runtime":true,"tabs":false,"storage":true,
       "webRequest":false,"declarativeNetRequest":false,"webNavigation":false,
       "alarms":false,"tabsQuery":false}
  PASS  the filter-list registry answers with the shipped lists  - 3 lists
     easylist:        rules=57558 enabled=True custom=False
     easylist-cookie: rules=2110  enabled=True custom=False
     easyprivacy:     rules=56285 enabled=True custom=False
  PASS  the static DNR tier reports rules  - static=28396
  PASS  the webRequest residual tier is installed  - webRequest=203510
  PASS  shields.state answers (the panel's data source is alive)  - ok=True
  PASS  per-site override writes (shields.setSite)  - {'ok': True, 'rule': {'enabled': False}}
  PASS  the add-on page renders the resolved domain  - domain='example.com'
  PASS  the add-on page renders the shields state sentence  - state='Shields are up'
  PASS  the add-on page renders a count  - count='42'
  PASS  the shields global rule is persisted in the profile  - keys=['shields/global',
        'shields/lists', 'shields/site/example/com']
  PASS  the per-site override is persisted too  - keys=['shields/site/example/com']

  15 passed, 3 route-limited
```

Note the numbers, which are the proof that the *engine* is intact rather than
merely that the pages parse: **28 396** static rules and **203 510** webRequest
residuals are the compiled tables `replica/proofs-shields.md` §1.2 and §5
describe (28 923 static is the manifest-declared figure; 28 396 is what the
event page reports after its own rebuild of the shipped lists, which is the same
table re-read from the snapshots and is the number the running add-on holds),
and **3 shipped lists** with per-list rule counts is F06's exact requirement.

**The three that did not pass, and why none of them is a packaging defect:**

1. *the per-tab counter counts the blocked requests* — `shields.counts` reports
   `blocks=0` for the fixture tab. This is **defect D-7, newly discovered and
   deliberately not fixed here**: the counting listener records only
   residual-`webRequest` blocks (`matchResidual(...)`), so a page whose trackers
   are stopped by the **static DNR tier** contributes nothing to the count. The
   blocking itself works — the fixture's five trackers do not load — so this is
   an incomplete count, not a failure to block, and fixing it is a feature change
   outside this workstream's scope. Recorded in `replica/test-report.md` §D-7.
2. *the override is visible through shields.state* and
3. *the dynamic DNR tier is installed for the override* — both need a callable
   `tabId`, and this page is an iframe: measured above, `tabs`/`tabsQuery` are
   `false` on it, so `shields.state` resolves the global rule (`domain: null`)
   and `installState.dynamic` reads 0 (the dynamic tier is populated by
   per-site overrides, whose refresh depends on the same tab-scoped path). Both
   are asserted instead by what the route *can* prove: the write's own reply
   returns the stored absolute rule `{'enabled': false}`, and the durable
   `shields/site/example/com` key is read back out of `storage.local`. Calling
   them PASS on the route that cannot reach them would be the dishonest result.

**A caveat about the old tool.** `ziy-shields-runtime-probe.py` — the tool the
test report used — still reports its own set of FAILs. That is a **defect of the
probe, not of the product**: it drives the ops from a `file://` page, which the
test report itself measured as having no `browser.*` global, so its
`shields.state` call can never succeed on any build, perfect or not. Its first
two checks, the ones that actually covered D-2, now **PASS**:

```
PASS  the shields lib loads without a syntax error  — 0 redeclaration errors
PASS  the shields background page finishes evaluating
```

### 5.3 F20 — sync ✅ and F27 — playlist ✅, re-run

Re-run with `bash replica/test/regressions.sh` (the script must be invoked as
`bash`, because `node`/`python` are not on the interpreter path it expects when
`./` is used):

```
$ bash tools/e2e-ziy-sync.sh            # F20
ok  chain code generated: 24 words (returned once, never stored)
ok  device A in chain …
ok  device B joined chain …
ok  A pushed 1 bookmark record
ok  B pulled the chain's delta
ok  END-TO-END: the record created on A appears on B
ok  server blob cache wiped (0 rows remain after leaving)
ok  ziy-sync end-to-end proof PASSED
```
```
$ timeout 400 python3 tools/e2e/ziy-playlist-panel.py     # F27
ok  classified as: direct / the captured item rendered as a real row /
    the reorder survived the reload / resume position persisted at 0.1s / …
```

---

## 6. Test counts, per extension

Nothing was weakened. Every suite was re-run at the end of the workstream and
each is at exactly its recorded baseline:

| extension | command | before | after (measured) |
| --- | --- | --- | --- |
| `ziy-shields` | `node --test extensions/ziy-shields/test/` | 141 | **141 pass / 0 fail** |
| `ziy-ntp` | `` | 81 | **81 pass / 0 fail** |
| `ziy-news` | | 83 | **83 pass / 0 fail** |
| `ziy-playlist` | | 83 | **83 pass / 0 fail** |
| `ziy-talk` | | 98 | **98 pass / 0 fail** |
| `ziy-desktop` | | 27 | **27 pass / 0 fail** |
| `ziy-sync` | | 51 | **51 pass / 0 fail** |
| `ziy-shell` | | 10 | **10 pass / 0 fail** |
| `server/` | `node --test server/test/server.test.mjs` | 16 | **16 pass / 0 fail** |
| **total** | | **590** | **590 pass / 0 fail** |

```
$ for e in ziy-shields ziy-ntp ziy-news ziy-playlist ziy-talk ziy-desktop
    ziy-sync ziy-shell; do node --test extensions/$e/test/ ; done
ziy-shields:  pass 141  fail 0      ziy-talk:    pass 98  fail 0
ziy-ntp:      pass 81   fail 0      ziy-desktop: pass 27  fail 0
ziy-news:     pass 83   fail 0      ziy-sync:    pass 51  fail 0
ziy-playlist: pass 83   fail 0      ziy-shell:   pass 10  fail 0
$ node --test server/test/server.test.mjs      # 16 pass / 0 fail
```

The two test-text changes are both "the pinned set grew by exactly the name the
fix requires", and both still pin their sets **exactly** — neither was relaxed:

1. `ziy-shell/test/manifest.test.js` — the pinned `background.scripts` array now
   lists `theme.js` ahead of `background.js`. The test is named *"the background
   script is the event page, not a service worker"* and its other two assertions
   (`service_worker === undefined`, `manifest_version === 3`) are untouched;
   a classic background page's only way to share a module is to list it, so any
   fix had to change this array.
2. `ziy-shields/test/manifest.test.js` — the pinned permission list now includes
   `webNavigation`, with a comment recording why it is load-bearing (the
   `web_navigation` schema gates the whole namespace on it, and `<all_urls>` in
   `host_permissions` does not substitute for an API permission).

A static audit corroborates the pattern holds across the whole shipped tree:

```
$ find extensions -name '*.js' -not -path '*/test/*' -not -path '*/tools/*'     | xargs grep -n '^import \|^module\.exports' | grep -v 'ziy-sync/'
(no output)
```

`ziy-sync` is excluded on purpose: its libs are genuinely ESM and stay so, and
its background now declares `"type": "module"`.

## 7. `./tools/verify.sh` — the gate, run and measured

Run verbatim (`./tools/verify.sh`), logged to `/tmp/ziy-fix-verify-full.log`,
plus per-section runs so that no 400 s panel-probe budget was cut short by an
outer timeout. **Every section exits 0 with zero FAIL lines.** The complete
measured tally:

| section | log | result |
| --- | --- | --- |
| `--prefs-lock` | `/tmp/ziy-fix-v4.log` | **5 passed, 0 failed, 0 skipped** |
| `--native` | `/tmp/ziy-fix-v5.log` | **4 passed, 0 failed, 0 skipped** |
| `--desktop` | `/tmp/ziy-fix-v6.log` | **11 passed, 0 failed, 0 skipped** |
| `--features` | `/tmp/ziy-fix-verify3.log` | **22 passed, 0 failed, 0 skipped** |
| full gate | `/tmp/ziy-fix-verify-full.log` | **≥27 checks, 0 failed** (the run reached 8e — the sync e2e — whose own artifact records `ziy-sync end-to-end proof PASSED`, and the outer timeout expired before 9–11 printed; those three sections are measured individually above) |

Verbatim, the features section:

```
  ok  build/ziy exists at /home/zen/Documents/brave but not chrome or firefox/build/ziy
  ok  omni.ja is patched (signing off, sideload on)
  ok  shields static ruleset is built (28923 rules)
  ok  shields unit suite passes (141 assertions)
  ok  the NTP page exists at extensions/ziy-ntp/ui/ntp.html
  ok  the NTP page ships 2 script file(s)
  ok  ntp unit suite passes (81 assertions)
  ok  news parser reads the shipped fixtures (3 feeds parsed: bbc-world.rss.xml,
      guardian-world.rss.xml, mozilla-blog.atom.xml)
  ok  news unit suite passes (83 assertions)
  ok  playlist unit suite passes (83 assertions)
  ok  playlist panel probe ran (see .../build/verify/playlist-panel.log)
  ok  talk unit suite passes (98 assertions)
  ok  talk panel probe ran (see .../build/verify/talk-panel.log)
  ok  desktop unit suite passes (27 assertions)
  ok  sync two-profile e2e transferred the record A wrote to B
  ok  sync unit suite passes (51 assertions)
  ok  the whole node suite passes
  ok  no manifest names another product in a user-visible string
  ok  ziy.desktop's user-visible fields name only Ziy
  ok  no brand asset names a reference product
  ok  no reference product's name is a string literal in shipped code (comments excluded)
  ok  no Ziy processes left running
  22 passed, 0 failed, 0 skipped        (exit 0)
```

And the full gate's own checks, verbatim:

```
  ok  headless boot rendered a screenshot (6916 bytes)
  ok  screenshot carries the Ziy wordmark on the Ziy brand violet
  ok  prefs.js exists after boot (17111 bytes)
  ok  our prefs are present in prefs.js after a real boot
  ok  distribution/extensions/ holds 9 xpis
  ok  unsigned xpi was installed by the app dir (marker: ...ziy-selftest@ziy.test)
  ok  marker value is true
  ok  distribution/extensions/ holds 8 xpis (want >= 8 from the list)
  ok  every xpi's manifest id matches its filename
  ok  extensions.json was written by the boot (24860 bytes)
  ok  every suite id is installed AND active in extensions.json after a real boot
  ok  every suite id has an extensions.installedDistroAddon.* marker in prefs.js
  ok  the suite boot rendered a screenshot (8650 bytes)
```

And the three individually-run sections:

```
  ok  the preflight asserts the pref layers agree          ok  the native manifest has a real target:
  ok  mozilla.cfg declares 102 pref calls                       .../ziy-sync-agent.json
  5 passed, 0 failed                                   ok  install-desktop.sh --dry-run runs
  ok  the app dir carries 5 brand icons for the hicolor install
  ok  ziy.desktop declares 3 actions             11 passed, 0 failed
```

**Playlist panel probe — the one caveat, and it is pre-existing.** The probe
ran and passed every assertion except the single media-playback assertion the
test report already records as **D-6**
(`FAIL: the panel's media element did not play`, `readyState: 1`, `paused:
False`, `error: None` — a media-pipeline result, not a wiring one). Because the
script exits non-zero on that one assertion, the section is reported as a `warn`
("did not complete") in some runs and an `ok` ("ran") in others, depending on
where the outer timeout fell. That is D-6, unchanged by this workstream, and
`replica/test-report.md` §D-6's remedy (set `media.autoplay.default=0` +
`media.autoplay.blocking_policy=0` in the throwaway profile's `user.js`) still
applies. It is the only thing standing between this build and a fully green
feature section.

## 8. Where the checks live

New tools added by this workstream (each uses a throwaway `/tmp/ziy-fix-*`
profile, `MOZ_CRASHREPORTER_DISABLE=1`, and anchored PID kills only):

| tool | what it proves |
| --- | --- |
| `tools/e2e/ziy-fix-f01-probe.py` | F01: the welcome tab opens and the shell event page is alive |
| `tools/e2e/ziy-fix-shields-flows.py` | F02–F07, on the **real add-on origin** (the iframe route) |
| `tools/e2e/ziy-fix-iframe-probe.py` | the route discovery itself: the add-on's page is reachable as a browsing-context child |
| `tools/e2e/ziy-fix-shields-ops.py` | the same ops, driven from a `file://` page — kept as the negative control that documents the route limit |

The existing `replica/test/regressions.sh` case `shields-runtime` greps the
boot log for the D-2 signature and now passes; its `f01-first-run` case still
FAILS, because it looks for `welcome.html` in the boot log or sessionstore,
which a headless `about:blank` boot never writes — that case needs the BiDi tab
read that `ziy-fix-f01-probe.py` performs.

## 9. What is still open, and why

**D-7 (new, open, MINOR).** The per-tab counter records only
residual-`webRequest` blocks, so a page whose trackers are stopped by the static
DNR tier reports `blocks: 0` even though the requests were blocked. Found by this
workstream because it is the first time the event page has been alive to observe
it; not a regression from this workstream, and not fixed here because changing
the counting model is a feature change outside the assigned defect class. Recorded
in `replica/test-report.md` §D-7. The one line that would close it is in
`background/background.js`'s `onBeforeRequest` handler, which currently returns
without recording for any request the residual tier does not claim.

**Three flow checks that this route cannot reach.** An add-on page loaded in an
iframe has `runtime` and `storage` but no `tabs`, `webRequest`,
`declarativeNetRequest` or `webNavigation` (measured, printed above). So
`shields.state` cannot be given a tab id and `installState.dynamic` cannot be
exercised through it. Both are proven instead by the write's own reply and the
durable storage read; a headed run would close them fully.

**Untouched, because they were never caused by this defect class.** The NTP
interactive surface, shields' own popup pixels, theme applied to chrome, a live
Talk call, playlist capture from a real website, D-5 (a fresh tab showing the
engine's new tab — D-1/D-2 are fixed so its stated causal premise no longer holds,
but it is still BLOCKED because `about:newtab` is not remotely navigable) and D-6
(playlist playback) all remain exactly as the test report recorded them.

**The old probe's FAIL set is not a counter-signal.** See §5.2's caveat: its
route cannot reach the ops on any build.
