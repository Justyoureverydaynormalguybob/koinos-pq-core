// Chain.burnKoin and the send path under it, against a provider that answers what each test tells it to.
// Pins: the burn is allow PoB, burn, forbid PoB in that order in ONE transaction; PoB is the pinned
// address; an account that already allows PoB gets the bare burn; and a submission the node does not
// clearly answer is looked for by id instead of being reported as a failure (which invited a second burn).
import { describe, expect, it } from "vitest";
import { utils } from "koilib";
import { Chain, NETWORKS, PQWALLET_ENTRY, POB_ENTRY, UnconfirmedSendError, deriveKeys, encodeBurnArgs, encodeSetAllowedCallerArgs, isRefusal } from "../src/index";

const net = NETWORKS.mainnet!;
const ME = "1G2UuH9LEaHEJKs6hDKYunXVW6nBx3dze2";
const keys = deriveKeys(Uint8Array.from({ length: 32 }, (_, i) => i));
const b64 = (u: Uint8Array) => utils.encodeBase64url(u);
type Tx = { id: string; header: { payer: string; rc_limit: string; nonce: string }; operations: Array<{ call_contract: { contract_id: string; entry_point: number; args: string } }>; signatures: string[] };

function chainWith(o: { allowed?: boolean; mana?: string; send?: (tx: Tx) => Promise<unknown>; landed?: (id: string) => boolean; readThrows?: boolean }) {
  const chain = new Chain({ ...net });
  const sent: Tx[] = [];
  const looked: string[] = [];
  const p = chain.provider as unknown as Record<string, unknown>;
  p.readContract = async () => {
    if (o.readThrows) throw new Error("node down");
    return { result: o.allowed ? b64(Uint8Array.from([8, 1])) : "" };
  };
  p.getAccountRc = async () => o.mana ?? "5000000000";
  p.getChainId = async () => net.chainId;
  p.getNextNonce = async () => "KAo=";
  p.sendTransaction = async (tx: Tx) => {
    sent.push(tx);
    return (await o.send?.(tx)) ?? { receipt: { rc_used: "1" } };
  };
  p.getTransactionsById = async (ids: string[]) => {
    looked.push(ids[0]!);
    return { transactions: o.landed?.(ids[0]!) ? [{}] : [] };
  };
  chain.unclearLookupMs = 1;
  return { chain, sent, looked };
}
const burn = (chain: Chain) => chain.burnKoin({ from: ME, valueBase: 100_000_000n, keys, mode: "pqwallet" });

describe("burnKoin", () => {
  it("is allow PoB, burn, forbid PoB, in that order, in one transaction, with the pinned PoB address", async () => {
    expect(net.pob).toBe("159myq5YUhhoVWu3wsHKHiJYKPKGUrGiyv");
    expect(net.vhp).toBe("12Y5vW6gk8GceH53YfRkRre2Rrcsgw7Naq");
    expect(NETWORKS.testnet!.pob).toBe("1MAbK5pYkhp9yHnfhYamC3tfSLmVRTDjd9");
    const { chain, sent } = chainWith({ allowed: false });
    const res = await burn(chain);
    expect(sent).toHaveLength(1);
    const ops = sent[0]!.operations.map((x) => x.call_contract);
    expect(ops).toEqual([
      { contract_id: ME, entry_point: PQWALLET_ENTRY.set_allowed_caller, args: b64(encodeSetAllowedCallerArgs(net.pob!, true)) },
      { contract_id: net.pob, entry_point: POB_ENTRY.burn, args: b64(encodeBurnArgs(100_000_000n, ME, ME)) },
      { contract_id: ME, entry_point: PQWALLET_ENTRY.set_allowed_caller, args: b64(encodeSetAllowedCallerArgs(net.pob!, false)) },
    ]);
    // the last operation really is the forbid: the two encodings differ, and end in "allowed = false"
    expect(ops[0]!.args).not.toBe(ops[2]!.args);
    expect(sent[0]!.header.payer).toBe(ME);
    expect(sent[0]!.signatures).toHaveLength(1);
    expect(res.txId).toBe(sent[0]!.id);
  });

  it("sends the bare burn when the account already allows PoB, and in native mode", async () => {
    const a = chainWith({ allowed: true });
    await burn(a.chain);
    expect(a.sent[0]!.operations.map((x) => x.call_contract.contract_id)).toEqual([net.pob]);
    const n = chainWith({ allowed: false });
    await n.chain.burnKoin({ from: keys.address, valueBase: 1n, keys, mode: "native" });
    expect(n.sent[0]!.operations).toHaveLength(1);
  });

  it("sends nothing when the allowed list cannot be read, when the amount is not positive, or when no mana would be left", async () => {
    const down = chainWith({ readThrows: true });
    await expect(burn(down.chain)).rejects.toThrow();
    expect(down.sent).toHaveLength(0);
    const zero = chainWith({});
    await expect(zero.chain.burnKoin({ from: ME, valueBase: 0n, keys, mode: "pqwallet" })).rejects.toThrow(/positive/);
    const dry = chainWith({ mana: "100000000" });
    await expect(burn(dry.chain)).rejects.toThrow(/mana/);
    expect(zero.sent.length + dry.sent.length).toBe(0);
  });

  it("never asks for more mana than 10 KOIN, half of what there is, or what is left after the burn", async () => {
    const big = chainWith({ mana: "999999999999999" });
    await burn(big.chain);
    expect(big.sent[0]!.header.rc_limit).toBe("1000000000");
    const small = chainWith({ mana: "150000000" });
    await burn(small.chain);
    expect(small.sent[0]!.header.rc_limit).toBe("50000000");
  });
});

describe("a submission the node does not clearly answer", () => {
  it("tells a refusal from no answer", () => {
    expect(isRefusal(new Error('{"error":"account X has not authorized transaction","code":-200,"logs":[]}'))).toBe(true);
    for (const m of ['{"error":"rpc failed, AMQP connection is not open"}', "fetch failed", "Unexpected token < in JSON", "The operation timed out", '{"error":""}', "{}"]) expect(isRefusal(new Error(m)), m).toBe(false);
  });

  it("a refusal is thrown as it is and nothing is looked up", async () => {
    const { chain, looked } = chainWith({ send: async () => { throw new Error('{"error":"account has not authorized transaction","code":-200}'); } });
    await expect(burn(chain)).rejects.toThrow(/not authorized/);
    expect(looked).toHaveLength(0);
  });

  it("an error after the node took it is a success once the id is found on the chain", async () => {
    let asked = 0;
    const { chain, sent, looked } = chainWith({ send: async () => { throw new Error('{"error":"rpc failed, AMQP connection is not open"}'); }, landed: () => ++asked >= 2 });
    const res = await burn(chain);
    expect(res.txId).toBe(sent[0]!.id);
    expect(sent).toHaveLength(1); // not signed or sent a second time
    expect(looked.every((id) => id === sent[0]!.id)).toBe(true);
  });

  it("an error with the id not found is 'unconfirmed', carrying the id, never a plain failure", async () => {
    const { chain, sent, looked } = chainWith({ send: async () => { throw new Error("fetch failed"); }, landed: () => false });
    const err = await burn(chain).catch((e) => e);
    expect(err).toBeInstanceOf(UnconfirmedSendError);
    expect((err as UnconfirmedSendError).txId).toBe(sent[0]!.id);
    expect(looked).toHaveLength(chain.unclearLookups);
    expect(sent).toHaveLength(1);
    expect(await chain.landed(sent[0]!.id)).toBe(false);
  });
});
