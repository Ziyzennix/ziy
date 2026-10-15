/**
 * The native-messaging wire protocol.
 *
 * MDN, "Native messaging" (https://developer.mozilla.org/en-US/docs/Mozilla/
 * Add-ons/WebExtensions/Native_messaging), is exact about the framing:
 *
 *   "Each message is serialized using JSON, UTF-8 encoded and is preceded with
 *    an unsigned 32-bit value containing the message length in native byte
 *    order. The maximum size of a single message from the application is 1 MB."
 *
 * "native byte order" on this platform is little-endian (x86-64), so the header
 * is a Uint32LE — which is also what MDN's own Node example builds with
 * `Buffer.from(new Uint32Array([len]).buffer)`: a Uint32Array on x86-64 is
 * little-endian, so that Buffer is already UInt32LE.
 *
 * Two arguments are passed to the host on launch (MDN, "connection-based
 * messaging"): the path to the app manifest, and the add-on id of the extension
 * that started it. We check both — the second one is why this host refuses to
 * talk to anything that is not ziy-sync@ziy.app.
 */

import { EventEmitter } from "node:events";

export const MAX_MESSAGE_BYTES = 1024 * 1024; // MDN: "The maximum size of a single
//                                              message from the application is 1 MB"
export const ALLOWED_EXTENSION_ID = "ziy-sync@ziy.app";

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
 * Reads framed messages off a readable stream and emits `message` with the
 * decoded value. A partial header, a partial body, or a length that would
 * exceed MDN's 1 MB limit surfaces as `error` and the stream is destroyed —
 * a desynchronised length prefix is never recoverable, and guessing is how a
 * native host ends up reading JSON as a length.
 */
export class NativeMessageReader extends EventEmitter {
  constructor(stream, { maxBytes = MAX_MESSAGE_BYTES } = {}) {
    super();
    this.stream = stream;
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    stream.on("data", (chunk) => this._onData(chunk));
    stream.on("error", (error) => this._fail(error));
    stream.on("end", () => {
      this.closed = true;
      this.emit("end");
    });
    stream.on("close", () => {
      this.closed = true;
      this.emit("close");
    });
  }

  _onData(chunk) {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      if (this.buffer.length < 4) return; // no complete header yet
      const length = this.buffer.readUInt32LE(0);
      if (length > this.maxBytes) {
        this._fail(new Error(`framing error: message length ${length} exceeds ${this.maxBytes}`));
        return;
      }
      if (this.buffer.length < 4 + length) return; // body still arriving
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      let value;
      try {
        value = JSON.parse(body.toString("utf8"));
      } catch (error) {
        this._fail(new Error(`framing error: body was not JSON: ${error.message}`));
        return;
      }
      this.emit("message", value);
    }
  }

  _fail(error) {
    if (this.closed) return;
    this.closed = true;
    this.emit("error", error);
    this.stream.destroy?.(error);
  }
}

/** Writes framed messages to a writable stream. */
export class NativeMessageWriter {
  constructor(stream) {
    this.stream = stream;
  }

  send(value) {
    return new Promise((resolve, reject) => {
      const message = encodeMessage(value);
      this.stream.write(message, (error) => (error ? reject(error) : resolve()));
    });
  }
}
