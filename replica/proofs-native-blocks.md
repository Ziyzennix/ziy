# proofs-native-blocks.md — T1 (the blocking-engine host) and T1b (the store's pragma)

**Session:** 2026-10-16 · **Box:** i5-4590 (4 cores), ~3.4 GiB available, iGPU only,
Node v26.10.0, rustc/cargo 1.90.0 (`~/.cargo`). **Scope:** the first two items of
`replica/native-expansion.md` §7.1 — the Rust blocking host (T1) and the sync
server's durability pragma (T1b) — built, gated and measured. Every number below
traces to a command run in this session; limbs that could not be verified are
marked **unverified** rather than smoothed over.

---

## 1. What was built (T1)

`native/ziy-blocks` — the second native helper after `ziy-sync-agent`/`ziy-pwd`,
in Rust:

| path | role |
| --- | --- |
| `src/main.rs` | the host: launch guard (argv[2] must be `ziy-shields@ziy.app`, else exit 2), UInt32LE framing (≤ 1 MiB), engine load at start (`ZIY_BLOCKS_ENGINE` env, else beside the exe), ops `capabilities` + `verdict`, errors are answers not crashes |
| `src/bin/gen.rs` | snapshots → serialized engine; self-checks the artifact (round-trip + 2 pinned fixtures) and refuses to write a bad one |
| `lib/native-protocol.js` | the JS side of the framing — a per-host copy, the documented exception; its one difference is the id constant |
| `test/verdict.test.mjs` | the 13-test gate: real binary, real pipe, real verdicts |
| `bench/verdict-bench.mjs` | the print-only benchmark |
| `Cargo.toml` / `Cargo.lock` | `adblock` pinned `=0.13.3`, **default features** (see §2's deviation) |
| `tools/build-blocks-engine.sh` | builds the host + generator, then generates the engine |
| `tools/install-ziy-blocks-native.js` | installs binary + engine under `~/.ziy/native/`, writes the native-messaging manifest, then probes the installed host |

Verdict vocabulary: `block` / `allow` / `pass`. The mapping is
`important || (filter.is_some() && exception.is_none())` → `block` (exactly
adblock-rust's own `should_block()`), `exception.is_some()` → `allow`, else
`pass` — the three-way the extension's decision path needs.

## 2. The build, and the one deviation from the plan

```
$ bash tools/build-blocks-engine.sh
       72786 bytes  antiadblock-warning-removal.txt
      121930 bytes  brave-unbreak.txt
     2153175 bytes  easylist.txt
     1509098 bytes  easyprivacy.txt
      900522 bytes  fanboy-cookiemonster.txt
      473295 bytes  uabo-filters.txt
       34450 bytes  urlhaus.txt
lists: 7 files, 5265257 bytes
engine build: 214 ms
serialize: 10 ms
self-check: https://www.google-analytics.com/analytics.js -> block (expected block); https://cdn.example.com/app.js -> pass (expected pass)
wrote native/ziy-blocks/dist/ziy-blocks-engine.dat (7864005 bytes, 7.50 MiB)
```

Cold `cargo build --release`: **1m42s** (58 crates). The snapshots total
5,265,257 bytes here vs §6.1's 5,265,256 — the extra byte is the generator's
newline normalization on a file that lacks a trailing newline.

**Deviation, recorded:** the plan's §6.1 repro line says
`default-features=false`. That configuration is not shippable as written —
`Request::new` panics on every URL parse without the embedded PSL resolver
(`url_parser/mod.rs:104-106`: *"An external domain resolver must be set when
the embedded-domain-resolver feature is disabled"*), and `$domain=` rules
depend on that resolver. The crate therefore pins **default features**. Measured
consequence: engine **7,864,005 B** vs the plan's 7,864,405 B (400 B smaller),
engine build **214 ms** vs 201.3 ms. Both numbers are recorded; the plan's
figure was measured under a feature set its own repro line does not reproduce.

## 3. The gate (T1) — 13/13, over the real pipe

```
$ node --test native/ziy-blocks/test
✔ capabilities names the service, the protocol and both ops (67.9ms)
✔ block: a tracker script from the shipped set is blocked (63.2ms)
✔ block: an ads host from the shipped set is blocked (66.7ms)
✔ block: a urlhaus entry from the shipped set is blocked (61.1ms)
✔ pass: a clean URL gets no opinion (63.1ms)
✔ allow: a brave-unbreak `@@` exception decides — and its domain scope holds (137.8ms)
✔ unknown op is an answer, not a crash — the host keeps serving (66.3ms)
✔ a verdict without a url is a bad-request answer (62.9ms)
✔ two pipelined frames are answered in order (62.2ms)
✔ refuses any extension that is not ziy-shields (12.9ms)
✔ refuses to serve when the launch line has no extension id (2.6ms)
✔ an over-limit length prefix kills the host loudly, not quietly (66.8ms)
✔ the JS protocol module pins the framing the host speaks (0.3ms)
ℹ tests 13 · pass 13 · fail 0 · duration 859.6 ms
```

The fixtures were read off the built engine (probe) before being pinned:

| fixture | request | initiator | verdict |
| --- | --- | --- | --- |
| easylist tracker | `https://www.google-analytics.com/analytics.js` | `news.example` | `block` |
| easylist ads | `https://pageads2.googlesyndication.com/bgz/ads?id=1` | `news.example` | `block` |
| urlhaus | `http://acms.saleseos.com/x` | `news.example` | `block` |
| clean | `https://cdn.example.com/app.js` | `news.example` | `pass` |
| brave-unbreak `@@` | `https://imasdk.googleapis.com/pal/sdkloader/pal.js` | `southpark.de` | `allow` |
| the same URL | `…pal.js` | `news.example` | **not** `allow` (the `$domain=` scope is real) |

Behaviours the suite proves beyond verdicts: the launch guard (exit 2 for a
wrong id, exit 2 with no id), loud death on an over-limit length prefix (exit 1,
`exceeds` on stderr), unknown-op answered and the same connection keeps
serving, a `verdict` without `url` answered `bad-request`, and two pipelined
frames answered in order.

## 4. The benchmark (T1's gate figure)

```
$ node native/ziy-blocks/bench/verdict-bench.mjs
engine:   7864005 bytes (7.50 MiB)
warmup:   200 requests in 69 ms
block:    1000 requests, mean 0.0577 ms/request
clean:    1000 requests, mean 0.0571 ms/request
combined: mean 0.0574 ms/request
```

Next to the plan's figures (§6.1/§6.2/§6.4): engine match 0.0032 ms block /
0.0050 ms clean; stdio bridge 0.062 ms/round-trip; shipped JS tiers
0.34–9.67 ms/req static (mean 1.10) and 0.147 ms/req indexed. Reading: the
end-to-end pipe number lands **at** the bridge figure — the pipe, not the
matching, is the cost. Load-at-start is ~50 ms per host process
(`capabilities.result.engine.load_ms`; the sandbox probe below saw 40 ms).

## 5. The install path, proven in a sandbox

The real `~/.mozilla`/`~/.ziy` install was deliberately NOT performed this
session; the same script was run against sandbox roots instead:

```
$ ZIY_NATIVE_MANIFEST_DIR=/tmp/opencode/ziy-home ZIY_BLOCKS_DIR=/tmp/opencode/ziy-blocks-install \
    node tools/install-ziy-blocks-native.js
ziy-blocks-native: wrote /tmp/opencode/ziy-home/native-messaging-hosts/ziy-blocks.json
ziy-blocks-native: installed the host at /tmp/opencode/ziy-blocks-install/ziy-blocks (mode 0755)
ziy-blocks-native: engine at /tmp/opencode/ziy-blocks-install/ziy-blocks-engine.dat
ziy-blocks-native: host verified — ziy-blocks 0.1.0, engine 7864005 bytes loaded in 40 ms
```

Manifest written (verbatim): `{"name":"ziy-blocks","description":"Ziy's blocking
engine host: adblock-rust over the 7 shipped filter-list snapshots. It answers
verdicts; the extension still issues every block.","type":"stdio","path":
"…/ziy-blocks","allowed_extensions":["ziy-shields@ziy.app"]}`. Binary
3,410,736 B mode 0755 + engine beside it — the layout the host resolves
(`<exe-dir>/ziy-blocks-engine.dat`). The probe boots the installed binary over
the real protocol, so a manifest pointing at a broken binary cannot pass
silently.

## 6. T1b — the store's durability pragma

Files: `server/src/store.js` lines 122–146 (the trade-off comment + the pragma
pair, inserted right after `new DatabaseSync`), and
`server/test/durability.test.mjs` (89 lines, 2 tests, diagnostic-printed timing).

Measured, bare `node:sqlite` with the server's own DDL (throwaway in
`/tmp/opencode`):

| inserts | default (delete journal, sync=FULL) | WAL + NORMAL | factor |
| --- | --- | --- | --- |
| 100 | 13,233.0 ms = 132.330 ms/insert | 1.8 ms = 0.018 ms/insert | 7,260× |
| 500 | 68,384.9 ms = 136.770 ms/insert | 306.4 ms = 0.613 ms/insert | 223× |

The WAL figure is run-shape-bound (an autocheckpoint lands inside the
500-insert loop) — every WAL number is sub-millisecond, the spread is
checkpoint placement, not inconsistency. Through the **real** `BlindStore`,
`durability.test.mjs` printed **0.186 ms/blob** (18.6 ms / 100 `putBlob`) in
this session's run; the build worker's runs printed 0.281 ms/blob standalone and
0.389 ms/blob inside the full suite. The recorded baseline it is read against:
144.059 ms/blob (§6.4).

**Tripwire proof.** On a `/tmp` copy with ONLY the two pragma lines stripped,
`node --test server/test` → **47.1 s, 17 pass / 1 fail**, the failure being
exactly the new assertion (`'delete' !== 'wal'`). With the pragma: **18/18 pass
in ~11.15 s**. The ~4× suite speedup is attributable to the change, not
environment drift.

**Process-crash durability, checked not assumed.** A child process wrote 200
blobs through the real `BlindStore`, printed ACKNOWLEDGED, then was SIGKILLed
by exact PID (no graceful close). On reopen: `journal_mode=wal`, **200/200
acknowledged rows survived**, 3.36 MB of un-checkpointed WAL replayed — which
is the "cannot lose a committed transaction to a process crash" half of the
constructor comment, verified.

**Unverified, stated:** the power-loss limb (untestable without a power cut;
rests on SQLite's documented WAL semantics, as the comment says), and network
mounts (WAL on NFS/SMB can error rather than degrade; the default data dir is
local and that path is untested).

## 7. What this does NOT claim

- **Nothing is wired into the extension's request path.** The host answers
  verdicts; `ziy-shields` still blocks with its own engine and DNR tier. Wiring
  is T4 (§7.2) and must be proven in-browser (5-of-5 trackers, the D-7 count,
  the Spotify guard) with the host attached.
- **Windows/Android:** untested — §6.6's blanket note carries unchanged.
- **Rule-by-rule parity with `dnr-compile.js`:** not diffed; that is the T4
  deliverable's job, not this one's.
- **Rule text in verdicts:** with debug info off (the 7.50 MiB choice),
  `filter`/`exception` are reserved-null; a debug-info rebuild is a documented,
  unmeasured future option.
- **The real home-dir install:** sandbox-proven only (§5).

## 8. Reproduce, in order

```bash
export PATH="$HOME/.cargo/bin:$PATH"
bash tools/build-blocks-engine.sh            # host + generator + engine (~2 min cold)
node --test native/ziy-blocks/test           # 13/13, ~0.9 s warm
node native/ziy-blocks/bench/verdict-bench.mjs
node --test server/test                      # 18/18, ~11 s (was fsync-bound ~47–120 s)
node --test server/test/durability.test.mjs  # the ms/blob diagnostic, standalone
ZIY_NATIVE_MANIFEST_DIR=/tmp/opencode/ziy-home ZIY_BLOCKS_DIR=/tmp/opencode/ziy-blocks-install \
  node tools/install-ziy-blocks-native.js    # sandbox install + probe
```
