ALTER TABLE "kpi_import_rows" ADD COLUMN IF NOT EXISTS "is_outlier" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "kpi_import_rows_import_signature_uq";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_import_rows_import_signature_idx" ON "kpi_import_rows" USING btree ("import_id","row_signature");
