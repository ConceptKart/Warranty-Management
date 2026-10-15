import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/get-session";
import { hasPermission } from "@/lib/auth/permissions";
import { ShopifyImportForm } from "@/components/admin/shopify-import-form";

export default async function AdminShopifyImportPage() {
  const session = await getSession();
  const user = session.adminUser;
  if (!user) {
    redirect("/admin/login");
  }
  if (!hasPermission(user.role, "import_shopify_orders")) {
    redirect("/admin");
  }
  return <ShopifyImportForm />;
}
