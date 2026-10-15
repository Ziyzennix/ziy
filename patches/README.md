# patches/ — Ziy's C++ patch set for the Gecko engine fork

**Status: 5 patches, all real, none a scaffold.** Two change engine
behaviour (`0001`, `0004`), one touches engine behaviour in the WebGPU
adapter-identity path (`0003`), one restores a dead pref to life (`0005`),
and one declares the configure option that gates them (`0002`). Nothing here
is a placeholder, a no-op comment marker, or a stub. **None of the five has
been *compiled*** — that is what
`.github/workflows/build-gecko.yml` does — but all five have been
**verified to apply cleanly to the pristine 156.0.1 source tree**, forward
and in reverse, with `git apply --check` / `git apply --reverse --check`
(evidence: `replica/proofs-cpp-fingerprint.md` §5 for `0001`–`0004`,
`replica/proofs-cpp-network.md` §6 for `0005`; the re-verification
procedure, re-checked against a fresh extraction on this box, is in
[Rebooting is expected: re-verifying a patch](#rebooting-is-expected-re-verifying-a-patch)).
The gate-off path has been verified to reproduce the unmodified source byte
for byte.

> **Build policy (`replica/deep-fork.md` §0):** patch **authoring and applying**
> on this box is fine and expected — `git apply --check` against a `/tmp` copy
> of the source is light work. **Compiling is not.** No `./mach build`, no
> `./mach configure`, no autoconf, no rustc/cargo Gecko builds, no ccache-heavy
> jobs, anywhere on the local box. Every `./mach` mention in this README and in
> the patch comments describes the CI path (`.github/workflows/build-gecko.yml`),
> not something to run here.

---

## What this directory is for

The JS/omni.ja layer (`tools/lib/omni-ja.py` + `tools/patches/*.toml`) can
only rewrite **stored, uncompressed members whose length does not change**
(`replica/deep-fork.md` §1). That constraint is fatal for anything that has
to add or remove engine code. This directory is the seam for the C++ layer:
real source diffs applied to the engine tree before `./mach build`.

Two distinct patch kinds live here and are applied at different times:

| kind | file pattern | applied by | against |
| --- | --- | --- | --- |
| **C++ patch** | `*.patch` touching `.cpp`/`.h`/`.configure` | the CI workflow, step **f** | the **pristine source tree**, before `./mach configure` |
| **omni/JS patch** | `*.toml` (`[[member]]` + `[[member.replace]]`) | `tools/build-shell.sh` step 7b | the **packaged app dir**, via `tools/lib/omni-ja.py` |

The `.toml` patches are **not** re-applied in the CI engine build. They are
byte-level rewrites of an already-packaged archive, which does not exist until
after `./mach package`. The existing
[`tools/patches/newtab-strip.toml`](../tools/patches/newtab-strip.toml) is
that kind and lives in `tools/patches/`, unchanged — do not copy it here.

---

## Patch format

A C++ patch is a **plain unified diff in `git apply` format**, one file per
logical change, named `NNNN-<slug>.patch` where `NNNN` is a zero-padded,
strictly-increasing sequence number.

Required properties, all of which the CI workflow enforces:

- **`a/` and `b/` prefixes**, and paths relative to the **source tree root**,
  e.g. `a/toolkit/components/resistfingerprinting/nsRFPService.cpp`. Not
  relative to this directory, and not relative to `firefox-156.0.1/` — the CI
  applies from the tree root.
- **Applies cleanly to the pristine tree.** The workflow runs `git apply
  --check` before writing anything. A patch that does not apply **aborts the
  job** — that is engine-bump protection, the same loud-failure contract as
  `tools/lib/omni-ja.py`.
- **Idempotent is NOT required and NOT assumed.** Unlike the omni.ja patches,
  which must tolerate an already-patched archive, a source patch that has
  already been applied will fail `git apply --check` and stop the build. That
  is intended: a half-applied patch set is worse than a stopped one.
- **A commit-message header is strongly preferred** (`From:`/`Date:`/
  `Subject:`/body, then the `---` separator, then the diff). The workflow
  ignores the header and applies only the diff, but the body is where the
  *why* and the source citations live, and that is what a reader needs when
  the bump breaks the patch three months from now.

### How to add one

1. **Ground the change in real source first.** Read the actual file in the
   extracted tree. Every claim about what the code does should be traceable
   to a line number. If you cannot ground it, **do not write the patch** — a
   fake patch is worse than none (this is the discipline the deep-fork doc
   asks for, and the reason the first real patch took the shape it did).
2. Make the edit in a scratch copy of the file.
3. Generate the diff with paths rooted at the tree root:

   ```sh
   cd scratch-src          # contains toolkit/, browser/, ...
   cp original.cpp /tmp/a.cpp
   cp edited.cpp    /tmp/b.cpp
   diff -u \
     --label a/toolkit/path/original.cpp \
     --label b/toolkit/path/original.cpp \
     /tmp/a.cpp /tmp/b.cpp > NNNN-slug.patch
   ```

   `diff -u` against a pristine copy (not `git diff` in a dirty tree) is the
   reliable route: it cannot pick up unrelated local state.
4. Prepend the commit header explaining the change and citing the source
   lines you read.
5. Verify against the real tree before committing:

   ```sh
   cd /tmp/firefox-src/firefox-156.0.1   # or a fresh extraction
   git init -q . && git add -A && git commit -qm base
   git apply --check -v /path/to/NNNN-slug.patch
   ```

   **A patch you have not checked against the real tree is not finished.**
6. Prove the gate-off path if the patch is gated: strip the `#ifdef` blocks
   and confirm the result is byte-identical to the original. The CI mozconfig
   can set `--disable-ziy-fingerprinting`, so a patch that leaves residue when
   disabled is a bug.
7. Add a line to the index below, and update `../replica/deep-fork.md` §6.6
   if the patch changes what that section says is still unbuilt.

### The gate: `--enable-ziy-fingerprinting`

Every C++ patch in this set **must** be gated so the build still works when
the patch set is disabled. The gate is a real configure option declared by
`0002-ziy-fingerprinting-option.patch`:

```
ac_add_options --enable-ziy-fingerprinting    # .mozconfig, ON by default
```

The option's value becomes the `MOZ_ZIY_FINGERPRINTING` define in
`mozilla-config.h` (the header every C++ translation unit `-include`s —
`build/moz.configure/toolchain.configure`, `defines_cpp_flags`). Patches test
it with:

```cpp
#ifdef MOZ_ZIY_FINGERPRINTING
  // ... Ziy delta ...
#endif  // MOZ_ZIY_FINGERPRINTING
```

**Why a declared option and not a bare `-D`:** `./mach configure` hard-fails on
any option it does not recognise
(`python/mozbuild/mozbuild/configure/__init__.py`: `"Unknown option: %s"`).
Passing `ac_add_options -DMOZ_ZIY_FINGERPRINTING` without declaring the option
would abort configure before a single file compiles. That is why patch `0002`
exists at all: it is the piece that makes the gate switchable from `.mozconfig`
rather than requiring a header to be hand-edited.

The gate is **ON by default** in the CI `.mozconfig`. A patch set nobody runs
is a patch set nobody notices is broken.

### How update-engine.sh re-applies this per bump

`tools/update-engine.sh` (the bump procedure, `replica/deep-fork.md` §7) runs
the whole sequence. On every engine bump:

```
./tools/update-engine.sh [--engine PATH] [--extract-source] [--force]
```

In order:

1. **Discover and validate the new install** — executable `firefox`, `omni.ja`,
   `browser/omni.ja`, and not already a `build/` output.
2. **Version agreement** — the install's own `application.ini` `Version=` must
   equal the version this bump declares, or the script stops: an unaligned
   pin is exactly how a tree ships stock Gecko while the docs claim otherwise.
3. **Re-verify the omni.ja patchers' expectations** — it runs
   `shell/omni.ja.patch/patch-omni.py` and
   `tools/lib/omni-ja.py --patch ziy-browser` in write mode against the new
   engine first. A member or string that moved fails **there**, named, before
   anything is installed, with the same shape as their own
   `PRECONDITION FAILED` message.
4. **Pref-layer preflight** — `python3 shell/preflight-prefs.py`, so a pref the
   engine's consumer rejects is caught here instead of aborting autoconfig at
   first boot.
5. **Rebuild** — `tools/build-shell.sh --engine PATH`, which re-applies both
   omni.ja patches and re-reads each file it wrote.
6. **C++ patch set** — with `--extract-source` it derives the exact files the
   patch set touches from the patches' own `+++ b/` headers, extracts only
   those from the **checksum-verified** tarball, and `git apply --check` each
   patch in numeric order:

   ```sh
   for p in patches/*.patch; do
     [ -e "$p" ] || continue
     git apply --check "$p" || die "$p no longer applies to the new source; re-derive it"
   done
   ```

   Any failure is a hard stop naming the patch, with the same shape as the
   omni.ja `PRECONDITION FAILED` message. Re-derive the patch against the new
   source (the engine's internals move; a moved line is the expected failure,
   not a bug in the patch).
7. **Boot-verify afterwards** — `./tools/verify.sh --identity`, then the rest
   of the suite, plus: boot with the engine built from the patched tree and
   confirm each patch's behaviour is actually present.

Naming the patches in strict sequence order is what makes this a single loop
rather than a manual list: `for p in patches/*.patch` is the sequence, because
`0002` (the gate) must land before `0001`'s option can be referenced — and it
does, alphabetically, which is why the numbering is `0001` behaviour,
`0002` gate, and any later patch touching the same gate picks up `0002` being
already present.

> **Ordering note that is easy to get wrong.** `0001` contains the `#ifdef`
> and `0002` contains the option that defines the macro the `#ifdef` tests.
> Alphabetical application puts `0001` first, and that is correct and
> harmless: an undefined macro simply does not define the block, so `0001`
> applies cleanly to pristine source regardless of whether `0002` has landed.
> The two patches are therefore **order-independent in practice**, and the
> sequence numbers exist for human readability, not for a dependency.

---

## Index

| patch | kind | file touched | status |
| --- | --- | --- | --- |
| [`0001-rfp-colorscheme-carveout.patch`](0001-rfp-colorscheme-carveout.patch) | C++ | `toolkit/components/resistfingerprinting/nsRFPService.cpp` | **real** — applies clean, verified |
| [`0002-ziy-fingerprinting-option.patch`](0002-ziy-fingerprinting-option.patch) | configure | `toolkit/ziy-fingerprinting.configure` (new file) | **real** — applies clean, verified |
| [`0003-webgpu-adapter-strings.patch`](0003-webgpu-adapter-strings.patch) | C++ | `dom/webgpu/Adapter.cpp` | **real** — under RFP, empties the four unguarded `wgpu*` adapter-identity strings (`GetWgpuName`/`GetWgpuDeviceType`/`GetWgpuDriver`/`GetWgpuDriverInfo`); authored, apply-verified, not compiled |
| [`0004-webgl-fake-extension.patch`](0004-webgl-fake-extension.patch) | C++ | `dom/canvas/ClientWebGLContext.cpp` | **real** — under RFP, appends one fake extension name to `getSupportedExtensions()` so the GPU-derived list length stops identifying the machine (partial: fixed name, not per-site); authored, apply-verified, not compiled |
| [`0005-dns-disable-prefetch-from-https.patch`](0005-dns-disable-prefetch-from-https.patch) | C++ | `netwerk/dns/nsDNSService2.cpp` | **real** — honours `network.dns.disablePrefetchFromHTTPS`, a pref the engine registers (`StaticPrefList.yaml:15433-15437`) and never reads; authored, apply-verified (forward + reverse + cmp), gate-off byte-identical, not compiled |

### 0001 — restore the `-CSSPrefersColorScheme` carve-out in RFP mode

Ziy locks `privacy.resistFingerprinting=true` **and** ships
`privacy.fingerprintingProtection.overrides="+AllTargets,-CSSPrefersColorScheme"`
(`shell/mozilla.cfg`, `shell/browser/defaults/preferences/ziy.js`). The intent
of that string is unambiguous: run every protection except the colour-scheme
spoof, which breaks dark-mode stylesheets.

**It does not work.** In RFP mode, `nsRFPService::IsRFPEnabledFor()`
(`nsRFPService.cpp:335`) returns `true` for **every** target via
`if (mode == FingerprintingProtectionType::RFP) { return true; }` *before* it
ever reaches the branch that consults the override set. The overrides pref is
only read in FPP/Baseline mode. So the pref layer's carve-out is dead code the
moment `resistFingerprinting` is on — and `privacy.resistFingerprinting` is
exactly the pref Ziy locks.

There is no pref, no JSON array, and no granular override that can turn off
one target while RFP mode is on. This is precisely the "behaviour the RFP pref
layer cannot express" that `replica/deep-fork.md` §6.6 names as the preferred
first C++ patch target.

The fix reads the engine's own overrides pref inside
`HandleExceptionalRFPTargets()` — the one function `IsRFPEnabledFor()`
consults *first* — and returns `false` for `CSSPrefersColorScheme` when the
pref contains the `-CSSPrefersColorScheme` term. The consumer is
`Document::PreferredColorScheme()` (`dom/base/Document.cpp:21177`), so the
effect is that `prefers-color-scheme` reflects the user's real choice instead
of being forced to light.

Narrowness is deliberate and asserted in the comments in the patch: it touches
one target, only in RFP mode, only when the engine's own pref carries the
carve-out term, and it is compiled out entirely when the gate is off.

### 0002 — the `--enable-ziy-fingerprinting` configure option

A new `toolkit/ziy-fingerprinting.configure` declaring the option and setting
`MOZ_ZIY_FINGERPRINTING` via `set_define`. Without this file, the `.mozconfig`
line that turns the gate on is an unknown option and configure fails. It is
35 lines, parses as valid Python (moz.configure files are Python), and changes
no engine behaviour on its own.

### 0005 — honour `network.dns.disablePrefetchFromHTTPS`

Ziy locks `network.dns.disablePrefetchFromHTTPS` in the shell. It does nothing,
because nothing reads it — the engine registers the pref at
`modules/libpref/init/StaticPrefList.yaml:15433-15437` as a bool StaticPref with
`mirror: always`, and the only tree-wide occurrence of its generated accessor is
the comment at `netwerk/dns/DNSServiceBase.cpp:36-37` asserting the opposite:
*"`disablePrefetchFromHTTPS` is a StaticPref and needs no callback."* A pref
that needs no callback still needs a consumer, and that missing consumer is why
`DNSServiceBase::AddPrefObserver()` (`:33-44`) declines to observe it. Its
sibling `network.dns.disablePrefetch` **is** honoured, via `mDisablePrefetch`
(`DNSServiceBase.h:31`, read at `:65-68`, enforced at `nsDNSService2.cpp:1039`).

This is the same class as `0001`: the pref layer expresses a capability, the
engine documents it, and no engine code honours it. The patch adds the consumer
inside `nsDNSService::AsyncResolveInternal()` — the single funnel for every async
DNS lookup — mirroring the sibling's early-return shape exactly: same enclosing
lock scope, same return style, no restructuring of surrounding code. It returns
`NS_ERROR_NOT_AVAILABLE` (the engine's existing "cannot be satisfied here" code,
used for the null-resolver case two lines below at `:1053`), not the sibling's
`NS_ERROR_DNS_LOOKUP_QUEUE_FULL`, which means "queued, retry later" and is the
wrong semantics for a user-disabled pref.

The pref matters here rather than being merely cosmetic: an HTTPSSVC (SVCB)
answer carries the server's ECH config list and alt-service hints, which is
per-server identity material the querying client has no need to obtain
speculatively. Ziy already refuses the whole prefetch family for the ordinary
case via `network.dns.disablePrefetch`; this closes the one member that was
silently exempt because its pref was dead. **Full ground, evidence and the
larger audit it came from: `replica/proofs-cpp-network.md`.**

---

## Rebooting is expected: re-verifying a patch

**The source tree this patch set was verified against is gone.** `/tmp` is
reboot-volatile and the `firefox-156.0.1` tree at
`/tmp/firefox-src/firefox-156.0.1` was wiped by a reboot on 2026-10-15 (recorded
in `replica/AI-BRIEF.md` §2.2, §5 rule 12). The verification below happened —
against the tree as it then existed — and is the proof these patches are real.
It is **not** a claim that the tree is still on disk, and it does not mean you
can `cd` there today.

To re-run the check yourself, first **check whether the tree is still there**:

```sh
ls -d /tmp/firefox-src/firefox-156.0.1 /tmp/fxsrc/*.tar.xz
```

If the tree is absent, extract **exactly what you need** from the
checksum-verified tarball — do not re-download, and never start a second
download while one is in flight (`replica/AI-BRIEF.md` §5 rule 12):
a `curl -C -` resume of the in-flight copy is the documented recovery
(`replica/AI-BRIEF.md` §2.1), and the tarball's sha512 must equal
`80a32a79…a24d5b` (`replica/deep-fork.md` §6.2) before you trust it.

The whole loop, including the extraction, is what `tools/update-engine.sh
--extract-source` does — it derives the file list from the patches' own
`+++ b/` headers and extracts only those files (~550 KB, ~1 min on this box):

```sh
./tools/update-engine.sh --extract-source        # checks all four patches
```

By hand, the same thing is:

```sh
mkdir -p /tmp/apply-test && cd /tmp/apply-test
tar -xf /tmp/fxsrc/firefox-156.0.1.source.tar.xz --wildcards \
  'firefox-156.0.1/toolkit/components/resistfingerprinting' \
  'firefox-156.0.1/toolkit/moz.configure' \
  'firefox-156.0.1/dom/webgpu' 'firefox-156.0.1/dom/canvas'
cd firefox-156.0.1
for p in <repo>/patches/*.patch; do
  git apply --check -v "$p" || echo "FAIL: $p"
done
```

`git apply` needs no `.git` and no prior commit against a release tarball
extraction — a plain directory is enough, and the `a/`/`b/` prefixes resolve
against the tree root with the default `-p1`. That is why a scratch extraction,
not a clone or a `git init` commit, is the honest recovery: the release tarball
is not a checkout, and pretending otherwise adds ceremony without adding
correctness.

---

## Verification performed (this box, 2026-10-15)

Verified on 2026-10-15 against a freshly extracted pristine tree at
`/tmp/apply-test/firefox-156.0.1` (the earlier `/tmp/firefox-src` tree was
removed by a reboot, see `replica/AI-BRIEF.md` §2.2 — this run used the
checksum-verified tarball at `/tmp/fxsrc`, sha512 `80a32a79…a24d5b`, re-verified
before extraction, and the tree was confirmed byte-identical to pristine after
every reverse). Re-verification procedure: extract the
checksum-verified source to a `/tmp` copy and `git apply --check` in numeric
order (see [Rebooting is expected: re-verifying a patch](#rebooting-is-expected-re-verifying-a-patch)).

```
$ for p in "$REPO"/patches/*.patch; do echo "=== $(basename "$p") ==="; git apply --check -v "$p"; echo "RC=$?"; done
=== 0001-rfp-colorscheme-carveout.patch ===
Checking patch toolkit/components/resistfingerprinting/nsRFPService.cpp...
RC=0
=== 0002-ziy-fingerprinting-option.patch ===
Checking patch toolkit/moz.configure...
Checking patch toolkit/ziy-fingerprinting.configure...
RC=0
=== 0003-webgpu-adapter-strings.patch ===
Checking patch dom/webgpu/Adapter.cpp...
RC=0
=== 0004-webgl-fake-extension.patch ===
Checking patch dom/canvas/ClientWebGLContext.cpp...
RC=0
=== 0005-dns-disable-prefetch-from-https.patch ===
Checking patch netwerk/dns/nsDNSService2.cpp...
RC=0
```

All five in numeric order, all `RC=0`. 0003, 0004 and 0005 additionally carry the
full `git apply` → `git apply --reverse --check` → real reverse → `cmp` against
pristine round trip (`replica/proofs-cpp-fingerprint.md` §5 for 0003/0004,
`replica/proofs-cpp-network.md` §6 for 0005). All five were re-checked against a
fresh extraction of the files they touch, to confirm these claims still hold.

After applying:

- `HandleExceptionalRFPTargets()` contains the gated block, braces and
  parentheses balanced, one `#ifdef` matched by one `#endif`.
- `nsDNSService2.cpp`'s Ziy block is brace- and paren-balanced, one `#ifdef`
  matched by one `#endif`. (The file-level paren count is `-1` in the **pristine**
  file too — unpaired `(` in comment text — so it is pre-existing, not
  introduced. The delta block itself balances to 0/0.)
- `toolkit/ziy-fingerprinting.configure` exists and parses as valid Python.
- **Gate-off proof:** stripping the `#ifdef MOZ_ZIY_FINGERPRINTING` block from
  the patched `nsRFPService.cpp` yields a file **byte-identical** to the
  pristine original (`cmp` clean). A disabled patch set is stock Gecko. The
  same strip-and-`cmp` holds for 0003, 0004 and **0005** — for 0005 the stripped
  file compared equal to pristine with `True` and the tree's sha512 was
  unchanged afterwards (`08fc159f…660d4`).

**Not yet done:** none of the five has been compiled, and the resulting engine
has not been booted. Those are the CI job's job, and the first CI run is the
first time this patch set is compiled. Expect the first build to surface
something — most likely an unused-variable warning under
`--enable-warnings-as-errors` if that option is ever added, or a lint complaint
about the `#ifdef` placement. Treat the first green run, not this file, as
the proof that the patch set is real.

**One compile risk named specifically for `0005`:** the new
`StaticPrefs::network_dns_disablePrefetchFromHTTPS()` accessor must resolve
through `mozilla/StaticPrefs_network.h`, which `nsDNSService2.cpp:11` already
includes (it carries `network.dns.offline-localhost`, registered in the same YAML
pref group). If Gecko's generated-header split puts DNS prefs elsewhere, the fix
is a one-line include, not a redesign — see
`replica/proofs-cpp-network.md` §1 for why that is `[UNVERIFIED]`-by-construction
(the generated header does not exist until configure runs, and no Gecko compile
happens on this box).
