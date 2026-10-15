#!/usr/bin/env node
/**
 * Write the native-messaging manifest for ziy-sync-agent into the location the
 * engine actually looks in, and install the agent itself.
 *
 *   node tools/install-ziy-sync-native.js --dry-run    show what it would do
 *   node tools/install-ziy-sync-native.js              write it
 *
 * WHERE THE MANIFEST GOES — derived from the engine, not guessed
 * -------------------------------------------------------------
 * The lookup is in `modules/NativeManifests.sys.mjs` inside the installed
 * omni.ja (extracted and read on this box):
 *
 *   let dirs = [
 *     Services.dirsvc.get("XREUserNativeManifests", Ci.nsIFile).path,
 *     Services.dirsvc.get("XRESysNativeManifests", Ci.nsIFile).path
 *   ];
 *   this._lookup = (type, name, context) => this._tryPaths(type, name, dirs, context);
 *   ...
 *   let path = PathUtils.join(dir, TYPES[type], `${name}.json`);
 *
 * with `const TYPES = { stdio: DASHED ? "native-messaging-hosts" : "NativeMessagingHosts", ... }`
 * and `const DASHED = AppConstants.platform === "linux";`. So on Linux the two
 * candidate files are exactly:
 *
 *   $HOME/.mozilla/native-messaging-hosts/ziy-sync-agent.json
 *   /usr/lib/mozilla/native-messaging-hosts/ziy-sync-agent.json
 *
 * The first component is the hard-coded ".mozilla", which is confirmed in the
 * upstream source of nsXREDirProvider::GetFile:
 *
 *   } else if (!strcmp(aProperty, XRE_USER_NATIVE_MANIFESTS)) {
 *     rv = GetUserDataDirectoryHome(getter_AddRefs(file), aLocal=false, aForceLegacy=true);
 *     ...
 *     rv = file->AppendNative(".mozilla"_ns);
 *   } else if (!strcmp(aProperty, XRE_SYS_NATIVE_MANIFESTS)) {
 *     rv = ::GetSystemParentDirectory(getter_AddRefes(file));   // "/usr/lib/mozilla"
 *   }
 *
 * (https://raw.githubusercontent.com/mozilla-firefox/firefox/main/toolkit/xre/nsXREDirProvider.cpp)
 *
 * WHY ZIY DOES NOT USE ~/.mozilla FOR ITS OWN STATE
 * ------------------------------------------------
 * This file is a REGISTRATION OF AN EXECUTABLE, like a .desktop file or a
 * systemd unit. It is not Ziy's data. Ziy's data lives in ~/.ziy/ (the profile,
 * and the agent's SQLite). The engine omits no other option: there is no
 * per-profile native-messaging directory, no pref that adds one, and
 * XREUserNativeManifests is the documented per-user location (MDN, "Native
 * manifests": "For per-user visibility, store the manifest in
 * /home/<username>/.mozilla/native-messaging-hosts/<name>.json" on Linux).
 * So the manifest goes where the engine reads it, and Ziy's own state does not.
 *
 * MDN's requirement is that `path` is absolute on Linux and macOS, and that
 * `allowed_extensions` names our add-on id. The agent executable is installed
 * next to this tool's repo (native/ziy-sync-agent/ziy-sync-agent.js) and made
 * executable, and the manifest points at it with an absolute path.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const HOST_NAME = "ziy-sync-agent";
const EXTENSION_ID = "ziy-sync@ziy.app";
const AGENT_SOURCE = path.join(ROOT, "native", "ziy-sync-agent", "ziy-sync-agent.js");

/**
 * The two candidate locations, in the engine's lookup order.
 * `ZIY_NATIVE_MANIFEST_DIR` overrides the user location, which is how the e2e
 * proof installs into throwaway homes without touching the real one.
 */
function manifestDirs() {
  const userLocation = process.env.ZIY_NATIVE_MANIFEST_DIR
    ? path.join(process.env.ZIY_NATIVE_MANIFEST_DIR, "native-messaging-hosts")
    : path.join(os.homedir(), ".mozilla", "native-messaging-hosts");
  return {
    user: userLocation,
    system: "/usr/lib/mozilla/native-messaging-hosts",
  };
}

/** The install prefix for the agent binary itself, kept in Ziy's own tree. */
function agentInstallDir() {
  return process.env.ZIY_SYNC_AGENT_DIR || path.join(os.homedir(), ".ziy", "native");
}

function installAgent() {
  const dir = agentInstallDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "ziy-sync-agent.js");
  fs.copyFileSync(AGENT_SOURCE, target);
  fs.chmodSync(target, 0o755);

  // The lib/ directory travels with it: the agent imports its siblings. Its
  // crypto bridge points at extensions/ziy-sync/lib, which is a path relative
  // to the REPO, so after the copy it is rewritten to the absolute repo path —
  // otherwise the installed agent looks for the lib beside itself and fails.
  const libSource = path.join(ROOT, "native", "ziy-sync-agent", "lib");
  const libTarget = path.join(dir, "lib");
  if (fs.existsSync(libTarget)) fs.rmSync(libTarget, { recursive: true });
  fs.cpSync(libSource, libTarget, { recursive: true });

  const cryptoLib = path.join(ROOT, "extensions", "ziy-sync", "lib") + "/";
  const extensionRoot = ROOT + "/";
  for (const file of fs.readdirSync(libTarget)) {
    if (!file.endsWith(".js")) continue;
    const target = path.join(libTarget, file);
    const original = fs.readFileSync(target, "utf8");
    // The sources already quote the specifiers, so only the path inside the
    // quotes is replaced — never the quotes themselves. Two relative forms
    // appear in the tree (native/ziy-sync-agent/lib/ and server/lib/), and both
    // resolve to the same repo-relative extensions/ directory.
    const rewritten = original
      .replaceAll("../../../extensions/ziy-sync/lib/", cryptoLib)
      .replaceAll("../../extensions/ziy-sync/lib/", cryptoLib)
      .replaceAll("../../extensions/ziy-sync/lib/client.js", cryptoLib + "client.js")
      .replaceAll("../../extensions/", extensionRoot + "extensions/");
    if (rewritten !== original) fs.writeFileSync(target, rewritten);
  }

  // An installed agent must be an ordinary module for the runtime: without a
  // package.json near it, Node guesses, prints a warning, and in some versions
  // refuses outright. One file with {"type":"module"} settles it, and the
  // directory is ours.
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "ziy-sync-agent", type: "module", private: true }) + "\n");
  return target;
}

function writeManifest(agentPath) {
  const manifest = {
    name: HOST_NAME,
    description:
      "Ziy's sync agent: holds the chain's derived keys, encrypts and signs sync " +
      "records, and talks to the Ziy sync server. The browser never sees a key.",
    type: "stdio",
    path: agentPath,
    allowed_extensions: [EXTENSION_ID],
  };

  const dirs = manifestDirs();
  const dryRun = process.argv.includes("--dry-run");
  const target = path.join(dirs.user, `${HOST_NAME}.json`);

  if (dryRun) {
    process.stdout.write(`would write ${target}\n`);
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    process.stdout.write(`would install the agent at ${path.join(agentInstallDir(), "ziy-sync-agent.js")}\n`);
    return { manifest, target, written: false };
  }

  fs.mkdirSync(dirs.user, { recursive: true, mode: 0o755 });
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
  const installed = installAgent();
  process.stdout.write(`ziy-sync-native: wrote ${target}\n`);
  process.stdout.write(`ziy-sync-native: installed the agent at ${installed} (mode 0755)\n`);
  process.stdout.write(`ziy-sync-native: lookup order the engine uses:\n`);
  process.stdout.write(`  1. ${path.join(dirs.user, "ziy-sync-agent.json")}   <- written\n`);
  process.stdout.write(`  2. ${path.join(dirs.system, "ziy-sync-agent.json")} (absent, and root-owned)\n`);
  return { manifest, target, written: true };
}

const result = writeManifest(path.join(agentInstallDir(), "ziy-sync-agent.js"));

// Verify the agent actually starts and speaks the protocol. A manifest pointing
// at a broken binary is the most common native-messaging failure and the one
// the user is least able to diagnose, so it is checked here at install time.
if (result.written && !process.argv.includes("--no-verify")) {
  try {
    const probe = JSON.stringify({ op: "capabilities" });
    const framed = Buffer.alloc(4 + Buffer.byteLength(probe));
    framed.writeUInt32LE(Buffer.byteLength(probe), 0);
    framed.write(probe, 4, "utf8");
    const reply = execFileSync(result.manifest.path, [result.target, EXTENSION_ID], {
      input: framed,
      timeout: 20000,
    });
    const length = reply.readUInt32LE(0);
    const parsed = JSON.parse(reply.subarray(4, 4 + length).toString("utf8"));
    if (!parsed.ok) throw new Error(parsed.message || "capabilities returned not-ok");
    const ed25519 = (parsed.result.algorithms || []).find((a) => a.name === "Ed25519");
    process.stdout.write(
      `ziy-sync-native: agent verified — ${parsed.result.protocol}, Ed25519 ${ed25519 ? (ed25519.available ? "available" : "UNAVAILABLE") : "unknown"}\n`,
    );
  } catch (error) {
    process.stdout.write(`ziy-sync-native: WARNING the agent did not answer the probe: ${error.message}\n`);
    process.stdout.write(`ziy-sync-native: the manifest is written; fix the agent before launching Ziy.\n`);
  }
}
