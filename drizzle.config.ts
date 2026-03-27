import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "sqlite",
  verbose: true,
  strict: true,
  // For Drizzle Studio in development - uses local SQLite file
  dbCredentials: {
    url: "./local.db",
  },
});
