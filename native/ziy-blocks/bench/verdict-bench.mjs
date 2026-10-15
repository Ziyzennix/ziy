#!/usr/bin/env node
/**
 * ziy-blocks — per-request benchmark, over the real pipe.
 *
 * WHY (replica/native-expansion.md §7.1, T1's gate): the decision this crate
 * implements rests on the numbers in §6.1/§6.4 — engine match 0.0032 ms
 * (block) / 0.0050 ms (clean) and a 0.062 ms/round-trip stdio bridge, against
 * the shipped JS tiers: 0.34–9.67 ms/request static (mean 1.10) and 0.147
 * ms/request indexed. This script re-measures the END-TO-END path on whatever
 * box it runs on: a real host process, the real pipe, sequential round-trips,
 * N requests per class.
 *
 * Print-only on purpose: a benchmark that fails a build on a loaded box is a
 * flake generator. The numbers it prints belong in
 * replica/proofs-native-blocks.md next to the plan's.
 *
 * Usage: node native/ziy-blocks/bench/verdict-bench.mjs [N]   (default 2000)
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_EXTENSION_ID,
  encodeMessage,
  NativeMessageReader,
} from "../lib/native-protocol.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRATE = path.resolve(HERE, "..");
const ROOT = path.resolve(CRATE, "..", "..");
const HOST = path.join(CRATE, "target", "release", "ziy-blocks");
const ENGINE = path.join(CRATE, "dist", "ziy-blocks-engine.dat");

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE)) {
  execFileSync("bash", [path.join(ROOT, "tools", "build-blocks-engine.sh")], {
    stdio: "inherit",
    timeout: 900_000,
  });
}

const N = Number.parseInt(process.argv[2] ?? "2000", 10);
const WARMUP = 200;

const BLOCK = {
  op: "verdict",
  url: "https://www.google-analytics.com/analytics.js",
  initiator: "https://news.example/",
  type: "script",
};
const CLEAN = {
  op: "verdict",
  url: "https://cdn.example.com/app.js",
  initiator: "https://news.example/",
  type: "script",
};

const child = spawn(HOST, [path.join(CRATE, "dist", "test-manifest.json"), ALLOWED_EXTENSION_ID], {
  env: { ...process.env, ZIY_BLOCKS_ENGINE: ENGINE },
  stdio: ["pipe", "pipe", "inherit"],
});
const reader = new NativeMessageReader(child.stdout);
const pending = [];
child.stdin.on("error", () => {});
reader.on("message", (reply) => {
  const waiter = pending.shift();
  if (waiter) waiter(reply);
});

function send(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the host did not answer within 30 s")),
      30_000,
    );
    pending.push((reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    child.stdin.write(encodeMessage(message));
  });
}

const started = performance.now();
for (let i = 0; i < WARMUP; i++) await send(i % 2 ? BLOCK : CLEAN);
const warmupMs = performance.now() - started;

const blockTimes = [];
const cleanTimes = [];
for (let i = 0; i < N; i++) {
  const message = i % 2 === 0 ? BLOCK : CLEAN;
  const t0 = performance.now();
  const reply = await send(message);
  const t1 = performance.now();
  if (!reply.ok) throw new Error(`host answered not-ok: ${JSON.stringify(reply)}`);
  (i % 2 === 0 ? blockTimes : cleanTimes).push(t1 - t0);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const blockMean = mean(blockTimes);
const cleanMean = mean(cleanTimes);
const engineBytes = fs.statSync(ENGINE).size;

console.log("ziy-blocks bench — real host over the real pipe, sequential round-trips");
console.log(`  engine:   ${engineBytes} bytes (${(engineBytes / 1048576).toFixed(2)} MiB)`);
console.log(`  warmup:   ${WARMUP} requests in ${warmupMs.toFixed(0)} ms`);
console.log(`  block:    ${blockTimes.length} requests, mean ${blockMean.toFixed(4)} ms/request`);
console.log(`  clean:    ${cleanTimes.length} requests, mean ${cleanMean.toFixed(4)} ms/request`);
console.log(`  combined: mean ${((blockMean + cleanMean) / 2).toFixed(4)} ms/request`);
console.log("");
console.log("  the plan's figures for context (native-expansion.md §6.1/§6.4, same box):");
console.log("    engine match 0.0032 ms block / 0.0050 ms clean; stdio bridge 0.062 ms/round-trip");
console.log("    shipped JS tiers: 0.34–9.67 ms/req static (mean 1.10), 0.147 ms/req indexed");

child.stdin.end();
child.kill("SIGTERM");
