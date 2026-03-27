import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cloudflare Pages uses @cloudflare/next-on-pages adapter
  // which automatically handles the output configuration

  // Keep the Copilot CLI package external (not bundled by webpack)
  // because we execute its path manually.
  // bun:sqlite must be external - it's a built-in Bun module, not an npm package
  // Without this, Turbopack tries to resolve it as a regular module and fails
  serverExternalPackages: [
    "@github/copilot",
    "@cloudflare/next-on-pages",
    "bun:sqlite",
  ],

  experimental: {
    // Limit CPU count to prevent OOM during production build on high-core machines.
    cpus: 4,
    workerThreads: false,
  }
};

export default withNextIntl(nextConfig);
