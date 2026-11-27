// What the external review of 2026-11-27 (koinos-pq-wallet issue #1) found in this package, pinned:
//   - a devnet node that reports a pinned chain's id is refused (item 2);
//   - "the node could not say" is told apart from "no such transaction" and from "no contract" (item 7,
//     small things);
//   - history shows the KOIN contract's transfer event, not whichever a called contract emitted first.
import { describe, expect, it } from "vitest";
import { utils } from "koilib";
import { Chain, NETWORKS, pinnedNetworkOf, summarizeHistory } from "../src/chain";
import { pqwalletInfo, setPqwalletInfoRetryMs } from "../src/setup";
import { concat, fieldBytes, fieldVarint } from "../src/abi-lite";

const provider = (chain: Chain) => chain.provider as unknown as Record<string, unknown>;

describe("chain id", () => {
  it("a devnet node may not answer with mainnet's or testnet's chain id", async () => {
    for (const real of ["mainnet", "testnet"] as const) {
      const chain = new Chain({ ...NETWORKS.devnet! });
      provider(chain).getChainId = async () => NETWORKS[real]!.chainId;
      await expect(chain.chainId()).rejects.toThrow(new RegExp(`chain id of ${real}`));
    }
    const own = new Chain({ ...NETWORKS.devnet! });
    provider(own).getChainId = async () => "EiDevnetDevnetDevnetDevnetDevnetDevnetDevnet0=";
    expect(await own.chainId()).toBe("EiDevnetDevnetDevnetDevnetDevnetDevnetDevnet0=");
    expect(pinnedNetworkOf(NETWORKS.mainnet!.chainId!)).toBe("mainnet");
    expect(pinnedNetworkOf("x")).toBeNull();
  });

  it("a pinned network still refuses a node that reports any other id", async () => {
    const chain = new Chain({ ...NETWORKS.testnet! });
    provider(chain).getChainId = async () => NETWORKS.mainnet!.chainId;
    await expect(chain.chainId()).rejects.toThrow(/refusing/);
  });
});

describe("what the node did not say", () => {
  it("txStatus: landed, absent, and unknown when the node cannot be asked", async () => {
    const chain = new Chain({ ...NETWORKS.testnet! });
    provider(chain).getTransactionsById = async () => ({ transactions: [{}] });
    expect(await chain.txStatus("0x1220aa")).toBe("landed");
    provider(chain).getTransactionsById = async () => ({});
    expect(await chain.txStatus("0x1220aa")).toBe("absent");
    provider(chain).getTransactionsById = async () => {
      throw new Error("fetch failed");
    };
    expect(await chain.txStatus("0x1220aa")).toBe("unknown");
    expect(await chain.landed("0x1220aa")).toBe(false);
  });

  it("pqwalletInfo: 'no contract' only on the node's word; an unanswered read throws", async () => {
    setPqwalletInfoRetryMs(1);
    const chain = new Chain({ ...NETWORKS.testnet! });
    const A = "1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ";
    let calls = 0;
    provider(chain).readContract = async () => {
      calls++;
      throw new Error("fetch failed");
    };
    await expect(pqwalletInfo(chain, A)).rejects.toThrow(/did not answer/);
    expect(calls).toBe(3);
    // the node's own refusal (koilib throws the RPC error as JSON): there is no such contract
    provider(chain).readContract = async () => {
      throw new Error(JSON.stringify({ error: "contract does not exist", code: -32603 }));
    };
    expect(await pqwalletInfo(chain, A)).toEqual({ deployed: false, keyRegistered: false });
    // one failed read, then an answer: the answer counts
    let n = 0;
    const info = concat([fieldBytes(1, new TextEncoder().encode("ML-DSA-44")), fieldVarint(2, 1312), fieldVarint(3, 2420), fieldVarint(5, 1)]);
    provider(chain).readContract = async () => {
      if (n++ === 0) throw new Error("AMQP connection is not open");
      return { result: utils.encodeBase64url(info) };
    };
    expect(await pqwalletInfo(chain, A)).toEqual({ deployed: true, keyRegistered: true });
  });
});

describe("history", () => {
  it("shows the KOIN contract's transfer, not one a called contract emitted first", () => {
    const ME = "1LQYsdpGuA3nwU5G1jANCnMWs3yYWfHwkQ", OTHER = "1sXttKzfrzH8amTpfRHX8SXT7kynjNpMX", FAKE = "1FqXVbjZnMo2cUNj56LNCrc8R22RWDmq1t";
    const net = NETWORKS.mainnet!;
    const data = (from: string, to: string, value: bigint) => utils.encodeBase64url(concat([fieldBytes(1, utils.decodeBase58(from)), fieldBytes(2, utils.decodeBase58(to)), fieldVarint(3, value)]));
    const row = {
      seq_num: "4",
      trx: {
        transaction: { id: "0x1220bb" },
        receipt: {
          events: [
            { name: "token.transfer_event", source: FAKE, data: data(OTHER, ME, 900_00000000n) }, // "you received 900"
            { name: "token.transfer_event", source: net.koin, data: data(ME, OTHER, 5_00000000n) }, // what really happened
          ],
        },
      },
    };
    const item = summarizeHistory(row, ME, net);
    expect(item.direction).toBe("out");
    expect(item.contract).toBe(net.koin);
    expect(item.valueBase).toBe("500000000");
    expect(item.transfers).toBe(2);
    // with no KOIN event the first one is shown, under its own contract, for the wallet to label
    const only = summarizeHistory({ ...row, trx: { ...row.trx, receipt: { events: [row.trx.receipt.events[0]!] } } }, ME, net);
    expect(only.contract).toBe(FAKE);
    expect(only.transfers).toBe(1);
  });
});
