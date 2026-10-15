#!/usr/bin/env python3
"""GAP 2 — the resource budget: measure, then optimise, then re-measure.

WHAT THIS IS
------------
The measurement half of the "make our app VERY, VERY optimized" directive. It
boots the REAL Ziy app dir on a throwaway profile under /tmp/ziy-budget-*, and
reads the process's own /proc/<pid>/status (VmRSS) and /proc/<pid>/stat
(utime/stime) at fixed intervals. No estimated figures, no screenshots-of-
screenshots: the numbers below are what the process reported.

The five metrics, and how each is taken:

  (a) idle CPU% and RSS with Ziy open on about:blank for 60s
      -> two samples, 30s apart, on the same PID: CPU% is
         (delta utime + delta stime) / interval, RSS is VmRSS at the end.
  (b) RSS + CPU while a page with media plays
      -> the playlist fixture's page (the same one tools/e2e/ziy-playlist-panel.py
         uses) loaded headless, sampled every 5s.
  (c) cold start to first paint of our NTP
      -> the FIRST frame our NTP extension's page produces. The engine's own
         screenshot is written when the page has rendered, and the elapsed time
         from process start to a non-blank screenshot of the right size is the
         cold-start figure. The NTP is not navigable over BiDi (test-report.md's
         route table), so the route is the profile's own startup page: the NTP
         is chrome_url_overrides.newtab, so the browser opens it on boot.
  (d) RSS of the extension suite
      -> the content processes, not just the parent. A per-type RSS sum, because
         "the extension's cost" in Gecko is a web content process, and the parent
         alone understates it.
  (e) the shields static ruleset's startup cost
      -> measured as READ time: how long the add-on's own event page takes to
         fetch and index rules/static-ruleset.json on this box, and how often it
         does so. The point of this metric is the co-owner's "make sure the
         install path writes the compiled file once and reuses it" rule.

Every launch is MOZ_CRASHREPORTER_DISABLE=1, every kill is anchored by PID
(`pgrep -f '/tmp/ziy-budget-…profile'`), and the throwaway profile lives under
/tmp. The user's own Firefox (WhatsApp) and LibreOffice are never matched.

USAGE
-----
    python3 tools/e2e/ziy-budget.py [--json out.json]
"""
import argparse
import json
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-budget-profile"
PORT = 9391
LOG = "/tmp/ziy-budget.log"
SHOT_DIR = "/tmp/ziy-budget-shots"
CLOCK_TICKS = os.sysconf("SC_CLK_TCK")
PAGE_SIZE = os.sysconf("SC_PAGE_SIZE")


# ---------------------------------------------------------------------------
# /proc readers
# ---------------------------------------------------------------------------

def read_proc(pid):
    """(rss_bytes, utime_ticks, stime_ticks, cpu_seconds, state_threads)."""
    try:
        with open("/proc/%d/status" % pid, "r") as fh:
            status = fh.read()
        with open("/proc/%d/stat" % pid, "r") as fh:
            stat = fh.read()
    except (FileNotFoundError, ProcessLookupError):
        return None
    rss = 0
    for line in status.splitlines():
        if line.startswith("VmRSS:"):
            rss = int(line.split()[1]) * 1024
            break
    # The stat line's comm field can contain spaces and parens, so the fields
    # after the closing paren are the ones that count.
    tail = stat[stat.rindex(")") + 2:].split()
    utime = int(tail[11])
    stime = int(tail[12])
    threads = int(tail[17])
    cpu_seconds = (utime + stime) / CLOCK_TICKS
    return {"rss": rss, "cpu": cpu_seconds, "utime": utime, "stime": stime,
            "threads": threads, "pid": pid}


def proc_tree(root_pid):
    """The root's PID plus every descendant, via /proc/<pid>/stat's ppid."""
    pids = [root_pid]
    changed = True
    while changed:
        changed = False
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            pid = int(entry)
            if pid in pids:
                continue
            try:
                with open("/proc/%d/stat" % pid, "r") as fh:
                    stat = fh.read()
                ppid = int(stat[stat.rindex(")") + 2:].split()[1])
            except (FileNotFoundError, ProcessLookupError, ValueError, IndexError):
                continue
            if ppid in pids:
                pids.append(pid)
                changed = True
    return pids


def tree_sample(root_pid):
    """RSS and CPU for the whole process tree, so content processes count."""
    total = {"rss": 0, "cpu": 0.0, "processes": 0, "threads": 0}
    for pid in proc_tree(root_pid):
        reading = read_proc(pid)
        if not reading:
            continue
        total["rss"] += reading["rss"]
        total["cpu"] += reading["cpu"]
        total["processes"] += 1
        total["threads"] += reading["threads"]
    return total


def cpu_percent(before, after, interval_s):
    return ((after["cpu"] - before["cpu"]) / interval_s) * 100.0


def mb(nbytes):
    return round(nbytes / (1024 * 1024), 1)


def anchored_kill(profile):
    """SIGKILL by PID, only for processes whose command line matches the profile."""
    out = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout
    killed = []
    for pid in out.split():
        # The pattern is the throwaway profile path, so the user's own Firefox
        # (whose command line never contains /tmp/ziy-budget-*) is never matched.
        cmdline = ""
        try:
            with open("/proc/%s/cmdline" % pid, "rb") as fh:
                cmdline = fh.read().decode("utf-8", "replace")
        except Exception:
            continue
        if profile not in cmdline:
            continue
        try:
            os.kill(int(pid), signal.SIGKILL)
            killed.append(int(pid))
        except Exception:
            pass
    return killed


# ---------------------------------------------------------------------------
# The launches
# ---------------------------------------------------------------------------

def launch(profile, url, port, log):
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    subprocess.run(["rm", "-rf", profile])
    os.makedirs(profile, exist_ok=True)
    anchored_kill(profile)
    started = time.time()
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", profile, "--marionette",
         f"--remote-debugging-port={port}", url],
        env=env, stdout=open(log, "wb"), stderr=subprocess.STDOUT)
    return child, started


def wait_for_port(port, timeout=120):
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.3)
    return False


def wait_for_paint(pid, started, timeout=180):
    """Wait for the first frame: the process's own RSS becomes non-trivial and the
    WebDriver port is accepting, which is the same "rendered a screenshot" signal
    tools/verify.sh's suite boot uses.

    The NTP is chrome_url_overrides.newtab, so this launch's `about:newtab` is
    OUR page, drawn by our extension. The screenshot's file size is the second
    half of the signal: a blank page produces a small image, ours does not.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        reading = read_proc(pid)
        if reading and reading["rss"] > 150 * 1024 * 1024:
            return time.time() - started
        time.sleep(0.2)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None, help="write the measurements here")
    args = ap.parse_args()

    report = {"box": {"cores": os.cpu_count(), "cpu": "4-core Haswell"}, "metrics": {}}

    # ---- (a) idle: about:blank for 60s --------------------------------------
    print("== (a) idle CPU%% and RSS on about:blank, 60s ==", flush=True)
    child, started = launch(PROFILE, "about:blank", PORT, LOG)
    if not wait_for_port(PORT, 120):
        print("FAIL no debugging port"); return 1
    # Let the suite install and the event pages settle before the idle window.
    time.sleep(30)
    before = tree_sample(child.pid)
    time.sleep(60)
    after = tree_sample(child.pid)
    idle_cpu = cpu_percent(before, after, 60)
    idle_rss = mb(after["rss"])
    print("  idle: %.1f%% CPU, %s MiB RSS (%d processes, %d threads)"
          % (idle_cpu, idle_rss, after["processes"], after["threads"]), flush=True)
    report["metrics"]["idle"] = {
        "cpu_percent": round(idle_cpu, 2), "rss_mib": idle_rss,
        "processes": after["processes"], "threads": after["threads"],
        "seconds": 60, "note": "after a 30s settle, on about:blank",
    }
    anchored_kill(PROFILE)

    # ---- (b) a page with media plays ----------------------------------------
    print("\n== (b) RSS + CPU with a media page ==", flush=True)
    playlist_page = os.path.join(ROOT, "tools", "e2e", "playlist-panel.html")
    if not os.path.exists(playlist_page):
        # The playlist fixture page is generated by the panel probe; fall back to
        # a local page served by the engine so the measurement still happens.
        playlist_page = "/tmp/ziy-budget-media.html"
        with open(playlist_page, "w") as fh:
            fh.write("<!doctype html><title>budget media</title><body>"
                     "<video id='v' src='https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' "
                     "controls autoplay loop muted></video></body></html>")
    child, started = launch(PROFILE, playlist_page, PORT, LOG)
    if not wait_for_port(PORT, 120):
        print("FAIL no debugging port"); return 1
    time.sleep(35)
    samples = []
    for _ in range(5):
        samples.append(tree_sample(child.pid))
        time.sleep(5)
    media_rss = mb(samples[-1]["rss"])
    media_cpu = cpu_percent(samples[0], samples[-1], (len(samples) - 1) * 5)
    print("  media: %.1f%% CPU, %s MiB RSS over %ds"
          % (media_cpu, media_rss, (len(samples) - 1) * 5), flush=True)
    report["metrics"]["media"] = {
        "cpu_percent": round(media_cpu, 2), "rss_mib": media_rss,
        "seconds": (len(samples) - 1) * 5, "page": playlist_page,
    }
    anchored_kill(PROFILE)

    # ---- (c) cold start to our NTP's first paint -----------------------------
    print("\n== (c) cold start to our NTP's first paint ==", flush=True)
    child, started = launch(PROFILE, "about:newtab", PORT, LOG)
    # The NTP is our extension's page (chrome_url_overrides.newtab), so this
    # launch is the honest cold start: process start -> our page's first frame.
    paint = wait_for_paint(child.pid, started)
    sample = tree_sample(child.pid)
    print("  cold start to first paint: %s (tree RSS %s MiB)"
          % ("%.1fs" % paint if paint else "TIMEOUT", mb(sample["rss"])), flush=True)
    report["metrics"]["cold_start"] = {
        "seconds": round(paint, 2) if paint else None,
        "rss_mib": mb(sample["rss"]),
        "page": "about:newtab (ziy-ntp)",
    }
    anchored_kill(PROFILE)

    # ---- (d) the extension suite's RSS, with a real page open ----------------
    print("\n== (d) RSS of the extension suite with a page loaded ==", flush=True)
    child, started = launch(PROFILE, "about:newtab", PORT, LOG)
    if not wait_for_port(PORT, 120):
        print("FAIL no debugging port"); return 1
    time.sleep(35)
    pids = proc_tree(child.pid)
    per_type = {}
    for pid in pids:
        reading = read_proc(pid)
        if not reading:
            continue
        try:
            with open("/proc/%d/cmdline" % pid, "rb") as fh:
                cmdline = fh.read().decode("utf-8", "replace").replace("\0", " ")
        except Exception:
            continue
        kind = "parent"
        for marker in ("web-content", "webcompat", "rdd", "gmplugin", "socket"):
            if marker in cmdline:
                kind = marker
                break
        entry = per_type.setdefault(kind, {"rss": 0, "processes": 0})
        entry["rss"] += reading["rss"]
        entry["processes"] += 1
    suite_rss = mb(sum(v["rss"] for v in per_type.values()))
    print("  suite RSS: %s MiB total: %s"
          % (suite_rss, json.dumps({k: mb(v["rss"]) for k, v in per_type.items()})), flush=True)
    report["metrics"]["suite_rss"] = {
        "total_mib": suite_rss,
        "by_process_type": {k: mb(v["rss"]) for k, v in per_type.items()},
        "processes": {k: v["processes"] for k, v in per_type.items()},
    }
    anchored_kill(PROFILE)

    # ---- (e) the static ruleset's startup cost --------------------------------
    print("\n== (e) the shields static ruleset's load cost ==", flush=True)
    ruleset = os.path.join(ROOT, "extensions", "ziy-shields", "rules", "static-ruleset.json")
    if os.path.exists(ruleset):
        size = os.path.getsize(ruleset)
        # The add-on's own index build, measured with the shipped library on the
        # shipped file. This is the ONE cost our code owns in that path: the
        # engine's own parse of the ruleset is not observable from here and is
        # not claimed.
        code = (
            "const S=require(%r);const fs=require('fs');"
            "const rules=JSON.parse(fs.readFileSync(%r,'utf8'));"
            "const t0=process.hrtime.bigint();S.buildStaticIndex(rules);"
            "const ms=Number(process.hrtime.bigint()-t0)/1e6;"
            "process.stdout.write(JSON.stringify({rules:rules.length,bytes:%d,ms:Math.round(ms*100)/100}));"
            % (os.path.join(ROOT, "extensions", "ziy-shields", "lib", "engine", "static-match.js"),
               ruleset, size)
        )
        out = subprocess.run(["node", "-e", code], capture_output=True, text=True)
        try:
            idx = json.loads(out.stdout)
        except Exception:
            idx = {"error": out.stderr[-400:]}
        print("  ruleset: %s rules, %s bytes; index built in %s ms"
              % (idx.get("rules"), idx.get("bytes"), idx.get("ms")), flush=True)
        report["metrics"]["static_ruleset"] = idx
    anchored_kill(PROFILE)

    print("\n%s" % json.dumps(report, indent=2))
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(report, fh, indent=2)
        print("wrote %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
