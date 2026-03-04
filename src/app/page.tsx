"use client";

import { useState, useCallback, useEffect } from "react";
import Papa from "papaparse";
import styles from "./page.module.css";

type Row = Record<string, string>;

function getRecipeName(row: Row, headers: string[]): string {
  const keys = headers.filter(
    (h) =>
      h.toLowerCase().includes("name") ||
      h.toLowerCase().includes("title") ||
      h.toLowerCase().includes("recipe")
  );
  for (const k of keys) {
    const v = row[k]?.trim();
    if (v) return v;
  }
  return headers[0] ? row[headers[0]] ?? "Untitled Recipe" : "Untitled Recipe";
}

function getIngredients(row: Row, headers: string[]): string[] {
  const keys = headers.filter((h) =>
    h.toLowerCase().includes("ingredient")
  );
  let raw = "";
  for (const k of keys) raw += (row[k] ?? "") + "\n";
  return raw
    .split(/[\n,;]|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchDescription(
  name: string,
  ingredients: string[]
): Promise<string> {
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

async function fetchCsv(url: string): Promise<Row[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  return new Promise((resolve) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve((results.data as Row[]) || []),
    });
  });
}

export default function Home() {
  const [foodRows, setFoodRows] = useState<Row[]>([]);
  const [drinksRows, setDrinksRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "ai">("keyword");
  const [recipeType, setRecipeType] = useState<"food" | "drinks">("food");
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [aiIndices, setAiIndices] = useState<number[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const rows = recipeType === "food" ? foodRows : drinksRows;
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  useEffect(() => {
    async function load() {
      setLoadError(null);
      try {
        const res = await fetch("/api/recipes");
        const { food: foodUrl, drinks: drinksUrl } = await res.json();

        const urls = {
          food: foodUrl || "/recipes/food.csv",
          drinks: drinksUrl || "/recipes/drinks.csv",
        };

        const [food, drinks] = await Promise.all([
          fetchCsv(urls.food),
          fetchCsv(urls.drinks),
        ]);

        if (food.length > 0) setFoodRows(food);
        if (drinks.length > 0) setDrinksRows(drinks);
      } catch (e) {
        setLoadError("Could not load recipes.");
      }
    }
    load();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDescriptions({});
    setExpandedKey(null);
    setAiIndices(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = (results.data as Row[]) || [];
        if (recipeType === "food") setFoodRows(data);
        else setDrinksRows(data);
      },
    });
    e.target.value = "";
  };

  const handleSavePermanently = async () => {
    const data = recipeType === "food" ? foodRows : drinksRows;
    if (data.length === 0) return;
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv" });
    const file = new File([blob], `${recipeType}.csv`, { type: "text/csv" });
    const form = new FormData();
    form.append("file", file);
    form.append("type", recipeType);
    const res = await fetch("/api/recipes", {
      method: "POST",
      body: form,
    });
    if (res.ok) alert("Saved permanently!");
    else alert("Save failed. Check BLOB_READ_WRITE_TOKEN.");
  };

  const loadDescription = useCallback(
    async (key: string, row: Row) => {
      if (descriptions[key]) return;
      const name = getRecipeName(row, headers);
      const ingredients = getIngredients(row, headers);
      const desc = await fetchDescription(name, ingredients);
      setDescriptions((prev) => ({ ...prev, [key]: desc }));
    },
    [headers, descriptions]
  );

  const nameKeys = headers.filter(
    (h) =>
      h.toLowerCase().includes("name") ||
      h.toLowerCase().includes("title") ||
      h.toLowerCase().includes("recipe")
  );
  const ingredientKeys = headers.filter((h) =>
    h.toLowerCase().includes("ingredient")
  );
  const searchKeys =
    [...nameKeys, ...ingredientKeys].length > 0
      ? [...nameKeys, ...ingredientKeys]
      : headers;

  const runAiSearch = useCallback(async () => {
    if (!search.trim() || rows.length === 0) return;
    setAiLoading(true);
    setAiIndices(null);
    try {
      const recipes = rows.map((row, i) => ({
        index: i,
        name: getRecipeName(row, headers),
        ingredients: getIngredients(row, headers).join(", "),
      }));
      const res = await fetch("/api/meal-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: search, recipes }),
      });
      const { indices } = await res.json();
      setAiIndices(Array.isArray(indices) ? indices : []);
    } catch {
      setAiIndices([]);
    } finally {
      setAiLoading(false);
    }
  }, [search, rows, headers]);

  const keywordFiltered = rows
    .map((row, i) => ({ row, index: i }))
    .filter(({ row }) => {
      if (!search.trim()) return true;
      const term = search.toLowerCase();
      return searchKeys.some((key) =>
        (row[key] ?? "").toLowerCase().includes(term)
      );
    });

  const aiFiltered =
    searchMode === "ai" && aiIndices !== null
      ? aiIndices.map((i) => ({ row: rows[i], index: i })).filter((f) => f.row)
      : null;

  const filtered =
    searchMode === "ai" && aiFiltered !== null ? aiFiltered : keywordFiltered;

  useEffect(() => {
    filtered.forEach(({ row, index }) =>
      loadDescription(`${recipeType}-${index}`, row)
    );
  }, [filtered, recipeType, loadDescription]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1>Recipe Search</h1>
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
                  : "Search by name or ingredients..."
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

        <div className={styles.uploadRow}>
          <label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ marginRight: 12 }}
            />
            Upload CSV ({recipeType})
          </label>
          {rows.length > 0 && (
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleSavePermanently}
            >
              Save permanently
            </button>
          )}
        </div>

        <div className={styles.results}>
          {loadError && (
            <p className={styles.hint}>{loadError}</p>
          )}
          {!loadError && foodRows.length === 0 && drinksRows.length === 0 && (
            <p className={styles.hint}>
              Upload a CSV to get started, or add food.csv and drinks.csv to
              public/recipes/ for persistent storage.
            </p>
          )}
          {rows.length > 0 && (
            <p className={styles.hint}>
              {filtered.length} of {rows.length} {recipeType}
            </p>
          )}
          <ul className={styles.cardList}>
            {filtered.map(({ row, index }) => {
              const key = `${recipeType}-${index}`;
              const name = getRecipeName(row, headers);
              const ingredients = getIngredients(row, headers);
              const isExpanded = expandedKey === key;

              return (
                <li key={key} className={styles.card}>
                  <button
                    type="button"
                    className={styles.cardButton}
                    onClick={() =>
                      setExpandedKey(isExpanded ? null : key)
                    }
                  >
                    <h3 className={styles.cardTitle}>{name}</h3>
                    <p className={styles.cardDesc}>
                      {descriptions[key] ?? (
                        <span className={styles.loading}>
                          Generating description…
                        </span>
                      )}
                    </p>
                    <span className={styles.expandIcon}>
                      {isExpanded ? "−" : "+"}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className={styles.ingredients}>
                      <h4>Ingredients</h4>
                      <ul>
                        {ingredients.map((ing, j) => (
                          <li key={j}>{ing}</li>
                        ))}
                      </ul>
                    </div>
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
