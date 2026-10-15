#!/usr/bin/env node
/**
 * Build extensions/ziy-sync into a deterministic .xpi and install it into the
 * app dir's distribution/extensions/ so the built Ziy picks it up.
 *
 *   node tools/build-ziy-sync.js            build + install
 *   node tools/build-ziy-sync.js --stdout   print the output path only
 *
 * WHY A PYTHON ZIP? Because the app-dir installer derives the add-on id from
 * the FILENAME (XPIProvider.sys.mjs's getExpectedID()), and because a
 * deterministic zip is a build artefact you can verify: the same tree produces
 * the same bytes, so `sha256sum` of the xpi is a stable release identifier.
 * Node has no bundled zip writer; Python's zipfile is in the stdlib.
 *
 * The manifest's id comes from the same place the filename does — the
 * constants below — so the two can never disagree.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const EXTENSION_ID = "ziy-sync@ziy.app";
const EXTENSION_DIR = path.join(ROOT, "extensions", "ziy-sync");
const DIST_DIR = path.join(ROOT, "build", "ziy", "distribution", "extensions");

/** Files that belong in the package. Nothing else is shipped. */
const ALLOWED = new Set([
  "manifest.json",
  "options/options.html",
  "options/options.css",
  "options/options.js",
  "background/background.js",
  "lib/bip39.js",
  "lib/bip39-wordlist.js",
  "lib/keyderivation.js",
  "lib/record.js",
  "lib/client.js",
  "icons/ziy-sync-16.png",
  "icons/ziy-sync-32.png",
  "icons/ziy-sync-48.png",
  "icons/ziy-sync-96.png",
]);

/** Tests are run with `node --test`, never installed into a browser. */
const TEST_ONLY = /^test\//;

function build() {
  const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const declared = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko.id;
  if (declared !== EXTENSION_ID) {
    throw new Error(`manifest declares id "${declared}" but the build expects "${EXTENSION_ID}"`);
  }

  const present = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (ALLOWED.has(rel)) {
        present.push(rel);
      } else if (entry.name.startsWith(".")) {
        continue;                       // editor droppings, .DS_Store, .keep
      } else if (TEST_ONLY.test(rel)) {
        continue;                       // tests are run by node, never shipped
      } else {
        // Anything else IS an error: a file the build does not know about is
        // either a leftover that should be deleted or one that belongs in
        // ALLOWED. Silently dropping files is how a manifest reference ends up
        // pointing at nothing.
        present.push(`__EXTRA__${rel}`);
      }
    }
  };
  walk(EXTENSION_DIR, "");
  const extras = present.filter((p) => p.startsWith("__EXTRA__")).map((p) => p.slice("__EXTRA__".length));
  if (extras.length) {
    throw new Error(`these files are in the extension dir but not in the package list: ${extras.join(", ")}`);
  }
  present.sort();

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const outPath = path.join(DIST_DIR, `${EXTENSION_ID}.xpi`);
  if (fs.existsSync(outPath)) fs.rmSync(outPath);

  // A deterministic archive: one fixed timestamp, deflate, no directory entries.
  const script = `
import json, sys, zipfile
from pathlib import Path

src = Path(${JSON.stringify(EXTENSION_DIR)})
out = Path(${JSON.stringify(outPath)})
files = ${JSON.stringify(present)}

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for rel in files:
        info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        zf.writestr(info, (src / rel).read_bytes())

print(out)
`;
  execFileSync("python3", ["-c", script], { stdio: ["ignore", "pipe", "inherit"] });
  return { outPath, files: present };
}

const stdoutOnly = process.argv.includes("--stdout");
const { outPath, files } = build();
if (stdoutOnly) {
  process.stdout.write(outPath + "\n");
} else {
  process.stdout.write(`ziy-sync: wrote ${outPath} (${files.length} files, deterministic, unsigned by design)\n`);
  process.stdout.write(`ziy-sync:   id ${EXTENSION_ID} (from the manifest and the filename, one source)\n`);
  for (const file of files) process.stdout.write(`ziy-sync:     ${file}\n`);
}
