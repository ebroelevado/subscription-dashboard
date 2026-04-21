import vinext from "vinext";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    vinext({
      appDir: "./src",
    }),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
  ssr: {
    // better-sqlite3 and pg use native bindings, must be external for SSR
    external: ["better-sqlite3", "pg"],
  },
  optimizeDeps: {
    // Don't pre-bundle better-sqlite3 or pg
    exclude: ["better-sqlite3", "pg"],
  },
});
