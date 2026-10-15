import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for lean Docker / Dokploy image
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/correct_shopify_import_order.php",
        destination: "/admin/shopify-import",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
