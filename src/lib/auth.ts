import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "recipe_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Credentials. Both can be overridden via env vars in production; the
// defaults are the values the user explicitly requested for the initial
// admin account.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "kyallbright";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Tallbright22!";
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? "recipe-search-admin-session-dev-only";

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still do a constant-time compare against ab to mitigate length-leak
    // timing differences for this code path.
    timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function verifyCredentials(username: string, password: string): boolean {
  const userOk = safeEqualString(username ?? "", ADMIN_USERNAME);
  const passOk = safeEqualString(password ?? "", ADMIN_PASSWORD);
  return userOk && passOk;
}

export function verifyPasswordOnly(password: string): boolean {
  return safeEqualString(password ?? "", ADMIN_PASSWORD);
}

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(actor: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${actor}.${expiresAt}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function parseSessionToken(token: string | undefined | null): {
  actor: string;
  expiresAt: number;
} | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [actor, expiresAtStr, sig] = parts;
  if (!actor || !expiresAtStr || !sig) return null;
  const expected = sign(`${actor}.${expiresAtStr}`);
  if (!safeEqualString(sig, expected)) return null;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null;
  return { actor, expiresAt };
}

export async function getActor(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  const parsed = parseSessionToken(value);
  return parsed?.actor ?? null;
}

export async function requireActor(): Promise<string | null> {
  return getActor();
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
