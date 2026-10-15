/**
 * The Ziy sync client protocol: a small state machine over HTTP against the
 * blind-storage server.
 *
 * Transport facts, from the server's own API (server/src/server.js):
 *
 *   POST /v1/chains                     {chain_id, device_pubkey}   -> {device_id, challenge}
 *   POST /v1/challenges                 {device_id, signature}      -> {token}
 *   GET  /v1/chains/:chainId/records    Bearer token, ?since=
 *   PUT  /v1/chains/:chainId/records    Bearer token, [records]
 *   DELETE /v1/chains/:chainId          Bearer token (leave the chain = cache wipe)
 *
 * Every response is JSON. Errors are {error: code, message: human}.
 *
 * THE SERVER'S BLINDNESS, stated once here so it is never re-litigated: it
 * stores opaque bytes keyed by random blob ids and it knows chain ids, blob
 * ids, sizes, timestamps and the public key of each device. It never receives
 * a key, a word, a mnemonic, or anything that would let it decrypt a payload,
 * and it cannot re-derive any of those from what it does hold. The transport
 * is HTTPS.
 */

import { CATEGORIES, ChainKeys } from "./keyderivation.js";
import {
  createRecord,
  readRecord,
  applyToView,
  categoryGate,
  canSend,
  canReceive,
  normalizeRecord,
  decodeStore,
  encodeStore,
} from "./record.js";
import { utf8 } from "./bip39.js";
import { sign } from "./keyderivation.js";

const API_VERSION = "v1";

/**
 * The `since` value a pull must ask from. The store filters pulls with a
 * STRICT `updated_at > since` over a whole-second watermark, so asking from
 * the cursor second itself loses every record stamped inside it — the e2e
 * caught exactly that (join and push in the same second; the record sat
 * behind B's cursor forever). Ask from one second earlier: that re-admits the
 * cursor second, and re-delivery is idempotent (`putRecord`/`applyToView`
 * report only real changes). The full account lives with the agent's pull,
 * `native/ziy-sync-agent/lib/ops-sync.js`; this helper exists so the agent's
 * pull and `SyncClient.pull` cannot drift apart.
 */
export function pullSince(lastSyncAt) {
  return Math.max(0, (lastSyncAt || 0) - 1);
}

export class ProtocolError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class SyncClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl       e.g. https://sync.example
   * @param {ChainKeys} opts.keys       derived from the chain code
   * @param {{publicKeyB64: string, privateKey: CryptoKey, deviceId: string, deviceName: string, deviceType: string}} opts.device
   * @param {object} [opts.categoryToggles] {send:[], receive:[]}
   * @param {typeof fetch} [opts.fetch]
   */
  constructor({ baseUrl, keys, device, categoryToggles = {}, fetch: fetchImpl } = {}) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.keys = keys;
    this.device = device;
    this.gate = categoryGate(CATEGORIES, categoryToggles);
    this._fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.token = null;
    this.lastSyncAt = 0;
  }

  async request(path, { method = "GET", body, auth = true } = {}) {
    const headers = { "content-type": "application/json" };
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ProtocolError("bad-response", `server did not answer JSON (HTTP ${response.status})`, response.status);
      }
    }
    if (!response.ok) {
      const code = (parsed && parsed.error) || `http-${response.status}`;
      throw new ProtocolError(code, (parsed && parsed.message) || response.statusText, response.status);
    }
    return parsed;
  }

  /**
   * Register this device with a chain and obtain a session token.
   * The challenge proves we hold the private key for the registered public key;
   * the public key never leaves the registration step and the token is opaque.
   */
  async connect() {
    const registered = await this.request(`/${API_VERSION}/chains`, {
      method: "POST",
      body: {
        chain_id: this.keys.chainId,
        device_pubkey: this.device.publicKeyB64,
        device_name: this.device.deviceName,
        device_type: this.device.deviceType,
      },
      auth: false,
    });
    // The server's registration response hands back the nonce under
    // `challenge`; we sign exactly those bytes and send the nonce back, so the
    // server can find the single-use row it created.
    const signature = await sign(this.device.privateKey, registered.challenge);
    const session = await this.request(`/${API_VERSION}/challenges`, {
      method: "POST",
      body: {
        device_id: registered.device_id,
        challenge: registered.challenge,
        signature,
      },
      auth: false,
    });
    this.token = session.token;
    this.lastSyncAt = session.last_sync_at || 0;
    return session;
  }

  /** Pull the server's delta for this chain and fold it into `store`. */
  async pull(store, { now = Math.floor(Date.now() / 1000) } = {}) {
    const delta = await this.request(
      `/${API_VERSION}/chains/${encodeURIComponent(this.keys.chainId)}/records?since=${pullSince(this.lastSyncAt)}`,
    );
    const results = { accepted: [], rejected: [] };
    for (const raw of delta.records || []) {
      const normalized = normalizeRecord(raw);
      if (normalized.error) {
        results.rejected.push({ raw, reason: normalized.error });
        continue;
      }
      const record = normalized.record;
      if (!canReceive(this.gate, record.category)) {
        results.rejected.push({ raw, reason: "category-receive-off" });
        continue;
      }
      const categoryKey = await this.keys.categoryKey(record.category);
      const read = await readRecord({ categoryKey, record, now });
      if (!read.ok) {
        results.rejected.push({ raw: record, reason: read.reason });
        continue;
      }
      const applied = applyToView(store, read.record);
      if (applied) results.accepted.push(read.record);
    }
    this.lastSyncAt = Math.max(this.lastSyncAt, delta.server_time || now);
    return results;
  }

  /**
   * Push a local record. Category gating is applied here, on the device, which
   * is the only place it can be enforced (architecture §4.4).
   */
  async push(store, category, recordId, { now = Math.floor(Date.now() / 1000) } = {}) {
    if (!canSend(this.gate, category)) {
      throw new ProtocolError("category-send-off", `the "${category}" category is switched off on this device`);
    }
    const tombstone = store[category]?.[recordId]?.tombstone ?? false;
    const payload = store[category]?.[recordId]?.value;
    const categoryKey = await this.keys.categoryKey(category);
    const publicKeyB64 = this.device.publicKeyB64;
    const record = await createRecord({
      categoryKey,
      privateKey: this.device.privateKey,
      publicKeyB64,
      category,
      recordId,
      updatedAt: now,
      payload,
      tombstone,
    });
    await this.request(
      `/${API_VERSION}/chains/${encodeURIComponent(this.keys.chainId)}/records`,
      { method: "PUT", body: [record] },
    );
    const local = applyToView(store, record);
    return { record, local };
  }

  /** Delete this device's view of a record (a tombstone on the wire). */
  async delete(store, category, recordId, { now = Math.floor(Date.now() / 1000) } = {}) {
    if (!canSend(this.gate, category)) {
      throw new ProtocolError("category-send-off", `the "${category}" category is switched off on this device`);
    }
    const categoryKey = await this.keys.categoryKey(category);
    const record = await createRecord({
      categoryKey,
      privateKey: this.device.privateKey,
      publicKeyB64: this.device.publicKeyB64,
      category,
      recordId,
      updatedAt: now,
      payload: null,
      tombstone: true,
    });
    await this.request(
      `/${API_VERSION}/chains/${encodeURIComponent(this.keys.chainId)}/records`,
      { method: "PUT", body: [record] },
    );
    const local = applyToView(store, record);
    return { record, local };
  }

  /**
   * Leave the chain: the server deletes the chain's blob cache. Every device's
   * local copy is untouched — this only stops the shared pool.
   */
  async leave() {
    const result = await this.request(
      `/${API_VERSION}/chains/${encodeURIComponent(this.keys.chainId)}`,
      { method: "DELETE" },
    );
    this.token = null;
    return result;
  }

  static encodeStore(store) {
    return encodeStore(store);
  }

  static decodeStore(text) {
    return decodeStore(text);
  }
}
