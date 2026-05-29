import { NextResponse } from "next/server";
import { createPendingUser } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const result = await createPendingUser({
    email: String(body.email ?? ""),
    firstName: String(body.firstName ?? ""),
    lastName: String(body.lastName ?? ""),
    password: String(body.password ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json(
    {
      ok: true,
      message:
        "Account submitted. An admin will review your request - you'll be able to sign in once you're approved.",
      user: result.user,
    },
    { status: 201 }
  );
}
