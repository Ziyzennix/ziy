/**
 * ops-info: what this build can do. The options page reads it to show honest
 * capability rows ("device signatures: Ed25519", "record cipher: AES-256-GCM")
 * instead of hard-coded marketing strings that can drift from reality.
 */

export async function handleCapabilities(agent, payload) {
  const algorithms = [];
  const probe = async (name, fn) => {
    try {
      await fn();
      algorithms.push({ name, available: true });
    } catch (error) {
      algorithms.push({ name, available: false, reason: error.message });
    }
  };

  await probe("Ed25519", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new Uint8Array([1, 2, 3]));
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, pair.publicKey, sig, new Uint8Array([1, 2, 3]));
    if (!ok) throw new Error("verify failed");
  });
  await probe("HKDF-SHA256", async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(16), info: new Uint8Array(0) },
      key,
      256,
    );
    if (bits.byteLength !== 32) throw new Error("wrong length");
  });
  await probe("PBKDF2-HMAC-SHA512", async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(8), "PBKDF2", false, ["deriveBits"]);
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: new Uint8Array(8), iterations: 2048, hash: "SHA-512" },
      key,
      512,
    );
  });
  await probe("AES-256-GCM", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new Uint8Array([1]), tagLength: 128 }, key, new Uint8Array([1]));
    await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new Uint8Array([1]), tagLength: 128 }, key, ct);
  });

  return {
    agent: "ziy-sync-agent",
    protocol: "native-messaging stdio, UInt32LE length prefix, JSON payloads (MDN)",
    storage: "node:sqlite (native SQLite, no npm dependency)",
    key_derivation: "BIP39 PBKDF2-HMAC-SHA512 (2048 rounds) -> HKDF-SHA256 per chain/category",
    device_auth: "Ed25519",
    record_cipher: "AES-256-GCM, 96-bit nonce, AAD-bound to (category, record_id, updated_at)",
    algorithms,
  };
}
