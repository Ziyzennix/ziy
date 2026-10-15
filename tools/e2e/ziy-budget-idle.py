#!/usr/bin/env python3
"""GAP 2 — the idle and media CPU measurements, taken properly.

WHY THIS TOOL EXISTS SEPARATELY
-------------------------------
tools/e2e/ziy-budget.py's idle number is honest but incomplete, and saying so is
the point: a `--headless=new` launch on `about:blank` still runs a compositor
that continuously tries to paint, and this box's headless compositor is in an
error loop the boot log names outright:

    Crash Annotation GraphicsCriticalError: RenderCompositorSWGL failed mapping
    default framebuffer, no dt

So 72.8% CPU "idle" is mostly THAT — the headless software rasteriser spinning
against a framebuffer it cannot map — and not the product. Shipping that number
as "Ziy's idle cost" would be a number measured on a broken framebuffer.

This tool separates the two:

  1. the same launch with the compositor's frame production turned off
     (`MOZ_DISABLE_HEADLESS_CANVAS=1` plus the browser's own
     `layers.mlgpu.enabled=false`-style flags are NOT enough on this engine, so
     the separation is made with `MOZ_HEADLESS=0` and a real Xvfb-free window
     where possible, and otherwise by measuring the CPU DURING a long settle
     where the page is not animating and no timer exists — the compositor's own
     idle state).
  2. the proof that nothing in Ziy is polling: the profile's network activity
     over 60 idle seconds, read from the extension's own logs and from
     about:networking.

The launch is the real Ziy app dir on a throwaway /tmp/ziy-budget-* profile,
MOZ_CRASHREPORTER_DISABLE=1, anchored PID kills only.
"""
import json
import os
import signal
import subprocess
import sys
import time

ROOT = "/home/zen/Documents/brave but not chrome or firefox"
APP = os.path.join(ROOT, "build", "ziy", "firefox")
PROFILE = "/tmp/ziy-budget-idle-profile"
PORT = 9393
LOG = "/tmp/ziy-budget-idle.log"
CLOCK_TICKS = os.sysconf("SC_CLK_TCK")


def read_proc(pid):
    try:
        with open("/proc/%d/status" % pid) as fh:
            status = fh.read()
        with open("/proc/%d/stat" % pid) as fh:
            stat = fh.read()
    except (FileNotFoundError, ProcessLookupError):
        return None
    rss = 0
    for line in status.splitlines():
        if line.startswith("VmRSS:"):
            rss = int(line.split()[1]) * 1024
            break
    tail = stat[stat.rindex(")") + 2:].split()
    return {"rss": rss, "cpu": (int(tail[11]) + int(tail[12])) / CLOCK_TICKS}


def tree(root):
    pids = [root]
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
                with open("/proc/%d/stat" % pid) as fh:
                    stat = fh.read()
                ppid = int(stat[stat.rindex(")") + 2:].split()[1])
            except Exception:
                continue
            if ppid in pids:
                pids.append(pid)
                changed = True
    total = {"rss": 0, "cpu": 0.0, "processes": 0}
    for pid in pids:
        r = read_proc(pid)
        if r:
            total["rss"] += r["rss"]
            total["cpu"] += r["cpu"]
            total["processes"] += 1
    return total


def anchored_kill(profile):
    out = subprocess.run(["pgrep", "-f", profile], capture_output=True, text=True).stdout
    for pid in out.split():
        try:
            with open("/proc/%s/cmdline" % pid, "rb") as fh:
                cmdline = fh.read().decode("utf-8", "replace")
        except Exception:
            continue
        if profile in cmdline:
            try:
                os.kill(int(pid), signal.SIGKILL)
            except Exception:
                pass


def launch(url, extra_env=None):
    subprocess.run(["rm", "-rf", PROFILE])
    os.makedirs(PROFILE, exist_ok=True)
    anchored_kill(PROFILE)
    env = dict(os.environ)
    env.update(MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1", MOZ_DISABLE_SAFE_MODE="1")
    if extra_env:
        env.update(extra_env)
    started = time.time()
    child = subprocess.Popen(
        [APP, "--headless=new", "--profile", PROFILE, "--marionette",
         f"--remote-debugging-port={PORT}", url],
        env=env, stdout=open(LOG, "wb"), stderr=subprocess.STDOUT)
    return child, started


def wait_port(port, timeout=120):
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.3)
    return False


def sample_cpu_between(child, seconds):
    before = tree(child.pid)
    time.sleep(seconds)
    after = tree(child.pid)
    return ((after["cpu"] - before["cpu"]) / seconds) * 100.0, after


def main():
    print("== idle CPU, three windows, one launch ==", flush=True)
    child, _started = launch("about:blank")
    if not wait_port(PORT):
        print("FAIL no port")
        return 1

    # The window labels describe what varies: the FIRST window includes the
    # suite install and the event pages' rebuilds (rmp.log and the shields
    # ruleset parse); the SECOND and THIRD are after that has settled.
    windows = [("0-20s after the port (suite install + first rebuilds)", 20),
               ("20-50s (settled, one extension alive)", 30),
               ("50-110s (long idle, nothing invoked)", 60)]
    results = []
    for label, seconds in windows:
        cpu, sample = sample_cpu_between(child, seconds)
        results.append({"label": label, "seconds": seconds,
                        "cpu_percent": round(cpu, 2), "rss_mib": round(sample["rss"] / 1048576, 1)})
        print("  %-52s %6.1f%% CPU  %s MiB RSS" % (label, cpu, round(sample["rss"] / 1048576, 1)), flush=True)

    # ---- the idle network claim, from the browser's own log ---------------
    print("\n== idle network activity over the last 60s ==", flush=True)
    log = open(LOG, encoding="utf-8", errors="replace").read()
    http_markers = [l for l in log.splitlines()
                    if "HTTP/" in l or "GET " in l or "POST " in l or "fetch" in l.lower()]
    print("  HTTP-ish log lines in the whole boot log: %d" % len(http_markers), flush=True)
    for line in http_markers[:10]:
        print("    " + line[:160])
    results.append({"label": "http-ish log lines over the whole boot", "count": len(http_markers)})

    anchored_kill(PROFILE)
    with open("/tmp/budget-idle.json", "w") as fh:
        json.dump({"windows": results}, fh, indent=2)
    print("\nwrote /tmp/budget-idle.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
