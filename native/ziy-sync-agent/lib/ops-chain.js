/**
 * Chain lifecycle ops for the native agent: create, join, status.
 *
 * The word code is the user's secret and it is the ONLY thing that can create a
 * chain; the chain_id is a random 128-bit value that is NOT secret (it is the
 * HKDF salt and it travels to the server so the server can key its blobs by
 * chain). That split is architecture §4.1's and it is what makes the server
 * blind: give it the words and it could derive the keys; give it the chain id
 * and it can only find the blobs.
 */

import { randomBytes, toBase64Url } from "./ziy-crypto.js";
import { validateMnemonic, mnemonicToBytes, generateMnemonic, fetchRotatingWord } from "./ziy-crypto.js";
import {
  ChainKeys,
  generateChainId,
  generateDeviceIdentity,
  exportPublicKey,
  exportPrivateKey,
} from "./ziy-crypto.js";
import { saveDeviceIdentity, loadDeviceIdentity } from "./device-identity.js";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Create a chain. Two shapes:
 *   {op:"chain.create"}                    -> generate a code and show it once
 *   {op:"chain.create", words:[...], rotating_word:"ember", device_name:"Desktop"}
 *                                          -> actually create
 */
export async function handleChainCreate(agent, store, payload) {
  if (store.hasChain() && !payload.force) {
    throw Object.assign(new Error("This device is already part of a chain. Leave it first."), {
      code: "chain-exists",
    });
  }

  if (!payload.words) {
    // Step 1: the code to show the user. Both halves of it: the 24 words (which
    // are the only key) and the chain id (which is NOT secret — it is the HKDF
    // salt and it travels so another device can find the right blobs). Both are
    // returned once and stored only in derived form.
    const words = await generateMnemonic();
    const chainId = generateChainId();
    const rotating = await fetchRotatingWord(payload.rotating_word_source_url);
    return {
      step: "show-code",
      words,
      chain_id: chainId,
      rotating_word: rotating.word,
      rotating_word_bucket: rotating.bucket,
      rotating_word_source: rotating.source,
      note:
        "This code is shown once: the 24 words and the chain id. The words are " +
        "the only secret; the chain id only says which chain's blobs to look " +
        "for. Ziy stores derived keys, never this code in readable form.",
    };
  }

  const words = await validateMnemonic(payload.words.join(" "));
  if (payload.rotating_word && !/^[a-z]+$/.test(payload.rotating_word)) {
    throw Object.assign(new Error("The rotating word must be a single lowercase word."), {
      code: "bad-rotating-word",
    });
  }
  const rotatingWord = payload.rotating_word || (await fetchRotatingWord(payload.rotating_word_source_url)).word;

  // The chain id is NOT derived from the words: two chains made from the same
  // code must produce different keys, so it is fresh randomness, and it is the
  // HKDF salt (architecture §4.1). The value the code preview produced is
  // passed back in so the chain the user was shown is the chain that is created;
  // a caller that did not see one gets a fresh id.
  const chainId =
    typeof payload.chain_id === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(payload.chain_id)
      ? payload.chain_id
      : generateChainId();
  const identity = await generateDeviceIdentity();
  const deviceId = await exportPublicKey(identity.publicKey);
  const privateKeyB64 = await exportPrivateKey(identity.privateKey);

  // Brave's step: the words ARE the entropy, reversed to their 32 bytes.
  // No PBKDF2, no BIP-39 "seed" (replica/re-deep-sync.md sec.1).
  const ikm = await mnemonicToBytes(words);
  await store.storeSeed(ikm);
  // Persist the keypair so the browser can relaunch this agent and the device
  // is still the same device (lib/device-identity.js).
  await saveDeviceIdentity(store, { privateKeyPkcs8: privateKeyB64, deviceId });

  store.putChain({
    deviceId,
    deviceName: payload.device_name || "Ziy desktop",
    deviceType: payload.device_type || "desktop",
    chainId,
    createdAt: nowSeconds(),
  });

  // The private key never leaves the agent either; it is kept in memory for the
  // lifetime of this process and re-imported on the next launch from seed.enc.
  agent.identity = identity;
  agent.deviceId = deviceId;                 // what signed, on the wire
  agent.baseUrl = process.env.ZIY_SYNC_SERVER || null;
  agent.chainKeys = new ChainKeys(ikm, chainId, rotatingWord);
  agent.privateKeyB64 = privateKeyB64;

  return {
    step: "created",
    chain_id: chainId,
    device_id: deviceId,
    device_name: store.getChain().device_name,
    device_type: store.getChain().device_type,
    rotating_word_bucket: rotatingWord ? undefined : undefined,
    created_at: store.getChain().created_at,
    words_retained: false,
  };
}

/**
 * Join a chain from a code. A joining device does NOT make a new chain id — it
 * must derive the same one the creating device used, so the code carries it:
 * the code's words seed the HKDF master, and the chain id is the salt the other
 * device published. Ziy's chain code therefore has two halves:
 *
 *   words (24, BIP-39)  + chain id (16 bytes, base64url, NOT secret)
 *
 * Both are needed. Leaking one without the other is inert.
 */
export async function handleChainJoin(agent, store, payload) {
  if (store.hasChain() && !payload.force) {
    throw Object.assign(new Error("This device is already part of a chain. Leave it first."), {
      code: "chain-exists",
    });
  }
  const words = await validateMnemonic(payload.words.join(" "));
  const chainId = payload.chain_id;
  if (typeof chainId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(chainId)) {
    throw Object.assign(new Error("The chain code's chain id is missing or malformed."), {
      code: "bad-chain-id",
    });
  }
  const rotatingWord = payload.rotating_word || (await fetchRotatingWord(payload.rotating_word_source_url)).word;

  // Brave's step: the words ARE the entropy, reversed to their 32 bytes.
  // No PBKDF2, no BIP-39 "seed" (replica/re-deep-sync.md sec.1).
  const ikm = await mnemonicToBytes(words);
  await store.storeSeed(ikm);

  const identity = await generateDeviceIdentity();
  const deviceId = await exportPublicKey(identity.publicKey);
  const privateKeyB64 = await exportPrivateKey(identity.privateKey);
  await saveDeviceIdentity(store, { privateKeyPkcs8: privateKeyB64, deviceId });

  store.putChain({
    deviceId,
    deviceName: payload.device_name || "Ziy desktop",
    deviceType: payload.device_type || "desktop",
    chainId,
    createdAt: nowSeconds(),
  });

  agent.identity = identity;
  agent.deviceId = deviceId;                 // what signed, on the wire
  agent.baseUrl = process.env.ZIY_SYNC_SERVER || null;
  agent.chainKeys = new ChainKeys(ikm, chainId, rotatingWord);

  return {
    step: "joined",
    chain_id: chainId,
    device_id: deviceId,
    rotating_word_bucket: payload.rotating_word ? "operator-supplied" : undefined,
    joined_at: nowSeconds(),
  };
}

/** Local chain status. No network. */
export async function handleChainStatus(agent, store) {
  const chain = store.getChain();
  if (!chain) {
    return { in_chain: false, ready: await hasLiveSession(agent) };
  }
  return {
    in_chain: true,
    chain_id: chain.chain_id,
    device_id: chain.device_id,
    device_name: chain.device_name,
    device_type: chain.device_type,
    created_at: chain.created_at,
    last_sync_at: chain.last_sync_at,
    devices: store.listDevices(),
    categories: store.getCategoryToggles(),
    records: store.recordCount(),
    ready: await hasLiveSession(agent),
  };
}

/** True when this process holds a live key session (derived keys in memory). */
async function hasLiveSession(agent) {
  if (!agent.chainKeys) return false;
  // Touch the derivation so a stale key surfaces as "not ready" rather than
  // silently failing later.
  try {
    await agent.chainKeys.master();
    return true;
  } catch {
    return false;
  }
}

export { nowSeconds };
