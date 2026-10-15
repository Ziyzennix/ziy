# core-src — the source a future AI assistant will touch most

Scope: `extensions/` (9 shipped MV3 add-ons), `native/`, `server/src/`, the token
mirror, and the storage conventions. Every claim below cites a file I read.
Naming/id facts: `replica/architecture.md` §8, `shell/extensions.list`.

---

## 1. The 9 shipped extensions

Ids are read from each `manifest.json`'s
`browser_specific_settings.gecko.id`. The suite list of record is
`shell/extensions.list:13-21` (9 ids) — the engine derives the id from the XPI
FILENAME, so `<id>.xpi` must match (`build-extension.sh:6-10`,
`shell/extensions.list:3-6`).

### 1.1 `ziy-shields@ziy.app` — the blocking engine (largest; 53 files)

`extensions/ziy-shields/manifest.json:1-114`. MV3, `strict_min_version: 142.0`
(`:11`).

- **background** — `background.scripts` is a **13-entry classic array**
  (`:28-43`): `lib/filterlist/parser.js`, `lib/filterlist/lists.js`,
  `lib/engine/{store,precedence,dnr-compile,blocking,counter,static-match,
  residual-index,cosmetic}.js`, then `background/background.js` LAST
  (`:42`). `"type": "classic"` (`:43`). `"service_worker":
  "background/background.js"` is declared alongside (`:42`) per the
  cross-browser recipe (Gecko does not implement it, bug 1573659) — see
  `background/background.js:3-8`.
- **permissions** (`:14-26`) — exactly 9, pinned by
  `test/manifest.test.js:83-99`: `declarativeNetRequest`, `webRequest`,
  `webRequestBlocking`, **`webNavigation`** (load-bearing, D-3 — see §2.4),
  `storage`, `tabs`, `activeTab`, `scripting`, `alarms`. Plus
  `host_permissions: ["<all_urls>"]` (`:27`).
- **action** with popup `ui/popup.html` (`:44-53`); **both** `options_page` and
  `options_ui` point at `ui/options.html` (`:54-59`).
- **content_scripts** — `content/cosmetic.js` at `document_start`,
  `all_frames: true` (`:59-74`).
- **declarative_net_request.rule_resources** — one entry, id
  `ziy-shields-lists`, path `rules/static-ruleset.json` (`:76-82`). That file
  is 28 923 rules / 3 196 194 bytes (measured this session); the engine's
  `GUARANTEED_MINIMUM_STATIC_RULES` is 30 000
  (`lib/engine/dnr-compile.js:3-16`).
- **files**: `lib/filterlist/` (parser, lists, `snapshots/{easylist,easyprivacy,
  fanboy-cookiemonster}.txt`), `lib/engine/` (8 modules), `background/`,
  `content/`, `ui/` (popup/options/debug + `shields-shared.js` + `shields.css`
  + `tokens.css`), `icons/` (shield-16/32/48/96 + shield-down-*),
  `rules/static-ruleset.json`, `tools/` (gen-static-ruleset.js,
  measure-residual.cjs, prove-blocking.py, fixture-tracker-page.py), `test/`
  (9 suites), `LICENSES`.
- **lib/ one-liners** (each cites its own header):
  - `lib/filterlist/parser.js:1-38` — ABP/uBO filter-list parser; pure, no DOM,
    never throws on a bad line (`:37`).
  - `lib/filterlist/lists.js:1-14` — list registry: source URL, sha256,
    enable flag, alarm-driven updates, custom-list add/remove.
  - `lib/engine/store.js:1-21` — the two stores: `storage.local` for
    `shields.global`/`shields.lists` (small, launch-critical), IndexedDB
    `ziy-shields` for rules/elements/sessions (`:41-42`).
  - `lib/engine/precedence.js:1-11` — the 5-layer resolution order (session →
    per-site → sub-toggles → global → factory); per-site rules are ABSOLUTE,
    never merged with global (`:14-16`).
  - `lib/engine/dnr-compile.js:1-53` — parsed table → DNR rules, with the
    measured engine budgets and the priority ladder (`:41-51`).
  - `lib/engine/blocking.js:1-30` — the imperative `webRequest` fallback +
    per-tab counters; quotes `modules/WebRequest.sys.mjs runChannelListener`
    for DNR/webRequest ordering (`:11-19`).
  - `lib/engine/counter.js:1-4` — blocked-item counts, time-saved/bandwidth
    formatting.
  - `lib/engine/static-match.js:1-40` — evaluates the SHIPPED static ruleset
    in-process so DNR-blocked requests are counted (D-7); never blocks.
  - `lib/engine/residual-index.js:1-22` — the webRequest residual (~87k rules)
    bucketed by domain; a linear scan measured >300 s (`:14-16`).
  - `lib/engine/cosmetic.js:1-3` — element-hiding table + the block-element
    tool.
  - `lib/engine/alignment.js:1-3` — row-vocabulary alignment against
    `replica/re-deep-shields.md`.
  - `ui/shields-shared.js:1-10` — the shared popup/options row logic; NOTE it
    publishes on `window.__ziyShieldsShared`, NOT `ziyShields`
    (`ui/shields-shared.js:25-28`).
  - `lib/package.json`, `lib/engine/package.json`, `lib/filterlist/package.json`,
    `test/package.json` are all bare `{"type":"commonjs"}` (read this session).

### 1.2 `ziy-ntp@ziy.app` — `chrome_url_overrides.newtab`

`extensions/ziy-ntp/manifest.json:1-68`. The only suite member that owns the new
tab page (`chrome_url_overrides.newtab: "ui/ntp.html"`, `:14-16`).

- **background.scripts** — `["lib/model.js","lib/storage.js",
  "background/background.js"]` (`:17-19`); NO `"type"` key (default classic).
- **permissions** — `storage`, `topSites`, `search`; `optional_permissions:
  ["tabs","bookmarks"]` (`:24`).
- **options_ui** → `ui/options.html` (`:20-22`). No action, no sidebar.
- **files**: `lib/model.js` (773 lines — the single source of the NTP config
  shape, defaults and merge; pure, `lib/model.js:1-9`),
  `lib/storage.js` (187 — the only place that touches `browser.storage.local`,
  `lib/storage.js:1-8`), `ui/ntp.{html,css,js}`, `ui/options.*`,
  `content/content.js` (intentionally empty, `content/content.js:8-15`),
  `build-xpi.py` (deterministic packaging, `build-xpi.py:1-19`),
  `test/{model,page}.test.js`.
- The page inlines the token `:root` block into a `<style>` in
  `ui/ntp.html:8-13` and loads `../lib/model.js`, `../lib/storage.js`,
  `ntp.js` in that order (`ui/ntp.html:425-427`).

### 1.3 `ziy-sync@ziy.app` — the E2E-encrypted sync chain

`extensions/ziy-sync/manifest.json:1-45`. **THE ONE EXCEPTION to the classic
pattern**: `"background": { "scripts": ["background/background.js"],
"persistent": false, "type": "module" }` (`:13-17`).

- **permissions** — `storage`, `nativeMessaging`, `bookmarks`, `history`,
  `tabs` (`:18-24`).
- `options_ui` → `options/options.html` (`:27-30`); `action` + icons (`:31`).
- **files**: `lib/bip39.js` (345 — BIP-39 mnemonic + PBKDF2-HMAC-SHA512 2048
  rounds via `crypto.subtle`, `lib/bip39.js:1-32`), `lib/bip39-wordlist.js`
  (271 — the English wordlist), `lib/keyderivation.js` (251 — HKDF-SHA512
  hierarchy: 24-word code → ikm → master → category key → record key, plus
  Ed25519 device identity, `lib/keyderivation.js:5-14`), `lib/record.js`
  (372 — record format, AES-256-GCM with AAD binding, conflict resolution,
  `lib/record.js:1-12`), `lib/client.js` (230 — the HTTP state machine against
  the server's `/v1/*`, `lib/client.js:1-15`), `background/`,
  `options/`, `test/` (`.mjs`, 3 suites + `fixtures/bip39-english.txt`).
- **No `package.json`** in this dir (read: absent) — because it is not
  `require()`d; it is `import`ed. Its libs are ESM and are load-bearing OUTSIDE
  the extension: `native/ziy-sync-agent/lib/ziy-crypto.js:9-15` and
  `server/lib/ziy-crypto.js:9-11` both `export * from` them.

### 1.4 `ziy-pwd@ziy.app` — the native credential vault (newest)

`extensions/ziy-pwd/manifest.json:1-71`. `strict_min_version: 142.0` (`:11`).

- **background.scripts** — `["lib/pwd-client.js","background/background.js"]`,
  `"type": "classic"` (`:14-17`).
- **permissions** — `storage`, `nativeMessaging`, `tabs`, `activeTab` (`:18-24`).
- **action** popup `ui/popup.html` (`:25-38`); `web_accessible_resources`
  `ui/*`, `lib/*`, `icons/*` (`:40-52`).
- **files**: `lib/pwd-client.js` (295 — the native-messaging client, CSV
  import/export, origin normalisation; NEVER holds key material,
  `lib/pwd-client.js:1-10`), `background/background.js` (197 — the
  panel↔helper bridge, storage key `ziy.pwd.state`, `:34`),
  `ui/popup.{html,css,js}` + `tokens.css`, `test/pwd.test.js`.
- No options page; no `content_scripts` (the fill path does not ship —
  `lib/pwd-client.js:12-20`).

### 1.5 The other four

- **`ziy-shell@ziy.app`** (`extensions/ziy-shell/manifest.json`): product
  theme + first-run welcome. `background.scripts: ["background/theme.js",
  "background/background.js"]`, `"type":"classic"` (`:16-19`). Only suite
  member with `data_collection_permissions: {required:["none"]}` (`:11-13`).
  No `package.json`. `test/manifest.test.js` asserts `ui/tokens.css` carries
  `GENERATED from replica/design/tokens.json` (`test/manifest.test.js:52-54`).
- **`ziy-news@ziy.app`**: sidebar panel (`sidebar_action` → `ui/panel.html`,
  `:36-40`), `options_page` + `options_ui` (`:41-45`). `background.scripts` is a
  **10-entry classic array** (xml, item, parser, fetcher, aggregate, source,
  settings, opml, store, background; `:21-34`).
  `content_security_policy.extension_pages` allows
  `img-src 'self' data: https:` (`:46-49`).
- **`ziy-playlist@ziy.app`**: `content_scripts` `lib/classify.js` +
  `content/capture.js` at `document_idle` (`:36-43`); `action` (`:44-51`),
  `sidebar_action` (`:52-56`), `options_ui` (`:57-59`);
  `web_accessible_resources` `ui/panel.html` (`:64-69`). 7-script classic
  background (`:24-34`). CSP has `media-src 'self'` (`:60-62`).
- **`ziy-desktop@ziy.app`**: the app menu / import-export / default-browser
  status. `background.scripts: ["lib/desktop.js","background/background.js"]`,
  `"type":"classic"` (`:14-20`). 8 `commands` (Ctrl+T/N/Shift+P, zoom, find,
  import, Alt+F) (`:41-73`). `lib/desktop.js` (796 lines) is browser-API-free
  (`lib/desktop.js:1-24`); `background/background.js:22` reads
  `const D = globalThis.ZiyDesktop;`.

---

## 2. THE CRITICAL PATTERN — the UMD IIFE classic-script convention

### 2.1 Why it exists (engine behaviour)

`replica/proofs-fix-events.md` §1 quotes
`toolkit/components/extensions/WebExtensionPolicy.cpp BackgroundPageHTML()`
at the shipped revision `6f2c158dfc…`: every `background.scripts[]` entry
becomes `<script type="text/javascript" src="…">` inside ONE generated HTML
document, unless `manifest.background.type === "module"`. §1's table gives the
three fatal constructs in that shared scope:

| construct | result |
| --- | --- |
| `import …` | SyntaxError, whole file discarded |
| a 2nd top-level `const` of a name an earlier file owns | PARSE-time `redeclaration of non-configurable global property X`, file dropped |
| bare `module.exports` | `ReferenceError: module is not defined` |

§1 also records the fourth mechanism (D-3): `Schemas.sys.mjs::hasPermission`
gates a whole namespace, so `webNavigation` without the permission makes
`browser.webNavigation` undefined → TypeError at top level.
§4.1 lists the 10 baseline boot-log errors; §4.2 shows the same boot after the
fix with exactly one pre-existing noise line. §2 states the chosen pattern and
its rationale; §6's static audit is:
`find extensions -name '*.js' -not -path '*/test/*' | xargs grep -n '^import \|^module\.exports' | grep -v 'ziy-sync/'` → **no output**.

### 2.2 The lib wrapper — verbatim

`extensions/ziy-shields/lib/engine/store.js:28-45` (the `localGet/localSet`
entry is the same class of name D-2 killed):

```js
(function (root, factory) {
  "use strict";
  const ns = root.ziyShields || (root.ziyShields = {});
  const api = factory();
  Object.assign(ns, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.DB_NAME = api.DB_NAME;
    exports.DB_VERSION = api.DB_VERSION;
    ...
    exports.localGet = api.localGet;
    exports.localSet = api.localSet;
    exports.localRemove = api.localRemove;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  /* the whole body, nothing declared at the top level */
```

Two shape variants also in use: `extensions/ziy-shields/lib/engine/counter.js:38-49`
(the canonical `if (!root.ziyShields) root.ziyShields = {}` bootstrap + one
literal `exports.NAME` per public name) and `extensions/ziy-ntp/lib/model.js:13-21`
(the simplest form — `root.ZiyNtpModel = api;` with no `exports.*` mirror).
`extensions/ziy-shields/lib/filterlist/lists.js:32-45` is the variant that
`require()`s its dependencies when the namespace does not already carry them,
so the file works both in the page and under node.

### 2.3 The background consumption — verbatim

`extensions/ziy-shields/background/background.js:36-44` (guarded read of the one
namespace, one alias per module):

```js
const lib = globalThis.ziyShields || {};
const parser = lib;
const lists = lib;
const dnrCompile = lib;
const precedence = lib;
const store = lib;
const blocking = lib;
const cosmetic = lib;
```

with the API shim hardened at `:52-53`:
`const api = blocking.browserApi ? blocking.browserApi() : (typeof browser !== 'undefined' ? browser : chrome);`

The same guard at `extensions/ziy-pwd/background/background.js:34`
(`const P = globalThis.ziyPwd || {};`), `extensions/ziy-desktop/background/background.js:22`
(`const D = globalThis.ZiyDesktop;`), `extensions/ziy-shell/background/background.js:22`
(`const { applyTheme } = globalThis.ZiyShellTheme;`), and
`extensions/ziy-pwd/ui/popup.js:22` (`const lib = globalThis.ziyPwd || {};`).

### 2.4 The two load-order / API rules that fall out of it

1. **Dependency resolution is at call time, not factory time.** The manifest
   lists `lists.js` before `store.js`, so at `lists.js`' evaluation
   `ns.localGet` does not exist yet. `proofs-fix-events.md` §3.2 records the
   resulting `TypeError: localGet is not a function` and the fix
   (`const getLocalGet = () => ns.localGet;` … called inside the async body).
2. **Every lib file is listed BEFORE the background entry, and the background
   entry is LAST** — asserted by `extensions/ziy-shields/test/manifest.test.js:75-82`
   and `extensions/ziy-shell/test/manifest.test.js` (both suites pin the exact
   arrays; neither was relaxed).

### 2.5 The node/browser duality (why `exports.NAME = api.NAME` is literal)

`replica/proofs-fix-events.md` §2 measured: `import { hello } from "./umd.js"`
with only `module.exports = api` is a **SyntaxError** (named export not found);
adding a literal `exports.hello = api.hello;` **works** — because node's
cjs-module-lexer reads literal assignments. A `for` loop or
`Object.defineProperty` does not. Hence every `exports.*` line is hand-written,
one per public name. Root `package.json` is `"type": "module"` and every
`extensions/*/package.json` is `"type": "commonjs"` — the same guard satisfies
the extension page, `require()` under `node --test`, and the raw-source
`vm`/`new Function` loads (`extensions/ziy-shields/tools/measure-residual.cjs:8-12`,
`extensions/ziy-news/test/engine.test.js:441`).

---

## 3. Shared / reused modules

### 3.1 The design-token mirror

Single source of truth: `replica/design/tokens.json`. The generator is
`tools/lib/gen-tokens.sh` — it emits `:root { … }` + `[data-theme="dark"] { … }`
exactly as `replica/design/tokens.css` documents, plus the focus-ring,
`prefers-reduced-motion`, `prefers-contrast` and `forced-colors` blocks
(`tools/lib/gen-tokens.sh:100-167`). Usage:
`tools/lib/gen-tokens.sh [tokens.json] [out.css]`, defaults to
`replica/design/tokens.json` → `extensions/ziy-shell/ui/tokens.css`
(`tools/lib/gen-tokens.sh:28-31`).

**Verified this session:** `bash tools/lib/gen-tokens.sh` reproduces
`extensions/ziy-shell/ui/tokens.css` byte-identically (diff empty, 167 lines).
`extensions/ziy-shell/test/manifest.test.js:52-54` asserts the header
`GENERATED from replica/design/tokens.json` so it can never be hand-edited
silently.

**How the other extensions are kept in sync — this is NOT automatic.** 7 copies
exist: `ziy-shell` is the *generated* file; `ziy-shields`, `ziy-news`,
`ziy-playlist`, `ziy-talk`, `ziy-desktop`, `ziy-pwd` are *hand-copied mirrors*
whose headers say so (`extensions/ziy-news/ui/tokens.css:1-7`: "verbatim copy
of replica/design/tokens.css … Lines 89-126 … reproduced here verbatim"). Measured
md5s group them into two families: news/shields/talk (identical) and
desktop/pwd (identical); `ziy-playlist` differs from both; the shell's
generated file differs from every mirror (it carries extra chrome roles such as
`--tab-strip-*`, `--side-rail-*`, `--toolbar-*` and `--font-*` formatting).
**Rule to follow:** after a `tokens.json` change, re-run
`tools/lib/gen-tokens.sh` for the shell, then hand-copy `replica/design/tokens.css`
into each extension's `ui/tokens.css` (the NTP additionally inlines the same
roles into `<style>` in `ui/ntp.html:8-13`). There is no script that fans out to
the mirrors — the sync is by convention plus the "never hard-code a hex" rule
each mirror header restates. `ziy-ntp` has no `tokens.css` file at all by design.

### 3.2 The QR encoder (single-owner, not duplicated)

`extensions/ziy-talk/lib/qrcode.js` — a dependency-free ISO/IEC 18004
encoder, byte mode, versions 1-10, EC level M, Reed-Solomon included
(`extensions/ziy-talk/lib/qrcode.js:1-21`). It publishes `root.ZiyTalkQR`
(`:33`) and is consumed only by `extensions/ziy-talk/ui/panel.js:48`
(`const QR = self.ZiyTalkQR;`), loaded via `<script src="../lib/qrcode.js">`
in `ui/panel.html:234`. Correctness is pinned in `test/qrcode.test.js` against
published vectors; the 5 silent bugs a real zbar decode found are recorded in
`replica/proofs-talk.md` §2. **No other extension carries a QR encoder** — do
not add one.

### 3.3 The crypto / bip39 modules (single-owner, bridged not copied)

`extensions/ziy-sync/lib/{bip39,bip39-wordlist,keyderivation,record,client}.js`
are the ONE implementation. Two bridges re-export them so the agent and the
server share the code rather than a copy:

- `native/ziy-sync-agent/lib/ziy-crypto.js:9-15` —
  `export * from "../../../extensions/ziy-sync/lib/{bip39,keyderivation,record,client}.js"`,
  with a comment that `tools/install-ziy-sync-native.js` rewrites the relative
  paths to absolute repo paths at install time (`:8-13`).
- `server/lib/ziy-crypto.js:9-11` — the same three modules, so the server's
  tests build real signed records and then prove the server learned nothing
  (`server/lib/ziy-crypto.js:1-8`).

`native/ziy-pwd/lib/ziy-crypto.js` is separate on purpose: PBKDF2-SHA512
600 000 rounds / 32-byte key / AES-256-GCM (`:24`, `:57-62`), because a vault
key must be re-derivable from a human passphrase while the sync seed must not.
Do not merge the two crypto layers.

### 3.4 Other reuse shapes

- **The `native-protocol.js` framing module** exists twice by design, once per
  native host (`native/ziy-sync-agent/lib/native-protocol.js`,
  `native/ziy-pwd/lib/native-protocol.js`) — same code, same MDN quote; the
  pwd copy adds `scrubReply` (`native/ziy-pwd/lib/native-protocol.js:38-59`).
- **`lib/desktop.js`-style purity**: every lib module is free of `browser.*`
  and takes the API at the boundary (`extensions/ziy-ntp/lib/storage.js:1-8`,
  `extensions/ziy-desktop/lib/desktop.js:1-24`).

---

## 4. The native layer

### 4.1 Two hosts, one convention

| host | entry | owns | data | id refused to |
| --- | --- | --- | --- | --- |
| `ziy-sync-agent` | `native/ziy-sync-agent/ziy-sync-agent.js` (10 127 B, exec) | BIP-39 seed, Ed25519 keys, all crypto, all HTTP | `~/.ziy/sync` / `chain.sqlite` (`lib/store.js:89`) | `ziy-sync@ziy.app` (`lib/native-protocol.js:22`) |
| `ziy-pwd` | `native/ziy-pwd/ziy-pwd.js` (10 094 B, exec) | the credential vault, unlocked only in RAM | `~/.ziy/pwd/vault.sqlite` (`lib/store.js:80`, overridable via `ZIY_PWD_DATA_DIR`, `ziy-pwd.js:14-19`) | `ziy-pwd@ziy.app` (`lib/native-protocol.js:23`) |

Both hosts are `*.js` Node ESM with zero npm deps — the only imports in
`server/src`, `server/lib`, `native/**/*.js` are `node:crypto`, `node:events`,
`node:fs`, `node:http`, `node:path`, `node:process`, `node:sqlite`, `node:url`
(grep of all import/require specifiers, this session).

### 4.2 The wire protocol

MDN's framing is quoted in both `lib/native-protocol.js` headers: JSON, UTF-8,
preceded by an unsigned 32-bit native-byte-order length, max 1 MB. The
implementation uses `writeUInt32LE` / `readUInt32LE`
(`native/ziy-sync-agent/lib/native-protocol.js:5-19`; the pwd copy's
`encodeMessage` is the same shape). A partial header, a partial body, or a
length over `MAX_MESSAGE_BYTES` (`1024*1024`) emits `error` and destroys the
stream — "a desynchronised length prefix is never recoverable"
(`native/ziy-pwd/lib/native-protocol.js:61-64`).

Ops are dispatched from a single `Map`: `native/ziy-sync-agent/ziy-sync-agent.js:119-129`
(`chain.create/join/status/leave`, `sync.push/pull/now`, `devices.list/remove`,
`account.delete`, `capabilities`) and `native/ziy-pwd/ziy-pwd.js:46-58`
(`capabilities`, `vault.status/create/unlock/lock`, `credentials.save/list/get/
remove/clear`, `csv.import/export`). Replies are `{ok, op, ms, result}`; errors
are answers, not crashes (`native/ziy-pwd/ziy-pwd.js:229-245`), and
`safeMessage` strips any path/passphrase/password from the reply text
(`:257-263`).

### 4.3 Registration — where the manifests land

`tools/install-ziy-sync-native.js` and `tools/install-ziy-pwd-native.js` write
into the engine's own lookup order, derived from
`modules/NativeManifests.sys.mjs` inside omni.ja and from
`nsXREDirProvider::GetFile` (`tools/install-ziy-sync-native.js:9-46`):

```
$HOME/.mozilla/native-messaging-hosts/ziy-<host>.json      <- written
/usr/lib/mozilla/native-messaging-hosts/ziy-<host>.json    <- absent, root-owned
```

`.mozilla` is **hard-coded in the engine** — there is no per-profile
native-messaging dir and no pref that adds one
(`tools/install-ziy-pwd-native.js:17-31`). The manifest shape is
`{name, description, type:"stdio", path:<absolute>, allowed_extensions:[<id>]}`
(`tools/install-ziy-pwd-native.js:96-103`). The agent executable is copied to
`~/.ziy/native/<host>.js` mode 0755 plus its `lib/` and a
`package.json {"type":"module"}` (`tools/install-ziy-pwd-native.js:78-93`),
and the sync installer rewrites the `../../../extensions/ziy-sync/lib/`
specifiers to absolute repo paths (`tools/install-ziy-sync-native.js:100-119`).
Both installers PROBE the agent at install time with a real framed message
(`tools/install-ziy-pwd-native.js:135-158`); the sync one warns on failure, the
pwd one exits 1 (`tools/install-ziy-pwd-native.js:44-46`).
Env overrides for tests: `ZIY_NATIVE_MANIFEST_DIR`, `ZIY_SYNC_AGENT_DIR`,
`ZIY_PWD_AGENT_DIR` — used by `tools/e2e-ziy-sync.sh:141-152` to install into
throwaway HOMEs.

---

## 5. The server — `server/src`

- `server/src/server.js` — the HTTP surface (`:8-16`): `POST /v1/chains`,
  `POST /v1/challenges`, `GET/PUT /v1/chains/:chainId/records`,
  `DELETE /v1/chains/:chainId` (leave = cache wipe), `GET /healthz`. Bearer
  tokens are chain-scoped at request time; the path parameter is compared, not
  trusted (`:11-16`). Records are signed over
  `"ziy-rec/v1|" + category|record_id|updated_at|live|nonce|payload`
  (`:22-31`).
- `server/src/store.js` — the blind store: one blob per `(chain_id, record_id)`,
  a write cannot move a blob backwards in time, and leaving the chain deletes
  every blob (`:6-13`). It lists exactly what it can and cannot see
  (`:15-38`).
- **`node:sqlite`** — `import { DatabaseSync } from "node:sqlite"`
  (`store.js:59`), `new DatabaseSync(dbFile)` (`:121`), chosen because it ships
  with the runtime and `better-sqlite3` is not installable offline here
  (`store.js:47-54`). **Zero npm dependencies** anywhere in `server/`,
  `native/`, or the extensions.
- Tests: `server/test/server.test.mjs` (16 tests, per
  `replica/proofs-fix-events.md` §6). No `server/package.json` (read: absent)
  — the server runs under the root `type:module` package.

---

## 6. Data-storage conventions

### 6.1 Which entity lives where

| store | what | evidence |
| --- | --- | --- |
| `browser.storage.local` | small, launch-critical settings and per-site rules: `shields.global`, `shields.lists`, `shields.site.<domain>`, `ntp.config`, `ntp.topsites[.favorites/.frequent]`, `ntp.engines`, `news.sources`, `news.read`, `news.refresh`, `playlist.settings`, `playlist.sites`, `playlist.position`, `talk.room`, `talk.settings`, `talk.recent`, `ziy.pwd.state`, `ziy.sync.state`, `ziy.shell.settings`, and read-only `ziy.shields.blockedTotal` | `extensions/ziy-shields/lib/engine/store.js:1-9`; `precedence.js:204-208`; `extensions/ziy-ntp/lib/model.js:27-44`; `extensions/ziy-news/lib/store/store.js:1-11`; `extensions/ziy-playlist/lib/store.js:1-11`; `extensions/ziy-talk/background/background.js:172-176`; `extensions/ziy-pwd/background/background.js:34`; `extensions/ziy-sync/background/background.js:27-28` |
| IndexedDB | anything big or queryable: `ziy-shields` (`rules`/`elements`/`sessions`, `store.js:41-56`), `ziy-news` (items/read/refresh), `ziy-playlist` (`items`/`meta`) | `store.js:9-12`; `news/store.js:5-8`; `playlist/store.js:5-8` |
| native SQLite | the credential vault (`~/.ziy/pwd/vault.sqlite`, passwords encrypted, origin/username plaintext) and the sync chain (`chain.sqlite`) | `native/ziy-pwd/lib/store.js:1-19, 41-56, 80`; `native/ziy-sync-agent/lib/store.js:8-11, 32, 89` |
| server SQLite | opaque blobs only | `server/src/store.js:47-121` |

`ziy-pwd` deliberately keeps NO key material in `browser.storage` — the stored
state is `{unlocked, hasVault, count, lastOp}` and the helper is re-queried for
truth (`extensions/ziy-pwd/background/background.js:39-56, 79-92`).

### 6.2 The letter-shifted IndexedDB key encoding — the reference implementation

`browser.storage.local` is IndexedDB, at
`storage/default/moz-extension+++<uuid>/idb/*.sqlite`, table `object_data` — a
JSON scan of the profile finds nothing. Keys are stored with a **one-byte
`0x30`/`0`-prefix and every letter shifted down by one** (`s` written as `t`).
Reader: `tools/e2e/ziy-fix-shields-flows.py` `read_storage_local_keys()`
(`:100-175`).

```python
def unshift(raw):                      # tools/e2e/ziy-fix-shields-flows.py:127-135
    out = bytearray()
    for c in raw:
        if 65 <= c <= 90:   out.append((c - 65 - 1) % 26 + 65)
        elif 97 <= c <= 122: out.append((c - 97 - 1) % 26 + 97)
        else: out.append(c)
    return bytes(out)
...
while raw and raw[0] in (0x30, 0x31, 0x32, 0x33):   # :152-153  strip the prefix
    raw = raw[1:]
```

It globs both `moz-extension+++<uuid>` and
`moz-extension+++<uuid>^userContextId=*` (`:121-124`), and the harness must shut
the browser down first so SQLite checkpoints the journal (`:425-427`).

**Two further key facts, both discovered in this file:** the engine writes the
add-on's `.` keys with `/`, so `shields.global` is on disk as
`shields/global` and `shields.site.example.com` as
`shields/site/example/com` (`:421-423`, asserted at `:428-432`; boot-log
evidence in `replica/proofs-fix-events.md:469-471`).

---

## 7. Naming conventions (all verified in-tree)

| concept | rule | instance |
| --- | --- | --- |
| product id | `ziy` | `package.json` `name`/`author`; extension dir `extensions/ziy-<area>` |
| **add-on id** | `ziy-<area>@ziy.app` | all 9, read from each manifest's `browser_specific_settings.gecko.id`; one source of truth `shell/extensions.list:13-21` |
| pref namespace | `ziy.<area>.*` | `ziy.shields.*`, `ziy.ntp.*` (`replica/architecture.md` §8) |
| **message ops** | `<area>.<verb>`, dispatched from `switch (message.op)` in the background | shields: `shields.state`, `shields.setSite`, `shields.clearSite`, `shields.counts`, `shields.tabCounts`, `shields.rebuild`, `shields.installState`, `shields.lists`, `shields.addList`, `shields.removeList`, `shields.listEnabled`, `shields.cosmetic` (`extensions/ziy-shields/background/background.js:529-540`); pwd: `pwd.state`, `pwd.status`, `pwd.capabilities`, `pwd.create`, `pwd.unlock`, `pwd.lock`, `pwd.save`, `pwd.list`, `pwd.remove`, `pwd.clear`, `pwd.import`, `pwd.export` (`extensions/ziy-pwd/background/background.js:105-197`); sync: `sync.now`; ntp: `ntp.config`, `ntp.engines`, `ntp.reload`, `ntp.stats`, `shields.counts`; news: `feed.list/markRead/markAllRead/open/snapshot/whoareyou` + `news.debug`; playlist: `playlist.add/remove/move/moveBefore/get/clear/counts/duration/played/position`; desktop: `desktop.find`, `desktop.zoom` |
| op group exception | `ziy-talk` uses a `kind`-keyed handler map, not `message.op` | `HANDLERS` at `extensions/ziy-talk/background/background.js:142-151`, dispatched at `:153-167` |
| native host | `ziy-<area>` / `ziy-<area>d` | `ziy-pwd`, `ziy-sync-agent` |
| xpi filename | `<addon-id>.xpi` | `build-extension.sh:6-10` |

Cross-extension contract keys that must stay stable:
`ziy.shields.blockedTotal` (shields writes, NTP reads only —
`extensions/ziy-ntp/lib/model.js:38-44`) and the add-on ids
`ziy-shields@ziy.app` / `ziy-news@ziy.app` used to message siblings
(`extensions/ziy-ntp/lib/model.js:46-55`).

---

## 8. Do / Don't

**DO** wrap a new lib file as a classic-script UMD IIFE that publishes onto the
extension's one namespace and mirrors each public name with a literal
`exports.NAME = api.NAME;` — `extensions/ziy-shields/lib/engine/counter.js:38-49`.

**DON'T** put `import`/`export` in a classic background lib.
`extensions/ziy-shell/background/background.js:17` was
`import { applyTheme } from "./theme.js";`
(→ SyntaxError, F01's welcome tab never opened). Fixed by listing
`background/theme.js` before `background/background.js` in the manifest and
reading `globalThis.ZiyShellTheme` at
`extensions/ziy-shell/background/background.js:22`
(`replica/proofs-fix-events.md` §3.3).

**DON'T** declare anything at the top level of a file that shares the event
page's scope. `extensions/ziy-shields/lib/engine/blocking.js:1` had
`const { localGet } = (globalThis.ziyShields)` → parse-time
`redeclaration of non-configurable global property localGet`, whole file
discarded, every listener dead (`replica/proofs-fix-events.md` §4.1,
`replica/test-report.md` D-2).

**DON'T** leave a bare `module.exports` in a file the page loads.
`extensions/ziy-shields/lib/engine/counter.js:129` was
`module.exports = {…}` → `ReferenceError: module is not defined`. The event page
now carries an explicit end-of-file note that there is no `module` global in
that scope — `extensions/ziy-shields/background/background.js:628-631`.

**DON'T** assume a permission-gated namespace exists.
`extensions/ziy-talk/background/background.js:305` called
`api.webNavigation.onCommitted` without the permission
(→ `TypeError: can't access property "onCommitted", api.webNavigation is
undefined`). It was FIXED by removing the redundant handler, not by adding the
permission (`replica/proofs-fix-events.md` §3.6). `ziy-shields` DID add
`webNavigation` because its listener is the per-tab counter reset and cannot be
substituted (`:327-328`, pinned by
`extensions/ziy-shields/test/manifest.test.js:83-99`).

**DO** resolve a sibling lib's API lazily at call time. Manifest order puts
`lists.js` before `store.js`, so `lists.js` cannot read `ns.localGet` at
evaluation; the fix is `const getLocalGet = () => ns.localGet;`
(`replica/proofs-fix-events.md` §3.2).

---

## 9. The three most important patterns

1. **One classic global scope per extension.** Gecko writes every
   `background.scripts[]` entry into a single HTML document as a plain classic
   script (`replica/proofs-fix-events.md` §1, quoting
   `WebExtensionPolicy.cpp BackgroundPageHTML()`), so every lib is a UMD IIFE
   that declares nothing at top level, publishes onto one namespaced global,
   and mirrors names with literal `exports.NAME =` lines for node. The single
   exception is `ziy-sync`, whose libs are genuine ESM and
   shared with `native/` and `server/` — it is the only manifest with
   `"type": "module"` (`extensions/ziy-sync/manifest.json:13-17`).

2. **The storage split, per entity, with a letter-shifted key encoding.**
   `browser.storage.local` for small launch-critical state, IndexedDB per
   extension for the big queryable tables, native SQLite for anything the
   browser must not be able to read, opaque blobs on the server. Reading the
   engine's `storage.local` from outside requires the prefix-strip +
   letter-unshift reader in
   `tools/e2e/ziy-fix-shields-flows.py:100-175` and the `.`→`/` key rewrite.

3. **One implementation, bridged — never copied.** Crypto lives only in
   `extensions/ziy-sync/lib/` and is re-exported by
   `native/ziy-sync-agent/lib/ziy-crypto.js` and `server/lib/ziy-crypto.js`; the
   QR encoder lives only in `extensions/ziy-talk/lib/qrcode.js`; the native
   framing lives once per host because the two hosts' ops genuinely differ. The
   same discipline is why both native installers, both framing modules and the
   token mirror each say in their own header that they exist to avoid a second
   divergent copy in one product.
