import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth";
import { listTrash } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Admin login required." }, { status: 401 });
  const trash = await listTrash();
  return NextResponse.json({ trash });
}
