import { NextResponse } from "next/server";
import OpenAI from "openai";
import { get, put } from "@vercel/blob";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CACHE_PATH = "recipes/description-cache.json";

type DescriptionCache = Record<string, string>;

async function readCache(): Promise<DescriptionCache> {
  try {
    const result = await get(CACHE_PATH, { access: "private" });
    if (!result?.blob) return {};
    const text = await result.blob.text();
    return text ? (JSON.parse(text) as DescriptionCache) : {};
  } catch {
    return {};
  }
}

async function writeCache(cache: DescriptionCache): Promise<void> {
  try {
    await put(CACHE_PATH, JSON.stringify(cache), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch {
    // If cache write fails, we still return the generated description.
  }
}

export async function POST(request: Request) {
  const { name, ingredients } = await request.json();
  if (!name || !ingredients) {
    return NextResponse.json(
      { error: "Missing name or ingredients" },
      { status: 400 }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const key = `${name.trim()}::${String(ingredients).trim()}`;

  // Try cache first (shared across all users via Vercel Blob).
  const cache = await readCache();
  const cached = cache[key];
  if (cached) {
    return NextResponse.json({ description: cached });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You write very brief recipe descriptions in 1-2 sentences. Be concise and appetizing.",
        },
        {
          role: "user",
          content: `Write a 1-2 sentence description for this recipe:\n\nName: ${name}\nIngredients: ${ingredients}`,
        },
      ],
      max_tokens: 80,
    });

    const description =
      completion.choices[0]?.message?.content?.trim() ?? "A tasty recipe.";

    // Persist to cache so future users don't re-generate this description.
    cache[key] = description;
    await writeCache(cache);

    return NextResponse.json({ description });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to generate description" },
      { status: 500 }
    );
  }
}
