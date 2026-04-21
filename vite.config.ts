import vinext from "vinext";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    vinext({
      appDir: "./src",
    }),
    ...(process.env.NODE_ENV === "production"
      ? [
          cloudflare({
            viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
            config: {
              main: "virtual:vinext-rsc-entry",
              assets: {
                run_worker_first: true,
              },
            },
            auxiliaryWorkers: [
              {
                configPath: "workers/agent-session/wrangler.toml",
              },
            ],
          }),
        ]
      : []),
  ],
  ssr: {
    external: ["better-sqlite3", "pg"],
  },
  optimizeDeps: {
    exclude: ["better-sqlite3", "pg"],
  },
});
