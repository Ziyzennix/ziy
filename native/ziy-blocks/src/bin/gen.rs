//! ziy-blocks-gen — build the serialized blocking engine from the shipped
//! snapshots.
//!
//! WHY THIS EXISTS (replica/native-expansion.md §7.1 T1): the host must not
//! parse 5.26 MB of filter text at browser start. Parsing happens ONCE, at
//! package-build time, here; the host reloads the result in ~40 ms
//! (`native-expansion.md` §6.1) instead of ~200 ms of parse + engine build on
//! every profile.
//!
//! WHAT IT DOES
//! ------------
//! Reads every `*.txt` in <snapshots_dir> — the 7 shipped lists from
//! extensions/ziy-shields/lib/filterlist/snapshots/ (easylist, easyprivacy,
//! fanboy-cookiemonster, uabo-filters, urlhaus,
//! antiadblock-warning-removal, brave-unbreak) — concatenates them, builds one
//! adblock-rust engine, and writes the serialized form to <out_file>.
//!
//! The build options match the measured configuration in
//! `native-expansion.md` §6.1: debug info off (`FilterSet::new(false)` —
//! smaller engine; a documented consequence is that verdicts carry no rule
//! text, see the host's OPS notes), all rule types (network AND cosmetic:
//! the cosmetic half is unused by the verdict op today but travels with the
//! engine for the later wiring).
//!
//! SELF-CHECK: after serializing, the engine is round-tripped
//! (`Engine::deserialize`) and probed with two pinned URLs — a tracker from
//! the shipped set and a clean URL. A generator that writes an engine the host
//! cannot load, or that cannot match its own fixtures, exits non-zero rather
//! than shipping a bad artifact.
//!
//! Run it via tools/build-blocks-engine.sh — never at browser runtime.

use std::path::{Path, PathBuf};
use std::time::Instant;

use adblock::engine::Engine;
use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;

/// The two pinned fixtures the self-check probes. They are the same URLs two
/// independent measurements matched on this box (`native-expansion.md` §6.1
/// sanity block), so a drift here means the engine or the lists changed
/// meaningfully and the artifact must not ship silently.
const TRACKER_URL: &str = "https://www.google-analytics.com/analytics.js";
const CLEAN_URL: &str = "https://cdn.example.com/app.js";

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: ziy-blocks-gen <snapshots_dir> <out_file>");
        std::process::exit(2);
    }
    let snapshots_dir = Path::new(&args[1]);
    let out_file = Path::new(&args[2]);

    let files = list_snapshot_files(snapshots_dir);
    if files.is_empty() {
        eprintln!(
            "ziy-blocks-gen: no *.txt lists in {} — is the tree complete?",
            snapshots_dir.display()
        );
        std::process::exit(1);
    }

    let mut text = String::new();
    for file in &files {
        let body = std::fs::read_to_string(file)
            .unwrap_or_else(|e| fail(&format!("read {}: {e}", file.display())));
        println!(
            "  {:>10} bytes  {}",
            body.len(),
            file.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        );
        text.push_str(&body);
        if !body.ends_with('\n') {
            text.push('\n');
        }
    }
    println!(
        "lists: {} files, {} bytes",
        files.len(),
        text.len()
    );

    let started = Instant::now();
    let mut filter_set = FilterSet::new(false); // false: no debug info (see header)
    filter_set.add_filter_list(text, ParseOptions::default());
    let engine = Engine::new_with_filter_set(filter_set);
    println!("engine build: {} ms", started.elapsed().as_millis());

    let started = Instant::now();
    let serialized = engine.serialize();
    println!("serialize: {} ms", started.elapsed().as_millis());

    self_check(&serialized);

    if let Some(parent) = out_file.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .unwrap_or_else(|e| fail(&format!("mkdir {}: {e}", parent.display())));
        }
    }
    std::fs::write(out_file, &serialized)
        .unwrap_or_else(|e| fail(&format!("write {}: {e}", out_file.display())));
    println!(
        "wrote {} ({} bytes, {:.2} MiB)",
        out_file.display(),
        serialized.len(),
        serialized.len() as f64 / 1048576.0
    );
}

/// Every regular `*.txt` file in the directory, sorted for determinism — the
/// same input always produces the same artifact.
fn list_snapshot_files(dir: &Path) -> Vec<PathBuf> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => fail(&format!("read {}: {e}", dir.display())),
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| path.extension().map(|ext| ext == "txt").unwrap_or(false))
        .collect();
    files.sort();
    files
}

/// Round-trip the artifact and probe the two pinned fixtures. This is the
/// generator's own acceptance test: it fails here, in the build step, rather
/// than in a user's browser.
fn self_check(serialized: &[u8]) {
    let mut engine = Engine::default();
    engine
        .deserialize(serialized)
        .unwrap_or_else(|e| fail(&format!("self-check: deserialize failed: {e:?}")));

    let tracker = matches(&engine, TRACKER_URL);
    let clean = matches(&engine, CLEAN_URL);
    println!(
        "self-check: {TRACKER_URL} -> {} (expected block); {CLEAN_URL} -> {} (expected pass)",
        tracker.0, clean.0
    );
    if tracker.0 != "block" {
        fail("self-check: the tracker fixture did not block — refusing to ship this engine");
    }
    if clean.0 != "pass" {
        fail("self-check: the clean fixture did not pass — refusing to ship this engine");
    }
}

/// One synchronous probe through the identical request path the host uses.
fn matches(engine: &Engine, url: &str) -> (&'static str, bool) {
    let request = Request::new(url, "https://news.example/", "script", "GET")
        .unwrap_or_else(|e| fail(&format!("self-check: request build failed: {e:?}")));
    let result = engine.check_network_request(&request);
    let blocked = result.important || (result.filter.is_some() && result.exception.is_none());
    let decision = if blocked {
        "block"
    } else if result.exception.is_some() {
        "allow"
    } else {
        "pass"
    };
    (decision, result.filter.is_some())
}

fn fail(message: &str) -> ! {
    eprintln!("ziy-blocks-gen: {message}");
    std::process::exit(1);
}
