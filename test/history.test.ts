// Account history rows turned into what a wallet shows. The row shapes are what a mainnet node returned
// from account_history.get_account_history on 2026-11-23 (event names, sources and base64url protobuf
// data), rebuilt here with test addresses.
import { describe, expect, it } from "vitest";
import { utils } from "koilib";
import { summarizeHistory, NETWORKS } from "../src/chain";
import { concat, fieldBytes, fieldVarint } from "../src/abi-lite";

const ME = "1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ", OTHER = "1sXttKzfrzH8amTpfRHX8SXT7kynjNpMX";
const net = NETWORKS.mainnet!;
const addr = (a: string) => utils.decodeBase58(a);
const b64 = (u: Uint8Array) => utils.encodeBase64url(u);
const burnData = (from: string, value: bigint) => b64(concat([fieldBytes(1, addr(from)), fieldVarint(2, value)]));
const transferData = (from: string, to: string, value: bigint) => b64(concat([fieldBytes(1, addr(from)), fieldBytes(2, addr(to)), fieldVarint(3, value)]));
const allowed = { name: "pqwallet.allowed_caller", source: ME, data: "AA==", impacted: [ME] };
const row = (events: Array<Record<string, unknown>>, reverted = false) => ({
  seq_num: "13",
  trx: { transaction: { id: "0x1220aa" }, receipt: { events, ...(reverted ? { reverted: true } : {}) } },
});
const burnRow = (value: bigint, mintTo = ME, mintValue = value) =>
  row([
    allowed,
    { name: "token.burn_event", source: net.koin, data: burnData(ME, value), impacted: [ME] },
    { name: "token.mint_event", source: net.vhp, data: burnData(mintTo, mintValue), impacted: [mintTo] },
    allowed,
  ]);

describe("history rows", () => {
  it("names a proof-of-burn conversion and its amount", () => {
    const item = summarizeHistory(burnRow(300000000n), ME, net);
    expect(item.burnedForVhp).toBe("300000000");
    expect(item.summary).toBe("burned 3 for VHP");
    // not a transfer: nothing for a wallet to mistake for a token or collectible movement
    expect(item.direction).toBeNull();
    expect(item.contract).toBeNull();
    expect(item.valueBase).toBeNull();
    expect(item.txId).toBe("0x1220aa");
  });

  it("does not call other things a burn", () => {
    // KOIN burned but no VHP minted for the same amount
    expect(summarizeHistory(burnRow(300000000n, ME, 1n), ME, net).burnedForVhp).toBeNull();
    // someone else's burn
    expect(summarizeHistory(burnRow(300000000n), OTHER, net).burnedForVhp).toBeNull();
    // the same event names from other contracts (any token can emit them)
    const foreign = row([
      { name: "token.burn_event", source: OTHER, data: burnData(ME, 5n) },
      { name: "token.mint_event", source: OTHER, data: burnData(ME, 5n) },
    ]);
    expect(summarizeHistory(foreign, ME, net).burnedForVhp).toBeNull();
    expect(summarizeHistory(foreign, ME, net).summary).toBe("transaction");
    // a network with no VHP configured, and a caller that passes no network
    expect(summarizeHistory(burnRow(5n), ME, NETWORKS.devnet!).burnedForVhp).toBeNull();
    expect(summarizeHistory(burnRow(5n), ME).burnedForVhp).toBeNull();
    // data that is not protobuf
    const junk = row([{ name: "token.burn_event", source: net.koin, data: "!!!" }, { name: "token.mint_event", source: net.vhp, data: "!!!" }]);
    expect(summarizeHistory(junk, ME, net).burnedForVhp).toBeNull();
  });

  it("still reads a transfer as before", () => {
    const item = summarizeHistory(row([{ name: "token.transfer_event", source: net.koin, data: transferData(ME, OTHER, 5000000000n) }]), ME, net);
    expect(item).toMatchObject({ direction: "out", counterparty: OTHER, valueBase: "5000000000", contract: net.koin, burnedForVhp: null, summary: `sent 50 to ${OTHER.slice(0, 6)}…${OTHER.slice(-4)}` });
  });
});
