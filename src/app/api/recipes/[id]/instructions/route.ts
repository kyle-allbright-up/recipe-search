import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getActor } from "@/lib/auth";
import { getRecipe, updateRecipe } from "@/lib/store";
import { normalizeInstructions } from "@/lib/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(_request: Request, { params }: RouteContext) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Admin login required." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
  }

  const { id } = await params;
  const recipe = await getRecipe(id);
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (recipe.ingredients.length === 0 && !recipe.sourceUrl) {
    return NextResponse.json(
      {
        error:
          "No ingredients on file to base instructions on. Add ingredients first or paste them inline.",
      },
      { status: 400 }
    );
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a precise recipe assistant. Given a recipe name and ingredient list, write clear, numbered step-by-step cooking instructions. Use plain language, keep each step concise, and number every step starting from 1.",
        },
        {
          role: "user",
          content: `Name: ${recipe.name}\nType: ${recipe.type}\nIngredients:\n${recipe.ingredients.join("\n")}\n\nWrite the instructions.`,
        },
      ],
      max_tokens: 600,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return NextResponse.json({ error: "Empty response from model." }, { status: 502 });
    }
    const instructions = normalizeInstructions(text);
    const updated = await updateRecipe(id, { instructions }, actor);
    return NextResponse.json({ recipe: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate instructions." }, { status: 500 });
  }
}
