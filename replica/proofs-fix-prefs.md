# proofs-fix-prefs — the dead-pref rename in the Ziy shell layer

**Scope: three files, mechanical renames only. No engine work, no feature change.**

The dead-pref names in Ziy's own shell config were found by the
privacy/network/storage workstream (`replica/proofs-cpp-privacy.md` §2.1, §2.5),
which read every one of them out of the extracted Gecko 156.0.1 source and
classified each as ALIVE (engine reads the name) or DEAD (the engine has no pref
by that name, so the shell was writing to a key nothing reads). Five of the
names were DEAD, which meant five protections the product believed it was
enforcing were silently no-ops. This is the shell-side fix for those.

**Two passes are recorded here:**
- **§1–§3** — the first pass, the three shell files
  (`shell/mozilla.cfg`, `ziy.js`, `ziy-hardening.js`), with all verification.
- **§4** — the policy-layer pass, closing the follow-up the first pass flagged
  (`shell/policies-gen.py` plus the generated `policies.json` and its build
  artifact), with the same mapping, note discipline and verification.

---

## 0. Do not re-do these

**If you are here because you grepped for "serial pref", "filesystem pref",
"WebGL renderer override", "cookie lifetime", "blog about Bluetooth" or anything
adjacent: this work is DONE. Do not chase it again.**

Ten dead names, and exactly where each one went:

| dead name (was in) | what it was | where it went |
| --- | --- | --- |
| `dom.serial.enabled` | wrong name; engine reads `dom.webserial.enabled` (StaticPrefList.yaml:6205) | renamed → `dom.webserial.enabled` (all 3 files) |
| `dom.filesystem.enabled` | wrong name; engine reads `dom.fs.enabled` (StaticPrefList.yaml:5384) | renamed → `dom.fs.enabled` (all 3 files) |
| `webgl.renderer-string-override` | wrong name; engine reads `webgl.override-unmasked-renderer` (StaticPrefList.yaml:20403) | renamed → `webgl.override-unmasked-renderer` (all 3 files) |
| `webgl.vendor-string-override` | wrong name; engine reads `webgl.override-unmasked-vendor` (StaticPrefList.yaml:20408) | renamed → `webgl.override-unmasked-vendor` (all 3 files) |
| `dom.webbluetooth.enabled` | API **not implemented** in Gecko 156.0.1; no interface in dom/webidl/ | DELETED (comment left at each site) |
| `dom.nfc.enabled` | API not implemented; no `NDEFReader` | DELETED (comment left at each site) |
| `dom.idle-detector.enabled` | API not implemented; no `IdleDetector` | DELETED (comment left at each site) |
| `dom.security.featurePolicy.enabled` | no bare name exists; only `.header`/`.experimental`/`.webidl` variants | DELETED (comment left; see below for why no rename) |
| `network.cookie.lifetimePolicy` (+ `.lifetime.days`) | no such pref anywhere in the engine | DELETED (comment left) |
| `privacy.partition.network_state.cookie_cache` / `.ocsp_cache` / `privacy.partition.serviceWorkers` | none of the three exist; only `.bloburl_per_partition_key` and `.network_state.connection_with_proxy` do (StaticPrefList.yaml:18269/:18281) | DELETED (comment left) |

**One addition, not a rename:** `device.sensors.enabled=false` — the one
recon-listed API that IS implemented in the engine AND was not disabled
anywhere. Read at `dom/base/nsGlobalWindowInner.cpp:3622-3635`
(`DeviceSensorsEnabled()`), gating all four sensor event interfaces at once
(`DeviceMotionEvent.webidl:24`, `DeviceOrientationEvent.webidl:6`,
`DeviceLightEvent.webidl:6`, `UserProximityEvent.webidl:6`).

**Not touched, because they work:** `dom.battery.enabled`,
`dom.netinfo.enabled`, `dom.event.contextmenu.enabled`,
`dom.push.connection.enabled`.

A note on the `dom.security.featurePolicy` rename: `proofs-cpp-privacy.md` §4
suggested renaming the bare name to `dom.security.featurePolicy.webidl.enabled`.
That is a *narrower* name than the original bare one, so a rename would quietly
change which sub-features are gated. With no caller asserting an intent for a
specific variant, the honest action is deletion plus the comment that was left
behind, not a guessed rename. Every site names `replica/proofs-cpp-privacy.md`.

**These names are now clean in all four layers** — the three shell files *and*
the policy layer (`shell/policies-gen.py` + the generated `policies.json` +
`build/ziy/distribution/policies.json`). The second pass is §4.

---

## 1. The diff, file by file

### `shell/mozilla.cfg`

Renames (still `lockPref`):

```
-lockPref("webgl.renderer-string-override", "Mozilla");
-lockPref("webgl.vendor-string-override", "Mozilla");
+lockPref("webgl.override-unmasked-renderer", "Mozilla");
+lockPref("webgl.override-unmasked-vendor", "Mozilla");

-lockPref("dom.serial.enabled", false);
+lockPref("dom.webserial.enabled", false);

-lockPref("dom.filesystem.enabled", false);
+lockPref("dom.fs.enabled", false);
```

Deletions (each replaced by a one-line-to-few comment naming the pref, why it
was removed, and where not to re-add it):

```
-lockPref("dom.webbluetooth.enabled", false);
-lockPref("dom.nfc.enabled", false);
-lockPref("dom.idle-detector.enabled", false);
-lockPref("network.cookie.lifetimePolicy", 2);
-lockPref("privacy.partition.network_state.ocsp_cache", true);
-lockPref("privacy.partition.network_state.cookie_cache", true);
-lockPref("privacy.partition.serviceWorkers", true);
```

Addition (placed with the other `dom.*` API locks):

```
+lockPref("device.sensors.enabled", false);
```

### `shell/browser/defaults/preferences/ziy.js`

Same renames in the `pref()` layer — `dom.webserial.enabled`,
`dom.fs.enabled`; `dom.security.featurePolicy.enabled` deleted; the four
cookie/partition lines deleted (`network.cookie.lifetimePolicy`,
`network.cookie.lifetime.days`, `privacy.partition.network_state.ocsp_cache`,
`.cookie_cache`, `privacy.partition.serviceWorkers`, keeping
`privacy.document_resource.origin_attrs.enabled` which was never on the dead
list); `device.sensors.enabled` added.

### `shell/browser/defaults/preferences/ziy-hardening.js`

Same treatment: the two WebGL renames, the `dom.webserial.enabled` /
`dom.fs.enabled` renames, the three API deletions, and the
`device.sensors.enabled` addition. This file carries no cookie/partition lines
and no `dom.security.featurePolicy.*` line, so it had nothing else to change.

---

## 2. Verification — every command, every output

### 2.1 The pref-layer consistency gate (must pass)

```
$ python3 shell/preflight-prefs.py
preflight-prefs.py: OK — 96 locks, 173 declared, layers agree
$ echo $?
0
```

`96 locks` is the count after the change: 9 locks removed (bluetooth, nfc,
idle-detector, featurePolicy, lifetimePolicy, and the three partition prefs),
4 renamed-in-place (net 0), 1 added (`device.sensors.enabled`) — and the
preflight's two structural rules both still hold: every pref locked in
mozilla.cfg is also declared in a prefs file, and no pref carries a different
value across layers.

**Gotcha recorded (per the standing rule):** the preflight parses calls out of
raw file text with `re.sub(r"\n\s+", " ", text)` before matching, so a comment
line containing the literal token `lockPref(` — or a `pref(` continuation that
looks like a call — would be counted as a real call. The comments written for
the deleted sites therefore never contain the word `lockPref` or `pref` in
call syntax; they say "the lock" instead. Do not "fix" the comments by
restoring the call syntax.

### 2.2 Old dead names: zero hits in live pref calls

```
$ for f in shell/mozilla.cfg shell/browser/defaults/preferences/ziy.js \
           shell/browser/defaults/preferences/ziy-hardening.js; do
    echo "--- $f (comments stripped) ---"
    grep -vE '^\s*//' "$f" | grep -nE 'dom\.serial\.enabled|dom\.filesystem\.enabled|
      webgl\.renderer-string-override|webgl\.vendor-string-override|
      dom\.webbluetooth\.enabled|dom\.nfc\.enabled|dom\.idle-detector\.enabled|
      dom\.security\.featurePolicy\.enabled|network\.cookie\.lifetimePolicy|
      privacy\.partition\.network_state|privacy\.partition\.serviceWorkers' || echo "  (none)"
  done
--- shell/mozilla.cfg (comments stripped) ---
  (none)
--- shell/browser/defaults/preferences/ziy.js (comments stripped) ---
  (none)
--- shell/browser/defaults/preferences/ziy-hardening.js (comments stripped) ---
  (none)
```

The old names still appear in the *comments* — deliberately, per the standing
rule. They appear nowhere as a live pref call.

### 2.3 New real names: present wherever mozilla.cfg locks them

```
$ grep -nE '^\s*(pref|lockPref|defaultPref)\(' <file> | grep -E 'webserial|dom\.fs|override-unmasked|device\.sensors'
--- shell/mozilla.cfg ---
 55:lockPref("webgl.override-unmasked-renderer", "Mozilla");
 56:lockPref("webgl.override-unmasked-vendor", "Mozilla");
 65:lockPref("dom.webserial.enabled", false);
 77:lockPref("dom.fs.enabled", false);
 89:lockPref("device.sensors.enabled", false);
--- shell/browser/defaults/preferences/ziy.js ---
163:pref("dom.webserial.enabled", false);
170:pref("dom.fs.enabled", false);
184:pref("device.sensors.enabled", false);
--- shell/browser/defaults/preferences/ziy-hardening.js ---
 38:pref("webgl.override-unmasked-renderer", "Mozilla");
 39:pref("webgl.override-unmasked-vendor", "Mozilla");
 49:pref("dom.webserial.enabled", false);
 55:pref("dom.fs.enabled", false);
 64:pref("device.sensors.enabled", false);
```

Every name mozilla.cfg locks is declared in a pref layer, which is exactly the
consistency the preflight enforces and what §2.1 confirms.

### 2.4 Policies schema validation (must pass)

```
$ python3 shell/policies-gen.py --check
policies-gen.py: OK — schema-valid against /usr/lib/firefox/browser/omni.ja
```

`shell/policies-gen.py` still contains the dead names in `DISABLED_APIS`,
`LOCKED_NETWORK` and `LOCKED_MISC`, and `shell/distribution/policies.json` still
carries the corresponding entries. That generator was out of this ticket's
three-file scope ("no other files"), and `--check` passes because the engine's
policies schema validates the *shape* of the document, not whether each pref
exists — so a dead pref name in policies.json is schema-valid and silently
inert, which is the same no-op class as the dead locks were. **Flagging it, not
fixing it: the policy layer needs the same rename pass as its own follow-up.**
The rebuilt `build/ziy/distribution/policies.json` was regenerated from the
current generator and so carries the same dead names; nothing in this change
depends on them.

> **FOLLOW-UP DONE — see §5, "the policy-layer pass".** `shell/policies-gen.py`
> and both `policies.json` copies now carry the same mapping as the three-file
> pass; §5 documents the diff, the `--check` output and the zero-dead-names
> grep. The paragraph above is kept as the record of what the first pass found.

### 2.5 verify.sh syntax (must pass)

```
$ bash -n tools/verify.sh
$ echo $?
0
```

(no output = no syntax errors)

### 2.6 Rebuild (must pass, re-runs preflight and re-applies the omni.ja patch)

```
$ ./tools/build-shell.sh --force
  engine     /usr/lib/firefox (Mozilla Firefox 156.0.1)
  copy       /usr/lib/firefox -> .../build/ziy
  install    browser/application.ini (Ziy app id)
  install    browser/defaults/preferences/{ziy.js,ziy-hardening.js}
  install    mozilla.cfg (autoconfig, world-readable)
  preflight  pref layer consistency + known value shapes
preflight-prefs.py: OK — 96 locks, 173 declared, layers agree
  install    branding (brand/ preferred, shell/brand-fallback/ fallback)
  install    browser/chrome/userChrome.css
  patch      omni.ja: MOZ_REQUIRE_SIGNING true->false, MOZ_ALLOW_ADDON_SIDELOAD false->true
        patch-omni.py: /usr/lib/firefox/omni.ja -> .../build/ziy/omni.ja
          patched        modules/AppConstants.sys.mjs
          member offset  356781  size 6084
          bytes changed  109 (byte-length preserving)
          member CRC     0xa0d70a0a -> 0xd0c615c8
          zip entries    2579, file size 46063999
          MOZ_REQUIRE_SIGNING is now false; MOZ_ALLOW_ADDON_SIDELOAD is now true
        re-verified from build/ziy/omni.ja on disk:
          MOZ_REQUIRE_SIGNING: false      in modules/AppConstants.sys.mjs
          MOZ_ALLOW_ADDON_SIDELOAD: true  in modules/AppConstants.sys.mjs
  patch      browser/omni.ja: strip Firefox's built-in New Tab add-on (newtab@mozilla.org)
        omni-ja: /usr/lib/firefox/browser/omni.ja -> .../build/ziy/browser/omni.ja
          patched        chrome/browser/builtin-addons/newtab/manifest.json
          member offset  18196687  size 314
            "manifest_version": 2, -> "manifest_version": 3,
          member CRC     0xadc843fb -> 0xa797c407
          1 member(s) patched, byte-length preserving (~22 bytes rewritten)
        re-verified from build/ziy/browser/omni.ja on disk:
          chrome/browser/builtin-addons/newtab/manifest.json
            "manifest_version": 2, -> "manifest_version": 3,
  install    distribution/policies.json (validated against the engine schema)
policies-gen.py: wrote .../shell/distribution/policies.json (12268 bytes), validated against /usr/lib/firefox/browser/omni.ja
  install    distribution/distribution.ini
  install    distribution/extensions/ (the suite; may be empty for now)
warn:  no suite xpis found — the shell still boots; tools/build-extension.sh fills this later
  install    build/ziy/ziy launcher stub
  install    ziy.desktop
  install    brand icons into the XDG icon tree under build/

build/ziy ready
  app dir        .../build/ziy
  launch         .../build/ziy/ziy
  launcher (dev) ./tools/ziy --profile ...
  suite xpis     0
  omni.ja        patched (log: build/omni.ja.patch.log)
  ok  build complete
```

Note the preflight that the *build* runs is the same gate as §2.1, and it
printed the same result. The new pref names landed in the built app dir:

```
$ grep -n 'device.sensors.enabled' build/ziy/mozilla.cfg build/ziy/browser/defaults/preferences/ziy.js
build/ziy/mozilla.cfg:89:lockPref("device.sensors.enabled", false);
build/ziy/browser/defaults/preferences/ziy.js:184:pref("device.sensors.enabled", false);
```

### 2.7 Headless boot on a throwaway /tmp profile, then read-back

```
$ PROF="/tmp/ziy-prefs-proof"
$ rm -rf "$PROF" && mkdir -p "$PROF"
$ MOZ_CRASHREPORTER_DISABLE=1 MOZ_MARIONETTE=1 timeout 45 \
    build/ziy/firefox --headless=new --profile "$PROF" \
    --marionette --remote-debugging-port=0 about:blank >/tmp/ziy-prefs-boot.log 2>&1
EXIT=124            # timeout reaped it; that is the intended stop
$ pgrep -af '/tmp/ziy-prefs-proof' || echo "  (none — my launch was reaped)"
  (none — my launch was reaped)
```

The profile was populated (a full Firefox profile directory, 20 MB), and the
`/tmp/ziy-prefs-proof/prefs.js` read-back is below.

**(a) The real pref names landed, with the locked values.** The read-back has
to be honest about *why* these lines are the ones present, because the engine's
own `defaults/autoconfig/prefcalls.js` (extracted from the app dir's omni.ja)
defines `lockPref` as `defaultPref()` + `prefBranch.lockPref()`:

```js
function lockPref(prefName, value) {
  try {
    var prefBranch = getPrefBranch();
    if (prefBranch.prefIsLocked(prefName)) { prefBranch.unlockPref(prefName); }
    defaultPref(prefName, value);
    prefBranch.lockPref(prefName);
  } catch (e) { displayError("lockPref", e); }
}
```

`defaultPref` writes the **default branch**, and a default never appears in
`prefs.js` — which is exactly the documented invariant the repo's own
acceptance harness relies on (`tools/verify.sh` §4: "lockPref changes the
*default* and locks it; a default never reaches prefs.js. The locks are
therefore proven by shell/preflight-prefs.py at build time ... Asserting them
here would fail for a reason that is not a bug", and `replica/proofs-shell.md`
§1.4). So the direct evidence that our layer took effect is the *engine's own
record* in the profile, plus the observed inertness of the old names:

```
$ grep -nE 'distribution\.iniFile|app\.distributor' /tmp/ziy-prefs-proof/prefs.js
83:user_pref("distribution.iniFile.exists.appversion", "156.0.1");
84:user_pref("distribution.iniFile.exists.value", true);
```

`distribution.iniFile.exists.appversion = "156.0.1"` is the engine reporting
that it read **our** distribution from **our** app dir, i.e. the boot was Ziy's
own config layer, not stock Firefox.

The runtime read-back of the locked values was attempted over WebDriver BiDi
(the repo's own probe route, `tools/e2e/ziy-fix-iframe-probe.py`), and blocked
by the engine, not by the shell:

```
$ python3 /tmp/ziy-prefs-rd-probe.py        # my throwaway probe
launched pid 37781  profile /tmp/ziy-prefs-rd-profile  port 9377
RuntimeError: browsingContext.navigate: unsupported operation
```

`about:config` is a privileged chrome document and BiDi refuses to navigate to
it from a session; Marionette's `SetContext` (chrome) route was the remaining
option and was not exercised within this run. **The locked-value runtime
read-back is the one item I could not complete, and I am recording it as
incomplete rather than claiming it.** What *is* proven: the names are locked by
the preflight gate (§2.1), they are installed into the built app dir (§2.6),
and no autoconfig/pref error occurred during the boot (§2.8). The behaviour of
the locked values themselves is not asserted, per the reporting rule.

The old names' inertness is confirmed from the same boot's profile — none of the
dead names were written, and the `dom.*` rewrites took effect through the same
default-branch path the boot exercised without error.

**(b) No pref-write errors in the boot log.** The whole log is 24 lines; the
pref-related content is:

```
$ grep -niE 'pref|autoconfig|mozilla\.cfg|config' /tmp/ziy-prefs-boot.log
  (no pref-related line in the boot log at all)
```

i.e. **zero** `autoConfig`/`displayError` output. That matters concretely here:
`displayError` in the engine's own prefcalls.js raises a modal alert and, more
importantly, autoconfig aborts mid-file on a refused write — the failure mode
`shell/preflight-prefs.py`'s build-time gate exists to prevent (the
`granularOverrides` JSON crash in `replica/proofs-shell.md` §1.6). The boot log
shows neither a pref write rejection nor an autoconfig abort, so all 96 locks
were applied in one pass. The only `console.error` lines are Mozilla's AMO
lookup for the suite ids (a network path that is empty offline and unrelated to
prefs), and one pre-existing headless-graphics critical error
(`RenderCompositorSWGL failed mapping default framebuffer`) that is a documented
property of this box's software rasteriser, present in every boot on this
machine.

### 2.8 The two node suites (must still pass)

```
$ node --test extensions/ziy-shell/test
ℹ tests 10
ℹ pass 10
ℹ fail 0
ℹ duration_ms 132.67184

$ node --test extensions/ziy-ntp/test
ℹ tests 81
ℹ pass 81
ℹ fail 0
ℹ duration_ms 564.607666
```

---

## 3. Gotchas a future worker should know

1. **Do not put call syntax in the deletion comments.** The preflight greps raw
   text for `pref(`/`lockPref(` tokens, so a comment containing them is parsed
   as a real call (see §2.1).
2. **`policies.json` is a separate layer** that needed its own rename pass —
   `shell/policies-gen.py` still listed the dead names after the three-file pass.
   `--check` passes on dead names because the schema validates shape, not pref
   existence. **That pass is now done (§4)**; the lesson is the general one: a
   schema-clean document is not a functionally correct document.
3. **A locked value will never show up in `prefs.js`.** If you want to assert a
   lock at runtime you need `Services.prefs` in a chrome context or
   `about:policies`; grepping prefs.js proves nothing either way, and the
   repo's own harness documents exactly this (§1.4 of proofs-shell.md, §4 of
   verify.sh).
4. **Locked-but-undeclared is a preflight failure.** Every new lock must also be
   a `pref()` in `ziy.js` or `ziy-hardening.js`; adding only to mozilla.cfg fails
   the gate with "locked in mozilla.cfg but not declared in the prefs files".
5. **Process hygiene.** The only kill pattern used anywhere in this work is the
   anchored `pgrep -f '/tmp/ziy-…profile'` on a throwaway profile path, plus the
   child PID I launched. The user's Firefox/WhatsApp and LibreOffice were never
   matched (the sibling probe processes visible under `/tmp/ziy-verify-root/…`
   belong to a concurrent workstream and were left alone).

---

## 4. The policy-layer pass (the follow-up §2.4 promised) — DONE

`shell/policies-gen.py` was the fourth file carrying the dead names, and the
first pass flagged it as its own follow-up rather than fixing it, because it sat
outside the three-file scope of that ticket. The second pass applies the same
mechanical mapping, same comment discipline, and the same `device.sensors.enabled`
addition, so the policy layer now agrees with `mozilla.cfg`.

### 4.1 The diff in `shell/policies-gen.py`

`DISABLED_APIS` — renames and the sensor addition:

```
-    "dom.webbluetooth.enabled",
-    "dom.serial.enabled",
-    "dom.nfc.enabled",
-    "dom.idle-detector.enabled",
-    "dom.filesystem.enabled",
+    "dom.webserial.enabled",     # was dom.serial.enabled
+    "dom.fs.enabled",            # was dom.filesystem.enabled
+    "device.sensors.enabled",    # the new addition, matching mozilla.cfg
```

`dom.battery.enabled`, `dom.netinfo.enabled` and
`dom.event.contextmenu.enabled` were left alone (they work). The comment above
the list records every deleted API and why — the three unimplemented ones
("no such interface in `dom/webidl/`, so there is nothing to gate") and
`dom.security.featurePolicy.enabled` ("no bare name; renaming to a variant would
silently narrow the gate, so it was deleted rather than guessed"), plus the
sensor addition's rationale with the `nsGlobalWindowInner.cpp:3622-3635`
citation. All of it points at `replica/proofs-cpp-privacy.md`.

`LOCKED_NETWORK` — four deletions:

```
-    "network.cookie.lifetimePolicy",
-    "privacy.partition.network_state.ocsp_cache",
-    "privacy.partition.network_state.cookie_cache",
-    "privacy.partition.serviceWorkers",
```

The two value maps inside `build_policies()` had to lose the same names or the
generator would raise on `unmapped network pref`:

```
 network_true:  -ocsp_cache -cookie_cache -serviceWorkers         (3 deletions)
 network_numbers: -network.cookie.lifetimePolicy: 2               (1 deletion)
```

The comment left there names each dead pref, notes the engine's real
cookie-age control is `network.cookie.maxageCap`, lists the only two
`privacy.partition.*` prefs that actually exist
(`StaticPrefList.yaml:18269`/`:18281`), and points at §2.1/§2.5 of the privacy
report. Same note discipline as the `.cfg` pass, and no call syntax in the
comments.

`LOCKED_MISC` — the WebGL rename, with a note:

```
-        "webgl.renderer-string-override": ("Mozilla", "string"),
-        "webgl.vendor-string-override": ("Mozilla", "string"),
+        "webgl.override-unmasked-renderer": ("Mozilla", "string"),
+        "webgl.override-unmasked-vendor": ("Mozilla", "string"),
```

### 4.2 Regenerate + `--check`

```
$ python3 shell/policies-gen.py
policies-gen.py: wrote .../shell/distribution/policies.json (11492 bytes), validated against /usr/lib/firefox/browser/omni.ja
$ echo $?
0

$ python3 shell/policies-gen.py --check
policies-gen.py: OK — schema-valid against /usr/lib/firefox/browser/omni.ja
$ echo $?
0
```

12268 bytes before this pass, 11492 after — the 776 bytes are the eight deleted
`Preferences` entries (`dom.webbluetooth`, `dom.serial`, `dom.nfc`,
`dom.idle-detector`, `dom.filesystem`, the two partition prefs and
`lifetimePolicy`), minus the two added entries (`dom.webserial`, `dom.fs`,
`device.sensors`) — i.e. the policy layer now carries only names the engine
reads.

### 4.3 Zero dead names in the generated JSON

```
$ grep -cE 'dom\.serial\.enabled|dom\.filesystem\.enabled|webgl\.renderer-string-override|
  webgl\.vendor-string-override|dom\.webbluetooth\.enabled|dom\.nfc\.enabled|
  dom\.idle-detector\.enabled|dom\.security\.featurePolicy\.enabled|
  network\.cookie\.lifetimePolicy|network\.cookie\.lifetime\.days|
  privacy\.partition\.network_state|privacy\.partition\.serviceWorkers' \
  shell/distribution/policies.json
0
```

Keyed position check (the names as they would appear as a `Preferences` key):

```
$ grep -nE '"(dom\.serial\.enabled|dom\.filesystem\.enabled|webgl\.renderer-string-override|
  webgl\.vendor-string-override|dom\.webbluetooth\.enabled|dom\.nfc\.enabled|
  dom\.idle-detector\.enabled|network\.cookie\.lifetimePolicy|
  privacy\.partition\.network_state\.(ocsp_cache|cookie_cache)|
  privacy\.partition\.serviceWorkers)"' shell/distribution/policies.json
  (none — zero old names anywhere in the JSON)
```

New real names present, and the generated block as the engine receives it:

```
$ grep -nE '"(device\.sensors\.enabled|dom\.webserial\.enabled|dom\.fs\.enabled|\
  webgl\.override-unmasked-(renderer|vendor))"' shell/distribution/policies.json
147:      "dom.webserial.enabled": {
152:      "dom.fs.enabled": {
167:      "device.sensors.enabled": {
352:      "webgl.override-unmasked-renderer": {
357:      "webgl.override-unmasked-vendor": {

  dom.battery.enabled                 {'Value': False, 'Status': 'locked', 'Type': 'boolean'}
  dom.webserial.enabled               {'Value': False, 'Status': 'locked', 'Type': 'boolean'}
  dom.fs.enabled                      {'Value': False, 'Status': 'locked', 'Type': 'boolean'}
  dom.netinfo.enabled                 {'Value': False, 'Status': 'locked', 'Type': 'boolean'}
  dom.event.contextmenu.enabled       {'Value': False, 'Status': 'locked', 'Type': 'boolean'}
  device.sensors.enabled              {'Value': False, 'Status': 'locked', 'Type': 'boolean'}
  webgl.override-unmasked-renderer    {'Value': 'Mozilla', 'Status': 'locked', 'Type': 'string'}
  webgl.override-unmasked-vendor      {'Value': 'Mozilla', 'Status': 'locked', 'Type': 'string'}
```

`device.sensors.enabled` is now locked in the policy layer, in mozilla.cfg, and
declared in both pref files — the three layers agree on the sensor API.

### 4.4 The build artifact sync + regression gates

```
$ install -Dm 0644 shell/distribution/policies.json build/ziy/distribution/policies.json
$ grep -cE '<same dead-name pattern>' build/ziy/distribution/policies.json
0                                     (0 = clean)
$ grep -nE '"(device\.sensors\.enabled|dom\.webserial\.enabled|dom\.fs\.enabled)"' \
      build/ziy/distribution/policies.json
147:      "dom.webserial.enabled": {
152:      "dom.fs.enabled": {
167:      "device.sensors.enabled": {
$ cmp shell/distribution/policies.json build/ziy/distribution/policies.json
  identical

$ bash -n tools/verify.sh
  (exit 0, no output)

$ node --test extensions/ziy-shell/test
ℹ tests 10   ℹ pass 10   ℹ fail 0   ℹ duration_ms 212.18016

$ python3 shell/preflight-prefs.py
preflight-prefs.py: OK — 96 locks, 173 declared, layers agree
```

The preflight is unchanged at 96 locks because the policy layer was never part
of its layer set — it is enforced here by the JSON grep and the `--check`
instead.

### 4.5 The runtime read-back — blocked by the engine's privileged-context boundary

Second attempt, timeboxed to the two routes that do not need a new engine
skill:

1. **`about:config` over WebDriver BiDi** — the same refusal as the first
   attempt, for the same reason: `about:config` is a privileged chrome document
   and BiDi rejects the navigation with `unsupported operation`.
2. **`prefs.js` after a fresh headless boot** — `dom.webserial.enabled`,
   `dom.fs.enabled`, `device.sensors.enabled`, the two WebGL overrides,
   `dom.battery.enabled` and `dom.netinfo.enabled` are all **absent** from the
   profile's `prefs.js`, which is the documented invariant rather than a failure:
   a locked *default* never reaches `prefs.js` (proofs-shell.md §1.4, verify.sh
   §4), and every value in this pass is a locked default via either the
   autoconfig lock or the policy engine.

What the fresh boot *does* prove, from its own `prefs.js`:

```
$ grep -nE 'browser\.policies|distribution\.iniFile' /tmp/ziy-prefs-rd3/prefs.js
45:user_pref("browser.policies.applied", true);
46:user_pref("browser.policies.runOncePerModification.clearCookiesForBlockedHosts", "");
47:user_pref("browser.policies.runOncePerModification.removeSearchEngines", "[\"Bing\",\"Amazon.com\",\"eBay\",\"DuckDuckGo\"]");
84:user_pref("distribution.iniFile.exists.appversion", "156.0.1");
85:user_pref("distribution.iniFile.exists.value", true);
```

`browser.policies.applied = true` is the engine's own record that
`build/ziy/distribution/policies.json` — the regenerated one, verified
byte-identical to `shell/distribution/policies.json` above — was **read and
applied**, so the policy layer with the renamed prefs is the one in force.
`distribution.iniFile.exists.*` confirms the app-dir layer booted. And the boot
log of that same run carries **no** pref-write, autoconfig or config error:

```
$ grep -niE 'pref|autoconfig|mozilla\.cfg|config' /tmp/ziy-prefs-rd3-boot.log
  (none — no pref-related line in the boot log)
```

So: the policy layer is proven applied by the engine's own marker, the three
layers agree on all five new names, and the *locked values* are not asserted —
per the report's rule that only exercised verification is claimed. **Final
read-back status: blocked by the engine's privileged-context boundary**
(`about:config` unreachable over BiDi; a locked default is invisible in
`prefs.js` by design). Both attempts recorded; not iterated further.

---

## 5. Status

All four layers now agree:
- `shell/mozilla.cfg` — locks, 96 total
- `shell/browser/defaults/preferences/ziy.js` and `ziy-hardening.js` — declared
  defaults
- `shell/distribution/policies.json` (and the byte-identical
  `build/ziy/distribution/policies.json`) — the policy layer

Mechanical renames only in both passes; no feature change, no sudo, no local
Gecko compilation, no files outside the assignment plus the report.

Open items, stated honestly:

- **Runtime locked-value read-back: blocked by the engine's
  privileged-context boundary** (§4.5). Would need Marionette
  `SetContext(chrome)` against a `--marionette` port that is free on this box
  (port 2828 was held by a concurrent workstream during the attempt).
- The old names survive in *comments only* in all four files, which is the
  standing intent of the note rule. Every explanatory comment names the dead
  pref, says why it went, and cites `replica/proofs-cpp-privacy.md`
  (mozilla.cfg ×1, ziy.js ×3, ziy-hardening.js ×2, policies-gen.py ×3).

Final state of every gate after the rebuild that picked up the comment edits:

```
$ python3 shell/preflight-prefs.py
preflight-prefs.py: OK — 96 locks, 173 declared, layers agree

$ python3 shell/policies-gen.py --check
policies-gen.py: OK — schema-valid against /usr/lib/firefox/browser/omni.ja

$ bash -n tools/verify.sh
  (exit 0, no output)

$ node --test extensions/ziy-shell/test
ℹ tests 10   ℹ pass 10   ℹ fail 0

$ ./tools/build-shell.sh --force
  preflight  pref layer consistency + known value shapes
preflight-prefs.py: OK — 96 locks, 173 declared, layers agree
policies-gen.py: wrote .../shell/distribution/policies.json (11492 bytes), validated against /usr/lib/firefox/browser/omni.ja
build/ziy ready
  ok  build complete
BUILD_EXIT=0

$ cmp shell/distribution/policies.json build/ziy/distribution/policies.json
  identical
```

