// A tiny protobuf layer for the few contract messages this project needs, so no code generation
// (koilib's ABI serializer compiles encoders with `new Function`, which Manifest V3 extension pages
// forbid and which forces `unsafe-eval` into a web page's CSP). Encodings are checked against
// koilib's serializer in test/abi-lite.test.ts.
//
// Wire format reminders: tag = (field << 3) | wireType; wire type 0 = varint, 2 = length-delimited.
import { utils } from "koilib";

const VARINT = 0, LEN = 2;

function varint(n: bigint | number): Uint8Array {
  let v = BigInt(n);
  if (v < 0n) throw new Error("negative varint");
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return Uint8Array.from(out);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function fieldVarint(field: number, value: bigint | number): Uint8Array {
  // koilib's serializer writes uint64 fields even when zero (transfer value "0" -> 18 00); match it so
  // operation bytes, and therefore transaction ids, are identical to what koilib-built wallets produce.
  return concat([varint((field << 3) | VARINT), varint(BigInt(value))]);
}

function fieldBytes(field: number, value: Uint8Array): Uint8Array {
  if (value.length === 0) return new Uint8Array(0);
  return concat([varint((field << 3) | LEN), varint(value.length), value]);
}

function fieldString(field: number, value: string): Uint8Array {
  return fieldBytes(field, new TextEncoder().encode(value));
}

/** Decodes one message into { field: [values] } with varints as bigint and length-delimited as bytes. */
export function decodeFields(b: Uint8Array): Map<number, Array<bigint | Uint8Array>> {
  const out = new Map<number, Array<bigint | Uint8Array>>();
  let i = 0;
  const readVarint = (): bigint => {
    let v = 0n, s = 0n;
    for (;;) {
      const c = b[i++];
      if (c === undefined) throw new Error("truncated protobuf");
      v |= BigInt(c & 0x7f) << s;
      s += 7n;
      if (c < 0x80) return v;
    }
  };
  while (i < b.length) {
    const tag = readVarint();
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    let value: bigint | Uint8Array;
    if (wire === VARINT) value = readVarint();
    else if (wire === LEN) {
      const len = Number(readVarint());
      value = b.subarray(i, i + len);
      i += len;
    } else if (wire === 1) {
      value = b.subarray(i, i + 8);
      i += 8;
    } else if (wire === 5) {
      value = b.subarray(i, i + 4);
      i += 4;
    } else throw new Error(`unsupported wire type ${wire}`);
    const list = out.get(field) ?? [];
    list.push(value);
    out.set(field, list);
  }
  return out;
}

const addr = (base58: string): Uint8Array => utils.decodeBase58(base58);
const str = (v: bigint | Uint8Array | undefined): string => (v instanceof Uint8Array ? new TextDecoder().decode(v) : "");
const num = (v: bigint | Uint8Array | undefined): bigint => (typeof v === "bigint" ? v : 0n);

// ---- koinos.contracts.token (KCS-1 / KCS-4 compatible entry points) ----
export const TOKEN_ENTRY = {
  name: 0x82a3537f,
  symbol: 0xb76a7ca1,
  decimals: 0xee80fd2f,
  total_supply: 0xb0da3934,
  balance_of: 0x5c721497,
  transfer: 0x27f576ca,
  mint: 0xdc6f17bb,
} as const;

/** transfer_arguments { bytes from = 1; bytes to = 2; uint64 value = 3; } */
export function encodeTransferArgs(from: string, to: string, value: bigint): Uint8Array {
  return concat([fieldBytes(1, addr(from)), fieldBytes(2, addr(to)), fieldVarint(3, value)]);
}
/** mint_arguments { bytes to = 1; uint64 value = 2; } */
export function encodeMintArgs(to: string, value: bigint): Uint8Array {
  return concat([fieldBytes(1, addr(to)), fieldVarint(2, value)]);
}
/** balance_of_arguments { bytes owner = 1; } */
export function encodeBalanceOfArgs(owner: string): Uint8Array {
  return fieldBytes(1, addr(owner));
}
/** balance_of_result / total_supply_result { uint64 value = 1; } */
export function decodeUint64Result(b: Uint8Array): bigint {
  return num(decodeFields(b).get(1)?.[0]);
}
/** name_result / symbol_result { string value = 1; } */
export function decodeStringResult(b: Uint8Array): string {
  return str(decodeFields(b).get(1)?.[0]);
}
/** decimals_result { uint32 value = 1; } */
export function decodeDecimalsResult(b: Uint8Array): number {
  return Number(num(decodeFields(b).get(1)?.[0]));
}

// ---- koinos-pq pqwallet contract ----
export const PQWALLET_ENTRY = {
  set_public_key: 0x4cc6c61b,
  get_public_key: 0x96634f68,
  get_info: 0xbd7f6850,
  set_allowed_caller: 0x4cb90951,
  get_allowed_caller: 0xb463270d,
} as const;

/** set_public_key_arguments { bytes public_key = 1; bytes proof = 2; } */
export function encodeSetPublicKeyArgs(publicKey: Uint8Array, proof: Uint8Array): Uint8Array {
  return concat([fieldBytes(1, publicKey), fieldBytes(2, proof)]);
}
/** get_public_key_result { bytes value = 1; } */
export function decodeGetPublicKeyResult(b: Uint8Array): Uint8Array | null {
  const v = decodeFields(b).get(1)?.[0];
  return v instanceof Uint8Array && v.length ? Uint8Array.from(v) : null;
}
export interface PqwalletInfoResult {
  scheme: string;
  publicKeyBytes: number;
  signatureBytes: number;
  context: string;
  keyRegistered: boolean;
}
/** get_info_result { string scheme = 1; uint32 public_key_bytes = 2; uint32 signature_bytes = 3; string context = 4; bool key_registered = 5; } */
export function decodeGetInfoResult(b: Uint8Array): PqwalletInfoResult {
  const f = decodeFields(b);
  return {
    scheme: str(f.get(1)?.[0]),
    publicKeyBytes: Number(num(f.get(2)?.[0])),
    signatureBytes: Number(num(f.get(3)?.[0])),
    context: str(f.get(4)?.[0]),
    keyRegistered: num(f.get(5)?.[0]) !== 0n,
  };
}

/** A call_contract operation in koilib's JSON shape, with the args already encoded. */
export function callContractOperation(contractId: string, entryPoint: number, args: Uint8Array): { call_contract: { contract_id: string; entry_point: number; args: string } } {
  return { call_contract: { contract_id: contractId, entry_point: entryPoint, args: utils.encodeBase64url(args) } };
}

export { varint, fieldBytes, fieldString, fieldVarint, concat };
