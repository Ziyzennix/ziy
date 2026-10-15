# Repository Guidelines

A practical reference for AI coding assistants working in this repo. **Read
`replica/AI-BRIEF.md` first, always** — the standing rule, and the knowledge base for what
is present, decided, proven, and already gone wrong.

---

## Project Overview

**Ziy** is a privacy-first, Brave-feature-clone browser built **on the Gecko engine by
configuration, not by patch**: a branded Firefox 156.0.1 application directory
(`build/ziy/`), a profile Ziy owns (`~/.ziy/profiles/`), a nine-extension MV3
WebExtension suite, three native helpers (two Node, one Rust), and a blind sync server. Every product
decision traces to `replica/evidence.md`'s confidence classes, and every claim you make
must trace to `replica/proofs-<area>.md`. Parity: 60.4% of the deliverable row set,
must-rows 80.2% weighted (`replica/parity.md` §3).

**Product identity, one sentence:** a privacy-first browser on the Gecko engine that
reimplements Brave's user-facing features (shields, news, playlist, talk, sync, NTP,
password vault) clean-room from behaviour records — no competitor name, mark, or
trade-dress anywhere in shipped assets.

---

## Architecture & Data Flow

Four layers plus a server; each is independently testable and replaceable.

```
SHELL (build/ziy/)   application.ini · ziy.js + ziy-hardening.js prefs · mozilla.cfg
                     lockPrefs · distribution/policies.json · omni.ja + browser/omni.ja
                     byte patches · LICENSES.txt + patches/ (MPL notice) · ziy launcher · ziy.desktop · brand → hicolor icons
   ↓ profile bootstrap, distribution xpis
9 MV3 EXTENSIONS      event page (classic scripts) + UI pages + content scripts;
                     storage.local (small) · IndexedDB (big tables)
   ↓ nativeMessaging (JSON + UInt32LE length)
NATIVE HELPERS        ziy-sync-agent: BIP-39, Ed25519, all HTTP → chain.sqlite
                     ziy-pwd: credential vault, unlocked only in RAM → vault.sqlite
                     ziy-blocks: Rust adblock engine — verdicts only, no store (T1)
   ↓ HTTPS /v1/*, bearer chain-scoped tokens
SERVER (server/src)   blind store: one opaque blob per (chain_id, record_id), node:sqlite
```

**What data lives where** (`extensions/ziy-shields/lib/engine/store.js:1-9` and each
per-extension `store.js` header):

| store | contents |
| --- | --- |
| `browser.storage.local` | small, launch-critical settings + per-site rules: `shields.global`, `shields.lists`, `shields.site.<domain>`, `ntp.config`, `ntp.engines`, `news.sources`, `playlist.settings`, `talk.room`, `ziy.pwd.state` (state only — **no key material**), `ziy.sync.state` |
| IndexedDB (per extension) | big or queryable: `ziy-shields` (`rules`/`elements`/`sessions`), `ziy-news` (items/read/refresh), `ziy-playlist` (`items`/`meta`) |
| native SQLite | the credential vault (`~/.ziy/pwd/vault.sqlite`, passwords encrypted, origin/username plaintext) and the sync chain (`~/.ziy/sync/chain.sqlite`) |
| server SQLite | opaque encrypted blobs only — the server cannot read a record |

**Message flow, extension UI page → background event page → native host:** a UI page (`ui/popup.html` / `ui/options.html` / `ui/panel.html`) loads its classic `<script>` libs then calls `browser.runtime.sendMessage({op, …})`. The **background event page** — one shared classic scope built from `background.scripts[]` — dispatches on `switch (message.op)` with ops named `<area>.<verb>` (`extensions/ziy-shields/background/background.js:529-540`, `extensions/ziy-pwd/background/background.js:105-197`) and reaches `storage.local` / IndexedDB through the lib namespaces. For anything the browser must not see it calls `browser.runtime.sendNativeMessage("ziy-<host>", msg)`: the host frames it as UTF-8 JSON prefixed by an unsigned 32-bit LE length, max 1 MB (`native/ziy-pwd/lib/native-protocol.js`), dispatches from a single `Map`, and replies `{ok, op, ms, result}` — errors are answers, not crashes, and `safeMessage` strips paths/passphrases from reply text (`native/ziy-pwd/ziy-pwd.js:229-263`). `ziy-sync`'s host does all HTTP to `server/src/server.js`'s `/v1/*`; records are AES-256-GCM encrypted with AAD binding before they leave the box. Every host refuses any extension but its own (`native/ziy-pwd/lib/native-protocol.js:23`, `native/ziy-sync-agent/lib/native-protocol.js:22`, the argv guard in `native/ziy-blocks/src/main.rs`).

---

## Key Directories

| path | what lives there |
| --- | --- |
| `extensions/ziy-shields/` | the blocking engine: ABP/uBO parser, DNR rule compiler (static + webRequest residual tiers), per-site precedence, cosmetic hiding. Largest add-on. |
| `extensions/ziy-shell/` | product theme + first-run welcome page; owner of the generated `ui/tokens.css`. |
| `extensions/ziy-ntp/` | `chrome_url_overrides.newtab` — new-tab page, top sites, engine picker, backgrounds. |
| `extensions/ziy-news/` | sidebar panel + NTP news region; RSS/Atom/RDF/JSON-Feed parser, OPML, feed snapshots. |
| `extensions/ziy-playlist/` | media queue + player; content-script capture/classify, sidebar panel, options. |
| `extensions/ziy-talk/` | in-browser call panel; the one dependency-free QR encoder in the tree. |
| `extensions/ziy-sync/` | the E2E-encrypted sync chain; **the only ESM extension**, its libs shared with `native/` and `server/`. |
| `extensions/ziy-desktop/` | app menu, import/export, default-browser status, 8 keyboard commands. |
| `extensions/ziy-pwd/` | the native vault's UI; popup only, no options page, no fill path. |
| `tools/` | build + verify + bootstrap + launcher + e2e harnesses; `tools/lib/` holds the shared helpers (`common.sh`, `omni-ja.py`, `zpxi.py`, `gen-tokens.sh`, `cleanroom-scan.py`). |
| `shell/` | app-dir inputs: `application.ini`, pref defaults, `mozilla.cfg`, `policies-gen.py`, `preflight-prefs.py`, `ziy.desktop`, `brand-fallback/`, `omni.ja.patch/`, `extensions.list`. |
| `native/` | the three native hosts: `ziy-sync-agent` + `ziy-pwd` (Node ESM, each with its own `lib/`, framing module and tests) and `ziy-blocks` (Rust, adblock-rust; engine built by `tools/build-blocks-engine.sh`). |
| `server/` | the blind sync server: `src/server.js`, `src/store.js`, `lib/ziy-crypto.js`, `test/`. |
| `brand/` | the co-owner's master raster `ziy.png` (the app icon), `logo*.svg/png`, `mascot*.svg`, `MASCOT.md`, `README.md`. |
| `patches/` | five C++/configure patches (0001–0005) + `README.md` (the patch-set contract). All authored, none compiled. |
| `replica/` | the project's memory: `AI-BRIEF.md`, `proofs-*.md`, `parity.md`, `test-report.md`, `deploy.md`, the clean-room record. |
| `.github/workflows/` | `build-gecko.yml` only — the one permitted Gecko compile path (tag / dispatch only). |

Empty placeholder dirs at the root (`but/`, `chrome/`, `firefox/`, `not/`, `or/`) are
artifacts of the checkout path name, not build inputs.

---

## Development Commands

Run in this order. `build/`, `*.xpi`, `node_modules/`, `.ziy/` are gitignored
(`.gitignore`); nothing writes to the Firefox install or `~/.mozilla`.

```bash
# 0. get the tree. No git remote exists yet — `gh repo create` is the co-owner's action.
git clone <repo> ziy && cd ziy          # or unzip the tree (replica/compile-readiness.md §1)

# 1. unit tests for the whole extension suite (~1 min, 674 assertions)
npm test                                # = node --test extensions/*/test

# 2. build the app dir — this IS the product shell. --force is required once build/ziy exists.
./tools/build-shell.sh --force          # -> build/ziy/ (12 stages; verify.sh §1)

# 3. package the suite — one deterministic xpi per extension
bash tools/build-extension.sh --all     # BASH, not node; -> build/ziy/distribution/extensions/<id>.xpi
bash tools/build-extension.sh --check   # filename id vs manifest gecko.id agreement

# 4. create the profile the product owns (never ~/.mozilla)
python3 tools/bootstrap-profile.py      # -> ~/.ziy/profiles/default/

# 5. the full acceptance gate
./tools/verify.sh                       # or: npm run verify   (831 lines, 12 sections)

# 6. launch
./tools/ziy                             # boots ~/.ziy/profiles/default
./tools/ziy --profile work              # a different profile
./tools/ziy --headless -H URL           # headless, for scripts and CI

# 7. optional per-user desktop integration (idempotent; never touches /usr or defaults)
./tools/install-desktop.sh --dry-run && ./tools/install-desktop.sh

# 8. optional: the sync agent's native registration (probes the agent with a real message first)
node tools/install-ziy-sync-native.js --dry-run && node tools/install-ziy-sync-native.js

# 9. engine bump — re-point Ziy at a new Firefox and re-apply every patch a bump breaks
./tools/update-engine.sh --engine PATH --version NEW
```

Flags that matter: `build-shell.sh --force` (without it the script exits 0 with "already built" when `build/ziy/` exists — `tools/build-shell.sh:70-75`); `--engine PATH` / `--engine=PATH` / `ZIY_ENGINE=...` override discovery (`tools/lib/common.sh:31-43`). `build-extension.sh` also accepts bare DIRs and defaults to `--all`. `verify.sh --help` lists every filter (`--identity --boot --prefs --extensions --signing --suite --features --prefs-lock --native --desktop --all --keep-selftest`). `ziy --engine-help` is the engine's own `--help`; `--help` as the first arg prints Ziy's (`tools/ziy:135-145`). `bootstrap-profile.py --name X --root DIR --list`; `--reset` is destructive.

**Trap:** `npm run build:xpi` is `node tools/build-extension.sh --all`, which dies with `ERR_UNKNOWN_FILE_EXTENSION`. Use `bash tools/build-extension.sh --all`. Same for the regression suite: `bash replica/test/regressions.sh`, never `./`.

---

## Code Conventions & Common Patterns

### (a) The UMD IIFE classic-script pattern — the most important rule here

Gecko builds the event page by writing **every** `background.scripts[]` entry into one generated HTML document as `<script type="text/javascript" src=…>` unless `manifest.background.type === "module"` — quoted from `toolkit/components/extensions/WebExtensionPolicy.cpp BackgroundPageHTML()` at the shipped revision `6f2c158dfc…` (`replica/proofs-fix-events.md` §1). In that single shared scope: `import`/`export` → SyntaxError, file discarded; a 2nd top-level `const` of a name an earlier file owns → parse-time `redeclaration of non-configurable global property X`, file dropped and every listener dead; bare `module.exports` → `ReferenceError: module is not defined`.

So each lib file is an IIFE that declares **nothing** at top level, publishes onto the extension's one namespace, and mirrors each public name with a **literal** `exports.NAME = api.NAME;` (node's CJS lexer only reads literal assignments — a loop or `Object.defineProperty` does not work, `replica/proofs-fix-events.md` §2):

```js
(function (root, factory) {                    // extensions/ziy-shields/lib/engine/store.js:28-45
  "use strict";
  const ns = root.ziyShields || (root.ziyShields = {});
  const api = factory();
  Object.assign(ns, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.DB_NAME = api.DB_NAME;   // one literal line per public name
    exports.localGet = api.localGet;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  /* the whole body, nothing declared at the top level */
});
```

The background then reads that one namespace with one alias per module
(`extensions/ziy-shields/background/background.js:36-44`,
`extensions/ziy-pwd/background/background.js:34`,
`extensions/ziy-desktop/background/background.js:22`). Three consequences:

1. **Every lib file is listed BEFORE the background entry, and the background entry is
   LAST** — pinned by `extensions/ziy-shields/test/manifest.test.js:75-82`.
2. **Resolve a sibling's API lazily, at call time**, not at evaluation — the manifest lists
   `lists.js` before `store.js`, so `ns.localGet` does not exist when `lists.js` runs
   (`replica/proofs-fix-events.md` §3.2).
3. **Never assume a permission-gated namespace exists.** Without the `webNavigation`
   permission `api.webNavigation` is `undefined` → TypeError at top level
   (`replica/proofs-fix-events.md` D-3). `ziy-shields` declares it; `ziy-talk` dropped the
   redundant handler instead.

The one exception is `extensions/ziy-sync`, whose libs are genuine ESM shared outside the
extension — `"background": {"type": "module"}` (`extensions/ziy-sync/manifest.json:13-17`),
re-exported by `native/ziy-sync-agent/lib/ziy-crypto.js:9-15` and
`server/lib/ziy-crypto.js:9-11`. Audit before you ship:
`find extensions -name '*.js' -not -path '*/test/*' | xargs grep -n '^import \|^module\.exports' | grep -v 'ziy-sync/'` → must print nothing (`replica/proofs-fix-events.md` §6).

### (b) One implementation, bridged — never copied

- Crypto / BIP-39 / key derivation / record format live **only** in
  `extensions/ziy-sync/lib/`; the native host and the server `export * from` them rather
  than carry a copy. The QR encoder lives only in `extensions/ziy-talk/lib/qrcode.js` — do
  not add a second.
- `native-protocol.js` exists once **per host**, because the two hosts' ops genuinely
  differ — the documented exception, not an oversight.
- `native/ziy-pwd/lib/ziy-crypto.js` is deliberately separate from the sync crypto
  (PBKDF2-SHA512 600k + AES-256-GCM, because a vault key is re-derivable from a passphrase
  and a sync seed must not be). **Do not merge the two crypto layers.**

### (c) Naming (`replica/architecture.md` §8)

| concept | rule | instance |
| --- | --- | --- |
| product id | `ziy` | `package.json`, `extensions/ziy-<area>` |
| add-on id | `ziy-<area>@ziy.app` | all 9; source of truth `shell/extensions.list:13-21` |
| xpi filename | `<addon-id>.xpi` | the id is derived from the filename by `XPIProvider.sys.mjs`'s `getExpectedID()`, so filename = list = `policies.json` = native manifest |
| pref namespace | `ziy.<area>.*` | `ziy.shields.*`, `ziy.ntp.*` |
| message ops | `<area>.<verb>` from `switch (message.op)` | `shields.setSite`, `sync.now`, `pwd.unlock`. Exception: `ziy-talk` uses a `kind`-keyed `HANDLERS` map (`extensions/ziy-talk/background/background.js:142-151`) |
| native host | `ziy-<area>` / `ziy-<area>d` | `ziy-pwd`, `ziy-sync-agent` |

Cross-extension contract keys that must stay stable: `ziy.shields.blockedTotal` (shields
writes, NTP reads only — `extensions/ziy-ntp/lib/model.js:38-44`) and the sibling ids
`ziy-shields@ziy.app` / `ziy-news@ziy.app` used for messaging
(`extensions/ziy-ntp/lib/model.js:46-55`).

### (d) The design-token mirror

Single source of truth: `replica/design/tokens.json`, generated by
`tools/lib/gen-tokens.sh` into `extensions/ziy-shell/ui/tokens.css` (verified
byte-identical, 167 lines). **The fan-out is manual.** Seven copies exist: `ziy-shell` is
the *generated* file; `ziy-shields`, `ziy-news`, `ziy-playlist`, `ziy-talk`, `ziy-desktop`,
`ziy-pwd` are hand-copied mirrors whose headers say so
(`extensions/ziy-news/ui/tokens.css:1-7`). After a `tokens.json` change: re-run the
generator for the shell, then hand-copy `replica/design/tokens.css` into each extension's
`ui/tokens.css` (the NTP inlines the same roles into a `<style>` at
`extensions/ziy-ntp/ui/ntp.html:8-13`). `ziy-ntp` has no `tokens.css` by design. Never
hard-code a hex. `ziy-shell`'s manifest test asserts the
`GENERATED from replica/design/tokens.json` header so the file cannot be hand-edited
silently (`extensions/ziy-shell/test/manifest.test.js:52-54`).

### (e) The letter-shifted IndexedDB key encoding

`browser.storage.local` **is** IndexedDB, at
`storage/default/moz-extension+++<uuid>/idb/*.sqlite`, table `object_data`. A JSON scan of
the profile finds nothing even when the keys are present. Keys are stored with a one-byte
`0x30`-family prefix and every letter shifted **down** by one (`s` written as `t`); the
engine also writes the add-on's `.` keys as `/`, so `shields.global` is on disk as
`shields/global`. The reference reader is
`tools/e2e/ziy-fix-shields-flows.py` `read_storage_local_keys()` (`:100-175`), unshift at
`:127-135`, prefix strip at `:152-153`. Glob both `moz-extension+++<uuid>` and
`moz-extension+++<uuid>^userContextId=*`, and shut the browser down first so SQLite
checkpoints the journal (`:425-427`).

### (f) C++ patch conventions (`patches/README.md`)

Five patches, all `AUTHORED, NOT COMPILED`:

| patch | touches | delta |
| --- | --- | --- |
| `0001-rfp-colorscheme-carveout.patch` | `nsRFPService.cpp` | honours the shell's `+AllTargets,-CSSPrefersColorScheme` override, which RFP mode made dead code |
| `0002-ziy-fingerprinting-option.patch` | new `toolkit/ziy-fingerprinting.configure` + one `include()` in `toolkit/moz.configure` | declares `--enable-ziy-fingerprinting`; `configure_error()` if the gate and the shipped prefs disagree |
| `0003-webgpu-adapter-strings.patch` | `dom/webgpu/Adapter.cpp` | empties the four unguarded `GPUAdapterInfo` wgpu* strings under RFP |
| `0004-webgl-fake-extension.patch` | `dom/canvas/ClientWebGLContext.cpp` | appends one fake extension name under RFP, idempotently |
| `0005-dns-disable-prefetch-from-https.patch` | `netwerk/dns/nsDNSService2.cpp` | adds the missing consumer for `network.dns.disablePrefetchFromHTTPS` — the pref was registered, locked by the shell, and read by nothing |

Rules: ground the change in real engine source with line numbers **first**; generate the
diff with `diff -u --label a/… --label b/…` against a pristine copy (never `git diff` in a
dirty tree); prepend a commit header carrying the why and the citations; verify with
`git init && git add -A && git commit -qm base && git apply --check -v` against a real
extraction — *"a patch you have not checked against the real tree is not finished"*; prove
the gate-off path is byte-identical to pristine. Compilation happens **only** in
`.github/workflows/build-gecko.yml` (tag / `workflow_dispatch`); nothing may claim a patch
works at runtime. The `patches/README.md` index lists all five; none is compiled yet
— the first compile is a `build-gecko.yml` dispatch (see `replica/TODAY.md`).

---

## Important Files

| file | why you will open it |
| --- | --- |
| `replica/AI-BRIEF.md` | **READ THIS FIRST.** What is on the box, what is decided, what is proven, the 12 traps, the first-five-minutes guide. |
| `tools/build-shell.sh` | the 12-stage app-dir build; the single script that produces the product shell. |
| `tools/ziy` | the one launcher: app-dir resolution, profile bootstrap-on-demand, `--headless`, `--profile`, arg passthrough. |
| `shell/mozilla.cfg` | the `lockPref` layer — all locks, 11 sections, 97 pref calls. Every pref locked here must also have a default in `ziy.js`/`ziy-hardening.js` (enforced by the preflight). |
| `shell/policies-gen.py` | regenerates **and** schema-validates `shell/distribution/policies.json` against the engine's own `policies-schema.json`, extracted from `browser/omni.ja`. Run on every build. |
| `extensions/ziy-shields/manifest.json` | the reference manifest: 13-entry classic `background.scripts` array, 9 permissions, `host_permissions: <all_urls>`, DNR rule resource, both options entries. |
| `tools/verify.sh` | the acceptance gate (12 sections, 917 lines); its header documents the process-hygiene rules. |
| `patches/README.md` | the patch-set contract: format, the `git apply --check` gate, gate-off byte-identity, how to add one. |
| `shell/extensions.list` | the one source of truth for the 9 suite ids. |
| `tools/lib/cleanroom-scan.py` | the code-level clean-room guard. |

---

## Runtime/Tooling Preferences

- **node v26.10.0** (`~/.local/opt/node-v26.10.0-linux-x64/bin/node`). No framework —
  `node:test` + `node:assert/strict`. **Zero npm dependencies** anywhere: the root
  `package.json` has no `dependencies`/`devDependencies` (npm workspaces only), and the
  only imports in `server/`, `native/` and the shipped extension libs are `node:`
  builtins. No lockfile exists and none is needed — `npm test` works without one
  (`npm ci` in `replica/deploy.md` is aspirational).
- **python3 3.12** with `Pillow` 10.2 (and `jsonschema`, installed lazily by
  `policies-gen.py`). No pip/uv-managed project deps; `zbar` is **not** installed, so the
  QR proof cannot be re-run without it.
- **Firefox 156.0.1 at `/usr/lib/firefox`** is the engine (`/opt/firefox`,
  `/usr/local/firefox`, then any `firefox*` dir as fallbacks; `tools/lib/common.sh:31-43`).
  The tree never writes to it — `build-shell.sh` does `cp -a` and modifies the copy, never
  a symlink.
- **Network is ~1 MB/s.** Resumable `curl -C - --retry 40 --retry-delay 2
  --retry-all-errors` only; never plan a fresh 800 MB fetch; never start a second download
  while one is in flight; verify the sha512 you were given
  (`replica/AI-BRIEF.md` §5 rule 12).
- **No local Gecko compilation. Ever.** No `./mach build`, no `./mach configure`, no
  `autoconf`, no rustc/cargo Gecko builds, no ccache-heavy jobs — not occasionally, not
  "just once for a proof", not in the background (`replica/deep-fork.md` §0, co-owner
  decision). CI or a co-owner-registered self-hosted runner only. Light work is fine:
  `git apply` on `/tmp` copies, byte-level omni.ja patching, pref/layer checks,
  `tools/build-shell.sh`. Anything above ~60 s of sustained CPU needs `nohup` +
  `nice`/`ionice` and a declared report line. The box is 4 cores / ~3.4 GiB available, and
  the `libxul` link alone is a ~5 GB process.

---

## Testing & QA

### The unit suite

`npm test` runs `node --test extensions/*/test` — **674 assertions, 0 fails** (re-measured
2026-10-16). The trailing `/` makes the glob tolerant of an extension with no `test/` dir.
Per-extension `package.json` adds `"test": "node --test test/"` and `"type":"commonjs"`;
`ziy-shell`/`ziy-sync` have none but are still swept by the glob. `server/` and `native/*`
are outside it (ESM suites) — run them by path.

| area | command | tests |
| --- | --- | --- |
| `extensions/ziy-shields/test` | `node --test extensions/ziy-shields/test` | 176 |
| `extensions/ziy-talk/test` | `node --test extensions/ziy-talk/test` | 98 |
| `ziy-news` / `ziy-playlist` | `node --test extensions/ziy-<name>/test` | 83 each |
| `extensions/ziy-ntp/test` | `node --test extensions/ziy-ntp/test` | 81 |
| `extensions/ziy-sync/test` | `node --test extensions/ziy-sync/test` | 52 |
| `extensions/ziy-desktop/test` | `node --test extensions/ziy-desktop/test` | 27 |
| `extensions/ziy-pwd/test` | `node --test extensions/ziy-pwd/test` | 19 |
| `extensions/ziy-shell/test` | `node --test extensions/ziy-shell/test` | 10 |
| `server/test` | `node --test server/test` | 18 (~11 s since the WAL pragma; fsync-bound 47–120 s before) |
| `native/ziy-pwd/test` | `node --test native/ziy-pwd/test` | 35 (~23 s) |
| `native/ziy-sync-agent/test/` | — | empty dir; covered by `tools/e2e-ziy-sync.sh` + `agent-driver.py` |
| `native/ziy-blocks/test` | `node --test native/ziy-blocks/test` | 13 (real binary over a real pipe; builds its artifacts on demand) |

**These counts must not drop.** A change that narrows a suite must restore the coverage or
record exactly what is no longer asserted, and why, in the proof doc. Shields is the
sensitive row: its 176 include the static-matcher pinning that is the only thing between
D-7 returning and a panel silently reporting `blocks=0`.

### The acceptance gate — `tools/verify.sh`

`./tools/verify.sh` (or `npm run verify`). One line per check (`PASS`/`FAIL`/`SKIP` plus
evidence), exits non-zero on any FAIL; `--help` lists every section filter, `--features`
etc. run one at a time. Documented baseline (`replica/deploy.md:96-108`): **46 passed,
0 failed, 1 skipped, exit 0**. The live run on 2026-10-15 recorded **45 passed, 0 failed,
2 skipped**; re-run the gate before drawing a conclusion from a SKIP.

1. **`--version does not say Ziy`** — 156 does not remap `--version` from `App:Name` alone
   (`tools/verify.sh:138-140`). Deterministic; sections 1 and 3 prove identity another way
   (app-dir boot, branded screenshot).
2. **`playlist panel probe did not complete`** — the staged panel's media element reported
   `readyState 0, duration None`; headless media did not decode. The same
   environment/headless-media flakiness already recorded as F27 PARTIAL in
   `replica/test-report.md` (an earlier run on the same box printed `played 0.284s of
   0.333s … ALL ASSERTIONS PASSED`). **Not a product regression** — re-run before
   concluding the player is broken.

### The BiDi e2e harness route

`tools/e2e/*.py` boot a throwaway profile under `/tmp/ziy-*` with `MOZ_MARIONETTE=1 MOZ_DISABLE_SAFE_MODE=1 MOZ_CRASHREPORTER_DISABLE=1`. Firefox's remote protocol is **WebDriver BiDi** at `ws://127.0.0.1:PORT/session` (plus `--marionette` on 2828), **not** Chrome CDP. Two engine limits constrain everything (`replica/test-report.md` route table): (1) `browsingContext.navigate` **refuses** `about:newtab` and every `moz-extension://` URL (`unsupported operation`), `location.href` assignment is denied to script, `browsingContext.create` with a url lands on `about:blank`, and `webExtension.moz:listExtensions` reports `unknown command`; (2) a `file://` or `about:blank` page has **no `browser.*` / `chrome.*` API at all**. So there are exactly two honest routes, and every tool states which it used:

- **iframe-child-context** — a `file://` page with `<iframe src="moz-extension://<uuid>/ui/debug.html">` loads the add-on's real document on its real origin as its own browsing-context child, scriptable over BiDi. Requires the page in `web_accessible_resources` (`extensions/ziy-shields/manifest.json:82-90`).
- **staged `file://` copy with one shim** — a byte copy of shipped `ui/`+`lib/` plus one added `<script src="../lib/shim.js">`. Proves the **surface, not the install**; every tool's docstring says so. Never describe it as the add-on origin.

`ziy-fix-shields-ops.py` is the deliberate **negative control**: the same ops from a page with no `browser.*` — a defect *of the probe*, not the product. Regression suite: `bash replica/test/regressions.sh [all|shields-runtime|shields-blocking|f01-first-run|f20-sync|--list]` — cheapest-first, exit 0 = all PASS. Last recorded run 5 passed / 4 failed / 0 blocked, which predates the D-1…D-4 fixes; `shields-runtime` passes since, while `f01-first-run` still fails *as written* (it greps for `welcome.html`, which a headless `about:blank` boot never writes). Re-run before trusting either number.

### Process hygiene — the rule that must never break

**Bare-word `pkill` nearly killed the user's LibreOffice. Twice.** The project path contains `brave`, so a broad `pkill` pattern matches the user's own apps. Throwaway profiles only (`--profile /tmp/ziy-<purpose>`); `MOZ_CRASHREPORTER_DISABLE=1` on every launch; **match first, kill by PID, never a bare `pkill`** — use `pgrep -f '/tmp/ziy-.*profile'` and kill only those PIDs, via `ziy_pids_of` / `ziy_kill_throwaway` (`tools/lib/common.sh:45-75`). `tools/verify.sh:80-83`'s EXIT trap only ever calls `ziy_kill_throwaway '/tmp/ziy-.*profile'`, and its last check proves the harness never came near a user session (`tools/verify.sh:815-819`). Every Python probe carries the same byte-identical `cleanup()` (`tools/e2e/ziy-talk-panel.py:117-131`).

---

## The Operating Rules

1. **Never fabricate.** Every claim traces to a command and its output; **"unverified" is a
   valid answer** and belongs in the doc rather than smoothed over
   (`replica/proofs-ntp.md`, `replica/proofs-cpp-privacy.md` §1, `patches/README.md` step 1).
2. **Always leave a note.** Every change or deletion records why plus a pointer to the proof
   doc; contradicted claims are **struck through in place**, never deleted, and a deletion
   leaves a comment naming the reason and the evidence
   (`replica/evidence.md`, `replica/proofs-fix-prefs.md` §4).
3. **No user-requested features.** Parity rows only. Reviews (`fixes.md`, `reviews.csv`)
   **can deprioritize, never add**; the 14 `user feedback` rows are research backlog, not a
   build request (`replica/AI-BRIEF.md` §3, `replica/parity.md` §3).
4. **The cut list is final.** AI assistant (Leo), crypto wallet, rewards/ads economy (BAT,
   notification ads, sponsored backgrounds), VPN, and the wallet sidebar — cut, not
   deferred, not partial. 36 `cut` + 12 `skip` rows
   (`replica/fixes.md` §1.1/§1.5, `replica/parity.md` §1).
5. **Process hygiene.** Throwaway `/tmp/ziy-*` profiles, anchored kills only — the project
   path contains `brave` (`tools/lib/common.sh:47-52`, `replica/AI-BRIEF.md` §5 trap 1).
6. **`/tmp` is reboot-volatile.** A 2026-10-15 reboot wiped `/tmp/firefox-src`,
   `/tmp/brave-src`, `/tmp/ziy-apply-test` and the whole profile set. Anything worth keeping
   must be consumed into `replica/` or moved into the tree; check whether the engine source
   is still there before assuming it is (`replica/AI-BRIEF.md` §5 rule 12).
7. **No local Gecko compilation. Ever.** CI or a registered self-hosted runner only
   (`replica/deep-fork.md` §0).
8. **Docs over guessing.** Read the engine source / MDN / official docs before iterating; a
   claim may rest on a direct grep/read of the source, or be marked unverified
   (`replica/architecture.md` §1.3, `replica/proofs-shell.md` §1.6).

---

## Product Decisions You Must Not Undo

- **The co-owner's cat is the app icon.** `brand/ziy.png` — the master raster, byte for
  byte, no conversion, no resample — is copied into every size slot by
  `shell/brand-fallback/render-icons.py` (`:33-43`) and installed by
  `tools/build-shell.sh:112-123`; its palette is measured natural ginger
  (`brand/MASCOT.md`: 90.6% of opaque pixels warm-ginger). **The teal rule binds the brand
  MARK only** — `brand/logo.svg`, the toolbar icons, the extension glyphs, the hicolor
  entries — and **never the cat**; a teal-recoloured cat was a mistake and is retired.
- **The shield is the shields-extension glyph and the browser-chrome mark.** The cat
  carries identity (app icon, welcome, about); the shield carries function (toolbar,
  shields state). The cat must never be a second app icon, a toolbar icon, any
  `manifest.json` `icons{}` entry, a favicon, a notification/permission icon, or a state
  indicator. Alt text names the cat fresh; decorative-only surfaces are `aria-hidden`.
  Mascot rules: `brand/MASCOT.md` — personality surfaces only (welcome, about,
  empty/loading states), never a functional glyph.
- **Google is the default search engine**, with the multi-engine picker fully intact.
  Shipped code already agrees — `DEFAULT_ENGINE_ID = "google"`
  (`extensions/ziy-ntp/lib/model.js:146`) with a comment saying why it ships, and the
  fallback list carrying `google` / `duckduckgo-html` / `startpage` / `searx-be` /
  `wikipedia` / a user-editable own-provider slot (`:99-137`). No Ziy-hosted provider and
  no index of our own. (The decision was Google while the code said DuckDuckGo; if you
  still find `duckduckgo` as the default anywhere, the fix is in flight — land it rather
  than reverting it.)
- **The clean-room guard is absolute.** No competitor name, mark, silhouette, or
  trade-dress in any shipped asset, title, `aria-label`, or user-visible string
  (`replica/design/icon.md` §3/§4.9). Banned literals: `Brave`, `Google Chrome`,
  `Chromium`, `Mozilla Firefox` — enforced by `tools/lib/cleanroom-scan.py` over
  `extensions/`, `shell/`, `tools/` (comments stripped on purpose, because a clean-room
  record *explains* its divergences) and by `tools/verify.sh` §12 for manifests, the
  `.desktop` visible fields, and shipped SVGs.

---

## Before You Start

1. **Read `replica/AI-BRIEF.md`.** Then read the one proof doc for your area
   (`replica/proofs-<area>.md`) and `replica/architecture.md` if you are touching structure
   or naming.
2. **Check the asset table in `replica/AI-BRIEF.md` §2 before downloading anything.** If the
   asset is present, reuse it; if it is absent, read the document named in §2.2 that
   outlived it *before* re-fetching — the knowledge may make the bytes unnecessary.
3. **Read the relevant proof doc and the shipped code before editing it.** Do not iterate
   by guessing, and do not re-prove what a proof doc already shows (`replica/AI-BRIEF.md` §4).
4. **Run the area's suite before and after your change:** `node --test extensions/<area>/test`,
   `npm test` for the whole suite, and `node --test server/test` /
   `node --test native/ziy-pwd/test` (the blocking host's `node --test native/ziy-blocks/test` too) separately.
5. **Use throwaway profiles and anchored kills** — `--profile /tmp/ziy-<purpose>`,
   `MOZ_CRASHREPORTER_DISABLE=1`, then `pgrep -f '/tmp/ziy-<purpose>-profile'` and kill
   only those PIDs. Never a bare `pkill`.

Finally: write your findings into `replica/` — a `proofs-<area>.md` entry, plus an
`evidence.md` / `parity.md` update if a row moved — so the next worker inherits them. That
is the co-owner's rule this document exists to serve.
