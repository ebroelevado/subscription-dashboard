import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext()],
  ssr: {
    // better-sqlite3 and pg use native bindings, must be external for SSR
    external: ["better-sqlite3", "pg"],
  },
  optimizeDeps: {
    // Don't pre-bundle better-sqlite3 or pg
    exclude: ["better-sqlite3", "pg"],
  },
});
