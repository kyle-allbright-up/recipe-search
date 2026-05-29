import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { setUserTier, type UserTier } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });
  const { id } = await params;
  let body: { tier?: string };
  try {
    body = (await req.json()) as { tier?: string };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const tier: UserTier | null =
    body.tier === "admin" ? "admin" : body.tier === "general" ? "general" : null;
  if (!tier) {
    return NextResponse.json(
      { error: "tier must be 'admin' or 'general'." },
      { status: 400 }
    );
  }
  if (id === actor.id && tier !== "admin") {
    return NextResponse.json(
      { error: "You can't demote your own admin account." },
      { status: 400 }
    );
  }
  const updated = await setUserTier(id, tier, actor.email);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user: updated });
}
