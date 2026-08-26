import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/** scrypt params — strong enough for interactive logins without being too slow. */
const KEYLEN = 64;
const N = 16384;
const R = 8;
const P = 1;

/**
 * Hash format: scrypt$N$r$p$saltB64$keyB64
 * Never store plaintext passwords.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEYLEN, { N, r: R, p: P })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const Nstored = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(Nstored) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = (await scrypt(password, salt, expected.length, {
    N: Nstored,
    r,
    p,
  })) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Hash opaque auth tokens for storage. Tokens are already high-entropy random,
 * so SHA-256 is appropriate (scrypt here only added login-adjacent latency).
 */
export async function hashToken(token: string): Promise<string> {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}
