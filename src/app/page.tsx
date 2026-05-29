"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import type { Recipe, RecipeType } from "@/lib/recipes";

type EditDraft = {
  name: string;
  category: string;
  ingredients: string;
  instructions: string;
  comments: string;
  sourceUrl: string;
  tried: boolean;
  greenBook: boolean;
};

function recipeToDraft(r: Recipe): EditDraft {
  return {
    name: r.name,
    category: r.category ?? "",
    ingredients: r.ingredients.join("\n"),
    instructions: r.instructions ?? "",
    comments: r.comments ?? "",
    sourceUrl: r.sourceUrl ?? "",
    tried: !!r.tried,
    greenBook: !!r.greenBook,
  };
}

async function fetchDescription(name: string, ingredients: string[]): Promise<string> {
  try {
    const res = await fetch("/api/describe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ingredients: ingredients.join(", ") }),
    });
    if (!res.ok) return "A delicious recipe.";
    const { description } = await res.json();
    return description ?? "A delicious recipe.";
  } catch {
    return "A delicious recipe.";
  }
}

export default function Home() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actor, setActor] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "ai">("keyword");
  const [recipeType, setRecipeType] = useState<RecipeType>("food");
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [aiIndices, setAiIndices] = useState<string[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const reloadRecipes = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/recipes", { cache: "no-store" });
      if (!res.ok) {
        setLoadError("Failed to load recipes.");
        return;
      }
      const { recipes: list } = (await res.json()) as { recipes: Recipe[] };
      setRecipes(list);
    } catch {
      setLoadError("Failed to load recipes.");
    }
  }, []);

  useEffect(() => {
    reloadRecipes();
  }, [reloadRecipes]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setActor(d?.actor ?? null))
      .catch(() => setActor(null));
  }, []);

  const typedRecipes = useMemo(
    () => recipes.filter((r) => r.type === recipeType),
    [recipes, recipeType]
  );

  const loadDescription = useCallback(
    async (recipe: Recipe) => {
      if (descriptions[recipe.id]) return;
      if (typeof window !== "undefined") {
        const stored = window.localStorage.getItem(`recipe-description:${recipe.id}`);
        if (stored) {
          setDescriptions((prev) => ({ ...prev, [recipe.id]: stored }));
          return;
        }
      }
      const desc = await fetchDescription(recipe.name, recipe.ingredients);
      setDescriptions((prev) => ({ ...prev, [recipe.id]: desc }));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`recipe-description:${recipe.id}`, desc);
      }
    },
    [descriptions]
  );

  const keywordTerms = useMemo(
    () =>
      search
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    [search]
  );

  const keywordFiltered = useMemo(() => {
    if (keywordTerms.length === 0) return typedRecipes;
    return typedRecipes.filter((r) => {
      const haystack = [
        r.name,
        r.ingredients.join(" \n "),
        r.instructions,
        r.comments,
        r.category,
      ]
        .join(" \n ")
        .toLowerCase();
      return keywordTerms.every((term) => haystack.includes(term));
    });
  }, [keywordTerms, typedRecipes]);

  const aiFiltered = useMemo(() => {
    if (searchMode !== "ai" || aiIndices === null) return null;
    const map = new Map(typedRecipes.map((r) => [r.id, r]));
    return aiIndices.map((id) => map.get(id)).filter((r): r is Recipe => Boolean(r));
  }, [searchMode, aiIndices, typedRecipes]);

  const filtered = searchMode === "ai" && aiFiltered !== null ? aiFiltered : keywordFiltered;

  useEffect(() => {
    filtered.forEach((r) => loadDescription(r));
  }, [filtered, loadDescription]);

  const runAiSearch = useCallback(async () => {
    if (!search.trim() || typedRecipes.length === 0) return;
    setAiLoading(true);
    setAiIndices(null);
    try {
      // We keep the meal-search API contract index-based, but pass our stable
      // recipe IDs through as "index" so we can map back unambiguously even
      // after edits/deletes.
      const payload = typedRecipes.map((r, i) => ({
        index: i,
        id: r.id,
        name: r.name,
        ingredients: r.ingredients.join(", "),
        description: descriptions[r.id] ?? "",
      }));
      const res = await fetch("/api/meal-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: search, recipes: payload }),
      });
      if (!res.ok) {
        setAiIndices([]);
        return;
      }
      const data = await res.json();
      const indices = Array.isArray(data?.indices) ? (data.indices as number[]) : [];
      const ids = indices.map((i) => payload[i]?.id).filter(Boolean) as string[];
      setAiIndices(ids);
    } catch {
      setAiIndices([]);
    } finally {
      setAiLoading(false);
    }
  }, [search, typedRecipes, descriptions]);

  const startEditing = (r: Recipe) => {
    setEditingId(r.id);
    setEditDraft(recipeToDraft(r));
    setExpandedId(r.id);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEditing = async (id: string) => {
    if (!editDraft) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/recipes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDraft.name,
          category: editDraft.category,
          ingredients: editDraft.ingredients,
          instructions: editDraft.instructions,
          comments: editDraft.comments,
          sourceUrl: editDraft.sourceUrl,
          tried: editDraft.tried,
          greenBook: editDraft.greenBook,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error ?? "Failed to save.");
        return;
      }
      const { recipe: updated } = (await res.json()) as { recipe: Recipe };
      setRecipes((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setEditingId(null);
      setEditDraft(null);
    } finally {
      setBusyId(null);
    }
  };

  const softDelete = async (r: Recipe) => {
    const ok = window.confirm(
      `Move "${r.name}" to the trash?\n\nIt will be kept safely and can be restored from the Admin panel. To permanently delete a recipe, open the trash and use the multi-step delete flow.`
    );
    if (!ok) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/recipes/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error ?? "Delete failed.");
        return;
      }
      setRecipes((prev) => prev.filter((x) => x.id !== r.id));
    } finally {
      setBusyId(null);
    }
  };

  const generateInstructions = async (r: Recipe) => {
    setGeneratingId(r.id);
    try {
      const res = await fetch(`/api/recipes/${r.id}/instructions`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error ?? "Could not generate instructions.");
        return;
      }
      const { recipe: updated } = (await res.json()) as { recipe: Recipe };
      setRecipes((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
    } finally {
      setGeneratingId(null);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setActor(null);
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.headerRow}>
          <div className={styles.intro}>
            <h1>Forkcast</h1>
          </div>
          <div className={styles.adminBar}>
            {actor ? (
              <>
                <span className={styles.adminBadge}>Admin · {actor}</span>
                <Link href="/admin" className={styles.adminLink}>
                  Trash
                </Link>
                <button type="button" className={styles.adminLink} onClick={logout}>
                  Log out
                </button>
              </>
            ) : (
              <Link href="/admin/login" className={styles.adminLink}>
                Admin
              </Link>
            )}
          </div>
        </div>

        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Type:</span>
          <button
            type="button"
            className={`${styles.toggleBtn} ${recipeType === "food" ? styles.toggleActive : ""}`}
            onClick={() => {
              setRecipeType("food");
              setAiIndices(null);
            }}
          >
            Food
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${recipeType === "drinks" ? styles.toggleActive : ""}`}
            onClick={() => {
              setRecipeType("drinks");
              setAiIndices(null);
            }}
          >
            Drinks
          </button>
        </div>

        <div className={styles.searchRow}>
          <div className={styles.searchModeRow}>
            <label>
              <input
                type="radio"
                checked={searchMode === "keyword"}
                onChange={() => setSearchMode("keyword")}
              />
              Keyword
            </label>
            <label>
              <input
                type="radio"
                checked={searchMode === "ai"}
                onChange={() => setSearchMode("ai")}
              />
              AI meal ideas
            </label>
          </div>
          <div className={styles.searchInputRow}>
            <input
              type="text"
              placeholder={
                searchMode === "ai"
                  ? "e.g. light lunch, comfort food, quick weeknight dinner..."
                  : "Search by name or ingredients (comma-separate, e.g. chicken, garlic, lemon)..."
              }
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setAiIndices(null);
              }}
              className={styles.searchInput}
              onKeyDown={(e) => {
                if (searchMode === "ai" && e.key === "Enter") runAiSearch();
              }}
            />
            {searchMode === "ai" && (
              <button
                type="button"
                className={styles.aiSearchBtn}
                onClick={runAiSearch}
                disabled={aiLoading || !search.trim()}
              >
                {aiLoading ? "Searching…" : "Search"}
              </button>
            )}
          </div>
        </div>

        <div className={styles.results}>
          {loadError && <p className={styles.hint}>{loadError}</p>}
          {!loadError && recipes.length === 0 && (
            <p className={styles.hint}>Loading recipes…</p>
          )}
          {typedRecipes.length > 0 && (
            <p className={styles.hint}>
              {filtered.length} of {typedRecipes.length} {recipeType}
            </p>
          )}
          <ul className={styles.cardList}>
            {filtered.map((r) => {
              const isExpanded = expandedId === r.id;
              const isEditing = editingId === r.id && editDraft;
              const instructionSteps = r.instructions
                ? r.instructions.split(/\n+/).filter(Boolean)
                : [];

              return (
                <li key={r.id} className={styles.card}>
                  <button
                    type="button"
                    className={styles.cardButton}
                    onClick={() => {
                      if (isEditing) return;
                      setExpandedId(isExpanded ? null : r.id);
                    }}
                  >
                    <h3 className={styles.cardTitle}>{r.name}</h3>
                    <p className={styles.cardDesc}>
                      {descriptions[r.id] ?? (
                        <span className={styles.loading}>Generating description…</span>
                      )}
                    </p>
                    <div className={styles.metaRow}>
                      {r.category && <span className={styles.metaChip}>{r.category}</span>}
                      {r.tried && (
                        <span className={`${styles.metaChip} ${styles.metaChipTried}`}>
                          Tried
                        </span>
                      )}
                      {r.greenBook && <span className={styles.metaChip}>Green Book</span>}
                      {r.sourceUrl && <span className={styles.metaChip}>Link recipe</span>}
                    </div>
                    <span className={styles.expandIcon}>{isExpanded ? "−" : "+"}</span>
                  </button>

                  {isExpanded && !isEditing && (
                    <>
                      {r.sourceUrl && (
                        <a
                          className={styles.sourceLink}
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {r.sourceUrl}
                        </a>
                      )}
                      {r.ingredients.length > 0 && (
                        <div className={styles.ingredients}>
                          <h4>Ingredients</h4>
                          <ul>
                            {r.ingredients.map((ing, j) => (
                              <li key={j}>{ing}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className={styles.instructions}>
                        <h4>Instructions</h4>
                        {instructionSteps.length > 0 ? (
                          <ol>
                            {instructionSteps.map((step, j) => (
                              <li key={j}>{step.replace(/^\s*\d+[.)]\s*/, "")}</li>
                            ))}
                          </ol>
                        ) : (
                          <p className={styles.instructionsEmpty}>
                            No instructions yet.
                            {actor
                              ? r.ingredients.length > 0
                                ? " Use the admin controls below to generate or write them."
                                : " Add ingredients first, then generate instructions."
                              : r.sourceUrl
                                ? " See the source link above."
                                : ""}
                          </p>
                        )}
                      </div>
                      {r.comments && (
                        <div className={styles.instructions}>
                          <h4>Notes</h4>
                          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
                            {r.comments}
                          </p>
                        </div>
                      )}
                      {actor && (
                        <div className={styles.adminControls}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => startEditing(r)}
                          >
                            Edit
                          </button>
                          {r.ingredients.length > 0 && (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={() => generateInstructions(r)}
                              disabled={generatingId === r.id}
                            >
                              {generatingId === r.id
                                ? "Generating…"
                                : r.instructions
                                  ? "Regenerate instructions"
                                  : "Generate instructions"}
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.dangerBtn}`}
                            onClick={() => softDelete(r)}
                            disabled={busyId === r.id}
                          >
                            Move to trash
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {isEditing && editDraft && (
                    <form
                      className={styles.editForm}
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveEditing(r.id);
                      }}
                    >
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Name</label>
                        <input
                          className={styles.formInput}
                          value={editDraft.name}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, name: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className={styles.formRow}>
                        <div className={styles.formField} style={{ flex: 1, minWidth: 160 }}>
                          <label className={styles.formLabel}>Category</label>
                          <input
                            className={styles.formInput}
                            value={editDraft.category}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, category: e.target.value })
                            }
                            placeholder="Entree, Side, Cocktail…"
                          />
                        </div>
                        <div className={styles.formField} style={{ flex: 1, minWidth: 160 }}>
                          <label className={styles.formLabel}>Source URL (optional)</label>
                          <input
                            className={styles.formInput}
                            value={editDraft.sourceUrl}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, sourceUrl: e.target.value })
                            }
                            placeholder="https://…"
                          />
                        </div>
                      </div>
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Ingredients (one per line)</label>
                        <textarea
                          className={styles.formTextarea}
                          value={editDraft.ingredients}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, ingredients: e.target.value })
                          }
                          rows={8}
                        />
                      </div>
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Instructions</label>
                        <textarea
                          className={styles.formTextarea}
                          value={editDraft.instructions}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, instructions: e.target.value })
                          }
                          rows={10}
                        />
                      </div>
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Notes</label>
                        <textarea
                          className={styles.formTextarea}
                          value={editDraft.comments}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, comments: e.target.value })
                          }
                          rows={3}
                        />
                      </div>
                      <div className={styles.formRow}>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 13,
                            color: "var(--text-secondary)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={editDraft.tried}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, tried: e.target.checked })
                            }
                          />
                          Tried
                        </label>
                        {r.type === "drinks" && (
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 13,
                              color: "var(--text-secondary)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={editDraft.greenBook}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, greenBook: e.target.checked })
                              }
                            />
                            Green Book
                          </label>
                        )}
                      </div>
                      <div className={styles.formActions}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={cancelEditing}
                          disabled={busyId === r.id}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className={styles.iconBtn}
                          disabled={busyId === r.id}
                        >
                          {busyId === r.id ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}
