import { NextResponse } from "next/server";
import { list, put } from "@vercel/blob";

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ food: null, drinks: null });
  }
  try {
    const { blobs } = await list({ prefix: "recipes/" });
    const food = blobs.find((b) => b.pathname === "recipes/food.csv");
    const drinks = blobs.find((b) => b.pathname === "recipes/drinks.csv");
    return NextResponse.json({
      food: food?.url ?? null,
      drinks: drinks?.url ?? null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ food: null, drinks: null });
  }
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not configured" },
      { status: 500 }
    );
  }
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const type = formData.get("type") as string;
    if (!file || !type || !["food", "drinks"].includes(type)) {
      return NextResponse.json(
        { error: "Missing file or invalid type (use food or drinks)" },
        { status: 400 }
      );
    }
    const pathname = `recipes/${type}.csv`;
    const blob = await put(pathname, file, {
      access: "public",
      contentType: "text/csv",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
