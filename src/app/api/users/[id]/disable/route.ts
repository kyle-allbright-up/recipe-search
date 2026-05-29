import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { disableUser } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteContext) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });
  const { id } = await params;
  if (id === actor.id) {
    return NextResponse.json({ error: "You can't disable yourself." }, { status: 400 });
  }
  const updated = await disableUser(id, actor.email);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user: updated });
}
