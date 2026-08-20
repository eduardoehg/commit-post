import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/core é consumido como TypeScript direto, sem passo de build.
  transpilePackages: ["@commitpost/core"],
};

export default nextConfig;
