# packaging/linux/DEPS.md — what Ziy needs from the system (Linux x86_64)

The runtime-dependency record both packaging scripts point at:

- `make-tarball.sh`'s generated README: *"the package-level rows that depend on
  them are listed in `packaging/linux/DEPS.md` (the .deb turns them into
  `Depends:`)"*;
- `make-deb.sh`'s `BASE_DEPS` fallback: *"checked against this box's firefox
  package on 2026-10-15 — see packaging/linux/DEPS.md"*.

**The rule this file follows: every soname below is a string `ldd` actually
printed on `build/ziy`, or it is explicitly marked in §6 as dlopen'd at runtime
and therefore invisible to `ldd`.** Nothing is copied from a distro's firefox
package listing or from memory. Where a `BASE_DEPS` entry has no evidence at all,
this file says so instead of inventing a justification.

Box the evidence was taken on: **Linux Mint 22.3 "zena" / Ubuntu 24.04 noble,
x86_64 (amd64)**. App dir: `build/ziy` (330 MB), built by `tools/build-shell.sh`
from Mozilla's prebuilt engine tarball (`build/engine-provenance.txt`:
`source=tarball`, `engine=…/build/engine/firefox-156.0.1`,
sha512 `7f5894d1c97a7b9b…` — the same tarball `tools/lib/fetch-engine.sh`
verifies against Mozilla's published `SHA512SUMS`).

---

## 1. The commands, verbatim

The two binaries the task names are **not** at the paths one might guess: the
app dir has no `firefox/` subdirectory. `ls build/ziy | head -30` shows the real
layout — `firefox` (a 5.5 KB ELF stub that execs `firefox-bin`) and `libxul.so`
at the top level:

```bash
cd <repo>
A="$PWD/build/ziy"
ls "$A" | head -30                       # firefox  firefox-bin  libxul.so  …
file "$A/firefox" "$A/firefox-bin" "$A/libxul.so"
ldd "$A/firefox"
ldd "$A/firefox-bin"
ldd "$A/libxul.so"
# and the honest one — the loader path the runtime itself ends up with:
LD_LIBRARY_PATH="$A" ldd "$A/libxul.so"
# one closure over EVERY shipped ELF (28 files, incl. gmp-clearkey):
for f in "$A"/* "$A"/gmp-clearkey/0.1/*; do
  file -b "$f" | grep -q '^ELF' || continue
  LD_LIBRARY_PATH="$A:$A/gmp-clearkey/0.1" ldd "$f"
done
```

## 2. `ldd build/ziy/firefox` — the stub

```
	linux-vdso.so.1 (0x…)
	libpthread.so.0 => /lib/x86_64-linux-gnu/libpthread.so.0 (0x…)
	libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x…)
	/lib64/ld-linux-x86-64.so.2 (0x…)
```

That is the whole list for the entry point: **`libc6` and the loader**. The stub
finds its app dir via `/proc/self/exe` and `execv`s `<appdir>/firefox-bin`
(strings: `Couldn't find the application directory.`, `-bin`, `Exec failed with
error: %s`). `linux-vdso.so.1` and `ld-linux-x86-64.so.2` are kernel/glibc
plumbing, not dependencies to declare.

## 3. `ldd build/ziy/firefox-bin` — the process

```
	linux-vdso.so.1 (0x…)
	libdl.so.2     => /lib/x86_64-linux-gnu/libdl.so.2      (0x…)
	libstdc++.so.6 => /lib/x86_64-linux-gnu/libstdc++.so.6  (0x…)
	libm.so.6      => /lib/x86_64-linux-gnu/libm.so.6       (0x…)
	libgcc_s.so.1  => /lib/x86_64-linux-gnu/libgcc_s.so.1   (0x…)
	libpthread.so.0=> /lib/x86_64-linux-gnu/libpthread.so.0 (0x…)
	libc.so.6      => /lib/x86_64-linux-gnu/libc.so.6       (0x…)
	/lib64/ld-linux-x86-64.so.2 (0x…)
```

Packages: `libstdc++6`, `libgcc-s1`, `libc6` (which owns `libdl`/`libm`/
`libpthread`). **No GTK, no X11, no DBus here** — everything else arrives through
`libxul.so`, which this binary dlopens by path (next section).

## 4. `ldd build/ziy/libxul.so` — the misleading one, and what it really means

Run with no loader path, it reports both failure classes:

```
build/ziy/libxul.so: /lib/x86_64-linux-gnu/libnss3.so: version `NSS_3.101' not found (required by build/ziy/libxul.so)
build/ziy/libxul.so: /lib/x86_64-linux-gnu/libnss3.so: version `NSS_3.107' not found (required by build/ziy/libxul.so)
build/ziy/libxul.so: /lib/x86_64-linux-gnu/libnss3.so: version `NSS_3.113' not found (required by build/ziy/libxul.so)
build/ziy/libxul.so: /lib/x86_64-linux-gnu/libnss3.so: version `NSS_3.126' not found (required by build/ziy/libxul.so)
build/ziy/libxul.so: /lib/x86_64-linux-gnu/libnssutil3.so: version `NSSUTIL_3.108' not found (required by build/ziy/libxul.so)
	libmozsandbox.so => not found
	libnspr4.so      => /lib/x86_64-linux-gnu/libnspr4.so (0x…)
	…
	libgkcodecs.so   => not found
	liblgpllibs.so   => not found
	…
	libmozsqlite3.so => not found
	libmozgtk.so     => not found
	libmozwayland.so => not found
	…
```

Both classes are artifacts of running `ldd` on one file outside its app dir:

1. **`not found` = the app dir's own siblings.** `libmozsandbox.so`,
   `libgkcodecs.so`, `liblgpllibs.so`, `libmozsqlite3.so`, `libmozgtk.so`,
   `libmozwayland.so` are shipped next to `libxul.so` and are loaded from there
   at runtime — they are listed in `build/ziy/dependentlibs.list`, which
   `firefox-bin` reads (`/dependentlibs.list` is a literal string in the
   binary). They are **not** dependencies to declare.
2. **The NSS version warnings are against the WRONG NSS.** With no loader path,
   `ldd` resolved `libnss3.so` to the *system* copy — `libnss3 2:3.98` on this
   box — while this libxul was built against NSS ≥ 3.126. The app dir ships its
   own `libnss3.so` (highest exported version: `NSS_3.126`) plus
   `libnspr4/libplc4/libplds4/libnssutil3/libsmime3/libssl3/libsoftokn3`, and
   those are what the product loads. Re-run with the app dir on the loader path
   and **nothing is unresolved** (`grep -c 'not found'` → 0), because every
   bundled soname resolves inside `build/ziy`.

Consequence for packaging: **NSS/NSPR are bundled, not depended on.** A system
`libnss3` (even a newer one) is never consulted by a complete app dir, and on
this box the system copy provably could not satisfy this libxul. `make-deb.sh`
still declares `libnss3`/`libnspr4` — see §7, they are kept deliberately as the
list's upper bound, not because they satisfy the NEEDED entries.

## 5. What the product actually needs: the external set, as packages

The closure over all 28 shipped ELFs is **75 sonames outside the app dir** plus
**14 resolved into it** (`libgkcodecs liblgpllibs libmozavutil libmozgtk
libmozsandbox libmozsqlite3 libmozwayland libnspr4 libnss3 libnssutil3 libplc4
libplds4 libsmime3 libssl3` — bundled, not dependencies). The 75 map to **65
installed packages** on this box:

<!-- generated: ldd sweep 2026-10-16, dpkg -S per resolved path, direct entries from readelf -d -->
| package (Ubuntu noble) | sonames ldd printed (bold = direct DT_NEEDED) |
| --- | --- |
| `libasound2t64` | **`libasound.so.2`** |
| `libatk-bridge2.0-0t64` | `libatk-bridge-2.0.so.0` |
| `libatk1.0-0t64` | **`libatk-1.0.so.0`** |
| `libatspi2.0-0t64` | `libatspi.so.0` |
| `libblkid1` | `libblkid.so.1` |
| `libbrotli1` | `libbrotlicommon.so.1`, `libbrotlidec.so.1` |
| `libbsd0` | `libbsd.so.0` |
| `libbz2-1.0` | `libbz2.so.1.0` |
| `libc6` | **`libc.so.6`**, **`libdl.so.2`**, **`libm.so.6`**, **`libpthread.so.0`**, **`libresolv.so.2`**, **`librt.so.1`** |
| `libcairo-gobject2` | **`libcairo-gobject.so.2`** |
| `libcairo2` | **`libcairo.so.2`** |
| `libcap2` | `libcap.so.2` |
| `libdatrie1` | `libdatrie.so.1` |
| `libdbus-1-3` | **`libdbus-1.so.3`** |
| `libepoxy0` | `libepoxy.so.0` |
| `libexpat1` | `libexpat.so.1` |
| `libffi8` | `libffi.so.8` |
| `libfontconfig1` | **`libfontconfig.so.1`** |
| `libfreetype6` | **`libfreetype.so.6`** |
| `libfribidi0` | `libfribidi.so.0` |
| `libgcc-s1` | **`libgcc_s.so.1`** |
| `libgcrypt20` | `libgcrypt.so.20` |
| `libgdk-pixbuf-2.0-0` | **`libgdk_pixbuf-2.0.so.0`** |
| `libglib2.0-0t64` | `libgmodule-2.0.so.0`, **`libgio-2.0.so.0`**, **`libglib-2.0.so.0`**, **`libgobject-2.0.so.0`** |
| `libgpg-error0` | `libgpg-error.so.0` |
| `libgraphite2-3` | `libgraphite2.so.3` |
| `libgtk-3-0t64` | **`libgdk-3.so.0`**, **`libgtk-3.so.0`** |
| `libharfbuzz0b` | `libharfbuzz.so.0` |
| `libjpeg-turbo8` | `libjpeg.so.8` |
| `liblz4-1` | `liblz4.so.1` |
| `liblzma5` | `liblzma.so.5` |
| `libmd0` | `libmd.so.0` |
| `libmount1` | `libmount.so.1` |
| `libpango-1.0-0` | **`libpango-1.0.so.0`** |
| `libpangocairo-1.0-0` | **`libpangocairo-1.0.so.0`** |
| `libpangoft2-1.0-0` | `libpangoft2-1.0.so.0` |
| `libpcre2-8-0` | `libpcre2-8.so.0` |
| `libpixman-1-0` | `libpixman-1.so.0` |
| `libpng16-16t64` | `libpng16.so.16` |
| `libselinux1` | `libselinux.so.1` |
| `libstdc++6` | **`libstdc++.so.6`** |
| `libsystemd0` | `libsystemd.so.0` |
| `libthai0` | `libthai.so.0` |
| `libwayland-client0` | `libwayland-client.so.0` |
| `libwayland-cursor0` | `libwayland-cursor.so.0` |
| `libwayland-egl1` | `libwayland-egl.so.1` |
| `libx11-6` | **`libX11.so.6`** |
| `libx11-xcb1` | **`libX11-xcb.so.1`** |
| `libxau6` | `libXau.so.6` |
| `libxcb-render0` | `libxcb-render.so.0` |
| `libxcb-shm0` | **`libxcb-shm.so.0`** |
| `libxcb1` | **`libxcb.so.1`** |
| `libxcomposite1` | **`libXcomposite.so.1`** |
| `libxcursor1` | **`libXcursor.so.1`** |
| `libxdamage1` | **`libXdamage.so.1`** |
| `libxdmcp6` | `libXdmcp.so.6` |
| `libxext6` | **`libXext.so.6`** |
| `libxfixes3` | **`libXfixes.so.3`** |
| `libxi6` | **`libXi.so.6`** |
| `libxinerama1` | `libXinerama.so.1` |
| `libxkbcommon0` | `libxkbcommon.so.0` |
| `libxrandr2` | **`libXrandr.so.2`** |
| `libxrender1` | **`libXrender.so.1`** |
| `libzstd1` | `libzstd.so.1` |
| `zlib1g` | `libz.so.1` |

How to read **bold**: it is a `DT_NEEDED` entry of a shipped ELF itself
(`readelf -d`); non-bold sonames arrive transitively through the bold ones
(mostly through GTK 3 → Pango → Cairo → GLib, and GLib → libmount/libselinux/
libffi/…). Only the bold set is a *direct* contract; the transitive set is what
those packages already depend on, which is why the `Depends:` list does not have
to name all 65 packages by hand.

## 6. Invisible to ldd: the dlopen'd set

These sonames appear as **strings in the shipped binaries** but in no `ldd`
line. That is exactly how a `dlopen`-based optional dependency looks: the loader
spells the name at runtime, so `ldd` cannot see it. **They are listed here only
because the rule in the header allows it for this explicitly-marked class.**
Evidence: `strings -a build/ziy/* | grep -oE 'lib[A-Za-z0-9_+.-]+\.so(\.[0-9]+)*'`
minus the ldd set; the "found in" column is a per-file `grep -a`.

| soname (string found in the shipped bytes) | found in | package on this box |
| --- | --- | --- |
| `libpulse.so.0` | `libxul.so` | `libpulse0` |
| `libpipewire-0.3.so.0` | `libxul.so` | `libpipewire-0.3-0t64` |
| `libdrm.so.2` | `libxul.so`, `gfxtest` | `libdrm2` |
| `libgbm.so.1` | `libxul.so` | `libgbm1` |
| `libva.so.2` | `libxul.so`, `libmozavcodec.so`, `gfxtest` | `libva2` |
| `libva-drm.so.2` | `libxul.so`, `gfxtest` | `libva-drm2` |
| `libEGL.so.1` | `libxul.so`, `gfxtest` | `libegl1` |
| `libGL.so.1` | `libxul.so`, `gfxtest` | `libgl1` |
| `libGLESv2.so.2` | `libxul.so`, `gfxtest` | `libgles2` |
| `libvulkan.so.1` | `libxul.so`, `gfxtest` | `libvulkan1` |
| `libavcodec.so.60` (loader list: `.59`–`.63`) | `libxul.so` | `libavcodec-extra60`¹ |
| `libcups.so.2` | `libxul.so` | `libcups2t64` |
| `libXss.so.1` | `libxul.so` | `libxss1` |
| `libSM.so.6` | `libxul.so` | `libsm6` |
| `libICE.so.6` | `libxul.so` | `libice6` |
| `libcanberra.so.0` | `libxul.so` | `libcanberra0t64` |
| `libspeechd.so.2` | `libxul.so` | `libspeechd2` |
| `libudev.so.1` | `libxul.so` | `libudev1` |
| `libdbusmenu-glib.so.4` | `libxul.so` | `libdbusmenu-glib4` |
| `libdbusmenu-gtk3.so.4` | `libxul.so` | `libdbusmenu-gtk3-4` |
| `libgssapi_krb5.so.2` | `libxul.so` | `libgssapi-krb5-2` |
| `libsecret-1.so.0` | `libxul.so` | `libsecret-1-0` |
| `libnotify.so.4` | `libxul.so` | `libnotify4` |
| `libpci.so.3` | `gfxtest` | `libpci3` |
| `libcurl.so.4`, `libcurl-gnutls.so.4` | `crashreporter`, `pingsender` | `libcurl4t64` / `libcurl3t64-gnutls` |

¹ On this box `/usr/lib/x86_64-linux-gnu/libavcodec.so.60` is owned by
`libavcodec-extra60` (installed); Ubuntu also ships `libavcodec60`, and
`ffmpeg` depends on `libavcodec60` — any of the three makes the soname present.

Caveats, stated so this table is not read as more than it is:

- A string is **evidence the binary may load it, not proof it does**. These back
  optional features (audio backend, hardware video decode, GL/Vulkan, printing,
  speech, crash upload); the engine is built to run without them. The hard
  requirements are §2–§5.
- The strings contain deliberately **historical version lists** too
  (`libavcodec.so.53`–`.58`, `libudev.so.0`, `libgssapi.so.1`, `libcurl.so.3`,
  `libnotify.so.1`, `libfreebl3.so`): the loading code tries a sequence. They are
  not dependencies and are not listed.
- `libXtst.so.6` appears in **none** of them: a `grep -a` over all 28 ELFs finds
  no `Xtst` string, and no `ldd` line prints it. See §7.

## 7. Cross-check: `make-deb.sh`'s `BASE_DEPS`, entry by entry

`make-deb.sh:167` declares 29 entries. This is each one against the evidence
above (verdicts: **direct** = printed by `ldd` and a `DT_NEEDED`; **transitive**
= printed by `ldd` through a bold dependency; **dlopen** = §6; **bundled** =
§4; **no evidence** = neither).

| `BASE_DEPS` entry | verdict | evidence / providing package on this box |
| --- | --- | --- |
| `libglib2.0-0` | direct | `libglib-2.0.so.0`, `libgio-2.0.so.0`, `libgobject-2.0.so.0` (+`libgmodule`). Noble name: **`libglib2.0-0t64`** (provides `libglib2.0-0`) |
| `libgtk-3-0` | direct | `libgtk-3.so.0`, `libgdk-3.so.0`. Noble name: **`libgtk-3-0t64`** |
| `libdbus-1-3` | direct | `libdbus-1.so.3` |
| `libasound2` | direct | `libasound.so.2`. Noble name: **`libasound2t64`** |
| `libpulse0` | dlopen | `libpulse.so.0` in `libxul.so` (§6); not a NEEDED entry |
| `libx11-6` | direct | `libX11.so.6` |
| `libxcb1` | direct | `libxcb.so.1` |
| `libxcomposite1` | direct | `libXcomposite.so.1` |
| `libxdamage1` | direct | `libXdamage.so.1` |
| `libxext6` | direct | `libXext.so.6` |
| `libxfixes3` | direct | `libXfixes.so.3` |
| `libxrandr2` | direct | `libXrandr.so.2` |
| `libxi6` | direct | `libXi.so.6` |
| `libxtst6` | **no evidence** | no `ldd` line on any of the 28 ELFs and no `Xtst` string in any of them. **Kept deliberately**: the list is an upper bound, and an unneeded package in `Depends:` blocks an install less often than a missing one blocks a start |
| `libcairo2` | direct | `libcairo.so.2` (+`libcairo-gobject`) |
| `libpango-1.0-0` | direct | `libpango-1.0.so.0` (+`libpangocairo`, `libpangoft2`) |
| `libcairo-gobject2` | direct | `libcairo-gobject.so.2` |
| `libatk1.0-0` | direct | `libatk-1.0.so.0`. Noble name: **`libatk1.0-0t64`** |
| `libatk-bridge2.0-0` | transitive | `libatk-bridge-2.0.so.0` (through GTK 3; also `libatspi.so.0`). Noble name: **`libatk-bridge2.0-0t64`** |
| `libgbm1` | dlopen | `libgbm.so.1` in `libxul.so` (§6) |
| `libdrm2` | dlopen | `libdrm.so.2` in `libxul.so`/`gfxtest` (§6) |
| `libwayland-client0` | transitive | `libwayland-client.so.0` (+`-cursor`, `-egl`) |
| `libxkbcommon0` | transitive | `libxkbcommon.so.0` |
| `libfontconfig1` | direct | `libfontconfig.so.1` |
| `libfreetype6` | direct | `libfreetype.so.6` |
| `libnss3` | bundled | **not** what satisfies libxul: the app dir ships its own `libnss3.so` (exports to `NSS_3.126`); the system copy here (`2:3.98`) fails `ldd`'s version check. Kept as upper bound |
| `libnspr4` | bundled | `libnspr4.so` (+`libplc4`, `libplds4`) ships in the app dir and is in `dependentlibs.list` |
| `zlib1g` | transitive | `libz.so.1` |
| `ffmpeg` | dlopen | not a library name: the soname `libxul.so` loads is `libavcodec.so.60` (§6). Resolvable (`apt-cache policy ffmpeg` → `7:6.1.1-3ubuntu5`) and it pulls `libavcodec60`; the precise package for the soname is `libavcodec60`/`libavcodec-extra60` |

**The five `…-0`/`-3`/`-bridge…` names on noble (2026-10-16):** `apt-cache policy`
shows `Candidate: (none)` for `libglib2.0-0`, `libgtk-3-0`, `libasound2`,
`libatk1.0-0`, `libatk-bridge2.0-0` — on this archive they are pure *virtual*
names, each `Provides`-ed (with a version) by its `-t64` package:

```bash
apt-cache show libglib2.0-0t64 | grep -E '^(Package|Provides):'
# Provides: libgio-2.0-0 (= 2.80.0-6ubuntu3.9), libglib-2.0-0 (= …), libglib2.0-0 (= …), …
```

and apt resolves a `Depends:` on them. Proven without root by building a
throw-away control file with the **whole** list and simulating:

```bash
dpkg-deb --build <dummy with Depends: the 29 entries> /tmp/dummy.deb
apt-get -s install /tmp/dummy.deb     # → no `E:` lines; only ffmpeg was missing here
```

So `BASE_DEPS` is installable on noble as written. If a future revision wants
names that are also valid on pre-t64 releases (bookworm/jammy) and t64 ones
(trixie/noble) at once, the idiom is `libglib2.0-0t64 | libglib2.0-0`; that is a
choice, not a bug to fix.

## 8. What this file does NOT claim

- **No install test was run on the box that wrote this file.** No root here:
  `dpkg -i`/`apt-get install` and the `.deb` postinst are the workflow's job
  (`.github/workflows/build-packages.yml`, the "install the .deb" step), and
  `make-deb.sh` says the same in its own output.
- **No boot was run in this pass.** The boot evidence for this app dir is
  `./tools/verify.sh`'s headless-boot checks (last full run: **54 passed / 0
  failed / 2 skipped**, `replica/proofs-compliance.md` §4, re-measured
  2026-10-16 after the rebuild; both SKIPs are engine limitations). The
  workflow adds a smoke boot of the packaged artifacts.
- **`lintian` is not installed here** (5 MB apt install, an explicit choice by
  `make-deb.sh`): it runs on the runner, not locally.
- The package names are the ones **this box's** `dpkg -S` reports for the
  resolved paths (noble naming, incl. the `t64` transition). Debian trixie and
  current Ubuntu releases use the same names; older releases carry the pre-t64
  spellings given in §7.
- `dpkg-shlibdeps` is present here (`/usr/bin/dpkg-shlibdeps`), so
  `make-deb.sh`'s resolver path would run — but that script was **not executed
  in this pass** (`build/packaging/` does not exist; the artifact-producing run
  is the workflow's). Every number in this file comes from `ldd`, `readelf`,
  `dpkg -S`, `apt-cache` and `strings`, not from a packaged artifact.

## 9. Static probes: six defects fixed before the first run — and a seventh the run found (2026-10-16)

Neither script had ever been executed when this section was first written
(`build/packaging/` did not exist), so every behaviour the scripts assert
about themselves was re-derived by running its primitives against this box's
real tools (apt 2.8.3, dpkg-dev 1.22.6, dpkg-deb; no root). Six defects fell
out. All six are fixed in `make-tarball.sh` / `make-deb.sh`, each carrying
the probe in a comment next to the fix. The commands below reproduce them
from the repo root with `mktemp -d` only — no root, no browser, no state
outside the temp dir. `make-tarball.sh` has since had its first real run
(2026-10-16; it produced `build/packaging/ziy-156.0.1-linux-x86_64.tar.xz`)
and that run found a seventh defect — §9.8.

### 9.1 `/usr/bin/ziy` was a self-loop — `make-deb.sh`

`ln -sfn ziy` in the staged `/usr/bin`: a relative symlink is resolved from
the **link's own directory**, so the target `ziy` pointed at `/usr/bin/ziy`
itself. `readlink -f` failed (`Too many levels of symbolic links`) and every
exec died. Fixed to `../lib/ziy/ziy` (relative, resolves inside the installed
tree) plus a post-link assertion on the stored target.

```bash
D=$(mktemp -d); mkdir -p "$D/usr/bin" "$D/usr/lib/ziy"
cp shell/launcher.sh "$D/usr/lib/ziy/ziy"
printf '#!/bin/sh\necho "fake-firefox ZIY_HOME=$ZIY_HOME"\n' > "$D/usr/lib/ziy/firefox"
chmod +x "$D/usr/lib/ziy/ziy" "$D/usr/lib/ziy/firefox"
ln -s ../lib/ziy/ziy "$D/usr/bin/ziy"
readlink -f "$D/usr/bin/ziy"   # → $D/usr/lib/ziy/ziy; with `ln -s ziy`: "Too many levels…"
"$D/usr/bin/ziy" "--smoke-probe"   # → fake-firefox ZIY_HOME=$D/usr/lib/ziy args: --smoke-probe
```

### 9.2 the symlink check could never match — `make-deb.sh`

`dpkg-deb --contents` prints a symlink entry as
`lrwxrwxrwx root/root 0 <date> ./usr/bin/ziy -> ../lib/ziy/ziy` — the
`-> target` suffix means the old anchored `\./usr/bin/ziy$` pattern could
never match, so the "is it a symlink" assertion was dead code. Fixed to a
tolerant `grep -E '^ *l[^ ]* .*\./usr/bin/ziy( -> .*)?$'` plus an
`awk '{print $NF}'` target assertion (`../lib/ziy/ziy`).

```bash
D=$(mktemp -d); mkdir -p "$D/usr/bin" "$D/usr/lib/ziy"
ln -s ../lib/ziy/ziy "$D/usr/bin/ziy"
mkdir -p "$D/DEBIAN"; printf 'Package: p\nVersion: 1\nArchitecture: amd64\nMaintainer: t <t@t>\nDescription: p\n' > "$D/DEBIAN/control"
dpkg-deb --build "$D" "$D.deb" >/dev/null
dpkg-deb --contents "$D.deb" | grep 'usr/bin/ziy'   # → the line with `-> ../lib/ziy/ziy`
```

### 9.3 `CHECKSUMS.sha256` hashed its own empty self — `make-tarball.sh`

`find . -type f | … > CHECKSUMS.sha256`: the redirect creates the file
before `find` runs, so it appeared in its own list as a 0-byte file and
carried the empty-string digest `e3b0c442…`; every later
`sha256sum -c CHECKSUMS.sha256` would fail on that line. Reproduced 3/3 runs,
fixed with `! -name CHECKSUMS.sha256`.

```bash
D=$(mktemp -d); cd "$D"; echo a > a.txt; mkdir sub; echo b > sub/b.txt
# buggy: find . -type f | LC_ALL=C sort | xargs sha256sum > CHECKSUMS.sha256
find . -type f ! -name CHECKSUMS.sha256 | LC_ALL=C sort | xargs sha256sum > CHECKSUMS.sha256
sha256sum -c --quiet CHECKSUMS.sha256; echo "rc=$?"   # → rc=0 (buggy version: rc=1 on its own line)
```

### 9.4 `dpkg-shlibdeps -O` never writes `debian/substvars` — `make-deb.sh`

`-O` prints the dependency list to **stdout** only. The old code read
`debian/substvars`, which is never created (dpkg-dev 1.22.6: after `-O` the
`debian/` dir still holds only `control`), so the resolver's result was
always empty and the script warned "Install 'dpkg-dev'" even with dpkg-dev
installed — shipping `BASE_DEPS` while believing the resolver had failed.
Fixed to capture stdout (`SHLIBDEPS_OUT="$( cd "$STAGE" && dpkg-shlibdeps -O --ignore-missing-info bin/* … )"`),
the one place `-O` puts the list.

```bash
D=$(mktemp -d); mkdir -p "$D/debian" "$D/bin"; cp /usr/bin/ls "$D/bin/"
printf 'Source: p\n\nPackage: p\nArchitecture: any\n' > "$D/debian/control"
( cd "$D" && dpkg-shlibdeps -O --ignore-missing-info bin/* )
ls "$D/debian"   # → only `control`; `substvars` never appears
```

### 9.5 the `.sha256` sidecars carried absolute build paths — both scripts

`sha256sum /abs/path/to/artifact` writes that absolute path into the
`.sha256`, so the file could only ever be checked on the build machine.
Fixed to write the checksum from inside `$OUT_DIR` against the **basename**
(`( cd "$OUT_DIR" && sha256sum "<name>" > "<name>.sha256" )`), the form a
downloader-side `sha256sum -c` needs. Verified from a downloader-side copy:

```bash
D=$(mktemp -d); cd "$D"; echo payload > ziy.tar.xz
sha256sum ziy.tar.xz > ziy.tar.xz.sha256        # the fixed form: basename only
D2=$(mktemp -d); cp ziy.tar.xz ziy.tar.xz.sha256 "$D2/"
( cd "$D2" && sha256sum -c --quiet ziy.tar.xz.sha256 ); echo "rc=$?"   # → rc=0
cat ziy.tar.xz.sha256   # → "<digest>  ziy.tar.xz", no absolute build path
```

### 9.6 both `--help` ranges stopped one line short — both scripts

`sed -n '2,40p'` printed the leading comment block by line count; the block
had grown past line 40, so `--help` silently omitted a documented input:
`ZIY_VERSION` in `make-tarball.sh` and the closing `Env:` line in
`make-deb.sh`. Fixed to `awk 'NR==1{next} /^#/{print; next} {exit}'` — the
whole header, by structure, not by a magic number.

```bash
bash packaging/linux/make-tarball.sh --help | grep -n ZIY_VERSION   # → prints the Env line
bash packaging/linux/make-deb.sh    --help | grep -n 'Env:'         # → prints it
```

### 9.7 workflow side-note: `Depends:` is installed with `apt-get satisfy`

Not a script defect, but the reason step h of the workflow does not install
the 29 names directly: on noble, command-line `libasound2` is ambiguous
(`E: Package 'libasound2' has no installation candidate` — two providers,
`libasound2t64` and `liboss4-salsa-asound2`; exit 100), while

```bash
DEPS="$(dpkg-deb -f <deb> Depends)"
sudo apt-get satisfy -y --no-install-recommends "$DEPS"
```

exits 0 — `satisfy` is exactly the resolver that already honours §7's
virtual-name `Provides`. Proven here without root via `apt-get -s satisfy
"<full Depends string>"` (no `E:` lines; the only gap on this box was
`ffmpeg`, owned by a third-party repo). `--no-install-recommends` keeps the
install set at the closure this file measured.

### 9.8 the first real run's own re-read used `zipfile`, which cannot read omni.ja — `make-tarball.sh`

`make-tarball.sh`'s first real execution (2026-10-16) failed at its final
assertion: `BadZipFile: Bad magic number for central directory`, surfaced as
"the shipped omni.ja lost the signing patch somewhere in packaging". It had
not. The assertion directly above it prints `ok` — the digest of the
unpacked omni.ja equals the staged one — and Python's `zipfile` fails
identically on the **pristine** engine this product packages:

```bash
python3 -c 'import zipfile; zipfile.ZipFile("/usr/lib/firefox/omni.ja")'
# → zipfile.BadZipFile: Bad magic number for central directory
#   (an untouched Firefox omni.ja; also build/ziy/omni.ja, patched or not)
```

omni.ja is a non-standard zip container: its central directory sits at
offset 4 behind a 4-byte envelope and the EOCD's `cd_offset=4` does not
reach the EOCD position (Info-ZIP prints "extra bytes … compensating";
stdlib `zipfile` refuses). Everything else in the script already used the
official reader — `tools/lib/omni-ja.py --verify`, recomputed stored CRC
plus both substitutions — and so does `make-deb.sh`; only this final re-read
was written against `zipfile`. Fixed to verify **both** containers in the
unpacked archive with the same official reader (`--patch ziy`,
`--patch ziy-browser`). ~~The re-run after the fix is in flight as this lands;
its outcome is recorded in `replica/TODAY.md` §2 and `replica/deploy.md`
row 1.~~ The re-run after the fix **PASSED** end to end (2026-10-16),
including the assertion the first run died on — `ok the shipped omni.ja still
carries both patches`. Artifact: `build/packaging/ziy-156.0.1-linux-x86_64.tar.xz`
(95,995,124 B ≈ 92M compressed / 336M unpacked) + `.sha256` beside it. Boot
evidence (fresh extraction, throwaway HOME + profile): non-blank 1280x720
screenshot, 9/9 `ziy-*@ziy.app` add-ons `active=True`, engine `--version` =
`Mozilla Firefox 156.0.1` (known behaviour). Full record: `replica/TODAY.md`
§2 and `replica/deploy.md` row 1.
## 10. `make-deb.sh` first real local execution — outcome (2026-10-16)

`make-deb.sh` had never executed anywhere (neither script had before the
2026-10-16 batch). This section records its first full local run, end to end.

### Input state
`build/ziy/` already existed (330 MB app dir from `tools/build-shell.sh --force`,
built against Mozilla's prebuilt engine tarball), carrying the patched
`omni.ja`, `browser/omni.ja`, 9 suite XPIs in `distribution/extensions/`,
the branded `ziy` launcher and `LICENSES.txt`/`patches/`. No rebuild was
needed or performed (`build/` is gitignored).

### Execution
Command (from repo root, detached under `nice -n 19` per AGENTS.md, full output
captured to `/tmp/opencode/make-deb-run3.log`):

```
setsid nohup nice -n 19 bash packaging/linux/make-deb.sh \
    > /tmp/opencode/make-deb-run3.log 2>&1 < /dev/null &
```
Note: `setsid` was required — earlier runs launched under plain `nohup ... &`
were killed by the shell's process-group teardown even though they were
backgrounded.

The earlier incomplete state: `build/packaging/` already contained a
`ziy_156.0.1-1_amd64.deb` dated 2026-10-16 03:10 produced by an unlogged run
of the pre-fix script — it built the package but died before writing its
`.sha256` sidecar, and it still leaked resolver scratch into the payload
(§9.9 below). That artifact is superseded by the run below; it was kept as
`/tmp/opencode/make-deb-pre-existing-pid.deb` for reference only and is not
part of this record.

### Defects found and fixed (mechanical, in `packaging/linux/make-deb.sh`)
All confirmed by reproducing the exact primitive against this box's real tools
(dpkg-dev 1.22.6, dpkg-deb; no root):

- **Defect 9.9 — dead payload-path assertions, lines 369–379 (`^ *\./path$`).**
  `dpkg-deb --contents` emits `mode owner size date path` with **no leading
  whitespace**, so every pattern `^ *\./usr/lib/ziy/…` could never match. A
  correct package always `die`d at its first successful build — exactly what
  killed the unlogged 03:10 run before it wrote `.sha256`. Verified empirically
  with a throwaway package: the `^ *` pattern matches 0 lines, the path-only
  pattern matches 1. Fixed by dropping the bogus `^ *` prefix.
- **Defect 9.10 — resolver scratch shipped inside the package payload.**
  Lines 144/150/163/167 built `debian/`, `bin/`, `shlibdeps.err` and
  `deb-shlibdeps.txt` inside `$STAGE`, then `dpkg-deb --build "$STAGE"`
  packaged them at the archive root: `./bin/firefox` (second 130 MB engine
  copy), `./bin/libxul.so`, `./debian/control`, `./deb-shlibdeps.txt`,
  `./shlibdeps.err`. Verified in the pre-existing 03:10 deb (it shipped all of
  these under `/`). Fixed by moving the dpkg-shlibdeps scratch into a separate
  `$RESOLVE` dir removed by `cleanup` before the deb is built.
- **Defect 9.11 — payload root directory mode.**
  `mktemp -d` left `$STAGE` at mode 0700, which `dpkg-deb --build` preserved,
  so the package shipped `drwx------ root/root 0 .` instead of the
  `drwxr-xr-x` every real deb ships (verified against this box's apt-cached
  debs on 2026-10-16). Fixed with `chmod 0755 "$STAGE"` right after mktemp.
- **Defect 9.12 — postinst icon source path did not exist.**
  The postinst's icon-copy loop read `/usr/lib/ziy/share/icons/hicolor/…`,
  which the app dir does not contain, so the loop was always a no-op and its
  source was a wrong path. Fixed by staging the icons inside the app dir
  too (`/usr/lib/ziy/share/icons/hicolor/<size>x<size>/apps/ziy.png`), in
  parity with `make-tarball.sh`'s layout, so the postinst source path is real.

- **Defect 9.13 — self-check list incomplete (strengthening).**
  Added assertions the ticket names: `./usr/lib/ziy/LICENSES.txt` and
  `./usr/lib/ziy/patches/000[1-5]-` (MPL §3.2(a) items), plus an assertion that
  every app-dir hicolor icon slot the postinst references is shipped (mirroring
  `make-tarball.sh`'s self-check list).

NOT fixed — a design decision left to the director (per scope): `BASE_DEPS`
contains both plain and versioned entries (e.g. `libcairo2` and
`libcairo2 (>= 1.10.0)`), producing redundant-but-valid duplicate `Depends`
entries; lintian on the runner will make its own call there. Also unchanged:
the hicolor icons are all the same 1103x1104 master PNG at every size
(a `build/ziy`/brand condition `make-deb.sh` inherits; identical in the
tarball artifact — not a packaging-script defect).

### Artifact produced
- Path: `build/packaging/ziy_156.0.1-1_amd64.deb`
- Size: 97,406,368 bytes (~93M compressed; unpacked Installed-Size 349,144 KiB)
- SHA-256: `a00141f27094612505d6994ab30303886a2c438ebbe26fa919e2c3a8c31a67c7`
  (`sha256sum -c ziy_156.0.1-1_amd64.deb.sha256` → OK; sidecar writes the
  basename so a downloader-side check works)
- Version: `ziy 156.0.1-1`, arch `amd64`, 176 payload paths, 9 suite XPIs.
- Depends (resolved by dpkg-shlibdeps, merged onto BASE_DEPS):
  `ffmpeg,libasound2,libasound2t64 (>= 1.0.16),libatk-bridge2.0-0,
  libatk1.0-0,libatk1.0-0t64 (>= 1.12.4),libc6 (>= 2.34),
  libcairo-gobject2 (>= 1.10.0),libcairo2 (>= 1.10.0),libdbus-1-3 (>= 1.9.14),
  libdrm2,libfontconfig1 (>= 2.12.6),libfreetype6 (>= 2.3.9),libgbm1,
  libgcc-s1 (>= 4.2),libgdk-pixbuf-2.0-0 (>= 2.22.0),libglib2.0-0,
  libglib2.0-0t64 (>= 2.77.3),libgtk-3-0,libgtk-3-0t64 (>= 3.13.7),
  libnspr4 (>= 2:4.10.9),libnss3 (>= 2:3.88.0),libpango-1.0-0 (>= 1.14.0),
  libpangocairo-1.0-0 (>= 1.14.0),libpulse0,libstdc++6 (>= 4.8),
  libwayland-client0,libx11-6,libx11-xcb1 (>= 2:1.8.7),libxcb-shm0,libxcb1,
  libxcomposite1 (>= 1:0.4.5),libxcursor1 (>> 1.1.2),libxdamage1 (>= 1:1.1),
  libxext6,libxfixes3 (>= 1:5.0),libxi6,libxrandr2 (>= 2:1.4.0),libxrender1`

### Round-trip evidence (run3 log: `/tmp/opencode/make-deb-run3.log`)
`make-deb.sh` asserted, against the bytes being packaged, and every assertion
printed `ok`:
  - omni.ja signing patch + browser/omni.ja newtab-strip patch present
    (`tools/lib/omni-ja.py --verify`, the official reader)
  - 9 XPIs ship inside `/usr/lib/ziy`
  - dpkg-shlibdeps resolved 41 package names (used for Depends)
  - `dpkg -I`: Package ziy / Version 156.0.1-1 / Architecture amd64 /
    Maintainer / Depends all correct
  - `dpkg -c`: lists 176 paths; root entry `drwxr-xr-x` (fixed mode);
    no `./bin/`, `./debian/`, `./shlibdeps.err`, `./deb-shlibdeps.txt` scratch
  - `/usr/lib/ziy/ziy` (executable launcher), `/usr/bin/ziy` symlink to
    `../lib/ziy/ziy`
  - `/usr/lib/ziy/omni.ja`, `/usr/lib/ziy/browser/application.ini`
    (`grep '^Name=Ziy'` asserted earlier)
  - 9 `distribution/extensions/*.xpi`
  - `/usr/share/applications/ziy.desktop`
  - 9 hicolor icon sizes shipped at `/usr/share/icons/hicolor/…/apps/ziy.png`
    AND at `/usr/lib/ziy/share/icons/hicolor/…/apps/ziy.png`
  - `/usr/lib/ziy/LICENSES.txt`, all 5 `patches/` + `README.md`
  - control archive carries `./postinst`
  - `./usr/lib/ziy/share/icons/hicolor/<size>x<size>/apps/ziy.png` present for
    all 9 sizes (postinst source path is real — fixed defect 9.12)
  - `.sha256` sidecar written with basename-only path (verifies on the
    downloading machine)

What was NOT verified here (by design, needs root/a runner): `dpkg -i` install,
`apt-get install` of the Depends closure, the postinst actually running, and
`lintian`.

### lintian local limit
**`lintian` is not installed on this box** (it is a 5 MB apt install). Per
`make-deb.sh` its absence is reported (`warn: lintian NOT PRESENT on this box
— not run. .github/workflows/build-packages.yml runs it on the runner. NOT
VERIFIED LOCALLY.`), not hidden. The script degrades gracefully — no install,
no skip-path needed, nothing fails. lintian runs on the CI runner in
`.github/workflows/build-packages.yml`.

### Regression-suite verdict
`bash replica/test/regressions.sh all` → **8 passed, 2 failed, 0 blocked**
(`failed: shields-runtime shields-runtime-webnav`).
The two failures are BiDi/headless environment issues (the headless Ziy's
WebDriver BiDi port never opens / websocket closes early — measured
`ConnectionRefusedError` on 127.0.0.1:9343 and `ConnectionClosedError`), not
packaging defects: `f20-sync`, `f01-first-run` (+ event page / suite-active)
and all three `shields-blocking-*` cases PASS. The full log is in
`/tmp/opencode/regressions-run.log`.

### Unchanged files
`replica/TODAY.md`, `replica/AI-BRIEF.md` and `replica/HANDOFF.md` were NOT
edited (director-owned).
