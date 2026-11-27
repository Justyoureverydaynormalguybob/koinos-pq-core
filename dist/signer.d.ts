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
    readonly chainId?: string | undefined;
    provider?: Provider;
    /**
     * @param keys     the ML-DSA-44 key pair
     * @param mode     "native" (the key's own address, 3733-byte entries) or "pqwallet" (an account running the
     *                 koinos-pq contract with this key registered, raw 2420-byte signatures)
     * @param account  the address this signer authorises; for "native" it must be the key's address
     * @param chainId  the chain every transaction this signer prepares or signs must be for (base64url, as
     *                 in the header). PASS IT: an account has the same address and key on every Koinos
     *                 network, and without it prepareTransaction takes the chain id from the node, so a
     *                 node that lies gets a signature another chain accepts. `await new Chain(net).chainId()`
     *                 gives the pinned one.
     */
    constructor(keys: PqKeys, mode: AccountMode, account: string, provider?: Provider, chainId?: string | undefined);
    static native(keys: PqKeys, provider?: Provider, chainId?: string): PqSigner;
    static pqwallet(keys: PqKeys, accountAddress: string, provider?: Provider, chainId?: string): PqSigner;
    getAddress(): string;
    /**
     * The bytes that go into `transaction.signatures` for this account. `hash` is the 32-byte digest or the 34-byte multihash.
     *
     * This signs WHATEVER digest it is given, as a transaction id: nothing here can tell what transaction,
     * or which chain, the digest stands for. It exists because koilib's signer interface has it. Never hand
     * it a digest that came from somewhere else (a page, a file, a peer); use signTransaction, which works
     * the id out from the header and the operations itself.
     */
    signHash(hash: Uint8Array): Promise<Uint8Array>;
    /**
     * Signs the message bytes under the "koinos/message/1" context (see sign.ts), so a signed message can
     * never be used as a transaction signature. Note for dapps: unlike a secp256k1 signature, no public key
     * can be recovered from this; verify it with verifyMessageEntry against the account's key.
     */
    signMessage(message: string | Uint8Array): Promise<Uint8Array>;
    private checkChain;
    /**
     * Fills in what the header lacks (nonce, mana limit, chain id), then the merkle root and the id. With a
     * `chainId` given to the signer, that is the chain id used, and a transaction that names another is
     * refused; without one the node's answer is taken (see the constructor).
     */
    prepareTransaction(tx: TxLike): Promise<TxLike>;
    /**
     * Appends this account's signature entry. Prepares the transaction first if it has no id yet.
     *
     * A transaction that arrives with an id is not taken at its word: the merkle root is worked out again
     * from the operations and the id from the header, and anything that does not match is refused. So the
     * bytes signed are always the id of the header and operations in `tx`, never a number someone supplied.
     */
    signTransaction(tx: TxLike): Promise<TransactionJson>;
    /** The id of `tx`, recomputed from its header and operations; throws when it is not the id `tx` carries. */
    private checkedId;
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
