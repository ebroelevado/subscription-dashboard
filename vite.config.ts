import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vinext({
      appDir: "./src",
    }),
  ],
  ssr: {
    external: ["better-sqlite3", "pg"],
  },
  optimizeDeps: {
    exclude: ["better-sqlite3", "pg"],
  },
});
