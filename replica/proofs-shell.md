# proofs-shell.md — the verified mechanisms for the Ziy shell slice

Workstream 1 of the replica build: the shell (app dir, prefs/locks, branding,
launcher, profile bootstrap, verify harness). Every claim below was exercised on
this machine, Linux Mint, 2026-10-14, against the installed Firefox **156.0.1**
at `/usr/lib/firefox`.

Companion documents: `architecture.md` (the design), `proofs.md` (the engine
facts the design rested on). This file is the record for *this* workstream, so a
future reader can re-run what we ran and see why the shell looks the way it does.

---

## 1. Commands run, and what they produced

### 1.1 The omni.ja container format

The first thing that had to be true: we can read and rewrite `omni.ja` without
Python's `zipfile` refusing it. It is a zip wrapped in a 4-byte envelope.

```
$ python3 -c "d=open('/usr/lib/firefox/omni.ja','rb').read(); print(d[:4].hex(), d.find(b'PK\x05\x06'), d.rfind(b'PK\x05\x06'))"
0d7fd600 252208 46063977
```

| what | value |
| --- | --- |
| envelope prefix | `0d 7f d6 00` (4 bytes) |
| central directory | starts at byte **4**, length `cd_size` |
| EOCD | at `4 + cd_size` (here `252208`) |
| member data | after the EOCD |
| local-header offsets in the central directory | **absolute file offsets**, not relative to a zip base |

Two EOCD records exist in the file; the second (`46063977`) is the one a
`rfind` finds first, and it is *not* the one whose `cd_size` ends at its own
position. The patcher therefore scans every `PK\x05\x06` candidate and keeps the
one whose central directory both ends at the EOCD and begins with `PK\x01\x02`.

**Verified:** `shell/omni.ja.patch/patch-omni.py` parses both `omni.ja`
(2579 entries) and `browser/omni.ja` (5351 entries) with the same code.

### 1.2 The two signing constants live only in the JS module

$ strings -a /usr/lib/firefox/firefox-bin | grep MOZ_REQUIRE_SIGNING   # (0 matches)
$ strings -a /usr/lib/firefox/libxul.so   | grep MOZ_REQUIRE_SIGNING   # (0 matches)
```

From `omni.ja` → `modules/AppConstants.sys.mjs`:

```
  MOZ_REQUIRE_SIGNING: true,
  MOZ_UNSIGNED_APP_SCOPE: false,
  MOZ_UNSIGNED_SYSTEM_SCOPE: false,
  MOZ_ALLOW_ADDON_SIDELOAD: false,
```

Entry metadata: `method 0` (stored), `csize 6084`. Stored is the precondition
for a same-length rewrite.

**Source read:** the central directory is parsed by hand in
`shell/omni.ja.patch/patch-omni.py::locate_central_directory`.

### 1.3 The patch, and the CRC it must rewrite

```
$ python3 shell/omni.ja.patch/patch-omni.py /usr/lib/firefox/omni.ja /tmp/test-patched.ja
patch-omni.py: /usr/lib/firefox/omni.ja -> /tmp/test-patched.ja
  patched        modules/AppConstants.sys.mjs
  member offset  356781  size 6084
  bytes changed  109 (byte-length preserving)
  member CRC     0xa0d70a0a -> 0xd0c615c8
  zip entries    2579, file size 46063999
  MOZ_REQUIRE_SIGNING is now false; MOZ_ALLOW_ADDON_SIDELOAD is now true
```

`true` and `false` differ in length, so neither flip is length-preserving alone:
signing goes +1 byte, sideload goes −1 byte, and they cancel. The script asserts
`len(patched) == len(source)` and refuses to write otherwise.

**The CRC is not optional.** The first version of the patcher left the stored
CRC alone and the verification pass caught it:

```
patch-omni.py: verification: stored CRC 0xa0d70a0a != recalculated 0xd0c615c8;
the central directory would be lying about the patched member
```

A stored member's CRC-32 has to be rewritten in **both** the central-directory
header (offset `+16` in the 46-byte header) and the local file header (offset
`+14` in the 30-byte header). Both are fixed-position 4-byte fields, so rewriting
them cannot move anything.

Re-read from the written file:

```
  MOZ_REQUIRE_SIGNING: false,
  MOZ_ALLOW_ADDON_SIDELOAD: true,
crc ok: True      local-hdr CRC == central-dir CRC: True      same size: True
```

**Length-changing patches are not a near miss, they are fatal.** A byte-shifted
rewrite makes the engine refuse to start, which is worth recording because it
looks nothing like a patch failure:

```
$ # same file, but the member grew by one byte
*** You are running in headless mode.
The installation seems to be incomplete.
Please check your hardware and disk setup
and/or re-install.
```

**Precondition failure path, exercised deliberately:**

```
$ python3 shell/omni.ja.patch/patch-omni.py /tmp/test-patched.ja /tmp/test-twice.ja
patch-omni.py: PRECONDITION FAILED: modules/AppConstants.sys.mjs does not contain
'MOZ_REQUIRE_SIGNING: true,'. Either omni.ja is already patched ...
$ echo $?
1
```

### 1.4 `browser/defaults/preferences/` and `distribution/` load paths

`nsXREDirProvider.cpp` (read from the Firefox source, not guessed):
`kAppendPrefDir = {"defaults", "preferences"}` is appended to `mXULAppDir`
unconditionally, and `XRE_APP_DISTRIBUTION_DIR = GetFile(NS_GRE_DIR) +
"distribution"`. The behaviour confirms both:

```
# after booting build/ziy with a throwaway profile:
$ grep distribution.iniFile /tmp/ziy-v-b/prefs.js
user_pref("distribution.iniFile.exists.appversion", "156.0.1");
user_pref("distribution.iniFile.exists.value", true);      # our distribution.ini was read
```

Note the invariant that makes local verification honest: a `defaultPref()` (or
`pref()` in a defaults file) **never appears in `prefs.js`**. That is documented
behaviour in `proofs.md` fact 2 and it is why §4.3 checks values through
`user.js` instead.

### 1.5 Autoconfig (`mozilla.cfg`)

**Docs read:** Mozilla's Autoconfig mechanism, described in the enterprise
Firefox docs and the long-standing MIT autoconfig write-up
(<https://web.mit.edu/~firefox/www/maintainers/autoconfig.html>), which states
the two required prefs and the "callfile" pattern:

```
pref('general.config.obscure_value', 0);   # 0 = plain text, not ROT13
pref('general.config.filename', 'firefox.cfg');
```

**What it told me:** the `.cfg` must live at the GRE root and be world-readable;
`obscure_value` must be `0` for the file to be plain text.

**Engine-side check.** The registered `general.config.*` prefs on this build are
exactly four:

```
$ strings -a /usr/lib/firefox/libxul.so | grep '^general\.config'
general.config.filename
general.config.obscure_value
general.config.sandbox_enabled
general.config.vendor
```

`general.config.sha256` — a hash-verification pref — **does not exist** on this
engine. So there is nothing to hash: `mozilla.cfg` is referenced by filename only,
which is what the standard mechanism does. The task asked for the hash form if
available; the engine does not offer it, and this is the reason.

**The helper functions are real on this build.** `omni.ja` ships
`defaults/autoconfig/prefcalls.js`, which defines `pref`, `defaultPref`,
`lockPref`, `unlockPref`, `getPref`, `clearPref`, `getenv`, `displayError` and
exports them into the autoconfig sandbox. `lockPref` there is:
`defaultPref()` then `prefBranch.lockPref()`.

### 1.6 The crash that cost the most, and what actually caused it

The build initially hung/crashed on launch with:

```
Crash Annotation GraphicsCriticalError: |[0][GFX1-]: RenderCompositorSWGL failed
mapping default framebuffer, no dt
```

The symptom is in the graphics compositor, so the first assumption is "the omni.ja
patch". That assumption is **wrong**, and two experiments disprove it:

```
# clean Firefox tree + the build's patched omni.ja only
$ (cd /tmp/bisect/stage3 && ./firefox --headless=new --profile /tmp/zt4 --screenshot /tmp/zt4.png about:blank)
rc=0  5763 bytes
```

```
# the real build/ziy with mozilla.cfg removed
$ mv build/ziy/mozilla.cfg /tmp/held.cfg && ./build/ziy/firefox --headless=new ... about:blank
rc=0  5763 bytes
```

**Read the engine's own source rather than bisecting prefs.**
`modules/FingerprintingWebCompatService.sys.mjs` inside `omni.ja`:

```js
this.#importPrefOverrides();
...
#importPrefOverrides() {
    this.#granularOverrides.clear();
    for (const [pref, isBaseline] of [
      [lazy.baselineGranularOverridesPref, true],
      [lazy.granularOverridesPref, false],
    ]) {
      let overrides;
      try {
        overrides = JSON.parse(pref || "[]");
      } catch (error) {
        lazy.logConsole.error(`Failed to parse granular override JSON string: Not a valid JSON.`, error);
        return;
      }
```

with the schema it then validates against:

```
required: ["firstPartyDomain", "overrides"]
overrides:         string, pattern ^[+-][A-Za-z]+(?:,[+-][A-Za-z]+)*$
firstPartyDomain:   string, pattern ^(\*|(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,6}$
```

and the pref names:

```js
const PREF_GRANULAR_OVERRIDES = "privacy.fingerprintingProtection.granularOverrides";   // JSON ARRAY
const PREF_GRANULAR_OVERRIDES_BASELINE = "privacy.baselineFingerprintingProtection.granularOverrides";
const PREF_REMOTE_OVERRIDES_ENABLED = "privacy.fingerprintingProtection.remoteOverrides.enabled";
```

**What it told me:** the two override prefs have *different value types*.
`.overrides` takes the bare `+Target,-Target` string; `.granularOverrides` takes a
**JSON array of objects**. We had put `true` into `.granularOverrides`.

The mechanism from "wrong value" to "graphics crash": the prefs service refuses
a value the consumer rejects, a refused write inside autoconfig aborts the rest of
the file, and the resulting half-configured engine dies in the compositor. Nothing
in the error message points at prefs.

| controlled experiment | cfg contents | result |
| --- | --- | --- |
| `e` | `fingerprintingProtection.enabled` | ok |
| `p` | `fingerprintingProtection.pbmode` | ok |
| `g` | `fingerprintingProtection.granularOverrides` = `true` | ok alone |
| `eg` | `enabled` + `granularOverrides` = `true` | **crash** |
| `eg` (correct JSON) | `enabled` + `granularOverrides` = `[{...}]` | ok |

The fix, applied in all three files:

```js
lockPref("privacy.fingerprintingProtection.overrides",
         "+AllTargets,-CSSPrefersColorScheme");                       // string
lockPref("privacy.fingerprintingProtection.granularOverrides",
         "[{\"firstPartyDomain\":\"*\",\"overrides\":\"+AllTargets,-CSSPrefersColorScheme\"}]");
                                                                     // JSON array
```

**Now guarded at build time** by `shell/preflight-prefs.py`, which parses the
three pref files, checks JSON-valued prefs really parse, checks the target-string
grammar, checks the hardening set agrees with the locks, and refuses conflicting
values across layers. Regression proof — the same bug re-introduced:

```
$ # mozilla.cfg with granularOverrides = true
$ python3 shell/preflight-prefs.py
preflight-prefs.py: the pref layer is NOT self-consistent

  mozilla.cfg:46: privacy.fingerprintingProtection.granularOverrides must be a quoted JSON array, got true
$ echo $?
1
```

`tools/build-shell.sh` runs it before anything boots, so this cannot recur
silently.

### 1.7 The app dir boots as our own product

```
$ ./tools/build-shell.sh --force
  engine     /usr/lib/firefox (Mozilla Firefox 156.0.1)
  copy       /usr/lib/firefox -> .../build/ziy
  install    browser/application.ini (Ziy app id)
  preflight  pref layer consistency + known value shapes
  patch      omni.ja: MOZ_REQUIRE_SIGNING true->false, ...
          member offset  356781  size 6084
          bytes changed  109 (byte-length preserving)
          MOZ_REQUIRE_SIGNING is now false; MOZ_ALLOW_ADDON_SIDELOAD is now true
        re-verified from build/ziy/omni.ja on disk:
          MOZ_REQUIRE_SIGNING: false      in modules/AppConstants.sys.mjs
          MOZ_ALLOW_ADDON_SIDELOAD: true  in modules/AppConstants.sys.mjs
  install    distribution/policies.json (validated against the engine schema)
policies-gen.py: wrote .../shell/distribution/policies.json (12517 bytes), validated against /usr/lib/firefox/browser/omni.ja
  ok  build complete
```

Headless boot of the built app dir, twice, both clean:

```
run a: png=3158 crash=0 err=0
run b: png=3158 crash=0 err=0
```

Screenshot proof of branding (Pillow, on `build/verify/ziy-probe.html`):

```
brand violet #26118F pixels: 474804
wordmark white pixels:       4567
=> branding proven: True
```

`about:policies` renders 60 619 bytes / 1071 distinct colours, against
5 763 bytes / 1 colour for `about:blank`, so the policy page has real content —
and `prefs.js` gains `user_pref("browser.policies.applied", true);`.

## 2. What does NOT work, and why — reported, not hidden

| claim | status | evidence |
| --- | --- | --- |
| `--version` says `Ziy` | **does not work** | `./build/ziy/firefox --version` → `Mozilla Firefox 156.0.1`. `App:Version` in `application.ini` is the engine version, and `libxul` does not remap `--version` from `App:Name`. Identity is proven instead by (a) the app-dir boot, (b) `distribution.iniFile.exists*` markers written under Ziy's own distribution, (c) `about:policies` content, (d) the branded screenshot. The acceptance criterion's fallback ("or about: content proves branding") is the path used. |
| `general.config.sha256` | **not available** | no such pref in this engine (§1.5); referenced by filename, the standard mechanism |
| `privacy.resistFingerprinting` locked by policy | **cannot be done** | the policy `Preferences` `allowedPrefixes` list in `modules/policies/Policies.sys.mjs` contains `privacy.fingerprintingProtection` and `privacy.baselineFingerprintingProtection` but **not** `privacy.resistFingerprinting`. So RFP itself is locked in `mozilla.cfg`; the fingerprintingProtection branch is locked in `policies.json`. Both layers, deliberately per §5.4's "policies for what must be locked". |
| `datareporting.*` locked by policy | **partly cannot** | same prefix list only allows `datareporting.policy.`; so `datareporting.healthreport.uploadEnabled`, `datareporting.usage.*` are locked in `mozilla.cfg` and handled by the `DisableTelemetry` policy, which is the documented vehicle for them. |
| `about:home` / `about:newtab` headless screenshot | **does not work** | inherited from `proofs.md` fact 9; the boot check screenshots `about:blank` and a `file://` probe page instead |
| `--CreateProfile` headless on our binary | **does not work** | `proofs.md` fact 8; drives `tools/bootstrap-profile.py` creating the profile skeleton itself |

## 3. Docs read, and what each one told me

| source | what it told me |
| --- | --- |
| <https://mozilla.github.io/policy-templates/> | the `policies.json` format and the Linux path (`firefox/distribution`), that extra keys act as comments but produce an `about:policies` error (so the file is generated without extras), and the `ExtensionSettings` shape |
| <https://firefox-admin-docs.mozilla.org/reference/policies/preferences/> | the `Preferences` policy's `Value`/`Status`/`Type` semantics (`default`, `locked`, `user`, `clear`) and the exact `Status` list — that `locked` changes the default and blocks the user |
| <https://web.mit.edu/~firefox/www/maintainers/autoconfig.html> | the two `general.config.*` prefs, `obscure_value=0` for plain text, the callfile pattern, that the `.cfg` must be world-readable |
| `modules/policies/policies-schema.json`, extracted from `browser/omni.ja` of the **installed engine** | the authoritative key names and value shapes. `shell/policies-gen.py` validates the generated file against this exact schema with `jsonschema`, so `policies.json` is schema-valid rather than merely plausible |
| `modules/policies/Policies.sys.mjs`, same archive | the `Preferences` policy's `allowedPrefixes` / `blockedPrefs` lists, and `PoliciesUtils.setDefaultPref`'s in-memory-only semantics |
| `modules/FingerprintingWebCompatService.sys.mjs`, same archive | §1.6 in full: the JSON-array requirement that caused the crash |
| `defaults/autoconfig/prefcalls.js`, same archive | the definitions of `pref`/`defaultPref`/`lockPref` the `.cfg` calls |
| `chrome/en-US/locale/branding/brand.properties`, same archive | the brand keys (`brandShortName`, …) a product owns |
| <https://wiki.mozilla.org/Distribution_INI_File> | the `[Global]`/`[Preferences]` sections of `distribution.ini` |
| MDN / Firefox release notes (via `proofs.md`) | MV3 API coverage facts the suite will rely on |

## 4. Product decision: the assistant feature is cut

The AI-assistant feature the recon recorded in the original browser was cut
from the product on 2026-10-14. Everything that belonged to it is gone with it:
the extension module and its add-on id, its `ziy.*` pref namespace, and its
entry in `shell/extensions.list` — the suite is now eleven ids, and
`policies.json` declares exactly those eleven. The recon record of the original
app's assistant is untouched in `replica/recon.md`; that is history, not a plan.

The `ExtensionSettings` entries in `policies.json` are still generated by
`shell/policies-gen.py` from `shell/extensions.list`, so the id is declared in
one place and consumed everywhere. `shell/preflight-prefs.py` asserts the prefs
layers agree, and it now reports **178 declared prefs** (was 181, before the
assistant's three feature flags were removed).

## 5. Reproducing

```bash
./tools/build-shell.sh --force        # -> build/ziy, with the patch + preflight
./tools/bootstrap-profile.py -v       # -> ~/.ziy/profiles/default
./tools/verify.sh                      # the acceptance harness, throwaway profile only
./tools/ziy --headless -H              # launch with our profile
```

`tools/verify.sh` is the acceptance harness for this slice. It never launches a
browser without an explicit `--profile /tmp/ziy-*` and it only kills processes
matched by the anchored pattern `/tmp/ziy-.*profile`, so the user's own Firefox
and LibreOffice sessions are never selected.
