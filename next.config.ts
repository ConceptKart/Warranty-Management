import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for lean Docker / Dokploy image
  output: "standalone",
};

export default nextConfig;
