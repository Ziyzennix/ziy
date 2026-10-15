#!/usr/bin/env python3
"""Drive a native-messaging host over the REAL pipe.

Used by tools/e2e-ziy-sync.sh (and by any test that wants to check the agent
rather than a mock of it): spawn the agent, write one framed message on stdin,
read one framed reply on stdout, exit.

    python3 tools/e2e/agent-driver.py <agent.js> '<json request>' [reply.json]

Framing is MDN's, from https://developer.mozilla.org/en-US/docs/Mozilla/
Add-ons/WebExtensions/Native_messaging: "Each message is serialized using JSON,
UTF-8 encoded and is preceded with an unsigned 32-bit value containing the
message length in native byte order." On x86-64 native byte order is
little-endian, so the header is struct.pack("<I", len).
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
from pathlib import Path


def frame(payload: dict) -> bytes:
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(encoded)) + encoded


def unframe(stream) -> object:
    header = stream.read(4)
    if len(header) != 4:
        raise SystemExit("the agent closed its stream without replying")
    (length,) = struct.unpack("<I", header)
    body = stream.read(length)
    if len(body) != length:
        raise SystemExit("the agent sent a short message")
    return json.loads(body.decode("utf-8"))


def node_binary() -> str:
    """
    The node executable to run the agent with.

    Resolved explicitly rather than relied on through PATH, because the e2e
    proof sets HOME to a throwaway directory for the browser: that changes which
    shell rc files apply and, on a box with several Node versions, which `node`
    the PATH resolves to. An agent started by a Node that lacks node:sqlite
    fails with ERR_UNKNOWN_BUILTIN_MODULE and the caller just sees the stream
    close — which is exactly the confusing failure this guard removes.
    """
    from shutil import which

    candidate = os.environ.get("ZIY_SYNC_NODE")
    if candidate:
        return candidate
    # Prefer the caller's own interpreter when it is node's; fall back to PATH.
    here = os.path.realpath(sys.executable)
    if os.path.basename(here).startswith("node"):
        return here
    for name in ("node", "nodejs"):
        found = which(name)
        if found:
            return found
    raise SystemExit("no node executable found on PATH (set ZIY_SYNC_NODE)")


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write(
            "usage: agent-driver.py <agent.js> '<json request>' [reply.json]\n"
        )
        return 2

    agent = Path(sys.argv[1]).resolve()
    request = json.loads(sys.argv[2])
    reply_path = Path(sys.argv[3]) if len(sys.argv) > 3 else None

    # The browser passes two arguments: the manifest path and the extension id.
    # The agent only accepts the call when the extension id matches its
    # allowed_extensions, so we pass ours — this is the real handshake, not a
    # test bypass. ZIY_SYNC_AGENT_TEST=1 is not set here on purpose.
    manifest = Path(request.pop("__manifest__", "/tmp/ziy-sync-e2e-agent-manifest.json"))
    extension_id = request.pop("__extension_id__", "ziy-sync@ziy.app")

    process = subprocess.Popen(
        [node_binary(), str(agent), str(manifest), extension_id],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdin and process.stdout
    process.stdin.write(frame(request))
    process.stdin.flush()
    # Close stdin FIRST: that is the agent's signal that we are done writing.
    # Closing before the communicate() call also avoids Python raising
    # "flush of closed file" when the agent has already gone away.
    process.stdin.close()

    reply = unframe(process.stdout)

    # The host is a long-lived daemon: it answered one message and keeps its
    # event loop open, exactly like the browser would find it. We are a one-shot
    # caller (sendNativeMessage style), so we stop it the way the browser does —
    # SIGTERM then SIGKILL (MDN, "Closing the native app").
    #
    # communicate() is deliberately NOT used here. Its implementation flushes
    # the stdin pipe unconditionally, and stdin is already closed, so it raises
    # "ValueError: flush of closed file" on every one-shot native host. Read
    # stderr and wait() separately instead.
    process.terminate()
    stderr = ""
    try:
        if process.stderr:
            raw = process.stderr.read()
            stderr = raw.decode("utf-8", "replace") if raw else ""
    except Exception:
        stderr = ""
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    text = json.dumps(reply, indent=2)
    if reply_path:
        reply_path.write_text(text + "\n", encoding="utf-8")
    sys.stdout.write(text + "\n")
    if stderr.strip():
        sys.stderr.write(stderr)

    # Exit non-zero only when the agent reported a failure, so the caller's
    # shell can distinguish "answered no" from "never answered".
    if isinstance(reply, dict) and reply.get("ok") is False:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
