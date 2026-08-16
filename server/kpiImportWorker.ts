import "dotenv/config";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import type { KpiAnalysis } from "../shared/kpiEngine";
import {
  claimNextQueuedImport,
  filterNovelImportRows,
  getImportAggregates,
  getKpiImport,
  resetKpiImportData,
  updateKpiImport,
  writeImportAggregates,
  writeImportRows,
  type AggregateWrite,
  type ImportRowWrite,
} from "./kpiImportDb";
import { getImportObjectStream } from "./kpiImportStorage";

const BATCH_SIZE = Math.max(100, Math.min(Number(process.env.KPI_IMPORT_BATCH_SIZE || 1000), 5000));
const UNKNOWN = "Unknown";
const REVENUE_TERMS = ["revenue", "sales", "amount", "total", "value", "gmv", "income", "turnover", "net"];
const DATE_TERMS = ["date", "day", "time", "month", "week", "created", "ordered", "purchased", "transaction"];
const CATEGORY_TERMS = ["region", "state", "city", "location", "product", "category", "channel", "customer", "client", "segment", "store", "department", "brand", "type"];

type RawRecord = Record<string, unknown>;
type ColumnKind = "date" | "number" | "category" | "identifier" | "unknown";
type ColumnProfile = { name: string; kind: ColumnKind; confidence: number; datePreference?: "day-first" | "month-first" | "ambiguous" };
type CleaningLog = { key: string; title: string; detail: string; count: number; severity: "success" | "warning" | "info" };
type WorkerStats = { sourceRows: number; usableRows: number; exactDuplicates: number; missingNumeric: number; invalidNumeric: number; dateChanges: number; numericChanges: number; categoryChanges: number; possibleDuplicates: number; outliers: number };

const text = (value: unknown) => value === null || value === undefined ? "" : String(value).trim();
const normalise = (value: unknown) => text(value).replace(/\s+/g, " ").toLowerCase();
const title = (value: string) => value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
const missing = (value: unknown) => ["", "n/a", "na", "null", "none", "-", "undefined"].includes(normalise(value));
const headerScore = (name: string, terms: string[]) => terms.reduce((sum, term) => sum + (normalise(name) === term ? 2 : normalise(name).includes(term) ? 1 : 0), 0);

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw || missing(raw)) return null;
  const negative = /^\(.*\)$/.test(raw) || raw.includes("-");
  const compact = raw.replace(/[()\s$€£¥₦₹-]/g, "");
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  let numberText = compact;
  if (comma !== -1 && dot !== -1) numberText = comma > dot ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  else if (comma !== -1 && dot === -1) numberText = /,\d{1,2}$/.test(compact) ? compact.replace(",", ".") : compact.replace(/,/g, "");
  const parsed = Number(numberText);
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : null;
};

const toIso = (year: number, month: number, day: number) => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day ? candidate.toISOString().slice(0, 10) : null;
};

const parseDate = (value: unknown, preference: "day-first" | "month-first" | "ambiguous" = "ambiguous") => {
  const raw = text(value);
  if (!raw || missing(raw)) return null;
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const first = Number(slash[1]); const second = Number(slash[2]); const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    if (first > 12) return toIso(year, second, first);
    if (second > 12) return toIso(year, first, second);
    return preference === "day-first" ? toIso(year, second, first) : toIso(year, first, second);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
};

const inferProfiles = (headers: string[], samples: RawRecord[]): ColumnProfile[] => headers.map(name => {
  const values = samples.map(row => row[name]).filter(value => !missing(value));
  if (!values.length) return { name, kind: "unknown", confidence: 0 };
  const numericRate = values.filter(value => parseNumber(value) !== null).length / values.length;
  const dateRate = values.filter(value => parseDate(value) !== null).length / values.length;
  const distinctRate = new Set(values.map(text)).size / values.length;
  if (dateRate >= .72 && (headerScore(name, DATE_TERMS) > 0 || numericRate < .98)) return { name, kind: "date", confidence: Math.round(Math.min(99, dateRate * 84 + headerScore(name, DATE_TERMS) * 7)), datePreference: "day-first" };
  if (numericRate >= .72) return { name, kind: "number", confidence: Math.round(Math.min(99, numericRate * 84 + headerScore(name, REVENUE_TERMS) * 5)) };
  if (/\b(id|order|invoice|transaction|reference|sku|code)\b/i.test(name) || (distinctRate > .92 && values.length > 7 && /\d/.test(values.map(text).join("")))) return { name, kind: "identifier", confidence: 82 };
  if (distinctRate <= .9 || headerScore(name, CATEGORY_TERMS) > 0) return { name, kind: "category", confidence: Math.round(Math.min(95, 70 + headerScore(name, CATEGORY_TERMS) * 6)) };
  return { name, kind: "unknown", confidence: 48 };
});

async function* csvRecords(stream: Readable): AsyncGenerator<RawRecord> {
  const parser = stream.pipe(parse({ columns: true, bom: true, relax_column_count: true, skip_empty_lines: true, trim: false }));
  for await (const row of parser) yield row as RawRecord;
}

async function* xlsxRecords(stream: Readable): AsyncGenerator<RawRecord> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream as never, { entries: "emit", sharedStrings: "cache", styles: "ignore", hyperlinks: "ignore", worksheets: "emit" });
  let headers: string[] | null = null;
  for await (const worksheet of reader) {
    for await (const row of worksheet as AsyncIterable<any>) {
      const values = (row.values as unknown[]).slice(1).map(value => value instanceof Date ? value.toISOString().slice(0, 10) : value ?? "");
      if (!headers) { headers = values.map(value => text(value)); continue; }
      const record: RawRecord = {};
      headers.forEach((header, index) => { if (header) record[header] = values[index] ?? ""; });
      if (Object.keys(record).length) yield record;
    }
    return;
  }
}

export async function* streamRecords(fileName: string, stream: Readable): AsyncGenerator<RawRecord> {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv") yield* csvRecords(stream);
  else if (extension === "xlsx") yield* xlsxRecords(stream);
  else throw new Error("Large-file processing supports streaming CSV and XLSX. Convert legacy .xls files to CSV or XLSX before import.");
}

const findMetric = (profiles: ColumnProfile[]) => profiles.filter(profile => profile.kind === "number").sort((a, b) => headerScore(b.name, REVENUE_TERMS) - headerScore(a.name, REVENUE_TERMS))[0];
const findDate = (profiles: ColumnProfile[]) => profiles.find(profile => profile.kind === "date");

function cleanRow(row: RawRecord, profiles: ColumnProfile[], stats: WorkerStats) {
  const rawValues: RawRecord = { ...row };
  const cleanedValues: RawRecord = {};
  const changes: unknown[] = [];
  const issues: unknown[] = [];
  for (const profile of profiles) {
    const raw = row[profile.name];
    if (missing(raw)) {
      cleanedValues[profile.name] = profile.kind === "category" ? UNKNOWN : null;
      if (profile.kind === "number") { stats.missingNumeric++; issues.push({ type: "missing", column: profile.name, message: "Missing numeric value" }); }
      continue;
    }
    if (profile.kind === "number") {
      const parsed = parseNumber(raw);
      if (parsed === null) { cleanedValues[profile.name] = null; stats.invalidNumeric++; issues.push({ type: "invalid-number", column: profile.name, message: "Could not parse numeric value" }); }
      else { cleanedValues[profile.name] = parsed; if (String(parsed) !== text(raw).replace(/,/g, "")) { stats.numericChanges++; changes.push({ column: profile.name, from: raw, to: parsed, reason: "Standardised numeric or currency value" }); } }
      continue;
    }
    if (profile.kind === "date") {
      const parsed = parseDate(raw, profile.datePreference);
      cleanedValues[profile.name] = parsed ?? raw;
      if (parsed && parsed !== raw) { stats.dateChanges++; changes.push({ column: profile.name, from: raw, to: parsed, reason: "Standardised date" }); }
      if (!parsed) issues.push({ type: "ambiguous-date", column: profile.name, message: "Could not standardise date" });
      continue;
    }
    if (profile.kind === "category") {
      const normalized = title(normalise(raw));
      cleanedValues[profile.name] = normalized || UNKNOWN;
      if (normalized !== text(raw)) { stats.categoryChanges++; changes.push({ column: profile.name, from: raw, to: normalized, reason: "Standardised category casing and spacing" }); }
      continue;
    }
    cleanedValues[profile.name] = text(raw);
  }
  return { rawValues, cleanedValues, changes, issues };
}

function aggregateRow(cleaned: RawRecord, profiles: ColumnProfile[], metric: ColumnProfile, date: ColumnProfile, aggregateMap: Map<string, AggregateWrite>) {
  const metricValue = cleaned[metric.name];
  const isoDate = cleaned[date.name];
  if (typeof metricValue !== "number" || typeof isoDate !== "string" || !/^\d{4}-\d{2}/.test(isoDate)) return false;
  const period = isoDate.slice(0, 7);
  const dimensions = profiles.filter(profile => profile.kind === "category" || (profile.kind === "identifier" && /customer|client/i.test(profile.name)));
  const add = (dimension: string, segment: string) => {
    const key = `${metric.name}\u0000${period}\u0000${dimension}\u0000${segment}`;
    const existing = aggregateMap.get(key);
    if (existing) { existing.metricTotal += metricValue; existing.recordCount += 1; }
    else aggregateMap.set(key, { metricColumn: metric.name, period, dimension, segment, metricTotal: metricValue, recordCount: 1 });
  };
  add("__total__", "__all__");
  dimensions.forEach(dimension => add(dimension.name, String(cleaned[dimension.name] ?? UNKNOWN)));
  return true;
}

function analysisFromAggregates(input: { aggregates: Awaited<ReturnType<typeof getImportAggregates>>; profiles: ColumnProfile[]; usableRows: number }): KpiAnalysis {
  const metric = findMetric(input.profiles);
  const date = findDate(input.profiles);
  if (!metric || !date) throw new Error("The imported file does not contain a reliable numeric KPI and date column.");
  const totalRows = input.aggregates.filter(item => item.dimension === "__total__" && item.segment === "__all__" && item.metricColumn === metric.name);
  const periods = Array.from(new Set(totalRows.map(row => row.period))).sort();
  if (periods.length < 2) throw new Error("At least two dated periods are required to explain a KPI change.");
  const previousPeriod = periods.at(-2)!;
  const currentPeriod = periods.at(-1)!;
  const totals = new Map(totalRows.map(row => [row.period, Number(row.metricTotal)]));
  const previousTotal = totals.get(previousPeriod) ?? 0;
  const currentTotal = totals.get(currentPeriod) ?? 0;
  const change = currentTotal - previousTotal;
  const changePercent = previousTotal ? (change / previousTotal) * 100 : 0;
  const byCause = new Map<string, { dimension: string; value: string; periods: Map<string, number> }>();
  input.aggregates.filter(item => item.dimension !== "__total__" && item.metricColumn === metric.name).forEach(item => {
    const key = `${item.dimension}\u0000${item.segment}`;
    const existing = byCause.get(key) ?? { dimension: item.dimension, value: item.segment, periods: new Map<string, number>() };
    existing.periods.set(item.period, Number(item.metricTotal));
    byCause.set(key, existing);
  });
  const causes = Array.from(byCause.values()).map(cause => {
    const impact = (cause.periods.get(currentPeriod) ?? 0) - (cause.periods.get(previousPeriod) ?? 0);
    const contribution = Math.abs(change) ? Math.min(1, Math.abs(impact) / Math.abs(change)) : 0;
    return {
      id: `${cause.dimension}-${cause.value}`,
      dimension: cause.dimension,
      value: cause.value,
      previousValue: cause.periods.get(previousPeriod) ?? 0,
      currentValue: cause.periods.get(currentPeriod) ?? 0,
      impact,
      shareOfChange: contribution,
      confidence: Math.round(Math.min(99, 65 + contribution * 34)),
      counterfactual: currentTotal - impact,
      trend: periods.slice(-8).map(period => ({ period, total: cause.periods.get(period) ?? 0 })),
    };
  }).filter(cause => Math.abs(cause.impact) > 0).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 5);
  const primary = causes[0];
  const confidence = primary?.confidence ?? 50;
  const direction = change < 0 ? "decreased" : "increased";
  const summary = primary
    ? `${metric.name} ${direction} ${Math.abs(changePercent).toFixed(1)}% from ${previousPeriod} to ${currentPeriod}. The largest contributor was ${primary.dimension}: ${primary.value}. We are ${confidence}% confident in this explanation. If it had stayed flat, ${metric.name.toLowerCase()} would have been about ${(primary.counterfactual).toLocaleString(undefined, { maximumFractionDigits: 0 })}.`
    : `${metric.name} ${direction} ${Math.abs(changePercent).toFixed(1)}% from ${previousPeriod} to ${currentPeriod}. No material categorical driver was identified.`;
  return {
    metric: metric.name,
    metricLabel: metric.name,
    currencySymbol: /revenue|sales|amount|value|income|turnover/i.test(metric.name) ? "$" : "",
    dateColumn: date.name,
    previousPeriod,
    currentPeriod,
    previousTotal,
    currentTotal,
    change,
    changePercent,
    excludedMetricRows: 0,
    trend: periods.slice(-8).map(period => ({ period, total: totals.get(period) ?? 0 })),
    causes,
    confidence,
    summary,
    totalRowsUsed: input.usableRows,
  };
}

const logsFromStats = (stats: WorkerStats): CleaningLog[] => [
  { key: "duplicates", title: "Exact duplicates removed", detail: "Duplicate signatures are checked in the backend while streaming.", count: stats.exactDuplicates, severity: stats.exactDuplicates ? "success" : "info" },
  { key: "dates", title: "Dates standardised", detail: "Recognisable dates were converted to ISO format in the worker.", count: stats.dateChanges, severity: "success" },
  { key: "numbers", title: "Numbers and currencies standardised", detail: "Presentation formatting was removed while retaining numeric values.", count: stats.numericChanges, severity: "success" },
  { key: "categories", title: "Category values standardised", detail: "Category casing and spacing were normalised during import.", count: stats.categoryChanges, severity: "success" },
  { key: "invalid", title: "Invalid numeric values flagged", detail: "Invalid numeric values remain visible for review and are excluded from the selected KPI.", count: stats.invalidNumeric, severity: stats.invalidNumeric ? "warning" : "info" },
  { key: "missing", title: "Missing numeric values flagged", detail: "Missing numeric values remain in the preview but do not affect the KPI calculation.", count: stats.missingNumeric, severity: stats.missingNumeric ? "warning" : "info" },
];

export async function processKpiImport(importId: string, options: { claimed?: boolean } = {}) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  if (options.claimed && job.attemptCount > 1) await resetKpiImportData(importId);
  if (!options.claimed) await updateKpiImport(importId, { status: "profiling", startedAt: new Date(), attemptCount: job.attemptCount + 1, errorMessage: null });
  const profileSamples: RawRecord[] = [];
  let headers: string[] = [];
  const firstStream = await getImportObjectStream(job.storageKey);
  for await (const row of streamRecords(job.originalFileName, firstStream)) {
    if (!headers.length) headers = Object.keys(row);
    if (profileSamples.length < 5000) profileSamples.push(row);
    else break;
  }
  if (!headers.length) throw new Error("The uploaded spreadsheet has no header row or data records.");
  const profiles = inferProfiles(headers, profileSamples);
  const metric = findMetric(profiles);
  const date = findDate(profiles);
  if (!metric || !date) throw new Error("We could not identify both a reliable numeric KPI and date column. Add clear date and amount/revenue fields, then retry.");
  await updateKpiImport(importId, { status: "ingesting", columnsJson: profiles, workerCheckpointJson: { phase: "ingesting", batchSize: BATCH_SIZE } });

  const stats: WorkerStats = { sourceRows: 0, usableRows: 0, exactDuplicates: 0, missingNumeric: 0, invalidNumeric: 0, dateChanges: 0, numericChanges: 0, categoryChanges: 0, possibleDuplicates: 0, outliers: 0 };
  let rows: Array<{ payload: ImportRowWrite; cleanedValues: RawRecord }> = [];
  let aggregates = new Map<string, AggregateWrite>();
  const flush = async () => {
    const payloads = rows.map(row => row.payload);
    const novelRows = await filterNovelImportRows(importId, payloads);
    const novelSignatures = new Set(novelRows.map(row => row.rowSignature));
    stats.exactDuplicates += payloads.length - novelRows.length;
    for (const row of rows) {
      if (novelSignatures.has(row.payload.rowSignature) && aggregateRow(row.cleanedValues, profiles, metric, date, aggregates)) stats.usableRows++;
    }
    await writeImportRows(importId, novelRows);
    await writeImportAggregates(importId, Array.from(aggregates.values()));
    await updateKpiImport(importId, { processingCursor: stats.sourceRows, sourceRowCount: stats.sourceRows, usableRowCount: stats.usableRows, previewRowCount: stats.sourceRows, workerCheckpointJson: { phase: "ingesting", processedRows: stats.sourceRows, batchSize: BATCH_SIZE } });
    rows = [];
    aggregates = new Map();
  };

  const source = await getImportObjectStream(job.storageKey);
  for await (const raw of streamRecords(job.originalFileName, source)) {
    stats.sourceRows++;
    const cleaned = cleanRow(raw, profiles, stats);
    const signature = crypto.createHash("sha256").update(JSON.stringify(cleaned.cleanedValues)).digest("hex");
    rows.push({ payload: { rowNumber: stats.sourceRows, ...cleaned, exactDuplicate: false, excluded: false, rowSignature: signature }, cleanedValues: cleaned.cleanedValues });
    if (rows.length >= BATCH_SIZE) await flush();
  }
  await flush();
  await updateKpiImport(importId, { status: "analyzing", workerCheckpointJson: { phase: "analyzing", processedRows: stats.sourceRows } });
  const aggregatesForAnalysis = await getImportAggregates(importId);
  const analysis = analysisFromAggregates({ aggregates: aggregatesForAnalysis, profiles, usableRows: stats.usableRows });
  await updateKpiImport(importId, { status: "complete", sourceRowCount: stats.sourceRows, usableRowCount: stats.usableRows, previewRowCount: stats.sourceRows, columnsJson: profiles, cleaningSummaryJson: logsFromStats(stats), analysisJson: analysis, workerCheckpointJson: { phase: "complete", processedRows: stats.sourceRows }, completedAt: new Date() });
  return analysis;
}

export async function processNextQueuedImport() {
  const job = await claimNextQueuedImport();
  if (!job) return null;
  try { await processKpiImport(job.id, { claimed: true }); return job.id; }
  catch (error) {
    await updateKpiImport(job.id, { status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 4000) : "Unexpected worker failure", completedAt: new Date() });
    throw error;
  }
}

async function runWorker() {
  const interval = Math.max(1000, Number(process.env.KPI_IMPORT_WORKER_POLL_MS || 5000));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await processNextQueuedImport(); }
    catch (error) { console.error("[KPI import worker]", error); }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

if (process.env.KPI_IMPORT_WORKER_MODE === "1") runWorker().catch(error => { console.error(error); process.exit(1); });
