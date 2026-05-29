#!/usr/bin/env node
// One-shot data cleaner. Reads the legacy CSVs in public/recipes/, normalizes
// names/ingredients/instructions, and writes a deterministic JSON seed to
// data/recipes.seed.json. Run with `node scripts/build-seed.mjs`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Papa from "papaparse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SMART_QUOTE_MAP = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2032": "'",
  "\u2033": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00A0": " ",
  "\uFEFF": "",
};

function cleanText(value) {
  if (value == null) return "";
  let s = String(value);
  s = s.replace(/[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u2032\u2033\u2013\u2014\u2212\u00A0\uFEFF]/g, (ch) => SMART_QUOTE_MAP[ch] ?? ch);
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/[\t\f\v]+/g, " ");
  s = s.replace(/[ \u200B]{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.trim();
  return s;
}

function isUrl(value) {
  return /^https?:\/\//i.test(value.trim());
}

function splitIngredients(raw) {
  const cleaned = cleanText(raw);
  if (!cleaned) return [];
  // Some rows mash ingredients into one line separated by 2+ spaces or " | ".
  let lines = cleaned
    .split(/\n+/)
    .flatMap((line) => line.split(/\s\|\s/))
    // Only strip leading list markers ("- ", "* ", "• ", "1. ", "2) "), never
    // bare digits that belong to a quantity like "4oz" or "1/2 cup".
    .map((line) => line.replace(/^(?:[-*\u2022]\s+|\d{1,2}[.)]\s+)/, "").trim())
    .filter(Boolean);

  // De-dupe while preserving order.
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function normalizeInstructions(raw) {
  const cleaned = cleanText(raw);
  if (!cleaned) return "";
  // Sometimes instructions are a single big line with embedded "1. ... 2. ..."
  // markers. Re-split those onto their own lines for readability.
  const expanded = cleaned.replace(/\s(?=\d{1,2}\.\s)/g, "\n");
  return expanded
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeName(raw) {
  return cleanText(raw).replace(/\s+/g, " ");
}

function stableId(type, name, order) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
  const hash = createHash("sha1").update(`${type}|${order}|${name}`).digest("hex").slice(0, 8);
  return `${type[0]}-${slug.slice(0, 40)}-${hash}`;
}

function loadCsv(absPath) {
  const text = readFileSync(absPath, "utf8");
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  return result.data;
}

function pickFirst(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function buildRecipes(rows, type, nowIso) {
  const out = [];
  for (const raw of rows) {
    const name = normalizeName(pickFirst(raw, ["Name", "name", "Recipe", "Title"]));
    if (!name) continue;

    const ingredientsField = pickFirst(raw, ["Ingredients", "ingredients"]);
    let ingredients = [];
    let sourceUrl;
    if (ingredientsField && isUrl(ingredientsField.trim())) {
      sourceUrl = ingredientsField.trim();
    } else {
      ingredients = splitIngredients(ingredientsField);
    }

    const instructionsField = pickFirst(raw, ["Instructions", "instructions"]);
    let instructions = "";
    if (instructionsField) {
      if (isUrl(instructionsField.trim()) && !sourceUrl) {
        sourceUrl = instructionsField.trim();
      } else if (!isUrl(instructionsField.trim())) {
        instructions = normalizeInstructions(instructionsField);
      }
    }

    const triedRaw = pickFirst(raw, ["Tried?", "tried", "Tried"]).trim().toUpperCase();
    const tried = triedRaw === "Y" || triedRaw === "YES" || triedRaw === "TRUE";

    const greenBookRaw = pickFirst(raw, ["GB?", "GB"]).trim().toUpperCase();
    const greenBook = greenBookRaw === "Y" || greenBookRaw === "YES" || greenBookRaw === "TRUE";

    const orderStr = pickFirst(raw, ["Order", "#", "order"]).trim();
    const order = Number.isFinite(parseInt(orderStr, 10)) ? parseInt(orderStr, 10) : 0;

    const category = cleanText(pickFirst(raw, ["Type", "type", "Category"]));
    const comments = cleanText(pickFirst(raw, ["Comments", "comments", "Notes"]));

    out.push({
      id: stableId(type, name, order || out.length),
      type,
      name,
      ingredients,
      instructions,
      comments,
      sourceUrl,
      category,
      tried,
      greenBook,
      order,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  // Sort alphabetically by name for a stable, predictable seed.
  out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return out;
}

function main() {
  const nowIso = "2026-01-01T00:00:00.000Z"; // Deterministic seed timestamp.
  const foodRows = loadCsv(resolve(repoRoot, "public/recipes/food.csv"));
  const drinksRows = loadCsv(resolve(repoRoot, "public/recipes/drinks.csv"));

  const food = buildRecipes(foodRows, "food", nowIso);
  const drinks = buildRecipes(drinksRows, "drinks", nowIso);
  const all = [...food, ...drinks];

  // Ensure IDs are unique (collision-safe just in case two recipes hash the same).
  const seen = new Map();
  for (const r of all) {
    if (seen.has(r.id)) {
      r.id = `${r.id}-${seen.get(r.id) + 1}`;
      seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    } else {
      seen.set(r.id, 0);
    }
  }

  const seed = {
    version: 1,
    builtAt: nowIso,
    recipes: all,
  };

  const outPath = resolve(repoRoot, "data/recipes.seed.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n", "utf8");

  const withInstructions = all.filter((r) => r.instructions).length;
  const withIngredients = all.filter((r) => r.ingredients.length).length;
  const withUrl = all.filter((r) => r.sourceUrl).length;

  console.log(`Wrote ${all.length} recipes (${food.length} food, ${drinks.length} drinks) -> ${outPath}`);
  console.log(`  with ingredients: ${withIngredients}`);
  console.log(`  with instructions: ${withInstructions}`);
  console.log(`  link-only (sourceUrl): ${withUrl}`);
}

main();
