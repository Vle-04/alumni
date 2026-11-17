import { redirect } from "next/navigation";
import { can } from "@/domain/rbac/permissions";
import { requireStaffPage } from "@/server/session";

export default async function Home() {
  const ctx = await requireStaffPage();
  redirect(can(ctx.actor.role, "dashboard:read") ? "/dashboard" : "/reports");
}
