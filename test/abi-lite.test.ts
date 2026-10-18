import { describe, expect, it } from "vitest";
import { Serializer, utils } from "koilib";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  decodeDecimalsResult, decodeGetInfoResult, decodeGetPublicKeyResult, decodeStringResult, decodeUint64Result,
  encodeBalanceOfArgs, encodeMintArgs, encodeSetPublicKeyArgs, encodeTransferArgs, TOKEN_ENTRY, PQWALLET_ENTRY,
} from "../src/abi-lite";
import { pqwalletAbi } from "../src/contract";

const A = "1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ", B = "1sXttKzfrzH8amTpfRHX8SXT7kynjNpMX";
const hex = (u: Uint8Array) => bytesToHex(u);

describe("abi-lite agrees with koilib's serializer", () => {
  const token = new Serializer(utils.tokenAbi.koilib_types!);

  it("token arguments encode to the same bytes", async () => {
    for (const value of ["1", "100000000", "6355894361840623", "18446744073709551615"]) {
      const ours = encodeTransferArgs(A, B, BigInt(value));
      const theirs = await token.serialize({ from: A, to: B, value }, "transfer_arguments");
      expect(hex(ours)).toBe(hex(theirs));
    }
    expect(hex(encodeMintArgs(A, 1000n * 100000000n))).toBe(hex(await token.serialize({ to: A, value: "100000000000" }, "mint_arguments")));
    expect(hex(encodeBalanceOfArgs(B))).toBe(hex(await token.serialize({ owner: B }, "balance_of_arguments")));
    expect(hex(encodeTransferArgs(A, B, 0n))).toBe(hex(await token.serialize({ from: A, to: B, value: "0" }, "transfer_arguments")));
  });

  it("token results decode what koilib encodes", async () => {
    expect(decodeUint64Result(await token.serialize({ value: "20900000000" }, "balance_of_result"))).toBe(20900000000n);
    expect(decodeUint64Result(await token.serialize({ value: "0" }, "balance_of_result"))).toBe(0n);
    expect(decodeStringResult(await token.serialize({ value: "Koin" }, "name_result"))).toBe("Koin");
    expect(decodeDecimalsResult(await token.serialize({ value: 8 }, "decimals_result"))).toBe(8);
    expect(decodeUint64Result(new Uint8Array(0))).toBe(0n); // empty message = default
  });

  it("pqwallet arguments and results match the contract ABI types", async () => {
    const pq = new Serializer(pqwalletAbi.koilib_types!);
    const pk = Uint8Array.from({ length: 1312 }, (_, i) => i & 0xff), proof = Uint8Array.from({ length: 2420 }, (_, i) => (i * 7) & 0xff);
    const ours = encodeSetPublicKeyArgs(pk, proof);
    const theirs = await pq.serialize({ public_key: utils.encodeBase64url(pk), proof: utils.encodeBase64url(proof) }, "set_public_key_arguments");
    expect(hex(ours)).toBe(hex(theirs));
    const info = await pq.serialize({ scheme: "ML-DSA-44 (FIPS 204), pure mode", public_key_bytes: 1312, signature_bytes: 2420, context: "koinos/pqwallet/1", key_registered: true }, "get_info_result");
    expect(decodeGetInfoResult(info)).toEqual({ scheme: "ML-DSA-44 (FIPS 204), pure mode", publicKeyBytes: 1312, signatureBytes: 2420, context: "koinos/pqwallet/1", keyRegistered: true });
    const unreg = await pq.serialize({ scheme: "x", public_key_bytes: 1312, signature_bytes: 2420, context: "c", key_registered: false }, "get_info_result");
    expect(decodeGetInfoResult(unreg).keyRegistered).toBe(false);
    const gpk = await pq.serialize({ value: utils.encodeBase64url(pk) }, "get_public_key_result");
    expect(hex(decodeGetPublicKeyResult(gpk)!)).toBe(hex(pk));
    expect(decodeGetPublicKeyResult(new Uint8Array(0))).toBeNull();
  });

  it("entry points match the ABIs", () => {
    const m = (utils.tokenAbi.methods ?? {}) as Record<string, { entry_point?: number }>;
    expect(m.transfer?.entry_point).toBe(TOKEN_ENTRY.transfer);
    expect(m.balance_of?.entry_point).toBe(TOKEN_ENTRY.balance_of);
    expect(m.mint?.entry_point).toBe(TOKEN_ENTRY.mint);
    const p = pqwalletAbi.methods as Record<string, { entry_point?: number }>;
    expect(p.set_public_key?.entry_point).toBe(PQWALLET_ENTRY.set_public_key);
    expect(p.get_info?.entry_point).toBe(PQWALLET_ENTRY.get_info);
    expect(p.get_public_key?.entry_point).toBe(PQWALLET_ENTRY.get_public_key);
  });
});
