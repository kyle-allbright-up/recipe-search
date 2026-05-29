import { NextResponse } from "next/server";
import { createRecipe, listRecipes } from "@/lib/store";
import { normalizeIngredients, normalizeInstructions } from "@/lib/recipes";
import { getActor, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Login required." }, { status: 401 });
  }
  const recipes = await listRecipes();
  return NextResponse.json({ recipes });
}

export async function POST(request: Request) {
  const actor = await requireAdmin();
  if (!actor) {
    return NextResponse.json({ error: "Admin required." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const draft = body as Record<string, unknown>;
  const name = String(draft.name ?? "").trim();
  const type = draft.type === "drinks" ? "drinks" : draft.type === "food" ? "food" : null;
  if (!name || !type) {
    return NextResponse.json(
      { error: "name and type ('food' or 'drinks') are required." },
      { status: 400 }
    );
  }
  const recipe = await createRecipe(
    {
      type,
      name,
      ingredients: normalizeIngredients(
        Array.isArray(draft.ingredients)
          ? (draft.ingredients as string[])
          : String(draft.ingredients ?? "")
      ),
      instructions: normalizeInstructions(String(draft.instructions ?? "")),
      comments: String(draft.comments ?? "").trim(),
      sourceUrl: draft.sourceUrl ? String(draft.sourceUrl).trim() || undefined : undefined,
      category: String(draft.category ?? "").trim(),
      tried: Boolean(draft.tried),
      greenBook: Boolean(draft.greenBook),
    },
    actor.email
  );
  return NextResponse.json({ recipe }, { status: 201 });
}
