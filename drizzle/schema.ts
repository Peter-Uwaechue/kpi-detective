import { bigint, bigserial, boolean, index, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const kpiImportStatusEnum = pgEnum("kpi_import_status", ["uploading", "queued", "profiling", "ingesting", "analyzing", "complete", "failed", "cancelled"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});

export const leadershipProfiles = pgTable("leadership_profiles", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 140 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  title: varchar("title", { length: 220 }).notNull(),
  organisation: varchar("organisation", { length: 220 }).notNull(),
  portraitUrl: text("portraitUrl").notNull(),
  portraitKey: varchar("portraitKey", { length: 520 }),
  linkedinUrl: varchar("linkedinUrl", { length: 520 }),
  quote: text("quote"),
  biography: text("biography").notNull(),
  sectors: text("sectors").notNull(),
  expertise: text("expertise").notNull(),
  displayOrder: integer("displayOrder").notNull().default(0),
  isPublished: boolean("isPublished").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const candidateReferrals = pgTable("candidate_referrals", {
  id: serial("id").primaryKey(),
  jobSlug: varchar("jobSlug", { length: 180 }).notNull(),
  jobTitle: varchar("jobTitle", { length: 260 }).notNull(),
  referrerName: varchar("referrerName", { length: 180 }).notNull(),
  referrerEmail: varchar("referrerEmail", { length: 320 }).notNull(),
  candidateName: varchar("candidateName", { length: 180 }).notNull(),
  candidateEmail: varchar("candidateEmail", { length: 320 }).notNull(),
  candidateLinkedin: varchar("candidateLinkedin", { length: 520 }),
  rationale: text("rationale").notNull(),
  cvFileName: varchar("cvFileName", { length: 255 }).notNull(),
  cvMimeType: varchar("cvMimeType", { length: 120 }).notNull(),
  cvStorageKey: varchar("cvStorageKey", { length: 520 }).notNull(),
  cvUrl: text("cvUrl").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type LeadershipProfileRow = typeof leadershipProfiles.$inferSelect;
export type InsertLeadershipProfile = typeof leadershipProfiles.$inferInsert;

export const kpiImports = pgTable("kpi_imports", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ownerOpenId: varchar("owner_open_id", { length: 128 }),
  originalFileName: varchar("original_file_name", { length: 520 }).notNull(),
  contentType: varchar("content_type", { length: 180 }).notNull(),
  storageKey: varchar("storage_key", { length: 760 }).notNull(),
  storageUrl: text("storage_url").notNull(),
  fileBytes: bigint("file_bytes", { mode: "number" }).notNull(),
  status: kpiImportStatusEnum("status").notNull().default("uploading"),
  processingCursor: bigint("processing_cursor", { mode: "number" }).notNull().default(0),
  sourceRowCount: bigint("source_row_count", { mode: "number" }).notNull().default(0),
  usableRowCount: bigint("usable_row_count", { mode: "number" }).notNull().default(0),
  previewRowCount: bigint("preview_row_count", { mode: "number" }).notNull().default(0),
  columnsJson: jsonb("columns_json"),
  cleaningSummaryJson: jsonb("cleaning_summary_json"),
  analysisJson: jsonb("analysis_json"),
  workerCheckpointJson: jsonb("worker_checkpoint_json"),
  errorMessage: text("error_message"),
  attemptCount: integer("attemptCount").notNull().default(0),
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("kpi_imports_owner_status_idx").on(table.ownerOpenId, table.status), index("kpi_imports_status_queued_idx").on(table.status, table.queuedAt)]);

export const kpiImportRows = pgTable("kpi_import_rows", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  importId: varchar("import_id", { length: 64 }).notNull(),
  rowNumber: bigint("row_number", { mode: "number" }).notNull(),
  rawValues: jsonb("raw_values").notNull(),
  cleanedValues: jsonb("cleaned_values").notNull(),
  changes: jsonb("changes"),
  issues: jsonb("issues"),
  excluded: boolean("excluded").notNull().default(false),
  possibleDuplicate: boolean("possible_duplicate").notNull().default(false),
  isOutlier: boolean("is_outlier").notNull().default(false),
  exactDuplicate: boolean("exact_duplicate").notNull().default(false),
  rowSignature: varchar("row_signature", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("kpi_import_rows_import_row_uq").on(table.importId, table.rowNumber), index("kpi_import_rows_import_signature_idx").on(table.importId, table.rowSignature)]);

export const kpiImportAggregates = pgTable("kpi_import_aggregates", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  importId: varchar("import_id", { length: 64 }).notNull(),
  metricColumn: varchar("metric_column", { length: 255 }).notNull(),
  period: varchar("period", { length: 20 }).notNull(),
  dimension: varchar("dimension", { length: 255 }).notNull(),
  segment: varchar("segment", { length: 520 }).notNull(),
  metricTotal: numeric("metric_total", { precision: 24, scale: 4 }).notNull(),
  recordCount: bigint("record_count", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("kpi_import_aggregates_key_uq").on(table.importId, table.metricColumn, table.period, table.dimension, table.segment), index("kpi_import_aggregates_import_period_idx").on(table.importId, table.period)]);

export type CandidateReferralRow = typeof candidateReferrals.$inferSelect;
export type InsertCandidateReferral = typeof candidateReferrals.$inferInsert;
export type KpiImportRow = typeof kpiImportRows.$inferSelect;
export type InsertKpiImport = typeof kpiImports.$inferInsert;
export type KpiImportPreviewRow = typeof kpiImportRows.$inferSelect;
export type KpiImportAggregateRow = typeof kpiImportAggregates.$inferSelect;
