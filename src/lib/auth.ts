import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getUserByEmail, type SafeUser, type UserTier } from "./users";
import { verifyPassword } from "./passwords";

export const SESSION_COOKIE = "recipe_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const SESSION_SECRET =
  process.env.SESSION_SECRET ?? "recipe-search-admin-session-dev-only";

export type Actor = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tier: UserTier;
};

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

// Tokens are <emailB64>.<expiresAt>.<sig> so we can carry emails with dots in
// them safely.
export function createSessionToken(email: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const emailB64 = Buffer.from(email.toLowerCase(), "utf8").toString("base64url");
  const payload = `${emailB64}.${expiresAt}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function parseSessionToken(token: string | undefined | null): {
  email: string;
  expiresAt: number;
} | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [emailB64, expiresAtStr, sig] = parts;
  if (!emailB64 || !expiresAtStr || !sig) return null;
  const expected = sign(`${emailB64}.${expiresAtStr}`);
  if (!safeEqualString(sig, expected)) return null;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null;
  let email: string;
  try {
    email = Buffer.from(emailB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email) return null;
  return { email, expiresAt };
}

export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  const parsed = parseSessionToken(value);
  if (!parsed) return null;
  // Re-validate against the user store on every request so a user whose
  // status flipped to declined/disabled is immediately locked out without
  // waiting for cookie expiry.
  const user = await getUserByEmail(parsed.email);
  if (!user || user.status !== "approved") return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    tier: user.tier,
  };
}

export async function requireActor(): Promise<Actor | null> {
  return getActor();
}

export async function requireAdmin(): Promise<Actor | null> {
  const actor = await getActor();
  return actor && actor.tier === "admin" ? actor : null;
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

// Verify the actor's own password (used by the hard-delete gauntlet, etc.).
export async function verifyActorPassword(
  actor: Actor,
  password: string
): Promise<boolean> {
  const user = await getUserByEmail(actor.email);
  if (!user) return false;
  return verifyPassword(password, user.passwordHash);
}

// Convenience re-export so callers don't have to import from two places.
export type { SafeUser };
