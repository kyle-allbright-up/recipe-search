export type RecipeType = "food" | "drinks";

export type Recipe = {
  id: string;
  type: RecipeType;
  name: string;
  ingredients: string[];
  instructions: string;
  comments: string;
  sourceUrl?: string;
  category: string;
  tried: boolean;
  greenBook: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type TrashedRecipe = Recipe & {
  trashedAt: string;
  trashedBy: string;
};

export type RecipeSeed = {
  version: number;
  builtAt: string;
  recipes: Recipe[];
};

export type RecipeStoreSnapshot = {
  version: number;
  updatedAt: string;
  recipes: Recipe[];
  trash: TrashedRecipe[];
};

export type AuditEntry = {
  at: string;
  actor: string;
  action:
    | "create"
    | "update"
    | "soft_delete"
    | "restore"
    | "hard_delete"
    | "seed"
    | "generate_instructions";
  recipeId: string;
  recipeName: string;
  details?: Record<string, unknown>;
};

const URL_RE = /^https?:\/\//i;

export function isUrl(value: string): boolean {
  return URL_RE.test(value.trim());
}

export function normalizeIngredients(input: string | string[]): string[] {
  const lines = Array.isArray(input) ? input : input.split(/\n+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = String(raw)
      .replace(/[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u2032\u2033\u2013\u2014\u2212\u00A0\uFEFF]/g, (ch) => {
        switch (ch) {
          case "\u2018":
          case "\u2019":
          case "\u201A":
          case "\u201B":
          case "\u2032":
            return "'";
          case "\u201C":
          case "\u201D":
          case "\u201E":
          case "\u2033":
            return '"';
          case "\u2013":
          case "\u2014":
          case "\u2212":
            return "-";
          case "\u00A0":
            return " ";
          default:
            return "";
        }
      })
      .replace(/^(?:[-*\u2022]\s+|\d{1,2}[.)]\s+)/, "")
      .trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function normalizeInstructions(input: string): string {
  return String(input)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function recipeSearchHaystack(r: Recipe): string {
  return [r.name, r.ingredients.join(" \n "), r.instructions, r.comments, r.category]
    .join(" \n ")
    .toLowerCase();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- Fuzzy ingredient matching ------------------------------------------------
//
// Matches a single user-typed term ("olive", "tomatos", "lemn") against a
// pre-lowercased haystack of recipe text. Strategy, cheapest first:
//   1. Direct substring match (covers most well-typed queries).
//   2. Plural toggle (drop trailing s/es, or add trailing s) - covers
//      olive/olives, tomato/tomatoes, lemon/lemons.
//   3. Word-level edit-distance match for typo tolerance: for every "word"
//      in the haystack, check if it's within Levenshtein distance 1 of the
//      term (only for terms >= 4 chars, to avoid matching "a" -> "i").
//
// This is intentionally not a full vector/embedding match - it's fast,
// predictable, and good enough for ingredient-style queries.

function singularize(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 2 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 1 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function pluralize(word: string): string {
  if (word.endsWith("y") && word.length > 2 && !"aeiou".includes(word[word.length - 2])) {
    return word.slice(0, -1) + "ies";
  }
  if (/[sxz]$|[cs]h$/.test(word)) return word + "es";
  return word + "s";
}

function editDistanceAtMost(a: string, b: string, max: number): boolean {
  // Early-exit Levenshtein. Returns true iff distance <= max.
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  const n = a.length;
  const m = b.length;
  // Two-row DP, with row-min early exit.
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[m] <= max;
}

export type FuzzyOptions = {
  /** Allow edit-distance matching for terms of at least this length. */
  fuzzyMinLength?: number;
  /** Max edit distance for fuzzy matches. */
  fuzzyMaxDistance?: number;
};

export function fuzzyContains(
  haystackLower: string,
  termLower: string,
  opts: FuzzyOptions = {}
): boolean {
  const term = termLower.trim();
  if (!term) return true;
  if (haystackLower.includes(term)) return true;

  const sing = singularize(term);
  if (sing !== term && haystackLower.includes(sing)) return true;
  const plur = pluralize(term);
  if (plur !== term && haystackLower.includes(plur)) return true;

  const fuzzyMin = opts.fuzzyMinLength ?? 4;
  if (term.length < fuzzyMin) return false;
  const maxDist = opts.fuzzyMaxDistance ?? 1;

  // Token-level edit-distance fallback. Only worth doing for multi-letter
  // terms - we already covered exact substrings above.
  const tokens = haystackLower.split(/[^a-z0-9]+/);
  for (const tok of tokens) {
    if (!tok || tok.length < fuzzyMin) continue;
    if (editDistanceAtMost(tok, term, maxDist)) return true;
    if (editDistanceAtMost(tok, sing, maxDist)) return true;
  }
  return false;
}

export function matchesAllTerms(
  haystackLower: string,
  terms: string[],
  opts: FuzzyOptions = {}
): boolean {
  for (const t of terms) {
    if (!fuzzyContains(haystackLower, t.toLowerCase(), opts)) return false;
  }
  return true;
}
