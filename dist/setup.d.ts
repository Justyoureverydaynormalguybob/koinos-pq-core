import type { Chain } from "./chain.js";
import { type PqKeys } from "./keys.js";
export type SetupStep = "checking" | "uploading" | "registering" | "verifying" | "done";
export interface SetupStatus {
    step: SetupStep;
    message: string;
    txId?: string;
}
export interface SetupResult {
    account: string;
    uploadTx: string | null;
    registerTx: string | null;
}
export interface SetupCosts {
    deployRc: bigint;
    registerRc: bigint;
    /** mana the account should hold before starting (base units, 1e-8 KOIN) */
    requiredMana: bigint;
}
export interface ResourcePrices {
    /** rc per byte of state written */
    disk: bigint;
    /** rc per byte of transaction */
    network: bigint;
    /** rc per compute tick */
    compute: bigint;
}
export declare function setupCostsFromPrices(p: ResourcePrices): SetupCosts;
/** Live prices from the node's resource market (chain.get_resource_limits). */
export declare function estimateSetupCosts(chain: Chain): Promise<SetupCosts>;
export declare function bootstrapAddress(keys: PqKeys): string;
export interface PqwalletInfo {
    deployed: boolean;
    keyRegistered: boolean;
}
/** get_info on the account; any failure to read it counts as "no contract there". */
export declare function pqwalletInfo(chain: Chain, account: string): Promise<PqwalletInfo>;
export declare function registeredPublicKey(chain: Chain, account: string): Promise<Uint8Array | null>;
/**
 * The operations of the single activation transaction, in order: install the contract with every
 * authority locked to it, then register this key with its proof of possession.
 */
export declare function activationOperations(account: string, keys: PqKeys, bytecode: Uint8Array): Array<Record<string, unknown>>;
export declare function setupPqwalletAccount(chain: Chain, keys: PqKeys, onStatus: (s: SetupStatus) => void): Promise<SetupResult>;
