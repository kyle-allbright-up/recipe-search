import { list, put, head } from "@vercel/blob";
import seed from "../../data/recipes.seed.json";
import type {
  AuditEntry,
  Recipe,
  RecipeSeed,
  RecipeStoreSnapshot,
  RecipeType,
  TrashedRecipe,
} from "./recipes";

// Blob storage layout. Everything lives under `recipes/v2/` so it doesn't
// clobber any older blobs in the same bucket.
const SNAPSHOT_PATH = "recipes/v2/store.json";
const AUDIT_LOG_PATH = "recipes/v2/audit-log.json";
const BACKUP_PREFIX = "recipes/v2/backups/";
// We keep an unbounded backup history because the user explicitly said
// recipes should "never be forgotten". If this ever balloons we can
// prune the oldest backups, but it's intentional to err on the side of
// keeping more.

function nowIso(): string {
  return new Date().toISOString();
}

function buildInitialSnapshot(): RecipeStoreSnapshot {
  const seedData = seed as RecipeSeed;
  return {
    version: seedData.version,
    updatedAt: seedData.builtAt,
    recipes: seedData.recipes as Recipe[],
    trash: [],
  };
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
  if (!hasBlob()) {
    // Local dev without Blob: changes are kept in-process via the cache below.
    return;
  }
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

// In-process cache used both for performance and as the local-dev fallback
// when there's no Blob token. The cache is invalidated on every successful
// write so reads always reflect the latest snapshot.
let snapshotCache: RecipeStoreSnapshot | null = null;
let auditCache: AuditEntry[] | null = null;

async function loadSnapshot(): Promise<RecipeStoreSnapshot> {
  if (snapshotCache) return snapshotCache;
  const remote = await readJson<RecipeStoreSnapshot>(SNAPSHOT_PATH);
  if (remote) {
    snapshotCache = remote;
    return remote;
  }
  // First-ever run: seed from the bundled JSON. Persist to Blob so future
  // requests get the same snapshot.
  const seeded = buildInitialSnapshot();
  if (hasBlob()) {
    await writeJson(SNAPSHOT_PATH, seeded);
  }
  snapshotCache = seeded;
  return seeded;
}

async function loadAudit(): Promise<AuditEntry[]> {
  if (auditCache) return auditCache;
  const remote = await readJson<AuditEntry[]>(AUDIT_LOG_PATH);
  auditCache = remote ?? [];
  return auditCache;
}

async function backupSnapshot(snapshot: RecipeStoreSnapshot): Promise<void> {
  if (!hasBlob()) return;
  // Best-effort: a failed backup must never block an edit, but every successful
  // edit gets its own immutable timestamped copy. This is our last line of
  // defense against data loss.
  try {
    const stamp = nowIso().replace(/[:.]/g, "-");
    await put(`${BACKUP_PREFIX}${stamp}.json`, JSON.stringify(snapshot, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (err) {
    console.warn("Recipe snapshot backup failed:", err);
  }
}

async function commitSnapshot(
  snapshot: RecipeStoreSnapshot,
  audit: AuditEntry
): Promise<void> {
  snapshot.updatedAt = nowIso();
  await backupSnapshot(snapshot);
  await writeJson(SNAPSHOT_PATH, snapshot);

  const log = await loadAudit();
  log.push(audit);
  await writeJson(AUDIT_LOG_PATH, log);

  snapshotCache = snapshot;
  auditCache = log;
}

export async function listRecipes(): Promise<Recipe[]> {
  const snapshot = await loadSnapshot();
  return snapshot.recipes;
}

export async function listRecipesByType(type: RecipeType): Promise<Recipe[]> {
  const snapshot = await loadSnapshot();
  return snapshot.recipes.filter((r) => r.type === type);
}

export async function listTrash(): Promise<TrashedRecipe[]> {
  const snapshot = await loadSnapshot();
  return snapshot.trash;
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const snapshot = await loadSnapshot();
  return snapshot.recipes.find((r) => r.id === id) ?? null;
}

export async function getTrashedRecipe(id: string): Promise<TrashedRecipe | null> {
  const snapshot = await loadSnapshot();
  return snapshot.trash.find((r) => r.id === id) ?? null;
}

export type RecipePatch = Partial<
  Pick<
    Recipe,
    | "name"
    | "ingredients"
    | "instructions"
    | "comments"
    | "sourceUrl"
    | "category"
    | "tried"
    | "greenBook"
  >
>;

export async function updateRecipe(
  id: string,
  patch: RecipePatch,
  actor: string
): Promise<Recipe | null> {
  const snapshot = await loadSnapshot();
  const idx = snapshot.recipes.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const before = snapshot.recipes[idx];
  const updated: Recipe = {
    ...before,
    ...patch,
    updatedAt: nowIso(),
  };
  const next = {
    ...snapshot,
    recipes: snapshot.recipes.map((r, i) => (i === idx ? updated : r)),
  };
  await commitSnapshot(next, {
    at: nowIso(),
    actor,
    action: "update",
    recipeId: updated.id,
    recipeName: updated.name,
    details: { changed: Object.keys(patch) },
  });
  return updated;
}

export async function createRecipe(
  draft: Omit<Recipe, "id" | "createdAt" | "updatedAt" | "order">,
  actor: string
): Promise<Recipe> {
  const snapshot = await loadSnapshot();
  const now = nowIso();
  const recipe: Recipe = {
    ...draft,
    id: `${draft.type[0]}-${draft.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: now,
    updatedAt: now,
    order: 0,
  };
  const next = {
    ...snapshot,
    recipes: [...snapshot.recipes, recipe],
  };
  await commitSnapshot(next, {
    at: now,
    actor,
    action: "create",
    recipeId: recipe.id,
    recipeName: recipe.name,
  });
  return recipe;
}

export async function softDeleteRecipe(id: string, actor: string): Promise<Recipe | null> {
  const snapshot = await loadSnapshot();
  const idx = snapshot.recipes.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const recipe = snapshot.recipes[idx];
  const trashed: TrashedRecipe = {
    ...recipe,
    trashedAt: nowIso(),
    trashedBy: actor,
  };
  const next = {
    ...snapshot,
    recipes: snapshot.recipes.filter((_, i) => i !== idx),
    trash: [...snapshot.trash, trashed],
  };
  await commitSnapshot(next, {
    at: nowIso(),
    actor,
    action: "soft_delete",
    recipeId: recipe.id,
    recipeName: recipe.name,
  });
  return recipe;
}

export async function restoreRecipe(id: string, actor: string): Promise<Recipe | null> {
  const snapshot = await loadSnapshot();
  const idx = snapshot.trash.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const trashEntry = snapshot.trash[idx];
  const restored: Recipe = {
    id: trashEntry.id,
    type: trashEntry.type,
    name: trashEntry.name,
    ingredients: trashEntry.ingredients,
    instructions: trashEntry.instructions,
    comments: trashEntry.comments,
    sourceUrl: trashEntry.sourceUrl,
    category: trashEntry.category,
    tried: trashEntry.tried,
    greenBook: trashEntry.greenBook,
    order: trashEntry.order,
    createdAt: trashEntry.createdAt,
    updatedAt: nowIso(),
  };
  const next = {
    ...snapshot,
    recipes: [...snapshot.recipes, restored],
    trash: snapshot.trash.filter((_, i) => i !== idx),
  };
  await commitSnapshot(next, {
    at: nowIso(),
    actor,
    action: "restore",
    recipeId: restored.id,
    recipeName: restored.name,
  });
  return restored;
}

export type HardDeleteIntent = {
  id: string;
  typedName: string;
  passwordReentered: boolean;
  doubleConfirmed: boolean;
};

export async function hardDeleteRecipe(
  intent: HardDeleteIntent,
  actor: string
): Promise<{ ok: true; recipeName: string } | { ok: false; reason: string }> {
  if (!intent.passwordReentered) {
    return { ok: false, reason: "Re-enter your admin password to hard delete." };
  }
  if (!intent.doubleConfirmed) {
    return { ok: false, reason: "Double confirmation is required." };
  }
  const snapshot = await loadSnapshot();
  const trashIdx = snapshot.trash.findIndex((r) => r.id === intent.id);
  if (trashIdx === -1) {
    return { ok: false, reason: "Recipe is not in the trash." };
  }
  const target = snapshot.trash[trashIdx];
  if (intent.typedName.trim().toLowerCase() !== target.name.trim().toLowerCase()) {
    return {
      ok: false,
      reason: `To permanently delete, you must type the recipe name exactly: "${target.name}".`,
    };
  }
  const next = {
    ...snapshot,
    trash: snapshot.trash.filter((_, i) => i !== trashIdx),
  };
  await commitSnapshot(next, {
    at: nowIso(),
    actor,
    action: "hard_delete",
    recipeId: target.id,
    recipeName: target.name,
    details: { trashedAt: target.trashedAt, trashedBy: target.trashedBy },
  });
  return { ok: true, recipeName: target.name };
}

export async function recordAudit(entry: Omit<AuditEntry, "at">): Promise<void> {
  const log = await loadAudit();
  const next = [...log, { ...entry, at: nowIso() }];
  await writeJson(AUDIT_LOG_PATH, next);
  auditCache = next;
}

export async function readAuditLog(): Promise<AuditEntry[]> {
  return loadAudit();
}

export async function listBackups(): Promise<{ pathname: string; uploadedAt: string; url: string }[]> {
  if (!hasBlob()) return [];
  try {
    const { blobs } = await list({ prefix: BACKUP_PREFIX });
    return blobs.map((b) => ({
      pathname: b.pathname,
      uploadedAt: b.uploadedAt instanceof Date ? b.uploadedAt.toISOString() : String(b.uploadedAt),
      url: b.url,
    }));
  } catch {
    return [];
  }
}

// Test-only / boot helper: clear in-process cache. Used by integration tests
// and admin "reload" actions.
export function _resetCacheForTests(): void {
  snapshotCache = null;
  auditCache = null;
}
