import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext()],
  ssr: {
    // better-sqlite3 uses native bindings, must be external for SSR
    external: ["better-sqlite3"],
  },
  optimizeDeps: {
    // Don't pre-bundle better-sqlite3
    exclude: ["better-sqlite3"],
  },
});
