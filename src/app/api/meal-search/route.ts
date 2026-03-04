import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type RecipeSummary = { index: number; name: string; ingredients: string };

export async function POST(request: Request) {
  const { query, recipes } = await request.json();
  if (!query || !Array.isArray(recipes)) {
    return NextResponse.json(
      { error: "Missing query or recipes" },
      { status: 400 }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  const summaries: RecipeSummary[] = recipes.map(
    (r: { index: number; name: string; ingredients: string }) => ({
      index: r.index,
      name: r.name,
      ingredients: r.ingredients,
    })
  );

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a recipe search assistant. The user will provide a search query and a list of recipes (each with index, name, ingredients).
Return a JSON array of indices for recipes that match the query. Consider:
- Meal type (breakfast, lunch, dinner, snack)
- Cuisine or style
- Dietary preferences (vegetarian, light, comforting, etc.)
- Ingredients the user wants or avoids
- Mood or occasion (quick weeknight, fancy dinner, etc.)
Return ONLY a JSON array of matching indices, e.g. [0, 3, 7]. Return [] if none match.`,
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nRecipes:\n${summaries
            .map(
              (r) =>
                `[${r.index}] ${r.name}\nIngredients: ${r.ingredients.slice(0, 300)}${r.ingredients.length > 300 ? "..." : ""}`
            )
            .join("\n\n")}`,
        },
      ],
      max_tokens: 200,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
    const match = raw.match(/\[[\d,\s]*\]/);
    const indices = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ indices });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
