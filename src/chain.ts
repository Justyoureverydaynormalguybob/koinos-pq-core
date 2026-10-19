// Talking to a Koinos node: balances, mana, building and sending a KOIN transfer, history.
// No koilib Contract/Serializer here (they compile encoders with `new Function`); the few messages
// we need are encoded by abi-lite, and transactions themselves by koilib's static protobuf modules.
import { Provider, Transaction, utils } from "koilib";
import { callContractOperation, decodeDecimalsResult, decodeStringResult, decodeUint64Result, encodeBalanceOfArgs, encodeTransferArgs, TOKEN_ENTRY } from "./abi-lite.js";
import type { PqKeys } from "./keys.js";
import { signTxId, verifyEntry, type AccountMode } from "./sign.js";

export interface Network {
  name: string;
  rpc: string[];
  /** REST base (history is read over JSON-RPC instead; REST sends no CORS headers), or null */
  rest: string | null;
  koin: string;
  explorerTx: ((id: string) => string) | null;
  /** blocks arrive on their own (false on the hand-driven devnet) */
  autoBlocks: boolean;
}

export const NETWORKS: Record<string, Network> = {
  mainnet: {
    name: "mainnet",
    rpc: ["https://api.koinos.io/jsonrpc"],
    rest: "https://api.koinos.io/v1",
    // KOIN moved to this contract; the original 15DJN4a8SgrbGhhGksSBASiSYjGnMU8dGL still answers name/symbol but
    // every state read on it fails with "user code cannot access system space" (checked 2026-10-18).
    koin: "19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK",
    explorerTx: (id) => `https://koinosblocks.com/tx/${id}`,
    autoBlocks: true,
  },
  testnet: {
    name: "testnet",
    rpc: ["https://testnet.koinosfoundation.org/jsonrpc"],
    rest: "https://testnet.koinosfoundation.org/v1",
    koin: "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju",
    explorerTx: (id) => `https://harbinger.koinosblocks.com/tx/${id}`,
    autoBlocks: true,
  },
  devnet: {
    name: "devnet",
    rpc: ["http://127.0.0.1:8080/"],
    rest: null,
    koin: "1BRmrUgtSQVUggoeE9weG4f7nidyydnYfQ",
    explorerTx: null,
    autoBlocks: false,
  },
};

export const KOIN_DECIMALS = 8;
const ONE_KOIN = 10n ** BigInt(KOIN_DECIMALS);
const MAX_UINT64 = 0xffffffffffffffffn;

export function formatKoin(base: bigint, places = 8): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const whole = v / ONE_KOIN;
  const frac = (v % ONE_KOIN).toString().padStart(KOIN_DECIMALS, "0").slice(0, places).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** "1.5" -> 150000000n; rejects anything that is not a plain decimal with at most 8 places */
export function parseKoin(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(text.trim());
  if (!m) throw new Error("amount must be a number with at most 8 decimal places");
  const v = BigInt(m[1]!) * ONE_KOIN + BigInt((m[2] ?? "").padEnd(KOIN_DECIMALS, "0"));
  if (v > MAX_UINT64) throw new Error("amount is larger than the chain can represent");
  return v;
}

export function isAddress(s: string): boolean {
  try {
    const b = utils.decodeBase58(s.trim());
    return b.length === 25 && utils.isChecksumAddress(s.trim());
  } catch {
    return false;
  }
}

export interface SendResult {
  txId: string;
  receipt: Record<string, unknown>;
  entryBytes: number;
}

export interface HistoryItem {
  seq: string;
  txId: string | null;
  blockHeight: string | null;
  /** a sentence assuming KOIN (8 decimals); use the fields below to label other tokens */
  summary: string;
  /** for a transfer that touched this address: the token contract, the amount in base units, and the other party */
  contract: string | null;
  valueBase: string | null;
  direction: "in" | "out" | null;
  counterparty: string | null;
  reverted: boolean;
}

export class Chain {
  readonly provider: Provider;

  constructor(readonly net: Network) {
    this.provider = new Provider(net.rpc);
  }

  /** chain.read_contract with pre-encoded arguments; returns the raw result bytes (empty if none). */
  async read(contractId: string, entryPoint: number, args: Uint8Array = new Uint8Array(0)): Promise<Uint8Array> {
    const r = (await this.provider.readContract({ contract_id: contractId, entry_point: entryPoint, args: utils.encodeBase64url(args) })) as { result?: string };
    return r.result ? utils.decodeBase64url(r.result) : new Uint8Array(0);
  }

  async balance(address: string): Promise<bigint> {
    return this.tokenBalance(this.net.koin, address);
  }

  /** balance_of on any KCS-4 token contract, in the token's base units. */
  async tokenBalance(contract: string, address: string): Promise<bigint> {
    return decodeUint64Result(await this.read(contract, TOKEN_ENTRY.balance_of, encodeBalanceOfArgs(address)));
  }

  /** name, symbol and decimals of a KCS-4 token contract. Throws if the contract does not answer like a token. */
  async tokenInfo(contract: string): Promise<{ name: string; symbol: string; decimals: number }> {
    const name = decodeStringResult(await this.read(contract, TOKEN_ENTRY.name));
    const symbol = decodeStringResult(await this.read(contract, TOKEN_ENTRY.symbol));
    const decimals = decodeDecimalsResult(await this.read(contract, TOKEN_ENTRY.decimals));
    if (!symbol || decimals > 18) throw new Error("this contract does not answer like a token");
    return { name, symbol, decimals };
  }

  async mana(address: string): Promise<bigint> {
    return BigInt(await this.provider.getAccountRc(address));
  }

  async headHeight(): Promise<string> {
    const h = (await this.provider.getHeadInfo()) as { head_topology?: { height?: string } };
    return h.head_topology?.height ?? "0";
  }

  /**
   * Builds a token transfer, signs it with the ML-DSA key for the account's mode, checks the signature
   * locally, submits. `contract` is the token (KCS-4 `transfer` entry point); it defaults to KOIN, and any
   * other token goes through exactly the same path with a different contract id.
   */
  async sendKoin(opts: { from: string; to: string; valueBase: bigint; keys: PqKeys; mode: AccountMode; rcLimit?: bigint; contract?: string }): Promise<SendResult> {
    const { from, to, valueBase, keys, mode } = opts;
    const contract = opts.contract ?? this.net.koin;
    if (!isAddress(to)) throw new Error("recipient is not a valid Koinos address");
    if (valueBase <= 0n) throw new Error("amount must be positive");
    return this.sendCall({ from, contract, entryPoint: TOKEN_ENTRY.transfer, args: encodeTransferArgs(from, to, valueBase), keys, mode, rcLimit: opts.rcLimit });
  }

  /**
   * The one signing path: a single call_contract operation with pre-encoded arguments (a KCS-4 or KCS-5
   * transfer, say), built, signed with the ML-DSA key for the account's mode, checked locally, submitted.
   */
  async sendCall(opts: { from: string; contract: string; entryPoint: number; args: Uint8Array; keys: PqKeys; mode: AccountMode; rcLimit?: bigint }): Promise<SendResult> {
    const { from, contract, entryPoint, args, keys, mode } = opts;
    if (!isAddress(from)) throw new Error("sender is not a valid Koinos address");
    if (!isAddress(contract)) throw new Error("contract is not a valid Koinos address");
    if (!Number.isInteger(entryPoint) || entryPoint < 0 || entryPoint > 0xffffffff) throw new Error("bad entry point");
    const operation = callContractOperation(contract, entryPoint, args);

    let rcLimit = opts.rcLimit;
    if (rcLimit === undefined) {
      // the mempool reserves each pending tx's rc_limit, so never ask for everything
      const avail = await this.mana(from);
      const cap = 10n * ONE_KOIN;
      rcLimit = avail / 2n < cap ? avail / 2n : cap;
      if (rcLimit <= 0n) throw new Error("this account has no mana");
    }

    const tx: Record<string, unknown> = { header: { payer: from, rc_limit: rcLimit.toString() }, operations: [operation], signatures: [] };
    await Transaction.prepareTransaction(tx as never, this.provider, from);
    const txId = (tx as { id: string }).id;

    const entry = signTxId(txId, keys, mode);
    if (!verifyEntry(entry, txId, keys.publicKey, mode)) throw new Error("local signature check failed; nothing was sent");
    (tx as { signatures: string[] }).signatures = [utils.encodeBase64url(entry)];

    const { receipt } = await this.provider.sendTransaction(tx as never);
    return { txId, receipt: (receipt ?? {}) as unknown as Record<string, unknown>, entryBytes: entry.length };
  }

  /** Resolves with the block height once the transaction is in a block (or throws on timeout). */
  async waitMined(txId: string, timeoutMs = 90_000): Promise<string> {
    const r = (await this.provider.wait(txId, "byBlock", timeoutMs)) as unknown;
    if (typeof r === "object" && r !== null) {
      const o = r as { blockNumber?: number | string; blockId?: string };
      return String(o.blockNumber ?? o.blockId ?? JSON.stringify(r));
    }
    return String(r);
  }

  /**
   * Account history through the JSON-RPC gateway (account_history.get_account_history). The REST
   * /v1/account/{a}/history carries the same data but sends no CORS headers, so a browser cannot read it.
   */
  async history(address: string, limit = 20): Promise<HistoryItem[]> {
    const r = (await this.provider.call("account_history.get_account_history", { address, limit, ascending: false, irreversible: false })) as {
      values?: Array<Record<string, unknown>>;
    };
    return (r.values ?? []).map((row) => summarizeHistory(row, address));
  }
}

// token transfer_event { bytes from = 1; bytes to = 2; uint64 value = 3 }, base64url on the JSON-RPC
function decodeTransferEvent(data: string): { from?: string; to?: string; value?: string } {
  const b = utils.decodeBase64url(data);
  const out: { from?: string; to?: string; value?: string } = {};
  let i = 0;
  const varint = (): bigint => {
    let v = 0n, s = 0n;
    for (;;) {
      const c = b[i++];
      if (c === undefined) throw new Error("truncated event");
      v |= BigInt(c & 0x7f) << s;
      s += 7n;
      if (c < 0x80) return v;
    }
  };
  while (i < b.length) {
    const tag = varint();
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 2) {
      const len = Number(varint());
      const bytes = b.subarray(i, i + len);
      i += len;
      if (field === 1) out.from = utils.encodeBase58(bytes);
      if (field === 2) out.to = utils.encodeBase58(bytes);
    } else if (wire === 0) {
      const v = varint();
      if (field === 3) out.value = v.toString();
    } else {
      break;
    }
  }
  return out;
}

function summarizeHistory(row: Record<string, unknown>, me: string): HistoryItem {
  const seq = String(row.seq_num ?? "");
  const trx = row.trx as { transaction?: { id?: string }; receipt?: { events?: Array<Record<string, unknown>>; reverted?: boolean } } | undefined;
  const block = row.block as { header?: { height?: string } } | undefined;
  const txId = trx?.transaction?.id ?? null;
  const events = trx?.receipt?.events ?? [];
  let summary = block ? "block produced" : "transaction";
  let contract: string | null = null, valueBase: string | null = null, direction: "in" | "out" | null = null, counterparty: string | null = null;
  for (const ev of events) {
    if (typeof ev.name !== "string" || !/(^|\.)transfer_event$/.test(ev.name)) continue; // mainnet and Harbinger name it differently
    let d: { from?: string; to?: string; value?: string } = {};
    try {
      d = typeof ev.data === "string" ? decodeTransferEvent(ev.data) : ((ev.data ?? {}) as typeof d);
    } catch {
      continue;
    }
    const amount = d.value ? formatKoin(BigInt(d.value)) : "?";
    if (d.to === me) {
      summary = `received ${amount} from ${short(d.from)}`;
      direction = "in";
      counterparty = d.from ?? null;
    } else if (d.from === me) {
      summary = `sent ${amount} to ${short(d.to)}`;
      direction = "out";
      counterparty = d.to ?? null;
    } else continue;
    contract = typeof ev.source === "string" ? ev.source : null;
    valueBase = d.value ?? null;
    break;
  }
  const reverted = !!trx?.receipt?.reverted;
  if (reverted) summary += " (reverted)";
  return { seq, txId, blockHeight: block?.header?.height ?? null, summary, contract, valueBase, direction, counterparty, reverted };
}

export function short(a: string | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?";
}
