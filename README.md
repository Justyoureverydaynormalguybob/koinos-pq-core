# koinos-pq-core

The one place the rules for ML-DSA-44 (FIPS 204) accounts on Koinos live, as a TypeScript package.
Used by the browser wallet (koinos-pq-wallet) and the browser extension; the phone app mirrors it.

```
src/keys.ts       24 words <-> 32-byte seed -> ML-DSA-44 key -> address; secp256k1 bootstrap key from the seed
src/sign.ts       the two signature formats (pqwallet raw 2420 B under "koinos/pqwallet/1";
                  native 0x01||pk||sig 3733 B under "koinos/tx/1") and the proof of possession
src/setup.ts      turn a key into a pqwallet account: fund, upload (locked), register, verify;
                  budgets priced from the live resource market; waits out the mempool's rc hold
src/signer.ts     PqSigner: what koilib expects from a signer, for either account mode
src/chain.ts      networks (mainnet KOIN is 19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK), balance, mana, transfers,
                  history over JSON-RPC, KOIN formatting
src/contract.ts   the koinos-pq account contract embedded as data, hash-checked on load
```

Install from git (pin a commit):

```
npm install github:Justyoureverydaynormalguybob/koinos-pq-core#<commit>
```

Build: `npm run build` (plain `tsc`, ES2020 modules, declarations). Test: `npm test` (vitest; the key
vectors are the same seeds koinos-chain's ML-DSA tests derive from, so a port that passes them agrees
with the node).

Proven with this code: Harbinger account `1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ` and the first
post-quantum-signed KOIN transfer on mainnet
(`0x12206b839a6fa5c9ac9a0a90ba4fc7a2cd3fb2786bc4927f3d59ab448a45d3726244`, block 40,318,335).

## Using `PqSigner` from other code

Pass the chain id the signer is for, the pinned one from `Chain.chainId()`:

```ts
const chain = new Chain(NETWORKS.mainnet);
const signer = PqSigner.pqwallet(keys, account, chain.provider, await chain.chainId());
```

An account has the same address and the same key on every Koinos network. Without a chain id of its own
the signer takes the node's word for which chain a transaction is for, and a node that lies gets a
signature another chain accepts. With one, `prepareTransaction` uses it and `signTransaction` refuses a
transaction that names any other. `Chain.chainId()` itself refuses a node that reports a different id
than the network's pin, and refuses a devnet node that reports a pinned chain's id.

`signTransaction` never signs an id it was handed: it works the merkle root out again from the operations
and the id from the header, and refuses a transaction whose id is not that. `signHash` exists because
koilib's signer interface has it, and signs whatever digest it is given as a transaction id. Do not pass
it a digest that came from anywhere but a transaction you built.

`pqwalletInfo` says "no contract there" only on the node's own word. A node that does not answer is tried
three times and then it throws. `Chain.txStatus(id)` tells "in a block", "the node knows no such
transaction" and "the node could not be asked" apart; `Chain.landed(id)` is true for the first only.

These rules, and the history change (the KOIN contract's transfer event is shown in preference to one a
called contract emitted first), came out of an outside review on 2026-11-27, written up in koinos-pq-wallet
`docs/SECURITY.md` and tested in `test/review-2026-11-27.test.ts` and `test/signer.test.ts`.

MIT. Not audited.
