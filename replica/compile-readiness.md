# compile-readiness.md — is the Gecko compile path ready for CI?

**Question answered:** prove `.github/workflows/build-gecko.yml` will build Ziy's Gecko
patches on GitHub Actions, and find every blocker *before* CI minutes are spent.

**Date:** 2026-10-15 · **Machine:** the Ziy box · **Tree tested against:**
`/tmp/firefox-src/firefox-156.0.1` (3.0 GB, extracted from the checksum-verified
`firefox-156.0.1.source.tar.xz`)

> ## STATUS — updated 2026-10-15, after the fix workstream (`replica/proofs-fix-ci.md`)
>
> | # | blocker | status | where |
> | --- | --- | --- | --- |
> | 2 | patch 0002's configure file was never included — the gate was dead | **FIXED (2026-10-15)** | §3c below (finding preserved) + proofs-fix-ci.md §1-4 |
> | 3 | private-repo runner spec / metered minutes / timeout / ccache | **FIXED (2026-10-15)** | §5 below (finding preserved) + proofs-fix-ci.md §5-7 |
> | 1 | no git repo — the co-owner's repo creation | **CO-OWNER (open, not worked)** | §1 and §6 below, unchanged |
>
> The original findings below are preserved verbatim — they are the diagnosis,
> and the record of what was wrong. Each fixed section now opens with a
> **FIXED** banner above its original text; §1/§6 are untouched because creating
> the repo is the co-owner's action. Verdict after the fixes: **BLOCKED on
> §1 only** — the two engineering blockers are cleared.

**Verdict: BLOCKED — 1 primary blocker (no git repo at all), 1 secondary blocker
(will burn minutes), 1 correctness bug (the C++ gate can never compile in).**

The compile path is *mechanically* ready: every workflow `run:` block is valid bash,
the workflow is valid YAML, both C++ patches apply to the real tree byte-for-byte
and reverse cleanly, and the checksum/URL are correct. But the workflow cannot run
until the repo exists on GitHub, and once it does run it will spend hours of CI to
produce a **stock Gecko** build, because the macro the C++ patch is gated on is
never defined (see §3c).

---

## REQUIRED BY THE CO-OWNER: the repo must be PRIVATE

This is a hard requirement, added after the first draft of this document. It changes
both the cost model (§5) and the runner spec (§5, verified): `ubuntu-latest` on a
**private** repo is **2 CPU / 8 GB**, not the 4 CPU / 16 GB that the workflow's
header comment assumes. The workflow header comment is now wrong for the
repo it is guaranteed to run on — see §5 for the corrected numbers and what it means
for the 12h job cap.

---

## 1. REPO READINESS

> **STATUS: CO-OWNER (open) — re-verified 2026-10-15, and now fully prepped.**
> Creating the repo is still outside this workstream's remit: no git write command
> was run, no auth was performed on the co-owner's behalf, nothing was created or
> pushed. What this pass ADDED is the verified sizing, a written-and-checked
> `.gitignore`, and the exact one-command sequence — §6 is the co-owner action list.

### Commands (re-verified, this box, today)

```
$ cd '/home/zen/Documents/brave but not chrome or firefox'
$ git rev-parse --show-toplevel
fatal: not a git repository (or any of the parent directories): .git
$ git remote -v
fatal: not a git repository (or any of the parent directories): .git
$ git status --porcelain
fatal: not a git repository (or any of the parent directories): .git
$ git log --oneline -3
fatal: not a git repository (or any of the parent directories): .git
$ ls -la .git
ls: cannot access '.git': No such file or directory

$ gh auth status           # the co-owner's own gh — read-only
github.com
  ✓ Logged in to github.com account Ziyzennix (keyring)
  - Token scopes: 'delete_repo', 'gist', 'read:org', 'repo'
```

Note the `.gitignore` line below: the earlier pass recorded it MISSING; **it is
present now** (written in the repo-prep pass, §6.2), which is what makes the push
a 44–46 MB text push instead of a 355 MB binary one.

```
$ ls -la .gitignore
-rw-rw-r-- 1 zen zen 3.9K .gitignore
```

### Results

| check | value |
| --- | --- |
| `git rev-parse --show-toplevel` | **`fatal: not a git repository`** — exit 128 |
| `git remote -v` | **`fatal: not a git repository`** — exit 128 |
| `.git` directory | **does not exist** (no `.git`, no nested repos, no commits) |
| `git status` / `git log` | **cannot run** — not a repo |
| `.github/workflows/build-gecko.yml` | present on disk, **committed nowhere** |
| `.gitignore` | **present, 3.9 K, verified with real `git check-ignore`** (§6.2) |
| `gh` auth | **`Ziyzennix`, `repo` scope** — sufficient, nothing created |
| push size | **44–46 MB** tracked (§6.5) |

### Verdict: BLOCKED (primary)

**There is no git repository.** This is not "a repo with no remote" — the directory
is a plain directory of files. Every git command fails before it can answer. The
consequences, and what changed:

- The workflow file is not tracked, not pushed, and has never been pushed. An
  untracked workflow file is invisible to GitHub Actions. Nothing runs.
- **Push is mandatory, not optional.** GitHub Actions only sees a workflow that
  exists in a branch or tag on github.com.
- The only thing that used to stand between this and a working push was the missing
  `.gitignore` — which would have committed 355 MB of `build/` output and 4.8 MB of
  Brave's own UI screenshots into the repo's permanent history. **That is now
  fixed** (§6.2), so the push is a single command for the co-owner (§6.3).
- Because the repo will be **private**, Actions minutes are metered (§5) — so the
  first push must not be paired with a build until §3c is fixed.

---

## 2. PATCH APPLIES CLEANLY to the extracted tree

### Method

The tree at `/tmp/firefox-src/firefox-156.0.1` exists and is complete for these
purposes (`toolkit/components/resistfingerprinting/nsRFPService.cpp`, 126,124
bytes, present). The original tree was **never modified** — the patches were applied
to a copy of the `toolkit/` subtree only (230 MB, `cp -a`), in `/tmp/ziy-apply-test/tree`.

The command is the workflow's own apply logic (step *f*): `cd` into the source tree,
then `git apply --check --verbose` → `git apply --stat` → `git apply`, with the
default `-p1` path stripping. `git apply` needs no `.git` for this — the release
tarball is a plain directory, and the patch's `a/` `b/` prefixes resolve against it.

### Evidence (verbatim)

**Patch 0001 — dry run:**

```
$ git apply --check --verbose .../patches/0001-rfp-colorscheme-carveout.patch
Checking patch toolkit/components/resistfingerprinting/nsRFPService.cpp...
RC_CHECK_0001=0
```

**Patch 0001 — stat, then real apply:**

```
$ git apply --stat .../patches/0001-rfp-colorscheme-carveout.patch
 .../resistfingerprinting/nsRFPService.cpp          |   35 ++++++++++++++++++++
 1 file changed, 35 insertions(+)

$ git apply --verbose .../patches/0001-rfp-colorscheme-carveout.patch
Checking patch toolkit/components/resistfingerprinting/nsRFPService.cpp...
Applied patch toolkit/components/resistfingerprinting/nsRFPService.cpp cleanly.
RC_APPLY_0001=0
```

**Patch 0002 — dry run, stat, real apply:**

```
$ git apply --check --verbose .../patches/0002-ziy-fingerprinting-option.patch
Checking patch toolkit/ziy-fingerprinting.configure...
RC_CHECK_0002=0

$ git apply --stat .../patches/0002-ziy-fingerprinting-option.patch
 toolkit/ziy-fingerprinting.configure |   35 ++++++++++++++++++++++++++++++++++
 1 file changed, 35 insertions(+)

$ git apply --verbose .../patches/0002-ziy-fingerprinting-option.patch
Checking patch toolkit/ziy-fingerprinting.configure...
Applied patch toolkit/ziy-fingerprinting.configure cleanly.
RC_APPLY_0002=0
```

`toolkit/ziy-fingerprinting.configure` was created by the apply (1,538 bytes).

**Reverse check — both patches are well-formed diffs:**

```
$ git apply --reverse --check .../0001-rfp-colorscheme-carveout.patch
RC_REV_0001=0
$ git apply --reverse --check .../0002-ziy-fingerprinting-option.patch
RC_REV_0002=0
```

And the reverse was applied for real, not just checked, then compared to the pristine file:

```
$ git apply --reverse .../0001-... && git apply --reverse .../0002-...
$ diff -q .../nsRFPService.cpp .../nsRFPService.cpp
IDENTICAL TO PRISTINE (bit-for-bit restore confirmed)
$ ls toolkit/ziy-fingerprinting.configure
ls: cannot access ...: No such file or directory   # the added file is removed again
```

### Verdict: PASS (both patches, check + apply + reverse)

0 failures, 0 rejects. Context lines match the upstream file byte-for-byte — which is
exactly what `git apply --check` proves, and it is the real evidence for §3b below.
`git apply` is fuzz-free here, so no partial hunk could be hiding.

---

## 3. SYNTAX-VERIFY the patched C++

### 3a. Brace/paren balance — PASS (verified)

A counter over the whole patched function
(`nsRFPService::HandleExceptionalRFPTargets`, file lines 296–352 in the patched
copy) that skips strings, char literals and both comment forms:

```
function length: 57 lines
final balance: {'brace': 0, 'paren': 0, 'brack': 0}
underflow errors: []
VERDICT: BALANCED
whole-file brace count: 421 open / 421 close
```

The inserted block is an `#ifdef`/`#endif` pair around one `if (...) { ... }` with
three nested `if`s — it introduces no new open brace without a close.

### 3b. Hunk context vs upstream — PASS (via `git apply --check`)

The upstream file, before patching, at the insertion point (lines 296–301):

```
Maybe<bool> nsRFPService::HandleExceptionalRFPTargets(
    RFPTarget aTarget, bool aIsPrivateMode,
    FingerprintingProtectionType aMode) {
  MOZ_ASSERT(GetFingerprintingProtectionType(aIsPrivateMode) !=
             FingerprintingProtectionType::None);

  // IsAlwaysEnabledForPrecompute is used to enable fingerprinting protections.
```

The patch hunk header is `@@ -299,6 +299,41 @@` and its context lines are
`MOZ_ASSERT(GetFingerprintingProtectionType(aIsPrivateMode) !=`,
`           FingerprintingProtectionType::None);` and the blank line above the
`IsAlwaysEnabledForPrecompute` comment — all three match the upstream text above
exactly. `git apply --check` returning 0 on both patches is the proof that every
context line matches byte-for-byte (it refuses on any mismatch, and it has no
`--recount`/fuzz fallback by default).

**A full `-fsyntax-only` parse was attempted and fails for the expected reason:**

```
$ /usr/lib/llvm-19/bin/clang++ -fsyntax-only -std=c++20 \
      -I. toolkit/components/resistfingerprinting/nsRFPService.cpp
In file included from toolkit/components/resistfingerprinting/nsRFPService.cpp:5:
toolkit/components/resistfingerprinting/nsRFPService.h:10:10: fatal error:
  'ErrorList.h' file not found
   10 | #include "ErrorList.h"
1 error generated.
RC=1
```

`ErrorList.h` is a configure-generated header — the failure is exactly the
"missing generated headers" case, not a defect in the patch. `clang++-19` exists at
`/usr/lib/llvm-19/bin/clang++` and `/usr/bin/clang++-19` (clang 19.1.1,
`1:19.1.1-1ubuntu1~24.04.2`, dpkg-verified), matching the proof doc's version.

### 3c. Gate consistency — **FAIL: a real bug. The C++ patch can never compile in.**

> **FIXED — 2026-10-15.** The diagnosis below is preserved exactly as written.
> The fix: `patches/0002-ziy-fingerprinting-option.patch` was regenerated to add
> the missing `include("ziy-fingerprinting.configure")` to `toolkit/moz.configure`
> (plus a configure-time `configure_error()` guard so a gate/prefs mismatch fails
> loudly instead of shipping stock Gecko silently). Verified by applying both
> patches to a pristine copy (`git apply --check` RC=0, `git apply` RC=0,
> `git apply --reverse --check` RC=0 for both, and a real reverse that restores
> `toolkit/moz.configure` bit-for-bit, md5 `6ee09a6f…`), by grepping the applied
> tree for the include at `toolkit/moz.configure:4647`, and by the full
> include-graph trace `configure.py:171 → moz.configure:519 →
> init.configure:995 → browser/moz.configure:54 → toolkit/moz.configure`.
> All evidence: `replica/proofs-fix-ci.md` §1-§3.

The instructions asked for three things to agree: the macro in patch 0001, the macro
in patch 0002, and the gate in the workflow's `.mozconfig` step. All three *do*
spell the macro identically — but that agreement is not sufficient, because
**patch 0002's file is never read by Gecko's configure**, so the option is never
declared, so the macro is never defined, so patch 0001's `#ifdef` is false.

**What is consistent (verified by grep across the repo):**

| location | string |
| --- | --- |
| `patches/0001-...patch:43,76` | `#ifdef MOZ_ZIY_FINGERPRINTING` / `#endif` |
| `patches/0002-...patch:41` | `set_define("MOZ_ZIY_FINGERPRINTING", ziy_fingerprinting)` |
| `.github/workflows/build-gecko.yml:393` | `ac_add_options --enable-ziy-fingerprinting` |

**Why the gate is nevertheless dead** (traced through Gecko's configure machinery,
file by file):

1. `configure.py:171` loads exactly one entry point:
   `sandbox.include_file(os.path.join(os.path.dirname(__file__), "moz.configure"))`
   — the **root** `moz.configure` only. There is no directory scan for `.configure` files.
2. Root `moz.configure:519` does `include(include_project_configure)`, and
   `build/moz.configure/init.configure:990` resolves it as
   `os.path.join(base_dir, project[0], "moz.configure")` — i.e. **`browser/moz.configure`**.
   (`browser/moz.configure:54` then includes `../toolkit/moz.configure`, so
   `toolkit/moz.configure` *is* on the path.)
3. **`toolkit/moz.configure` includes exactly five files and nothing else:**

```
$ grep -n "include(" toolkit/moz.configure
480:include("../js/moz.configure")
485:include("../build/moz.configure/node.configure")
1162:include("../build/moz.configure/keyfiles.configure")
3175:include("../build/moz.configure/nss.configure")
4053:include("../build/moz.configure/update-programs.configure")
```

   `toolkit/ziy-fingerprinting.configure` is **not** among them, and
   `CONFIGURE_DEFINE_FILES` is not how `.configure` scripts are loaded either
   (the root `moz.build:293` entry there lists the generated header
   `mozilla-config.h`, not a script).

**The failure this produces.** The workflow's `.mozconfig` contains
`ac_add_options --enable-ziy-fingerprinting`. Patch 0002's own comment states the
mechanism precisely: *"`./mach configure` hard-fails on any option it does not know
("Unknown option: %s", python/mozbuild/mozbuild/configure/__init__.py:564)"* — and
that claim is **true**, verified at that exact line:

```
$ grep -n "Unknown option" python/mozbuild/mozbuild/configure/__init__.py
564:            msg = "Unknown option: %s" % without_value
```

So the first CI run aborts at `./mach configure` (step *g1*) with
`Unknown option: --enable-ziy-fingerprinting` — after the ~10 min of
toolchain install, ~5 min tarball download and ~2 min extraction. Money spent,
zero compilation.

Even if configure were made to tolerate the unknown option, the macro would still
never be defined (the `set_define` lives in a file configure never executes), so
patch 0001's `#ifdef` would evaluate false and the build would be **stock Gecko
that silently ignores the patch** — the worse of the two outcomes, because it looks
like a pass.

The patch's own rationale ("Declared as a real option so ac_add_options can pass
it", "the file lands on the pristine source tree at patch-apply time") is
half-right: the file does land on disk, but landing on disk is not the same as
being included in the configure graph.

**Fix (one line, in patch 0002's file or in the patch's target):** the new file must
be reachable. Two ways, both small: (a) add an `include("ziy-fingerprinting.configure")`
to `toolkit/moz.configure` in patch 0002 (it already patches the tree), or
(b) move the `option()`/`set_define()` block into an existing included file.
Option (a) keeps Ziy's changes in one patch and is the cleaner seam. Until then the
workflow **must not** be run — it cannot succeed.

**Side note, not a blocker:** patch 0001's C++ uses `Preferences::GetString`,
`RESIST_FINGERPRINTINGPROTECTION_OVERRIDE_PREF`, `FingerprintingProtectionType::RFP`,
`RFPTarget::CSSPrefersColorScheme` and `Some(false)`. All were verified present:
the pref macro at `nsRFPService.cpp:114`, `Preferences::GetString` already used in
this exact file at `:347` with an `nsAutoString` local (identical shape to the
patch's usage), `CSSPrefersColorScheme` at `RFPTargets.inc:14`, and the enum at
`nsRFPService.h:722`. The claim that `HandleExceptionalRFPTargets` is consulted
*before* the RFP short-circuit is also **verified true** at `nsRFPService.cpp:339-356`
— the exceptional-target check precedes `if (mode == FingerprintingProtectionType::RFP) return true`.
(Unverified, and unknowable here without a full compile: whether `kNotFound` resolves
in this TU's namespace. It is `nsAString::kNotFound`, pulled in via `nsRHPService.h`'s
string headers in practice; a full-configure build is the only proof.)

---

## 4. WORKFLOW SELF-CONSISTENCY

### 4.1 YAML validity — PASS

```
$ python3 -c "import yaml; print(yaml.__version__)"
PyYAML 6.0.1
PyYAML 6.0.1 parse: OK
top-level keys: ['name', True, 'permissions', 'env', 'jobs']
jobs: ['build-gecko']
  job build-gecko: runs-on='ubuntu-latest' timeout=720 steps=19
```

`on:` parses as the boolean `True` key — a YAML 1.1 truthiness artifact, not a defect;
GitHub's own parser expects that. Triggers resolve correctly:
`workflow_dispatch` (input `note`, string) and `push.tags: ['v*', 'gecko-*']`.
19 steps, all with exactly one of `run:`/`uses:`, no empty run blocks.

### 4.2 Every `run:` block is valid bash — PASS

Each of the 15 shell steps was extracted to a file and `bash -n`-checked:

```
bash -n OK : b. install the toolchain
bash -n OK : c. rustup
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
bash -n OK : j. record the split point in the job summary

bash -n failures: 0
```

The remaining 4 steps are `uses:` actions (checkout, cache, cache/save,
upload-artifact) — not shells.

### 4.3 `${{ }}` expressions — PASS

13 expressions, none malformed, all balanced: `env.GECKO_VERSION` (×7),
`hashFiles('patches/*.patch', 'patches/*.toml')` (×2), `github.run_id` (×2),
`github.event.inputs.note` (×2).

### 4.4 Referenced paths and constants

| referenced | exists? | note |
| --- | --- | --- |
| `patches/*.patch` | **yes** | 2 files: `0001-`, `0002-` (apply verified in §2) |
| `patches/*.toml` | **no** | `patches/` holds only 2 `.patch` + `README.md`. The ccache key and the step-*f* TOML sweep therefore match nothing. Not a blocker — the key just lacks that term, and the loop is guarded by `[ -e "$t" ]` |
| `GECKO_RELEASE_URL` | **yes, HTTP 200** | `https://ftp.mozilla.org/pub/firefox/releases/156.0.1/source` — verified live, `content-type: application/x-tar` |
| checksum constant vs `proofs-deep-fork.md` §5 | **MATCH** | see below |

**Digest comparison (both sides stated):**

- `proofs-deep-fork.md` §5 claims:
  `80a32a79268b672206f5477ca6bfde620cb7419b27aac090e01f06df06990ee0bbd81bb5c4aa78ac1d0edb26b133b1c6fa11cb6522445eccd70c82e719a24d5b`
- workflow step *d2* hardcodes exactly that string as the cross-check constant.
- the tarball on disk (`/tmp/firefox-src/firefox-156.0.1.source.tar.xz`, 806,005,992 bytes) was re-hashed here:

```
$ sha512sum firefox-156.0.1.source.tar.xz
80a32a79268b672206f5477ca6bfde620cb7419b27aac090e01f06df06990ee0bbd81bb5c4aa78ac1d0edb26b133b1c6fa11cb6522445eccd70c82e719a24d5b
```

and the workflow's own grep against Mozilla's `SHA512SUMS` resolves to the same
value: `grep 'source/firefox-156.0.1.source.tar.xz$' SHA512SUMS | awk '{print $1}'`.

**Verdict: MATCH on all three.** The digest is correct, the URL is live, and the
workflow's cross-check will pass.

**One genuine inconsistency, minor:** step *d2* does
`cat firefox-"$GECKO_VERSION"/sourcestamp.txt 2>/dev/null || echo "(sourcestamp.txt read after extraction)"`
*before* extraction (extraction is step d3), so it always prints the fallback echo
and never the stamp. Cosmetic — no effect on the build.

---

## 5. COST REPORT (private-repo numbers, corrected)

> **FIXED IN THE WORKFLOW — 2026-10-15.** Everything below remains true as an
> analysis and is preserved. What changed is that the workflow no longer
> contradicts it: `.github/workflows/build-gecko.yml` now states 2 CPU / 8 GB for
> private repos (4 CPU / 16 GB for public) and that this repo is private by
> design, builds with `MOZ_PARALLEL_BUILD=2`, carries the 12-28 h-vs-720-min-cap
> reality in its header, its `timeout-minutes` comment and its job summary, keeps
> `timeout-minutes: 720` with the mitigations (self-hosted runner first, paid
> runner/past-quota minutes second, configure/build split third), and saves
> ccache under a **stable** key with `if: always()` (plus a run-scoped history
> key) so a capped run resumes instead of restarting. There is also a
> commented-out `runs-on: self-hosted` block for the co-owner, and step *f* now
> asserts the patch wiring is physically on the tree before configure runs.
> Full diff-level record: `replica/proofs-fix-ci.md` §5-§7.

### The runner is smaller than the workflow assumes

Verified from the two GitHub docs pages (one fetch each):

| | public repo | **private repo** (ours) |
| --- | --- | --- |
| `ubuntu-latest` CPU | 4 | **2** |
| `ubuntu-latest` RAM | 16 GB | **8 GB** |
| SSD | 14 GB | 14 GB (same) |
| minutes | **free, unlimited** | **2,000/month on GitHub Free** |

Source: `docs.github.com/en/actions/reference/runners/github-hosted-runners` — the
"Standard GitHub-hosted runners for **private** repositories" table lists
`ubuntu-latest` as **2 CPU / 8 GB**.

Two consequences, both worth a line in the workflow header:

1. **The workflow's header comment is wrong** for the repo it runs on: it says
   "4 CPU / 16 GB" and says `-j4`/`MOZ_PARALLEL_BUILD=4` "is both boxes' number".
   On a private repo the runner has 2 cores, so `-j4` oversubscribes. The local box's
   `nproc=4` is irrelevant to the runner it will actually get.
2. **8 GB RAM is a named risk.** The workflow itself documents that the libxul link
   is a single ~5 GB process and that 16 GB is "headroom, not a cliff"
   (`proofs-deep-fork.md` §7, `deep-fork.md` §6.6). At 8 GB with the OS and the
   toolchain resident, a ~5 GB link process leaves little margin — this is the
   local box's OOM risk arriving on CI. Not proven to fail; flagged.

Also verified from the billing page: **self-hosted runners are free** ("GitHub
Actions usage is **free** for **self-hosted runners** and for **public
repositories**"), minutes on private repos "reset to the full amount at the start of
each billing cycle", and "If your account does not have a valid payment method on
file, usage is blocked once you use up your quota" — i.e. an unconfigured account
stops mid-build rather than billing.

### The cost arithmetic

The workflow's own honest estimates, from `proofs-deep-fork.md` §6.5 and the job's
`timeout-minutes: 720`:

- configure: ~2–3 min once the tree is complete
- `mach build`: **6–14 h** on 4 Haswell cores (local), and the workflow's own header
  admits "a GitHub runner is slower per core than this box but has the same core
  count" — but it does **not** have the same core count: 2, not 4.

A 2-core runner is not merely 2× slower than the 4-core local box for the parallel
compile phase; the single-process libxul link is fixed-cost, and the Rust toolchain
build is a "large serial cost" in the workflow's own words. Treating the 6–14 h
local figure as the 4-core baseline, the honest 2-core CI range is roughly
**12–28 h** wall.

| scenario | wall (2-core private runner) | CI minutes (GitHub Free, 2,000/mo) |
| --- | --- | --- |
| configure + build + package, ccache **cold** | ~12–28 h | **~720–1,680 min** |
| same, ccache **warm** (cache hit from an earlier run) | ~6–16 h | ~360–960 min |
| worst case (job cap) | 12 h, then killed | 720 min wasted |

**Free-tier implication, stated plainly.** GitHub Free private repos get
**2,000 minutes/month**, not the 2,000 of a public repo's *unlimited* free tier and
not the "~500" of the earlier draft — 500 MB is the *artifact storage* allowance
(GitHub Free row: "500 MB artifact storage, 2,000 minutes"). One cold run of this
workflow consumes **essentially the entire monthly private free allowance in ONE
run**, and a warm re-run can still eat half of it. A second run in the same month
either waits for the reset, blocks (no payment method on file), or starts billing at
Linux 2-core `actions_linux` = **$0.006/min** past the quota.

So: **running this workflow monthly on a private repo is a cost decision, not a
default.** It must be recorded as one.

### Mitigations (in preference order)

**(a) `workflow_dispatch` only — already in place.** The workflow triggers on manual
dispatch and tag pushes only, never on branch push. This is the single most
important control and it is correct: no cron, no per-PR build, no accidental queue.
*Keep it.* Consider also tightening the tag trigger while iterating, since a
mistyped tag pushes a multi-hour job.

**(b) Self-hosted runner on the co-owner's box — free, and this box is nearly ready.**
Verified free by the billing doc. This box already has: clang/llvm 19.1.1,
rustc 1.90.0 + cargo 1.90.0, cbindgen 0.29.4, nasm 2.16.01, yasm 1.3.0, ccache 4.9.1,
mercurial 6.7.2, the full apt deps list, **and the checksum-verified 156.0.1 source
already extracted at `/tmp/firefox-src/firefox-156.0.1`** with a `.mozconfig` that
reached configure attempt 13. What is missing is only the runner application
(`gh` is authenticated as `Ziyzennix` with `repo` scope; installing a self-hosted
runner is a documented, cheap step). Two honest caveats: the box has **4 cores**
(better than CI's 2) but only **~5.4 GB available RAM**, which is the named libxul
link-OOM risk (`deep-fork.md` §6.5 risk 2) — swap/zram converts that to a thrash
rather than a crash. And a self-hosted runner for a *private* repo must be kept
private; do not register it against a public fork.

**(c) An alternative runner — Hostinger / VPS / other CI.** The cost-conscious path
when hosted GitHub minutes are unacceptable: a small always-on VPS with 4 cores and
8–16 GB runs the same workflow under a self-hosted runner for a flat monthly fee,
which is cheaper than ~1,500 metered minutes. Documented here as the option to price
out; not further verified in this review.

**Recommended:** use (a) as-is, and take **(b)** for the first real build — it is
free, it uses hardware and a source tree that already exist, and it keeps the 2,000
minute allowance intact for genuine iteration. Keep the GitHub path for tag cuts.

---

## 6. Creating the repo (co-owner action)

> **Re-verified 2026-10-15 (later pass).** The state recorded below is now
> reproduced verbatim against the current box: there is still **no git
> repository at the project root**, there is still **no remote**, and `gh` is
> still authenticated as `Ziyzennix`. The `.gitignore` this section once listed as
> MISSING **has been written** in the intervening pass (see §6.2) — so the
> "Fallback if `--source=.` fails" branch below is no longer the expected path,
> but is kept because it is the honest record of what CONDITION that advice
> applied to. The two things this pass ADDED are the exact command sequence with
> the enable-Actions and workflow_dispatch UI steps, and the push-size arithmetic
> at 1 MB/s. The earlier "unverified" flag on the Actions-for-private-repos
> question is pulled forward unchanged, flagged at §6.4.

### 6.1 gh state (read-only checks only — re-verified)

```
$ gh --version
gh version 2.45.0 (2025-07-18 Ubuntu 2.45.0-1ubuntu0.3

$ gh auth status
github.com
  ✓ Logged in to github.com account Ziyzennix (keyring)
  - Active account: true
  Git operations protocol: https
  Token: gho_************************************
  Token scopes: 'delete_repo', 'gist', 'read:org', 'repo'
```

**gh is installed AND already authenticated as `Ziyzennix`, with `repo` scope
(sufficient to create and push a private repo).** Nothing was created, no auth was
performed on the co-owner's behalf, and no git write command was run in that pass
or this one.

The repo state, verbatim from the same pass:

```
$ git rev-parse --show-toplevel
fatal: not a git repository (or any of the parent directories): .git
$ git remote -v
fatal: not a git repository (or any of the parent directories): .git
$ git log --oneline -3
fatal: not a git repository (or any of the parent directories): .git
$ ls -la .git
ls: cannot access '.git': No such file or directory
```

**No git repository exists at all** — no `.git`, no commits, no remote. This is
the current truth on this box; `compile-readiness.md` §1's earlier record of the
same is not stale.

### 6.2 `.gitignore` — written, and it now covers the screens too

```
$ ls -la .gitignore
-rw-rw-r-- 1 zen zen 3.9K .gitignore      # present
```

Written in an earlier pass. What it excludes, and why:

| path | size | why it must be ignored |
| --- | --- | --- |
| `build/` | **355 MB** | generated by `tools/build-shell.sh`; contains full app dirs, the packaged XPIs, and patch logs |
| `replica/screens/*.png` + `replica/screens/behavior/` | **4.8 MB** | captures of the ORIGINAL Brave UI — see below |
| `node_modules/` | 0 MB today | listed so a future install cannot sneak one into a commit |
| `*.xpi` | 0 MB tracked | build outputs of `tools/build-extension.sh` |

**Sizing as of this pass (`du`):** `build/` **355 MB**, `replica/screens/`
**4.8 MB** (9 top-level PNGs 1.5 MB + `behavior/` 3.3 MB), whole tree excluding
`build/` and `node_modules/` **46 MB**, of which `brand/` 22 MB, `extensions/`
13 MB, `replica/` 9.9 MB, `tools/` 700 K, `shell/` 356 K, `server/` 80 K,
`native/` 180 K, `patches/` 68 K, `.github/` 60 K.

**The screens decision, and why the `.gitignore` differs from this section's first
draft.** That draft said `replica/screens/` "may reasonably stay tracked". **It
must not.** `replica/screens/MANIFEST.md` line 5 says it plainly: *"These files are
design references only — never shipped."* `replica/evidence.md` records them as
OBSERVED-INSTALL — captures taken over CDP against the **user's own Brave Origin
install** (Brave Origin 153.1.95.104) — and states the clean-room rule: *"No JS
bundle was decompiled or read; no `.pak` was unpacked"*, *"Ziy's own code, labels
and design are clean-room."*

A private GitHub repo is still a repo: a second machine, other collaborators, and
a **permanent history**. Pushing another product's copyrighted UI captures into
that permanent history contradicts the very rule the captures exist to document,
and git does not forgive — deleting them afterwards leaves the blobs in every
clone. So they are excluded **before the first commit**, exactly like `build/`,
and the `.gitignore` comment block says so. `MANIFEST.md` and the `replica/*.md`
proofs that cite the PNGs stay tracked, because citations are text, not captures.

**Verified with real `git check-ignore` in a scratch repo** (the repo itself does
not exist yet, so the rules were tested against a throwaway copy of the
`.gitignore`):

```
$ git check-ignore -v replica/screens/brave.png replica/screens/behavior/ntp.png
.gitignore:50:replica/screens/*.png	    replica/screens/brave.png
.gitignore:51:replica/screens/behavior/     replica/screens/behavior/ntp.png
$ git check-ignore -v replica/screens/MANIFEST.md
(no output — correctly NOT ignored)
```

**Why `build/` must be ignored entirely, rather than committing the XPIs:**
`build/ziy/` is a *derived* artifact of `tools/build-shell.sh` (the omni.ja patcher,
the newtab strip, the packaging steps in `deep-fork.md` §1–3), regenerated
deterministically from `tools/`, `shell/` and `extensions/`. Committing it means
every engine bump produces a 355 MB diff of binaries that no human reviews and that
disagree with the source they were derived from. `build/verify/ziy-selftest@ziy.test.xpi`
and the nine `build/ziy/distribution/extensions/*.xpi` are outputs, not inputs.
`build/` is also where the largest files live — offsets of 177 MB, 53 MB and 44 MB
in earlier measurements; several exceeded GitHub's 100 MB hard per-file limit, which
would abort the push itself.

**Nothing outside `build/` needs excluding:** `find . -type f -size +50M` outside
`build/` returns nothing, and there are no `.xpi`, `.pem`, `.jks` or `.env` files
anywhere outside `build/`.

### 6.3 The exact co-owner sequence (one command for the push)

The co-owner's requirement was that the push be **one command**. It is: step 2
below is that command; steps 1, 3 and 4 are git-identity and post-push checks that
must NOT be folded into it (`gh repo create` will not invent a `user.email`).

```bash
# ── 0. run from the project root ────────────────────────────────────────────
cd '/home/zen/Documents/brave but not chrome or firefox'

# ── 1. git identity, one time per machine. gh repo create does not set it, and
#       `git commit` without it aborts. Check first; skip if already set:
git config user.name   || echo "MISSING user.name"
git config user.email  || echo "MISSING user.email"
#    If either is missing (they are — there is no ~/.gitconfig on this box), set:
git config --global user.name  "Ziyzennix"
git config --global user.email "<the address on the GitHub account>"

# ── 2. THE ONE COMMAND: create the private repo and push everything ───────────
gh repo create ziy --private --source=. --remote=origin --push
```

Step 2 does, in order: `git init`, `git add -A` (obeying the `.gitignore` written
in §6.2), `git commit -m "initial"`, `gh repo create ziy --private --source=.`,
`git remote add origin`, and `git push -u origin HEAD`. With the `.gitignore`
present, `build/` and the screens are never staged and the push is **46 MB →
44 MB** of tracked text plus `brand/`'s binaries (see §6.5 for why `brand/` stays).

**Fallback if step 2 reports that the working tree has nothing to add, or aborts on
an untracked-file limit:** the `.gitignore` is present, so this should not happen —
but the honest cause would be a `.gitignore` that git did not read (e.g. it was
written after a `git init` that already had an unrelated index). Diagnose with:

```bash
git status --porcelain | head -30        # what would actually be committed
git status --porcelain | wc -l          # must be small, and must NOT include build/
git ls-files | grep -c '^build/'        # must be 0
```

If `build/` appears there, stop and report it — do **not** `git add -f` past it,
and do not push. A 355 MB first commit is unreviewable and will trip GitHub's
per-file limit.

```bash
# ── 3. Enable Actions for the private repo (UI step, because gh cannot do it
#       for a repo created without an app token) ──────────────────────────────
```

Open, in the co-owner's browser:

```
https://github.com/Ziyzennix/ziy/settings/actions
```

then **Actions → General → Actions permissions → Allow all actions and reusable
workflows → Save**. This is the manual-enable gate that private repos show but
public ones do not; see §6.4 for the verification that this is still needed.

```bash
# ── 4. Launch the Gecko build by hand from the Actions tab ───────────────────
```

Open:

```
https://github.com/Ziyzennix/ziy/actions/workflows/build-gecko.yml
```

The `.github/workflows/build-gecko.yml` file is committed by step 2 and carries a
`workflow_dispatch:` trigger, so this page renders a **"Run workflow"** button:
choose the branch, click **Run workflow**. Nothing builds on push — the workflow's
`on:` is `workflow_dispatch` plus the release/tag triggers, deliberately, because
an accidental push-triggered build would burn the private repo's minute allotment.

Alternative to the UI, same effect:

```bash
gh workflow run build-gecko.yml --ref main
gh run watch            # follow the run's log until it finishes
```

### 6.4 Actions on a private repo: still `unverified`, check it

**Carried forward unchanged from the earlier pass, and still the honest state: I
could not verify a GitHub statement that private repos block Actions until
manually enabled, so this is `unverified` — do not treat it as fact.** What the
docs *do* state: *"By default, GitHub Actions is enabled on all repositories and
organizations"*, and manual enabling is documented only for a workflow that was
**previously disabled** (`gh workflow enable WORKFLOW`, or Settings → Actions →
General → *Enable workflow*). The one private-repo-specific Actions gate the docs
do name is the **fork-PR policy** ("Run workflows from fork pull requests"), which
does not affect a direct push or a `workflow_dispatch` run.

So step 3 above is written as a *check*, not a certainty: open the Actions tab, and
only click the enable toggle if the workflow is listed as disabled. If it is
already enabled, step 3 costs one page load.

The cost consequence is documented and settled in §5: a private repo's
`ubuntu-latest` runner is **2 CPU / 8 GB** and minutes are metered at
**2,000/month on GitHub Free**, one cold run is ~2,000–3,000 minutes of that, and
the self-hosted runner is the free path. That is a decision for the co-owner, not
a blocker for the push.

### 6.5 What is deliberately NOT ignored (and why `brand/` is)

`build/` is ignored; `brand/` is not, even though it is 22 MB of the 46 MB tree
(45 files: SVG logo variants and 24–96–256 PNG renders). It is **input, not
output**: `brand/logo.svg` and the icon PNG renders are what `tools/build-shell.sh`
packages into the app's icon set, and `replica/design/icon.md` §0 records the
palette/glyph rules that `brand/logo.svg` must satisfy. Ignoring it would make the
app unbuildable from a fresh clone.

`patches/` (68 K), `.github/` (60 K), `tools/`, `shell/`, `server/`, `native/`,
`extensions/` (13 MB) and `replica/` (9.9 MB) are all hand-written source or proof
text. `brand/` and `extensions/` are the only tracked binaries.

**The push is 44–46 MB total.**

---

## READY / BLOCKED verdict

> **Updated 2026-10-15.** The verdict below was written before the fix
> workstream and is preserved verbatim. Blocker 2 and Blocker 3 are now
> **FIXED** (see the banners at §3c and §5, and `replica/proofs-fix-ci.md` for
> the evidence). Only Blocker 1 remains, and it is the co-owner's action.

### **BLOCKED**

The compile path is mechanically sound — patches apply, workflow parses, bash is
valid, checksum and URL are correct — and none of that needs redoing. Three
blockers, in the order they must be cleared:

**Blocker 1 (primary, must be first): there is no git repository.** — **still
open as of 2026-10-15 (re-checked), and now fully prepped for the co-owner.**
`git rev-parse --show-toplevel`, `git remote -v`, `git log --oneline -3` all fail
with `fatal: not a git repository`; there is no `.git`, no commits. The `.gitignore`
that this blocker used to depend on **has been written and verified with real
`git check-ignore`** (§6.2), and the exact command sequence for the co-owner is in
§6.3. GitHub Actions runs nothing until the repo exists on github.com and the tree
is pushed — so the push itself is required, not a formality.

*Cleared by:* the co-owner running, from the project root:

```
gh repo create ziy --private --source=. --remote=origin --push
```

`gh` is already authenticated as `Ziyzennix` with `repo` scope, so after a go-ahead
this is **one command** plus, if `user.email` is unset (it is — there is no
`~/.gitconfig` on this box), a `git config --global user.email` first. Nothing in
this pass created, pushed, or modified any git state.

**Blocker 2 (will burn minutes): patch 0002's configure file is never included, so
the C++ gate is dead.**
`toolkit/ziy-fingerprinting.configure` lands on disk but is not in Gecko's
configure include graph (`configure.py:171` → root `moz.configure:519` →
`browser/moz.configure:54` → `toolkit/moz.configure`, which includes exactly 5 other
files and not this one). Result: `./mach configure` hard-fails with
`Unknown option: --enable-ziy-fingerprinting` at
`python/mozbuild/mozbuild/configure/__init__.py:564` — after the download and
extraction are paid for. If that error were suppressed instead of fixed, the macro
stays undefined, patch 0001's `#ifdef` is false, and the workflow would report a
**green build of stock Gecko that silently ignores the patch**. *Cleared by:* adding
`include("ziy-fingerprinting.configure")` to `toolkit/moz.configure` from within
patch 0002 (one line; patch 0002 already edits the tree). **Do not spend CI minutes
before this is fixed.**

**Blocker 3 (cost, not correctness): a private repo makes this a paid decision.**
`ubuntu-latest` on a private repo is **2 CPU / 8 GB** (not 4/16), and minutes are
metered at **2,000/month on GitHub Free** — so one cold run costs ~720–1,680 minutes,
essentially the whole monthly allowance, and it may hit the 12 h job cap on 2 cores
(estimated 12–28 h wall). *Cleared by:* treating the run as a deliberate spend, and
preferring the free self-hosted runner on this box (toolchain + checksummed source
already present) for the first real build (§5(b)).

**Cosmetic/non-blocking:** step *d2* reads `sourcestamp.txt` before extraction
(always prints the fallback echo); `patches/*.toml` matches nothing so the ccache
key omits that term; the workflow header's "4 CPU / 16 GB" comment is wrong for a
private repo and should be corrected.

**Suggested order of operations:** fix patch 0002's include (Blocker 2) → write
`.gitignore` → co-owner creates the private repo and pushes (Blocker 1) → confirm
the Actions tab state (cheap, `unverified` assumption) → first build on the
self-hosted runner (Blocker 3) → then, and only then, a hosted tag-cut run.
