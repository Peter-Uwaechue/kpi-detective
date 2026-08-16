import { bigint, boolean, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const leadershipProfiles = mysqlTable("leadership_profiles", {
  id: int("id").autoincrement().primaryKey(),
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
  displayOrder: int("displayOrder").notNull().default(0),
  isPublished: boolean("isPublished").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const candidateReferrals = mysqlTable("candidate_referrals", {
  id: int("id").autoincrement().primaryKey(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type LeadershipProfileRow = typeof leadershipProfiles.$inferSelect;
export type InsertLeadershipProfile = typeof leadershipProfiles.$inferInsert;
export const kpiImports = mysqlTable("kpi_imports", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ownerOpenId: varchar("owner_open_id", { length: 64 }),
  originalFileName: varchar("original_file_name", { length: 520 }).notNull(),
  contentType: varchar("content_type", { length: 180 }).notNull(),
  storageKey: varchar("storage_key", { length: 760 }).notNull(),
  storageUrl: text("storage_url").notNull(),
  fileBytes: bigint("file_bytes", { mode: "number" }).notNull(),
  status: mysqlEnum("status", ["uploading", "queued", "profiling", "ingesting", "analyzing", "complete", "failed", "cancelled"]).notNull().default("uploading"),
  processingCursor: bigint("processing_cursor", { mode: "number" }).notNull().default(0),
  sourceRowCount: bigint("source_row_count", { mode: "number" }).notNull().default(0),
  usableRowCount: bigint("usable_row_count", { mode: "number" }).notNull().default(0),
  previewRowCount: bigint("preview_row_count", { mode: "number" }).notNull().default(0),
  columnsJson: json("columns_json"),
  cleaningSummaryJson: json("cleaning_summary_json"),
  analysisJson: json("analysis_json"),
  workerCheckpointJson: json("worker_checkpoint_json"),
  errorMessage: text("error_message"),
  attemptCount: int("attempt_count").notNull().default(0),
  queuedAt: timestamp("queued_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => [index("kpi_imports_owner_status_idx").on(table.ownerOpenId, table.status), index("kpi_imports_status_queued_idx").on(table.status, table.queuedAt)]);

export const kpiImportRows = mysqlTable("kpi_import_rows", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  importId: varchar("import_id", { length: 64 }).notNull(),
  rowNumber: bigint("row_number", { mode: "number" }).notNull(),
  rawValues: json("raw_values").notNull(),
  cleanedValues: json("cleaned_values").notNull(),
  changes: json("changes"),
  issues: json("issues"),
  excluded: boolean("excluded").notNull().default(false),
  possibleDuplicate: boolean("possible_duplicate").notNull().default(false),
  exactDuplicate: boolean("exact_duplicate").notNull().default(false),
  rowSignature: varchar("row_signature", { length: 128 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [uniqueIndex("kpi_import_rows_import_row_uq").on(table.importId, table.rowNumber), uniqueIndex("kpi_import_rows_import_signature_uq").on(table.importId, table.rowSignature)]);

export const kpiImportAggregates = mysqlTable("kpi_import_aggregates", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  importId: varchar("import_id", { length: 64 }).notNull(),
  metricColumn: varchar("metric_column", { length: 255 }).notNull(),
  period: varchar("period", { length: 20 }).notNull(),
  dimension: varchar("dimension", { length: 255 }).notNull(),
  segment: varchar("segment", { length: 520 }).notNull(),
  metricTotal: decimal("metric_total", { precision: 24, scale: 4 }).notNull(),
  recordCount: bigint("record_count", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("kpi_import_aggregates_key_uq").on(table.importId, table.metricColumn, table.period, table.dimension, table.segment), index("kpi_import_aggregates_import_period_idx").on(table.importId, table.period)]);

export type CandidateReferralRow = typeof candidateReferrals.$inferSelect;
export type InsertCandidateReferral = typeof candidateReferrals.$inferInsert;
export type KpiImportRow = typeof kpiImports.$inferSelect;
export type InsertKpiImport = typeof kpiImports.$inferInsert;
export type KpiImportPreviewRow = typeof kpiImportRows.$inferSelect;
export type KpiImportAggregateRow = typeof kpiImportAggregates.$inferSelect;
