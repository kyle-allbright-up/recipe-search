import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { deleteUser, getUserById } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });
  const { id } = await params;
  const u = await getUserById(id);
  if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _ph, ...safe } = u;
  return NextResponse.json({ user: safe });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });
  const { id } = await params;
  if (id === actor.id) {
    return NextResponse.json(
      { error: "You can't delete your own account." },
      { status: 400 }
    );
  }
  const removed = await deleteUser(id, actor.email);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: removed.email });
}
