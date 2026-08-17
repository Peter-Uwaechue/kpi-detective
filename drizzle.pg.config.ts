import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL || "postgresql://schema:generate@localhost:5432/kpi_detective";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle-pg",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
