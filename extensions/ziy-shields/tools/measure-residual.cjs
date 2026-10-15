/* Measures the webRequest residual path with and without the domain index. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = '/home/zen/Documents/brave but not chrome or firefox/extensions/ziy-shields';
globalThis.ziyShields = globalThis.ziyShields || {};
const load = (rel) => {
  new Function('globalThis', 'self', fs.readFileSync(path.join(ROOT, rel), 'utf8'))(globalThis, globalThis);
};
load('lib/filterlist/parser.js');
load('lib/engine/dnr-compile.js');
load('lib/engine/blocking.js');
load('lib/engine/residual-index.js');

const z = globalThis.ziyShields;
const parseList = z.parseList;
const compileTable = z.compileTable;
const abpMatches = z.abpMatches;

const net = [];
for (const f of ['easylist.txt', 'easyprivacy.txt', 'fanboy-cookiemonster.txt']) {
  const { rules } = parseList(fs.readFileSync(path.join(ROOT, 'lib', 'filterlist', 'snapshots', f), 'utf8'), f);
  for (const r of rules) if (r.kind === 'network') net.push(r);
}

const out = compileTable({ networkRules: net });
console.log('static tier:', out.tiers.static.length);
console.log('webRequest tail:', out.webRequest.length);

const idx = z.buildIndex(out.webRequest);
console.log('index shape:', JSON.stringify(z.describe(idx)));

// Probe URLs drawn from the rules' own domains, so the match rate is realistic.
const urls = [];
const domains = [...idx.byDomain.keys()].slice(0, 3000);
for (let i = 0; i < domains.length; i++) {
  const bucket = idx.byDomain.get(domains[i]);
  const rule = bucket[i % bucket.length];
  const base = rule.pattern.replace(/^\|\|/, '').replace(/\^.*$/, '');
  urls.push(`https://${base}/path${i}.gif?utm_source=x`);
}
console.log('probe URLs:', urls.length);

function run(label, matcher) {
  const t0 = process.hrtime.bigint();
  let hits = 0;
  let tested = 0;
  for (const u of urls) {
    const host = new URL(u).hostname;
    const candidates = matcher(u, host);
    tested += candidates.length;
    for (const r of candidates) {
      if (abpMatches(r.pattern, u)) { hits++; break; }
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label}: ${ms.toFixed(0)} ms for ${urls.length} requests ` +
    `= ${(ms / urls.length).toFixed(4)} ms/request; ` +
    `candidates ${tested} (${(tested / urls.length).toFixed(1)}/request); hits ${hits}`);
  return ms / urls.length;
}

// The indexed path.
const perRequestIndexed = run('INDEXED  ', (u, host) => z.candidates(idx, u, host));
// The naive path, on a small subset so it finishes: 200 requests of 86,698 rules.
const small = urls.slice(0, 200);
const t0 = process.hrtime.bigint();
for (const u of small) {
  for (const r of out.webRequest) { if (abpMatches(r.pattern, u)) break; }
}
const msSmall = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`LINEAR    : ${msSmall.toFixed(0)} ms for ${small.length} requests ` +
  `= ${(msSmall / small.length).toFixed(4)} ms/request; candidates 86698/request`);

console.log(`\nspeedup: ${((msSmall / small.length) / perRequestIndexed).toFixed(0)}x`);
console.log(`per-request cost on the index: ${(perRequestIndexed * 1000).toFixed(1)} microseconds`);
