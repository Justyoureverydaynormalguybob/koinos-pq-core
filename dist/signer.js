// A koilib-compatible signer for ML-DSA-44 accounts, so anything built on koilib's Signer interface
// (Contract calls, dapp provider flows, the Kondor-style `getSigner(address)` API) can use a
// post-quantum account without knowing how its signature is made.
import { Transaction, utils } from "koilib";
import { signMessageEntry, signTxId } from "./sign.js";
const TX_ID_PREFIX = new Uint8Array([0x12, 0x20]); // sha2-256 multihash header
export class PqSigner {
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
    constructor(keys, mode, account, provider, chainId) {
        this.keys = keys;
        this.mode = mode;
        this.account = account;
        this.chainId = chainId;
        if (mode === "native" && account !== keys.address)
            throw new Error("a native signer's account is the key's own address");
        this.provider = provider;
    }
    static native(keys, provider, chainId) {
        return new PqSigner(keys, "native", keys.address, provider, chainId);
    }
    static pqwallet(keys, accountAddress, provider, chainId) {
        return new PqSigner(keys, "pqwallet", accountAddress, provider, chainId);
    }
    getAddress() {
        return this.account;
    }
    /**
     * The bytes that go into `transaction.signatures` for this account. `hash` is the 32-byte digest or the 34-byte multihash.
     *
     * This signs WHATEVER digest it is given, as a transaction id: nothing here can tell what transaction,
     * or which chain, the digest stands for. It exists because koilib's signer interface has it. Never hand
     * it a digest that came from somewhere else (a page, a file, a peer); use signTransaction, which works
     * the id out from the header and the operations itself.
     */
    async signHash(hash) {
        let id;
        if (hash.length === 34 && hash[0] === 0x12 && hash[1] === 0x20)
            id = hash;
        else if (hash.length === 32) {
            id = new Uint8Array(34);
            id.set(TX_ID_PREFIX, 0);
            id.set(hash, 2);
        }
        else
            throw new Error("expected a 32-byte sha2-256 digest or a 34-byte multihash");
        return signTxId("0x" + utils.toHexString(id), this.keys, this.mode);
    }
    /**
     * Signs the message bytes under the "koinos/message/1" context (see sign.ts), so a signed message can
     * never be used as a transaction signature. Note for dapps: unlike a secp256k1 signature, no public key
     * can be recovered from this; verify it with verifyMessageEntry against the account's key.
     */
    async signMessage(message) {
        const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
        return signMessageEntry(bytes, this.keys, this.mode);
    }
    checkChain(chainId) {
        if (this.chainId !== undefined && chainId !== this.chainId)
            throw new Error("the transaction is for a different chain than this signer was made for; not signed");
    }
    /**
     * Fills in what the header lacks (nonce, mana limit, chain id), then the merkle root and the id. With a
     * `chainId` given to the signer, that is the chain id used, and a transaction that names another is
     * refused; without one the node's answer is taken (see the constructor).
     */
    async prepareTransaction(tx) {
        if (!this.provider)
            throw new Error("signer has no provider");
        tx.header = tx.header ?? {};
        if (!tx.header.payer)
            tx.header.payer = this.account;
        if (this.chainId !== undefined) {
            if (tx.header.chain_id)
                this.checkChain(tx.header.chain_id);
            else
                tx.header.chain_id = this.chainId;
        }
        await Transaction.prepareTransaction(tx, this.provider, this.account);
        return tx;
    }
    /**
     * Appends this account's signature entry. Prepares the transaction first if it has no id yet.
     *
     * A transaction that arrives with an id is not taken at its word: the merkle root is worked out again
     * from the operations and the id from the header, and anything that does not match is refused. So the
     * bytes signed are always the id of the header and operations in `tx`, never a number someone supplied.
     */
    async signTransaction(tx) {
        if (!tx.id)
            await this.prepareTransaction(tx);
        const id = await this.checkedId(tx);
        const entry = await this.signHash(utils.toUint8Array(id.replace(/^0x/, "")));
        tx.signatures = [...(tx.signatures ?? []), utils.encodeBase64url(entry)];
        return tx;
    }
    /** The id of `tx`, recomputed from its header and operations; throws when it is not the id `tx` carries. */
    async checkedId(tx) {
        const h = tx.header;
        if (!h || h.nonce === undefined || h.rc_limit === undefined || !h.chain_id || !h.payer || !h.operation_merkle_root) {
            throw new Error("the transaction has an id but not a complete header; not signed");
        }
        this.checkChain(h.chain_id);
        const copy = { header: { ...h }, operations: tx.operations ?? [] };
        await Transaction.prepareTransaction(copy, undefined, h.payer); // every field is present, so nothing is fetched
        const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
        if (copy.header.operation_merkle_root !== h.operation_merkle_root || !same(copy.id, tx.id)) {
            throw new Error("the transaction's id does not match its header and operations; not signed");
        }
        return copy.id;
    }
    async sendTransaction(tx, options) {
        if (!this.provider)
            throw new Error("signer has no provider");
        if (!tx.id)
            await this.prepareTransaction(tx);
        if (!(tx.signatures ?? []).length)
            await this.signTransaction(tx);
        const provider = this.provider;
        const { receipt } = await provider.sendTransaction(tx, options?.broadcast);
        tx.wait = (type = "byBlock", timeout = 60000) => provider.wait(tx.id, type, timeout);
        return { receipt: receipt, transaction: tx };
    }
    prepareBlock() {
        return Promise.reject(new Error("ML-DSA-44 accounts cannot produce blocks until block signatures move to ML-DSA (phase B2)"));
    }
    signBlock() {
        return this.prepareBlock();
    }
}
