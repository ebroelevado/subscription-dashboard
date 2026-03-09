import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Use standalone output for optimized deployment.
  // This is required by the Railpack/Dokploy environment.
  output: "standalone",

  // Keep the Copilot CLI package external (not bundled by webpack)
  // because we execute its path manually.
  serverExternalPackages: ["@github/copilot"],

  experimental: {
    // Limit CPU count to prevent OOM during production build on high-core machines.
    cpus: 4,
    workerThreads: false,
  }
};

export default withNextIntl(nextConfig);
