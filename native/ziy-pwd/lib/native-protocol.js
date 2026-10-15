/**
 * The native-messaging wire protocol for ziy-pwd.
 *
 * MDN, "Native messaging" (https://developer.mozilla.org/en-US/docs/Mozilla/
 * Add-ons/WebExtensions/Native_messaging), is exact about the framing:
 *
 *   "Each message is serialized using JSON, UTF-8 encoded and is preceded with
 *    an unsigned 32-bit value containing the message length in native byte
 *    order. The maximum size of a single message from the application is 1 MB."
 *
 * This is the same framing ziy-sync-agent uses, for the same reason: it is the
 * only one the engine implements, and one implementation of it in the product
 * is one place to audit. The differences that DO exist are the ones that matter
 * for a password helper:
 *
 *   1. MAX_MESSAGE_BYTES is 1 MB (MDN's own limit), and the pwd agent enforces
 *      it in BOTH directions. A CSV import is the one operation that can be
 *      large, so the protocol states the cap rather than discovering it.
 *   2. The host refuses to serve any extension whose id is not
 *      `ziy-pwd@ziy.app`, checked from MDN's launch argument #3 — the same
 *      refusal ziy-sync-agent makes. A native host that answers anyone who can
 *      launch it is a credential-stealing primitive.
 *   3. A reply NEVER carries a plaintext password unless the op's contract says
 *      it does (`credentials.get` for one fill). The writer enforces that: a
 *      handler's result is passed through a scrubber that drops any password
 *      field from an op that is not on the allowlist.
 */

import { EventEmitter } from "node:events";

export const MAX_MESSAGE_BYTES = 1024 * 1024; // MDN: "The maximum size of a
//                                              single message from the application is 1 MB"
export const ALLOWED_EXTENSION_ID = "ziy-pwd@ziy.app";

/** The one op whose reply carries a plaintext password, and only that field. */
const PASSWORD_REPLY_OPS = new Set(["credentials.get"]);

/** Encode `value` (any JSON-able) into a framed message. */
export function encodeMessage(value) {
  const json = JSON.stringify(value);
  const payload = Buffer.from(json, "utf8");
  if (payload.length > MAX_MESSAGE_BYTES) {
    throw new Error(`message too large: ${payload.length} bytes (max ${MAX_MESSAGE_BYTES})`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * The scrubber: removes a `password` field from any op reply that is not on the
 * allowlist. This is not a policy encoded in a handler and forgotten; it is the
 * writer, so a new op cannot accidentally leak.
 *
 * @param {string} op
 * @param {any} result
 */
export function scrubReply(op, result) {
  if (PASSWORD_REPLY_OPS.has(op)) return result;
  if (!result || typeof result !== "object") return result;
  const out = Array.isArray(result) ? result.map(r => scrubReply(op, r)) : { ...result };
  if (Array.isArray(out)) return out;
  for (const key of Object.keys(out)) {
    if (key === "password") { delete out[key]; continue; }
    if (out[key] && typeof out[key] === "object") out[key] = scrubReply(op, out[key]);
  }
  return out;
}

/**
 * Reads framed messages off a readable stream and emits `message` with the
 * decoded value. A partial header, a partial body, or a length that would
 * exceed MDN's 1 MB limit surfaces as `error` and the stream is destroyed —
 * a desynchronised length prefix is never recoverable, and guessing is how a
 * native host ends up reading JSON as a length.
 */
export class NativeMessageReader extends EventEmitter {
  constructor(stream, maxBytes = MAX_MESSAGE_BYTES) {
    super();
    this.buffer = Buffer.alloc(0);
    this.maxBytes = maxBytes;
    stream.on("data", (chunk) => this._onData(chunk));
    stream.on("end", () => this.emit("end"));
    stream.on("error", (error) => this.emit("error", error));
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32LE(0);
      if (length > this.maxBytes) {
        this.emit("error", new Error(`frame too large: ${length} bytes (max ${this.maxBytes})`));
        return;
      }
      if (this.buffer.length < 4 + length) return;
      const body = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      let value;
      try {
        value = JSON.parse(body);
      } catch (error) {
        this.emit("error", new Error(`frame body is not JSON: ${error.message}`));
        return;
      }
      this.emit("message", value);
    }
  }
}

/** Writes framed messages to a writable stream. */
export class NativeMessageWriter {
  constructor(stream) {
    this.stream = stream;
  }

  async send(value) {
    const framed = encodeMessage(value);
    if (!this.stream.write(framed)) {
      await new Promise((resolve, reject) => {
        this.stream.once("drain", resolve);
        this.stream.once("error", reject);
      });
    }
  }
}
