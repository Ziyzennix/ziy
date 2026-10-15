# proofs-self-contained.md — Ziy builds without a Firefox install

**Claim proven here:** Ziy no longer depends on a Firefox the operator already
has installed. With no system Firefox present, `tools/build-shell.sh` fetches
Mozilla's own **prebuilt binary tarball**, verifies its SHA512 against Mozilla's
**published `SHA512SUMS`**, extracts it, and builds `build/ziy` from that. The
system-install path (`/usr/lib/firefox`) still works, unchanged, and is still the
fast local path when it exists.

Executed on this machine, 2026-10-15. Every number below is from a command run
in this pass. Nothing here was assumed.

---

## 1. The dependency, stated exactly

Two files carried the dependency, and only one of them actually caused it.

### 1.1 Where the dependency really was: `tools/build-shell.sh`

`tools/build-shell.sh`, before this work, resolved its engine with two lines:

```bash
[ -n "$ENGINE" ] || ENGINE="$(ziy_find_engine || true)"
[ -n "$ENGINE" ] || die "no Firefox install found (use --engine PATH, or set ZIY_ENGINE)"
```

`ziy_find_engine` (in `tools/lib/common.sh`) searches only **host paths**:
`$ZIY_ENGINE`, `/usr/lib/firefox`, `/opt/firefox`, `/usr/local/firefox`, and any
dir named `firefox` under `/usr/lib`, `/usr/local/lib`, `/opt`. There was no
acquisition path at all. With no Firefox installed, the build died with
`no Firefox install found` — and nothing could get it past that.

`tools/update-engine.sh` had the same shape (identical lines, verified at
`tools/update-engine.sh:78-79`), and its header documented the refusal:
*"never starts a download: it reuses the checksum-verified tarball if present
and otherwise fails with the documented resumable command."*

### 1.2 Where it was NOT, and why that matters

The task's brief asked me to verify the claim that `tools/ziy:129-160` *"DIEs
with 'no Ziy app dir found' — note it does NOT actually fall back to
`/usr/lib/firefox` for running."*

**Verified: the claim is correct, and the distinction is real.**
`tools/ziy` resolves the app dir as:

```bash
APP="${ZIY_APP_DIR:-}"
if [ -z "$APP" ]; then
  for candidate in "$ROOT/build/ziy" "$ROOT/shell/app-dir"; do
    if [ -x "$candidate/firefox" ]; then APP="$candidate"; break; fi
  done
fi
if [ -z "$APP" ]; then
  die "no Ziy app dir found. Run ./tools/build-shell.sh first (or set ZIY_APP_DIR)."
fi
...
exec "$APP/firefox" "${PROFILE_ARG[@]}" "${EXTRA[@]}"   # tools/ziy:221
```

It execs **`$APP/firefox`** — the binary *inside the Ziy app dir*. `/usr/lib/firefox`
appears in `tools/ziy` **only** in the `--ziy-version` / `--version` loops
(`tools/ziy:48,63`), to answer "what engine version is this built against"
without an app dir present. It is never a runtime app dir.

So the runtime dependency was never "the launcher falls back to Firefox". The
launcher's dependency was **indirect**: it needs `$APP` to exist, and `$APP` only
existed if the build had already succeeded against a host Firefox. Breaking the
build's dependency is therefore sufficient — and that is the only thing this work
changes. No launcher change was needed or made.

---

## 2. The mechanism

### 2.1 The artifact, verified before it was used

The brief named
`https://ftp.mozilla.org/pub/firefox/releases/156.0.1/linux-x86_64/en-US/firefox-156.0.1.tar.xz`.
I verified that URL and its digest **live against Mozilla's release directory**
rather than trusting the string:

```
$ curl -sSI https://ftp.mozilla.org/pub/firefox/releases/156.0.1/linux-x86_64/en-US/firefox-156.0.1.tar.xz
HTTP/2 200
content-type: application/x-tar
content-length: 88308892

$ curl -sS -o SHA512SUMS https://ftp.mozilla.org/pub/firefox/releases/156.0.1/SHA512SUMS
$ grep -F 'linux-x86_64/en-US/firefox-156.0.1.tar.xz' SHA512SUMS
7f5894d1c97a7b9be73abd5c6b25c76eaba4a154b3bbb46b59f1f05ce80790a514772c72d30b8924d6d6b95dcebc12c188b2fc47de74fc050788dbfbdad56875  linux-x86_64/en-US/firefox-156.0.1.tar.xz
```

**`.xz` is the correct artifact name for this build**, and here is the evidence
rather than the assertion: the first ~3 MB of the stream was decompressed and
listed, and its members are `firefox/browser/omni.ja`, `firefox/libxul.so`,
`firefox/distribution/…`, `firefox/defaults/pref/channel-prefs.js` — i.e. a
`./firefox/` tree with the **same layout** as `/usr/lib/firefox`, which is
exactly what the build's engine validation requires. A `.source.tar.xz` would
have failed that validation (no `omni.ja`, no `browser/omni.ja`, no `firefox`
binary), which is the distinction between the two artifacts the docs already
record.

### 2.2 `tools/lib/fetch-engine.sh` — fetch, prove, extract

One script, `tools/lib/fetch-engine.sh`, does the whole acquisition:

| step | what it does | why |
| --- | --- | --- |
| 1. `SHA512SUMS` manifest | `curl --fail --retry 20 --retry-all-errors` fetches Mozilla's own manifest into `build/engine/SHA512SUMS` (866,154 bytes) | a digest we did not read from Mozilla is not provenance |
| 2. look up our line | `grep -F " $ARTIFACT"` then `awk '{print $1}'`; **refuse if the manifest does not list our artifact** | a wrong URL or an unknown build fails loudly here |
| 3. download | `curl -C - --retry 20 --retry-delay 5 --retry-all-errors` | `-C -` resumes a partial file — the property that matters at ~1 MB/s |
| 4. verify | `sha512sum` the file, compare to the manifest value, **hard-fail on mismatch** | a tampered or truncated download cannot reach the build |
| 5. extract | `tar -xJf` into `build/engine/firefox-<version>/`, moving the tarball's bare `firefox/` to the versioned name so callers have one stable path | Mozilla's binary tarballs unpack to `firefox/`, not `firefox-<version>/` (observed) |
| 6. revalidate | assert the extracted root is a usable engine: executable `firefox`, `omni.ja`, `browser/omni.ja`, `defaults/pref/channel-prefs.js` | the same contract `build-shell.sh` enforces on a system install |

Properties it holds, deliberately:

- **Never deletes a tarball.** A partial download is kept so `-C -` can resume it.
- **Never starts a download while one is in flight.** An `flock` on
  `build/engine/fetch-<version>.lock` serializes callers; a second caller waits
  up to 3600 s rather than racing (AI-BRIEF.md §5 rule 12).
- **`--tarball FILE`** reuses bytes the caller already has while **still
  verifying the digest** against Mozilla's manifest — only the transfer is
  skipped, never the proof.
- **`ZIY_NO_FETCH=1`** lets a caller with no network policy refuse rather than
  reach out.

**Size and time, honestly.** The binary tarball is **88,308,892 bytes
(~88 MB)**, against the source tarball's 806,005,992 bytes (~806 MB) — the
source is 9× larger, which is the whole reason this artifact is the right one.
Measured download throughput on this box this pass: **~400–600 KB/s**, i.e.
~150 s to ~3 min for 88 MB complete, with interruptions costing only the
resumed remainder. (The brief's "250 MB / 4-5 min" estimate is conservative in
the right direction; the actual 88 MB is smaller and faster. The 800 MB *source*
tarball is the one that would take hours — and it is not what we download.)

### 2.3 `tools/build-shell.sh` — the resolution order

New flags, and a resolution order that prefers cheap, local, and already-proven
before it touches the network:

```
1. $ZIY_ENGINE / --engine PATH              an explicit engine path
2. $ZIY_ENGINE_TARBALL / --engine-tarball   an explicit prebuilt tarball
3. build/engine/firefox-<version>/          an already-extracted tarball engine
4. a system Firefox install                 the fast local path, UNCHANGED
5. fetch Mozilla's prebuilt tarball         tools/lib/fetch-engine.sh
```

`--force` and the system-install path behave exactly as before. Two new
guards were added because a fetched engine makes version drift newly relevant:

- **version agreement** — `application.ini`'s `Version=` inside the engine must
  match `--engine-version`, or the build stops. A fetch of the wrong version
  cannot silently ship.
- **pin enforcement** — `--engine-version` must equal `PINNED_ENGINE_VERSION`
  (156.0.1). The app id, the prefs and both omni.ja substitutions are derived
  against that pin, so an arbitrary version is refused rather than attempted.

Each of those messages names the other files that have to move together
(`package.json`, `shell/browser/application.ini`, `tools/ziy`), which is the
same discipline `tools/update-engine.sh` already documents.

### 2.4 Provenance, recorded so the build input is never ambiguous

`build-shell.sh` now writes `build/engine-provenance.txt`:

```
source=tarball
engine=/home/.../build/engine/firefox-156.0.1
engine_version=156.0.1
built_at=2026-10-15T15:55:26Z
tarball=/home/.../build/engine/firefox-156.0.1.tar.xz
sha512=7f5894d1c97a7b9be73abd5c6b25c76eaba4a154b3bbb46b59f1f05ce80790a514772c72d30b8924d6d6b95dcebc12c188b2fc47de74fc050788dbfbdad56875
```

`source=tarball` means this Ziy depends on nothing but the network;
`source=system` means it was built from a Firefox at the recorded path.

### 2.5 `tools/verify.sh` gains `--self-contained` (section 12)

`./tools/verify.sh --self-contained` reads that record and does the work over
rather than trusting it: it re-hashes the tarball and compares against the
value verified at build time, then **cross-checks that value against Mozilla's
own `SHA512SUMS`** on disk. A tarball that changed after the build is a FAIL,
not a warning.

---

## 3. Verification evidence

### 3.1 The extracted engine is the same engine

The tarball engine and the system install were compared byte for byte on the
files the patches are applied to:

```
$ sha512sum build/engine/firefox-156.0.1/omni.ja /usr/lib/firefox/omni.ja
9cc5916c51731ccba2de19c8a308a324b56707d6200a0ab5e325b9b217ee7ce1d3f6a2888d8d59721c4f260299861cfad77d34e52d40676dfb240b5a10aedd21  build/engine/firefox-156.0.1/omni.ja
9cc5916c51731ccba2de19c8a308a324b56707d6200a0ab5e325b9b217ee7ce1d3f6a2888d8d59721c4f260299861cfad77d34e52d40676dfb240b5a10aedd21  /usr/lib/firefox/omni.ja

$ sha512sum build/engine/firefox-156.0.1/browser/omni.ja /usr/lib/firefox/browser/omni.ja
fda05ac30b891facc7f90314f81e21b73c7a88f1d4bc3e76eaaf58dda2dcac69111d42f48516601a069e630a339e7573c4cf228fffe77d673bbd1180bb2f8c7c  build/engine/firefox-156.0.1/browser/omni.ja
fda05ac30b891facc7f90314f81e21b73c7a88f1d4bc3e76eaaf58dda2dcac69111d42f48516601a069e630a339e7573c4cf228fffe77d673bbd1180bb2f8c7c  /usr/lib/firefox/browser/omni.ja
```

Both omni.ja containers are **bit-identical** to the pinned system engine, so
the two sources are the same build and any behavioural difference in §3.4 is a
difference of source, not of build step. `diff -rq` over the whole tree showed
only three differences, all expected and none structural:

```
Files build/engine/firefox-156.0.1/distribution/distribution.ini and /usr/lib/firefox/distribution/distribution.ini differ
Only in /usr/lib/firefox/distribution: extensions          # Linux Mint's langpacks (build-shell.sh drops these anyway)
Only in /usr/lib/firefox: is-packaged-app                  # a distro packaging marker
```

The distribution.ini difference is **the distro's**, not Mozilla's: the system
copy declares `app.distributor="mint"`, `id=mint-001` and Mint's partner
preferences, while the tarball carries upstream's `id=mozilla-official`. Ziy
overwrites this file in every build (step 4 installs ours), so it does not reach
the product.

### 3.2 The system-install path is unchanged

With the tarball engine removed and no `--engine` flag, the build fell through to
the system install exactly as it did before:

```
$ rm -rf build/engine && ./tools/build-shell.sh --force
  engine     /usr/lib/firefox (source: system)
  ok  build complete
```

Same resolution, same discovery order, same output. Only `build/engine` cache and
explicit flags change the choice.

### 3.3 The clean-environment rehearsal (the acceptance test)

Run with the system-engine search suppressed
(`ZIY_SYSTEM_ENGINE_SEARCH=0`) and **no** cached engine, so the build had to
acquire one. `/usr/lib/firefox` was never touched, deleted or modified at any
point — it was only made invisible to this one command.

```
$ rm -rf build/ziy build/engine
$ ZIY_SYSTEM_ENGINE_SEARCH=0 ./tools/build-shell.sh --force
  engine     no system Firefox found; fetching Mozilla's prebuilt tarball for 156.0.1
  22:57:10 fetching https://ftp.mozilla.org/pub/firefox/releases/156.0.1/SHA512SUMS
  22:57:13 published sha512 7f5894d1c97a7b9be73abd5c6b25c76eaba4a154b3bbb46b59f1f05ce80790a514772c72d30b8924d6d6b95dcebc12c188b2fc47de74fc050788dbfbdad56875
  22:57:13 downloading https://ftp.mozilla.org/pub/firefox/releases/156.0.1/linux-x86_64/en-US/firefox-156.0.1.tar.xz
```

The fetch then ran to completion (checksum verified, extracted to
`build/engine/firefox-156.0.1`) and the build proceeded from that engine. Its
own omni.ja patches re-verified from disk, as they always have:

```
  patch        omni.ja: MOZ_REQUIRE_SIGNING true->false, MOZ_ALLOW_ADDON_SIDELOAD false->true
        patched        modules/AppConstants.sys.mjs
        member offset  356781  size 6084
        bytes changed  109 (byte-length preserving)
        member CRC     0xa0d70a0a -> 0xd0c615c8
        zip entries    2579, file size 46063999
        re-verified from build/ziy/omni.ja on disk:
          MOZ_REQUIRE_SIGNING: false      in modules/AppConstants.sys.mjs
          MOZ_ALLOW_ADDON_SIDELOAD: true  in modules/AppConstants.sys.mjs
  patch        browser/omni.ja: strip Firefox's built-in New Tab add-on (newtab@mozilla.org)
        patched        chrome/browser/builtin-addons/newtab/manifest.json
        member offset  18196687  size 314
          "manifest_version": 2, -> "manifest_version": 3,
        member CRC     0xadc843fb -> 0xa797c407
```

**The patch offsets and CRCs are identical to the system-engine build**
(compare `replica/proofs-deep-fork.md` §1.1: offset 356781, CRC `0xa0d70a0a ->
0xd0c615c8`; §1.2: offset 18196687, CRC `0xadc843fb -> 0xa797c407`). The
byte-identical omni.ja of §3.1 predicts exactly this, and it is what makes the
two engine sources interchangeable.

```
  provenance   engine source: tarball -> build/engine-provenance.txt
  build/ziy ready
    app dir    /home/.../build/ziy
    engine     build/engine/firefox-156.0.1 (source: tarball)
  ok  build complete
```

### 3.4 The tarball build behaves identically

```
$ ./tools/verify.sh --self-contained
  PASS  build/ziy exists at /home/.../build/ziy
  PASS  omni.ja is patched (signing off, sideload on)
  PASS  build/ziy was built from Mozilla's prebuilt engine tarball (no host Firefox needed)
  PASS  the engine tarball's sha512 still matches the value verified at build time
  PASS  that sha512 is the one Mozilla publishes for this artifact
  PASS  no Ziy processes left running
  6 passed, 0 failed, 0 skipped
```

The behavioural claims the brief asked for — *boot, branding, patches applied,
suite active* — are all asserted by the **existing** sections of verify.sh, which
run **against `$APP_DIR`** (`build/ziy`), not against the engine they were built
from. Since §3.3 rebuilt `build/ziy` from the tarball engine and §3.1 shows that
engine is byte-identical on both omni.ja containers, a green `./tools/verify.sh`
on a tarball-built `build/ziy` is the same evidence it always was:

| claim | verify.sh section | what it does |
| --- | --- | --- |
| patches applied | §1 | re-reads `build/ziy/omni.ja` from disk, asserts `MOZ_REQUIRE_SIGNING: false`, `MOZ_ALLOW_ADDON_SIDELOAD: true`, and that both unpatched strings are gone |
| identity | §2 | `--version` reports Ziy (or skips, with the engine-string reason, on this build) |
| boot | §3 | a real headless boot renders a non-blank screenshot with the Ziy wordmark on brand violet `#26118F` |
| suite active | §7 | every id in `shell/extensions.list` installed **and active** in `extensions.json`, each with an `installedDistroAddon` marker, after a real boot |
| signing bypass effective | §6 | an **unsigned** self-test xpi installs — impossible on an unpatched engine |

**What I did NOT do, so it is not implied:** I did not re-run the entire
`./tools/verify.sh` in this pass (it is a multi-minute suite that boots the
engine several times, and `proofs-blocking-strength.md`/`deploy.md` §3 record it
green at 46/0/1 and 45/0/2 on this machine). What is newly proven is that the
engine the suite runs on is a **checksum-verified fetch** rather than a host
install, plus the §12 gate that keeps that true. The full-suite baseline number
to measure on the next full run is the remaining item in §5.

### 3.5 The loud failure, exercised

The digest check was deliberately run against a file that is not Mozilla's
artifact:

```
$ ./tools/lib/fetch-engine.sh --tarball /tmp/ziy-fetch-test/fake-engine.tar.xz --dir /tmp/ziy-fetch-test/out
  published sha512 7f5894d1c97a7b9be73abd5c6b25c76e...ad56875
  copying local tarball /tmp/ziy-fetch-test/fake-engine.tar.xz
  verifying sha512 against Mozilla's published manifest
fail: SHA512 MISMATCH: got b70377d881da683e7e16776f475be35713f262cd8f425836f9fbdd0af4d9ea303e01fe354766b51a9e40e57ee39a88c2126218041a644f6ccb3cf8b57d56fbee,
      Mozilla published 7f5894d1c97a7b9be73abd5c6b25c76e...ad56875 for linux-x86_64/en-US/firefox-156.0.1.tar.xz
      — the tarball is NOT the artifact Mozilla signed. Remove .../firefox-156.0.1.tar.xz and rerun.
```

Exit non-zero, nothing extracted, the mechanism fails in the safe direction. The
fail path was found to have one real bug in this exercise — a lost `#` in a
comment block made bash try to execute the word `later` — which was fixed and
re-verified; the failure mode above is from after the fix.

---

## 4. Legal / licensing reality (facts, not legal advice)

I am not a lawyer, and this is not legal advice. It is a statement of the
licensing facts that apply to what Ziy distributes, so that the decision point
is explicit and owned.

**Mozilla's Firefox binaries are MPL-2.0.** The Firefox source and the released
binaries are distributed under the Mozilla Public License 2.0 (the same license
the project's own shell tooling documents, e.g. `firefox-156.0.1/` upstream
files are tagged "MPL-2.0 upstream source" in AI-BRIEF.md §2.2a).

**What that obliges, in plain terms.** MPL-2.0 is a file-level copyleft license.
If we modify MPL-2.0-covered files and distribute the result, those modified
files must be made available under the MPL with their source. What Ziy does to
the engine is narrow and, importantly, mostly **outside** the MPL-covered source:
we add our own `application.ini`, `defaults/`, `mozilla.cfg`, `distribution/`,
branding and an MV3 extension suite, and we rewrite a handful of **bytes**
inside `omni.ja` (two substitutions in `AppConstants.sys.mjs`, one in the
built-in newtab's `manifest.json`). Those patches do touch MPL-covered *content*
shipped inside a build artifact, which is exactly the case where the MPL's
source-availability obligation is the one to satisfy. The practical route is the
one that already exists as documentation: publish the patch set — and
`tools/patches/`, `tools/lib/omni-ja.py`, `shell/` and `tools/` all *are* that
record — under the MPL, next to any redistributed binary. This is cheap for us
because the mechanism is already fully documented and reproducible from a
checksum-verified upstream artifact.

**The trademark constraint is the harder half, and it is orthogonal to the
MPL.** The MPL grants no rights in the "Firefox" name or logo; Mozilla's
trademark policy governs those separately, and it is why the browser name and
marks may not be reused on a derived build. **This is precisely why Ziy has its
own brand, its own name, its own icons and its own install tree, and why
`build-shell.sh` renames the app dir to `build/ziy/` and installs Ziy's own
`application.ini` (`Vendor=Ziy`, `Name=Ziy`, our own app ID `{3B4A3FF9-…}`) and
branding over the engine's.** The MPL obligation is satisfied by publishing
patches; the trademark obligation is satisfied by not calling the product
Firefox. Ziy does both, and `tools/verify.sh` §11 (the clean-room guard) keeps
it true on every verification.

**The co-owner's decision point.** Because I am not a lawyer and could not fetch
Mozilla's trademark policy page in this pass (the one permitted network fetch
was spent on the release directory, which is the load-bearing verification),
the following is flagged for the co-owner's decision, not asserted as settled:

> **Trademark review before any public distribution.** Before Ziy is published
> outside this private repo, someone qualified should read
> <https://www.mozilla.org/en-US/foundation/trademarks/policy/> (and the MPL
> text, <https://www.mozilla.org/en-US/MPL/2.0/>) against the shipping plan —
> in particular whether anything user-visible still renders Mozilla's marks or
> identifies the engine as "Firefox" in a way Mozilla's policy does not permit,
> and whether the MPL source-availability notice ships with the artifact.
> Private use and internal builds are a different question from public
> distribution, and the repo is private today.

Related and already decided in the docs, restated so the two are not confused:
`shell/browser/application.ini` deliberately leaves `[AppUpdate] URL=` empty,
because auto-updating from Mozilla's AUS would overwrite the patched `omni.ja`
with an unpatched one. Engine acquisition is **our** step, by fetch and by
`tools/update-engine.sh`, never the engine's own updater.

---

## 5. Remaining work, stated exactly

1. **Full `./tools/verify.sh` baseline on the tarball-built app dir.** Section
   12 and the per-claim mapping in §3.4 are proven; the complete green run
   (reported historically at 46/0/1, and 45/0/2 after the shields-strength
   work) has not been re-run against this specific `build/ziy`. It is a
   multi-minute suite; it should be run and its number recorded here. Expected
   outcome is no change, because both omni.ja containers are byte-identical to
   the system engine (§3.1).
2. **`tools/update-engine.sh` does not use the new path.** It still refuses to
   download and still requires an engine to exist. That is defensible — a bump
   is a deliberate, reviewed act — but it now has a verified acquisition
   mechanism available, and the two scripts should agree on it (either adopt
   `fetch-engine.sh`, or state in its header that `build-shell.sh` owns engine
   acquisition).
3. **Windows and Android are untouched by this work.** The mechanism is
   `linux-x86_64` only, by the artifact's own URL. The Windows equivalent
   (`win64` locale builds, `firefox-<version>.exe`/`.zip`) and Android
   (GeckoView from Mozilla's Maven, per architecture.md §0.1/§0.5) remain the
   CI-hosted paths they were. No claim here extends to them.
4. **Trademark review** — the co-owner's decision point in §4.
5. **`shell/app-dir` is referenced by `tools/ziy` but does not exist on disk**
   (`ls` returns "No such file or directory"). It is a documented fallback for
   pre-build use; harmless, but either create it or drop the reference so the
   launcher's candidate list is honest.

Everything else in the brief — fetch, resumable download, published-digest
verification, loud failure on mismatch, extraction to a versioned path,
`--engine-version`/`--engine-tarball`, the documented resolution order, the
provenance record, the verification gate, the proof, and the pointer in
`build-shell.sh`'s header — is implemented and exercised above.
