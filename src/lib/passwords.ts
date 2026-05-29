import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Stored format: "scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>"
// We keep the cost params in the string so we can bump them later without
// breaking existing hashes.
const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("Empty password");
  }
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEY_LEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored || typeof plain !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const Nval = parseInt(nStr, 10);
  const rval = parseInt(rStr, 10);
  const pval = parseInt(pStr, 10);
  if (!Number.isFinite(Nval) || !Number.isFinite(rval) || !Number.isFinite(pval)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, expected.length, { N: Nval, r: rval, p: pval });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function isStrongEnough(plain: string): { ok: boolean; reason?: string } {
  if (typeof plain !== "string") return { ok: false, reason: "Password required." };
  if (plain.length < 8) return { ok: false, reason: "Password must be at least 8 characters." };
  return { ok: true };
}
