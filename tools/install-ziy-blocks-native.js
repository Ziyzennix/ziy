#!/usr/bin/env node
/**
 * Write the native-messaging manifest for ziy-blocks and install the host.
 *
 *   node tools/install-ziy-blocks-native.js --dry-run    show what it would do
 *   node tools/install-ziy-blocks-native.js              build (if needed), install, probe
 *
 * WHERE THE MANIFEST GOES — identical to the sibling install script, and the
 * engine-derived reasoning there applies verbatim: on Linux the engine reads
 * `$HOME/.mozilla/native-messaging-hosts/<name>.json` first (the hard-coded
 * ".mozilla" is XREUserNativeManifests in nsXREDirProvider.cpp — a REGISTRATION
 * of an executable, like a .desktop file, not Ziy's data), then
 * `/usr/lib/mozilla/native-messaging-hosts/`. ZIY_NATIVE_MANIFEST_DIR overrides
 * the user location, which is how proofs install into throwaway homes.
 *
 * WHAT GETS INSTALLED
 *   ~/.ziy/native/ziy-blocks                the host binary (mode 0755)
 *   ~/.ziy/native/ziy-blocks-engine.dat     the serialized engine beside it —
 *                                           the host resolves it as
 *                                           <exe-dir>/ziy-blocks-engine.dat
 *   ~/.mozilla/native-messaging-hosts/ziy-blocks.json
 *
 * The binary + engine are 7.5 MiB+ together and are derived artifacts; if they
 * are missing this script runs tools/build-blocks-engine.sh first, so the
 * install is one command on a fresh tree.
 *
 * MDN requires `path` to be absolute on Linux and `allowed_extensions` to name
 * the add-on; the probe at the end boots the installed binary over the real
 * stdio protocol and asks `capabilities`, because a manifest pointing at a
 * broken binary is the failure the user is least able to diagnose.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const HOST_NAME = "ziy-blocks";
const EXTENSION_ID = "ziy-shields@ziy.app";
const BINARY = path.join(ROOT, "native", "ziy-blocks", "target", "release", "ziy-blocks");
const ENGINE = path.join(ROOT, "native", "ziy-blocks", "dist", "ziy-blocks-engine.dat");

/** The engine's lookup order, mirroring install-ziy-sync-native.js. */
function manifestDirs() {
  const userLocation = process.env.ZIY_NATIVE_MANIFEST_DIR
    ? path.join(process.env.ZIY_NATIVE_MANIFEST_DIR, "native-messaging-hosts")
    : path.join(os.homedir(), ".mozilla", "native-messaging-hosts");
  return {
    user: userLocation,
    system: "/usr/lib/mozilla/native-messaging-hosts",
  };
}

/** The install prefix for the host, kept in Ziy's own tree (like the siblings). */
function installDir() {
  return process.env.ZIY_BLOCKS_DIR || path.join(os.homedir(), ".ziy", "native");
}

function ensureArtifacts() {
  if (fs.existsSync(BINARY) && fs.existsSync(ENGINE)) return;
  process.stdout.write("ziy-blocks-native: artifacts missing, building (tools/build-blocks-engine.sh)\n");
  execFileSync("bash", [path.join(HERE, "build-blocks-engine.sh")], { stdio: "inherit", timeout: 900000 });
}

function installHost() {
  const dir = installDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "ziy-blocks");
  fs.copyFileSync(BINARY, target);
  fs.chmodSync(target, 0o755);
  fs.copyFileSync(ENGINE, path.join(dir, "ziy-blocks-engine.dat"));
  return target;
}

function writeManifest(hostPath) {
  const manifest = {
    name: HOST_NAME,
    description:
      "Ziy's blocking engine host: adblock-rust over the 7 shipped filter-list " +
      "snapshots. It answers verdicts; the extension still issues every block.",
    type: "stdio",
    path: hostPath,
    allowed_extensions: [EXTENSION_ID],
  };

  const dirs = manifestDirs();
  const dryRun = process.argv.includes("--dry-run");
  const target = path.join(dirs.user, `${HOST_NAME}.json`);

  if (dryRun) {
    process.stdout.write(`would build (if needed), then install the host at ${path.join(installDir(), "ziy-blocks")}\n`);
    process.stdout.write(`would install the engine at ${path.join(installDir(), "ziy-blocks-engine.dat")}\n`);
    process.stdout.write(`would write ${target}\n`);
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    return { manifest, target, written: false };
  }

  ensureArtifacts();
  const installed = installHost();
  manifest.path = installed;

  fs.mkdirSync(dirs.user, { recursive: true, mode: 0o755 });
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
  process.stdout.write(`ziy-blocks-native: wrote ${target}\n`);
  process.stdout.write(`ziy-blocks-native: installed the host at ${installed} (mode 0755)\n`);
  process.stdout.write(`ziy-blocks-native: engine at ${path.join(installDir(), "ziy-blocks-engine.dat")}\n`);
  process.stdout.write(`ziy-blocks-native: lookup order the engine uses:\n`);
  process.stdout.write(`  1. ${path.join(dirs.user, `${HOST_NAME}.json`)}   <- written\n`);
  process.stdout.write(`  2. ${path.join(dirs.system, `${HOST_NAME}.json`)} (absent, and root-owned)\n`);
  return { manifest, target, written: true };
}

const result = writeManifest(path.join(installDir(), "ziy-blocks"));

// Verify the installed host actually starts and speaks the protocol — the same
// check (and the same reasoning) as install-ziy-sync-native.js's probe.
if (result.written && !process.argv.includes("--no-verify")) {
  try {
    const probe = JSON.stringify({ op: "capabilities" });
    const framed = Buffer.alloc(4 + Buffer.byteLength(probe));
    framed.writeUInt32LE(Buffer.byteLength(probe), 0);
    framed.write(probe, 4, "utf8");
    // A binary host is launched with exactly [manifest, extension-id].
    const reply = execFileSync(result.manifest.path, [result.target, EXTENSION_ID], {
      input: framed,
      timeout: 20000,
    });
    const length = reply.readUInt32LE(0);
    const parsed = JSON.parse(reply.subarray(4, 4 + length).toString("utf8"));
    if (!parsed.ok) throw new Error(parsed.message || "capabilities returned not-ok");
    if (!parsed.result.engine) {
      process.stdout.write("ziy-blocks-native: WARNING the host has no engine loaded — verdicts will refuse\n");
    } else {
      process.stdout.write(
        `ziy-blocks-native: host verified — ${parsed.result.service} ${parsed.result.version}, ` +
        `engine ${parsed.result.engine.bytes} bytes loaded in ${parsed.result.engine.load_ms} ms\n`,
      );
    }
  } catch (error) {
    process.stdout.write(`ziy-blocks-native: WARNING the host did not answer the probe: ${error.message}\n`);
    process.stdout.write("ziy-blocks-native: the manifest is written; fix the host before launching Ziy.\n");
  }
}
