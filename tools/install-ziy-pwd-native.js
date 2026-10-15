#!/usr/bin/env node
/**
 * Write the native-messaging manifest for ziy-pwd into the location the engine
 * actually looks in, and install the agent itself.
 *
 *   node tools/install-ziy-pwd-native.js --dry-run    show what it would do
 *   node tools/install-ziy-pwd-native.js              write it
 *
 * WHERE THE MANIFEST GOES — the same location ziy-sync-agent uses, for the same
 * reason. tools/install-ziy-sync-native.js derives it from the engine's own
 * lookup (modules/NativeManifests.sys.mjs inside omni.ja):
 *
 *   let dirs = [
 *     Services.dirsvc.get("XREUserNativeManifests", Ci.nsIFile).path,
 *     Services.dirsvc.get("XRESysNativeManifests", Ci.nsIFile).path
 *   ];
 *
 * with XRE_USER_NATIVE_MANIFESTS hard-coding ".mozilla" (confirmed in
 * nsXREDirProvider::GetFile's upstream source). So on Linux the two candidate
 * files are exactly:
 *
 *   $HOME/.mozilla/native-messaging-hosts/ziy-pwd.json
 *   /usr/lib/mozilla/native-messaging-hosts/ziy-pwd.json
 *
 * There is no per-profile directory, no pref that adds one, and no app-relative
 * path. The manifest is a REGISTRATION OF AN EXECUTABLE, like a .desktop file;
 * Ziy's own data (the vault's SQLite) lives under ~/.ziy/pwd/, outside the
 * profile and outside ~/.mozilla.
 *
 * WHAT THIS INSTALLER DIFFERS ON FROM THE SYNC ONE
 * ------------------------------------------------
 * - different host name, add-on id, agent path — and nothing else. The framing,
 *   the probe-at-install verification, the lib/ copy-and-rewrite step and the
 *   env overrides are identical, because two divergent installer shapes in one
 *   product are two things to audit instead of one.
 * - the probe op is `capabilities`, whose reply names the KDF. A vault whose
 *   helper answers is the difference between "the password panel works" and "the
 *   password panel says nothing", so it is verified at install time, exactly as
 *   the sync installer verifies its agent.
 * - the install is REFUSED if the agent cannot answer, rather than warned: the
 *   sync installer warns because a sync chain without the agent is sync-not-
 *   configured; a password panel whose helper is broken is a panel that appears
 *   to work and never saves anything, so this one fails the install loudly and
 *   leaves the manifest in place for the operator to inspect.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const HOST_NAME = "ziy-pwd";
const EXTENSION_ID = "ziy-pwd@ziy.app";
const AGENT_SOURCE = path.join(ROOT, "native", "ziy-pwd", "ziy-pwd.js");

/**
 * The two candidate locations, in the engine's lookup order.
 * `ZIY_NATIVE_MANIFEST_DIR` overrides the user location, which is how the boot
 * proof installs into a throwaway HOME without touching the real one.
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

/** The install prefix for the agent itself, kept in Ziy's own tree. */
function agentInstallDir() {
  return process.env.ZIY_PWD_AGENT_DIR || path.join(os.homedir(), ".ziy", "native");
}

/**
 * Copies the agent and its lib/ into Ziy's own install prefix, mode 0755, and
 * writes the package.json that makes it an ordinary ESM module for the runtime.
 * The sources quote relative specifiers that are resolved from the REPO, so
 * after the copy they are rewritten to the absolute repo path — otherwise the
 * installed agent looks for its lib beside itself and fails.
 */
function installAgent() {
  const dir = agentInstallDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, HOST_NAME + ".js");
  fs.copyFileSync(AGENT_SOURCE, target);
  fs.chmodSync(target, 0o755);

  const libSource = path.join(ROOT, "native", "ziy-pwd", "lib");
  const libTarget = path.join(dir, "lib");
  if (fs.existsSync(libTarget)) fs.rmSync(libTarget, { recursive: true });
  fs.cpSync(libSource, libTarget, { recursive: true });

  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "ziy-pwd", type: "module", private: true }) + "\n");
  return target;
}

function writeManifest(agentPath) {
  const manifest = {
    name: HOST_NAME,
    description: "Ziy's password helper: owns the encrypted credential vault. "
      + "The browser never sees a key, and the passphrase never leaves this process.",
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
    process.stdout.write(`would install the agent at ${path.join(agentInstallDir(), HOST_NAME + ".js")}\n`);
    return { manifest, target, written: false };
  }

  fs.mkdirSync(dirs.user, { recursive: true, mode: 0o755 });
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
  const installed = installAgent();
  process.stdout.write(`ziy-pwd-native: wrote ${target}\n`);
  process.stdout.write(`ziy-pwd-native: installed the agent at ${installed} (mode 0755)\n`);
  process.stdout.write(`ziy-pwd-native: lookup order the engine uses:\n`);
  process.stdout.write(`  1. ${path.join(dirs.user, HOST_NAME + ".json")}   <- written\n`);
  process.stdout.write(`  2. ${path.join(dirs.system, HOST_NAME + ".json")} (absent, and root-owned)\n`);
  return { manifest, target, written: true };
}

const result = writeManifest(path.join(agentInstallDir(), HOST_NAME + ".js"));

// Verify the agent answers an MDN-framed probe at install time. Unlike the sync
// installer (which warns), this one refuses: a password panel whose helper is
// broken appears to work and never saves anything.
if (result.written && !process.argv.includes("--no-verify")) {
  try {
    const probe = JSON.stringify({ op: "capabilities" });
    const framed = Buffer.alloc(4 + Buffer.byteLength(probe));
    framed.writeUInt32LE(Buffer.byteLength(probe), 0);
    framed.write(probe, 4, "utf8");
    // A throwaway data dir, so the probe never creates the real vault before the
    // user has chosen a passphrase.
    const reply = execFileSync(result.manifest.path, [result.target, EXTENSION_ID], {
      input: framed,
      timeout: 20000,
      env: { ...process.env, ZIY_PWD_DATA_DIR: path.join(agentInstallDir(), "probe-data") },
    });
    const length = reply.readUInt32LE(0);
    const parsed = JSON.parse(reply.subarray(4, 4 + length).toString("utf8"));
    if (!parsed.ok) throw new Error(parsed.message || "capabilities returned not-ok");
    process.stdout.write(
      `ziy-pwd-native: agent verified — ${parsed.result.protocol}, KDF ${parsed.result.kdf}\n`,
    );
  } catch (error) {
    process.stdout.write(`ziy-pwd-native: FAILED the agent did not answer the probe: ${error.message}\n`);
    process.stdout.write(`ziy-pwd-native: the manifest is written; fix the agent, then launch Ziy.\n`);
    process.exit(1);
  }
}
