import { getSession } from "@/lib/auth/get-session";
import { redirect } from "next/navigation";
import { AdminNavbar } from "@/components/admin/admin-navbar";
import { hasAnyPermission, hasPermission } from "@/lib/auth/permissions";

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session.adminUser) {
    redirect("/admin/login");
  }

  const user = session.adminUser;
  const role = user.role;

  return (
    <>
      <AdminNavbar
        name={user.name}
        role={role}
        canManageUsers={hasPermission(role, "manage_users")}
        canManageShipments={hasAnyPermission(role, [
          "manage_shipments",
          "assign_awb",
        ])}
        canViewShipmentInfo={hasAnyPermission(role, [
          "view_shipment_info",
          "manage_shipments",
          "assign_awb",
          "update_pack_status",
        ])}
      />
      <div className="container-fluid admin-content">{children}</div>
    </>
  );
}
