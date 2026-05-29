import { redirect } from "next/navigation";
import { getActor, requireAdmin } from "@/lib/auth";
import UsersClient from "./_users-client";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const actor = await requireAdmin();
  if (!actor) {
    const anyActor = await getActor();
    if (!anyActor) redirect("/login");
    redirect("/");
  }
  return <UsersClient actor={actor} />;
}
