import { head, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "./passwords";

export type UserTier = "general" | "admin";
export type UserStatus = "pending" | "approved" | "declined" | "disabled";

export type User = {
  id: string;
  email: string; // always stored lowercased
  firstName: string;
  lastName: string;
  passwordHash: string;
  tier: UserTier;
  status: UserStatus;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  declinedAt?: string;
  declinedBy?: string;
  lastLoginAt?: string;
};

// Returned to the client - never includes passwordHash.
export type SafeUser = Omit<User, "passwordHash">;

export type UserStoreSnapshot = {
  version: number;
  updatedAt: string;
  users: User[];
};

export type UserAuditEntry = {
  at: string;
  actor: string;
  action:
    | "signup"
    | "login"
    | "approve"
    | "decline"
    | "disable"
    | "promote"
    | "demote"
    | "delete"
    | "seed";
  userId: string;
  userEmail: string;
  details?: Record<string, unknown>;
};

const SNAPSHOT_PATH = "users/v1/store.json";
const AUDIT_PATH = "users/v1/audit-log.json";
const BACKUP_PREFIX = "users/v1/backups/";

// The initial admin account. Auto-seeded on first read so the app is usable
// out of the box without provisioning. Password is hashed in-memory with a
// fresh random salt at boot, then persisted.
const SEED_USERS: ReadonlyArray<{
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  tier: UserTier;
}> = [
  {
    email: "ky.allbright@gmail.com",
    firstName: "Kyle",
    lastName: "Allbright",
    password: "Tallbright22!",
    tier: "admin",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function hasBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readJson<T>(pathname: string): Promise<T | null> {
  if (!hasBlob()) return null;
  try {
    const meta = await head(pathname);
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(pathname: string, data: unknown): Promise<void> {
  if (!hasBlob()) return;
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

let snapshotCache: UserStoreSnapshot | null = null;
let auditCache: UserAuditEntry[] | null = null;

function buildSeed(): UserStoreSnapshot {
  const now = nowIso();
  return {
    version: 1,
    updatedAt: now,
    users: SEED_USERS.map((s) => ({
      id: randomUUID(),
      email: s.email.toLowerCase(),
      firstName: s.firstName,
      lastName: s.lastName,
      passwordHash: hashPassword(s.password),
      tier: s.tier,
      status: "approved" as UserStatus,
      createdAt: now,
      approvedAt: now,
      approvedBy: "system:seed",
    })),
  };
}

async function backupSnapshot(snapshot: UserStoreSnapshot): Promise<void> {
  if (!hasBlob()) return;
  try {
    const stamp = nowIso().replace(/[:.]/g, "-");
    await put(`${BACKUP_PREFIX}${stamp}.json`, JSON.stringify(snapshot, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (err) {
    console.warn("User snapshot backup failed:", err);
  }
}

async function loadSnapshot(): Promise<UserStoreSnapshot> {
  if (snapshotCache) return snapshotCache;
  const remote = await readJson<UserStoreSnapshot>(SNAPSHOT_PATH);
  if (remote) {
    snapshotCache = remote;
    return remote;
  }
  const seeded = buildSeed();
  if (hasBlob()) await writeJson(SNAPSHOT_PATH, seeded);
  snapshotCache = seeded;
  return seeded;
}

async function loadAudit(): Promise<UserAuditEntry[]> {
  if (auditCache) return auditCache;
  const remote = await readJson<UserAuditEntry[]>(AUDIT_PATH);
  auditCache = remote ?? [];
  return auditCache;
}

async function commit(
  snapshot: UserStoreSnapshot,
  audit: UserAuditEntry
): Promise<void> {
  snapshot.updatedAt = nowIso();
  await backupSnapshot(snapshot);
  await writeJson(SNAPSHOT_PATH, snapshot);
  const log = await loadAudit();
  log.push(audit);
  await writeJson(AUDIT_PATH, log);
  snapshotCache = snapshot;
  auditCache = log;
}

export function toSafeUser(u: User): SafeUser {
  // Pull every field explicitly so passwordHash never leaks even if the
  // shape grows.
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    tier: u.tier,
    status: u.status,
    createdAt: u.createdAt,
    approvedAt: u.approvedAt,
    approvedBy: u.approvedBy,
    declinedAt: u.declinedAt,
    declinedBy: u.declinedBy,
    lastLoginAt: u.lastLoginAt,
  };
}

export async function listUsers(): Promise<SafeUser[]> {
  const snap = await loadSnapshot();
  return snap.users.map(toSafeUser);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const snap = await loadSnapshot();
  const lower = email.trim().toLowerCase();
  return snap.users.find((u) => u.email === lower) ?? null;
}

export async function getUserById(id: string): Promise<User | null> {
  const snap = await loadSnapshot();
  return snap.users.find((u) => u.id === id) ?? null;
}

export async function getSafeUserByEmail(email: string): Promise<SafeUser | null> {
  const u = await getUserByEmail(email);
  return u ? toSafeUser(u) : null;
}

export type SignupInput = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

export async function createPendingUser(
  input: SignupInput
): Promise<{ ok: true; user: SafeUser } | { ok: false; reason: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@") || !email.includes(".")) {
    return { ok: false, reason: "Please provide a valid email address." };
  }
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) {
    return { ok: false, reason: "First and last name are required." };
  }
  if (!input.password || input.password.length < 8) {
    return { ok: false, reason: "Password must be at least 8 characters." };
  }

  const snap = await loadSnapshot();
  if (snap.users.some((u) => u.email === email)) {
    return {
      ok: false,
      reason: "An account with that email is already in the system.",
    };
  }

  const user: User = {
    id: randomUUID(),
    email,
    firstName,
    lastName,
    passwordHash: hashPassword(input.password),
    tier: "general",
    status: "pending",
    createdAt: nowIso(),
  };
  const next: UserStoreSnapshot = { ...snap, users: [...snap.users, user] };
  await commit(next, {
    at: nowIso(),
    actor: email,
    action: "signup",
    userId: user.id,
    userEmail: user.email,
  });
  return { ok: true, user: toSafeUser(user) };
}

export async function authenticate(
  email: string,
  password: string
): Promise<
  | { ok: true; user: SafeUser }
  | { ok: false; reason: string }
> {
  const u = await getUserByEmail(email);
  if (!u) return { ok: false, reason: "Invalid email or password." };
  if (!verifyPassword(password, u.passwordHash)) {
    return { ok: false, reason: "Invalid email or password." };
  }
  if (u.status !== "approved") {
    const msg =
      u.status === "pending"
        ? "Your account is still pending admin approval."
        : u.status === "declined"
          ? "Your sign-up request was declined."
          : "This account has been disabled. Contact an admin.";
    return { ok: false, reason: msg };
  }
  // Update lastLoginAt fire-and-forget; failures don't block login.
  void updateLastLogin(u.id).catch(() => {});
  return { ok: true, user: toSafeUser(u) };
}

async function updateLastLogin(userId: string): Promise<void> {
  const snap = await loadSnapshot();
  const idx = snap.users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  const user = { ...snap.users[idx], lastLoginAt: nowIso() };
  const next: UserStoreSnapshot = {
    ...snap,
    users: snap.users.map((u, i) => (i === idx ? user : u)),
  };
  // Don't audit logins individually here; the auth route can audit them
  // separately if it cares. We write the snapshot directly to avoid
  // backup-snapshot churn on every page load - bypass commit().
  await writeJson(SNAPSHOT_PATH, next);
  snapshotCache = next;
}

async function mutateUser(
  id: string,
  actor: string,
  action: UserAuditEntry["action"],
  mutate: (u: User) => User,
  details?: Record<string, unknown>
): Promise<SafeUser | null> {
  const snap = await loadSnapshot();
  const idx = snap.users.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  const before = snap.users[idx];
  const after = mutate(before);
  const next: UserStoreSnapshot = {
    ...snap,
    users: snap.users.map((u, i) => (i === idx ? after : u)),
  };
  await commit(next, {
    at: nowIso(),
    actor,
    action,
    userId: after.id,
    userEmail: after.email,
    details,
  });
  return toSafeUser(after);
}

export function approveUser(id: string, actor: string): Promise<SafeUser | null> {
  return mutateUser(id, actor, "approve", (u) => ({
    ...u,
    status: "approved",
    approvedAt: nowIso(),
    approvedBy: actor,
  }));
}

export function declineUser(id: string, actor: string): Promise<SafeUser | null> {
  return mutateUser(id, actor, "decline", (u) => ({
    ...u,
    status: "declined",
    declinedAt: nowIso(),
    declinedBy: actor,
  }));
}

export function disableUser(id: string, actor: string): Promise<SafeUser | null> {
  return mutateUser(id, actor, "disable", (u) => ({ ...u, status: "disabled" }));
}

export function setUserTier(
  id: string,
  tier: UserTier,
  actor: string
): Promise<SafeUser | null> {
  return mutateUser(
    id,
    actor,
    tier === "admin" ? "promote" : "demote",
    (u) => ({ ...u, tier }),
    { tier }
  );
}

export async function deleteUser(
  id: string,
  actor: string
): Promise<SafeUser | null> {
  const snap = await loadSnapshot();
  const idx = snap.users.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  const removed = snap.users[idx];
  const next: UserStoreSnapshot = {
    ...snap,
    users: snap.users.filter((_, i) => i !== idx),
  };
  await commit(next, {
    at: nowIso(),
    actor,
    action: "delete",
    userId: removed.id,
    userEmail: removed.email,
  });
  return toSafeUser(removed);
}
