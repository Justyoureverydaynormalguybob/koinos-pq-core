import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { utils } from "koilib";
import { deriveKeys } from "../src/keys";
import { CONTEXT_POP, CONTEXT_PQWALLET, proofOfPossession } from "../src/sign";
import { activationOperations, bootstrapAddress, setupCostsFromPrices } from "../src/setup";
import { PQWALLET_WASM_SHA256, loadPqwalletBytecode, pqwalletAbi as abi } from "../src/contract";
import { PQWALLET_ENTRY, decodeFields } from "../src/abi-lite";

const keys = deriveKeys(sha256(utf8ToBytes("koinos-pq native vector key A")));

describe("pqwallet account setup", () => {
  it("proof of possession signs the 25 address bytes under koinos/pqwallet/1/pop only", () => {
    const account = bootstrapAddress(keys);
    const addr = utils.decodeBase58(account);
    expect(addr.length).toBe(25);
    const proof = proofOfPossession(addr, keys);
    expect(proof.length).toBe(2420);
    expect(ml_dsa44.verify(proof, addr, keys.publicKey, { context: CONTEXT_POP })).toBe(true);
    expect(ml_dsa44.verify(proof, addr, keys.publicKey, { context: CONTEXT_PQWALLET })).toBe(false);
    expect(() => proofOfPossession(addr.subarray(0, 24), keys)).toThrow();
  });

  it("bootstrap address is deterministic and is not the post-quantum address", () => {
    expect(bootstrapAddress(keys)).toBe(bootstrapAddress(keys));
    expect(bootstrapAddress(keys)).not.toBe(keys.address);
    expect(utils.isChecksumAddress(bootstrapAddress(keys))).toBe(true);
  });

  it("bundled contract matches its recorded hash and the ABI is koilib-shaped", async () => {
    const wasm = await loadPqwalletBytecode();
    expect(wasm.length).toBe(62266);
    expect(bytesToHex(sha256(wasm))).toBe(PQWALLET_WASM_SHA256);
    const methods = (abi as { methods: Record<string, { entry_point?: number; read_only?: boolean }> }).methods;
    expect(methods.set_public_key?.entry_point).toBe(0x4cc6c61b);
    expect(methods.get_info?.read_only).toBe(true);
    expect(methods.get_public_key?.entry_point).toBe(0x96634f68);
  });

  it("activation is one transaction: install locked, then register this key with a valid proof", async () => {
    const account = bootstrapAddress(keys);
    const wasm = await loadPqwalletBytecode();
    const ops = activationOperations(account, keys, wasm);
    expect(ops.length).toBe(2);
    const up = ops[0]!.upload_contract as Record<string, unknown>;
    expect(Object.keys(ops[0]!)).toEqual(["upload_contract"]);
    expect(up.contract_id).toBe(account);
    expect(up.authorizes_call_contract && up.authorizes_transaction_application && up.authorizes_upload_contract).toBe(true);
    expect(bytesToHex(sha256(utils.decodeBase64url(up.bytecode as string)))).toBe(PQWALLET_WASM_SHA256);
    const cc = ops[1]!.call_contract as { contract_id: string; entry_point: number; args: string };
    expect(cc.contract_id).toBe(account);
    expect(cc.entry_point).toBe(PQWALLET_ENTRY.set_public_key);
    const f = decodeFields(utils.decodeBase64url(cc.args));
    const pk = f.get(1)?.[0] as Uint8Array, proof = f.get(2)?.[0] as Uint8Array;
    expect(bytesToHex(pk)).toBe(bytesToHex(keys.publicKey));
    expect(ml_dsa44.verify(proof, utils.decodeBase58(account), keys.publicKey, { context: CONTEXT_POP })).toBe(true);
  });

  it("costs are priced from the live resource market (prices seen 2026-10-18)", () => {
    const koin = (rc: bigint) => Number(rc) / 1e8;
    // Harbinger: the model (5.45 / 0.54 before margin) must bracket what the chain actually charged (5.07 / 0.35)
    const t = setupCostsFromPrices({ disk: 6965n, network: 1054n, compute: 6n });
    expect(koin(t.deployRc)).toBeGreaterThan(5.07);
    expect(koin(t.deployRc)).toBeLessThan(8);
    expect(koin(t.registerRc)).toBeGreaterThan(0.35);
    expect(koin(t.registerRc)).toBeLessThan(1);
    // mainnet is about nine times dearer: around 60 KOIN of mana for the upload, 5.6 for the registration
    const m = setupCostsFromPrices({ disk: 61740n, network: 9340n, compute: 48n });
    expect(koin(m.deployRc)).toBeGreaterThan(55);
    expect(koin(m.deployRc)).toBeLessThan(65);
    expect(koin(m.registerRc)).toBeGreaterThan(5);
    expect(koin(m.registerRc)).toBeLessThan(6.5);
    expect(m.requiredMana).toBe(m.deployRc + m.registerRc);
    // devnet (10 / 5 / 1) stays small
    const d = setupCostsFromPrices({ disk: 10n, network: 5n, compute: 1n });
    expect(d.requiredMana).toBeLessThan(20_000_000n);
  });
});
