import { requireStaffPage } from "@/server/session";
import { getAllSettings } from "@/server/services/settings-admin";
import { PageHeader } from "@/components/ui";
import { SettingsForms } from "./SettingsForms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireStaffPage("settings:manage");
  const s = await getAllSettings(ctx);
  return (<><PageHeader title="Settings" description="Every change is validated and written to the audit log." /><SettingsForms s={s} /></>);
}
