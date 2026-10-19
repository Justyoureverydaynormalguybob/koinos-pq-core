import { Provider } from "koilib";
import type { PqKeys } from "./keys.js";
import { type AccountMode } from "./sign.js";
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
export declare const NETWORKS: Record<string, Network>;
export declare const KOIN_DECIMALS = 8;
export declare function formatKoin(base: bigint, places?: number): string;
/** "1.5" -> 150000000n; rejects anything that is not a plain decimal with at most 8 places */
export declare function parseKoin(text: string): bigint;
export declare function isAddress(s: string): boolean;
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
export declare class Chain {
    readonly net: Network;
    readonly provider: Provider;
    constructor(net: Network);
    /** chain.read_contract with pre-encoded arguments; returns the raw result bytes (empty if none). */
    read(contractId: string, entryPoint: number, args?: Uint8Array): Promise<Uint8Array>;
    balance(address: string): Promise<bigint>;
    /** balance_of on any KCS-4 token contract, in the token's base units. */
    tokenBalance(contract: string, address: string): Promise<bigint>;
    /** name, symbol and decimals of a KCS-4 token contract. Throws if the contract does not answer like a token. */
    tokenInfo(contract: string): Promise<{
        name: string;
        symbol: string;
        decimals: number;
    }>;
    mana(address: string): Promise<bigint>;
    headHeight(): Promise<string>;
    /**
     * Builds a token transfer, signs it with the ML-DSA key for the account's mode, checks the signature
     * locally, submits. `contract` is the token (KCS-4 `transfer` entry point); it defaults to KOIN, and any
     * other token goes through exactly the same path with a different contract id.
     */
    sendKoin(opts: {
        from: string;
        to: string;
        valueBase: bigint;
        keys: PqKeys;
        mode: AccountMode;
        rcLimit?: bigint;
        contract?: string;
    }): Promise<SendResult>;
    /** Resolves with the block height once the transaction is in a block (or throws on timeout). */
    waitMined(txId: string, timeoutMs?: number): Promise<string>;
    /**
     * Account history through the JSON-RPC gateway (account_history.get_account_history). The REST
     * /v1/account/{a}/history carries the same data but sends no CORS headers, so a browser cannot read it.
     */
    history(address: string, limit?: number): Promise<HistoryItem[]>;
}
export declare function short(a: string | undefined): string;
