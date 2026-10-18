import { type Provider, type TransactionJson } from "koilib";
import type { PqKeys } from "./keys.js";
import { type AccountMode } from "./sign.js";
type Hex = string;
type TxLike = TransactionJson & {
    id?: Hex;
    wait?: (type?: "byTransactionId" | "byBlock", timeout?: number) => Promise<unknown>;
};
export declare class PqSigner {
    readonly keys: PqKeys;
    readonly mode: AccountMode;
    readonly account: string;
    provider?: Provider;
    /**
     * @param keys     the ML-DSA-44 key pair
     * @param mode     "native" (the key's own address, 3733-byte entries) or "pqwallet" (an account running the
     *                 koinos-pq contract with this key registered, raw 2420-byte signatures)
     * @param account  the address this signer authorises; for "native" it must be the key's address
     */
    constructor(keys: PqKeys, mode: AccountMode, account: string, provider?: Provider);
    static native(keys: PqKeys, provider?: Provider): PqSigner;
    static pqwallet(keys: PqKeys, accountAddress: string, provider?: Provider): PqSigner;
    getAddress(): string;
    /** The bytes that go into `transaction.signatures` for this account. `hash` is the 32-byte digest or the 34-byte multihash. */
    signHash(hash: Uint8Array): Promise<Uint8Array>;
    /**
     * Signs sha2-256(message) the same way a transaction id is signed. Note for dapps: unlike a secp256k1
     * signature, no public key can be recovered from this; verify it against the account's registered key.
     */
    signMessage(message: string | Uint8Array): Promise<Uint8Array>;
    prepareTransaction(tx: TxLike): Promise<TxLike>;
    /** Appends this account's signature entry. Prepares the transaction first if it has no id yet. */
    signTransaction(tx: TxLike): Promise<TransactionJson>;
    sendTransaction(tx: TxLike, options?: {
        broadcast?: boolean;
    }): Promise<{
        receipt: Record<string, unknown>;
        transaction: TxLike;
    }>;
    prepareBlock(): Promise<never>;
    signBlock(): Promise<never>;
}
export {};
