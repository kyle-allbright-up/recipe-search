import { NextResponse } from "next/server";
import { requireAdmin, verifyActorPassword } from "@/lib/auth";
import { hardDeleteRecipe } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard delete is intentionally a separate endpoint with its own gauntlet:
//   1. Must be admin (session cookie).
//   2. Must re-enter the admin password in the request body.
//   3. Must type the recipe name exactly.
//   4. Must explicitly set { doubleConfirm: true }.
// All four must match. The store layer enforces them again as a defense in
// depth, but we short-circuit auth and password checks here so we can return
// useful error messages.
export async function POST(request: Request) {
  const actor = await requireAdmin();
  if (!actor) return NextResponse.json({ error: "Admin required." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const typedName = typeof body.typedName === "string" ? body.typedName : "";
  const password = typeof body.password === "string" ? body.password : "";
  const doubleConfirm = body.doubleConfirm === true;

  if (!id || !typedName || !password) {
    return NextResponse.json(
      { error: "id, typedName, and password are all required." },
      { status: 400 }
    );
  }
  if (!(await verifyActorPassword(actor, password))) {
    return NextResponse.json({ error: "Incorrect admin password." }, { status: 401 });
  }

  const result = await hardDeleteRecipe(
    { id, typedName, passwordReentered: true, doubleConfirmed: doubleConfirm },
    actor.email
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, deleted: result.recipeName });
}
