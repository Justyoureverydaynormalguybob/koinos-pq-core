// Talking to a Koinos node: balances, mana, building and sending a KOIN transfer, history.
// No koilib Contract/Serializer here (they compile encoders with `new Function`); the few messages
// we need are encoded by abi-lite, and transactions themselves by koilib's static protobuf modules.
import { Provider, Transaction, utils } from "koilib";
import { callContractOperation, decodeUint64Result, encodeBalanceOfArgs, encodeTransferArgs, TOKEN_ENTRY } from "./abi-lite.js";
import { signTxId, verifyEntry } from "./sign.js";
export const NETWORKS = {
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
export function formatKoin(base, places = 8) {
    const neg = base < 0n;
    const v = neg ? -base : base;
    const whole = v / ONE_KOIN;
    const frac = (v % ONE_KOIN).toString().padStart(KOIN_DECIMALS, "0").slice(0, places).replace(/0+$/, "");
    return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
/** "1.5" -> 150000000n; rejects anything that is not a plain decimal with at most 8 places */
export function parseKoin(text) {
    const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(text.trim());
    if (!m)
        throw new Error("amount must be a number with at most 8 decimal places");
    return BigInt(m[1]) * ONE_KOIN + BigInt((m[2] ?? "").padEnd(KOIN_DECIMALS, "0"));
}
export function isAddress(s) {
    try {
        const b = utils.decodeBase58(s.trim());
        return b.length === 25 && utils.isChecksumAddress(s.trim());
    }
    catch {
        return false;
    }
}
export class Chain {
    constructor(net) {
        this.net = net;
        this.provider = new Provider(net.rpc);
    }
    /** chain.read_contract with pre-encoded arguments; returns the raw result bytes (empty if none). */
    async read(contractId, entryPoint, args = new Uint8Array(0)) {
        const r = (await this.provider.readContract({ contract_id: contractId, entry_point: entryPoint, args: utils.encodeBase64url(args) }));
        return r.result ? utils.decodeBase64url(r.result) : new Uint8Array(0);
    }
    async balance(address) {
        return decodeUint64Result(await this.read(this.net.koin, TOKEN_ENTRY.balance_of, encodeBalanceOfArgs(address)));
    }
    async mana(address) {
        return BigInt(await this.provider.getAccountRc(address));
    }
    async headHeight() {
        const h = (await this.provider.getHeadInfo());
        return h.head_topology?.height ?? "0";
    }
    /** Builds, signs with the ML-DSA key for the account's mode, checks the signature locally, submits. */
    async sendKoin(opts) {
        const { from, to, valueBase, keys, mode } = opts;
        if (!isAddress(to))
            throw new Error("recipient is not a valid Koinos address");
        if (valueBase <= 0n)
            throw new Error("amount must be positive");
        const operation = callContractOperation(this.net.koin, TOKEN_ENTRY.transfer, encodeTransferArgs(from, to, valueBase));
        let rcLimit = opts.rcLimit;
        if (rcLimit === undefined) {
            // the mempool reserves each pending tx's rc_limit, so never ask for everything
            const avail = await this.mana(from);
            const cap = 10n * ONE_KOIN;
            rcLimit = avail / 2n < cap ? avail / 2n : cap;
            if (rcLimit <= 0n)
                throw new Error("this account has no mana");
        }
        const tx = { header: { payer: from, rc_limit: rcLimit.toString() }, operations: [operation], signatures: [] };
        await Transaction.prepareTransaction(tx, this.provider, from);
        const txId = tx.id;
        const entry = signTxId(txId, keys, mode);
        if (!verifyEntry(entry, txId, keys.publicKey, mode))
            throw new Error("local signature check failed; nothing was sent");
        tx.signatures = [utils.encodeBase64url(entry)];
        const { receipt } = await this.provider.sendTransaction(tx);
        return { txId, receipt: (receipt ?? {}), entryBytes: entry.length };
    }
    /** Resolves with the block height once the transaction is in a block (or throws on timeout). */
    async waitMined(txId, timeoutMs = 90000) {
        const r = (await this.provider.wait(txId, "byBlock", timeoutMs));
        if (typeof r === "object" && r !== null) {
            const o = r;
            return String(o.blockNumber ?? o.blockId ?? JSON.stringify(r));
        }
        return String(r);
    }
    /**
     * Account history through the JSON-RPC gateway (account_history.get_account_history). The REST
     * /v1/account/{a}/history carries the same data but sends no CORS headers, so a browser cannot read it.
     */
    async history(address, limit = 20) {
        const r = (await this.provider.call("account_history.get_account_history", { address, limit, ascending: false, irreversible: false }));
        return (r.values ?? []).map((row) => summarizeHistory(row, address));
    }
}
// token transfer_event { bytes from = 1; bytes to = 2; uint64 value = 3 }, base64url on the JSON-RPC
function decodeTransferEvent(data) {
    const b = utils.decodeBase64url(data);
    const out = {};
    let i = 0;
    const varint = () => {
        let v = 0n, s = 0n;
        for (;;) {
            const c = b[i++];
            if (c === undefined)
                throw new Error("truncated event");
            v |= BigInt(c & 0x7f) << s;
            s += 7n;
            if (c < 0x80)
                return v;
        }
    };
    while (i < b.length) {
        const tag = varint();
        const field = Number(tag >> 3n), wire = Number(tag & 7n);
        if (wire === 2) {
            const len = Number(varint());
            const bytes = b.subarray(i, i + len);
            i += len;
            if (field === 1)
                out.from = utils.encodeBase58(bytes);
            if (field === 2)
                out.to = utils.encodeBase58(bytes);
        }
        else if (wire === 0) {
            const v = varint();
            if (field === 3)
                out.value = v.toString();
        }
        else {
            break;
        }
    }
    return out;
}
function summarizeHistory(row, me) {
    const seq = String(row.seq_num ?? "");
    const trx = row.trx;
    const block = row.block;
    const txId = trx?.transaction?.id ?? null;
    const events = trx?.receipt?.events ?? [];
    let summary = block ? "block produced" : "transaction";
    for (const ev of events) {
        if (typeof ev.name !== "string" || !/(^|\.)transfer_event$/.test(ev.name))
            continue; // mainnet and Harbinger name it differently
        let d = {};
        try {
            d = typeof ev.data === "string" ? decodeTransferEvent(ev.data) : (ev.data ?? {});
        }
        catch {
            continue;
        }
        const amount = d.value ? formatKoin(BigInt(d.value)) : "?";
        if (d.to === me)
            summary = `received ${amount} from ${short(d.from)}`;
        else if (d.from === me)
            summary = `sent ${amount} to ${short(d.to)}`;
        else
            continue;
        break;
    }
    if (trx?.receipt?.reverted)
        summary += " (reverted)";
    return { seq, txId, blockHeight: block?.header?.height ?? null, summary };
}
export function short(a) {
    return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?";
}
