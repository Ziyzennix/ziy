/**
 * Device identity persistence for the native agent.
 *
 * WHY THIS EXISTS
 * ---------------
 * The browser launches the agent, may kill it, and launches it again — MDN:
 * the browser sends SIGTERM then SIGKILL to close a native host, and a new
 * connection starts a new process. So the device keypair must come back from
 * disk on every launch, and NOTHING is trusted from the launch arguments. A
 * fresh random keypair per launch would make the device a NEW device every
 * restart: the server would reject its records as "signer-not-in-chain" and the
 * chain would stop working after the first sync.
 *
 * THIS FILE'S JOB
 * ---------------
 * Store the Ed25519 private key (PKCS#8) and the base64url public key in the
 * agent's SQLite database, encrypted under the same key file the seed uses
 * (mode 0600, beside the DB, outside the profile). On relaunch, read them back
 * and re-import the PKCS#8 — which WebCrypto supports and round-trips
 * faithfully, as extensions/ziy-sync/test/keyderivation.test.mjs asserts
 * ("the private key survives a PKCS#8 round-trip").
 *
 * WHY NOT DERIVE IT DETERMINISTICALLY FROM THE SEED?
 * --------------------------------------------------
 * Tried first and abandoned, with the reason recorded rather than hidden:
 * Node's webcrypto will not import an Ed25519 private key from the 32-byte raw
 * scalar, and its JWK importer validates that a private JWK's `x` matches its
 * `d` — so a JWK built by hand from derived bytes is rejected as
 * "Invalid keyData" before any signing happens. PKCS#8 import (the format
 * exportKey actually produces) is the supported round-trip, so the key is
 * persisted in that form instead.
 *
 * The security posture is unchanged: the private key is stored encrypted under
 * a key the browser never sees, in a directory mode 0700 outside the profile,
 * and it is destroyed with the chain on "leave" and "delete account".
 */

import { importPrivateKey } from "./ziy-crypto.js";

/** @returns {{privateKey: CryptoKey, deviceId: string} | null} */
export async function loadDeviceIdentity(store) {
  const row = await store.readDeviceKey();
  if (!row) return null;
  try {
    const privateKey = await importPrivateKey(row.private_pkcs8);
    return { privateKey, deviceId: row.device_id };
  } catch {
    return null;
  }
}

/**
 * Persist a device keypair. `generateDeviceIdentity()` makes a random pair; the
 * caller then passes it here so the next launch can find it.
 */
export async function saveDeviceIdentity(store, { privateKeyPkcs8, deviceId }) {
  await store.putDeviceKey({ deviceId, privateKeyPkcs8 });
}
