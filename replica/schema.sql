-- Ziy schema — the parts Ziy owns itself.
-- Gecko's native stores cover Bookmark / HistoryEntry / Download / PermissionGrant
-- (bookmarks, history, downloads, permissions APIs) and are NOT duplicated here.
-- Small launch-critical settings live in browser.storage.local (keys documented in
-- replica/architecture.md §3.1); this file covers the stores that need real structure.

---------------------------------------------------------------------------
-- native SQLite: ziy-sync-agent  (the only place chain material lives)
---------------------------------------------------------------------------
create table if not exists chain (
  id           integer primary key check (id = 1),
  device_id    text    not null,             -- Ed25519 public key of THIS device, base64url
  device_name  text    not null,
  device_type  text    not null check (device_type in ('desktop','mobile','tablet')),
  -- 128-bit random; binds the HKDF salt of every key (arch §4.1). This is NOT
  -- the wire identity: the SyncChain id sent to the server is derived from the
  -- chain master key (§3.1 entity `SyncChain`), not this column (arch §4.3.2).
  chain_id     text    not null,
  created_at   integer not null,             -- unix seconds, UTC
  last_sync_at integer
);

-- Record shape: verified against the real protocol (re-deep-sync.md §2/§3, arch §4.3).
-- The server-renamed-id rule is load-bearing here: a create is re-keyed by the
-- server to its own uuid, so this table's key is the CLIENT-stable id and the
-- server id is kept alongside. Never key keys or ciphertext off a server id.
create table if not exists records (
  category        text    not null,            -- bookmarks|passwords|autofill|history|tabs|extensions|themes|apps|settings
  --
  -- our stable id for the logical record; also the per-record HKDF salt (§4.1)
  record_id       text    not null,
  -- uuid assigned by OUR SERVER on create; the storage key under PK (category,
  -- record_id) above. OriginatorClientItemID is retained server-side as the map.
  server_record_id text,
  -- SERVER-stamped version = server mtime in ms; conditional-write on this, and
  -- a mismatch returns CONFLICT without storing (§4.3.3). Not client-clocked LWW.
  -- 0 = created locally, not yet server-versioned on the next commit.
  version         integer not null default 0,
  updated_at      integer not null,            -- unix seconds, UTC (client's, inside the AAD only)
  tombstone       integer not null default 0 check (tombstone in (0,1)),
  nonce           text    not null,            -- base64, 12 bytes = counter(2B BE) || random(10B), §4.2
  payload         blob    not null,            -- AES-256-GCM ciphertext
  -- AAD is bound as (category, record_id, updated_at) at encrypt time (§4.2) and
  -- is NEVER stored as its own column: only the encryption context that produced
  -- the payload can decrypt it, and a stored copy would just be a second place
  -- for it to drift.
  signer          text    not null,            -- base64 Ed25519 public key of the writer
  sig             text    not null,            -- base64 Ed25519 signature
  primary key (category, record_id)
) without rowid;
create index if not exists records_cat_updated on records (category, updated_at);

-- per-category send/receive toggles, enforced client-side (architecture §4.4)
create table if not exists chain_categories (
  category text primary key,
  send     integer not null default 1 check (send in (0,1)),
  receive  integer not null default 1 check (receive in (0,1))
);
insert or ignore into chain_categories (category) values
  ('bookmarks'),('passwords'),('autofill'),('history'),
  ('tabs'),('extensions'),('themes'),('apps'),('settings');

pragma user_version = 1;

---------------------------------------------------------------------------
-- IndexedDB stores (schema declared in JS; recorded here for the record)
-- ziy-shields / ziy-ntp
-- (ziy-wallet was cut by product decision — no crypto wallet in Ziy)
-- (ziy-vpn was cut by product decision — no VPN in Ziy; no VPN store was
--  ever declared here)
-- (ziy-rewards was cut by product decision — no ads/token/rewards economy in
--  Ziy: no earnings ledger, no creator/tipping registry, no ad catalog)
-- see architecture.md §3.2 for the field-by-field definitions
---------------------------------------------------------------------------
