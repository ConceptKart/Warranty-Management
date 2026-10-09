/**
 * Port of config/admin.php permissions + AdminController::hasPermission.
 * Admin also receives logistics perms (PHP matrix omitted them for admin).
 */

export const ADMIN_PERMISSIONS = [
  "view_all_tickets",
  "edit_tickets",
  "delete_tickets",
  "manage_users",
  "view_reports",
  "export_data",
  "manage_statuses",
  "view_internal_comments",
  "add_internal_comments",
  "manage_shipments",
  "assign_awb",
  "view_shipment_info",
  "update_pack_status",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<string, readonly AdminPermission[]> = {
  admin: ADMIN_PERMISSIONS,
  manager: [
    "view_all_tickets",
    "edit_tickets",
    "view_reports",
    "export_data",
    "manage_statuses",
    "view_internal_comments",
    "add_internal_comments",
  ],
  support: [
    "view_all_tickets",
    "edit_tickets",
    "manage_statuses",
    "add_internal_comments",
  ],
  operations: [
    "view_all_tickets",
    "edit_tickets",
    "manage_shipments",
    "assign_awb",
    "manage_statuses",
    "add_internal_comments",
    "view_shipment_info",
  ],
  packer: [
    "view_all_tickets",
    "edit_tickets",
    "view_shipment_info",
    "update_pack_status",
    "add_internal_comments",
  ],
};

export function hasPermission(
  role: string | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!role) return false;
  const list = ROLE_PERMISSIONS[role.toLowerCase()] ?? [];
  return list.includes(permission);
}

export function hasAnyPermission(
  role: string | null | undefined,
  permissions: readonly AdminPermission[],
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function listPermissions(role: string | null | undefined): AdminPermission[] {
  if (!role) return [];
  return [...(ROLE_PERMISSIONS[role.toLowerCase()] ?? [])];
}
