# proofs-deep-fork.md — the verified mechanisms for the Ziy engine-level fork slice

Every claim below was exercised on this machine, Linux Mint (Ubuntu 24.04 noble
base), 2026-10-14/15, against the installed Firefox **156.0.1** at
`/usr/lib/firefox`. Companion: `proofs-shell.md` (the shell mechanisms these
build on), `deep-fork.md` (the plan).

**C++ patches written: 0. No C++ file was created, no C++ was compiled, and no
file inside `/tmp/firefox-src/firefox-156.0.1` was modified.**

---

## 1. The generalized patcher

### 1.1 The AppConstants pair, through tools/lib/omni-ja.py

```
$ python3 tools/lib/omni-ja.py /usr/lib/firefox/omni.ja /tmp/test-omni-ja.ja --patch ziy
omni-ja: /usr/lib/firefox/omni.ja -> /tmp/test-omni-ja.ja
  patched        modules/AppConstants.sys.mjs
  member offset  356781  size 6084
    MOZ_REQUIRE_SIGNING: true, -> MOZ_REQUIRE_SIGNING: false,
    MOZ_ALLOW_ADDON_SIDELOAD: false, -> MOZ_ALLOW_ADDON_SIDELOAD: true,
  member CRC     0xa0d70a0a -> 0xd0c615c8
  1 member(s) patched, byte-length preserving (~58 bytes rewritten)
```

Byte-identical outcome to the legacy patcher (same member offset 356781, same
before/after CRCs — compare proofs-shell.md §1.3).

### 1.2 The newtab strip, on browser/omni.ja

```
$ python3 tools/lib/omni-ja.py /usr/lib/firefox/browser/omni.ja /tmp/test-browser-ja.ja --patch ziy-browser
omni-ja: /usr/lib/firefox/browser/omni.ja -> /tmp/test-browser-ja.ja
  patched        chrome/browser/builtin-addons/newtab/manifest.json
  member offset  18196687  size 314
    "manifest_version": 2, -> "manifest_version": 3,
  member CRC     0xadc843fb -> 0xa797c407
  1 member(s) patched, byte-length preserving (~22 bytes rewritten)
```

The patched manifest, re-read from the written archive (`method 0`, stored,
`csize 314`):

```
{
  "manifest_version": 3,
  "name": "New Tab",
  "description": "",
  "version": "156.3.0",

  "browser_specific_settings": {
    "gecko": {
      "id": "newtab@mozilla.org",
      "strict_min_version": "142.0a1"
    }
  },

  "hidden": true,

  "background": {
    "scripts": ["webext-glue/background.js"]
  }
}
```

`scripts` is the MV2 background form; a manifest declaring MV3 with that field is
rejected by the add-on installer, so the built-in never registers a newtab.

The same patch file (`tools/patches/newtab-strip.toml`) applies identically:

```
$ python3 tools/lib/omni-ja.py /usr/lib/firefox/browser/omni.ja /tmp/t2.ja --patch-file tools/patches/newtab-strip.toml
omni-ja: ... "manifest_version": 2, -> "manifest_version": 3,   CRC 0xadc843fb -> 0xa797c407
PATCHFILE OK
```

### 1.3 Verification mode, exercised

```
$ python3 tools/lib/omni-ja.py --verify /tmp/test-browser-ja.ja --patch ziy-browser
omni-ja: /tmp/test-browser-ja.ja carries 1 patched member(s):
  chrome/browser/builtin-addons/newtab/manifest.json  size 314  crc 0xa797c407
    "manifest_version": 2, -> "manifest_version": 3,
```

### 1.4 The loud failure mode, exercised deliberately

```
patches = [MemberPatch("modules/AppConstants.sys.mjs",
                       [Substitution("MOZ_REQUIRE_SIGNING_NOT_THERE: true,", ...)])]
oj.patch_archive(...)
FAILS LOUDLY: PRECONDITION FAILED: modules/AppConstants.sys.mjs does not contain
              'MOZ_REQUIRE_SIGNING_NOT_THERE: true,'. ...
output written? False
```

### 1.5 Both archives in one build (tools/build-shell.sh, step 7 + 7b)

```
  patch      browser/omni.ja: strip Firefox's built-in New Tab add-on (newtab@mozilla.org)
        omni-ja: /…/build/ziy/browser/omni.ja -> …/build/ziy/browser/omni.ja
          patched        chrome/browser/builtin-addons/newtab/manifest.json
          member offset  18196687  size 314
            "manifest_version": 2, -> "manifest_version": 3,
          member CRC     0xadc843fb -> 0xa797c407
          1 member(s) patched, byte-length preserving (~22 bytes rewritten)

        re-verified from build/ziy/browser/omni.ja on disk:
          chrome/browser/builtin-addons/newtab/manifest.json
            "manifest_version": 2, -> "manifest_version": 3,
```

`./tools/build-shell.sh --force` exit 0; the signing patch log and re-verification
block are unchanged from proofs-shell.md. Preflight before the build:
`preflight-prefs.py: OK — 102 locks, 181 declared, layers agree`.

---

## 2. The boot proof that our NTP is the only new tab

Before the patch, a headless boot on `about:newtab` with a fresh profile:

```
$ # profile contents after the boot
activity-stream.newtab_content_event_stats.json
activity-stream.shortcut_cache.json
activity-stream.weather_feed.json
$ grep newtabpage prefs.js
user_pref("browser.newtabpage.activity-stream.impressionId", "{c577e9b3-…}");
user_pref("browser.newtabpage.activity-stream.newtabWallpapers.user.enabled.migrated", true);
user_pref("browser.newtabpage.storageVersion", 1);
```

After the patch, booting the bootstrapped profile (`tools/bootstrap-profile.py`
profile, so user.js + mozilla.cfg locks are in play):

```
$ grep newtabpage prefs.js
user_pref("browser.newtabpage.enabled", false);        # our user.js value landed
$ ls | grep -i activity
(no output)
```

Our layer landed (`browser.newtabpage.enabled=false` written by the engine from
user.js) and Firefox's own newtab machinery produced no pref and no file. The
suite itself installs and is active (18 add-ons in extensions.json, all 8 suite
ids active, `extensions.installedDistroAddon.*` markers present).

---

## 3. The C++ toolchain — installed versions

```
$ clang-19 --version          Ubuntu clang version 19.1.1 (1ubuntu1~24.04.2)
$ llvm-config-19 --version    19.1.1
$ nasm -v                     NASM version 2.16.01
$ yasm --version              yasm 1.3.0
$ ccache --version            ccache version 4.9.1
$ hg --version                Mercurial Distributed SCM (version 6.7.2)
$ ~/.cargo/bin/rustc --version    rustc 1.90.0 (1159e78c4 2025-09-14)
$ ~/.cargo/bin/cargo --version   cargo 1.90.0 (840b83a10 2025-07-30)
$ ~/.cargo/bin/cbindgen --version cbindgen 0.29.4
```

The rust pin is the tree's own minimum, read from the fetched source:

```
$ grep -n MINIMUM_RUST_VERSION python/mozboot/mozboot/util.py
18:MINIMUM_RUST_VERSION = "1.90.0"
```

apt install evidence (one command, 131 packages "Setting up", exit 0):

```
build-essential clang-19 llvm-19 llvm-19-tools ccache nasm yasm mercurial \
autoconf2.13 python3-dev libssl-dev pkg-config zlib1g-dev libgtk-3-dev \
libdbus-glib-1-dev libpulse-dev libxt-dev libasound2-dev libudev-dev \
libxtst-dev libsecret-1-dev libdrm-dev libxkbcommon-dev libx11-xcb-dev \
libxcb1-dev libxcb-shm0-dev libxcb-keysyms1-dev libxcb-glx0-dev libclang-19-dev
```

---

## 4. mach bootstrap — success

```
$ ./mach bootstrap --application-choice=browser
Executing as root: sudo apt-get install -y watchman
sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper
sudo: a password is required
Your version of Rust (1.90.0) is new enough.
Rust supports x86_64-unknown-linux-gnu targets.

Your system should be ready to build Firefox for Desktop!
```

The watchman line is an optional dependency mozboot catches; the run's verdict is
the last line. Mach created its own vendored venvs under
`~/.mozbuild/srcdirs/firefox-156.0.1-aae4b80755a3/_virtualenvs/{mach,build}` —
no system pip was involved at any point.

---

## 5. Source procurement

```
$ curl -sI https://ftp.mozilla.org/pub/firefox/releases/156.0.1/source/firefox-156.0.1.source.tar.xz
HTTP/2 200
content-type: application/x-tar
etag: "fa9938500f6c724442abe219fde6f53d"

$ ls -la firefox-156.0.1.source.tar.xz
-rw-rw-r-- 1 zen zen 801841152 Oct 15 00:41 firefox-156.0.1.source.tar.xz

$ grep 'source/' SHA512SUMS
80a32a79268b672206f5477ca6bfde620cb7419b27aac090e01f06df06990ee0bbd81bb5c4aa78ac1d0edb26b133b1c6fa11cb6522445eccd70c82e719a24d5b  source/firefox-156.0.1.source.tar.xz

$ sha512sum firefox-156.0.1.source.tar.xz
80a32a79268b672206f5477ca6bfde620cb7419b27aac090e01f06df06990ee0bbd81bb5c4aa78ac1d0edb26b133b1c6fa11cb6522445eccd70c82e719a24d5b
SHA512 MATCH

$ cat sourcestamp.txt
20260921121718
https://hg.mozilla.org/releases/mozilla-release/rev/6f2c158dfc7e9693f880fad2510ceb51a158c069
```

Download command (the `-C -` is what makes it survive the 1 MB/s link):

```
curl -C - --retry 20 --retry-delay 5 --retry-all-errors \
  -o firefox-156.0.1.source.tar.xz \
  https://ftp.mozilla.org/pub/firefox/releases/156.0.1/source/firefox-156.0.1.source.tar.xz
```

---

## 6. Configure: 13 attempts, never completed

Each attempt failed one layer later. The sequence, and the fix for each:

| # | failure | fix |
| --- | --- | --- |
| 1-4 | `ModuleNotFoundError: mozfile / mozshellutil / mozsystemmonitor / manifestparser`, then `configure.py` absent | extracted `testing/mozbase/*` and root files from the tarball |
| 5 | `Cannot find llvm-objdump` | `/usr/bin/llvm-objdump-19` exists; PATH needs `/usr/lib/llvm-19/bin` |
| 6 | `Package alsa ... not found` | apt libasound2-dev |
| 7 | `Cannot find cbindgen` | `cargo install cbindgen --locked` |
| 8 | `Could not find libclang` | apt libclang-19-dev |
| 9 | `uvernum.h` missing | extracted `intl/` |
| 10 | `x11-xcb.pc` missing | apt libx11-xcb-dev + libxcb-* dev |
| 11 | wasi headers missing | `ac_add_options --without-wasm-sandboxed-libraries` |
| 12 | `Missing files: …/testing/condprofile/condprof/tests/python.toml` | extracted `testing/condprofile/` |
| 13 | see below | **current** |

The last attempt's tail (1:12 of work; `obj-ziy/config.status` had been written at
1:02.47 but the run then aborted):

```
 1:11.82     ['OSError: Missing files: /tmp/firefox-src/firefox-156.0.1/testing/marionette/harness/marionette_harness/tests/harness_unit/python.toml']
 1:12.87 E *** Fix above errors and then restart with "./mach build"
```

**`./mach build` never started; no C++ has been compiled.** The
`/usr/bin/time -v ./mach build` launch did not survive the session's forced stop,
and its log contains no compile output.

---

## 7. Risks and numbers (recorded for the next run)

Pre-build resource state:

```
$ df -h /
/dev/sda2  228G  105G  113G  48% /
$ free -h
              total   used   free   shared  buff/cache   available
Mem:          7,6Gi  2,7Gi  2,5Gi   120Mi      2,7Gi       4,9Gi
Swap:         5,8Gi  1,8Gi  4,0Gi
$ cat /proc/swaps
/swapfile      file    2097148  0       -1
/dev/zram0     partition 3959140 1907116 100
$ nproc
4
```

Named risks: (1) the release tarball is an incomplete source archive — configure
discovers the gaps one layer at a time, and a gap found mid-build costs hours;
(2) the libxul link at ~5.4 GB available RAM, where swap/zram converts a hard
linker OOM into a thrash and lowering `-j` does not help a single-process link.

Spent: download ≈ 35 min; sha512 5 s; on-demand extraction ≈ 25 min across 13 tar
runs; apt toolchain ≈ 6 min; rustup+cbindgen ≈ 6 min; 13 configure attempts
≈ 25 min. Remaining: configure 2-3 min after extracting the marionette subtree;
`./mach build` 6-14 h on 4 Haswell cores.
