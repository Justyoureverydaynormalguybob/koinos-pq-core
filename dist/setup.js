// Turning the wallet's key into a pqwallet account on a network: the one-time setup that the
// koinos-pq CLI does with `deploy --lock` and `register`, done in the browser.
//
//   1. The account is the address of the bootstrap secp256k1 key (derived from the seed). The user
//      funds it; mana is what the activation costs.
//   2. ONE transaction, signed by the bootstrap key, with two operations: upload the pqwallet
//      contract to that address with call, transaction and upload authority all governed by the
//      contract ("locked"), then register the ML-DSA-44 public key with a proof of possession (the
//      contract's legacy fallback accepts the bootstrap signature only while no key is registered).
//      Both land in the same block or neither does, so there is no moment at which the contract is
//      installed while the bootstrap key, whose public key that transaction reveals, still rules it.
//   3. Check the registered key is ours. From then on the account answers only to ML-DSA-44.
//
// An account left installed-but-unregistered by an older two-step activation (or the CLI) is finished
// with a register-only transaction.
//
// Transactions are encoded with koilib's static protobuf modules and abi-lite: no code generation,
// so this runs under a Manifest V3 extension's CSP.
import { Transaction, utils } from "koilib";
import { callContractOperation, decodeGetInfoResult, decodeGetPublicKeyResult, encodeSetPublicKeyArgs, PQWALLET_ENTRY } from "./abi-lite.js";
import { loadPqwalletBytecode, pqwalletAbi } from "./contract.js";
import { bootstrapSigner } from "./keys.js";
import { proofOfPossession } from "./sign.js";
/**
 * What the two transactions use, from the Harbinger run (upload: 62,266 B bytecode + 3 KB ABI stored
 * and carried; register: the 1,312 B key stored, a 4 KB transaction, about 6.5 M ticks to verify the
 * proof of possession in interpreted WASM). Priced from the live resource market with a 25% margin:
 * the model gives 5.45 / 0.54 tKOIN where Harbinger charged 5.07 / 0.35; mainnet charged 44.9 / 2.9 KOIN
 * against budgets of 60.2 / 5.6.
 */
const UPLOAD_USAGE = { disk: 66000n, network: 66500n, compute: 2500000n };
const REGISTER_USAGE = { disk: 1600n, network: 4000n, compute: 6500000n };
export function setupCostsFromPrices(p) {
    const price = (u) => ((u.disk * p.disk + u.network * p.network + u.compute * p.compute) * 125n) / 100n;
    const deployRc = price(UPLOAD_USAGE), registerRc = price(REGISTER_USAGE);
    return { deployRc, registerRc, requiredMana: deployRc + registerRc };
}
/** Live prices from the node's resource market (chain.get_resource_limits). */
export async function estimateSetupCosts(chain) {
    const r = (await chain.provider.call("chain.get_resource_limits", {}));
    const l = r.resource_limit_data ?? {};
    const prices = { disk: BigInt(l.disk_storage_cost ?? "0"), network: BigInt(l.network_bandwidth_cost ?? "0"), compute: BigInt(l.compute_bandwidth_cost ?? "0") };
    if (prices.disk <= 0n || prices.network <= 0n || prices.compute <= 0n)
        throw new Error("could not read resource prices from the node");
    return setupCostsFromPrices(prices);
}
export function bootstrapAddress(keys) {
    return bootstrapSigner(keys.seed).getAddress();
}
/** get_info on the account; any failure to read it counts as "no contract there". */
export async function pqwalletInfo(chain, account) {
    try {
        const info = decodeGetInfoResult(await chain.read(account, PQWALLET_ENTRY.get_info));
        return { deployed: info.publicKeyBytes === 1312, keyRegistered: info.keyRegistered };
    }
    catch {
        return { deployed: false, keyRegistered: false };
    }
}
export async function registeredPublicKey(chain, account) {
    return decodeGetPublicKeyResult(await chain.read(account, PQWALLET_ENTRY.get_public_key));
}
/**
 * The mempool keeps a transaction's whole rc_limit on hold until its block is irreversible (about
 * three minutes on mainnet and Harbinger) and the chain refuses a new transaction that would exceed
 * mana minus that hold with "insufficient pending account resources". After the upload this is
 * normal, so wait it out instead of failing.
 */
async function withManaHoldRetry(fn, onWait, tries = 36, delayMs = 10000) {
    for (let attempt = 1;; attempt++) {
        try {
            return await fn();
        }
        catch (e) {
            const msg = e.message || String(e);
            if (!/insufficient pending account resources/.test(msg) || attempt >= tries)
                throw e;
            onWait(attempt);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}
/**
 * The operations of the single activation transaction, in order: install the contract with every
 * authority locked to it, then register this key with its proof of possession.
 */
export function activationOperations(account, keys, bytecode) {
    const proof = proofOfPossession(utils.decodeBase58(account), keys);
    return [
        {
            upload_contract: {
                contract_id: account,
                bytecode: utils.encodeBase64url(bytecode),
                abi: JSON.stringify(pqwalletAbi),
                authorizes_call_contract: true,
                authorizes_transaction_application: true,
                authorizes_upload_contract: true,
            },
        },
        callContractOperation(account, PQWALLET_ENTRY.set_public_key, encodeSetPublicKeyArgs(keys.publicKey, proof)),
    ];
}
export async function setupPqwalletAccount(chain, keys, onStatus) {
    const signer = bootstrapSigner(keys.seed);
    signer.provider = chain.provider;
    const account = signer.getAddress();
    const costs = await estimateSetupCosts(chain);
    let uploadTx = null;
    let registerTx = null;
    onStatus({ step: "checking", message: "Checking the account" });
    let info = await pqwalletInfo(chain, account);
    if (!info.deployed) {
        const mana = await chain.mana(account);
        if (mana < costs.requiredMana)
            throw new Error(`the account needs more mana to activate (has ${mana}, needs ${costs.requiredMana} base units)`);
        onStatus({ step: "uploading", message: "Installing the contract and registering your key, in one transaction" });
        const operations = activationOperations(account, keys, await loadPqwalletBytecode());
        const sent = await withManaHoldRetry(async () => {
            if ((await pqwalletInfo(chain, account)).deployed)
                return null; // an earlier attempt landed meanwhile
            const tx = { header: { payer: account, rc_limit: costs.requiredMana.toString() }, operations, signatures: [] };
            await Transaction.prepareTransaction(tx, chain.provider, account);
            const signed = await signer.signTransaction(tx);
            await chain.provider.sendTransaction(signed);
            return signed.id;
        }, (n) => onStatus({ step: "uploading", message: `Waiting for the network to release an earlier mana hold (try ${n}, up to a few minutes)` }));
        if (sent) {
            uploadTx = registerTx = sent;
            onStatus({ step: "uploading", message: "Activation submitted, waiting for a block", txId: sent });
            await chain.waitMined(sent);
        }
        info = await pqwalletInfo(chain, account);
        // a transaction that reverts undoes both operations, so "installed but not registered" cannot come from it
        if (!info.deployed)
            throw new Error("the activation was mined but the contract cannot be read back; it may have reverted; check the account before trying again");
    }
    if (!info.keyRegistered) {
        // only an account installed by an older two-step activation, or by the command-line tool, gets here
        onStatus({ step: "registering", message: "Registering the post-quantum key" });
        const proof = proofOfPossession(utils.decodeBase58(account), keys);
        const operation = callContractOperation(account, PQWALLET_ENTRY.set_public_key, encodeSetPublicKeyArgs(keys.publicKey, proof));
        const tx = { header: { payer: account, rc_limit: costs.registerRc.toString() }, operations: [operation], signatures: [] };
        await Transaction.prepareTransaction(tx, chain.provider, account);
        const signed = await signer.signTransaction(tx); // bootstrap signature: the contract's legacy fallback, valid only before a key is registered
        let alreadyRegistered = false;
        await withManaHoldRetry(async () => {
            // an earlier attempt may have gone through while the mempool was still reporting a hold
            if ((await pqwalletInfo(chain, account)).keyRegistered) {
                alreadyRegistered = true;
                return;
            }
            await chain.provider.sendTransaction(signed);
        }, (n) => onStatus({ step: "registering", message: `Upload done. Waiting for the network to release the upload's mana hold before registering (try ${n}, up to a few minutes)` }));
        if (!alreadyRegistered) {
            registerTx = signed.id;
            onStatus({ step: "registering", message: "Registration submitted, waiting for a block", txId: registerTx });
            await chain.waitMined(registerTx);
        }
        info = await pqwalletInfo(chain, account);
        if (!info.keyRegistered)
            throw new Error("registration was mined but the contract reports no key; stop here and check the account");
    }
    onStatus({ step: "verifying", message: "Checking the registered key is this wallet's" });
    const pk = await registeredPublicKey(chain, account);
    if (!pk || pk.length !== keys.publicKey.length || !pk.every((b, i) => b === keys.publicKey[i])) {
        throw new Error("this account is registered to a different post-quantum key; it was not added");
    }
    onStatus({ step: "done", message: "The account answers only to this wallet's ML-DSA-44 key" });
    return { account, uploadTx, registerTx };
}
