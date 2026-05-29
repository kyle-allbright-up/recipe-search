import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listUsers } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });
  const users = await listUsers();
  return NextResponse.json({ users });
}
