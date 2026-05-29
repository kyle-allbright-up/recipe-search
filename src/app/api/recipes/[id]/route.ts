import { NextResponse } from "next/server";
import { getActor, requireAdmin } from "@/lib/auth";
import { getRecipe, softDeleteRecipe, updateRecipe, type RecipePatch } from "@/lib/store";
import { normalizeIngredients, normalizeInstructions } from "@/lib/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Login required." }, { status: 401 });
  const { id } = await params;
  const recipe = await getRecipe(id);
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ recipe });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: RecipePatch = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (body.ingredients !== undefined) {
    patch.ingredients = normalizeIngredients(
      Array.isArray(body.ingredients) ? (body.ingredients as string[]) : String(body.ingredients)
    );
  }
  if (typeof body.instructions === "string") {
    patch.instructions = normalizeInstructions(body.instructions);
  }
  if (typeof body.comments === "string") patch.comments = body.comments.trim();
  if (typeof body.category === "string") patch.category = body.category.trim();
  if (body.sourceUrl !== undefined) {
    const url = String(body.sourceUrl ?? "").trim();
    patch.sourceUrl = url || undefined;
  }
  if (typeof body.tried === "boolean") patch.tried = body.tried;
  if (typeof body.greenBook === "boolean") patch.greenBook = body.greenBook;

  const updated = await updateRecipe(id, patch, actor.email);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ recipe: updated });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });
  const { id } = await params;
  const trashed = await softDeleteRecipe(id, actor.email);
  if (!trashed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ recipe: trashed, message: "Moved to trash." });
}
