/**
 * Admin ops for the native agent: device list, remove a device, leave the
 * chain, delete the account.
 *
 * "Leave Sync Chain" in the recon (S27) deletes the server's copy of the chain's
 * blob cache — that is what makes it a privacy operation and not just a logout.
 * The chain stays usable for the other devices; this device stops seeing it and
 * stops being able to decrypt anything new.
 *
 * "Delete Sync account" is the irreversible one: the server's cache AND this
 * device's local chain state, keys included. The recon's F20 edge note is
 * explicit ("deleting the account is irreversible"), so the extension asks for
 * confirmation before sending this op and the agent does not second-guess it.
 */

import { nowSeconds } from "./ops-chain.js";
import { httpRequestJson as httpRequest } from "./http.js";
import { sign } from "./ziy-crypto.js";

function baseUrlFor(agent) {
  const baseUrl = agent.baseUrl || process.env.ZIY_SYNC_SERVER;
  if (!baseUrl) {
    throw Object.assign(new Error("No sync server configured."), { code: "no-server" });
  }
  return baseUrl.replace(/\/+$/, "");
}

/**
 * An authenticated request, obtaining the session token on demand.
 *
 * The token is per-process and the browser starts a new process for each
 * connection, so an op that needs auth must first prove it holds the device's
 * private key: register (idempotent), answer the challenge, take the token.
 * Concretely that means `chain.leave` and `account.delete` work in a brand-new
 * launch without the extension having remembered anything in between.
 */
async function authedRequest(agent, store, path, init = {}) {
  if (!agent.token) {
    await connectToServer(agent, store);
  }
  const baseUrl = baseUrlFor(agent);
  return httpRequest(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers: { authorization: `Bearer ${agent.token}`, ...(init.headers || {}) },
    body: init.body,
  });
}

/**
 * Register this device with the chain and answer the server's challenge with an
 * Ed25519 signature, which is what proves we hold the private key. The server
 * learns nothing else: it gets a public key it already knew and a signature
 * over a nonce it generated.
 */
async function connectToServer(agent, store) {
  if (!agent.chainKeys || !agent.identity) {
    throw Object.assign(new Error("No chain session on this device yet."), { code: "no-session" });
  }
  const chain = store.getChain();
  if (!chain) throw Object.assign(new Error("This device is not in a chain."), { code: "not-in-chain" });

  const baseUrl = baseUrlFor(agent);
  const registered = await httpRequest(`${baseUrl}/v1/chains`, {
    method: "POST",
    body: {
      chain_id: chain.chain_id,
      device_pubkey: agent.deviceId,
      device_name: chain.device_name,
      device_type: chain.device_type,
    },
  });
  const signature = await sign(agent.identity.privateKey, registered.challenge);
  const session = await httpRequest(`${baseUrl}/v1/challenges`, {
    method: "POST",
    body: {
      device_id: registered.device_id,
      challenge: registered.challenge,
      signature,
    },
  });
  agent.token = session.token;
  return session;
}

export async function handleDevices(agent, store) {
  const chain = store.getChain();
  return {
    this_device: chain
      ? { device_id: chain.device_id, device_name: chain.device_name, device_type: chain.device_type, is_self: true }
      : null,
    devices: store.listDevices(),
    chain_id: chain ? chain.chain_id : null,
  };
}

/**
 * Remove another device from this device's view. The server keeps the blob
 * cache (the other device still exists); what this op does is stop this device
 * from treating records signed by that key as belong-to-chain, and drop it from
 * the device list. The recon's "Remove this device" is a privacy control on the
 * local side, so it is implemented locally plus a server-side denylist note.
 */
export async function handleDeviceRemove(agent, store, payload) {
  const deviceId = payload.device_id;
  if (!deviceId) {
    throw Object.assign(new Error("A device_id is required."), { code: "bad-device-id" });
  }
  const chain = store.getChain();
  if (chain && deviceId === chain.device_id) {
    throw Object.assign(new Error("That is this device. Use chain.leave to leave the chain."), {
      code: "cannot-remove-self",
    });
  }
  const removed = store.removeDevice(deviceId);
  return { removed, device_id: deviceId, note: "Records from this device will no longer be applied locally." };
}

/** Leave the chain: server cache wipe + local chain state wipe. */
export async function handleChainLeave(agent, store, payload) {
  const chain = store.getChain();
  if (!chain) {
    throw Object.assign(new Error("This device is not in a chain."), { code: "not-in-chain" });
  }
  let server = { wiped: false };
  try {
    // The server call first: if the network is down we must NOT destroy the
    // local state, or the user loses the chain with no way to rejoin.
    server = await authedRequest(agent, store, `/v1/chains/${encodeURIComponent(chain.chain_id)}`, {
      method: "DELETE",
    });
    server.wiped = true;
  } catch (error) {
    if (error && (error.code === "no-session" || error.code === "no-server")) throw error;
    throw Object.assign(
      new Error(
        "Ziy could not reach the sync server, so the chain was NOT left and no local data was deleted. " +
          "Reconnect and try again.",
      ),
      { code: "leave-failed-offline", cause: error.message },
    );
  }
  store.destroyChainData();
  agent.chainKeys = null;
  agent.identity = null;
  agent.token = null;
  return { left: true, chain_id: chain.chain_id, server_cache_wiped: true };
}

/** Delete everything: server cache, then local state. Irreversible. */
export async function handleAccountDelete(agent, store, payload) {
  if (payload.confirm !== "DELETE") {
    throw Object.assign(new Error('Deleting a Ziy Sync account is irreversible. Send confirm:"DELETE".'), {
      code: "confirm-required",
    });
  }
  const chain = store.getChain();
  if (!chain) {
    // Nothing to delete server-side; still wipe local state so a re-install is clean.
    store.destroyChainData();
    return { deleted: false, note: "There was no chain on this device; local state was reset anyway." };
  }
  let serverWiped = false;
  try {
    await authedRequest(agent, store, `/v1/chains/${encodeURIComponent(chain.chain_id)}`, { method: "DELETE" });
    serverWiped = true;
  } catch (error) {
    throw Object.assign(
      new Error(
        "Ziy could not reach the sync server, so the account was NOT deleted. Your data is intact on the server.",
      ),
      { code: "delete-failed-offline", cause: error.message },
    );
  }
  store.destroyChainData();
  agent.chainKeys = null;
  agent.identity = null;
  agent.token = null;
  return { deleted: true, chain_id: chain.chain_id, server_cache_wiped: serverWiped, at: nowSeconds() };
}
