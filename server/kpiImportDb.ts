import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import {
  type InsertKpiImport,
  kpiImportAggregates,
  kpiImportRows,
  kpiImports,
} from "../drizzle/schema";
import { getDb } from "./db";

export type ImportStatus = "uploading" | "queued" | "profiling" | "ingesting" | "analyzing" | "complete" | "failed" | "cancelled";

type JsonObject = Record<string, unknown>;

export type ImportRowWrite = {
  rowNumber: number;
  rawValues: JsonObject;
  cleanedValues: JsonObject;
  changes?: unknown[];
  issues?: unknown[];
  excluded?: boolean;
  possibleDuplicate?: boolean;
  isOutlier?: boolean;
  exactDuplicate?: boolean;
  rowSignature: string;
};

export type AggregateWrite = {
  metricColumn: string;
  period: string;
  dimension: string;
  segment: string;
  metricTotal: number;
  recordCount: number;
};

const unavailable = () => new Error("Large-file processing is not configured: DATABASE_URL is required on both the API and worker services.");

export async function createKpiImport(input: InsertKpiImport) {
  const db = await getDb();
  if (!db) throw unavailable();
  await db.insert(kpiImports).values(input);
  return input.id;
}

export async function getKpiImport(importId: string, ownerOpenId?: string | null) {
  const db = await getDb();
  if (!db) throw unavailable();
  const where = ownerOpenId ? and(eq(kpiImports.id, importId), eq(kpiImports.ownerOpenId, ownerOpenId)) : eq(kpiImports.id, importId);
  const rows = await db.select().from(kpiImports).where(where).limit(1);
  return rows[0] ?? null;
}

export async function updateKpiImport(importId: string, values: Partial<typeof kpiImports.$inferInsert>) {
  const db = await getDb();
  if (!db) throw unavailable();
  await db.update(kpiImports).set(values).where(eq(kpiImports.id, importId));
}

export async function filterNovelImportRows(importId: string, rows: ImportRowWrite[]) {
  if (!rows.length) return [];
  const db = await getDb();
  if (!db) throw unavailable();
  const withinBatch = new Set<string>();
  const uniqueCandidates = rows.filter(row => {
    if (withinBatch.has(row.rowSignature)) return false;
    withinBatch.add(row.rowSignature);
    return true;
  });
  const signatures = uniqueCandidates.map(row => row.rowSignature);
  const existing = signatures.length ? await db.select({ rowSignature: kpiImportRows.rowSignature }).from(kpiImportRows).where(and(eq(kpiImportRows.importId, importId), inArray(kpiImportRows.rowSignature, signatures))) : [];
  const seen = new Set(existing.map(row => row.rowSignature));
  return uniqueCandidates.filter(row => !seen.has(row.rowSignature));
}

export async function writeImportRows(importId: string, rows: ImportRowWrite[]) {
  if (!rows.length) return;
  const db = await getDb();
  if (!db) throw unavailable();
  await db.insert(kpiImportRows).values(rows.map(row => ({
    importId,
    rowNumber: row.rowNumber,
    rawValues: row.rawValues,
    cleanedValues: row.cleanedValues,
    changes: row.changes ?? [],
    issues: row.issues ?? [],
    excluded: row.excluded ?? false,
    possibleDuplicate: row.possibleDuplicate ?? false,
    isOutlier: row.isOutlier ?? false,
    exactDuplicate: row.exactDuplicate ?? false,
    rowSignature: row.rowSignature,
  }))).onConflictDoUpdate({
    target: [kpiImportRows.importId, kpiImportRows.rowNumber],
    set: {
      rawValues: sql`excluded.raw_values`,
      cleanedValues: sql`excluded.cleaned_values`,
      changes: sql`excluded.changes`,
      issues: sql`excluded.issues`,
      excluded: sql`excluded.excluded`,
      possibleDuplicate: sql`excluded.possible_duplicate`,
      isOutlier: sql`excluded.is_outlier`,
      exactDuplicate: sql`excluded.exact_duplicate`,
      rowSignature: sql`excluded.row_signature`,
    },
  });
}

export async function writeImportAggregates(importId: string, aggregates: AggregateWrite[]) {
  if (!aggregates.length) return;
  const db = await getDb();
  if (!db) throw unavailable();
  await db.insert(kpiImportAggregates).values(aggregates.map(item => ({
    importId,
    metricColumn: item.metricColumn,
    period: item.period,
    dimension: item.dimension,
    segment: item.segment,
    metricTotal: item.metricTotal.toFixed(4),
    recordCount: item.recordCount,
  }))).onConflictDoUpdate({
    target: [kpiImportAggregates.importId, kpiImportAggregates.metricColumn, kpiImportAggregates.period, kpiImportAggregates.dimension, kpiImportAggregates.segment],
    set: {
      metricTotal: sql`${kpiImportAggregates.metricTotal} + excluded.metric_total`,
      recordCount: sql`${kpiImportAggregates.recordCount} + excluded.record_count`,
    },
  });
}

export async function resetKpiImportData(importId: string) {
  const db = await getDb();
  if (!db) throw unavailable();
  await db.delete(kpiImportAggregates).where(eq(kpiImportAggregates.importId, importId));
  await db.delete(kpiImportRows).where(eq(kpiImportRows.importId, importId));
  await db.update(kpiImports).set({
    processingCursor: 0,
    sourceRowCount: 0,
    usableRowCount: 0,
    previewRowCount: 0,
    columnsJson: null,
    cleaningSummaryJson: null,
    analysisJson: null,
    workerCheckpointJson: { phase: "profiling", restarted: true },
    errorMessage: null,
    completedAt: null,
  }).where(eq(kpiImports.id, importId));
}

export async function claimNextQueuedImport() {
  const db = await getDb();
  if (!db) throw unavailable();
  const candidates = await db.select().from(kpiImports).where(eq(kpiImports.status, "queued")).orderBy(asc(kpiImports.queuedAt), asc(kpiImports.createdAt)).limit(1);
  const candidate = candidates[0];
  if (!candidate) return null;
  const now = new Date();
  const result = await db.update(kpiImports).set({
    status: "profiling",
    startedAt: now,
    attemptCount: sql`${kpiImports.attemptCount} + 1`,
    errorMessage: null,
  }).where(and(eq(kpiImports.id, candidate.id), eq(kpiImports.status, "queued"))).returning({ id: kpiImports.id });
  if (result.length !== 1) return null;
  return { ...candidate, status: "profiling" as const, startedAt: now, attemptCount: candidate.attemptCount + 1 };
}

export async function getPreviewPage(importId: string, page: number, pageSize = 100) {
  const db = await getDb();
  if (!db) throw unavailable();
  const safeSize = Math.min(Math.max(pageSize, 1), 200);
  const safePage = Math.max(page, 0);
  const offset = safePage * safeSize;
  const [rows, totalResult] = await Promise.all([
    db.select().from(kpiImportRows).where(eq(kpiImportRows.importId, importId)).orderBy(asc(kpiImportRows.rowNumber)).limit(safeSize).offset(offset),
    db.select({ total: count() }).from(kpiImportRows).where(eq(kpiImportRows.importId, importId)),
  ]);
  return { rows, total: Number(totalResult[0]?.total ?? 0), page: safePage, pageSize: safeSize };
}

export async function getAllImportRows(importId: string) {
  const db = await getDb();
  if (!db) throw unavailable();
  return db.select().from(kpiImportRows).where(eq(kpiImportRows.importId, importId)).orderBy(asc(kpiImportRows.rowNumber));
}

export async function getImportRow(importId: string, rowNumber: number) {
  const db = await getDb();
  if (!db) throw unavailable();
  const rows = await db.select().from(kpiImportRows).where(and(eq(kpiImportRows.importId, importId), eq(kpiImportRows.rowNumber, rowNumber))).limit(1);
  return rows[0] ?? null;
}

export async function updateImportRowReview(input: {
  importId: string;
  rowNumber: number;
  cleanedValues?: JsonObject;
  changes?: unknown[];
  issues?: unknown[];
  excluded?: boolean;
  possibleDuplicate?: boolean;
  isOutlier?: boolean;
  rowSignature?: string;
}) {
  const db = await getDb();
  if (!db) throw unavailable();
  await db.update(kpiImportRows).set({
    cleanedValues: input.cleanedValues,
    changes: input.changes,
    issues: input.issues,
    excluded: input.excluded,
    possibleDuplicate: input.possibleDuplicate,
    isOutlier: input.isOutlier,
    rowSignature: input.rowSignature,
  }).where(and(eq(kpiImportRows.importId, input.importId), eq(kpiImportRows.rowNumber, input.rowNumber)));
}

export async function clearImportAggregates(importId: string) {
  const db = await getDb();
  if (!db) throw unavailable();
  await db.delete(kpiImportAggregates).where(eq(kpiImportAggregates.importId, importId));
}

export async function getImportAggregates(importId: string) {
  const db = await getDb();
  if (!db) throw unavailable();
  return db.select().from(kpiImportAggregates).where(eq(kpiImportAggregates.importId, importId));
}

export async function databaseReady() {
  return Boolean(await getDb());
}
