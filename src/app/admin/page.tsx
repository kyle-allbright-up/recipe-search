"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";
import type { Recipe } from "@/lib/recipes";

type TrashedRecipe = Recipe & { trashedAt: string; trashedBy: string };

type DeleteState = {
  id: string;
  typedName: string;
  password: string;
  step: 1 | 2;
  error?: string;
  busy?: boolean;
};

export default function AdminPage() {
  const router = useRouter();
  const [actor, setActor] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [trash, setTrash] = useState<TrashedRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [busyRestoreId, setBusyRestoreId] = useState<string | null>(null);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recipes/trash", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setTrash(data.trash ?? []);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setActor(d?.actor ?? null);
        setAuthChecked(true);
        if (!d?.actor) router.push("/admin/login");
      })
      .catch(() => {
        setAuthChecked(true);
        router.push("/admin/login");
      });
  }, [router]);

  useEffect(() => {
    if (actor) loadTrash();
  }, [actor, loadTrash]);

  const restore = async (id: string) => {
    setBusyRestoreId(id);
    try {
      const res = await fetch(`/api/recipes/${id}/restore`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error ?? "Restore failed.");
        return;
      }
      setTrash((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setBusyRestoreId(null);
    }
  };

  const startDelete = (r: TrashedRecipe) => {
    setDeleteState({ id: r.id, typedName: "", password: "", step: 1 });
  };

  const advanceDelete = () => {
    if (!deleteState) return;
    const target = trash.find((r) => r.id === deleteState.id);
    if (!target) return;
    if (deleteState.typedName.trim().toLowerCase() !== target.name.trim().toLowerCase()) {
      setDeleteState({
        ...deleteState,
        error: `Type the recipe name exactly to continue: "${target.name}".`,
      });
      return;
    }
    setDeleteState({ ...deleteState, step: 2, error: undefined });
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    setDeleteState({ ...deleteState, busy: true, error: undefined });
    try {
      const res = await fetch("/api/recipes/hard-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: deleteState.id,
          typedName: deleteState.typedName,
          password: deleteState.password,
          doubleConfirm: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDeleteState({
          ...deleteState,
          busy: false,
          error: err?.error ?? "Delete failed.",
        });
        return;
      }
      setTrash((prev) => prev.filter((r) => r.id !== deleteState.id));
      setDeleteState(null);
    } catch (e) {
      setDeleteState({
        ...deleteState,
        busy: false,
        error: e instanceof Error ? e.message : "Delete failed.",
      });
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
  };

  if (!authChecked) {
    return (
      <div className={styles.wrap}>
        <p className={styles.empty}>Checking session…</p>
      </div>
    );
  }
  if (!actor) return null;

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Recipe Trash</h1>
          <p className={styles.subtitle}>
            Soft-deleted recipes are stored here indefinitely. Restore anytime, or run the
            multi-step permanent delete.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/" className={styles.link}>
            ← Back to recipes
          </Link>
          <span className={styles.badge}>Signed in as {actor}</span>
          <button type="button" className={styles.link} onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {loading ? (
        <p className={styles.empty}>Loading trash…</p>
      ) : trash.length === 0 ? (
        <p className={styles.empty}>Trash is empty. No deletes pending.</p>
      ) : (
        <ul className={styles.list}>
          {trash.map((r) => {
            const isDeleting = deleteState?.id === r.id;
            return (
              <li key={r.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>{r.name}</h3>
                    <p className={styles.cardMeta}>
                      {r.type === "drinks" ? "Drink" : "Food"}
                      {r.category ? ` · ${r.category}` : ""} · trashed{" "}
                      {new Date(r.trashedAt).toLocaleString()} by {r.trashedBy}
                    </p>
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.restoreBtn}
                      onClick={() => restore(r.id)}
                      disabled={busyRestoreId === r.id}
                    >
                      {busyRestoreId === r.id ? "Restoring…" : "Restore"}
                    </button>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => startDelete(r)}
                      disabled={isDeleting}
                    >
                      Permanently delete…
                    </button>
                  </div>
                </div>

                {isDeleting && deleteState && (
                  <div className={styles.deletePanel}>
                    {deleteState.step === 1 ? (
                      <>
                        <p className={styles.deleteWarn}>
                          This action <strong>cannot be undone</strong>. To continue, type the
                          recipe name exactly as shown above.
                        </p>
                        <input
                          className={styles.deleteInput}
                          value={deleteState.typedName}
                          onChange={(e) =>
                            setDeleteState({ ...deleteState, typedName: e.target.value })
                          }
                          placeholder={r.name}
                          autoFocus
                        />
                        {deleteState.error && (
                          <p className={styles.deleteError}>{deleteState.error}</p>
                        )}
                        <div className={styles.deleteActions}>
                          <button
                            type="button"
                            className={styles.cancelBtn}
                            onClick={() => setDeleteState(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={advanceDelete}
                          >
                            Continue
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className={styles.deleteWarn}>
                          Final step. Re-enter your admin password to permanently delete{" "}
                          <strong>{r.name}</strong>.
                        </p>
                        <input
                          className={styles.deleteInput}
                          type="password"
                          value={deleteState.password}
                          onChange={(e) =>
                            setDeleteState({ ...deleteState, password: e.target.value })
                          }
                          placeholder="Admin password"
                          autoFocus
                        />
                        {deleteState.error && (
                          <p className={styles.deleteError}>{deleteState.error}</p>
                        )}
                        <div className={styles.deleteActions}>
                          <button
                            type="button"
                            className={styles.cancelBtn}
                            onClick={() => setDeleteState(null)}
                            disabled={deleteState.busy}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={confirmDelete}
                            disabled={!deleteState.password || deleteState.busy}
                          >
                            {deleteState.busy ? "Deleting…" : "Permanently delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
