import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type RecipeSummary = {
  index: number;
  name: string;
  ingredients: string;
  description?: string;
};

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
    (r: {
      index: number;
      name: string;
      ingredients: string;
      description?: string;
    }) => ({
      index: r.index,
      name: r.name,
      ingredients: r.ingredients,
      description: r.description ?? "",
    })
  );

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a recipe search assistant. The user gives a search query and a list of recipes. Each recipe has an index, name, ingredients, and an AI-generated description that summarizes what the dish is like.

Your job: do a SEMANTIC / FUZZY match. Match the query to recipes based on how they SOUND and what they evoke, using the description first (and name/ingredients as backup). Examples:
- "comfort food" → recipes whose description suggests cozy, indulgent, hearty, nostalgic, satisfying (e.g. "warm and hearty", "rich and creamy", "classic family favorite")
- "light lunch" → descriptions that suggest light, fresh, quick, healthy, salad-like
- "quick weeknight" → fast, simple, easy, weeknight-friendly
- "fancy dinner" → elegant, impressive, special-occasion
Be inclusive: when in doubt, include a recipe. Return a JSON array of matching recipe indices only, e.g. [0, 2, 5]. Return [] only if nothing plausibly matches. Output nothing else except the array.`,
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nRecipes:\n${summaries
            .map(
              (r) =>
                `[${r.index}] ${r.name}\nDescription: ${r.description || "(no description)"}\nIngredients: ${r.ingredients.slice(0, 200)}${r.ingredients.length > 200 ? "..." : ""}`
            )
            .join("\n\n")}`,
        },
      ],
      max_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
    const arrayMatch = raw.match(/\[[\d,\s]*\]/);
    let indices: number[] = [];
    if (arrayMatch) {
      try {
        indices = JSON.parse(arrayMatch[0]);
      } catch {
        indices = [];
      }
    }
    if (!Array.isArray(indices)) indices = [];
    indices = indices.filter(
      (i) => typeof i === "number" && i >= 0 && i < summaries.length
    );
    return NextResponse.json({ indices });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
