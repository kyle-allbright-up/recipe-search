"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import adminStyles from "../admin.module.css";
import styles from "./users.module.css";
import type { Actor, SafeUser } from "@/lib/auth";

type Props = { actor: Actor };

type Section = {
  key: "pending" | "approved" | "declined" | "disabled";
  label: string;
  description: string;
};

const SECTIONS: Section[] = [
  {
    key: "pending",
    label: "Pending sign-ups",
    description: "Awaiting your review. Approve to grant access, decline to deny.",
  },
  {
    key: "approved",
    label: "Active users",
    description: "Currently allowed to sign in.",
  },
  {
    key: "declined",
    label: "Declined",
    description: "Sign-ups you've rejected. Can be approved later if you change your mind.",
  },
  {
    key: "disabled",
    label: "Disabled",
    description: "Previously approved users you've disabled.",
  },
];

export default function UsersClient({ actor }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/users", { cache: "no-store" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load users.");
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (
    user: SafeUser,
    op: "approve" | "decline" | "disable" | "promote" | "demote" | "delete"
  ) => {
    if (op === "delete") {
      const sure = window.confirm(
        `Delete ${user.email}? This permanently removes the account.`
      );
      if (!sure) return;
    }
    setBusyId(user.id);
    setError(null);
    try {
      let url = `/api/users/${user.id}`;
      let init: RequestInit = { method: "POST" };
      if (op === "delete") {
        init = { method: "DELETE" };
      } else if (op === "approve") {
        url += "/approve";
      } else if (op === "decline") {
        url += "/decline";
      } else if (op === "disable") {
        url += "/disable";
      } else {
        url += "/role";
        init = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: op === "promote" ? "admin" : "general" }),
        };
      }
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Action failed.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const grouped: Record<Section["key"], SafeUser[]> = {
    pending: [],
    approved: [],
    declined: [],
    disabled: [],
  };
  for (const u of users) grouped[u.status].push(u);
  // Newest pending first; everything else alphabetical by name.
  grouped.pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const k of ["approved", "declined", "disabled"] as const) {
    grouped[k].sort((a, b) => a.lastName.localeCompare(b.lastName));
  }

  return (
    <div className={adminStyles.wrap}>
      <header className={adminStyles.header}>
        <div>
          <h1 className={adminStyles.title}>Users</h1>
          <p className={adminStyles.subtitle}>
            Manage who can sign in. Until you approve a request, the requester sees only the
            landing page.
          </p>
        </div>
        <div className={adminStyles.headerActions}>
          <Link href="/" className={adminStyles.link}>
            ← Back to recipes
          </Link>
          <Link href="/admin" className={adminStyles.link}>
            Trash
          </Link>
          <span className={adminStyles.badge}>
            Signed in as {actor.firstName} {actor.lastName}
          </span>
          <button type="button" className={adminStyles.link} onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {SECTIONS.map((section) => {
        const list = grouped[section.key];
        return (
          <section key={section.key} className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {section.label}
              <span className={styles.sectionCount}>{list.length}</span>
            </h2>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 13,
                color: "var(--text-secondary, #666)",
              }}
            >
              {section.description}
            </p>
            {list.length === 0 ? (
              <div className={styles.empty}>None.</div>
            ) : (
              list.map((u) => {
                const isSelf = u.id === actor.id;
                // The super admin is the immutable owner of the app: no
                // other admin (and not even themselves) can change their
                // tier, status, or delete them. We hide the destructive
                // actions for that row entirely.
                const isProtected = u.isSuperAdmin;
                return (
                  <div key={u.id} className={styles.userCard}>
                    <div className={styles.userInfo}>
                      <p className={styles.userName}>
                        {u.firstName} {u.lastName}
                        {isSelf && <span className={styles.you} style={{ marginLeft: 8 }}>you</span>}
                        {isProtected && (
                          <span
                            className={`${styles.tierChip} ${styles.tierAdmin}`}
                            style={{ marginLeft: 8 }}
                            title="The super admin account is permanently protected and can't be modified."
                          >
                            super admin
                          </span>
                        )}
                      </p>
                      <p className={styles.userMeta}>
                        <span>{u.email}</span>
                        <span>·</span>
                        <span
                          className={`${styles.tierChip} ${
                            u.tier === "admin" ? styles.tierAdmin : styles.tierGeneral
                          }`}
                        >
                          {u.tier}
                        </span>
                        <span>·</span>
                        <span>requested {new Date(u.createdAt).toLocaleDateString()}</span>
                        {u.approvedAt && (
                          <>
                            <span>·</span>
                            <span>approved {new Date(u.approvedAt).toLocaleDateString()}</span>
                          </>
                        )}
                        {u.lastLoginAt && (
                          <>
                            <span>·</span>
                            <span>last login {new Date(u.lastLoginAt).toLocaleDateString()}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className={styles.userActions}>
                      {isProtected ? (
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary, #888)",
                            fontStyle: "italic",
                          }}
                        >
                          Protected — cannot be modified
                        </span>
                      ) : (
                        <>
                          {section.key === "pending" && (
                            <>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.approveBtn}`}
                                onClick={() => act(u, "approve")}
                                disabled={busyId === u.id}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.declineBtn}`}
                                onClick={() => act(u, "decline")}
                                disabled={busyId === u.id || isSelf}
                              >
                                Decline
                              </button>
                            </>
                          )}
                          {section.key === "approved" && (
                            <>
                              {u.tier === "general" ? (
                                <button
                                  type="button"
                                  className={styles.btn}
                                  onClick={() => act(u, "promote")}
                                  disabled={busyId === u.id}
                                >
                                  Promote to admin
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.btn}
                                  onClick={() => act(u, "demote")}
                                  disabled={busyId === u.id || isSelf}
                                >
                                  Demote to general
                                </button>
                              )}
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.declineBtn}`}
                                onClick={() => act(u, "disable")}
                                disabled={busyId === u.id || isSelf}
                              >
                                Disable
                              </button>
                            </>
                          )}
                          {section.key === "declined" && (
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.approveBtn}`}
                              onClick={() => act(u, "approve")}
                              disabled={busyId === u.id}
                            >
                              Approve anyway
                            </button>
                          )}
                          {section.key === "disabled" && (
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.approveBtn}`}
                              onClick={() => act(u, "approve")}
                              disabled={busyId === u.id}
                            >
                              Re-enable
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.deleteBtn}`}
                            onClick={() => act(u, "delete")}
                            disabled={busyId === u.id || isSelf}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        );
      })}
    </div>
  );
}
