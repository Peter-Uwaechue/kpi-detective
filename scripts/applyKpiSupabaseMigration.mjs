import fs from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationPath = new URL("../drizzle-pg/0000_deep_proteus.sql", import.meta.url);
const migration = await fs.readFile(migrationPath, "utf8");
const statements = migration
  .split("--> statement-breakpoint")
  .map(statement => statement.trim())
  .filter(Boolean);

const sql = postgres(databaseUrl, { prepare: false, max: 1 });
try {
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
  console.log(`Applied ${statements.length} KPI Detective Supabase schema statements.`);
} finally {
  await sql.end({ timeout: 5 });
}
