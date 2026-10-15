/**
 * T1b — the store's durability pragma.
 *
 * replica/native-expansion.md §6.4 measured the write path at 144.059 ms/blob
 * under the stock rollback journal + synchronous=FULL, and 0.13 ms/blob for the
 * identical inserts under journal_mode=WAL + synchronous=NORMAL. The first test
 * reads the pragmas back through the REAL store connection (never a bare
 * DatabaseSync), so a regression in `BlindStore`'s constructor is caught here;
 * the second exercises the write path and PRINTS the new ms/blob figure next to
 * the recorded baseline. The timing is deliberately NOT asserted on — it is a
 * number for a human to read, and asserting it would flake on a loaded box.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlindStore } from "../src/store.js";

function tempDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ziy-sync-test-${name}-`));
  return path.join(dir, "b.sqlite");
}

/* The measured baseline this test's number should be read against. */
const BASELINE_MS_PER_BLOB = 144.059;   // replica/native-expansion.md §6.4
const WRITE_PATH_BLOBS = 100;

/**
 * putBlob's own contract, without WebCrypto: putBlob is pure SQL, and the
 * signature/decryption path lives above it in server.js, so a synthetic record
 * measures exactly the thing this change targeted — the SQLite write cost.
 */
function syntheticRecord(chainId, i, updatedAt) {
  return {
    chain_id: chainId,
    record_id: `rec-${i}`,
    category: "bookmarks",
    updated_at: updatedAt,
    tombstone: false,
    nonce: Buffer.from(`nonce-${i}`).toString("base64url"),
    payload: Buffer.alloc(512, i % 251).toString("base64url"),
    signer: "deviceAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sig: Buffer.from(`sig-${i}`).toString("base64url"),
  };
}

test("the store's connection runs on journal_mode=WAL + synchronous=NORMAL", (t) => {
  const store = new BlindStore(tempDb("pragma"));
  t.after(() => store.close());

  const journal = store.db.prepare("pragma journal_mode").get();
  assert.equal(journal.journal_mode, "wal", "the write path must run on WAL");

  const sync = store.db.prepare("pragma synchronous").get();
  assert.equal(sync.synchronous, 1, "synchronous must be NORMAL (1)");

  // The durability trade-off is stated in store.js's constructor: WAL + NORMAL
  // can lose the last commits to an OS/power crash, never a committed
  // transaction to a process crash. If someone raises synchronous to FULL for
  // power-loss durability, this assertion is the deliberate tripwire — the
  // trade-off must be re-stated, not silently traded away.
});

test(`putBlob x${WRITE_PATH_BLOBS} records the write-path number`, (t) => {
  const store = new BlindStore(tempDb("writepath"));
  t.after(() => store.close());
  const chainId = "chain-t1b-writepath";

  const started = process.hrtime.bigint();
  for (let i = 0; i < WRITE_PATH_BLOBS; i++) {
    const result = store.putBlob(syntheticRecord(chainId, i, 1761000000 + i));
    assert.equal(result.changed, true);
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const rows = store.db.prepare("select count(*) as n from blobs where chain_id = ?").get(chainId).n;
  assert.equal(rows, WRITE_PATH_BLOBS, "every putBlob must have landed");

  const msPerBlob = elapsedMs / WRITE_PATH_BLOBS;
  t.diagnostic(
    `putBlob x${WRITE_PATH_BLOBS}: ${elapsedMs.toFixed(1)} ms = ${msPerBlob.toFixed(3)} ms/blob ` +
      `(recorded baseline, delete journal + synchronous=FULL: ${BASELINE_MS_PER_BLOB} ms/blob — ` +
      "replica/native-expansion.md §6.4)",
  );
  // NOT asserted: the ms/blob is environment-bound; it is printed for the
  // record next to the baseline, exactly as T1b specifies.
});
