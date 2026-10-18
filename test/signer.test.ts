import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { utils } from "koilib";
import { deriveKeys } from "../src/keys";
import { NATIVE_ENTRY_BYTES, verifyEntry, verifyMessageEntry } from "../src/sign";
import { parseKoin } from "../src/chain";
import { encodeTransferArgs } from "../src/abi-lite";
import { PqSigner } from "../src/signer";

const keys = deriveKeys(sha256(utf8ToBytes("koinos-pq native vector key A")));
const digest = sha256(utf8ToBytes("some transaction header"));
const txId = "0x1220" + bytesToHex(digest);

describe("PqSigner (koilib-compatible)", () => {
  it("native: address is the key's, entries are 3733 bytes and verify", async () => {
    const s = PqSigner.native(keys);
    expect(s.getAddress()).toBe(keys.address);
    const e32 = await s.signHash(digest);
    const e34 = await s.signHash(utils.toUint8Array(txId.slice(2)));
    expect(e32.length).toBe(3733);
    expect(verifyEntry(e32, txId, keys.publicKey, "native")).toBe(true);
    expect(verifyEntry(e34, txId, keys.publicKey, "native")).toBe(true);
    await expect(s.signHash(new Uint8Array(31))).rejects.toThrow();
  });

  it("pqwallet: authorises the account address with a raw 2420-byte signature", async () => {
    const account = "1FqXVbjZnMo2cUNj56LNCrc8R22RWDmq1t";
    const s = PqSigner.pqwallet(keys, account);
    expect(s.getAddress()).toBe(account);
    const tx = { id: txId, header: { payer: account }, operations: [], signatures: [] as string[] };
    const signed = await s.signTransaction(tx);
    expect(signed.signatures?.length).toBe(1);
    const entry = utils.decodeBase64url(signed.signatures![0]!);
    expect(entry.length).toBe(2420);
    expect(verifyEntry(entry, txId, keys.publicKey, "pqwallet")).toBe(true);
    expect(verifyEntry(entry, txId, keys.publicKey, "native")).toBe(false);
  });

  it("refuses a native signer for a foreign address, and block signing", async () => {
    expect(() => new PqSigner(keys, "native", "1FqXVbjZnMo2cUNj56LNCrc8R22RWDmq1t")).toThrow();
    await expect(PqSigner.native(keys).signBlock()).rejects.toThrow(/block/);
  });

  it("signMessage uses the message context: verifies as a message, never as a transaction", async () => {
    for (const mode of ["native", "pqwallet"] as const) {
      const s = mode === "native" ? PqSigner.native(keys) : PqSigner.pqwallet(keys, "1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ");
      const sig = await s.signMessage("hello koinos");
      expect(sig.length).toBe(mode === "native" ? NATIVE_ENTRY_BYTES : 2420);
      expect(verifyMessageEntry(sig, utf8ToBytes("hello koinos"), keys.publicKey, mode)).toBe(true);
      expect(verifyMessageEntry(sig, utf8ToBytes("hello koinoz"), keys.publicKey, mode)).toBe(false);
      // the attack the old design allowed: the page passes a transaction header (or its hash) as the "message"
      const asTxId = "0x1220" + bytesToHex(sha256(utf8ToBytes("hello koinos")));
      expect(verifyEntry(sig, asTxId, keys.publicKey, mode)).toBe(false);
    }
  });

  it("amounts above uint64 are refused instead of wrapping on the chain", () => {
    expect(parseKoin("184467440737.09551615")).toBe(0xffffffffffffffffn);
    expect(() => parseKoin("184467440737.09551616")).toThrow(/larger/);
    const A = "1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ";
    expect(() => encodeTransferArgs(A, A, 0x10000000000000000n)).toThrow(/uint64/);
    expect(() => encodeTransferArgs(A, A, -1n)).toThrow(/uint64/);
  });

  it("a transaction signature does not verify as a signed message", async () => {
    const id = utils.toUint8Array(txId.slice(2));
    const entry = await PqSigner.native(keys).signHash(id);
    expect(verifyMessageEntry(entry, id, keys.publicKey, "native")).toBe(false);
  });
});
