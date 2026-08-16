import { defineConfig } from "drizzle-kit";

// Drizzle only requires a syntactically valid URL to generate SQL. Applying a migration
// still requires the real DATABASE_URL supplied by the deployed data-processing service.
const connectionString = process.env.DATABASE_URL || "mysql://schema:generate@localhost:3306/kpi_detective";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
});
