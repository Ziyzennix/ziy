//! ziy-blocks — the Ziy native messaging host for the blocking engine.
//!
//! WHY THIS EXISTS (replica/native-expansion.md §2a, §7.1 T1)
//! ----------------------------------------------------------
//! Ziy's in-browser blocking is capped by the engine's DNR quota (30,000
//! guaranteed static rules — an over-quota ruleset is dropped whole) plus a JS
//! residual tier measured at 0.34–9.67 ms per request (mean 1.10 ms) and
//! 0.147 ms per request indexed (`native-expansion.md` §6.4). adblock-rust —
//! the engine Brave itself shipped — replaces both: 0.0032–0.0050 ms per
//! request, no rule ceiling, one precompiled engine file holding every rule
//! from the 7 shipped snapshots.
//!
//! This host ANSWERS; it does not block. Nothing in the extension's webRequest
//! path changes in T1: the host takes `{op:"verdict", url, initiator, type}`
//! and replies with a verdict. Wiring the verdict into the request path is a
//! later deliverable (T4), deliberately.
//!
//! PROTOCOL (stdio, MDN native messaging — same framing as ziy-sync-agent and
//! ziy-pwd; the JS side of it lives in lib/native-protocol.js beside this file)
//! -------------------------------------------------------------------------
//! Requests and replies are one JSON object each, preceded by a 4-byte
//! unsigned little-endian length, max 1 MB per message (MDN:
//! <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging>).
//! Replies are `{ok:true, op, ms, result}` or `{ok:false, op, ms, error, message}`
//! — errors are answers, not crashes, exactly like the sibling hosts.
//!
//! OPS
//! ---
//! * `capabilities` — service/version, the op list, engine stats. The install
//!   script's probe; cheap enough to call once per connection.
//! * `verdict`      — `{url, initiator?, type?, method?}` →
//!   `{verdict: "block"|"allow"|"pass", filter, exception, important, redirect,
//!   rewritten}`. The vocabulary is the three-way the extension's own decision
//!   path needs: `block` (cancel the request), `allow` (an `@@`/exception rule
//!   decided it), `pass` (no rule matched — no opinion). `filter`/`exception`
//!   are RESERVED for rule text and are null in this configuration: the engine
//!   is built without debug info (gen.rs), which the crate documents as the
//!   mode where source information is not retained. They stay in the reply so
//!   a debug-info rebuild can populate them without a protocol change.
//!
//! LAUNCH GUARD
//! ------------
//! MDN: the browser starts the host with `<manifest path> <extension id>`.
//! Only ziy-shields may be served — a native host that answers anyone who can
//! launch it is a browsing-history oracle. Mirror of
//! native/ziy-sync-agent/ziy-sync-agent.js's verifyLaunch and
//! native/ziy-pwd/lib/native-protocol.js:23.
//!
//! ENGINE LOCATION
//! ---------------
//! `ZIY_BLOCKS_ENGINE` env var, else `ziy-blocks-engine.dat` beside the
//! executable — the install script copies the binary and the engine into
//! `~/.ziy/native/` together, and the dev build reads `dist/` via the env var
//! set by tools/build-blocks-engine.sh. When the engine cannot be loaded the
//! host still RUNS and answers: verdicts refuse with `engine-unavailable`
//! instead of the process dying silently — a dead port is the failure mode a
//! user can least diagnose (the same reasoning as the sync agent's
//! `rehydrateError`).

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Instant;

use adblock::engine::Engine;
use adblock::request::Request;
use serde_json::{json, Value};

/// MDN, "Native messaging": "an unsigned 32-bit value containing the message
/// length in native byte order" and "The maximum size of a single message from
/// the application is 1 MB." Identical constants to
/// native/ziy-sync-agent/lib/native-protocol.js.
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

/// The one extension this host serves (ADDON-ID: shell/extensions.list).
const ALLOWED_EXTENSION_ID: &str = "ziy-shields@ziy.app";

fn main() {
    if let Err(fault) = run() {
        // MDN: "If the native application sends any output to stderr, the
        // browser will redirect it to the browser console." Real faults go
        // there; stdout speaks framed JSON only, never diagnostics.
        eprintln!("ziy-blocks: {fault}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    // argv: [exe, manifest-path, extension-id] — a binary host gets exactly
    // these two arguments, so the id is argv[2] (the node-hosted siblings check
    // argv[3] because the interpreter inserts the script path first).
    let args: Vec<String> = std::env::args().collect();
    match args.get(2).map(String::as_str) {
        Some(id) if id == ALLOWED_EXTENSION_ID => {}
        Some(id) => {
            eprintln!("ziy-blocks: refusing to serve extension {id}");
            std::process::exit(2);
        }
        None => {
            eprintln!("ziy-blocks: no extension id in argv (expected: <manifest-path> <extension-id>)");
            std::process::exit(2);
        }
    }

    let engine_path = engine_path();
    let loaded = match load_engine(&engine_path) {
        Ok(loaded) => Ok(loaded),
        Err(fault) => {
            // The detail (including the path) goes to stderr only; replies
            // carry the generic sentence, mirroring safeMessage() in the
            // sibling hosts.
            eprintln!(
                "ziy-blocks: engine unavailable ({fault}) — build it with tools/build-blocks-engine.sh"
            );
            Err("the engine could not be loaded; see the host log (stderr)".to_string())
        }
    };

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();

    loop {
        let frame = match read_frame(&mut input) {
            Ok(Some(body)) => body,
            Ok(None) => break, // clean EOF: the browser closed the pipe
            Err(fault) => {
                // A desynchronised length prefix is never recoverable, and
                // guessing is how a native host reads JSON as a length. Die
                // loudly; the browser sends SIGTERM anyway.
                return Err(format!("framing error: {fault}"));
            }
        };

        let started = Instant::now();
        let message: Value = match serde_json::from_slice(&frame) {
            Ok(value) => value,
            Err(error) => {
                return Err(format!("framing error: body was not JSON: {error}"));
            }
        };

        let reply = dispatch(&loaded, &message, started);
        let body = serde_json::to_vec(&reply).map_err(|error| format!("encode: {error}"))?;
        write_frame(&mut output, &body)?;
    }

    Ok(())
}

/// Where the serialized engine lives. Tests and the dev build point
/// `ZIY_BLOCKS_ENGINE` at native/ziy-blocks/dist/; an installed host finds the
/// file beside its own binary.
fn engine_path() -> PathBuf {
    if let Ok(path) = std::env::var("ZIY_BLOCKS_ENGINE") {
        return PathBuf::from(path);
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("ziy-blocks-engine.dat")))
        .unwrap_or_else(|| PathBuf::from("ziy-blocks-engine.dat"))
}

struct Loaded {
    engine: Engine,
    bytes: usize,
    load_ms: u64,
}

/// Read the serialized engine and deserialize it into a fresh [`Engine`].
/// `Engine::default()` is an empty engine (the crate's own `Default` impl);
/// `deserialize` replaces its rule data with the flatbuffer in the file.
fn load_engine(path: &std::path::Path) -> Result<Loaded, String> {
    let data = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let started = Instant::now();
    let mut engine = Engine::default();
    engine
        .deserialize(&data)
        .map_err(|e| format!("deserialize: {e:?}"))?;
    Ok(Loaded {
        engine,
        bytes: data.len(),
        load_ms: started.elapsed().as_millis() as u64,
    })
}

/// Dispatch one message. Errors are answers, not crashes — the process keeps
/// serving after a bad request, so one missing field can never take the port
/// down.
fn dispatch(loaded: &Result<Loaded, String>, message: &Value, started: Instant) -> Value {
    let op = message
        .get("op")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let outcome: Result<Value, (String, String)> = match op.as_str() {
        "capabilities" => Ok(capabilities(loaded)),
        "verdict" => match loaded {
            Ok(loaded) => verdict(&loaded.engine, message),
            Err(reason) => Err(("engine-unavailable".to_string(), reason.clone())),
        },
        _ => Err((
            "unknown-op".to_string(),
            format!("no handler for op \"{op}\""),
        )),
    };

    let ms = started.elapsed().as_millis() as u64;
    match outcome {
        Ok(result) => json!({ "ok": true, "op": op, "ms": ms, "result": result }),
        Err((error, message)) => {
            json!({ "ok": false, "op": op, "ms": ms, "error": error, "message": message })
        }
    }
}

fn capabilities(loaded: &Result<Loaded, String>) -> Value {
    let engine = match loaded {
        Ok(loaded) => json!({ "bytes": loaded.bytes, "load_ms": loaded.load_ms }),
        Err(_) => Value::Null,
    };
    json!({
        "service": "ziy-blocks",
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": "mdn-native-messaging/uint32le-json",
        "ops": ["capabilities", "verdict"],
        "engine": engine,
    })
}

/// One verdict. The three-way vocabulary (see the module header): `block`,
/// `allow`, `pass`. adblock-rust's own `should_block()` is
/// `important || (filter.is_some() && exception.is_none())`; the `allow` case
/// is when an exception rule matched — with or without a competing block rule,
/// the exception is the decision the extension can act on.
fn verdict(engine: &Engine, message: &Value) -> Result<Value, (String, String)> {
    let url = message
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| ("bad-request".to_string(), "verdict needs a url".to_string()))?;
    let initiator = message
        .get("initiator")
        .and_then(Value::as_str)
        .unwrap_or("");
    let request_type = message
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("other");
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET");

    // Same type vocabulary the engine's WebRequest integration uses
    // (request.rs's `cpt_match_type`), so a caller can pass the webRequest
    // `type` through unchanged; unknown strings degrade to `other` inside the
    // crate.
    let request = Request::new(url, initiator, request_type, method)
        .map_err(|error| ("bad-request".to_string(), format!("unparseable request: {error:?}")))?;

    let result = engine.check_network_request(&request);
    let blocked = result.important || (result.filter.is_some() && result.exception.is_none());
    let decision = if blocked {
        "block"
    } else if result.exception.is_some() {
        "allow"
    } else {
        "pass"
    };
    let filter = result.filter.as_ref().and_then(|info| info.raw_line.clone());
    let exception = result.exception.as_ref().and_then(|info| info.raw_line.clone());

    Ok(json!({
        "verdict": decision,
        "filter": filter,
        "exception": exception,
        "important": result.important,
        "redirect": result.redirect,
        "rewritten": result.rewritten_url,
    }))
}

/// Read one frame: 4-byte UInt32LE length, then exactly that many bytes.
/// `Ok(None)` is a clean EOF before any byte of a header; every partial read is
/// an error — see the framing comment in run().
fn read_frame(input: &mut impl Read) -> Result<Option<Vec<u8>>, String> {
    let mut header = [0u8; 4];
    let mut filled = 0;
    while filled < 4 {
        match input.read(&mut header[filled..]) {
            Ok(0) => {
                return if filled == 0 {
                    Ok(None)
                } else {
                    Err(format!("partial header: {filled} of 4 bytes"))
                };
            }
            Ok(n) => filled += n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("read: {error}")),
        }
    }

    let length = u32::from_le_bytes(header) as usize;
    if length > MAX_MESSAGE_BYTES {
        return Err(format!(
            "message length {length} exceeds {MAX_MESSAGE_BYTES}"
        ));
    }

    let mut body = vec![0u8; length];
    let mut filled = 0;
    while filled < length {
        match input.read(&mut body[filled..]) {
            Ok(0) => return Err(format!("partial body: {filled} of {length} bytes")),
            Ok(n) => filled += n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("read: {error}")),
        }
    }
    Ok(Some(body))
}

/// Write one frame and flush — the browser reads the pipe, so a reply that sits
/// in a buffer is a reply that never arrives.
fn write_frame(output: &mut impl Write, body: &[u8]) -> Result<(), String> {
    let header = (body.len() as u32).to_le_bytes();
    output
        .write_all(&header)
        .and_then(|()| output.write_all(body))
        .and_then(|()| output.flush())
        .map_err(|error| format!("write: {error}"))
}
