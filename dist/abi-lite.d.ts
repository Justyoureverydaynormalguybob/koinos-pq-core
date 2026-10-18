declare function varint(n: bigint | number): Uint8Array;
declare function concat(parts: Uint8Array[]): Uint8Array;
declare function fieldVarint(field: number, value: bigint | number): Uint8Array;
declare function fieldBytes(field: number, value: Uint8Array): Uint8Array;
declare function fieldString(field: number, value: string): Uint8Array;
/** Decodes one message into { field: [values] } with varints as bigint and length-delimited as bytes. */
export declare function decodeFields(b: Uint8Array): Map<number, Array<bigint | Uint8Array>>;
export declare const TOKEN_ENTRY: {
    readonly name: 2191741823;
    readonly symbol: 3077209249;
    readonly decimals: 4001430831;
    readonly total_supply: 2967091508;
    readonly balance_of: 1550980247;
    readonly transfer: 670398154;
    readonly mint: 3698268091;
};
/** transfer_arguments { bytes from = 1; bytes to = 2; uint64 value = 3; } */
export declare function encodeTransferArgs(from: string, to: string, value: bigint): Uint8Array;
/** mint_arguments { bytes to = 1; uint64 value = 2; } */
export declare function encodeMintArgs(to: string, value: bigint): Uint8Array;
/** balance_of_arguments { bytes owner = 1; } */
export declare function encodeBalanceOfArgs(owner: string): Uint8Array;
/** balance_of_result / total_supply_result { uint64 value = 1; } */
export declare function decodeUint64Result(b: Uint8Array): bigint;
/** name_result / symbol_result { string value = 1; } */
export declare function decodeStringResult(b: Uint8Array): string;
/** decimals_result { uint32 value = 1; } */
export declare function decodeDecimalsResult(b: Uint8Array): number;
export declare const PQWALLET_ENTRY: {
    readonly set_public_key: 1288095259;
    readonly get_public_key: 2523090792;
    readonly get_info: 3179243600;
    readonly set_allowed_caller: 1287194961;
    readonly get_allowed_caller: 3026396941;
};
/** set_public_key_arguments { bytes public_key = 1; bytes proof = 2; } */
export declare function encodeSetPublicKeyArgs(publicKey: Uint8Array, proof: Uint8Array): Uint8Array;
/** get_public_key_result { bytes value = 1; } */
export declare function decodeGetPublicKeyResult(b: Uint8Array): Uint8Array | null;
export interface PqwalletInfoResult {
    scheme: string;
    publicKeyBytes: number;
    signatureBytes: number;
    context: string;
    keyRegistered: boolean;
}
/** get_info_result { string scheme = 1; uint32 public_key_bytes = 2; uint32 signature_bytes = 3; string context = 4; bool key_registered = 5; } */
export declare function decodeGetInfoResult(b: Uint8Array): PqwalletInfoResult;
/** A call_contract operation in koilib's JSON shape, with the args already encoded. */
export declare function callContractOperation(contractId: string, entryPoint: number, args: Uint8Array): {
    call_contract: {
        contract_id: string;
        entry_point: number;
        args: string;
    };
};
export { varint, fieldBytes, fieldString, fieldVarint, concat };
