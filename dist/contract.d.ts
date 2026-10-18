import type { Abi } from "koilib";
import { PQWALLET_WASM_SHA256 } from "./contract-data.js";
export { PQWALLET_WASM_SHA256 };
export declare const PQWALLET_SOURCE = "koinos-pq dist/pqwallet.wasm (contract/assembly/Pqwallet.ts + wasm/dilithium.wasm, verify-only ML-DSA-44)";
export declare const pqwalletAbi: Abi;
/** The contract bytecode, hash-checked. Throws rather than returning anything that does not match. */
export declare function loadPqwalletBytecode(): Promise<Uint8Array>;
