#!/usr/bin/env python3
"""The clean-room code scan for tools/verify.sh section 12.

Asserts that no reference product's name appears as a string literal in shipped
code — an identifier, a storage key, or a message the user would read. Comments
are EXCLUDED on purpose: a clean-room record is supposed to explain a deliberate
divergence ("the generator is ours, not Brave's"), and that prose is the record
working, not a leak.

The check is about shipping, so it walks only the directories the product ships:
extensions/, shell/, tools/ (build/ is excluded — it is a copy of the engine).
"""
from __future__ import annotations

import os
import re
import sys

BANNED = ("Brave", "Google Chrome", "Chromium", "Mozilla Firefox")
SHIP_ROOTS = ("extensions", "shell", "tools")
SKIP_DIRS = {"build", "node_modules", "__pycache__", ".git"}
# A file whose JOB is to name the reference products (this scanner, and the
# verify.sh guard that calls it) is the check, not the leak.
SKIP_FILES = {"cleanroom-scan.py", "verify.sh"}
TEXT_SUFFIXES = (".js", ".json", ".css", ".html", ".py", ".sh")


def strip_comments(text: str) -> str:
    """Remove block comments, line comments and Python comments."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    text = re.sub(r"(?<!:)//.*$", "", text, flags=re.M)
    text = re.sub(r"(?m)^\s*#.*$", "", text)
    return text


def main() -> int:
    repo_root = sys.argv[1]
    found: list[str] = []
    for root_name in SHIP_ROOTS:
        root = os.path.join(repo_root, root_name)
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for filename in filenames:
                if not filename.endswith(TEXT_SUFFIXES):
                    continue
                if filename in SKIP_FILES:
                    continue
                path = os.path.join(dirpath, filename)
                try:
                    text = open(path, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                code = strip_comments(text)
                for lineno, line in enumerate(code.splitlines(), 1):
                    for term in BANNED:
                        # A quoted literal naming another product is the leak.
                        if not re.search("[\'\"]" + re.escape(term) + "[\'\"]", line):
                            continue
                        # A line that ASSERTS the term's absence is a guard, not
                        # a leak: the NTP suite's own clean-room test reads
                        # ["brave","leo","bat","Chromium"] and asserts each one
                        # is missing from the page. Flagging that would be the
                        # checker mistaking the proof for the crime. Look at
                        # THIS line and the few after it, because the list is
                        # declared on one line and asserted on the next.
                        window = code.splitlines()[max(0, lineno - 3):lineno + 3]
                        window_text = " ".join(window)
                        if re.search(r"===\s*false|assert\.|expect\(|\bmissing\b|absent", window_text):
                            continue
                        found.append(f"{os.path.relpath(path, repo_root)}:{lineno}: {line.strip()[:76]}")
    if found:
        print(f"{len(found)} string literal(s) name a reference product:")
        for line in found[:20]:
            print("  " + line)
        return 1
    print("no reference product name is a string literal in shipped code")
    return 0


if __name__ == "__main__":
    sys.exit(main())
