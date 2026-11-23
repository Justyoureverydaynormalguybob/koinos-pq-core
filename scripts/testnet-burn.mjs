// Live check of Chain.burnKoin on Harbinger (or KOINOS_NETWORK=mainnet): burns KOIN for VHP from a pqwallet
// account and shows the balances either side.
//
//   PQ_SEED_HEX=<64 hex> PQ_ACCOUNT=<address> node scripts/testnet-burn.mjs [amount, default 1]
//
// or, with a koinos-pq CLI key file in plain text (a testnet one):
//
//   PQ_KEYFILE=../koinos-pq/.keys.testnet.json node scripts/testnet-burn.mjs 1
//
// It first sends the burn on its own, which a pqwallet account must refuse (PoB is a nested caller that is
// not on the allowed list), then the real thing, and checks PoB is off the allowed list again afterwards.
import { readFileSync } from "node:fs";
import { Chain, NETWORKS, POB_ENTRY, deriveKeys, encodeBurnArgs, formatKoin, parseKoin, parseSeedInput } from "../dist/index.js";

const net = NETWORKS[process.env.KOINOS_NETWORK || "testnet"];
if (!net?.pob || !net.vhp) throw new Error("this network has no proof-of-burn contract configured");
let seedHex = process.env.PQ_SEED_HEX, account = process.env.PQ_ACCOUNT;
if (process.env.PQ_KEYFILE) {
  const k = JSON.parse(readFileSync(process.env.PQ_KEYFILE, "utf8"));
  if (!k.pq?.seedHex) throw new Error("the key file is encrypted or has no pq.seedHex; pass PQ_SEED_HEX instead");
  seedHex = k.pq.seedHex;
  account = k.contractId ?? k.account.address;
}
if (!seedHex || !account) throw new Error("set PQ_SEED_HEX and PQ_ACCOUNT, or PQ_KEYFILE");
const amount = parseKoin(process.argv[2] ?? "1");
const keys = deriveKeys(parseSeedInput(seedHex));
const chain = new Chain(net);

const show = async (label) => {
  const [koin, vhp, mana, allowed] = await Promise.all([chain.balance(account), chain.tokenBalance(net.vhp, account), chain.mana(account), chain.allowedCaller(account, net.pob)]);
  console.log(`${label}: KOIN ${formatKoin(koin)}  VHP ${formatKoin(vhp)}  mana ${formatKoin(mana)}  PoB allowed: ${allowed}`);
  return { koin, vhp, mana, allowed };
};

console.log(`network ${net.name}, account ${account}, PoB ${net.pob}, burning ${formatKoin(amount)}`);
const before = await show("before");

if (!before.allowed) {
  try {
    await chain.sendCalls({ from: account, operations: [{ contract: net.pob, entryPoint: POB_ENTRY.burn, args: encodeBurnArgs(amount, account, account) }], keys, mode: "pqwallet" });
    console.log("UNEXPECTED: the bare burn was accepted");
    process.exit(1);
  } catch (e) {
    console.log(`bare burn refused, as it should be: ${String(e.message ?? e).slice(0, 200)}`);
  }
}

const res = await chain.burnKoin({ from: account, valueBase: amount, keys, mode: "pqwallet" });
console.log(`tx ${res.txId}`);
console.log(`receipt: rc_used ${res.receipt.rc_used}, reverted ${!!res.receipt.reverted}, events ${(res.receipt.events ?? []).map((e) => e.name).join(", ")}`);
console.log(`mined in block ${await chain.waitMined(res.txId)}`);
const after = await show("after");

const ok = before.koin - after.koin === amount && after.vhp - before.vhp === amount && after.allowed === before.allowed;
console.log(ok ? "OK: KOIN down and VHP up by exactly the amount, allowed list unchanged" : "MISMATCH");
if (net.explorerTx) console.log(net.explorerTx(res.txId));
process.exit(ok ? 0 : 1);
