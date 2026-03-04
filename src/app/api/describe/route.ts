import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    return NextResponse.json({ description });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to generate description" },
      { status: 500 }
    );
  }
}
