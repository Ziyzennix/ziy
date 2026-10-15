/**
 * The agent's only egress point. Everything else imports this.
 *
 * A deliberately small surface: one function, HTTPS-only, no redirect following
 * that could be re-pointed, a hard timeout, and a response-size cap. Node's
 * global fetch (undici) handles the TLS; cert pinning of the server's key would
 * be added here when Ziy operates its own server (architecture §4.2 notes pinning
 * protects an already-blind store, which is a hardening not a correctness
 * requirement, and it is recorded as an open item in replica/proofs-sync.md).
 *
 * LOGGING RULE: this function never logs a URL with a query string, a header
 * value, or a body. The server's own blindness claim depends on no participant
 * writing down more than it needs to.
 */

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export async function httpRequest(url, init = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    ...rest
  } = init;

  // A separate name from the response body's `parsed` below: both are in this
  // function's scope and sharing one name is a SyntaxError, not a shadow.
  const target = new URL(url);
  if (target.protocol !== "https:") {
    // The product rule is HTTPS-only. The one documented exception is a
    // loopback address, for a developer running their own sync server on
    // 127.0.0.1 — where TLS buys nothing because nothing leaves the machine.
    // It must be opted into with ZIY_SYNC_ALLOW_PLAINTEXT_LOOPBACK=1, so the
    // default posture stays "refuse", and the exception never covers a
    // non-loopback host.
    const loopback = /^127\.|^0\.0\.0\.0$|^localhost$/.test(target.hostname);
    const allowed = loopback && process.env.ZIY_SYNC_ALLOW_PLAINTEXT_LOOPBACK === "1";
    if (!allowed) {
      throw Object.assign(new Error(`refusing non-HTTPS url (${target.protocol}://${target.hostname})`), {
        code: "insecure-transport",
      });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // `fetch` does NOT serialise a plain object into a JSON body: it becomes the
  // literal string "[object Object]" and the server answers 400 with a parse
  // error. An object body means "send this as JSON", a string body is sent
  // verbatim, and everything else is passed through for fetch to handle.
  let requestBody = rest.body;
  const headers = new Headers(rest.headers || {});
  if (
    requestBody !== undefined &&
    requestBody !== null &&
    typeof requestBody === "object" &&
    !(requestBody instanceof Uint8Array)
  ) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    requestBody = JSON.stringify(requestBody);
  }

  let response;
  try {
    response = await fetch(url, {
      ...rest,
      headers,
      body: requestBody,
      redirect: "error", // a redirect target is not a location we vetted
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw Object.assign(new Error(`request timed out after ${timeoutMs}ms`), { code: "timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  // Read the body with the size cap, then rebuild a Response the CALLER'S
  // contract expects. Two callers exist and they disagree: the ops-* handlers
  // call this directly and want the parsed JSON, while the shared SyncClient
  // (extensions/ziy-sync/lib/client.js) is handed this function as its `fetch`
  // and calls `response.text()` on the result. Returning a real Response — whose
  // body is the capped bytes and whose status/headers are preserved — satisfies
  // both, and keeps one egress point instead of two.
  const responseBody = await readCapped(response, maxBytes);
  const status = response.status;
  const responseHeaders = new Headers(response.headers);

  if (!response.ok) {
    let message = "";
    try {
      message = (JSON.parse(responseBody.toString("utf8")) || {}).message || "";
    } catch {
      /* a non-JSON error body is not itself an error worth failing over */
    }
    throw Object.assign(new Error(message || `HTTP ${status}`), {
      code: /^\d+$/.test(message) ? `http-${status}` : "server-error",
      status,
    });
  }

  return new Response(status === 204 ? null : responseBody, {
    status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

/** The parsed-JSON view, for the callers that want it rather than a Response. */
export async function httpRequestJson(url, init = {}) {
  const response = await httpRequest(url, init);
  const text = await response.text();
  return text.length ? JSON.parse(text) : {};
}

async function readCapped(response, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error(`server response exceeded ${maxBytes} bytes`), { code: "response-too-large" });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
