// The koinos-pq account contract, embedded as data so any bundler (or none) can ship it.
//
// PROVENANCE: byte for byte the artefact in koinos-pq/dist (github.com/Justyoureverydaynormalguybob/koinos-pq,
// dist/SHA256SUMS), the build that ran the Harbinger life cycle in that repo's docs/TESTING.md and the
// mainnet account 1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ. Verified against the recorded hash on every load, so a
// corrupted or swapped copy can never reach the chain. Regenerate contract-data.ts from dist/ when the
// contract changes, and update the hash here through that file only.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PQWALLET_ABI, PQWALLET_WASM_BASE64, PQWALLET_WASM_SHA256 } from "./contract-data";
export { PQWALLET_WASM_SHA256 };
export const PQWALLET_SOURCE = "koinos-pq dist/pqwallet.wasm (contract/assembly/Pqwallet.ts + wasm/dilithium.wasm, verify-only ML-DSA-44)";
export const pqwalletAbi = PQWALLET_ABI;
function base64ToBytes(b64) {
    if (typeof atob === "function") {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            out[i] = bin.charCodeAt(i);
        return out;
    }
    // Node without atob (very old); Buffer is available there
    return new Uint8Array(globalThis.Buffer.from(b64, "base64"));
}
let cached = null;
/** The contract bytecode, hash-checked. Throws rather than returning anything that does not match. */
export async function loadPqwalletBytecode() {
    if (cached)
        return cached;
    const bytes = base64ToBytes(PQWALLET_WASM_BASE64);
    const digest = bytesToHex(sha256(bytes));
    if (digest !== PQWALLET_WASM_SHA256)
        throw new Error("bundled contract does not match its recorded hash; refusing to upload");
    cached = bytes;
    return bytes;
}
