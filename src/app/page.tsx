import { getActor } from "@/lib/auth";
import Landing from "./_landing";
import RecipeBrowser from "./_recipe-browser";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getActor();
  if (!actor) return <Landing />;
  return <RecipeBrowser actor={actor} />;
}
