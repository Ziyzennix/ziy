/**
 * BIP-39 mnemonic + seed derivation tests.
 *
 * The BIP-39 test vectors are the ones the spec itself points at:
 *   https://github.com/trezor/python-mnemonic/blob/master/vectors.json
 * with the passphrase "TREZOR" used for all vectors (spec, "Test vectors").
 * The 24-word vector below is copied from that file.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validateMnemonic,
  generateMnemonic,
  mnemonicToSeed,
  entropyToMnemonic,
  sha256,
  ROTATING_WORD_CONFIG,
  rotatingWordBucket,
} from "../lib/bip39.js";
import WORDLIST from "../lib/bip39-wordlist.js";

// Canonical wordlist, fetched from the BIP-39 repo and kept as a fixture.
const canonicalPath = new URL("./fixtures/bip39-english.txt", import.meta.url);
const canonical = fs
  .readFileSync(canonicalPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

test("wordlist is exactly the canonical BIP-39 English list", () => {
  assert.equal(WORDLIST.length, 2048);
  assert.equal(canonical.length, 2048);
  for (let i = 0; i < 2048; i++) {
    assert.equal(WORDLIST[i], canonical[i], `word ${i} differs`);
  }
  // BIP-39: "wordlists is sorted which allows for efficient lookup"
  const sorted = [...WORDLIST].sort();
  assert.deepEqual(WORDLIST, sorted);
});

test("BIP-39 24-word vectors: all of them, entropy -> mnemonic -> seed", async () => {
  // Every 24-word row of trezor/python-mnemonic/vectors.json (the file the spec
  // cites under "Test vectors"). One passing vector can hide a bug that only
  // another byte pattern trips, so they are all asserted here. There are eight.
  const vectors = [
    ["0000000000000000000000000000000000000000000000000000000000000000",
     "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
     "bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8"],
    ["7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
     "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
     "bc09fca1804f7e69da93c2f2028eb238c227f2e9dda30cd63699232578480a4021b146ad717fbb7e451ce9eb835f43620bf5c514db0f8add49f5d121449d3e87"],
    ["8080808080808080808080808080808080808080808080808080808080808080",
     "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless",
     "c0c519bd0e91a2ed54357d9d1ebef6f5af218a153624cf4f2da911a0ed8f7a09e2ef61af0aca007096df430022f7a2b6fb91661a9589097069720d015e4e982f"],
    ["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
     "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote",
     "dd48c104698c30cfe2b6142103248622fb7bb0ff692eebb00089b32d22484e1613912f0a5b694407be899ffd31ed3992c456cdf60f5d4564b8ba3f05a69890ad"],
    ["68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c",
     "hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length",
     "64c87cde7e12ecf6704ab95bb1408bef047c22db4cc7491c4271d170a1b213d20b385bc1588d9c7b38f1b39d415665b8a9030c9ec653d75e65f847d8fc1fc440"],
    ["9f6a2878b2520799a44ef18bc7df394e7061a224d2c33cd015b157d746869863",
     "panda eyebrow bullet gorilla call smoke muffin taste mesh discover soft ostrich alcohol speed nation flash devote level hobby quick inner drive ghost inside",
     "72be8e052fc4919d2adf28d5306b5474b0069df35b02303de8c1729c9538dbb6fc2d731d5f832193cd9fb6aeecbc469594a70e3dd50811b5067f3b88b28c3e8d"],
    ["066dca1a2bb7e8a1db2832148ce9933eea0f3ac9548d793112d9a95c9407efad",
     "all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform",
     "26e975ec644423f4a4c4f4215ef09b4bd7ef924e85d1d17c4cf3f136c2863cf6df0a475045652c57eb5fb41513ca2a2d67722b77e954b4b3fc11f7590449191d"],
    ["f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f",
     "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold",
     "01f5bced59dec48e362f2c45b5de68b9fd6c92c6634f44d6d40aab69056506f0e35524a518034ddc1192e1dacd32c1ed3eaa3c3b131c88ed8e7e54c49a5d0998"],
  ];
  for (const [entropyHex, mnemonic, expectedSeed] of vectors) {
    const words = await entropyToMnemonic(Uint8Array.from(Buffer.from(entropyHex, "hex")));
    assert.equal(words.join(" "), mnemonic, `mnemonic for entropy ${entropyHex}`);
    const seed = Buffer.from(await mnemonicToSeed(mnemonic, "TREZOR")).toString("hex");
    assert.equal(seed, expectedSeed, `seed for entropy ${entropyHex}`);
    // And the checksum round-trip: the published mnemonic must validate.
    await assert.doesNotReject(() => validateMnemonic(mnemonic), `validate ${mnemonic}`);
  }
});

test("mnemonicToSeed is deterministic and 64 bytes", async () => {
  const words = await generateMnemonic();
  const a = await mnemonicToSeed(words.join(" "));
  const b = await mnemonicToSeed(words.join(" "));
  assert.equal(a.length, 64);
  assert.deepEqual(a, b);
});

test("validateMnemonic accepts a generated code and rejects tampering", async () => {
  const words = await generateMnemonic();
  await assert.doesNotReject(() => validateMnemonic(words.join(" ")));

  // Flip one word to another valid word: the checksum must fail.
  const tampered = [...words];
  const replacement = tampered[0] === "zoo" ? "abandon" : "zoo";
  tampered[0] = replacement;
  await assert.rejects(() => validateMnemonic(tampered.join(" ")), /checksum/i);
});

test("validateMnemonic rejects the wrong word count", async () => {
  await assert.rejects(() => validateMnemonic("abandon abandon abandon"), /24 words/);
  const words = await generateMnemonic();
  await assert.rejects(() => validateMnemonic([...words, "about"].join(" ")), /24 words/);
});

test("validateMnemonic rejects a word not in the wordlist", async () => {
  await assert.rejects(() => validateMnemonic("notaword ".repeat(24)), /not in the BIP-39 word list/);
});

test("SHA-256 matches a known vector", async () => {
  const digest = Buffer.from(await sha256(new TextEncoder().encode("abc"))).toString("hex");
  assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("rotating word bucket is the UTC day", () => {
  assert.equal(rotatingWordBucket(new Date("2026-10-14T23:30:00Z")), "2026-10-14");
  assert.equal(rotatingWordBucket(new Date("2026-10-14T00:00:01Z")), "2026-10-14");
  assert.equal(rotatingWordBucket(new Date("2027-01-01T12:00:00Z")), "2027-01-01");
});

test("rotating word source is configurable and reported", () => {
  assert.equal(typeof ROTATING_WORD_CONFIG.defaultSourceUrl, "string");
  assert.match(ROTATING_WORD_CONFIG.defaultSourceUrl, /^https:\/\//);
  assert.equal(ROTATING_WORD_CONFIG.bucketKind, "utc-day");
});
