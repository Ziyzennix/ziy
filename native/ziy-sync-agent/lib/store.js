/**
 * The native agent's SQLite store — the only place chain material lives.
 *
 * Schema: replica/schema.sql's native block (chain, records, chain_categories,
 * plus the devices table that makes "Remove this device" an operation on THIS
 * device's view of the chain rather than on the server's).
 *
 * node:sqlite is used because it is present in the installed Node 26 —
 * `node -e "require('node:sqlite')"` exits 0 (recorded in
 * replica/proofs-sync.md). No native compilation, no npm install, and
 * `DatabaseSync` is synchronous, which suits a single-request-at-a-time native
 * host exactly.
 *
 * WHAT IS STORED AND WHERE
 * ------------------------
 * - chain row: device_id (Ed25519 public key, base64url), device_name,
 *   device_type, chain_id (128-bit HKDF salt), created_at, last_sync_at.
 *   The seed is NOT in the chain row.
 * - `seed_secret`: the BIP-39 seed, encrypted with AES-256-GCM under a key held
 *   in seed.key (mode 0600, in the same private directory). It can live here
 *   because this directory is not readable by the browser: it is outside the
 *   profile, outside ~/.mozilla, and mode 0700.
 * - records row: category, record_id, updated_at, tombstone, nonce, payload
 *   (ciphertext), signer, sig. The payload is opaque to this process too — the
 *   agent decrypts on request, per record, and never keeps plaintext around.
 *
 * WHAT THE SERVER SEES: none of this file. It is local to the device.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
create table if not exists chain (
  id           integer primary key check (id = 1),
  device_id    text    not null,
  device_name  text    not null,
  device_type  text    not null check (device_type in ('desktop','mobile','tablet')),
  chain_id     text    not null,
  created_at   integer not null,
  last_sync_at integer
);
create table if not exists records (
  category   text    not null,
  record_id  text    not null,
  updated_at integer not null,
  tombstone  integer not null default 0 check (tombstone in (0,1)),
  nonce      text    not null,
  payload    blob    not null,
  signer     text    not null,
  sig        text    not null,
  primary key (category, record_id)
) without rowid;
create index if not exists records_cat_updated on records (category, updated_at);
create table if not exists chain_categories (
  category text primary key,
  send     integer not null default 1 check (send in (0,1)),
  receive  integer not null default 1 check (receive in (0,1))
);
insert or ignore into chain_categories (category) values
  ('bookmarks'),('passwords'),('autofill'),('history'),
  ('tabs'),('extensions'),('themes'),('apps');
create table if not exists devices (
  device_id   text primary key,
  device_name text not null,
  device_type text not null,
  last_seen   integer,
  is_self     integer not null default 0 check (is_self in (0,1))
);
-- The device's Ed25519 private key, PKCS#8, encrypted under the same key file
-- the seed uses (mode 0600, beside the DB, outside the profile). It lives here
-- so the keypair survives the browser relaunching this agent; lib/device-identity.js
-- records why PKCS#8 persistence is the supported round-trip and the
-- derive-from-seed alternative was rejected.
create table if not exists device_keys (
  id          integer primary key check (id = 1),
  device_id   text not null,
  nonce       text not null,                   -- base64, 12 bytes
  ciphertext  text not null                    -- base64 AES-256-GCM of PKCS#8
);
pragma user_version = 1;
`;

export class SyncAgentStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dataDir, "chain.sqlite"));
    this.db.exec(SCHEMA);
    this.keyFile = path.join(dataDir, "seed.key");
    this._seedKey = this._loadOrCreateSeedKey();
    this._seedSecret = this._loadSeedSecret();
  }

  // -- seed protection -------------------------------------------------------
  /**
   * A random 32-byte data-at-rest key. It sits NEXT to the database, not inside
   * it, so an accidental copy of chain.sqlite alone (a backup, a sync mistake,
   * a shared directory) carries no seed. The threat it covers is "the DB file
   * leaked without the key file"; it does not cover a hostile process already
   * running as this user — that is what the OS-level protection around the
   * profile and the app dir is for, and it is stated honestly in the proofs doc.
   */
  _loadOrCreateSeedKey() {
    if (fs.existsSync(this.keyFile)) {
      const existing = fs.readFileSync(this.keyFile);
      if (existing.length !== 32) throw new Error("seed.key is corrupt (expected 32 bytes)");
      fs.chmodSync(this.keyFile, 0o600);
      return new Uint8Array(existing);
    }
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    fs.writeFileSync(this.keyFile, key, { mode: 0o600 });
    fs.chmodSync(this.keyFile, 0o600);
    return key;
  }

  _loadSeedSecret() {
    const file = path.join(this.dataDir, "seed.enc");
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw;
  }

  async storeSeed(seedBytes) {
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    const key = await crypto.subtle.importKey("raw", this._seedKey, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        // The AAD must be identical in storeSeed and readSeed, or a seed written
        // by one launch cannot be read by the next — which is exactly the bug
        // this comment exists to prevent. A fresh process would see
        // OperationError and report the chain as unreadable, while the same
        // process (which still had the keys in memory) would work fine.
        { name: "AES-GCM", iv: nonce, additionalData: utf8Aad("ziy-seed/v1"), tagLength: 128 },
        key,
        seedBytes,
      ),
    );
    const body = {
      v: 1,
      alg: "AES-256-GCM",
      nonce: Buffer.from(nonce).toString("base64"),
      ct: Buffer.from(ciphertext).toString("base64"),
    };
    fs.writeFileSync(path.join(this.dataDir, "seed.enc"), JSON.stringify(body), {
      mode: 0o600,
    });
    this._seedSecret = body;
    return body;
  }

  /** Decrypt and return the seed, for the length of one operation. */
  async readSeed() {
    if (!this._seedSecret) return null;
    const key = await crypto.subtle.importKey("raw", this._seedKey, "AES-GCM", false, ["decrypt"]);
    const iv = Uint8Array.from(Buffer.from(this._seedSecret.nonce, "base64"));
    const ct = Uint8Array.from(Buffer.from(this._seedSecret.ct, "base64"));
    const seed = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: utf8Aad("ziy-seed/v1"), tagLength: 128 },
      key,
      ct,
    );
    return new Uint8Array(seed);
  }

  // -- chain -----------------------------------------------------------------
  hasChain() {
    return Boolean(this.db.prepare("select id from chain where id = 1").get());
  }

  getChain() {
    return this.db.prepare("select * from chain where id = 1").get() || null;
  }

  putChain({ deviceId, deviceName, deviceType, chainId, createdAt, isSelf = true }) {
    this.db
      .prepare(
        `insert into chain (id, device_id, device_name, device_type, chain_id, created_at, last_sync_at)
         values (1, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           device_id = excluded.device_id,
           device_name = excluded.device_name,
           device_type = excluded.device_type,
           chain_id = excluded.chain_id,
           created_at = excluded.created_at`,
      )
      .run(deviceId, deviceName, deviceType, chainId, createdAt, createdAt);
    this.db
      .prepare(
        `insert into devices (device_id, device_name, device_type, last_seen, is_self)
         values (?, ?, ?, ?, 1)
         on conflict(device_id) do update set
           device_name = excluded.device_name,
           device_type = excluded.device_type,
           last_seen = excluded.last_seen`,
      )
      .run(deviceId, deviceName, deviceType, createdAt);
  }

  touchSync(epochSeconds) {
    this.db.prepare("update chain set last_sync_at = ? where id = 1").run(epochSeconds);
  }

  // -- records ---------------------------------------------------------------
  /**
   * The local record view. Returns the schema.sql shape; the caller decides
   * whether to decrypt. node:sqlite hands blobs back as Uint8Array, which is
   * what the record layer's base64url decode expects.
   */
  getRecords(category = null) {
    if (category) {
      return this.db.prepare("select * from records where category = ? order by updated_at").all(category);
    }
    return this.db.prepare("select * from records order by category, updated_at").all();
  }

  /** Last-writer-wins upsert, with the documented tie-break. */
  putRecord({ category, record_id, updated_at, tombstone, nonce, payload, signer, sig }) {
    const existing = this.db
      .prepare("select * from records where category = ? and record_id = ?")
      .get(category, record_id);
    if (existing) {
      if (!lwwWins(existing, { updated_at, signer })) return { changed: false, existing };
    }
    this.db
      .prepare(
        `insert into records (category, record_id, updated_at, tombstone, nonce, payload, signer, sig)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(category, record_id) do update set
           updated_at = excluded.updated_at,
           tombstone  = excluded.tombstone,
           nonce      = excluded.nonce,
           payload    = excluded.payload,
           signer     = excluded.signer,
           sig        = excluded.sig`,
      )
      .run(
        category,
        record_id,
        updated_at,
        tombstone ? 1 : 0,
        nonce,
        payload instanceof Uint8Array ? payload : Uint8Array.from(Buffer.from(payload, "base64")),
        signer,
        sig,
      );
    return { changed: true, record: { category, record_id, updated_at, tombstone, nonce, payload, signer, sig } };
  }

  deleteRecord(category, recordId) {
    return this.db.prepare("delete from records where category = ? and record_id = ?").run(category, recordId)
      .changes > 0;
  }

  recordCount() {
    return this.db.prepare("select count(*) as n from records").get().n;
  }

  // -- categories ------------------------------------------------------------
  getCategoryToggles() {
    const rows = this.db.prepare("select * from chain_categories").all();
    const out = { send: [], receive: [] };
    for (const row of rows) {
      if (!row.send) out.send.push(row.category);
      if (!row.receive) out.receive.push(row.category);
    }
    return out;
  }

  setCategoryToggle(category, { send, receive }) {
    this.db
      .prepare(
        `insert into chain_categories (category, send, receive) values (?, ?, ?)
         on conflict(category) do update set
           send = coalesce(?, send),
           receive = coalesce(?, receive)`,
      )
      .run(category, send === undefined ? 1 : send ? 1 : 0, receive === undefined ? 1 : receive ? 1 : 0,
           send === undefined ? null : send ? 1 : 0, receive === undefined ? null : receive ? 1 : 0);
  }

  // -- devices ---------------------------------------------------------------
  listDevices() {
    return this.db.prepare("select * from devices order by is_self desc, device_name").all();
  }

  /**
   * Persist the device's Ed25519 private key (PKCS#8 base64url) encrypted under
   * the same data-at-rest key as the seed, with the same "key file next to the
   * DB" protection. The ciphertext is never handed out; readDeviceKey decrypts
   * it for the length of one call.
   */
  async putDeviceKey({ deviceId, privateKeyPkcs8 }) {
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    const key = await crypto.subtle.importKey("raw", this._seedKey, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: utf8Aad("ziy-device-key/v1"), tagLength: 128 },
        key,
        Buffer.from(privateKeyPkcs8, "utf8"),
      ),
    );
    this.db
      .prepare(
        `insert or replace into device_keys (id, device_id, nonce, ciphertext)
         values (1, ?, ?, ?)`,
      )
      .run(
        deviceId,
        Buffer.from(nonce).toString("base64"),
        Buffer.from(ciphertext).toString("base64"),
      );
  }

  /** @returns {{device_id: string, private_pkcs8: string} | null} */
  async readDeviceKey() {
    const row = this.db.prepare("select * from device_keys where id = 1").get();
    if (!row) return null;
    const key = await crypto.subtle.importKey("raw", this._seedKey, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(Buffer.from(row.nonce, "base64")),
        additionalData: utf8Aad("ziy-device-key/v1"),
        tagLength: 128,
      },
      key,
      Uint8Array.from(Buffer.from(row.ciphertext, "base64")),
    );
    return {
      device_id: row.device_id,
      private_pkcs8: Buffer.from(plaintext).toString("utf8"),
    };
  }

  removeDevice(deviceId) {
    return this.db.prepare("delete from devices where device_id = ?").run(deviceId).changes > 0;
  }

  // -- destruction -----------------------------------------------------------
  /** Wipe the chain's local state. The server's cache is wiped separately. */
  destroyChainData() {
    this.db.exec("delete from records; delete from chain; delete from chain_categories; delete from devices;");
    // Restore the default toggles so the next chain starts from a known state.
    this.db.exec(
      `insert or ignore into chain_categories (category) values
         ('bookmarks'),('passwords'),('autofill'),('history'),
         ('tabs'),('extensions'),('themes'),('apps');`,
    );
    for (const file of ["seed.enc", "seed.key"]) {
      const target = path.join(this.dataDir, file);
      if (fs.existsSync(target)) fs.rmSync(target);
    }
    this._seedSecret = null;
    this._seedKey = this._loadOrCreateSeedKey();
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * architecture.md §4.3's rule, applied to a local row against an incoming row:
 * larger updated_at wins; equal updated_at -> smaller signer (device_id)
 * lexicographically. Used both by the agent's SQLite upsert and by the
 * extension's in-memory view so the two can never disagree.
 */
export function lwwWins(existing, incoming) {
  if (incoming.updated_at !== existing.updated_at) {
    return incoming.updated_at > existing.updated_at;
  }
  return incoming.signer <= existing.signer;
}

function utf8Aad(text) {
  return new TextEncoder().encode(text);
}
