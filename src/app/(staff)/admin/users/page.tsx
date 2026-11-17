import { requireStaffPage } from "@/server/session";
import { listUsers } from "@/server/services/users";
import { Button, Card, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { InviteForm } from "./InviteForm";
import { inviteUserAction, updateUserAction } from "./actions";

export const metadata = { title: "Staff users" };

export default async function UsersPage() {
  const ctx = await requireStaffPage("user:manage");
  const users = await listUsers(ctx);
  return (
    <>
      <PageHeader title="Staff users" description="Only invited staff can sign in. Deactivating a user signs them out everywhere." />
      <Card title="Invite a staff member" className="mb-6"><InviteForm action={inviteUserAction} /></Card>
      <Table caption="Staff users">
        <thead><tr><Th>Name</Th><Th>Email</Th><Th>Last sign-in</Th><Th>Role & status</Th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <Td>{u.name}</Td><Td>{u.email}</Td><Td>{fmtDateTime(u.lastLoginAt)}</Td>
            <Td>
              <form action={updateUserAction.bind(null, u.id)} className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.name}</label>
                <Select id={`role-${u.id}`} name="role" defaultValue={u.role} className="w-auto">
                  <option value="ADMIN">Admin</option><option value="CAREER_SERVICES">Career Services</option><option value="LEADERSHIP">Leadership / Marketing</option>
                </Select>
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                <Button type="submit" variant="secondary">Save</Button>
              </form>
            </Td>
          </tr>
        ))}</tbody>
      </Table>
    </>
  );
}
