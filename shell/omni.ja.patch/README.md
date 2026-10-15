# omni.ja.patch — the Ziy signing bypass

`patch-omni.py` flips two booleans inside `modules/AppConstants.sys.mjs` in a
copy of Firefox's `omni.ja`, byte-length preserving, and re-verifies the result
before writing it.

## Why

Firefox release builds refuse unsigned add-ons. `MOZ_REQUIRE_SIGNING` and
`MOZ_ALLOW_ADDON_SIDELOAD` in `modules/AppConstants.sys.mjs` are the switches,
and `AddonSettings.sys.mjs` turns them into hard constants: with
`MOZ_REQUIRE_SIGNING: true`, `isCorrectlySigned()` in `XPIDatabase.sys.mjs`
rejects anything whose `signedState <= SIGNEDSTATE_MISSING` for the app scope,
which is why a hand-placed `.xpi` in `distribution/extensions/` is silently
ignored on stock Firefox.

Ziy's whole suite is built from this repo and is unsigned, so we need them off.
Mozilla uses exactly this configuration for Nightly/Dev Edition/CI.

### Verified on this box

| claim | command | result |
| --- | --- | --- |
| the two constants are only in that JS module | `strings -a /usr/lib/firefox/firefox-bin \| grep MOZ_REQUIRE_SIGNING` and the same against `libxul.so` | 0 matches in both; present in `omni.ja` |
| the member is stored (uncompressed) | central directory entry `method 0, csize 6084` | stored, so a same-length rewrite is possible |
| the member is byte-length patchable | this script, over `/usr/lib/firefox/omni.ja` | file size unchanged, CRCs recomputed and equal, all 2579 entries still have their local headers |

Because the constants are not compiled in anywhere else, patching the file is a
configuration change, not a binary patch. `tools/verify.sh` asserts the applied
strings after every build, so a Firefox release that moves them fails loudly at
build time rather than at shipping time.

## The container format (the byte map)

`omni.ja` is a zip with a small envelope. It is not readable by `zipfile`
straight off, which is why this script parses it by hand:

```
offset 0   : 4 bytes  envelope prefix (0d 7f d6 00) — Mozilla's omnijar
offset 4   : zip
              central directory  length = cd_size
              EOCD at cd_start + cd_size
              local file headers and member data, after the EOCD
              local header offsets in the central directory are absolute file
              offsets, not relative to a zip start
```

The parser locates the correct EOCD by testing every `PK\x05\x06` candidate:
the right one is the one whose recorded `cd_size` ends exactly at its own
position and whose central directory begins with `PK\x01\x02`. That heuristic is
what makes the script stop guessing which of the two EOCD records in the file is
the container's.

## What the script changes

Three byte runs, and nothing else:

| run | field | value |
| --- | --- | --- |
| `modules/AppConstants.sys.mjs` body | `MOZ_REQUIRE_SIGNING: true,` → `false,` | enables app-scope unsigned installs |
| same file, same body | `MOZ_ALLOW_ADDON_SIDELOAD: false,` → `true,` | enables `extensions.sideloadScopes` |
| central-directory entry + local header | CRC-32 of that member, both copies | keeps the archive honest |

`true` and `false` differ in length, so the two substitutions cannot both be
length-preserving on their own. They are paired: the signing flip turns the
four-character `true` into the five-character `false` (+1 byte) and the sideload
flip turns the five-character `false` into the four-character `true` (−1 byte),
so the file's total length is unchanged. The script asserts
`len(patched) == len(source)` and refuses to write otherwise; the verification
pass then compares output to input byte by byte and allows only the member body
and the two CRC fields to differ, so any length drift or stray write is
impossible to miss.

## Usage

```
python3 shell/omni.ja.patch/patch-omni.py <in-omni.ja> <out-omni.ja>
```

`tools/build-shell.sh` calls it against the engine's `omni.ja` and installs the
result into `build/ziy/omni.ja`. To re-apply after a Firefox upgrade:

```
./tools/update-engine.sh
```

which discovers the new install, re-verifies this patcher's preconditions
against it **before** anything is written, rebuilds `build/ziy` through
`tools/build-shell.sh`, and fails loudly naming the member and the exact
string if either source string has moved (exit code 1) — the same
`PRECONDITION FAILED` shape this script uses. The full bump story is
`replica/deep-fork.md` §7.

## Exit codes

| code | meaning |
| --- | --- |
| 0 | patched and verified |
| 1 | precondition failed: a source string is missing (already patched, or the constant moved) |
| 2 | verification failed: the output would be inconsistent |
| 3 | usage or IO error |
