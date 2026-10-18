import { Contract, Provider } from "koilib";
import type { PqKeys } from "./keys.js";
import { type AccountMode } from "./sign.js";
export interface Network {
    name: string;
    rpc: string[];
    /** REST base for account history, or null when the node has none */
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
    summary: string;
}
export declare class Chain {
    readonly net: Network;
    readonly provider: Provider;
    readonly koin: Contract;
    constructor(net: Network);
    balance(address: string): Promise<bigint>;
    mana(address: string): Promise<bigint>;
    headHeight(): Promise<string>;
    /** Builds, signs with the ML-DSA key for the account's mode, checks the signature locally, submits. */
    sendKoin(opts: {
        from: string;
        to: string;
        valueBase: bigint;
        keys: PqKeys;
        mode: AccountMode;
        rcLimit?: bigint;
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
