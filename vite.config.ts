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
    external: ["better-sqlite3", "pg"],
  },
  optimizeDeps: {
    exclude: ["better-sqlite3", "pg"],
  },
});
