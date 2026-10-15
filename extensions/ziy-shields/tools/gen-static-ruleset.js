/*
 * Ziy shields — generate the static DNR ruleset shipped inside the xpi.
 *
 * Produces extensions/ziy-shields/rules/static-ruleset.json: the array of
 * declarative_net_request rules compiled from the bundled filter-list snapshots,
 * in the exact shape the manifest's rule_resources entry points at.
 *
 * Why this is a build-time artifact:
 *
 *   The static ruleset is the ONLY tier that scales to the EasyList table. The
 *   dynamic and session tiers are capped at 5000 rules each (MDN:
 *   "MAX_NUMBER_OF_DYNAMIC_RULES ... in Firefox: 5000"), which is the right size
 *   for per-site overrides — a couple of rules per site a user has actually
 *   changed — and wrong by two orders of magnitude for a 135k-rule table.
 *   Static rulesets have their own budget (GUARANTEED_MINIMUM_STATIC_RULES =
 *   30000 per extension, from ExtensionDNRLimits.sys.mjs) and are read from the
 *   package by the engine itself, so no event-page work happens per request.
 *
 * The file is regenerated whenever a snapshot changes:
 *
 *     node extensions/ziy-shields/tools/gen-static-ruleset.js
 *
 * It is deterministic (sorted rule ids, stable key order), so the xpi is
 * reproducible and a checksum can be compared across builds.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const parser = require('../lib/filterlist/parser.js');
const D = require('../lib/engine/dnr-compile.js');

const HERE = __dirname;
const SNAPSHOTS = path.join(HERE, '..', 'lib', 'filterlist', 'snapshots');
const OUT = path.join(HERE, '..', 'rules', 'static-ruleset.json');

/* The list order matters: it fixes the rule ids, and the ids fix the output.
 * It mirrors DEFAULT_SOURCES in lib/filterlist/lists.js: same ids, same order,
 * with the snapshot filename derived from the id. Adding a list means adding it
 * to both files (lists.js for the registry, here for the shipped ruleset) and
 * dropping a snapshot into lib/filterlist/snapshots/. */
const SNAPSHOT_FOR_ID = {
  easylist: 'easylist.txt',
  easyprivacy: 'easyprivacy.txt',
  'easylist-cookie': 'fanboy-cookiemonster.txt',
  'uabo-filters': 'uabo-filters.txt',
  urlhaus: 'urlhaus.txt',
  'antiadblock-warning-removal': 'antiadblock-warning-removal.txt',
  'brave-unbreak': 'brave-unbreak.txt',
};
const LISTS = Object.values(SNAPSHOT_FOR_ID);

function main() {
  const network = [];
  for (const file of LISTS) {
    const text = fs.readFileSync(path.join(SNAPSHOTS, file), 'utf8');
    const { rules, stats } = parser.parseList(text, file.replace(/\.txt$/, ''));
    let kept = 0;
    for (const rule of rules) {
      if (rule.kind !== 'network') continue;
      network.push(rule);
      kept++;
    }
    process.stderr.write(`  ${file}: ${kept} network rules ` +
      `(${stats.cosmetic} cosmetic, ${stats.exceptions} exceptions, ${stats.invalid} skipped)\n`);
  }

  const { tiers, webRequest, stats } = D.compileTable({ networkRules: network });

  // Deterministic ordering: sort by id so the file is byte-stable across runs.
  const rules = tiers.static.slice().sort((a, b) => a.id - b.id);

  const json = JSON.stringify(rules);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);

  const bytes = Buffer.byteLength(json);
  const gz = zlib.gzipSync(Buffer.from(json));
  const counts = {
    block: 0, allow: 0, upgradeScheme: 0, other: 0,
    regex: 0, resourceTypes: 0, domainScoped: 0,
  };
  for (const rule of rules) {
    if (rule.action.type === 'block') counts.block++;
    else if (rule.action.type === 'allow') counts.allow++;
    else if (rule.action.type === 'upgradeScheme') counts.upgradeScheme++;
    else counts.other++;
    if (rule.condition.regexFilter) counts.regex++;
    if (rule.condition.resourceTypes) counts.resourceTypes++;
    if (rule.condition.initiatorDomains || rule.condition.excludedInitiatorDomains) counts.domainScoped++;
  }

  // The manifest's rule_resources entry must point at this exact path.
  // manifest.json carries a long explanatory comment block; JSON.parse cannot take
  // it, so strip '/*' and '//' comments (no string in this manifest contains a
  // comment marker, and the only URLs it holds are in permission strings).
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HERE, '..', 'manifest.json'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1'),
  );
  // The manifest path is relative to the extension root, without a leading slash
  // ("rules/static-ruleset.json"); the generator writes to ../rules/ from tools/.
  const entries = (manifest.declarative_net_request || {}).rule_resources || [];
  const REL = path.relative(path.join(HERE, '..'), OUT).split(path.sep).join('/');
  const match = entries.find(e => path.normalize(e.path) === path.normalize(REL));
  if (!match) {
    process.stderr.write('FAIL: manifest.json declarative_net_request.rule_resources has no entry for /rules/static-ruleset.json\n');
    process.exit(1);
  }

  process.stderr.write(`\nwrote ${OUT}\n`);
  process.stderr.write(`  rules            ${rules.length}\n`);
  process.stderr.write(`  bytes            ${bytes} (${(bytes / 1048576).toFixed(2)} MiB)\n`);
  process.stderr.write(`  gzip             ${gz.length} (${(gz.length / 1048576).toFixed(2)} MiB)\n`);
  process.stderr.write(`  sha256           ${crypto.createHash('sha256').update(Buffer.from(json)).digest('hex')}\n`);
  process.stderr.write(`  actions          block ${counts.block}, allow ${counts.allow}, upgradeScheme ${counts.upgradeScheme}\n`);
  process.stderr.write(`  conditions       ${counts.resourceTypes} with resourceTypes, ${counts.regex} regex, ${counts.domainScoped} domain-scoped\n`);
  process.stderr.write(`  webRequest tail  ${webRequest.length} rules (DNR cannot express these)\n`);
  process.stderr.write(`  budget          MAX_DYNAMIC_RULES ${D.DNR_LIMITS.MAX_DYNAMIC_RULES} / ` +
    `GUARANTEED_MINIMUM_STATIC_RULES ${D.DNR_LIMITS.GUARANTEED_MINIMUM_STATIC_RULES}\n`);
  process.stderr.write(`  manifest entry   ${match.id} -> ${match.path} (enabled: ${match.enabled})\n`);
}

main();
