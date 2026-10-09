import type { Metadata } from "next";
import Script from "next/script";
import "./admin.css";

export const metadata: Metadata = {
  title: "Warranty Admin",
  description: "Warranty Management System Admin",
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="admin-body">{children}</div>
      <Script
        src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"
        integrity="sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL"
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
    </>
  );
}
