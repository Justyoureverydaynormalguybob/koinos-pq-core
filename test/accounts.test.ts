// More accounts from the same 24 words. The rule is permanent (funds sit at the addresses it produces), so it
// is pinned here three ways: against fixed vectors, against Node's own HMAC, and by its properties.
//
//   seed_0 = the master seed
//   seed_n = HMAC-SHA256(key = master seed, message = ASCII "koinos-pq/account/" + n)      for n >= 1
//
// "account" below is the pqwallet account's address (the bootstrap secp256k1 key of seed_n) and "pq" the
// address of seed_n's ML-DSA-44 key (the account on a chain with native ML-DSA).
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { accountSeed, bootstrapSigner, bytesToHex, deriveAccountKeys, deriveKeys, MAX_ACCOUNT_NUMBER } from "../src/keys";

const MASTER = Uint8Array.from({ length: 32 }, (_, i) => i); // 00 01 02 ... 1f
const VECTORS = [
  { n: 0, seed: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", pq: "16qXTwZiZiJ18CRSfLnGbHVVbxWYmkhfbR", account: "1D7pw3s49SV2aZZo9EmqAXwTrC9izUqLhw" },
  { n: 1, seed: "f1962996fd5a58e3259c4b28703bfb04c81801a3fe24367ebbfc31e803d40de6", pq: "1JwgJUucjwQPZe4XQCJtc7GrBsf3Bdebmm", account: "1LrfcK1GcBjG5QT9LrLGgSKrxwLG25acoY" },
  { n: 2, seed: "ae5cddf349224274a0d8edf432e8c34e96fe69a55c3f30c76e2f1568bd273a72", pq: "125gYkmYsJuLvEqyn4HHTkTeVWuE4NfDCG", account: "1GMDLGPsUzQuSdNqcyCwiRfB44g7tmUkHP" },
  { n: 10, seed: "8e8ac721f936fffd6fccd028fe8ee783b27aee771b10b140bf1783dc8369f629", pq: "1HTom9FczpfdxDqSNmAxpaUg3boUQdThrw", account: "13NtMbYxXMop4536aVfDFGHJ4nYgBKiMvD" },
  { n: 2147483647, seed: "8bb75c295aec5a56888e23a7ee98c3c82b56d20c120229f42c95752426165745", pq: "1NLGiJhgdFLaVQajZCydrb2i9Q34cxfWSs", account: "1QKQEWfav6boh3GbS3PeMAA7kA3zui2ejP" },
];

describe("accounts from one seed", () => {
  it("matches the fixed vectors", () => {
    for (const v of VECTORS) {
      const seed = accountSeed(MASTER, v.n);
      expect(bytesToHex(seed), `seed ${v.n}`).toBe(v.seed);
      expect(deriveAccountKeys(MASTER, v.n).address, `pq ${v.n}`).toBe(v.pq);
      expect(bootstrapSigner(seed).getAddress(), `account ${v.n}`).toBe(v.account);
    }
  });

  it("is HMAC-SHA256 of the account label under the master seed, as an independent implementation computes it", () => {
    for (const n of [1, 2, 3, 99, 4096]) {
      const ref = createHmac("sha256", Buffer.from(MASTER)).update(`koinos-pq/account/${n}`, "ascii").digest("hex");
      expect(bytesToHex(accountSeed(MASTER, n))).toBe(ref);
    }
  });

  it("leaves account 0 exactly as a wallet without this rule derives it", () => {
    expect(bytesToHex(accountSeed(MASTER, 0))).toBe(bytesToHex(MASTER));
    const plain = deriveKeys(MASTER), zero = deriveAccountKeys(MASTER, 0);
    expect(zero.address).toBe(plain.address);
    expect(bytesToHex(zero.publicKey)).toBe(bytesToHex(plain.publicKey));
    expect(bootstrapSigner(zero.seed).getAddress()).toBe(bootstrapSigner(MASTER).getAddress());
  });

  it("gives every account its own keys, hands out copies, and refuses nonsense", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 12; n++) {
      const k = deriveAccountKeys(MASTER, n);
      seen.add(k.address);
      seen.add(bootstrapSigner(k.seed).getAddress());
      expect(k.seed.length).toBe(32);
    }
    expect(seen.size).toBe(24);
    // the returned seed is the caller's to wipe; the master is untouched by it
    const s0 = accountSeed(MASTER, 0);
    s0.fill(0);
    expect(MASTER[5]).toBe(5);
    // a different master gives different accounts
    const other = Uint8Array.from(MASTER);
    other[0] = 1;
    expect(bytesToHex(accountSeed(other, 1))).not.toBe(VECTORS[1]!.seed);
    for (const bad of [-1, 1.5, Number.NaN, MAX_ACCOUNT_NUMBER + 1]) expect(() => accountSeed(MASTER, bad)).toThrow(/account number/);
    expect(() => accountSeed(new Uint8Array(31), 1)).toThrow(/32 bytes/);
  });
});
