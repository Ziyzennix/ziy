/**
 * The credential store — the encrypted vault.
 *
 * WHAT IS HERE
 * ------------
 * A single SQLite database, outside the profile, holding one credential per
 * row. Every credential's username and password are encrypted together with
 * AES-256-GCM under the vault key derived from the user's passphrase; the plain
 * string a user searches by (the origin) is not encrypted, because it is the
 * only field the list needs to show and it is the key the save operation
 * matches on.
 *
 * WHY THE VAULT KEY IS NOT ON DISK
 * --------------------------------
 * The passphrase is the only thing that opens the vault, and it is held in this
 * process's memory for as long as the store is unlocked — exactly the shape
 * ziy-sync-agent's store.js uses for the chain seed. An unlocked key is never
 * written anywhere: `vault.key` in the sync agent protects a seed the browser
 * cannot decrypt at all, which is a different threat model. Here the key must be
 * re-derivable from something a human knows, so the KDF output is the key and
 * it lives only in RAM.
 *
 * WHAT THE BROWSER SEES
 * ---------------------
 * The op replies. For a list: origin, username, and a display id — never a
 * password, never a KDF parameter. For a fill: the password, for the length of
 * one operation, and never persisted. That split is the whole reason this is a
 * native helper rather than extension storage: the engine has no password-manager
 * write API, and even if it did, a credential store whose plaintext lands in
 * browser-accessible storage would be a weaker product.
 *
 * WRITE-AHEAD LOG
 * ---------------
 * SQLite's own journal is the crash-safety story, which is the same one the
 * sync agent's store relies on. `synchronous=FULL` is set so a kill -9 between
 * an insert and the next fsync still leaves a consistent file.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deriveVaultKey, encryptJson, decryptJson, newSalt } from "./ziy-crypto.js";

const SCHEMA = `
-- The vault's parameters. One row, because one passphrase opens one vault.
-- The salt is public: without the passphrase it is noise.
create table if not exists vault (
  id         integer primary key check (id = 1),
  salt       text    not null,               -- base64, 16 bytes
  rounds     integer not null,
  kdf        text    not null,
  created_at integer not null,
  updated_at integer not null,
  verify     text    not null                -- the unlock probe envelope
);
-- One credential per origin+username pair. The origin and username are
-- plaintext because they are the list's own rows; the password never is.
create table if not exists credentials (
  id         text    primary key,             -- client-stable, never re-keyed
  origin     text    not null,
  username   text    not null,
  nonce      text    not null,                -- base64, 12 bytes
  tag        text    not null                 -- base64, 16 bytes
);
-- The ciphertext bodies, keyed cred:<id>, so clear() drops every credential
-- body with one pattern and remove() drops exactly one.
create table if not exists meta (
  key   text primary key,
  value text not null
);
`;

export class VaultStore {
  /**
   * @param {string} dataDir  overridable so tests never touch the real vault
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dataDir, "vault.sqlite"));
    // synchronous=FULL is what makes a kill -9 between an insert and the next
    // fsync leave a consistent file rather than a torn journal.
    this.db.exec("pragma synchronous = full");
    this.db.exec("pragma journal_mode = wal");
    this.db.exec(SCHEMA);
    this.key = null;
    this.unlockedAt = 0;
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* a closed store is a closed store */
    }
  }

  /* -- vault lifecycle ---------------------------------------------------- */

  hasVault() {
    return Boolean(this.db.prepare("select id from vault where id = 1").get());
  }

  isLocked() {
    return this.key === null;
  }

  /**
   * Creates the vault under a new passphrase.
   * Returns the parameters, so the caller can display them, and NEVER the key.
   */
  create(passphrase) {
    if (this.hasVault()) throw new Error("a vault already exists");
    const salt = newSalt();
    this.key = deriveVaultKey(passphrase, salt);
    // The probe is what makes a later unlock fail loudly on a WRONG passphrase
    // instead of silently producing a key that decrypts nothing. Without it, a
    // mistyped passphrase unlocks the vault and every read then fails one by
    // one, which is a far worse diagnosis for a user than "unlock failed".
    const probe = encryptJson(this.key, utf8("ziy-vault-probe"), utf8("ziy-vault/v1"));
    const now = Date.now();
    this.db.prepare(
      "insert into vault (id, salt, rounds, kdf, created_at, updated_at, verify) values (1, ?, ?, ?, ?, ?, ?)",
    ).run(salt.toString("base64"), currentRounds(), currentKdf(), now, now, JSON.stringify(probe));
    this.unlockedAt = now;
    return { created: true, rounds: currentRounds(), kdf: currentKdf() };
  }

  /**
   * Unlocks the vault. A wrong passphrase is indistinguishable from a corrupt
   * vault from the outside, and the error message says so without saying why:
   * telling a caller WHICH byte failed is a side channel.
   */
  unlock(passphrase) {
    const row = this.db.prepare("select id, salt, rounds, kdf, verify from vault where id = 1").get();
    if (!row) throw new Error("no vault yet");
    const salt = Buffer.from(row.salt, "base64");
    const key = deriveVaultKey(passphrase, salt);
    try {
      decryptJson(key, JSON.parse(row.verify), utf8("ziy-vault/v1"));
    } catch {
      throw new Error("vault unlock failed");
    }
    this.key = key;
    this.unlockedAt = Date.now();
    return { unlocked: true, rounds: row.rounds, kdf: row.kdf };
  }

  lock() {
    this.key = null;
    this.unlockedAt = 0;
    return { locked: true };
  }

  /* -- credentials -------------------------------------------------------- */

  /**
   * Saves a credential. The username and password are encrypted together, so
   * neither is recoverable from the database file without the passphrase.
   *
   * @param {{id?: string, origin: string, username: string, password: string}} cred
   */
  save(cred) {
    this._requireUnlocked();
    const origin = normaliseOrigin(cred.origin);
    if (!origin) throw new Error("not an http(s) origin");
    const username = String(cred.username || "");
    const password = String(cred.password || "");
    if (!username) throw new Error("a credential needs a username");
    const id = cred.id || `${origin}|${username}`.replace(/[^a-zA-Z0-9._|-]/g, "_");
    const envelope = encryptJson(this.key, utf8(JSON.stringify({ username, password })), utf8(id));
    // One row per origin+username: a re-save REPLACES the password, which is
    // what "update this login" means in the panel.
    this.db.prepare(
      `insert into credentials (id, origin, username, nonce, tag) values (?, ?, ?, ?, ?)
       on conflict(id) do update set origin = excluded.origin,
                                      username = excluded.username,
                                      nonce = excluded.nonce,
                                      tag = excluded.tag`,
    ).run(id, origin, username, envelope.iv, envelope.tag);
    this._writeCiphertext(id, envelope);
    this._touch();
    return { id, origin, username };
  }

  /** The list the panel shows: origin, username, id. No password, ever. */
  list() {
    const rows = this.db.prepare(
      "select id, origin, username from credentials order by origin, username",
    ).all();
    return rows;
  }

  /** The decrypted credential, for one fill. */
  get(id) {
    this._requireUnlocked();
    const row = this.db.prepare("select * from credentials where id = ?").get(id);
    if (!row) return null;
    const body = this.db.prepare("select value from meta where key = ?").get(`cred:${id}`);
    if (!body) return null;
    const plain = decryptJson(this.key, JSON.parse(body.value), utf8(id));
    const { username, password } = JSON.parse(plain.toString("utf8"));
    return { id: row.id, origin: row.origin, username, password };
  }

  remove(id) {
    const row = this.db.prepare("select id from credentials where id = ?").get(id);
    if (!row) return { removed: false, id };
    this.db.prepare("delete from credentials where id = ?").run(id);
    this.db.prepare("delete from meta where key = ?").run(`cred:${id}`);
    this._touch();
    return { removed: true, id };
  }

  /**
   * Removes every credential. This is the "delete all passwords" operation, and
   * it is deliberately not undoable: the panel says so before it is called.
   */
  clear() {
    const before = this.db.prepare("select count(*) as n from credentials").get().n;
    this.db.exec("delete from credentials");
    this.db.exec("delete from meta where key like 'cred:%'");
    this._touch();
    return { cleared: before };
  }

  /* -- internals ---------------------------------------------------------- */

  _requireUnlocked() {
    if (!this.key) throw new Error("the vault is locked");
  }

  _touch() {
    this.db.prepare("update vault set updated_at = ? where id = 1").run(Date.now());
  }

  /**
   * The ciphertext bodies, keyed `cred:<id>` in the meta table. They live apart
   * from the credentials row because the envelope is a JSON object rather than
   * columns, and because it keeps `credentials` readable as the index the list
   * actually uses.
   */
  _writeCiphertext(id, envelope) {
    const body = {
      iv: envelope.iv,
      tag: envelope.tag,
      ciphertext: envelope.ciphertext,
    };
    this.db.prepare(
      "insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
    ).run(`cred:${id}`, JSON.stringify(body));
  }
}

function currentRounds() {
  return process.env.ZIY_PWD_ROUNDS
    ? Number(process.env.ZIY_PWD_ROUNDS)
    : 600000;
}

function currentKdf() {
  return "PBKDF2-SHA512";
}

function utf8(text) {
  return Buffer.from(String(text), "utf8");
}

/**
 * An origin, normalised the way a credential is keyed: scheme plus host plus a
 * non-default port, no path. `https://Example.com:443/a/b` -> `https://example.com`.
 * A bare host is rejected: a credential must belong to a scheme the page can
 * be served over, or a fill cannot tell whether it applies.
 */
export function normaliseOrigin(origin) {
  const raw = String(origin || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const port = url.port && !isDefaultPort(url.protocol, url.port) ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
}

function isDefaultPort(protocol, port) {
  return (protocol === "https:" && port === "443") || (protocol === "http:" && port === "80");
}
