# research-chrome-extension-import.md — Chrome extensions in Ziy: the requirement, the verdict, and the chosen path

**Status: decision record + spec. POST-LAUNCH backlog** — recorded 2026-10-16 at
the co-owner's request ("support both [Firefox and Chrome extensions]
natively"). Build starts only after `replica/deploy.md` §5's launch blockers
clear; nothing here may delay them. The engine decision is unchanged: Gecko by
configuration (`replica/deep-fork.md` §0).

---

## 1. The requirement, and the honest verdict

Requested: run **both** Chrome (CRX) and Firefox (WebExtension) extensions,
**natively**.

- **Firefox extensions: native, already true, nothing to build** — §2 has the
  evidence, all of it on disk today.
- **Chrome extensions, natively: not possible — and no browser in the world
  does it.** Chrome's extension runtime is part of Chromium (Blink); Firefox's
  is part of Gecko. Brave/Edge/Vivaldi (Chromium) run only CRX; Firefox (Gecko)
  runs only WebExtensions; Safari (WebKit) only its own. "Native both"
  literally requires either a **dual-engine product** (Gecko + Chromium
  compiled together — no company, big or small, ships this) or
  **reimplementing Chromium's extension system inside Gecko** (multi-year;
  contradicts the project thesis; needs the prohibited local engine compile).
- **What IS possible** is an import pipeline: a `.crx` is ZIP data, so it can be
  unpacked, its manifest transformed, API gaps shimmed in JS, and the result
  installed through the unsigned-sideload path Ziy already has. Coverage will
  be partial and must be **measured, never claimed**. That is the chosen path
  (§3).

## 2. Firefox extensions — what is already true (evidence)

| fact | evidence |
| --- | --- |
| any user-installable add-on type is allowed by policy | `shell/distribution/policies.json:74-85` — `"*": { "installation_mode": "allowed", "allowed_types": ["extension","theme","dictionary","locale","sitepermission"] }` |
| sideloading is not auto-disabled; all scopes enabled | `policies.json:381-396` — `extensions.installDistroAddons: true`, `autoDisableScopes: 0`, `sideloadScopes`/`enabledScopes: 15` |
| an unsigned xpi actually installs at runtime | `tools/verify.sh` §5 — "unsigned xpi was installed by the app dir (marker: `extensions.installedDistroAddon.ziy-selftest@ziy.test`)" → PASS |
| signing off, sideload on | the `omni.ja` byte patch; verify §1 — "omni.ja is patched (signing off, sideload on)" |
| MV2 and MV3 both supported | Gecko 156; MV3 uses `background.scripts` (no `service_worker` — bug 1573659, `replica/proofs.md`'s MDN table) |
| the one exclusion | `newtab@mozilla.org` blocked by policy (`shell/policies-gen.py:236-240`) — Ziy ships its own NTP |

**One runtime gap, stated:** installing a signed add-on from addons.mozilla.org
(the standard Gecko flow) is stock behaviour and was not separately re-proven in
this pass. The unsigned path above is the harder one, and it is proven. A future
pass can screenshot-proof an AMO install if the launch copy leans on it.

## 3. The chosen path: the CRX import pipeline (best-effort, measured) — the spec

All of it lives outside Gecko; none of it needs an engine compile.

1. **Ingest** — accept a `.crx` (CRX2/CRX3 = ZIP with a header). Validate the
   magic, extract, report what was read.
2. **Manifest transform** — map to Gecko:
   - MV3 `background.service_worker` → `background.scripts` (event page) plus a
     small keepalive shim for long-lived listeners;
   - strip keys and permissions Gecko rejects (`side_panel`, `offscreen`
     documents, `chrome.gcm`, `identity.getAuthToken`, …), **each strip recorded
     in a per-extension report the user can read** — never silent;
   - keep `declarativeNetRequest` where the semantics map; flag the rest.
3. **API shim** — the smallest honest support layer: `chrome.*` already aliases
   `browser.*` in Gecko; add JS polyfills only where emulation is genuinely
   equivalent (`chrome.storage.session`, `chrome.action` aliases, …).
   Unsupported APIs answer an explicit error, never a silent no-op.
4. **Install** — repack deterministically (`tools/lib/zpxi.py` already writes
   deterministic archives) and install through the proven unsigned path (§2),
   showing the user exactly what changed.
5. **Coverage measurement — the step that decides whether this ships.** Take the
   top ~100 Chrome Web Store extensions by installed count, load each in a
   throwaway profile, classify **loads clean / loads degraded / fails**, and
   publish the table. No coverage claim exists before that table exists.

## 4. Boundaries (non-negotiable)

- Product copy may never say "supports Chrome extensions". It is "import Chrome
  extensions (best-effort; some will not work)". Honesty rule; also the
  clean-room rule — no Chrome/Chromium branding anywhere shipped.
- No Chromium code, no engine fork, no `./mach` anything.
- The conversion is **local-only**: the user's machine transforming a file the
  user already has. No store scraping, no remote fetch of extensions by the
  browser. (That model is what killed "Chrome Store Foxified"; this design
  deliberately is not it.) Nothing converted is redistributed.
- This is **not** a launch blocker and may not delay one.

## 5. The rejected paths (recorded so they are not re-litigated)

- **Dual-engine (the literal "native both").** No shipping browser does this;
  it is a second product built beside Ziy. The co-owner's request is recorded
  here; the answer is §1.
- **Chromium's extension runtime inside Gecko.** Multi-year; contradicts
  "Gecko by configuration, not by patch"; needs the prohibited local compile.
- **Switching the product to Chromium.** Discards the entire Gecko-specific
  tree (the shell, the 9 extensions, the native helpers, the patch set, the
  sync, the proofs). Recorded and rejected.

## 6. Where this lives when it starts

- Prototype **outside** the product first (a `tools/` script + a throwaway
  support extension); merge only with the §3.5 coverage table and a clean-room
  check.
- The first prototype commit must reference this file. The spec above is the
  starting point, not a contract — deviations get written down here.
