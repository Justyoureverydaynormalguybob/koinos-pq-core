// A koilib-compatible signer for ML-DSA-44 accounts, so anything built on koilib's Signer interface
// (Contract calls, dapp provider flows, the Kondor-style `getSigner(address)` API) can use a
// post-quantum account without knowing how its signature is made.
import { Transaction, utils } from "koilib";
import { signTxId } from "./sign.js";
const TX_ID_PREFIX = new Uint8Array([0x12, 0x20]); // sha2-256 multihash header
export class PqSigner {
    /**
     * @param keys     the ML-DSA-44 key pair
     * @param mode     "native" (the key's own address, 3733-byte entries) or "pqwallet" (an account running the
     *                 koinos-pq contract with this key registered, raw 2420-byte signatures)
     * @param account  the address this signer authorises; for "native" it must be the key's address
     */
    constructor(keys, mode, account, provider) {
        this.keys = keys;
        this.mode = mode;
        this.account = account;
        if (mode === "native" && account !== keys.address)
            throw new Error("a native signer's account is the key's own address");
        this.provider = provider;
    }
    static native(keys, provider) {
        return new PqSigner(keys, "native", keys.address, provider);
    }
    static pqwallet(keys, accountAddress, provider) {
        return new PqSigner(keys, "pqwallet", accountAddress, provider);
    }
    getAddress() {
        return this.account;
    }
    /** The bytes that go into `transaction.signatures` for this account. `hash` is the 32-byte digest or the 34-byte multihash. */
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
     * Signs sha2-256(message) the same way a transaction id is signed. Note for dapps: unlike a secp256k1
     * signature, no public key can be recovered from this; verify it against the account's registered key.
     */
    async signMessage(message) {
        const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        return this.signHash(digest);
    }
    async prepareTransaction(tx) {
        if (!this.provider)
            throw new Error("signer has no provider");
        tx.header = tx.header ?? {};
        if (!tx.header.payer)
            tx.header.payer = this.account;
        await Transaction.prepareTransaction(tx, this.provider, this.account);
        return tx;
    }
    /** Appends this account's signature entry. Prepares the transaction first if it has no id yet. */
    async signTransaction(tx) {
        if (!tx.id)
            await this.prepareTransaction(tx);
        const entry = await this.signHash(utils.toUint8Array(tx.id.replace(/^0x/, "")));
        tx.signatures = [...(tx.signatures ?? []), utils.encodeBase64url(entry)];
        return tx;
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
