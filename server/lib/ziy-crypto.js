/**
 * Bridge so the server imports the SAME crypto source as the extension and the
 * native agent, rather than a copy that can drift. The server's own tests use
 * this to build signed records the server then has to accept, which is the only
 * honest way to test a blind store: construct a real client, exercise the real
 * protocol, and then show that the server learned nothing from the payload.
 */
export * from "../../extensions/ziy-sync/lib/bip39.js";
export * from "../../extensions/ziy-sync/lib/keyderivation.js";
export * from "../../extensions/ziy-sync/lib/record.js";
