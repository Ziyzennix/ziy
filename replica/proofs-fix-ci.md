# proofs-fix-ci.md — the two CI blockers fixed, with evidence

**Date:** 2026-10-15 · **Machine:** the Ziy box · **Companion doc:**
`replica/compile-readiness.md` (original findings preserved there; this file is
the fix's evidence pack).

**What was fixed:**

1. **Blocker 2 (correctness)** — `patches/0002-ziy-fingerprinting-option.patch`
   was regenerated so it *includes* the configure file it creates, and so a
   gate/shell mismatch fails configure loudly instead of shipping stock Gecko.
2. **Blocker 3 (cost)** — `.github/workflows/build-gecko.yml` now carries the
   correct private-repo runner spec (2 CPU / 8 GB), parallelism 2, the
   720-min cap reality and its mitigations, and a ccache save that survives a
   timeout.

**Not fixed (co-owner's action, left alone):** no git repository / no repo on
github.com — see `compile-readiness.md` §1 and §6.

**Tree discipline:** the pristine source at `/tmp/firefox-src/firefox-156.0.1`
was never modified. All patch-apply testing happened on copies
(`/tmp/ziy-fix-apply/tree`, `/tmp/ziy-patchgen`), removed at the end.
`configure` cannot be run here (no generated headers, and a full Gecko configure
is a tree of its own), so every "configure would do X" claim below is either
(a) a direct grep/read of the engine source that shows the line, or (b) marked
`unverified`.

---

## 1. PATCH APPLY EVIDENCE — all four commands, RC=0

Applied to a fresh copy of the pristine `toolkit/` subtree at
`/tmp/ziy-fix-apply/tree` (never the originals), from the tree root with git's
default `-p1`, exactly as workflow step *f* does it.

### 1.1 `git apply --check --verbose` (dry run, both patches)

```
$ cd /tmp/ziy-fix-apply/tree
$ git apply --check --verbose .../patches/0001-rfp-colorscheme-carveout.patch
Checking patch toolkit/components/resistfingerprinting/nsRFPService.cpp...
RC_CHECK_0001=0

$ git apply --check --verbose .../patches/0002-ziy-fingerprinting-option.patch
Checking patch toolkit/moz.configure...
Checking patch toolkit/ziy-fingerprinting.configure...
RC_CHECK_0002=0
```

Patch 0002's dry run now names **two** files instead of one — that is the fix,
visible in the output: `toolkit/moz.configure` (the include line) and
`toolkit/ziy-fingerprinting.configure` (the file it used to create alone).

### 1.2 `git apply` (real apply, both patches)

```
$ git apply --verbose .../patches/0001-rfp-colorscheme-carveout.patch
Checking patch toolkit/components/resistfingerprinting/nsRFPService.cpp...
Applied patch toolkit/components/resistfingerprinting/nsRFPService.cpp cleanly.
RC_APPLY_0001=0

$ git apply --verbose .../patches/0002-ziy-fingerprinting-option.patch
Checking patch toolkit/moz.configure...
Checking patch toolkit/ziy-fingerprinting.configure...
Applied patch toolkit/moz.configure cleanly.
Applied patch toolkit/ziy-fingerprinting.configure cleanly.
RC_APPLY_0002=0
```

Stat, for the record:

```
$ git apply --stat .../patches/0001-...
 .../resistfingerprinting/nsRFPService.cpp          |   35 ++++++++++++++++++++
 1 file changed, 35 insertions(+)

$ git apply --stat .../patches/0002-...
 toolkit/moz.configure                |    5 ++
 toolkit/ziy-fingerprinting.configure |   94 ++++++++++++++++++++++++++++++++++
 2 files changed, 99 insertions(+)
```

Patch 0001 is **unchanged** by this fix — same 35 insertions, same context, same
RC as the earlier compile-prep run. Only 0002 changed.

### 1.3 `git apply --reverse --check` (both patches)

```
$ git apply --reverse --check .../patches/0001-rfp-colorscheme-carveout.patch
RC_REV_0001=0
$ git apply --reverse --check .../patches/0002-ziy-fingerprinting-option.patch
RC_REV_0002=0
```

### 1.4 Real reverse-apply, bit-for-bit restore

A reverse *check* is not proof of a clean reverse. The reverse was applied for
real and the tree compared to the pristine source:

```
$ cd /tmp/ziy-fix-apply/tree
$ git apply --reverse .../patches/0002-...   -> RC_REV_APPLY_0002=0
$ git apply --reverse .../patches/0001-...   -> RC_REV_APPLY_0001=0
$ md5sum toolkit/moz.configure /tmp/firefox-src/firefox-156.0.1/toolkit/moz.configure
6ee09a6fed0a2ee2be1a0c77f994c793  /tmp/ziy-fix-apply/tree/toolkit/moz.configure
6ee09a6fed0a2ee2be1a0c77f994c793  /tmp/firefox-src/firefox-156.0.1/toolkit/moz.configure

$ md5sum .../nsRFPService.cpp  (both trees)
04a5a0ea773c1b8598c3a1fd139e98b2  (both — identical)

$ ls toolkit/ziy-fingerprinting.configure
ls: cannot access ...: No such file or directory     # the added file is removed again
```

**Verdict: PASS.** Four apply commands RC=0, plus a real reverse that restores
both edited files bit-for-bit and deletes the added file. The patch pair is
minimal (99 + 35 insertions, 0 deletions, 0 context changes) and fully
reversible, which is the property `git apply --reverse --check` proves and the
md5sums above confirm.

---

## 2. THE INCLUDE-GRAPH PROOF

### 2.1 The include line is now in the APPLIED tree

```
$ grep -n "include(" /tmp/ziy-fix-apply/tree/toolkit/moz.configure    # AFTER applying 0002
480:include("../js/moz.configure")
485:include("../build/moz.configure/node.configure")
1162:include("../build/moz.configure/keyfiles.configure")
3175:include("../build/moz.configure/nss.configure")
4053:include("../build/moz.configure/update-programs.configure")
4647:include("ziy-fingerprinting.configure")        <-- the fix

$ tail -8 /tmp/ziy-fix-apply/tree/toolkit/moz.configure


set_config("MOZ_LIBMEGAZORD_ARTIFACTS", libmegazord_artifacts)


# Ziy engine fork: the configure gate for the C++ patch set
# ==============================================================
include("ziy-fingerprinting.configure")
```

`toolkit/moz.configure` now includes **six** files, the sixth being ours.

### 2.2 The graph that reaches it (quoted from the engine source)

`configure` was not run — it cannot be, on this box, without a full
generate-headers pass. Instead, here is the whole chain that places
`toolkit/moz.configure` on the configure graph, with each edge quoted from the
files in `/tmp/firefox-src/firefox-156.0.1`:

**Edge 1 — `configure.py` loads exactly ONE entry point, no directory scan:**

```
configure.py:171:    sandbox.include_file(os.path.join(os.path.dirname(__file__), "moz.configure"))
```

`os.path.dirname(__file__)` is the source root, so this is the **root**
`moz.configure` and nothing else. Nothing walks the tree looking for
`.configure` files — which is precisely why a file that merely *exists* on disk
is never executed, and why the include is load-bearing rather than decorative.

**Edge 2 — the root `moz.configure` pulls in the project's configure:**

```
moz.configure:519:include(include_project_configure)
```

**Edge 3 — `include_project_configure` resolves to `browser/moz.configure`:**

```
build/moz.configure/init.configure:995:    path = os.path.join(base_dir, project[0], "moz.configure")
```

The default project for this tree is `browser`
(`--enable-application=browser` in step e2's `.mozconfig`;
`init.configure`'s `default_project`), so `project[0]` is `browser` and
`base_dir` is the topsrcdir: `browser/moz.configure`.

**Edge 4 — `browser/moz.configure` includes ours:**

```
browser/moz.configure:54:include("../toolkit/moz.configure")
```

`..` resolves to the topsrcdir, so that is `toolkit/moz.configure` — the file
patch 0002 now appends to.

**Chain, one line:**
`configure.py:171 → moz.configure:519 → init.configure:995 → browser/moz.configure:54 → toolkit/moz.configure:4647 → toolkit/ziy-fingerprinting.configure`

The last edge is the one that was missing before this fix. Every edge before it
was already present in the pristine tree and is quoted above from the pristine
files.

### 2.3 What the new file declares, in the APPLIED tree

```
$ grep -n -- "--enable-ziy-fingerprinting\|set_define" \
      /tmp/ziy-fix-apply/tree/toolkit/ziy-fingerprinting.configure
28:    "--enable-ziy-fingerprinting",        <- option() declaration
36:@depends("--enable-ziy-fingerprinting")
42:set_define("MOZ_ZIY_FINGERPRINTING", ziy_fingerprinting)   <- the define
```

and the define's route into the compiler is the engine's own
(`build/moz.configure/toolchain.configure`, `defines_cpp_flags`):

```
    config_h = "mozilla-config.h"
    flag = "-include"
    return ["-DMOZILLA_CLIENT", flag, f"{build_environment.topobjdir}/{config_h}"]
```

i.e. every C++ TU gets `-include .../mozilla-config.h`, and `mozilla-config.h`
is the generated header `set_define` writes `MOZ_ZIY_FINGERPRINTING` into. So
with the include in place, `.mozconfig`'s
`ac_add_options --enable-ziy-fingerprinting` (workflow step e2) reaches the
`option()` (no more `Unknown option` at
`python/mozbuild/mozbuild/configure/__init__.py:564`), the value reaches
`set_define`, and patch 0001's `#ifdef MOZ_ZIY_FINGERPRINTING` compiles in.

**Which failure modes are now impossible, and why:**

| before the fix | after the fix |
| --- | --- |
| `ac_add_options --enable-ziy-fingerprinting` → `Unknown option: %s`, configure aborts (after download + extraction are paid for) | option is declared in a file configure now executes |
| error suppressed / option tolerated → `set_define` never runs → macro undefined → **green build of stock Gecko that silently ignores patch 0001** | `set_define` runs; and see §3's configure-time guard for the residual disagreement case |

---

## 3. THE SILENT-FAILURE GUARD — mechanism and why this one

### 3.1 The failure being prevented

Ziy's shell ships the carve-out that patch 0001 exists to make work:

```
$ grep -n "fingerprintingProtection.overrides" shell/mozilla.cfg
42:lockPref("privacy.fingerprintingProtection.overrides", "+AllTargets,-CSSPrefersColorScheme")
$ grep -n "fingerprintingProtection.overrides" shell/browser/defaults/preferences/ziy.js
145:pref("privacy.fingerprintingProtection.overrides", "+AllTargets,-CSSPrefersColorScheme");
```

A build where `MOZ_ZIY_FINGERPRINTING` is *not* defined while those prefs ship
is a build that **looks green and silently ignores the patch** — exactly the
outcome compile-readiness.md §3c called the worse of the two failures. The guard
must make that impossible.

### 3.2 Mechanism chosen: a configure-time `configure_error(...)`

**Chosen, per the engine's own convention.** The engine has a documented helper
for exactly this shape of sanity check:

```
build/moz.configure/util.configure:14:@imports(_from="mozbuild.configure", _import="ConfigureError")
def configure_error(message):
    """Raise a programming error and terminate configure.
    Primarily for use in moz.configure templates to sanity check their inputs
    from moz.configure usage."""
    raise ConfigureError(message)
```

— “Primarily for use in moz.configure templates to sanity check their inputs”
is a verbatim match for what the guard does, and the engine uses it for the same
shape of check in `toolkit/moz.configure` itself:

```
toolkit/moz.configure:4497:            configure_error("In-tree windows crate is missing dependency on mozbuild")
toolkit/moz.configure:4498:            configure_error("In-tree windows crate Cargo.toml doesn't match original")
```

The guard's code shape (an `@depends(...)` over an option, then a plain function
that inspects state) is also the engine's own idiom — `@depends` appears 447
times, `@checking` 43 times, `@imports` 281 times across
`toolkit/moz.configure` + `build/moz.configure/*.configure`; the closest sibling
is `build/moz.configure/update-programs.configure:50-51`:

```
@depends("--enable-unverified-updates", "--enable-compile-environment")
def disable_unverified_updates(unverified_updates, compile_environment):
    if unverified_updates:
        if not compile_environment:
            die("--enable-unverified-updates requires --enable-compile-environment")
    return not unverified_updates
```

### 3.3 Why configure, not a C++ `#error`

A compile-time guard was considered and rejected, on the mechanism's own limits:

- A `#error` in a header included by `nsRFPService.cpp` **only under the gate**
  can only ever fire when the gate is ON — i.e. it can never catch the case we
  care about (gate OFF + prefs shipped), because in that case the guarded code
  is not compiled at all.
- A `#error` in a header included **unconditionally** would fire for every
  downstream consumer of the tree, including anyone building stock Gecko from
  it — it would brand a legitimate configuration as a build failure.
- The guard must compare *two things that only meet at configure time*: the
  option value (known only to configure) and the shell's shipped prefs
  (files only the configure-side file read can see). configure is the single
  place both are visible, so it is the only place the check can live.
- Configure-time beats compile-time on cost too: it fails after ~2-3 minutes,
  not after 12-28 hours.

So: **no C++ `#error` guard was added**, and patch 0001 is untouched. This is the
decision the assignment asked to be cited: `configure_error()` from
`build/moz.configure/util.configure:14`, used at `toolkit/moz.configure:4497`,
with the `@depends`-over-an-option shape of
`update-programs.configure:50-51`.

### 3.4 The guard's code (as it lands in the applied tree)

```python
@depends(
    "--enable-ziy-fingerprinting",
    build_environment,
)
@checking("that the Ziy gate is consistent with the shipped prefs")
@imports(_from="__builtin__", _import="open")
@imports("os")
def ziy_fingerprinting_gate_check(ziy_fingerprinting, build_environment):
    topsrcdir = os.path.realpath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    for rel in (
        "shell/mozilla.cfg",
        "shell/browser/defaults/preferences/ziy.js",
    ):
        path = os.path.join(topsrcdir, rel)
        if not os.path.exists(path):
            continue
        with open(path, "r") as f:
            for line in f:
                if "-CSSPrefersColorScheme" in line:
                    break
            else:
                continue
            if ziy_fingerprinting is not True:
                configure_error(
                    f"{rel} ships the -CSSPrefersColorScheme override, which "
                    "needs patches/0001-*.patch compiled in, but "
                    "--enable-ziy-fingerprinting is not set: the build would "
                    "silently ship stock Gecko that ignores the carve-out. "
                    "Pass `ac_add_options --enable-ziy-fingerprinting`, or "
                    "drop the override from the shell."
                )
            break
```

Two details worth recording, both verified against the engine's sources:

- `os.path.dirname(__file__)` + `os.path.join(..., "..", "..")` + `realpath` is
  the engine's own topsrcdir idiom: `build/moz.configure/nss.configure:10` and
  `build/moz.configure/init.configure:18` use exactly it. In this tree
  `toolkit/ziy-fingerprinting.configure` is two levels below the topsrcdir
  (`<topsrcdir>/toolkit/ziy-fingerprinting.configure`), so `..`, `..` lands on
  the topsrcdir.
- The `build_environment.topsrcdir` dependency is deliberately NOT used to read
  the files: `build_environment` is present so the check re-runs when the
  environment is re-resolved, and the manual path walk is the pattern the
  engine's own configure files use (`nss.configure`, `init.configure:1086`).

### 3.5 Static check of the new configure file

`./mach configure` cannot run here, so the strongest available check was run:
the file parses as Python (the moz.configure sandbox is a Python subset), and
every decorator/function it uses is an engine construct:

```
$ python3 -c "import ast; ast.parse(open('/tmp/ziy-fix-apply/tree/toolkit/ziy-fingerprinting.configure').read())"
parsed OK; top-level stmts: 4
decorator names: ['checking', 'depends', 'imports']
calls: checking, configure_error, depends, imports, open, os.path.*, option, set_define
```

`configure_error` is in the sandbox because `build/moz.configure/init.configure:5`
does `include("util.configure")` and every moz.configure file shares that
sandbox — verified by the grep: `util.configure` is included by `init.configure`
and defines `configure_error` there.

**Honest limitation:** parsing proves the file is valid Python and that the
constructs exist; it does not prove the configure sandbox accepts this exact
input. A full `./mach configure` is the only real proof and is not possible
here. That specific point is `unverified`.

---

## 4. WHAT CHANGED IN patch 0002 (summary, for the reviewer)

| part | before | after |
| --- | --- | --- |
| `toolkit/ziy-fingerprinting.configure` | created, never included | created **and** included by `toolkit/moz.configure` |
| include line | absent | `include("ziy-fingerprinting.configure")` appended at 4647, in the file's existing comment-banner style (`# <Title>` + `# ====...`) |
| silent-failure guard | none | configure-time `configure_error()` when the gate is off but the shell ships `-CSSPrefersColorScheme` |
| patch 0001 | untouched | untouched |
| patch size | 35 insertions (1 file) | 99 insertions (2 files), 0 deletions |
| reversibility | reversible | reversible — real reverse restores `moz.configure` bit-for-bit (md5 above) and deletes the added file |

Why the include went at the **end** of `toolkit/moz.configure` rather than
alphabetically among the five: the file has no alphabetical include ordering —
its includes are grouped under section banners in file order
(`# Javascript engine` → `# NodeJS` → … → `# Update-related programs`).
Appending a new banner section at the end is the minimal, most reversible
insertion: it touches nothing that exists, and it is where the engine's own
`option()`-and-`set_config()` tail sections live (the last ~40 lines are
standalone `option()`/`set_config()` blocks). The alternative — splicing it into
an existing section — would have required a context hunk inside engine code.

---

## 5. BLOCKER 3 — the workflow file changes

File: `.github/workflows/build-gecko.yml`. All edits are comments, one
`runs-on` addition (commented out), two cache keys, one `mk_add_options` value,
and the step-f/j bodies. No step was removed.

### 5.1 (a) Header corrected — private-repo spec, private by design

The old header asserted `4 CPU / 16 GB RAM, free and unlimited for public repos`
and `-j4` "is both boxes' number". Replaced with a block that states the two
`ubuntu-latest` tables side by side, names this repo private **by design**, and
derives the consequences (MOZ_PARALLEL_BUILD=2; 8 GB is a risk not headroom
because the libxul link is a single ~5 GB process; minutes metered at
2,000/month; usage blocks once the quota is used with no payment method; the
first hosted run may be a cap timeout; `$0.006/min` past the quota). The line
"this job is 8-16 hours of compute" is now "12-28 hours of compute on a
private-repo 2-core runner (8-16h was the 4-core local box's figure)".

### 5.2 (b) Parallelism 2 + the self-hosted block

```
# --- THE FREE PATH: uncomment this and comment the line above -----------
# SELF-HOSTED RUNNER on the co-owner's Ziy box. ...
# runs-on: self-hosted
```

added at job level with the box's readiness documented (clang/llvm 19.1.1,
rustc 1.90.0, cbindgen 0.29.4, nasm, yasm, ccache 4.9.1, mercurial, the full
apt list, **and the checksum-verified 156.0.1 source already extracted**), the
4-core/~5.4-GB-RAM caveat with the swap/zram mitigation, and the
keep-it-private rule. In `.mozconfig`:

```
# PARALLELISM = 2, the private-repo runner's core count.
# A SELF-HOSTED runner has nproc=4; if you switch runs-on to
# self-hosted, raise this to 4.
mk_add_options MOZ_PARALLEL_BUILD=2
```

(was `MOZ_PARALLEL_BUILD=4` with the comment "The runner has 4 CPU, exactly the
local box's nproc" — which was the wrong machine.)

### 5.3 (c) The metered-minutes reality, stated plainly

In the header, at the job's `timeout-minutes: 720`, and in the step-*j* job
summary: one full Gecko build at 2 cores is estimated **12-28h** wall against
the **720-min (12h) cap**, so the first hosted run's job-level outcome may be a
plain cap timeout. `timeout-minutes` stays **720** because it is GitHub's
maximum and a smaller cap guarantees failure — the docs line quoted in the
comment: *"If the timeout exceeds the job execution time limit for the runner,
the job will be canceled when the execution time limit is met instead."*
Mitigations written inline: (a) self-hosted (free), (b) paid runner /
past-quota minutes, (c) split at the configure/build boundary.

### 5.4 (d) ccache save survives a timeout

What the file did before: `key: ...-${{ github.run_id }}` on **save**, so every
run wrote a cache under a key no later run could ever hit (the restore step's
key *also* had run_id, so a restore could only hit the prefix fallbacks). It did
have `if: always()`. What changed:

- **e1 (restore):** the key no longer contains `run_id`, and the restore-keys
  now include the version+patch-hash prefix before the two coarser ones, so a
  capped run's cache is reachable by an *exact* key next time and by prefix
  otherwise.
- **g5 (save, `if: always()`):** saves the **stable** key (no run_id).
- **g5b (new, `if: always()`):** saves the run-scoped entry as history.
  Two save steps are needed because `actions/cache/save` accepts a single `key`
  and no `restore-keys`.

Net effect: a run killed at 720 min still uploads whatever ccache accumulated,
and the next run restores it under an exact match instead of recompiling from
zero. The `if: always()` on both save steps is what covers the timeout path
(it covers success and failure too, which it already did).

Cache-reality notes recorded in the comments: 10 GB free cache storage per repo,
*"GitHub will remove any cache entries that have not been accessed in over 7
days"*, and cache *content* is unsigned/unverified (the dependency-caching doc's
security note) — relevant because a 10 GB ccache is build output, and it is
restored into a job that later runs compiled code.

### 5.5 A bonus assertion in step f (cheap, and it gates the whole fix)

After the apply loop, step *f* now asserts the wiring is physically present on
the tree before configure runs:

```bash
grep -q 'include("ziy-fingerprinting.configure")' "$SRC/toolkit/moz.configure" || exit 1
grep -q 'MOZ_ZIY_FINGERPRINTING' "$SRC/toolkit/components/resistfingerprinting/nsRFPService.cpp" || exit 1
```

This is the "prove it, don't assume it" version of §2.1, run by CI itself: if a
future patch-set regression drops the include, the job fails at minute ~6 with
a `::error::` naming the file, instead of at hour 5 or never. It is inside the
`PATCH_COUNT > 0` guard, so an intentionally empty patch set (stock Gecko)
still works.

---

## 6. WORKFLOW SELF-CONSISTENCY (re-run after the edits)

### 6.1 YAML validity — PASS

```
$ python3 -c "import yaml; print(yaml.__version__)"
6.0.1
PyYAML 6.0.1 parse: OK
top-level keys: ['name', True, 'permissions', 'env', 'jobs']
jobs: build-gecko
  runs-on='ubuntu-latest'  timeout=720  steps=20
  run steps: 15   uses steps: 5   (every step has exactly one of run/uses; no empty run blocks)
```

(`on:` parses as YAML 1.1's boolean `True` — a PyYAML truthiness artifact, not a
defect; GitHub expects it.)

13 well-formed `${{ }}` expressions, all balanced: `env.GECKO_VERSION` (×9),
`github.event.inputs.note` (×2), `github.run_id` (×1, now only in g5b),
`hashFiles('patches/*.patch','patches/*.toml')` (×4).

### 6.2 Every `run:` block is valid bash — PASS

All 15 shell steps extracted to `/tmp/ziy-runblocks/*.sh` (with `${{ }}`
expressions replaced by the placeholder `GH_EXPR`, since they are not bash) and
`bash -n`'d:

```
bash -n OK : b. install the toolchain (verified list, proofs-deep-fork.md §3/§6)
bash -n OK : c. rustup (toolchain resolved by the source's own rust-version)
bash -n OK : c2. resolve the pinned toolchain and install cbindgen
bash -n OK : d1. download the release source tarball
bash -n OK : d2. checksum-verify against the published SHA512SUMS
bash -n OK : d3. extract IN FULL and assert the known-missing subtrees
bash -n OK : e2. write the ccache config and the .mozconfig
bash -n OK : f. apply Ziy's C++ patch set (empty set = no-op)
bash -n OK : g1. mach configure
bash -n OK : g2. mach build (real C++ compile, /usr/bin/time -v)
bash -n OK : g3. ccache statistics
bash -n OK : g4. mach package
bash -n OK : i. smoke test: headless boot, screenshot, non-blank + identity
bash -n OK : i2. assert the engine identity in the built product
bash -n OK : j. record the split point and the metered-minutes reality in the job summary

bash -n failures: 0
```

The 5 remaining steps are `uses:` actions (checkout, cache, cache/save ×2,
upload-artifact) — not shells.

### 6.3 Cache steps, as parsed

```
CACHE actions/cache@v4       e1. restore the ccache (keyed on the source revision)
   key  : ccache-gecko-${{ env.GECKO_VERSION }}-${{ hashFiles('patches/*.patch', 'patches/*.toml') }}
   rkeys: ccache-gecko-<same>-${{ hashFiles(...) }}- | ccache-gecko-${{ env.GECKO_VERSION }}- | ccache-gecko-
   if   : (none)

CACHE actions/cache/save@v4 g5. save the ccache (also on a timeout, so a capped run resumes)
   key  : ccache-gecko-${{ env.GECKO_VERSION }}-${{ hashFiles('patches/*.patch', 'patches/*.toml') }}
   if   : always()

CACHE actions/cache/save@v4 g5b. save the ccache under the patch-set prefix (history)
   key  : ccache-gecko-${{ env.GECKO_VERSION }}-${{ hashFiles('patches/*.patch', 'patches/*.toml') }}-${{ github.run_id }}
   if   : always()
```

---

## 7. COST ANALYSIS — with the doc citations

### 7.1 Sources consulted (5 pages, 3 GitHub docs)

| URL | what it told us |
| --- | --- |
| `https://docs.github.com/en/actions/reference/runners/github-hosted-runners` | the two "Standard GitHub-hosted runners" tables. **Public** repo table: `ubuntu-latest` = **4 CPU / 16 GB RAM / 14 GB SSD**, "free and unlimited on public repositories". **Private** repo table: `ubuntu-latest` = **2 CPU / 8 GB RAM / 14 GB SSD**, "These runners use your account's allotment of free minutes, and are then charged at the per minute rates." Also: self-hosted runners are the documented alternative, and larger runners require Team/Enterprise. |
| `https://docs.github.com/en/billing/concepts/product-billing/github-actions` | "GitHub Actions usage is **free** for **self-hosted runners** and for **public repositories** that use standard GitHub-hosted runners." Free-use table: **GitHub Free = 2,000 minutes/month**, 500 MB artifact storage, 10 GB cache storage per repository. "If your account does not have a valid payment method on file, **usage is blocked once you use up your quota**." Baseline minute costs: **Linux 2-core = `actions_linux`, $0.006/min**. Cache storage "is a separate allowance of 10 GB per repository"; cache entries removed after 7 days without access. |
| `https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching` | cache key resolution order (exact `key` → prefix matches → `restore-keys` sequentially → retries on the default branch); "On a cache miss, the action automatically creates a new cache **if the job completes successfully**" (i.e. why a cache/save step is needed for the timeout path); `restore-keys` semantics; 7-day eviction and the 10 GB per-repo cache limit; cache contents are not signed or verified. |
| `https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax` | `jobs.<job_id>.timeout-minutes`: "The maximum number of minutes to let a job run before GitHub automatically cancels it. **Default: 360**"; "If the timeout exceeds the job execution time limit for the runner, the job will be canceled when the execution time limit is met instead" (so 720 = the hosted cap); `runs-on` forms including `[self-hosted, linux]` and the `self-hosted` label; `if: always()` for steps that must run on every job outcome. |
| (plus 2 search results + 2 404 probes on billing URL variants) | used only to locate the canonical billing page above; no cost numbers taken from them. |

Local engine-source facts, all read from `/tmp/firefox-src/firefox-156.0.1`
(supplied by the assignment's own budget — no extra fetches).

### 7.2 The arithmetic

| quantity | value | source |
| --- | --- | --- |
| runner cores (this repo) | **2** | runners doc, private table |
| runner RAM (this repo) | **8 GB** | runners doc, private table |
| local box cores / RAM | 4 / ~5.4 GB | local, compile-readiness.md §5b |
| local full-build estimate | 6-14 h | `deep-fork.md` §6.5 (the workflow's own estimate) |
| **2-core CI estimate** | **12-28 h** | 2-core private runner, slower per core; the link is fixed-cost and the Rust toolchain is serial |
| job cap | **720 min = 12 h** | workflow `timeout-minutes`, GitHub's maximum |
| minutes for one cold run | **~720-1,680 min** | wall × 1 (1 job-minute per wall minute) |
| free allowance | **2,000 min/month** | billing doc, GitHub Free |
| past-quota rate | **$0.006/min** | billing doc, `actions_linux` |

So: **one cold run consumes 36%-84% of the monthly free allowance**, and the
wall-clock estimate *exceeds the 12 h cap*, which means the first hosted run's
outcome may be a cap timeout with ~720 minutes spent and no artifact. That is
the sentence the workflow now carries in its header, its timeout comment and its
job summary.

8 GB RAM is a second, independent risk: the libxul link is a single ~5 GB
process and 8 GB is the whole machine's RAM including the OS and toolchain.
Not proven to OOM — flagged as the risk it is, in the header.

### 7.3 The recommendation for the co-owner

1. **Take the self-hosted runner for the first real build.** It is free
   ("free for self-hosted runners"), it has 4 cores rather than 2, and the box
   already has the toolchain plus the checksum-verified source extracted — the
   only missing piece is registering the runner app. Before enabling it, add
   swap or zram for the ~5 GB libxul link (4 cores but ~5.4 GB RAM), and keep
   the runner registered to the private repo only.
2. **Keep `timeout-minutes: 720`** and accept that a hosted run may end in a
   cap timeout. Do not lower it — that guarantees failure. With g5/g5b saving
   ccache on `always()`, a capped hosted run still banks its compilation.
3. **Treat any hosted run as a deliberate spend**, budgeted against
   2,000 min/month, and expect the account to block further Actions once the
   quota is exhausted unless a payment method is on file (then $0.006/min).
4. **Keep the tag-only + `workflow_dispatch` triggers** (already in place) —
   this is the control that prevents an accidental multi-hour queue.
5. If hosted builds must continue, either configure a spend limit/budget in
   Actions settings or split at the configure/build boundary so a capped run is
   not the whole build.

**Order of operations:** fix patch 0002's include (done here) → write
`.gitignore` → co-owner creates the private repo and pushes (Blocker 1, theirs)
→ confirm the Actions tab state → first build self-hosted (free) → then, and
only then, a hosted tag-cut run with the cost above understood.

---

## 8. What was NOT verified (stated, not papered over)

| claim | status |
| --- | --- |
| `./mach configure` accepts the new option and defines the macro | **unverified** — configure cannot run here (generated headers missing; a full configure is its own build). Evidence is the include-graph trace (§2.2) plus the declaration/`set_define` greps (§2.3) |
| the `configure_error` guard fires on a gate-off build | **unverified** — same reason. Evidence is the static Python parse (§3.5) and the engine precedents (§3.2) |
| the 12-28 h wall-clock estimate | **estimate**, from the 6-14 h local figure scaled to 2 slower cores; not measured |
| 8 GB is enough for the libxul link | **unverified / risk** — not proven to fail |
| Actions enabled by default on the new private repo | **unverified** — no GitHub statement found; check the Actions tab after the push |
| private repo's *cache scope* for a tag-triggered run | **unverified** — the dependency-caching doc documents cache scope for branches vs default vs tags ("cannot access caches created for different tag names"), so a tag-pushed run restores only from its own tag or the default branch. The restore-keys cover the default branch; a tag cut with no cache from `main` will start cold. |
| workflow YAML against GitHub's real parser | structural parse only (PyYAML) + `bash -n`; GitHub's own validation is the remaining check |

