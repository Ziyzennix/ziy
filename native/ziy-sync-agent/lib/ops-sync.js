/**
 * Sync ops for the native agent: push, pull, and the combined sync.now.
 *
 * All HTTP goes through lib/http.js and all crypto through the shared libs in
 * lib/ziy-crypto.js — the same modules the extension runs, so there is exactly
 * one implementation of the record format in this product.
 */

import { nowSeconds } from "./ops-chain.js";
import { lwwWins } from "./store.js";
// The client protocol module is shared with the extension; it reaches it through
// the same bridge as the crypto libs so the installed agent never depends on a
// relative path outside its own directory (tools/install-ziy-sync-native.js
// rewrites the bridge to the repo's absolute path).
import { SyncClient } from "./ziy-crypto.js";
import { createRecord, readRecord, applyToView, canSend, canReceive, normalizeRecord, pullSince } from "./ziy-crypto.js";
import { httpRequest } from "./http.js";

/** Build a client bound to this agent's live session. */
function clientFor(agent, store) {
  if (!agent.chainKeys) {
    throw Object.assign(new Error("No chain session on this device yet."), { code: "no-session" });
  }
  if (!agent.identity) {
    throw Object.assign(new Error("The device keypair is not loaded."), { code: "no-identity" });
  }
  const baseUrl = agent.baseUrl || process.env.ZIY_SYNC_SERVER;
  if (!baseUrl) {
    throw Object.assign(new Error("No sync server configured."), { code: "no-server" });
  }
  return new SyncClient({
    baseUrl,
    keys: agent.chainKeys,
    device: {
      publicKeyB64: agent.deviceId,
      privateKey: agent.identity.privateKey,
      deviceId: agent.deviceId,
      deviceName: store.getChain().device_name,
      deviceType: store.getChain().device_type,
    },
    categoryToggles: store.getCategoryToggles(),
    fetch: (url, init) => httpRequest(url, init),
  });
}

/**
 * Push records the extension handed over for storage/sending.
 *
 * The extension sends {category, record_id, value} or {category, record_id,
 * tombstone:true}; the agent encrypts and signs here, so the plaintext never
 * crosses the native-messaging link in a form the browser has to keep.
 */
export async function handlePush(agent, store, payload) {
  const client = clientFor(agent, store);
  await client.connect();
  const records = Array.isArray(payload.records) ? payload.records : [payload.record].filter(Boolean);
  const now = payload.now || nowSeconds();
  const pushed = [];
  for (const item of records) {
    const category = item.category;
    const recordId = item.record_id;
    if (!category || !recordId) {
      throw Object.assign(new Error("Each pushed record needs a category and a record_id."), {
        code: "bad-record",
      });
    }
    if (!canSend(client.gate, category)) continue; // a switched-off category is not sent
    const tombstone = Boolean(item.tombstone);
    const record = await createRecord({
      categoryKey: await agent.chainKeys.categoryKey(category),
      privateKey: agent.identity.privateKey,
      publicKeyB64: agent.deviceId,
      category,
      recordId,
      updatedAt: now,
      payload: item.value ?? null,
      tombstone,
    });
    await client.request(
      `/v1/chains/${encodeURIComponent(agent.chainKeys.chainId)}/records`,
      { method: "PUT", body: [record] },
    );
    const local = store.putRecord({
      category,
      record_id: recordId,
      updated_at: now,
      tombstone,
      nonce: record.nonce,
      payload: Buffer.from(record.payload, "base64url").toString("base64"),
      signer: record.signer,
      sig: record.sig,
    });
    pushed.push({ category, record_id: recordId, changed: local.changed });
  }
  store.touchSync(nowSeconds());
  return { pushed, last_sync_at: store.getChain().last_sync_at };
}

/**
 * Pull the server delta since this device's last_sync_at and fold it in.
 * Records are decrypted one at a time; a single undecryptable record is
 * reported, not fatal (a category switched off mid-chain, or a device whose
 * rotating-word bucket is stale, produces exactly that).
 */
export async function handlePull(agent, store, payload) {
  const client = clientFor(agent, store);
  await client.connect();
  const storeView = {};
  const results = { accepted: [], rejected: [] };
  // The cursor is a whole-second watermark and the store filters it with a
  // STRICT `updated_at > since` (server.js getBlobs; pinned by
  // server/test/server.test.mjs "since= returns only newer records"). Asking
  // from the cursor second itself loses every record stamped inside that
  // second: the e2e proved it — B joined at second T (putChain seeds
  // last_sync_at = createdAt = T), A pushed a record stamped T, B asked
  // `?since=T`, the strict filter dropped it, and touchSync then advanced B
  // to `server_time = T+1`, leaving the record behind B's cursor forever with
  // no error anywhere. `pullSince` asks from one second earlier, which
  // re-admits the cursor second; re-delivery is idempotent (putRecord reports
  // only real changes). The remaining hole — a pusher whose clock is more
  // than a second behind another device's cursor — is the recorded clock-skew
  // limitation (replica/proofs-sync.md §7), curable only by server-stamped
  // versions. The boundary bug and two same-family gaps are recorded there.
  const delta = await client.request(
    `/v1/chains/${encodeURIComponent(agent.chainKeys.chainId)}/records?since=${pullSince(store.getChain().last_sync_at)}`,
  );
  const now = payload.now || nowSeconds();
  for (const raw of delta.records || []) {
    const normalized = normalizeRecord(raw);
    if (normalized.error) {
      results.rejected.push({ raw, reason: normalized.error });
      continue;
    }
    const record = normalized.record;
    if (!canReceive(client.gate, record.category)) {
      results.rejected.push({ record, reason: "category-receive-off" });
      continue;
    }
    const read = await readRecord({
      categoryKey: await agent.chainKeys.categoryKey(record.category),
      record,
      now,
    });
    if (!read.ok) {
      // A decrypt failure on a record this device signed itself means the
      // rotating-word bucket moved between writes: that is a real, named cause
      // and it must not be swallowed as "corrupt".
      results.rejected.push({
        record: { category: record.category, record_id: record.record_id },
        reason:
          read.reason === "decrypt-failed"
            ? "decrypt-failed (different rotating-word bucket or a chain key this device cannot derive)"
            : read.reason,
      });
      continue;
    }
    const local = store.putRecord({
      category: record.category,
      record_id: record.record_id,
      updated_at: record.updated_at,
      tombstone: record.tombstone,
      nonce: record.nonce,
      payload: Buffer.from(record.payload, "base64url").toString("base64"),
      signer: record.signer,
      sig: record.sig,
    });
    applyToView(storeView, record);
    if (local.changed) results.accepted.push({ category: record.category, record_id: record.record_id });
  }
  store.touchSync(Math.max(store.getChain().last_sync_at || 0, delta.server_time || nowSeconds()));
  return { pulled: results.accepted.length, accepted: results.accepted, rejected: results.rejected };
}

/** Push then pull: the one op the UI's "Sync now" calls. */
export async function handleSync(agent, store, payload) {
  const pushed = payload.records && payload.records.length ? await handlePush(agent, store, payload) : { pushed: [] };
  const pulled = await handlePull(agent, store, payload);
  return { pushed: pushed.pushed, pulled: pulled.pulled, rejected: pulled.rejected };
}
