import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/get-session";
import { getAllUsers } from "@/lib/admin/users";
import { UsersManager } from "@/components/admin/users-manager";
import { hasPermission } from "@/lib/auth/permissions";

export default async function AdminUsersPage() {
  const session = await getSession();
  const user = session.adminUser;

  if (!user) {
    redirect("/admin/login");
  }

  if (!hasPermission(user.role, "manage_users")) {
    redirect("/admin");
  }

  const users = await getAllUsers();

  return (
    <UsersManager users={users} currentUserId={user.userId} />
  );
}
