import { type PqKeys } from "./keys.js";
export type AccountMode = "native" | "pqwallet";
export declare const CONTEXT_PQWALLET: Uint8Array<ArrayBufferLike> & Uint8Array<ArrayBuffer>;
export declare const CONTEXT_POP: Uint8Array<ArrayBufferLike> & Uint8Array<ArrayBuffer>;
export declare const CONTEXT_NATIVE: Uint8Array<ArrayBufferLike> & Uint8Array<ArrayBuffer>;
export declare const CONTEXT_MESSAGE: Uint8Array<ArrayBufferLike> & Uint8Array<ArrayBuffer>;
export declare const MAX_MESSAGE_BYTES: number;
/**
 * Proof of possession for registering the key on a pqwallet account: the ML-DSA key signs the
 * account's 25 address bytes under its own context, so a public key can only be registered by
 * whoever holds the matching secret key, and the proof cannot be reused as a transaction signature.
 */
export declare function proofOfPossession(accountAddressBytes: Uint8Array, keys: PqKeys): Uint8Array;
export declare const NATIVE_TAG = 1;
export declare const NATIVE_ENTRY_BYTES: number;
export declare function txIdBytes(txIdHex: string): Uint8Array;
/** Bytes to put in `transaction.signatures` for this account mode. */
export declare function signTxId(txIdHex: string, keys: PqKeys, mode: AccountMode): Uint8Array;
/**
 * A signed message in the account's entry format (pqwallet: the 2420-byte signature; native: 0x01 || pk || sig),
 * over the raw message bytes under "koinos/message/1". It cannot authorise a transaction.
 */
export declare function signMessageEntry(message: Uint8Array, keys: PqKeys, mode: AccountMode): Uint8Array;
/** Verifies a signed message against the account's key (for a pqwallet account, its registered key). */
export declare function verifyMessageEntry(entry: Uint8Array, message: Uint8Array, publicKey: Uint8Array, mode: AccountMode): boolean;
/** Local check before broadcasting: the entry verifies under the right context and no other. */
export declare function verifyEntry(entry: Uint8Array, txIdHex: string, publicKey: Uint8Array, mode: AccountMode): boolean;
