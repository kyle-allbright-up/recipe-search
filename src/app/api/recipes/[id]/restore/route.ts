import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth";
import { restoreRecipe } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Admin login required." }, { status: 401 });
  const { id } = await params;
  const recipe = await restoreRecipe(id, actor);
  if (!recipe) return NextResponse.json({ error: "Not in trash" }, { status: 404 });
  return NextResponse.json({ recipe });
}
