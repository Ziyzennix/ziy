# native/ziy-blocks — the blocking engine host

T1 of the native expansion plan (`replica/native-expansion.md` §7.1). One
question, answered at native speed: **should this request be blocked?** — from a
precompiled [adblock-rust](https://github.com/brave/adblock-rust) engine built
out of the 7 filter snapshots the shields extension already ships.

This host *answers*; it does not block. Nothing in the extension's webRequest
path changes in T1 — wiring verdicts into the request path is a later
deliverable (T4), deliberately.

## Why it exists

Ziy's in-browser blocking is capped by the engine's DNR quota (30,000
guaranteed static rules; an over-quota ruleset is dropped whole) plus a JS
residual tier measured at 0.34–9.67 ms/request (mean 1.10) and 0.147 ms/request
indexed. This host replaces both with one engine that holds every rule from
the shipped set and no ceiling — measured on this box, 2026-10-16:

| step | number |
| --- | --- |
| engine build, 7 lists / 5,265,257 bytes of text | 214 ms (build-time only) |
| serialize | 10 ms |
| artifact | 7,864,005 bytes (7.50 MiB) |
| load at host start (deserialize) | ~50 ms |
| over-the-pipe verdict, end to end | **0.0574 ms/request** (1000 block + 1000 clean) |

The plan's context figures (`§6.1`/`§6.4`): engine match 0.0032/0.0050 ms,
stdio bridge 0.062 ms/round-trip. The measured end-to-end number lands at the
bridge — the pipe, not the matching, is the cost. Full transcript:
`replica/proofs-native-blocks.md`.

## Layout

| path | what it is |
| --- | --- |
| `src/main.rs` | the host: launch guard, framing, engine load, dispatch. Its module header is the protocol reference. |
| `src/bin/gen.rs` | the generator: snapshots → serialized engine, with a self-check that refuses to ship an engine its own fixtures fail. |
| `lib/native-protocol.js` | the JS side of the wire protocol — used by the test and the install probe. Each host carries its own copy; the id constant is the one difference. |
| `test/verdict.test.mjs` | the 13-test gate: real binary, real pipe, real verdicts. |
| `bench/verdict-bench.mjs` | the per-request benchmark (print-only). |
| `Cargo.toml` / `Cargo.lock` | `adblock` pinned `=0.13.3`, default features (the PSL resolver is required at runtime — see the comment in `Cargo.toml`). |

## Commands

```bash
# build the host + generate the engine (artifacts are gitignored)
bash tools/build-blocks-engine.sh          # or --gen-only to reuse the binary

# the gate — builds on demand, then asserts
node --test native/ziy-blocks/test

# the benchmark
node native/ziy-blocks/bench/verdict-bench.mjs [N]   # default 2000

# install (writes ~/.ziy/native/ + the native-messaging manifest, then probes)
node tools/install-ziy-blocks-native.js --dry-run
node tools/install-ziy-blocks-native.js
```

## Protocol (in one breath)

MDN native messaging: UTF-8 JSON preceded by a UInt32LE length, ≤ 1 MB. Replies
are `{ok, op, ms, result}` or `{ok:false, op, ms, error, message}` — errors are
answers, not crashes. Ops:

- `capabilities` — service, version, op list, engine stats.
- `verdict` — `{url, initiator?, type?, method?}` →
  `{verdict: "block"|"allow"|"pass", filter, exception, important, redirect, rewritten}`.

`block` = cancel the request. `allow` = an `@@` exception rule decided it
(scoped rules respected — the `$domain=` guard is exercised by the test suite).
`pass` = no rule matched; no opinion. `filter`/`exception` are RESERVED for rule
text and are null in this configuration: the engine is built without debug info
(the 7.50 MiB price), and the fields stay so a debug-info rebuild can populate
them without a protocol change.

The launch guard refuses any extension but `ziy-shields@ziy.app` (exit 2); with
no engine file present the host still runs and verdicts answer
`engine-unavailable` — a dead port is the failure mode users can least
diagnose.

## Licensing

Ziy's code here is MPL-2.0, as the rest of the tree. `adblock-rust` is
MPL-2.0. The filter lists' licences are recorded in
`extensions/ziy-shields/LICENSES`.
