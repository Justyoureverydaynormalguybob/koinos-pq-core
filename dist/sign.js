// Transaction signing, both routes. Mirror this exactly in the phone app.
//
//   pqwallet (contract route, live on Harbinger and usable on mainnet today):
//     signature entry = ML-DSA-44 signature (2420 bytes) over the 34-byte tx id, context "koinos/pqwallet/1"
//     the account is an address that runs the koinos-pq `pqwallet` contract with this key registered
//
//   native (koinos-chain fork, branch ml-dsa-44; devnet today, mainnet once adopted):
//     signature entry = 0x01 || public key (1312) || ML-DSA-44 signature (2420) = 3733 bytes,
//     over the 34-byte tx id, context "koinos/tx/1"; the account is the key's own address
//
//   messages (signMessage, for dapps that ask a user to sign text):
//     same entry format as the account's transactions, over the raw message bytes, context
//     "koinos/message/1"; never valid as a transaction signature
//
// Different contexts mean a signature made for one purpose can never be replayed as another:
// a route's transaction signature on the other route, a proof of possession as a transaction, or
// a signed message as a transaction (ML-DSA binds the context into what is signed).
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { PK_BYTES, SIG_BYTES } from "./keys.js";
export const CONTEXT_PQWALLET = utf8ToBytes("koinos/pqwallet/1");
export const CONTEXT_POP = utf8ToBytes("koinos/pqwallet/1/pop");
export const CONTEXT_NATIVE = utf8ToBytes("koinos/tx/1");
export const CONTEXT_MESSAGE = utf8ToBytes("koinos/message/1");
export const MAX_MESSAGE_BYTES = 64 * 1024;
/**
 * Proof of possession for registering the key on a pqwallet account: the ML-DSA key signs the
 * account's 25 address bytes under its own context, so a public key can only be registered by
 * whoever holds the matching secret key, and the proof cannot be reused as a transaction signature.
 */
export function proofOfPossession(accountAddressBytes, keys) {
    if (accountAddressBytes.length !== 25)
        throw new Error("account address must be 25 bytes");
    return ml_dsa44.sign(accountAddressBytes, keys.secretKey, { context: CONTEXT_POP });
}
export const NATIVE_TAG = 0x01;
export const NATIVE_ENTRY_BYTES = 1 + PK_BYTES + SIG_BYTES; // 3733
export function txIdBytes(txIdHex) {
    const id = hexToBytes(txIdHex.replace(/^0x/, ""));
    if (id.length !== 34 || id[0] !== 0x12 || id[1] !== 0x20)
        throw new Error("transaction id is not a sha2-256 multihash");
    return id;
}
/** Bytes to put in `transaction.signatures` for this account mode. */
export function signTxId(txIdHex, keys, mode) {
    const id = txIdBytes(txIdHex);
    if (mode === "pqwallet") {
        const sig = ml_dsa44.sign(id, keys.secretKey, { context: CONTEXT_PQWALLET });
        if (sig.length !== SIG_BYTES)
            throw new Error("unexpected signature size");
        return sig;
    }
    const sig = ml_dsa44.sign(id, keys.secretKey, { context: CONTEXT_NATIVE });
    const entry = new Uint8Array(NATIVE_ENTRY_BYTES);
    entry[0] = NATIVE_TAG;
    entry.set(keys.publicKey, 1);
    entry.set(sig, 1 + PK_BYTES);
    return entry;
}
/**
 * A signed message in the account's entry format (pqwallet: the 2420-byte signature; native: 0x01 || pk || sig),
 * over the raw message bytes under "koinos/message/1". It cannot authorise a transaction.
 */
export function signMessageEntry(message, keys, mode) {
    if (message.length > MAX_MESSAGE_BYTES)
        throw new Error(`message longer than ${MAX_MESSAGE_BYTES} bytes`);
    const sig = ml_dsa44.sign(message, keys.secretKey, { context: CONTEXT_MESSAGE });
    if (sig.length !== SIG_BYTES)
        throw new Error("unexpected signature size");
    if (mode === "pqwallet")
        return sig;
    const entry = new Uint8Array(NATIVE_ENTRY_BYTES);
    entry[0] = NATIVE_TAG;
    entry.set(keys.publicKey, 1);
    entry.set(sig, 1 + PK_BYTES);
    return entry;
}
/** Verifies a signed message against the account's key (for a pqwallet account, its registered key). */
export function verifyMessageEntry(entry, message, publicKey, mode) {
    if (mode === "pqwallet")
        return entry.length === SIG_BYTES && ml_dsa44.verify(entry, message, publicKey, { context: CONTEXT_MESSAGE });
    if (entry.length !== NATIVE_ENTRY_BYTES || entry[0] !== NATIVE_TAG)
        return false;
    const pk = entry.subarray(1, 1 + PK_BYTES);
    if (pk.length !== publicKey.length || !pk.every((b, i) => b === publicKey[i]))
        return false;
    return ml_dsa44.verify(entry.subarray(1 + PK_BYTES), message, pk, { context: CONTEXT_MESSAGE });
}
/** Local check before broadcasting: the entry verifies under the right context and no other. */
export function verifyEntry(entry, txIdHex, publicKey, mode) {
    const id = txIdBytes(txIdHex);
    if (mode === "pqwallet") {
        return entry.length === SIG_BYTES && ml_dsa44.verify(entry, id, publicKey, { context: CONTEXT_PQWALLET });
    }
    if (entry.length !== NATIVE_ENTRY_BYTES || entry[0] !== NATIVE_TAG)
        return false;
    const pk = entry.subarray(1, 1 + PK_BYTES);
    const sig = entry.subarray(1 + PK_BYTES);
    if (pk.length !== publicKey.length || !pk.every((b, i) => b === publicKey[i]))
        return false;
    return ml_dsa44.verify(sig, id, pk, { context: CONTEXT_NATIVE });
}
