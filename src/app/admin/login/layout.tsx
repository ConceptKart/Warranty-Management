import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/get-session";

export default async function AdminLoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (session.adminUser) {
    redirect("/admin");
  }

  return children;
}
