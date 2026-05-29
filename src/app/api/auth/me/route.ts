import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  return NextResponse.json({ actor });
}
