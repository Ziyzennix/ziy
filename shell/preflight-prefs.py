#!/usr/bin/env python3
"""Preflight the Ziy autoconfig/pref layer BEFORE anything boots.

This script exists because of a bug that cost real time: a lockPref() in
mozilla.cfg for a pref whose value the engine's own consumer rejects makes the
prefs service refuse the write, and a refused write inside autoconfig aborts the
rest of the file. The result is an engine that is silently half-configured and
crashes on the graphics compositor — a symptom that looks nothing like a pref
problem.

The concrete case, verified against modules/FingerprintingWebCompatService.sys.mjs
inside the installed engine's omni.ja:

    privacy.fingerprintingProtection.granularOverrides  ->  JSON ARRAY, not string
    privacy.fingerprintingProtection.overrides           ->  RFP target STRING

The engine does `JSON.parse(pref || "[]")` on the first and validates each entry
against a JSON schema. Passing `true` (or any non-JSON string) is a hard parse
error, not a silent fallback.

What this script checks, all offline, no browser launched:

  1. every pref referenced in ziy.js / ziy-hardening.js / mozilla.cfg is spelled
     consistently across those files (the hardening set must agree — that is what
     makes the lock honest),
  2. the known JSON-valued prefs really parse as JSON,
  3. the prefs we claim are RFP-target-string-valued hold the documented syntax,
  4. no pref is locked in mozilla.cfg while also being set to a DIFFERENT value
     in ziy.js (that would just make the lock the effective value and the pref a
     lie),
  5. mozilla.cfg is world-readable, as the autoconfig loader requires.

Usage:
    python3 shell/preflight-prefs.py          # check, exit 1 on any problem
    python3 shell/preflight-prefs.py --list   # print what it found

Exit codes: 0 = clean, 1 = a problem worth stopping the build for.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

PREFS_DIR = REPO / "shell" / "browser" / "defaults" / "preferences"
ZIY_JS = PREFS_DIR / "ziy.js"
HARDENING_JS = PREFS_DIR / "ziy-hardening.js"
MOZILLA_CFG = REPO / "shell" / "mozilla.cfg"

# Prefs whose value the engine parses as JSON. Verified by reading the engine's
# own source; the comments in ziy.js cite the file and the reason.
JSON_PREFS = {
    "privacy.fingerprintingProtection.granularOverrides",
    "privacy.baselineFingerprintingProtection.granularOverrides",
}

# Prefs that take the "+Target,-Target" RFP syntax. Syntax check is deliberately
# shallow: the full target list lives in RFPTargets.inc and changes between
# releases, so we check the grammar, not the vocabulary.
RFP_TARGET_PREFS = {
    "privacy.fingerprintingProtection.overrides",
    "privacy.baselineFingerprintingProtection.overrides",
}

CALL_RE = re.compile(r"^(pref\|defaultPref\|lockPref)\(\s*\"([^\"]+)\"\s*,\s*(.*)\)\s*;?\s*$")


def parse_calls(path: Path) -> list[tuple[str, str, str]]:
    """Collect (where, fn(pref), value) for every pref-bearing call.

    mozilla.cfg wraps long calls over two lines, so the file is first joined:
    a call is `^(pref|defaultPref|lockPref)( ... );` — everything up to the
    closing paren plus semicolon, newlines and all.
    """
    text = path.read_text(encoding="utf-8")
    # Re-join continuation lines: a statement does not end until ";".
    joined = re.sub(r"\n\s+", " ", text)
    out: list[tuple[str, str, str]] = []
    lineno = 1
    for match in re.finditer(
        r'\b(pref|defaultPref|lockPref)\(\s*"([^"]+)"\s*,\s*(.*?)\)\s*;', text, re.S
    ):
        # Count newlines before the match to keep the line number honest.
        lineno = text.count("\n", 0, match.start()) + 1
        fn, name, value = match.groups()
        # A wrapped value keeps its own newlines; collapse them for reporting.
        value = re.sub(r"\s+", " ", value.strip())
        out.append((f"{path.name}:{lineno}", f"{fn}({name})", value))
    return out


def unquote(value: str) -> str | None:
    """Return the string a JS call passes, unescaping \\" and \\\\."""
    if not (value.startswith('"') and value.endswith('"')):
        return None
    return value[1:-1].replace('\\"', '"').replace("\\\\", "\\")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    problems: list[str] = []
    notes: list[str] = []

    # --- 1. collect the layers ------------------------------------------------
    layers = {
        "ziy.js": parse_calls(ZIY_JS),
        "ziy-hardening.js": parse_calls(HARDENING_JS),
        "mozilla.cfg": parse_calls(MOZILLA_CFG),
    }
    for name, calls in layers.items():
        notes.append(f"{name}: {len(calls)} pref calls")
        if not calls:
            problems.append(f"{name} has no parsable pref() calls — did the format change?")

    # mozilla.cfg must hold lockPref calls or it is not a config.
    cfg_calls = layers["mozilla.cfg"]
    if cfg_calls and not any(c[1].startswith("lockPref(") for c in cfg_calls):
        problems.append("mozilla.cfg contains no lockPref() calls")

    # --- 2. JSON-valued prefs really are JSON ---------------------------------
    for layer, calls in layers.items():
        for where, key, value in calls:
            pref = key.split("(", 1)[1].rsplit(")", 1)[0]
            if pref not in JSON_PREFS:
                continue
            text = unquote(value)
            if text is None:
                problems.append(f"{where}: {pref} must be a quoted JSON array, got {value}")
                continue
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                problems.append(
                    f"{where}: {pref} is not valid JSON ({exc}); the engine's "
                    "FingerprintingWebCompatService does JSON.parse on this pref "
                    "and a throw here aborts autoconfig"
                )
                continue
            if not isinstance(parsed, list):
                problems.append(
                    f"{where}: {pref} parsed as {type(parsed).__name__}, must be a JSON array"
                )
                continue
            for i, entry in enumerate(parsed):
                if not isinstance(entry, dict) or "firstPartyDomain" not in entry:
                    problems.append(
                        f"{where}: {pref}[{i}] lacks the required "
                        "'firstPartyDomain' key (schema: firstPartyDomain, overrides)"
                    )
            notes.append(f"{where}: {pref} = JSON array with {len(parsed)} entries")

    # --- 3. RFP target strings have the documented grammar --------------------
    target_re = re.compile(r'^[+-][A-Za-z]+(,[+-][A-Za-z]+)*$')
    for layer, calls in layers.items():
        for where, key, value in calls:
            pref = key.split("(", 1)[1].rsplit(")", 1)[0]
            if pref not in RFP_TARGET_PREFS:
                continue
            text = unquote(value)
            if text is None:
                problems.append(f"{where}: {pref} must be a quoted target string, got {value}")
                continue
            if not target_re.match(text):
                problems.append(
                    f"{where}: {pref} value {text!r} is not the '+Target,-Target' "
                    "grammar; the engine's validator would reject it"
                )
            else:
                notes.append(f"{where}: {pref} = {text}")

    # --- 4. the hardening set must agree with the prefs files -----------------
    # Every pref locked in mozilla.cfg should also be declared in the prefs
    # files, so a value is never locked-with-out-a-default (which is how a
    # "user-changeable" flag ends up locked by accident).
    declared = {c[1].split("(", 1)[1].rsplit(")", 1)[0] for c in layers["ziy.js"]}
    declared |= {c[1].split("(", 1)[1].rsplit(")", 1)[0] for c in layers["ziy-hardening.js"]}
    locked = {c[1].split("(", 1)[1].rsplit(")", 1)[0]
              for c in cfg_calls if c[1].startswith("lockPref(")}
    undeclared = sorted(locked - declared)
    if undeclared:
        problems.append(
            "locked in mozilla.cfg but not declared in the prefs files (so the "
            "lock is the only definition; add them to ziy.js / ziy-hardening.js): "
            + ", ".join(undeclared)
        )

    # --- 5. a locked pref must not carry a DIFFERENT value elsewhere ----------
    # A lock wins, so a divergent default is a lie in the file and a trap for the
    # next reader. Same value is fine (that is the agreeing case).
    values: dict[str, dict[str, str]] = {}
    for layer, calls in layers.items():
        for where, key, value in calls:
            pref = key.split("(", 1)[1].rsplit(")", 1)[0]
            values.setdefault(pref, {})[layer] = value
    for pref, per_layer in sorted(values.items()):
        if pref in JSON_PREFS:
            # The per-layer content of a JSON array legitimately differs: the
            # prefs files start empty, the lock ships the global entry. Only the
            # parse was checked above, which is the part that can crash.
            continue
        distinct = {v for v in per_layer.values()}
        if len(distinct) > 1:
            detail = ", ".join(f"{k}={v}" for k, v in sorted(per_layer.items()))
            problems.append(
                f"{pref} has conflicting values across layers ({detail}); the "
                "mozilla.cfg lock wins, so make them agree"
            )

    # --- 6. autoconfig file permissions ---------------------------------------
    if MOZILLA_CFG.exists():
        mode = os.stat(MOZILLA_CFG).st_mode & 0o777
        if not (mode & 0o004):
            problems.append(
                f"{MOZILLA_CFG} is mode {oct(mode)}; autoconfig requires the file "
                "be world-readable"
            )
        notes.append(f"{MOZILLA_CFG} mode {oct(mode)}")

    # --- report ----------------------------------------------------------------
    if args.list:
        for n in notes:
            print(f"  {n}")
        print(f"  {len(locked)} locked prefs, {len(declared)} declared prefs")

    if problems:
        print("preflight-prefs.py: the pref layer is NOT self-consistent\n", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1

    print(f"preflight-prefs.py: OK — {len(locked)} locks, {len(declared)} declared, "
          f"layers agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
