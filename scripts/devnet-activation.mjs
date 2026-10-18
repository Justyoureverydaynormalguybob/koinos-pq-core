// Activation on the private devnet (koinos-pq/devnet), straight through this library: a fresh seed's
// account is installed and registered by setupPqwalletAccount, and the chain must show ONE transaction
// carrying both operations, the account's nonce at 1, and this key registered.
//
//   npm run build
//   node scripts/devnet-activation.mjs        (needs the devnet up and producing blocks)
import { randomBytes } from "node:crypto";
import { Transaction } from "koilib";
import {
  Chain, NETWORKS, TOKEN_ENTRY, bootstrapAddress, bootstrapSigner, callContractOperation, deriveKeys, encodeTransferArgs, registeredPublicKey, pqwalletInfo,
  setupPqwalletAccount,
} from "../dist/index.js";

const keys = deriveKeys(new Uint8Array(randomBytes(32)));
const account = bootstrapAddress(keys);
const chain = new Chain(NETWORKS.devnet);
console.log(`account ${account}`);

const t0 = Date.now();
const result = await setupPqwalletAccount(chain, keys, (s) => console.log(`  ${s.step}: ${s.message}${s.txId ? ` ${s.txId.slice(0, 18)}…` : ""}`));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const fail = (m) => {
  console.log(`FAIL  ${m}`);
  process.exitCode = 1;
};
const ok = (m) => console.log(`PASS  ${m}`);

result.uploadTx && result.uploadTx === result.registerTx ? ok(`one transaction: ${result.uploadTx}`) : fail(`expected one transaction, got ${JSON.stringify(result)}`);

// the devnet runs no transaction store, so read the transaction out of its block
const height = Number(await chain.waitMined(result.uploadTx));
const block = await chain.provider.getBlock(height);
const tx = (block?.block?.transactions ?? []).find((t) => t.id === result.uploadTx);
const ops = tx?.operations ?? [];
ops.length === 2 && ops[0].upload_contract && ops[1].call_contract ? ok("it carries the upload and the set_public_key call, in that order") : fail(`operations: ${JSON.stringify(ops.map((o) => Object.keys(o)))}`);

const nonce = Number(await chain.provider.getNonce(account));
nonce === 1 ? ok("the account has made exactly one transaction (nonce 1)") : fail(`nonce ${nonce}`);

const info = await pqwalletInfo(chain, account);
const pk = await registeredPublicKey(chain, account);
info.deployed && info.keyRegistered && pk && Buffer.from(pk).equals(Buffer.from(keys.publicKey)) ? ok("contract installed, this wallet's key registered") : fail(`info ${JSON.stringify(info)}`);

// the throwaway secp256k1 key that signed the activation must have no power left
const legacy = bootstrapSigner(keys.seed);
legacy.provider = chain.provider;
const probe = { header: { payer: account, rc_limit: "1000000" }, operations: [callContractOperation(NETWORKS.devnet.koin, TOKEN_ENTRY.transfer, encodeTransferArgs(account, account, 1n))] };
await Transaction.prepareTransaction(probe, chain.provider, account);
const signedProbe = await legacy.signTransaction(probe);
try {
  await chain.provider.sendTransaction(signedProbe);
  fail("the bootstrap key still authorised a transaction after activation");
} catch (e) {
  /not authorized/.test(e.message) ? ok("the bootstrap key that signed the activation is refused afterwards") : fail(`unexpected error: ${e.message}`);
}

console.log(process.exitCode ? "\nACTIVATION CHECK FAILED" : "\nONE-TRANSACTION ACTIVATION WORKS");
