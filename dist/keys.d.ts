import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Signer } from "koilib";
export declare const SEED_BYTES = 32;
export declare const PK_BYTES = 1312;
export declare const SK_BYTES = 2560;
export declare const SIG_BYTES = 2420;
export interface PqKeys {
    seed: Uint8Array;
    publicKey: Uint8Array;
    secretKey: Uint8Array;
    /** base58 Koinos address of the ML-DSA-44 key (the native-path account) */
    address: string;
}
export declare function newMnemonic(): string;
export declare function normalizeMnemonic(input: string): string;
export declare function isMnemonic(input: string): boolean;
export declare function mnemonicToSeed(mnemonic: string): Uint8Array;
export declare function seedToMnemonic(seed: Uint8Array): string;
/** Accepts the CLI's 64-hex seed or a 24-word phrase. */
export declare function parseSeedInput(input: string): Uint8Array;
export declare function deriveKeys(seed: Uint8Array): PqKeys;
/** Address for any ML-DSA-44 public key, the same bytes the node derives. */
export declare function addressOf(publicKey: Uint8Array): string;
/**
 * The one-time secp256k1 key a contract-route (pqwallet) account is created with. Derived from the
 * seed through a domain tag so it can never be confused with the seed itself. Only needed to upload
 * and register; after `lock` it has no power over the account.
 */
export declare function bootstrapSigner(seed: Uint8Array): Signer;
export declare function wipe(...arrays: Uint8Array[]): void;
export { bytesToHex, hexToBytes };
