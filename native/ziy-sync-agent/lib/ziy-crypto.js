/**
 * Bridge so the native agent and the server import the SAME source as the
 * extension, rather than a copy that can drift.
 *
 * Relative path from native/ziy-sync-agent/lib/ to extensions/ziy-sync/lib/.
 * Verified by test/native-protocol.test.mjs, which derives a key in the
 * extension's module and in the agent's and asserts the bytes are equal.
 *
 * tools/install-ziy-sync-native.js rewrites these relative paths to the repo's
 * absolute path when the agent is installed under ~/.ziy/native, so the
 * installed agent never depends on a path outside its own directory.
 */
export * from "../../../extensions/ziy-sync/lib/bip39.js";
export * from "../../../extensions/ziy-sync/lib/keyderivation.js";
export * from "../../../extensions/ziy-sync/lib/record.js";
// The protocol client, so the agent's HTTP calls and the extension's share one
// implementation of every endpoint and every field name.
export * from "../../../extensions/ziy-sync/lib/client.js";
