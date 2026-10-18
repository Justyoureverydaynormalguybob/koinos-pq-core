// A koilib-compatible signer for ML-DSA-44 accounts, so anything built on koilib's Signer interface
// (Contract calls, dapp provider flows, the Kondor-style `getSigner(address)` API) can use a
// post-quantum account without knowing how its signature is made.
import { Transaction, utils, type Provider, type TransactionJson } from "koilib";
import type { PqKeys } from "./keys.js";
import { signTxId, type AccountMode } from "./sign.js";

type Hex = string;
type TxLike = TransactionJson & { id?: Hex; wait?: (type?: "byTransactionId" | "byBlock", timeout?: number) => Promise<unknown> };

const TX_ID_PREFIX = new Uint8Array([0x12, 0x20]); // sha2-256 multihash header

export class PqSigner {
  provider?: Provider;

  /**
   * @param keys     the ML-DSA-44 key pair
   * @param mode     "native" (the key's own address, 3733-byte entries) or "pqwallet" (an account running the
   *                 koinos-pq contract with this key registered, raw 2420-byte signatures)
   * @param account  the address this signer authorises; for "native" it must be the key's address
   */
  constructor(
    readonly keys: PqKeys,
    readonly mode: AccountMode,
    readonly account: string,
    provider?: Provider,
  ) {
    if (mode === "native" && account !== keys.address) throw new Error("a native signer's account is the key's own address");
    this.provider = provider;
  }

  static native(keys: PqKeys, provider?: Provider): PqSigner {
    return new PqSigner(keys, "native", keys.address, provider);
  }

  static pqwallet(keys: PqKeys, accountAddress: string, provider?: Provider): PqSigner {
    return new PqSigner(keys, "pqwallet", accountAddress, provider);
  }

  getAddress(): string {
    return this.account;
  }

  /** The bytes that go into `transaction.signatures` for this account. `hash` is the 32-byte digest or the 34-byte multihash. */
  async signHash(hash: Uint8Array): Promise<Uint8Array> {
    let id: Uint8Array;
    if (hash.length === 34 && hash[0] === 0x12 && hash[1] === 0x20) id = hash;
    else if (hash.length === 32) {
      id = new Uint8Array(34);
      id.set(TX_ID_PREFIX, 0);
      id.set(hash, 2);
    } else throw new Error("expected a 32-byte sha2-256 digest or a 34-byte multihash");
    return signTxId("0x" + utils.toHexString(id), this.keys, this.mode);
  }

  /**
   * Signs sha2-256(message) the same way a transaction id is signed. Note for dapps: unlike a secp256k1
   * signature, no public key can be recovered from this; verify it against the account's registered key.
   */
  async signMessage(message: string | Uint8Array): Promise<Uint8Array> {
    const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    return this.signHash(digest);
  }

  async prepareTransaction(tx: TxLike): Promise<TxLike> {
    if (!this.provider) throw new Error("signer has no provider");
    tx.header = tx.header ?? {};
    if (!tx.header.payer) tx.header.payer = this.account;
    await Transaction.prepareTransaction(tx as never, this.provider, this.account);
    return tx;
  }

  /** Appends this account's signature entry. Prepares the transaction first if it has no id yet. */
  async signTransaction(tx: TxLike): Promise<TransactionJson> {
    if (!tx.id) await this.prepareTransaction(tx);
    const entry = await this.signHash(utils.toUint8Array(tx.id!.replace(/^0x/, "")));
    tx.signatures = [...(tx.signatures ?? []), utils.encodeBase64url(entry)];
    return tx;
  }

  async sendTransaction(tx: TxLike, options?: { broadcast?: boolean }): Promise<{ receipt: Record<string, unknown>; transaction: TxLike }> {
    if (!this.provider) throw new Error("signer has no provider");
    if (!tx.id) await this.prepareTransaction(tx);
    if (!(tx.signatures ?? []).length) await this.signTransaction(tx);
    const provider = this.provider;
    const { receipt } = await provider.sendTransaction(tx as never, options?.broadcast);
    tx.wait = (type = "byBlock", timeout = 60_000) => provider.wait(tx.id!, type, timeout);
    return { receipt: receipt as unknown as Record<string, unknown>, transaction: tx };
  }

  prepareBlock(): Promise<never> {
    return Promise.reject(new Error("ML-DSA-44 accounts cannot produce blocks until block signatures move to ML-DSA (phase B2)"));
  }

  signBlock(): Promise<never> {
    return this.prepareBlock();
  }
}
