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
