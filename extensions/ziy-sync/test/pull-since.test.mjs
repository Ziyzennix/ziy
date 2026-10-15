/**
 * pullSince tests: the pull cursor's one-second backstep.
 *
 * The store filters pulls with a STRICT `updated_at > since` over a
 * whole-second watermark, so asking from the cursor second itself loses every
 * record stamped inside it — tools/e2e-ziy-sync.sh caught exactly that on
 * 2026-10-16 (join and push in the same second; the record sat behind B's
 * cursor forever). The backstep lives in one place so the agent's pull and
 * SyncClient.pull cannot drift (replica/proofs-sync.md §7).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { pullSince } from "../lib/client.js";

test("pullSince steps one second back, floored at zero", () => {
  assert.equal(pullSince(0), 0);
  assert.equal(pullSince(null), 0);
  assert.equal(pullSince(undefined), 0);
  assert.equal(pullSince(1), 0);
  assert.equal(pullSince(2), 1);
  assert.equal(pullSince(1792091343), 1792091342);
});
