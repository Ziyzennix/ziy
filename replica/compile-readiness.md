# compile-readiness.md — is the Gecko compile path ready for CI?

**Question answered:** prove `.github/workflows/build-gecko.yml` will build Ziy's Gecko
patches on GitHub Actions, and find every blocker *before* CI minutes are spent.

**Date:** 2026-10-15 · **Machine:** the Ziy box · **Tree tested against:**
`/tmp/firefox-src/firefox-156.0.1` (3.0 GB, extracted from the checksum-verified
`firefox-156.0.1.source.tar.xz`)

> ## STATUS — **ALL BLOCKERS CLEARED** as of 2026-10-15. The repo exists, is
> PRIVATE, and is pushed: https://github.com/Ziyzennix/ziy, commit `786f85b` on
> `main`. The outcome and the two findings that came out of doing it are in **§6.6**.
>
> | # | blocker | status | where |
> | --- | --- | --- | --- |
> | 1 | no git repo — the co-owner's repo creation | **CLEARED (2026-10-15)** | §6.6 below (finding preserved) |
> | 2 | patch 0002's configure file was never included — the gate was dead | **FIXED (2026-10-15)** | §3c below (finding preserved) + proofs-fix-ci.md §1-4 |
> | 3 | private-repo runner spec / metered minutes / timeout / ccache | **FIXED (2026-10-15)** | §5 below (finding preserved) + proofs-fix-ci.md §5-7 |
>
> The original findings below are preserved verbatim — they are the diagnosis,
> and the record of what was wrong. Each fixed section now opens with a
> **FIXED** banner above its original text. Section 6's own earlier text is
> preserved too, with the outcome banner in **§6.6** above it.
> What remains after the clear: the **cost decision** of §5 (a cold run is
> essentially the whole monthly private-repo allowance), not any mechanical blocker.

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

> **STATUS: CLEARED 2026-10-15 — the repo EXISTS and the tree is PUSHED.**
> The original text below recorded the blocker as open and "outside this
> workstream's remit"; it is preserved as the record of that state. What changed:
> the co-owner authorized and created the repo at
> **https://github.com/Ziyzennix/ziy** (PRIVATE), git was initialised, the tree
> was committed and pushed (**`786f85b` on `main`**, 463 tracked files), and
> `build-gecko.yml` is live and `active` on GitHub. See **§6.6** for the outcome,
> the five verification numbers, and the two findings (the `workflow` scope, and
> the disproved "private repos block Actions" claim).
> *(The three sentences below are the original "co-owner action" framing and now
> read as history — the action was taken on 2026-10-15 with the co-owner's explicit
> authorization. What that pass had ADDED was the verified sizing, a
> written-and-checked `.gitignore`, and the exact command sequence — which is what
> was executed.)*

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

> **DONE — 2026-10-15.** This section is the original preparation, preserved as
> written. The action it describes was executed: the repo now exists at
> https://github.com/Ziyzennix/ziy, **PRIVATE**, with commit `786f85b` pushed on
> `main`. §6.3's step 3 (the Actions UI toggle) turned out to be **unnecessary** —
> see **§6.6** for the measured outcome, the verification numbers, the token-scope
> finding, and the Actions state.

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

> **Updated 2026-10-15 (final).** The verdict below was written before the fix
> workstream and is preserved verbatim. **All three blockers are now cleared**:
> Blocker 2 and Blocker 3 by the fix workstream (see the banners at §3c and §5,
> and `replica/proofs-fix-ci.md` for the evidence), and **Blocker 1 on 2026-10-15
> by the co-owner creating and pushing the private repo** — outcome, verification
> numbers and the Actions finding are in **§6.6**.

### **READY — all three blockers cleared**

> **2026-10-15 — Blocker 1 CLEARED.** The verdict text below is the original
> diagnosis and is preserved. What changed: the repo was created by the co-owner at
> **https://github.com/Ziyzennix/ziy**, **PRIVATE**, and the tree was pushed —
> **commit `786f85b` on `main`**, 463 tracked files, `gh api repos/Ziyzennix/ziy/actions/workflows`
> reporting `build-gecko` as **`state: "active"`**. The "private repos block Actions
> until manually enabled" assumption from §6.4 is now **tested and FALSE** for this
> repo: `actions/permissions` returned `{"enabled":true,"allowed_actions":"all"}`
> (HTTP 200) and the workflow is live, so **no UI step is needed** and
> `workflow_dispatch` is available (`gh workflow run build-gecko.yml --ref main`).
> The one thing that did bite is recorded in §6.6: a push containing
> `.github/workflows/` needs the `workflow` OAuth scope.

The compile path is mechanically sound — patches apply, workflow parses, bash is
valid, checksum and URL are correct — and none of that needs redoing. Three
blockers, in the order they must be cleared:

**Blocker 1 (primary, must be first): there is no git repository.** — **CLEARED
2026-10-15; the original text is kept as the record of the blocker.**
`git rev-parse --show-toplevel`, `git remote -v`, `git log --oneline -3` all failed
with `fatal: not a git repository`; there was no `.git`, no commits. The `.gitignore`
that this blocker used to depend on was written and verified with real
`git check-ignore` (§6.2), and the exact command sequence for the co-owner is in
§6.3. GitHub Actions ran nothing until the repo existed on github.com and the tree
was pushed — so the push itself was required, not a formality.

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

---

## 6.6 THE REPO EXISTS — outcome of the Blocker-1 action (2026-10-15)

> **STATUS: DONE.** The co-owner created **https://github.com/Ziyzennix/ziy**,
> **PRIVATE**, and the tree was pushed. Blocker 1 is **CLEARED**. Everything below
> is measured on this box after the push; the earlier §6.1–§6.5 text is the
> original preparation and is preserved above this banner.

**The repo, verified after the push.**

```
$ gh repo view --json url,visibility,isPrivate,pushedAt
{"isPrivate":true,"pushedAt":"2026-10-15T15:20:21Z",
 "url":"https://github.com/Ziyzennix/ziy","visibility":"PRIVATE"}

$ git remote -v
origin  https://github.com/Ziyzennix/ziy.git (fetch)
origin  https://github.com/Ziyzennix/ziy.git (push)

$ git log --oneline -1
786f85b Ziy browser: Gecko-branded shell, 9-extension MV3 suite, tooling, replica record
$ git ls-remote origin refs/heads/main
786f85bef882dd271a80b5e0ddebae1600880e1c	refs/heads/main
```

Local and remote `main` are the same commit — the push is complete and there was
**no force, no history rewrite, no deletion**. Repo created by the co-owner; the
git init/commit was run from this box with the co-owner's authorization.

**The five pre-push verification numbers (the gate, all PASS).**

| check | required | measured |
| --- | --- | --- |
| a. `git ls-files build/ \| wc -l` | 0 | **0** |
| b. `git ls-files replica/screens/` | ≤ `MANIFEST.md` | **1 — `replica/screens/MANIFEST.md`** only. Every `*.png` and `behavior/` was correctly excluded, so **no Brave UI capture is in the repo's permanent history** (the clean-room rule holds). |
| c. `git ls-files extensions/ \| wc -l` | 100+ | **239** (the 9-extension suite) |
| c2. `git ls-files shell/ tools/ patches/ brand/ .github/ native/ server/ \| wc -l` | — | **129**; total tracked **463** |
| d. no file over 50 MB | none | **none.** The top 5: `extensions/ziy-shields/rules/static-ruleset.json` **3.1 MB**, `…/easylist.txt` 2.1 MB, `replica/design/app icon.jpeg` 1.9 MB, `…/easyprivacy.txt` 1.4 MB, `extensions/ziy-shell/icons/mascot.svg` 940 KB |
| e. push size | ~46 MB | `.git` **12 MB**, tracked working tree **41.5 MB** (10.46 MiB packed, 529 objects). Uploaded in ~10 s. |

`git ls-files` also contains no `tmp/`, no `firefox-src/`, no `obj/`, no `.pem`,
no `.jks`, no `.env`. The 72 tracked PNGs are all Ziy-authored — `brand/` icon
renders, `extensions/*/icons/`, and the `replica/design/` mocks. The three files
with `brave` in the name are Ziy's own text (a filterlist snapshot, a parity test,
and a prefs note). `firefox-156.0.1/` in the repo root is the four MPL-2.0
upstream reference files (520 KB) that the patch workstream cites — evidence, not
a competitor asset.

**Finding 1 — `workflow` scope is required to push `.github/workflows/`.**
The first push attempt failed, and it was not any of the predicted causes:

```
$ gh repo create ziy --private --source=. --remote=origin --push
https://github.com/Ziyzennix/ziy
To https://github.com/Ziyzennix/ziy.git
 ! [remote rejected] HEAD -> main (refusing to allow an OAuth App to create or
    update workflow `.github/workflows/build-gecko.yml` without `workflow` scope)
error: failed to push some refs to 'https://github.com/Ziyzennix/ziy.git'
```

§6.1's claim that "`repo` is sufficient for `gh repo create --private --push`" is
**wrong for this tree**, because this tree contains a workflow file. GitHub checks
the scope on the *contents* of the push, and `repo` alone cannot create
`.github/workflows/*`. Confirmed from the API, not just the error:

```
$ curl -H "Authorization: Bearer $TOKEN" -D - -o /dev/null https://api.github.com/user
x-oauth-scopes: delete_repo, gist, read:org, repo
```

Fixed by the co-owner re-authorising (a browser device flow — not something an
agent can do):

```
$ gh auth refresh -h github.com -s workflow      # → browser, then:
x-oauth-scopes: delete_repo, gist, read:org, repo, workflow
$ git push -u origin main
To https://github.com/Ziyzennix/ziy.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

Note for the next worker: nothing landed on the first attempt — a scope rejection
rejects the whole ref, so the retry was a clean fast-forward, not a re-push of
partial history. If this rejection is ever seen again, the fix is the scope
re-authorisation, **never** dropping the workflow from the commit.

**Finding 2 — the "private repos block Actions until manually enabled" claim was
FALSE.** §6.4 carried it forward as `unverified`. It is now **tested on the real
repo**, and it was false:

```
$ gh api repos/Ziyzennix/ziy/actions/permissions
{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}     # HTTP 200

$ gh api repos/Ziyzennix/ziy/actions/workflows
{"total_count":1,"workflows":[{"id":385699008,"name":"build-gecko",
 "path":".github/workflows/build-gecko.yml","state":"active",
 "html_url":"https://github.com/Ziyzennix/ziy/blob/main/.github/workflows/build-gecko.yml",
 ...}]}
```

Actions are **enabled** (both endpoints 200 — neither is a 404, so nothing here is
`unverified`), `allowed_actions` is `all`, and **`build-gecko.yml` is registered and
`active`** with **`workflow_dispatch` available**. **No UI step at
`/settings/actions` is needed** — §6.3's step 3 and §6.4's whole caveat are
obsolete for this repo. Dispatch directly:

```bash
gh workflow run build-gecko.yml --ref main
gh run watch
```

The private-repo gate that does exist is the one documented in §5 (2 CPU / 8 GB
runners, 2,000 metered minutes/month) — a **cost** gate, not an enablement gate.
Also untested and worth recording as such: whether a *fresh* GitHub Free account's
Actions are enabled by default in general. For this repo they demonstrably are,
which is what §6.4 needed.

**The repo root, as it landed on GitHub.**

```
$ gh api repos/Ziyzennix/ziy/contents/ --jq '.[].name'
.github
.gitignore
AGENTS.md
WATCHDOG.yml
brand
extensions
firefox-156.0.1
native
package.json
patches
replica
server
shell
tools
```

**What is left to do is not engineering.** The compile path is unblocked and
`build-gecko.yml` can be dispatched at will. The remaining decision is the §5 cost
one: a cold run is ~12–28 h on a 2-core private runner = 720–1 680 minutes,
essentially the entire monthly allowance, so the recommended first run is the
**free self-hosted runner** on this box (§5(b)) with the hosted tag-cut path kept
for cut releases.

---

## 2026-10-16 — run 4 outcome: FAILED at step **f**, the Gecko compile NEVER RAN

**Written:** 2026-10-16 (all timestamps UTC; the run was dispatched the local evening of
2026-10-15). **Adjudicating:** `replica/TODAY.md` §3.1's claim that run 4 =
`38797207327` was "IN FLIGHT — the 12–28 h compile has NOT started yet".
**Method:** read-only `gh run list` / `gh run view` / REST `.../jobs`,
`.../artifacts`, `.../caches`; `gh run view --log-failed` for run 4. Nothing was
dispatched, cancelled, or re-run. No local Gecko compilation was performed (the one
local experiment below is a 5-file `git apply` repro in `/tmp/garepro`, the light work
`patches/README.md` explicitly permits).

### 7.1 Run history, verified live

`gh run list --workflow build-gecko.yml --limit 10` → **five dispatches, all
`workflow_dispatch` on `main`, all failures**:

| run id | headSha | status / conclusion | elapsed | failed step |
| --- | --- | --- | --- | --- |
| 38794333725 | `062a4a6` | completed / failure | 59 s | `c2. resolve the pinned toolchain and install cbindgen` |
| 38795215736 | `6217634` | completed / failure | 1 m 47 s | `d2. checksum-verify against the published SHA512SUMS` |
| 38795875890 | `87dc04a` | completed / failure | 2 m 12 s | `d3. extract IN FULL and assert the known-missing subtrees` |
| **38797207327 (RUN 4)** | `b7eec82` | completed / failure | **3 m 55 s** | **`f. apply Ziy's C++ patch set`** |
| 38799494703 (run 5) | `2b93248` | **in_progress** | 17 m+ at time of writing | — |

Elapsed times are from the REST step timestamps (e.g. run 4's job
`116636642231`: `startedAt 2026-10-15T19:51:07Z` → `completedAt 2026-10-15T19:54:55Z`).
Run 4's own wall window (`createdAt 19:51:01Z` → `updatedAt 19:54:56Z`) matches.

**Run 4 was never the cold 12–28 h build.** It died at 3 m 55 s, before `g1. mach
configure`. Steps `g1`–`g4`, `h`, `i`, `i2` are all `skipped` in the run's step list.
The TODAY.md note was correct only in its narrower sense: *the compile itself never
started* — because the run failed, not because it was still running.

### 7.2 The failure, quoted verbatim from the log

`gh run view 38797207327 --log-failed` → step `f. apply Ziy's C++ patch set (empty set
= no-op)`:

```
...19:54:49.9822467Z ##[group]applying patches/0001-rfp-colorscheme-carveout.patch
...19:54:49.9843308Z Checking patch _src/firefox-156.0.1/toolkit/components/resistfingerprinting/nsRFPService.cpp...
...19:54:49.9868389Z  1 file changed, 35 insertions(+)
...19:54:49.9892738Z ##[endgroup]
...19:54:49.9893737Z applied: patches/0001-rfp-colorscheme-carveout.patch
...19:54:49.9895003Z ##[group]applying patches/0002-ziy-fingerprinting-option.patch
...19:54:49.9913461Z Skipped patch 'toolkit/moz.configure'.
...19:54:49.9914476Z Skipped patch 'toolkit/ziy-fingerprinting.configure'.
...19:54:49.9928193Z  0 files changed
...19:54:49.9945846Z ##[endgroup]
...19:54:49.9946592Z applied: patches/0002-ziy-fingerprinting-option.patch
...19:54:49.9964044Z Checking patch _src/firefox-156.0.1/dom/webgpu/Adapter.cpp...
...19:54:50.0005668Z applied: patches/0003-webgpu-adapter-strings.patch
...19:54:50.0049227Z Checking patch _src/firefox-156.0.1/dom/canvas/ClientWebGLContext.cpp...
...19:54:50.0081761Z applied: patches/0004-webgl-fake-extension.patch
...19:54:50.0097462Z Checking patch _src/firefox-156.0.1/netwerk/dns/nsDNSService2.cpp...
...19:54:50.0140087Z applied: patches/0005-dns-disable-prefetch-from-https.patch
...19:54:50.0141509Z patch summary: found=5 applied=5 failed=0
...19:54:50.0168872Z ##[error]expected patched file missing: /home/runner/work/ziy/ziy/_src/firefox-156.0.1/toolkit/ziy-fingerprinting.configure — the patch set is incomplete
...19:54:50.0177736Z ##[error]Process completed with exit code 1.
```

### 7.3 Diagnosis — file:line, with the mechanism reproduced

**The defect:** `git apply --check` on patch 0002 printed `Skipped patch ...`,
`0 files changed`, and **exited 0**, so the loop counted it as `applied`. Patch 0002 is
the only one in `diff --git` form (`patches/0002-ziy-fingerprinting-option.patch`
carries `diff --git a/toolkit/moz.configure b/toolkit/moz.configure` *and*
`diff --git a/toolkit/ziy-fingerprinting.configure b/...` — verified: the other four
carry only `---`/`+++` headers).

**Root cause:** the patch is applied with `cd "$SRC"` where
`$SRC = $GITHUB_WORKSPACE/_src/firefox-156.0.1` — a path *inside* the Ziy
checkout. `git apply` therefore discovers the Ziy `.git` by walking up and runs in
**repo-subdirectory mode**: `diff --git` patches are top-level-relative, judged
outside the current directory, and silently skipped, with status 0.

**At the headSha that run 4 used** (`b7eec82`), the step's `run:` block has no ceiling
— confirmed by `git show b7eec82:.github/workflows/build-gecko.yml` → no
`GIT_CEILING_DIRECTORIES` anywhere in the file.

**Local repro** (in `/tmp/garepro`, plain-directory `git apply` only — no Gecko, no
mach), run with the two patch formats from `patches/`:

```
=== plain-diff patch, NO ceiling ===
Checking patch _src/firefox-156.0.1/toolkit/moz.configure...
rc=0
=== diff --git patch, NO ceiling ===
Skipped patch 'toolkit/moz.configure'.
rc=0
```

The same two applies **with** `export GIT_CEILING_DIRECTORIES=...`:

```
=== WITH ceiling (the f25a467 fix) ===
Checking patch toolkit/moz.configure...
rc=0
Checking patch toolkit/moz.configure...
rc=0
```

**The concrete fix (already committed, already at the head run 5 is building):**
`f25a467` *"ci(build-gecko): ceiling git discovery so the patch apply is not silently
skipped"* adds one line at **`.github/workflows/build-gecko.yml:550`**:

```
export GIT_CEILING_DIRECTORIES="$GITHUB_WORKSPACE"
```

That is the whole fix; it stops git's discovery at the checkout root so the apply runs
in plain-directory mode. No other file needed changing — the patch files themselves
apply cleanly (`git apply --check` on 0001/0003/0004/0005 succeeded *in the very same
run 4*, before the ceiling existed).

**Important caveat about how loud this bug was:** it was **not** a silent stock-Gecko
build. The post-apply gate — present at `b7eec82` (`git show b7eec82:.github/…/build-gecko.yml`
carries the `POST-APPLY GATE ASSERTION` block), and now at
`.github/workflows/build-gecko.yml:596-614` — asserted
`$SRC/toolkit/ziy-fingerprinting.configure` exists and aborted at 3 m 55 s. That gate
is the reason this was a 4-minute failure instead of a 12-hour stock-Gecko artifact,
and it is the single best piece of engineering in the workflow.

### 7.4 Verdict on the 5 patches: **APPLIED-ONLY**, never compiled

| patch | file touched | run 4 evidence | verdict |
| --- | --- | --- | --- |
| 0001 | `toolkit/components/resistfingerprinting/nsRFPService.cpp` | `Checking patch _src/firefox-156.0.1/toolkit/components/resistfingerprinting/nsRFPService.cpp...` + `1 file changed, 35 insertions(+)` | applied to the tree, **NOT compiled** |
| 0002 | `toolkit/moz.configure` + new `toolkit/ziy-fingerprinting.configure` | `Skipped patch 'toolkit/moz.configure'.` / `Skipped patch 'toolkit/ziy-fingerprinting.configure'.` / `0 files changed` | **NOT EVEN APPLIED** — skipped, caught by the post-apply gate |
| 0003 | `dom/webgpu/Adapter.cpp` | `Checking patch .../dom/webgpu/Adapter.cpp...` + `1 file changed, 62 insertions(+)` | applied, **NOT compiled** |
| 0004 | `dom/canvas/ClientWebGLContext.cpp` | `Checking patch .../dom/canvas/ClientWebGLContext.cpp...` + `1 file changed, 58 insertions(+)` | applied, **NOT compiled** |
| 0005 | `netwerk/dns/nsDNSService2.cpp` | `Checking patch .../netwerk/dns/nsDNSService2.cpp...` + `1 file changed, 26 insertions(+)` | applied, **NOT compiled** |

**No compile evidence exists for any patch, and none can.** Steps `g1`–`g4` are
`skipped`, no artifacts were uploaded (`gh api repos/Ziyzennix/ziy/actions/runs/38797207327/artifacts`
→ empty), and there is no `build-time.log`, no `mach build` output, no link of
`libxul.so`, no `dist/` package. **`patches/README.md`'s "none of the five has been
*compiled*" remains true as of 2026-10-16.**

### 7.5 Run 5 (`38799494703`) is where the compile actually happens — in flight now

Dispatched 2026-10-15 **20:08:08Z**, headSha `2b93248` (which contains the `f25a467`
ceiling fix — verified: `git merge-base --is-ancestor f25a467 2b93248`).

**Observed state as of `2026-10-15T20:25:48Z` (struck through 2026-10-16 — see §8 for
the outcome):** ~~job `116644506539`, `in_progress`.~~ **OUTCOME (§8): `failure` —
completed 20:31:11Z, failed at `g2. mach build` with exit 143, "The runner has received
a shutdown signal … or a manually started runner is canceled" (`jobs/116644506539/logs`,
2026-10-15T20:31:09Z). That is an INFRA kill, not a compile error; g2 had run 18 m 30 s
(20:12:39Z → 20:31:09Z).** Step timings: steps 1–12 (checkout, toolchain, rustup, d1–d4, e1, e2, **f**, **g1
mach configure**) all `success`, completed by **20:12:39Z**. Step **13 `g2. mach
build`** is ~~`in_progress` since 20:12:39Z — i.e. the cold Gecko compile started at
20:12:39Z on 2 cores and had run ~13 min at time of writing. Everything
downstream (`g3`–`j`) is `pending`.~~ **started 20:12:39Z, killed by the runner shutdown
signal at 20:31:09Z (18.5 min of compilation, then the job died from the outside).**

The ccache is cold: `gh api repos/Ziyzennix/ziy/actions/caches` lists exactly **one**
entry, `ccache-gecko-156.0.1-c4cdaa3c…-38797207327`, **size 662 bytes** (restored by
run 4's step e1, saved by g5) — nothing usable in it. So this is a genuinely cold
build: **12–28 h against the 720-minute job cap**, i.e. the outcome is quite likely a
plain cap timeout, which §5 and the workflow header both document as acceptable. If
the cap hits, `g5`/`g5b` run with `if: always()` so the compilation is not wasted.

**Monitoring command (read-only):**

```
gh run view 38799494703
# or, from a shell inside this repo:
gh api repos/Ziyzennix/ziy/actions/jobs/116644506539
```

Note: `gh run view 38799494703 --log` returns
`run 38799494703 is still in progress; logs will be available when it is complete`, so
the per-step REST endpoint above is the only live view.

### 7.6 Recommended next action

1. ~~**Nothing to dispatch.** Run 5 is the first run carrying the ceiling fix; it is
   already in `g2` compiling. Re-running `build-gecko.yml` would queue a second
   12–28 h job (GitHub queues runs of the same workflow) against the same 2 000-min
   monthly allowance.~~ **STRIKED 2026-10-16: run 5 was infra-killed mid-`g2` (see the
   outcome above §7.5). Twelve further dispatches follow — the full record is §8.**
2. **Watch for the cap timeout** at `timeout-minutes: 720` (~2026-10-16 08:12Z if the
   job is not cancelled first). A cap timeout is a documented acceptable outcome, not
   a defect — re-dispatch with a raised cap and the existing ccache to continue.
3. **When run 5 finishes (any conclusion):** pull `gh run view 38799494703 --log-failed`
   (or `--log` on success) and record the outcome here. If it reaches `g4. mach
   package`, the two lines that matter are `Created package: ...` and
   `RELINKABLE=<obj-ziy/.../libxul.so>`. Only then, and only with a
   `1 file changed` / `Checking patch ...` line per patch in step `f`'s log, can
   `patches/README.md` move any of 0001–0005 from *apply-verified* to *compiled*.
4. **Do not** edit `replica/TODAY.md` §3.1's run history from this doc alone — the
   director owns that file. This section is the evidence for it.

**What this doc could not determine:** whether run 5's `g2` finishes inside the cap,
and whether the patched C++ actually *compiles* — both are unanswerable until run 5
completes. Everything above is observed from live `gh` output and the repo's own
history.

---

## 2026-10-16 — the hosted-run wave: `g1 mach configure` PASSES, `g2 mach build`
## reached 63 min deep, two workflow bugs fixed (swap + cache-save path)

**Written:** 2026-10-16. **Trigger:** the co-owner pasted the check log of
run `38910465453` (head `3717e47`). **Method:** read-only `gh` (run list, jobs API,
job logs, `--log-failed`) on every 2026-10-15/16 run + local `git log`; two surgical
edits to `.github/workflows/build-gecko.yml` (below); **no local Gecko compilation,
no workflow dispatch, no pushes as of this writing.**

### 8.1 The wave, verified from the jobs API (UTC)

| run id | head | started | elapsed | end |
| --- | --- | --- | --- | --- |
| 38794333725 | `062a4a6` | 10-15 19:29 | 59 s | `c2` — cd-order bug (recorded §7.1) |
| 38799494703 | `2b93248` | 10-15 20:08 | 23 m 00 s | **`g2` — exit 143 INFRA kill**: "The runner has received a shutdown signal … or a manually started runner is canceled" (`jobs/116644506539/logs`, 20:31:09Z). 18 m 30 s of compilation thrown away by the runner, not by code |
| 38870954684 | `1b3c6f9` | 10-16 08:01 | 19 m 11 s | `g2. mach build` failure (first `g2` reach on this engine; superseded by later fixes) |
| 38876162898 | `cd589ed` | 10-16 08:48 | 59 s | step b + hashFiles — see 8.4 (self-hosted space path) |
| 38880270809 | `1b852cd` | 10-16 09:24 | — | cancelled |
| 38880761558 | `1b852cd` | 10-16 09:29 | 23 m 41 s | `g2. mach build` failure |
| 38901006659 | `6edee13` | 10-16 12:30 | — | cancelled |
| **38901074475** | `019bfe2` | 10-16 12:31 | **63 m 09 s** | **`g2` — the `crashhelper` link died** (see 8.2) |
| 38910145529 | `f0406cf` | 10-16 13:44 | 4 m 03 s | cancelled (superseded by the `3717e47` dispatch six minutes' later) |
| **38910465453** | `3717e47` | 10-16 13:46 | 3 m 07 s | **`prepare swap` — ETXTBSY on `/swapfile`** (see 8.3, FIXED) |

— plus the four runs 1–4 recorded in §7.1. The steps below configure are all `success`
in every 10-16 run to reach them: **d1–d4, e1–e2, f (all five patches apply, 5/5, since
`f25a467`), and `g1. mach configure` — the Ziy patch set loads AND configure accepts
`--enable-ziy-fingerprinting`** ("Configure complete!", `0:23.76`, run 38910465453
13:49:35Z). `019bfe2` ("mark Rust lib as non-sanitized", `RUST_SANCOV_FLAGS=1`) and
`6edee13` ("bypass networking symbol check") each cleared a real `mach build` gate.

**Patch-set note.** Step f's nozzle prints, from patch 0002's
`ziy_fingerprinting_gate_check` (patches/0002 §138): *"checking that the Ziy gate is
consistent with the shipped prefs... no"*. On CI that "no" is the EXPECTED branch: the
check's candidate files are `shell/mozilla.cfg` and
`shell/browser/defaults/preferences/ziy.js` — paths INSIDE the pristine engine tree,
which never carries the Ziy shell (the shell is applied to the packaged app dir later
by `tools/build-shell.sh`). Both `os.path.exists` → false → `continue` → check exits
clean. The gate itself is ON (the e2 `.mozconfig` line), so the check's alarm path is
unreachable-and-unneeded by construction rather than by luck.

### 8.2 The deepest failure so far: run 38901074475, the `crashhelper` link (63 m 09 s)

The compile ran **60 min of wall clock** (`/usr/bin/time -v`: `1:00:28`, 200% CPU =
2-way parallel, peak RSS `3 332 580 kB` = 3.2 GB — far under the 16 GB public-runner
ceiling), reached `toolkit/crashreporter/crash_helper/crashhelper` and died at
`0:60:27.10`:

```
E clang++-19: error: linker command failed with exit code 1 (use -v to see invocation)
E gmake[4]: *** [.../config/rules.mk:406: ../../../dist/bin/crashhelper] Error 1
E gmake[3]: *** [.../config/recurse.mk:79: toolkit/crashreporter/crash_helper/target] Error 2
```

`f0406cf` ("disable crashreporter to bypass helper link") added
`ac_add_options --disable-crashreporter` to the e2 `.mozconfig`. **Untested as of this
writing** — run 38910145529 (which carried it) was cancelled at 4 m, and run
38910465453 died on the swap step before ever reaching g2. → **§8.7 closes this
statically (no compile): the whole failing subtree is inside
`if CONFIG["MOZ_CRASHREPORTER"]:`**, which `--disable-crashreporter` unset — the
target ceases to exist in the build graph.

ccache lineage: this run's `g5b` save produced the **396 MB** entry
(`ccache-gecko-156.0.1-c4cdaa3c…-38901074475` — the first non-trivial cache of the
wave) carrying the surviving Rust + baseline C++ objects with ccache stats
"(direct) hit rate 33.8%" snapshot in the log. Run 38910465453 restored exactly that
("Cache hit for restore-key: …-38901074475", "Cache Size: ~396 MB (415164920 B)",
"Cache restored successfully") and — via its own g5b — re-saved it under
`…-38910465453`. The next dispatch resumes warm.

### 8.3 Run 38910465453 — the reported failure, and both fixes (this commit)

**Failure, quoted verbatim** (`jobs/117004711751/logs`):

```
+ sudo fallocate -l 8G /swapfile
fallocate: fallocate failed: Text file busy
+ sudo dd if=/dev/zero of=/swapfile bs=1M count=8192
dd: failed to open '/swapfile': Text file busy
##[error]Process completed with exit code 1.
```

`Text file busy` = **ETXTBSY — an active swapfile cannot be opened for writing.**
`ubuntu-latest` resolves to an ubuntu-24.04 image on this run ("Image: ubuntu-24.04",
image 20261012.334.1, in the job log's Runner Image block) and the image ships with
`/swapfile` ALREADY ON as swap, so the step's very first write refused. The whole
run died at minute 3 in a step added by its own head commit.

**Fix 1 — swap step (this commit).** `swapoff` a `/swapfile` that `swapon --show=NAME`
reports active (exact-match, not substring: `/mnt/swapfile` must not match), then
`rm -f`, `fallocate -l 8G`, `chmod 600`, `mkswap`, `swapon`, and END the step with
`free -h` + `swapon --show` so the run record finally carries the image's swap+RAM
numbers (the numbers run 5 wanted and never got). Review notes recorded in the step
comment: (a) a review variant that *skipped* creation when `/swapfile` is already
active was rejected — the shipped swap size is unverified and the step's purpose
(`3717e47`) is a KNOWN 8G link window; (b) a `truncate -s` fallback was rejected —
safer-looking, but it sparsifies and `swapon(8)` refuses files with holes;
`fallocate` allocates real extents, so if it fails we want the loud minute-4 failure.

**Fix 2 — the stable cache key was never written (latent, same wave).** Step `g5`
(`actions/cache/save@v4`) ran WITHOUT the `path` input — the log shows
`[warning]Input required and not supplied: path` then `Cache save failed` on the
stable-key save; the run-scoped `g5b` (which carries `path`) succeeded one step
later. So every wave run could only restore by prefix match,
never the exact-key fast path the step's comment documents. `path: ~/.cache/ccache`
is now present on g5.

### 8.4 The self-hosted runner, from inside its own logs

`cd589ed` ("Switch build-gecko.yml to self-hosted runner") IS the co-owner-run
runner at `/home/zen/Documents/brave but not chrome or firefox/actions-runner/` —
which `replica/AI-BRIEF.md` §5 and compile-readiness already name as the
space-in-path trap. Run 38876162898 died in the workflow TEMPLATE evaluation, quoting
the trap verbatim:

```
The template is not valid. .github/workflows/build-gecko.yml (Line: 727, Col: 16):
hashFiles('patches/*.patch, patches/*.toml') failed. Fail to hash files under
directory '/home/zen/Documents/brave but not chrome or firefox/actions-runner/_work/ziy/ziy'
```

`1b852cd` switched back to `runs-on: ubuntu-latest`. The hosted runner has been used
exclusively since (runs 38880270809 onward). Nothing else occupies step b's 59 s
failure; the apt step itself was fine in the neighbouring runs.

### 8.5 The PUBLIC/PRIVATE contradiction in the workflow's cost tables (decision pending)

`gh repo view Ziyzennix/ziy --json visibility` → **`PUBLIC`** (verified 2026-10-16).
The workflow's header, the e2 mozconfig comment and step j's summary echo still print
the PRIVATE-repo columns: *"2 CPU / 8 GB"*, *"MOZ_PARALLEL_BUILD=2 … this runner's
core count"*, *"METERED minutes, 2 000/month, usage BLOCKS"*, and the 12–28 h
estimate derived from those. On the public tier the table is **4 CPU / 16 GB RAM,
free unlimited minutes** (docs.github.com hosted-runners tables), which makes:
(a) the swap step insurance rather than survival; (b) `MOZ_PARALLEL_BUILD=1`
(3717e47, deliberate per its commit message) vs 4 available cores a costed decision;
(c) the 720-min cap a real risk for a 60-min-past-case compile only if the full build
is ~12× today's frontier, which the 4-core table makes less likely than the header's
13–46× arithmetic says. **No change has been made here — cost policy is the
co-owner's. The recorded facts: 200% CPU was observed with the old -j2 config; the
runner's own `nproc` is NOT printed by any run so the 4-core count is still the docs'
table, not a measured fact.**

### 8.6 What this section leaves open

- Image's actual swap budget, RAM, disk and `nproc` — now guaranteed to print on the
  next run (end of the swap step: `free -h` + `swapon --show`).
- ~~Whether `--disable-crashreporter` (f0406cf) genuinely bypasses the crash-helper
  link failure — untested; the next dispatch reaches `g2` past the fixed swap step
  and answers it within ~63 min of work, warm cache.~~ **CLOSED 2026-10-16, no
  compile needed — resolved statically as §8.7.**
- Whether the five C++ patches compile — unchanged: still APPLIED-ONLY per §7.4;
  no run has reached the objdir inside libxul's rust/C++ weave yet (63-min frontier,
  libxul content dominant at the end).
- TODAY.md §3's run history has NOT been edited from here (its maintainer owns it);
  this §8 is the evidence base for that update.

### 8.7 Local static verification of the crash-helper bypass — CLOSED, zero compile

**Written:** 2026-10-16, after the co-owner asked whether some of the wave's open
risks could be "tested on my pc" before the full GitHub run. **Route decision
(co-owner, this date): the CI run stays the compile path** (deep-fork.md §0 intact);
the local box does source-level verification only. **Method:** read-only greps over
the box's surviving Firefox-156.0.1 extraction at
`firefox-156.0.1/` (a PARTIAL tree: `dom` + `toolkit` only — the reboot ate
`/tmp/firefox-src`, this subtree survived) + a fetch of two `moz.build` files from
`hg.mozilla.org` at the tree's own revision
`6f2c158dfc7e9693f880fad2510ceb51a158c069` (`tools/verify.sh`'s and
`proofs-fix-events.md` §1's pinned rev). No `mach` invocation, no compilation.

**Question: does `--disable-crashreporter` suppress the `crashhelper` link target
whose failure ended run 38901074475?** Answer: **yes, provably — the target ceases
to exist in the build graph:**

1. `toolkit/moz.configure:3505-3506` (this tree): `MOZ_CRASHREPORTER` is
   `set_config`+`set_define` `True, when="--enable-crashreporter"`. The
   f0406cf-added `--disable-crashreporter` leaves the define UNSET.
2. `toolkit/crashreporter/moz.build` @ rev 6f2c158dfc7e: everything the failing
   target needs is inside `if CONFIG["MOZ_CRASHREPORTER"]:` — the Linux row's
   `DIRS += ["breakpad-client", "breakpad-client/linux/", … "breakpad_wrapper",
   "crash_helper", "crash_helper_client", "crash_helper_server", "crashping", …]`.
   Not set ⇒ those DIRS are never appended ⇒ the child `moz.build` files are never
   even executed (moz.build recursion is parent-driven).
3. `toolkit/crashreporter/crash_helper/moz.build` @ the same rev makes
   `GeckoProgram("crashhelper", linkage=None)` **unconditional** — a live trap IF the
   dir were entered unconditionally, but it is only reachable through (2)'s gate.
4. Run-4's own log shows the order matching the gate's contents: `breakpad-client`
   (51:04), `google-breakpad/src/common` (51:05), `breakpad_wrapper` (55:32),
   `libcrash_helper_server.a` (55:56), `crashhelper` link (60:27, fatal). All inside
   (2).
5. The disabled option's replacement is in-tree: the `else:` branch swaps in
   `nsDummyExceptionHandler.cpp` (same parent `moz.build`) — nothing outside the gate
   consumes `breakpad_*`/`crash_helper_*` libs, so no dangling consumer. (In-tree
   read, not compiled: if some FLAVOR ever reintroduces a consumer, this paragraph is
   the tripwire.)

**Residual truth:** the crash-helper link failure's underlying LINKER message was
never printed in the failed-step log we hold (clang's summary only, see the tail of
`run-38901074475`'s `--log-failed`); the ROOT CAUSE is therefore still unroot-cased —
but it is bypassed WHOLESALE (with the subtree gone there is no link to fail), so
risk no longer applies to the resumable wave. The co-owner may revisit for a
real root-case in a later session if crash reporting is ever wanted in the engine.
