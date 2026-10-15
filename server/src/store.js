#!/usr/bin/env node
/**
 * ziy-sync-server — the blind storage service for Ziy Sync chains.
 *
 * WHAT THIS SERVER IS
 * -------------------
 * A key-value store for opaque blobs. It holds one blob per (chain_id,
 * record_id), enforces that a write cannot move a blob backwards in time, and
 * deletes every blob for a chain when the chain's owner leaves or deletes the
 * account. That is the entire product surface.
 *
 * WHAT THE SERVER CAN SEE — and this is the whole privacy claim
 * -------------------------------------------------------------
 *   - chain_id (the storage bucket key; NOT secret, it is a random 128-bit value
 *     that is not derived from the word code)
 *   - record_id (a uuid; opaque)
 *   - updated_at (unix seconds)
 *   - tombstone (a boolean)
 *   - nonce and payload (base64 AES-256-GCM ciphertext; server holds no key)
 *   - signer (a 32-byte Ed25519 public key), and the signature over the
 *     identifying fields
 *   - the byte size of every blob
 *
 * WHAT THE SERVER CANNOT SEE
 * --------------------------
 *   - the record's contents, its category (the category name IS the bucket key,
 *     so it is visible — it is a routing label, not a secret, and the record's
 *     subject matter is inside the ciphertext)
 *   - any word of any chain code, any seed, any derived key
 *   - which device wrote which logical record beyond "a key signed it"
 *   - the passphrase (there is none: Ziy's chain code has no passphrase, so the
 *     BIP-39 salt is the literal "mnemonic")
 *
 * It cannot decrypt a payload, cannot forge a record (it has no private key),
 * and cannot re-derive a key from anything it holds.
 *
 * WHAT THIS SERVER DELIBERATELY DOES NOT DO
 * -----------------------------------------
 * - no accounts, no emails, no passwords, no recovery
 * - no stored IP log, no user agent log, no request bodies beyond the records
 *   themselves; the access log written by tools/serve.sh goes to stdout only if
 *   the operator asks for it, and it carries method+path+status, never a body
 * - no analytics, no telemetry, no third-party anything
 *
 * STORAGE DECISION (recorded in replica/proofs-sync.md)
 * ---------------------------------------------------
 * node:sqlite is present in the installed Node 26 — `node -e
 * "require('node:sqlite')"` exits 0 — so this server uses it. better-sqlite3 was
 * the alternative and it is NOT installable offline on this box (probed:
 * require('better-sqlite3') fails and there is no network access to npm), so
 * node:sqlite is the correct choice, not merely the available one: it is
 * bundled with the runtime, so the server ships with zero dependencies.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";

const API_VERSION = "v1";
const MAX_BODY_BYTES = 4 * 1024 * 1024;  // MDN native messaging caps a message at
                                          // 1 MB; 4 MB leaves room for a delta page
const MAX_RECORDS_PER_PUT = 500;
const CHALLENGE_TTL_SECONDS = 120;
const SESSION_TTL_SECONDS = 24 * 3600;
const DEFAULT_PAGE = 500;

const SCHEMA = `
create table if not exists chains (
  chain_id     text primary key,
  created_at   integer not null
);
create table if not exists devices (
  device_id    text primary key,           -- base64url Ed25519 public key
  chain_id     text not null,
  device_name  text,
  device_type  text not null default 'desktop',
  public_key   blob not null,              -- the SAME key, raw, for verification
  registered_at integer not null,
  last_seen    integer,
  removed      integer not null default 0,
  foreign key (chain_id) references chains(chain_id) on delete cascade
);
create index if not exists devices_chain on devices (chain_id);
create table if not exists blobs (
  chain_id    text not null,
  record_id   text not null,
  category    text not null,
  updated_at  integer not null,
  tombstone   integer not null default 0 check (tombstone in (0,1)),
  nonce       text not null,
  payload     blob not null,
  signer      text not null,               -- device_id, base64url
  sig         text not null,
  size_bytes  integer not null,
  primary key (chain_id, record_id)
) without rowid;
create index if not exists blobs_since on blobs (chain_id, updated_at);
create table if not exists challenges (
  nonce       text primary key,
  device_id   text not null,
  expires_at  integer not null
);
create table if not exists sessions (
  token       text primary key,
  device_id   text not null,
  chain_id    text not null,
  expires_at  integer not null
);
pragma user_version = 1;
`;

/* ------------------------------------------------------------------------- */
/* persistence                                                               */
/* ------------------------------------------------------------------------- */

export class BlindStore {
  constructor(dbFile = ":memory:") {
    this.db = new DatabaseSync(dbFile);
    this.db.exec(SCHEMA);
  }

  now() {
    return Math.floor(Date.now() / 1000);
  }

  // -- chains ---------------------------------------------------------------
  chainExists(chainId) {
    return Boolean(this.db.prepare("select chain_id from chains where chain_id = ?").get(chainId));
  }

  createChain(chainId) {
    this.db
      .prepare("insert or ignore into chains (chain_id, created_at) values (?, ?)")
      .run(chainId, this.now());
  }

  /** Delete every blob for a chain, and the chain. Used by leave/delete. */
  wipeChain(chainId) {
    const blobs = this.db.prepare("select count(*) as n from blobs where chain_id = ?").get(chainId).n;
    this.db.prepare("delete from blobs where chain_id = ?").run(chainId);
    this.db.prepare("delete from devices where chain_id = ?").run(chainId);
    this.db.prepare("delete from sessions where chain_id = ?").run(chainId);
    this.db.prepare("delete from chains where chain_id = ?").run(chainId);
    return { blobs_deleted: blobs };
  }

  // -- devices --------------------------------------------------------------
  deviceCount(chainId) {
    return this.db.prepare("select count(*) as n from devices where chain_id = ? and removed = 0").get(chainId).n;
  }

  registerDevice({ chainId, deviceId, publicKey, deviceName, deviceType }) {
    this.createChain(chainId);
    this.db
      .prepare(
        `insert into devices (device_id, chain_id, device_name, device_type, public_key, registered_at, last_seen, removed)
         values (?, ?, ?, ?, ?, ?, ?, 0)
         on conflict(device_id) do update set
           chain_id = excluded.chain_id,
           device_name = excluded.device_name,
           device_type = excluded.device_type,
           public_key = excluded.public_key,
           last_seen = excluded.last_seen,
           removed = 0`,
      )
      .run(
        deviceId,
        chainId,
        deviceName || null,
        deviceType || "desktop",
        new Uint8Array(publicKey),
        this.now(),
        this.now(),
      );
  }

  getDevice(deviceId) {
    return this.db.prepare("select * from devices where device_id = ?").get(deviceId) || null;
  }

  touchDevice(deviceId) {
    this.db.prepare("update devices set last_seen = ? where device_id = ?").run(this.now(), deviceId);
  }

  // -- challenges -----------------------------------------------------------
  createChallenge(deviceId, ttl = CHALLENGE_TTL_SECONDS) {
    const nonce = crypto.randomBytes(32).toString("base64url");
    this.db
      .prepare("insert into challenges (nonce, device_id, expires_at) values (?, ?, ?)")
      .run(nonce, deviceId, this.now() + ttl);
    // Opportunistic cleanup; challenges are single-use and short-lived.
    this.db.prepare("delete from challenges where expires_at < ?").run(this.now());
    return nonce;
  }

  consumeChallenge(nonce, deviceId) {
    const row = this.db.prepare("select * from challenges where nonce = ?").get(nonce);
    if (!row) return false;
    if (row.expires_at < this.now()) {
      this.db.prepare("delete from challenges where nonce = ?").run(nonce);
      return false;
    }
    if (row.device_id !== deviceId) return false;
    this.db.prepare("delete from challenges where nonce = ?").run(nonce);
    return true;
  }

  // -- sessions -------------------------------------------------------------
  createSession({ deviceId, chainId, ttl = SESSION_TTL_SECONDS }) {
    const token = crypto.randomBytes(32).toString("base64url");
    this.db
      .prepare("insert into sessions (token, device_id, chain_id, expires_at) values (?, ?, ?, ?)")
      .run(token, deviceId, chainId, this.now() + ttl);
    this.db.prepare("delete from sessions where expires_at < ?").run(this.now());
    return token;
  }

  sessionDevice(token) {
    const row = this.db.prepare("select * from sessions where token = ?").get(token);
    if (!row) return null;
    if (row.expires_at < this.now()) {
      this.db.prepare("delete from sessions where token = ?").run(token);
      return null;
    }
    if (!this.getDevice(row.device_id) || this.getDevice(row.device_id).removed) return null;
    this.touchDevice(row.device_id);
    return row;
  }

  // -- blobs ----------------------------------------------------------------
  /**
   * Monotonic last-write-wins on the encrypted record, exactly as architecture
   * §4.3 specifies. A clock skew changes ordering, never content: the payload is
   * already encrypted and signed by the writer, so the server can only decide
   * which of two blobs is newer, never what either one says.
   *
   * The tie-break matches the client's: equal updated_at -> the lexicographically
   * smaller signer wins, so the server and the devices agree without talking.
   */
  putBlob(record) {
    const existing = this.db
      .prepare("select * from blobs where chain_id = ? and record_id = ?")
      .get(record.chain_id, record.record_id);
    if (existing) {
      const incomingWins =
        record.updated_at > existing.updated_at ||
        (record.updated_at === existing.updated_at && record.signer <= existing.signer);
      if (!incomingWins) return { changed: false, reason: "stale", existing };
    }
    const payload = Buffer.from(record.payload, "base64url");
    this.db
      .prepare(
        `insert into blobs
           (chain_id, record_id, category, updated_at, tombstone, nonce, payload, signer, sig, size_bytes)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(chain_id, record_id) do update set
           category   = excluded.category,
           updated_at = excluded.updated_at,
           tombstone  = excluded.tombstone,
           nonce      = excluded.nonce,
           payload    = excluded.payload,
           signer     = excluded.signer,
           sig        = excluded.sig,
           size_bytes = excluded.size_bytes`,
      )
      .run(
        record.chain_id,
        record.record_id,
        record.category,
        record.updated_at,
        record.tombstone ? 1 : 0,
        record.nonce,
        new Uint8Array(payload),
        record.signer,
        record.sig,
        payload.length,
      );
    return { changed: true, record };
  }

  getBlobs(chainId, since, page = DEFAULT_PAGE, cursor = null) {
    let sql = "select * from blobs where chain_id = ?";
    const args = [chainId];
    if (since) {
      sql += " and updated_at > ?";
      args.push(since);
    }
    if (cursor) {
      sql += " and (updated_at > ? or (updated_at = ? and record_id > ?))";
      args.push(cursor.updated_at, cursor.updated_at, cursor.record_id);
    }
    sql += " order by updated_at, record_id limit ?";
    args.push(page + 1);
    const rows = this.db.prepare(sql).all(...args);
    const hasMore = rows.length > page;
    return {
      records: hasMore ? rows.slice(0, page) : rows,
      next_cursor: hasMore ? { updated_at: rows[page - 1].updated_at, record_id: rows[page - 1].record_id } : null,
    };
  }

  /**
   * Garbage-collect tombstones that every live device of the chain has already
   * seen past. Hard-deleting on the first sync would resurrect the record on a
   * device that was offline (architecture §4.5), so a tombstone leaves only when
   * the chain's oldest last_seen is past it, or it is older than 90 days and
   * nobody has synced since (a chain with one device that never returns).
   */
  gcTombstones({ retentionSeconds = 90 * 24 * 3600 } = {}) {
    // A tombstone is safe to drop when EITHER condition holds:
    //   (a) every live device of the chain has synced past it, i.e. its
    //       updated_at is below the oldest device's last_seen; or
    //   (b) it is older than the retention window and nobody has synced since.
    // "Either" means the cutoff is the LARGER of the two thresholds: deleting
    // when updated_at < cutoff then covers (a) at or above min(last_seen) and
    // (b) at or above now-retention. Taking the smaller would require both and
    // would keep every tombstone forever.
    const oldest = this.db
      .prepare("select min(last_seen) as t from devices where removed = 0")
      .get();
    const oldestSeen = oldest?.t ?? this.now();
    const retentionCutoff = this.now() - retentionSeconds;
    const cutoff = Math.max(oldestSeen, retentionCutoff);
    const result = this.db
      .prepare("delete from blobs where tombstone = 1 and updated_at < ?")
      .run(cutoff);
    return { removed: result.changes, cutoff, oldest_seen: oldestSeen, retention_cutoff: retentionCutoff };
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}

/* ------------------------------------------------------------------------- */
/* verification                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Ed25519 verification with node:crypto. `crypto.verify(null, message, key,
 * signature)` is the API for Ed25519 with no pre-hashing (RFC 8032 PureEdDSA),
 * and the algorithm name "Ed25519" is one of the curve names OpenSSL 3 exposes —
 * `openssl list -signature-algorithms | grep -i ed25519` on this box reports it,
 * and the server's tests exercise it against a signature the extension's
 * WebCrypto produced (test/server.test.mjs).
 */
export function verifyEd25519(publicKeyRaw, message, signatureBase64Url) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        // DER SPKI prefix for a 32-byte Ed25519 public key.
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(publicKeyRaw),
      ]),
      format: "der",
      type: "spki",
    });
    const messageBytes =
      typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
    return crypto.verify(null, messageBytes, key, Buffer.from(signatureBase64Url, "base64url"));
  } catch {
    return false;
  }
}

/* Re-exported so the HTTP layer and the tests share one definition. */
export { MAX_BODY_BYTES, MAX_RECORDS_PER_PUT, SCHEMA, API_VERSION, DEFAULT_PAGE };
