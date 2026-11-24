import { describe, expect, it } from "vitest";
import { Serializer, utils } from "koilib";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  decodeDecimalsResult, decodeGetInfoResult, decodeGetPublicKeyResult, decodeStringResult, decodeUint64Result,
  encodeBalanceOfArgs, encodeMintArgs, encodeSetPublicKeyArgs, encodeTransferArgs, TOKEN_ENTRY, PQWALLET_ENTRY,
  decodeBoolResult, encodeBurnArgs, encodeGetAllowedCallerArgs, encodeSetAllowedCallerArgs, POB_ENTRY,
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
    const pq = new Serializer((pqwalletAbi.koilib_types ?? pqwalletAbi.types) as never);
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

  it("allowed-caller arguments and results match the contract ABI types", async () => {
    const pq = new Serializer((pqwalletAbi.koilib_types ?? pqwalletAbi.types) as never);
    for (const allowed of [true, false]) {
      expect(hex(encodeSetAllowedCallerArgs(A, allowed))).toBe(hex(await pq.serialize({ contract: A, allowed }, "set_allowed_caller_arguments")));
    }
    expect(hex(encodeGetAllowedCallerArgs(B))).toBe(hex(await pq.serialize({ contract: B }, "get_allowed_caller_arguments")));
    expect(decodeBoolResult(await pq.serialize({ value: true }, "get_allowed_caller_result"))).toBe(true);
    expect(decodeBoolResult(await pq.serialize({ value: false }, "get_allowed_caller_result"))).toBe(false);
    expect(decodeBoolResult(new Uint8Array(0))).toBe(false);
  });

  it("proof-of-burn arguments encode as koinos.contracts.pob.burn_arguments", async () => {
    // pob.proto: uint64 token_amount = 1; bytes burn_address = 2 (ADDRESS); bytes vhp_address = 3 (ADDRESS)
    const pob = new Serializer({ nested: { burn_arguments: { fields: {
      token_amount: { type: "uint64", id: 1, options: { jstype: "JS_STRING" } },
      burn_address: { type: "bytes", id: 2, options: { "(koinos.btype)": "ADDRESS" } },
      vhp_address: { type: "bytes", id: 3, options: { "(koinos.btype)": "ADDRESS" } },
    } } } } as never);
    for (const value of ["1", "100000000", "18446744073709551615"]) {
      expect(hex(encodeBurnArgs(BigInt(value), A, B))).toBe(hex(await pob.serialize({ token_amount: value, burn_address: A, vhp_address: B }, "burn_arguments")));
    }
    expect(() => encodeBurnArgs(-1n, A, B)).toThrow();
    expect(POB_ENTRY.burn).toBe(0x859facc5); // koinos-contracts-as contracts/pob/abi/pob.abi
  });

  it("entry points match the ABIs", () => {
    const ep = (m: Record<string, unknown> | undefined) => Number(m?.entry_point ?? m?.entryPoint ?? m?.["entry-point"]);
    const tm = (utils.tokenAbi.methods ?? {}) as Record<string, Record<string, unknown>>;
    expect(ep(tm.transfer)).toBe(TOKEN_ENTRY.transfer);
    expect(ep(tm.balanceOf)).toBe(TOKEN_ENTRY.balance_of);
    expect(ep(tm.mint)).toBe(TOKEN_ENTRY.mint);
    const pm = pqwalletAbi.methods as Record<string, Record<string, unknown>>;
    expect(ep(pm.set_public_key)).toBe(PQWALLET_ENTRY.set_public_key);
    expect(ep(pm.get_info)).toBe(PQWALLET_ENTRY.get_info);
    expect(ep(pm.get_public_key)).toBe(PQWALLET_ENTRY.get_public_key);
    expect(ep(pm.set_allowed_caller)).toBe(PQWALLET_ENTRY.set_allowed_caller);
    expect(ep(pm.get_allowed_caller)).toBe(PQWALLET_ENTRY.get_allowed_caller);
  });
});

describe("encoders and decoders against hostile input (pen test 2026-11-23)", () => {
  it("an encoder refuses anything that is not a 25-byte, checksummed address", async () => {
    const { encodeSetAllowedCallerArgs, encodeGetAllowedCallerArgs, encodeBurnArgs } = await import("../src/abi-lite");
    const GOOD = "1G2UuH9LEaHEJKs6hDKYunXVW6nBx3dze2";
    for (const bad of ["", "1111", "1G2UuH9LEaHEJKs6hDKYunXVW6nBx3dze3", "not base58 0OIl", GOOD + "1"]) {
      expect(() => encodeSetAllowedCallerArgs(bad, true), bad).toThrow(/not a valid Koinos address/);
      expect(() => encodeGetAllowedCallerArgs(bad), bad).toThrow(/not a valid Koinos address/);
      expect(() => encodeBurnArgs(1n, GOOD, bad), bad).toThrow(/not a valid Koinos address/);
      expect(() => encodeBurnArgs(1n, bad, GOOD), bad).toThrow(/not a valid Koinos address/);
    }
    expect(encodeSetAllowedCallerArgs(GOOD, true).length).toBe(2 + 25 + 2);
  });

  it("a bool sent twice reads as its last value, like the chain", async () => {
    const { decodeBoolResult } = await import("../src/abi-lite");
    expect(decodeBoolResult(Uint8Array.from([8, 0, 8, 1]))).toBe(true);
    expect(decodeBoolResult(Uint8Array.from([8, 1, 8, 0]))).toBe(false);
    expect(decodeBoolResult(new Uint8Array(0))).toBe(false);
  });
});
