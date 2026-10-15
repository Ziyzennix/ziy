#!/usr/bin/env node
/**
 * ziy-sync-server — the HTTP surface.
 *
 * Endpoints
 *   POST   /v1/chains                     {chain_id, device_pubkey, device_name, device_type}
 *   POST   /v1/challenges                 {device_id, signature}
 *   GET    /v1/chains/:chainId/records    ?since=&page=&cursor=   (Bearer)
 *   PUT    /v1/chains/:chainId/records    [records]                (Bearer)
 *   DELETE /v1/chains/:chainId            (Bearer) — leave the chain = cache wipe
 *   GET    /healthz                       readiness, no auth, no data
 *
 * Everything is JSON. Errors are {error: code, message: "human sentence"}.
 *
 * AUTHENTICATED OPERATIONS ARE SCOPED TO THE CHAIN THE SESSION BELONGS TO: a
 * token for chain A cannot read or write chain B, ever, because the token's
 * chain_id is looked up from the session at request time and the path parameter
 * is compared against it, not trusted.
 */

import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import {
  BlindStore,
  verifyEd25519,
  MAX_BODY_BYTES,
  MAX_RECORDS_PER_PUT,
  API_VERSION,
  DEFAULT_PAGE,
} from "./store.js";

const SIGNING_MESSAGE_PREFIX = "ziy-rec/v1";

/** The exact canonical message the client signs over a record. */
function recordSigningMessage(record) {
  return [
    SIGNING_MESSAGE_PREFIX,
    record.category,
    record.record_id,
    String(record.updated_at),
    record.tombstone ? "tombstone" : "live",
    record.nonce,
    record.payload,
  ].join("|");
}

function now() {
  return Math.floor(Date.now() / 1000);
}

export function createServer({ store = new BlindStore(), bodyLimit = MAX_BODY_BYTES, log = null } = {}) {
  /**
   * A minimal logger. It prints method, path (path only — never a query string,
   * which could carry a `since` timestamp), status and bytes. It NEVER prints a
   * body, a header, or a token. Operators who want nothing can pass log: null.
   */
  const write = (message) => {
    if (log) log(message);
  };

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let status = 500;
    let size = 0;
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;
      const handled = await route(req, res, pathname, url);
      status = handled.status;
      size = handled.size;
    } catch (error) {
      status = sendJson(res, error.status || 500, {
        error: error.code || "internal",
        message: error.expose ? error.message : "the server had an internal problem",
      });
      size = 0;
    } finally {
      write(`${req.method} ${safePath(req.url)} ${status} ${size} ${Date.now() - started}ms`);
    }
  });

  /**
   * Route one request. Returns {status, size} for the access line. Responses are
   * always JSON so a client never has to guess.
   */
  async function route(req, res, pathname, url) {
    if (req.method === "GET" && pathname === "/healthz") {
      return { status: sendJson(res, 200, { ok: true, service: "ziy-sync-server", api: API_VERSION }), size: 0 };
    }

    if (req.method === "POST" && pathname === `/${API_VERSION}/chains`) {
      const body = await readJson(req, bodyLimit);
      return { status: await registerDevice(res, body), size: 0 };
    }

    if (req.method === "POST" && pathname === `/${API_VERSION}/challenges`) {
      const body = await readJson(req, bodyLimit);
      return { status: await answerChallenge(res, body), size: 0 };
    }

    const chainMatch = pathname.match(new RegExp(`^/${API_VERSION}/chains/([^/]+)(/records)?$`));
    if (chainMatch) {
      const chainId = decodeURIComponent(chainMatch[1]);
      if (!chainMatch[2]) {
        if (req.method === "DELETE") {
          const session = await requireSession(req, res, chainId);
          if (!session) return { status: 401, size: 0 };
          return { status: await leaveChain(res, session), size: 0 };
        }
        return { status: methodNotAllowed(res, ["DELETE"]), size: 0 };
      }
      // /records
      const session = await requireSession(req, res, chainId);
      if (!session) return { status: 401, size: 0 };
      if (req.method === "GET") return { status: await getRecords(res, session, url), size: 0 };
      if (req.method === "PUT") {
        const body = await readJson(req, bodyLimit);
        return { status: await putRecords(res, session, body), size: 0 };
      }
      return { status: methodNotAllowed(res, ["GET", "PUT"]), size: 0 };
    }

    return { status: sendJson(res, 404, { error: "not-found", message: "no such endpoint" }), size: 0 };
  }

  /* -- endpoints ---------------------------------------------------------- */

  async function registerDevice(res, body) {
    const chainId = asString(body.chain_id);
    const deviceId = asString(body.device_pubkey);
    if (!chainId || !/^[A-Za-z0-9_-]{8,128}$/.test(chainId)) {
      return sendJson(res, 400, { error: "bad-chain-id", message: "chain_id must be 8-128 base64url characters" });
    }
    const publicKey = decodeBase64Url(deviceId);
    if (!publicKey || publicKey.length !== 32) {
      return sendJson(res, 400, {
        error: "bad-device-pubkey",
        message: "device_pubkey must be a base64url 32-byte Ed25519 public key",
      });
    }
    store.registerDevice({
      chainId,
      deviceId,
      publicKey,
      deviceName: asString(body.device_name) || "Ziy device",
      deviceType: asString(body.device_type) || "desktop",
    });
    const challenge = store.createChallenge(deviceId);
    return sendJson(res, 200, {
      device_id: deviceId,
      challenge,
      expires_in: 120,
      chain_id: chainId,
    });
  }

  async function answerChallenge(res, body) {
    // The caller sends back the nonce the registration step issued, under the
    // field name the registration response used (`challenge`), plus its
    // signature over those exact bytes. Both spellings are accepted for
    // `nonce`/`challenge` because the client library's request builder and a
    // hand-written caller should not have to guess which one we meant.
    const deviceId = asString(body.device_id);
    const nonce = asString(body.challenge) || asString(body.nonce);
    const signature = asString(body.signature) || asString(body.sig);
    if (!deviceId || !nonce || !signature) {
      return sendJson(res, 400, {
        error: "bad-request",
        message: "device_id, challenge and signature are required",
      });
    }
    const device = store.getDevice(deviceId);
    if (!device || device.removed) {
      return sendJson(res, 403, { error: "unknown-device", message: "that device is not registered" });
    }
    if (!store.consumeChallenge(nonce, deviceId)) {
      return sendJson(res, 403, { error: "bad-challenge", message: "the challenge is unknown, used, or expired" });
    }
    if (!verifyEd25519(new Uint8Array(device.public_key), nonce, signature)) {
      return sendJson(res, 403, { error: "bad-signature", message: "the signature does not match the device key" });
    }
    const token = store.createSession({ deviceId, chainId: device.chain_id });
    return sendJson(res, 200, {
      token,
      device_id: deviceId,
      chain_id: device.chain_id,
      expires_in: 24 * 3600,
      last_sync_at: 0,
    });
  }

  async function getRecords(res, session, url) {
    // `searchParams.get` returns null for an absent parameter and Number(null) is
    // 0, which would read as a legitimate since=0. Both mean "from the
    // beginning", so the null case is handled explicitly rather than by accident.
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw === null || sinceRaw === "" ? 0 : Number(sinceRaw);
    if (!Number.isFinite(since) || since < 0) {
      return sendJson(res, 400, { error: "bad-since", message: "since must be a non-negative number" });
    }
    const page = clampInt(url.searchParams.get("page"), DEFAULT_PAGE, 1, 1000);
    const cursorParam = url.searchParams.get("cursor");
    let cursor = null;
    if (cursorParam) {
      try {
        cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString("utf8"));
      } catch {
        return sendJson(res, 400, { error: "bad-cursor", message: "cursor is not a base64url JSON object" });
      }
    }
    const result = store.getBlobs(session.chain_id, since, page, cursor);
    const records = result.records.map(toWire);
    return sendJson(res, 200, {
      records,
      next_cursor: result.next_cursor
        ? Buffer.from(JSON.stringify(result.next_cursor), "utf8").toString("base64url")
        : null,
      server_time: now(),
    });
  }

  async function putRecords(res, session, body) {
    if (!Array.isArray(body)) {
      return sendJson(res, 400, { error: "bad-request", message: "the body must be an array of records" });
    }
    if (body.length > MAX_RECORDS_PER_PUT) {
      return sendJson(res, 400, {
        error: "too-many-records",
        message: `at most ${MAX_RECORDS_PER_PUT} records per request`,
      });
    }
    const accepted = [];
    const rejected = [];
    for (const raw of body) {
      const problem = validateRecord(raw);
      if (problem) {
        rejected.push({ reason: problem, record_id: typeof raw?.record_id === "string" ? raw.record_id : null });
        continue;
      }
      // Verify the signature with the registered key of the claiming signer. A
      // record claiming a device that is not in this chain is refused, so one
      // device cannot plant blobs under another's name.
      const signer = store.getDevice(raw.signer);
      if (!signer || signer.removed || signer.chain_id !== session.chain_id) {
        rejected.push({ reason: "signer-not-in-chain", record_id: raw.record_id });
        continue;
      }
      if (!verifyEd25519(new Uint8Array(signer.public_key), recordSigningMessage(raw), raw.sig)) {
        rejected.push({ reason: "signature-invalid", record_id: raw.record_id });
        continue;
      }
      // The record's category is the bucket the client chose; it is echoed back
      // so the client can re-check its own toggle, and it is NOT used to decide
      // anything on this side.
      const record = {
        chain_id: session.chain_id,
        record_id: raw.record_id,
        category: raw.category,
        updated_at: raw.updated_at,
        tombstone: raw.tombstone === true,
        nonce: raw.nonce,
        payload: raw.payload,
        signer: raw.signer,
        sig: raw.sig,
      };
      const result = store.putBlob(record);
      if (result.changed) accepted.push(raw.record_id);
      else rejected.push({ reason: "stale", record_id: raw.record_id });
    }
    return sendJson(res, 200, { accepted, rejected, stored: store.db.prepare("select count(*) as n from blobs where chain_id = ?").get(session.chain_id).n });
  }

  async function leaveChain(res, session) {
    const result = store.wipeChain(session.chain_id);
    return sendJson(res, 200, {
      left: true,
      chain_id: session.chain_id,
      blobs_deleted: result.blobs_deleted,
      at: now(),
    });
  }

  /* -- helpers ------------------------------------------------------------ */

  async function requireSession(req, res, chainId) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      sendJson(res, 401, {
        error: "no-token",
        message: "this endpoint needs a Bearer token from POST /v1/challenges",
      });
      return null;
    }
    const session = store.sessionDevice(token);
    if (!session) {
      sendJson(res, 401, { error: "bad-token", message: "the token is unknown or expired" });
      return null;
    }
    // The session is the authority on which chain a device may touch. A token
    // minted for chain A used against chain B's path is refused here, not later.
    if (session.chain_id !== chainId) {
      sendJson(res, 403, {
        error: "chain-mismatch",
        message: "this token was issued for a different chain",
      });
      return null;
    }
    return session;
  }

  async function readJson(req, limit) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > limit) {
        const error = Object.assign(new Error(`request body exceeds ${limit} bytes`), {
          code: "body-too-large",
          status: 413,
          expose: true,
        });
        throw error;
      }
      chunks.push(chunk);
    }
    if (!total) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      throw Object.assign(new Error(`body was not JSON: ${error.message}`), {
        code: "bad-json",
        status: 400,
        expose: true,
      });
    }
  }

  function toWire(row) {
    return {
      category: row.category,
      record_id: row.record_id,
      updated_at: row.updated_at,
      tombstone: Boolean(row.tombstone),
      nonce: row.nonce,
      payload: Buffer.from(row.payload).toString("base64url"),
      signer: row.signer,
      sig: row.sig,
      size_bytes: row.size_bytes,
    };
  }

  return server;
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
  return status;
}

function methodNotAllowed(res, allowed) {
  res.writeHead(405, { allow: allowed.join(", "), "content-type": "application/json" });
  res.end(JSON.stringify({ error: "method-not-allowed", message: `allowed: ${allowed.join(", ")}` }));
  return 405;
}

function asString(value) {
  return typeof value === "string" && value.length ? value : "";
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const buf = Buffer.from(value, "base64url");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/** Structural validation only: the server never looks inside a ciphertext. */
function validateRecord(record) {
  if (!record || typeof record !== "object") return "not-an-object";
  if (typeof record.category !== "string" || record.category.length < 1 || record.category.length > 64) {
    return "bad-category";
  }
  if (typeof record.record_id !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(record.record_id)) {
    return "bad-record-id";
  }
  if (!Number.isInteger(record.updated_at) || record.updated_at < 0 || record.updated_at > 4e9) {
    return "bad-updated-at";
  }
  if (typeof record.tombstone !== "boolean") return "bad-tombstone";
  for (const field of ["nonce", "payload", "signer", "sig"]) {
    if (typeof record[field] !== "string" || !/^[A-Za-z0-9_-]+$/.test(record[field])) return `bad-${field}`;
  }
  if (decodeBase64Url(record.nonce)?.length !== 12) return "bad-nonce-length";
  // AES-GCM over an empty plaintext is the 16-byte tag, so a tombstone's
  // ciphertext is 16 bytes, not zero. Anything shorter than a tag is malformed.
  if (decodeBase64Url(record.payload)?.length < 16) return "payload-too-short";
  return null;
}

/**
 * Parse an optional integer query parameter.
 *
 * `Number(null)` is 0, not NaN, so a MISSING parameter would otherwise parse as
 * a perfectly valid zero — which for a page size means "return one record per
 * request". A missing or empty parameter must fall through to the default, so
 * the null check comes before the Number() coercion.
 */
function clampInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function safePath(requestUrl) {
  // The path without the query string: `since` is a timestamp and a page cursor
  // is an opaque id, and neither belongs in a log line.
  const index = requestUrl.indexOf("?");
  return index === -1 ? requestUrl : requestUrl.slice(0, index);
}

/* ------------------------------------------------------------------------- */
/* main                                                                      */
/* ------------------------------------------------------------------------- */

function main() {
  const port = Number(process.env.PORT || process.env.ZIY_SYNC_PORT || 8484);
  const host = process.env.HOST || "127.0.0.1";
  const dbFile = process.env.ZIY_SYNC_DB || path.join(process.env.ZIY_SYNC_DATA || "/tmp/ziy-sync-server", "blind.sqlite");
  const store = new BlindStore(dbFile);
  // The log line is method + path + status + size + duration. No body, no
  // headers, no query string. Operators who want nothing pass ZIY_SYNC_LOG=0.
  const log = process.env.ZIY_SYNC_LOG === "0" ? null : (line) => process.stdout.write(line + "\n");
  const server = createServer({ store, log });

  server.listen(port, host, () => {
    process.stdout.write(
      `ziy-sync-server: listening on http://${host}:${port}  db=${dbFile}  api=${API_VERSION}\n`,
    );
    process.stdout.write("ziy-sync-server: this server stores opaque blobs and cannot read them.\n");
  });

  const shutdown = () => {
    server.close(() => store.close());
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Only run when executed directly, not when imported by a test.
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  main();
}
