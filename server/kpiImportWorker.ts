import crypto from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import { longReadablePeriod, type KpiAnalysis } from "../shared/kpiEngine";
import {
  claimNextQueuedImport,
  clearImportAggregates,
  filterNovelImportRows,
  getAllImportRows,
  getImportAggregates,
  getImportRow,
  getKpiImport,
  resetKpiImportData,
  updateImportRowReview,
  updateKpiImport,
  writeImportAggregates,
  writeImportRows,
  type AggregateWrite,
  type ImportRowWrite,
} from "./kpiImportDb";
import { getImportObjectStream } from "./kpiImportStorage";

const BATCH_SIZE = Math.max(100, Math.min(Number(process.env.KPI_IMPORT_BATCH_SIZE || 1000), 5000));
const UNKNOWN = "Unknown";
const PROFILE_MIN_VALID_RATE = 0.75;
const MAX_FUZZY_CATEGORY_VALUES = 400;
const REVENUE_TERMS = ["revenue", "sales", "amount", "total", "value", "gmv", "income", "turnover", "net", "purchase", "spend", "price", "cost", "profit"];
const DIRECT_KPI_TERMS = ["revenue", "sales", "amount", "total", "value", "gmv", "income", "turnover", "net", "purchase", "spend", "profit"];
const QUANTITY_TERMS = ["quantity", "qty", "units", "unit count", "items", "volume"];
const UNIT_PRICE_TERMS = ["unit price", "unitprice", "price", "rate"];
const COST_TERMS = ["unit cost", "unitcost", "cost"];
const DISCOUNT_TERMS = ["discount", "rebate", "markdown"];
const TAX_TERMS = ["tax", "vat", "gst", "sales tax"];
const DATE_TERMS = ["date", "day", "time", "month", "week", "created", "ordered", "purchased", "transaction"];
const CATEGORY_TERMS = ["region", "state", "city", "location", "product", "category", "channel", "customer", "client", "company", "employer", "industry", "sector", "country", "nation", "stage", "segment", "store", "department", "brand", "type"];
const IDENTIFIER_PATTERN = /(?:^|[_\s-])(id|order|invoice|transaction|reference|sku|code)(?:$|[_\s-])|(?:invoice|order|transaction|reference|sku|stock|customer)(?:no|number|id|code)?$|(?:id|code|sku|reference)$/i;
const CURRENCY_CODE_PATTERN = /\b(NGN|USD|EUR|GBP|CAD|AUD|ZAR|KES|GHS|AED|INR)\b/gi;

type RawRecord = Record<string, unknown>;
type ColumnKind = "date" | "number" | "category" | "identifier" | "unknown";
type MetricRecipe = {
  kind: "quantity_times_price" | "quantity_times_cost";
  quantityColumn: string;
  unitValueColumn: string;
  discountColumn?: string;
  taxColumn?: string;
};
type ColumnProfile = {
  name: string;
  kind: ColumnKind;
  confidence: number;
  datePreference?: "day-first" | "month-first" | "ambiguous";
  isSelectedMetric?: boolean;
  label?: string;
  selectionReason?: string;
  metricRecipe?: MetricRecipe;
};
type CellChange = { column: string; from: unknown; to: unknown; reason: string };
type DataIssue = { type: "possible-duplicate" | "outlier" | "invalid-number" | "ambiguous-date" | "missing" | "exact-duplicate"; column?: string; message: string };
type WorkerStats = {
  sourceRows: number;
  usableRows: number;
  exactDuplicates: number;
  missingNumeric: number;
  invalidNumeric: number;
  dateChanges: number;
  numericChanges: number;
  categoryChanges: number;
  fuzzyCategoryMerges: number;
  fuzzyCategoryRows: number;
  possibleDuplicates: number;
  outliers: number;
};
type ReviewRow = {
  rowNumber: number;
  rawValues: RawRecord;
  cleanedValues: RawRecord;
  changes: CellChange[];
  issues: DataIssue[];
  excluded: boolean;
  possibleDuplicate: boolean;
  isOutlier: boolean;
  exactDuplicate: boolean;
  rowSignature: string;
};

const text = (value: unknown) => value === null || value === undefined ? "" : String(value).replace(/\u00a0/g, " ").trim();
const normalise = (value: unknown) => text(value).replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const compactCategory = (value: unknown) => normalise(value).replace(/[^a-z0-9]+/g, "");
const title = (value: string) => value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
const missing = (value: unknown) => ["", "n/a", "na", "null", "none", "-", "undefined", "(blank)"].includes(normalise(value));
const headerScore = (name: string, terms: string[]) => terms.reduce((sum, term) => sum + (normalise(name) === term ? 2 : normalise(name).includes(term) ? 1 : 0), 0);
const asRecord = (value: unknown): RawRecord => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const signatureFor = (values: RawRecord) => crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw || missing(raw)) return null;
  const negative = /^\(.*\)$/.test(raw) || /^\s*-/.test(raw);
  const compact = raw
    .replace(CURRENCY_CODE_PATTERN, "")
    .replace(/[()\s$€£¥₦₹-]/g, "");
  if (!compact || /[A-Za-z]/.test(compact)) return null;
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw || missing(raw)) return null;
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (first > 12) return toIso(year, second, first);
    if (second > 12) return toIso(year, first, second);
    if (preference === "day-first") return toIso(year, second, first);
    if (preference === "month-first") return toIso(year, first, second);
    return null;
  }
  const namedDayFirst = raw.match(/^(\d{1,2})\s*[- ]\s*([A-Za-z]{3,9})\s*[-, ]\s*(\d{2,4})$/);
  const namedMonthFirst = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (namedDayFirst || namedMonthFirst) {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
  }
  const looksLikeDate = (/\d{4}/.test(raw) && /[T\s/.-]/.test(raw)) || (/^[A-Za-z]{3,9}\s+\d{1,2}/.test(raw) && /\d{2,4}/.test(raw));
  if (!looksLikeDate) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
};

const inferDatePreference = (values: unknown[]): "day-first" | "month-first" | "ambiguous" => {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  const knownMonths = new Set<string>();
  const dayFirstMonths = new Set<string>();
  const monthFirstMonths = new Set<string>();

  values.forEach(value => {
    const raw = text(value);
    if (!raw) return;
    const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (iso) {
      const parsed = toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      if (parsed) knownMonths.add(parsed.slice(0, 7));
      return;
    }

    const namedDayFirst = raw.match(/^(\d{1,2})\s*[- ]\s*([A-Za-z]{3,9})\s*[-, ]\s*(\d{2,4})/);
    if (namedDayFirst) {
      dayFirstEvidence++;
      const parsed = parseDate(raw);
      if (parsed) knownMonths.add(parsed.slice(0, 7));
      return;
    }
    const namedMonthFirst = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})/);
    if (namedMonthFirst) {
      monthFirstEvidence++;
      const parsed = parseDate(raw);
      if (parsed) knownMonths.add(parsed.slice(0, 7));
      return;
    }

    const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (parts) {
      const first = Number(parts[1]);
      const second = Number(parts[2]);
      let year = Number(parts[3]);
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      if (first > 12 && second <= 12) {
        dayFirstEvidence++;
        const parsed = toIso(year, second, first);
        if (parsed) knownMonths.add(parsed.slice(0, 7));
        return;
      }
      if (second > 12 && first <= 12) {
        monthFirstEvidence++;
        const parsed = toIso(year, first, second);
        if (parsed) knownMonths.add(parsed.slice(0, 7));
        return;
      }
      const dayFirst = toIso(year, second, first);
      const monthFirst = toIso(year, first, second);
      if (dayFirst) dayFirstMonths.add(dayFirst.slice(0, 7));
      if (monthFirst) monthFirstMonths.add(monthFirst.slice(0, 7));
      return;
    }

    // Textual month names are explicit dates but do not reveal whether a
    // separate numeric slash date uses day-first or month-first ordering.
    const parsed = parseDate(raw);
    if (parsed) knownMonths.add(parsed.slice(0, 7));
  });

  if (dayFirstEvidence && !monthFirstEvidence) return "day-first";
  if (monthFirstEvidence && !dayFirstEvidence) return "month-first";

  // With competing textual formats, as with only ambiguous numeric slash
  // values, prefer the interpretation that
  // best fits the observed ISO/textual month range. This keeps a single
  // April–June invoice series from being scattered across March, September,
  // and October merely because dates are <= 12.
  if (dayFirstMonths.size && monthFirstMonths.size) {
    const totalMonths = (candidateMonths: Set<string>) => new Set(Array.from(knownMonths).concat(Array.from(candidateMonths))).size;
    const dayFirstTotal = totalMonths(dayFirstMonths);
    const monthFirstTotal = totalMonths(monthFirstMonths);
    if (dayFirstTotal < monthFirstTotal) return "day-first";
    if (monthFirstTotal < dayFirstTotal) return "month-first";
  }
  return "ambiguous";
};

const inferBaseProfiles = (headers: string[], samples: RawRecord[]): ColumnProfile[] => headers.map(name => {
  const values = samples.map(row => row[name]).filter(value => !missing(value));
  if (!values.length) return { name, kind: "unknown", confidence: 0 };
  const preference = inferDatePreference(values);
  const numericRate = values.filter(value => parseNumber(value) !== null).length / values.length;
  const dateRate = values.filter(value => parseDate(value, preference) !== null).length / values.length;
  const distinctRate = new Set(values.map(text)).size / values.length;
  const dateHint = headerScore(name, DATE_TERMS);
  const numericHint = headerScore(name, REVENUE_TERMS);
  const explicitIdentifier = IDENTIFIER_PATTERN.test(name);
  if (!explicitIdentifier && dateRate >= PROFILE_MIN_VALID_RATE && (dateHint > 0 || numericRate < 0.98)) return { name, kind: "date", confidence: Math.round(Math.min(99, dateRate * 88 + dateHint * 5)), datePreference: preference };
  const quantityHint = headerScore(name, QUANTITY_TERMS);
  if (explicitIdentifier || (distinctRate > 0.92 && values.length > 7 && /\d/.test(values.map(text).join("")) && numericHint === 0 && quantityHint === 0)) return { name, kind: "identifier", confidence: 82 };
  const categoryHint = headerScore(name, CATEGORY_TERMS);
  if (categoryHint > 0 && numericHint === 0) return { name, kind: "category", confidence: Math.round(Math.min(95, 70 + categoryHint * 6)) };
  if (numericRate >= PROFILE_MIN_VALID_RATE) return { name, kind: "number", confidence: Math.round(Math.min(99, numericRate * 88 + numericHint * 5)) };
  if (distinctRate <= 0.96 || categoryHint > 0) return { name, kind: "category", confidence: Math.round(Math.min(95, 70 + categoryHint * 6)) };
  return { name, kind: "unknown", confidence: 48 };
});

const headerMatches = (name: string, terms: string[]) => terms.some(term => normalise(name) === term || normalise(name).includes(term));

const selectMetricProfile = (profiles: ColumnProfile[]): ColumnProfile | null => {
  const numeric = profiles.filter(profile => profile.kind === "number");
  const direct = numeric.filter(profile => headerMatches(profile.name, DIRECT_KPI_TERMS)).sort((left, right) => headerScore(right.name, DIRECT_KPI_TERMS) - headerScore(left.name, DIRECT_KPI_TERMS) || right.confidence - left.confidence)[0];
  if (direct) return { ...direct, isSelectedMetric: true, label: direct.name, selectionReason: `Selected the labelled monetary column “${direct.name}”.` };
  const quantity = numeric.filter(profile => headerMatches(profile.name, QUANTITY_TERMS)).sort((left, right) => headerScore(right.name, QUANTITY_TERMS) - headerScore(left.name, QUANTITY_TERMS))[0];
  const unitPrice = numeric.filter(profile => headerMatches(profile.name, UNIT_PRICE_TERMS)).sort((left, right) => headerScore(right.name, UNIT_PRICE_TERMS) - headerScore(left.name, UNIT_PRICE_TERMS))[0];
  const unitCost = numeric.filter(profile => headerMatches(profile.name, COST_TERMS)).sort((left, right) => headerScore(right.name, COST_TERMS) - headerScore(left.name, COST_TERMS))[0];
  if (quantity && (unitPrice || unitCost)) {
    const unitValue = unitPrice ?? unitCost!;
    const discount = numeric.find(profile => headerMatches(profile.name, DISCOUNT_TERMS));
    const tax = numeric.find(profile => headerMatches(profile.name, TAX_TERMS));
    const recipe: MetricRecipe = { kind: unitPrice ? "quantity_times_price" : "quantity_times_cost", quantityColumn: quantity.name, unitValueColumn: unitValue.name, ...(discount ? { discountColumn: discount.name } : {}), ...(tax ? { taxColumn: tax.name } : {}) };
    const adjustments = [discount && `less ${discount.name}`, tax && `plus ${tax.name}`].filter(Boolean).join("; ");
    return { name: "__derived_amount__", kind: "number", confidence: Math.min(quantity.confidence, unitValue.confidence), isSelectedMetric: true, label: "Derived Amount", selectionReason: `Calculated as ${quantity.name} × ${unitValue.name}${adjustments ? `; ${adjustments}` : ""}.`, metricRecipe: recipe };
  }
  const fallback = numeric.filter(profile => !headerMatches(profile.name, QUANTITY_TERMS) && !headerMatches(profile.name, DISCOUNT_TERMS) && !headerMatches(profile.name, TAX_TERMS)).sort((left, right) => headerScore(right.name, REVENUE_TERMS) - headerScore(left.name, REVENUE_TERMS) || right.confidence - left.confidence || left.name.localeCompare(right.name))[0];
  return fallback ? { ...fallback, isSelectedMetric: true, label: fallback.name, selectionReason: `No labelled monetary total or complete quantity-price pair was found; selected the highest-confidence usable numeric column “${fallback.name}”.` } : null;
};

const inferProfiles = (headers: string[], samples: RawRecord[]): ColumnProfile[] => {
  const profiles = inferBaseProfiles(headers, samples);
  const selectedMetric = selectMetricProfile(profiles);
  if (!selectedMetric) return profiles;
  return [...profiles.map(profile => profile.name === selectedMetric.name ? selectedMetric : profile), ...(selectedMetric.metricRecipe ? [selectedMetric] : [])];
};

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
  else throw new Error("KPI Detective supports streaming CSV and XLSX. Convert legacy .xls files before import.");
}

const findMetric = (profiles: ColumnProfile[]) => profiles.find(profile => profile.isSelectedMetric && profile.kind === "number") ?? profiles.filter(profile => profile.kind === "number").sort((a, b) => headerScore(b.name, REVENUE_TERMS) - headerScore(a.name, REVENUE_TERMS) || b.confidence - a.confidence)[0];
const findDate = (profiles: ColumnProfile[]) => profiles.filter(profile => profile.kind === "date").sort((a, b) => headerScore(b.name, DATE_TERMS) - headerScore(a.name, DATE_TERMS) || b.confidence - a.confidence)[0];
const profilingDetail = (profiles: ColumnProfile[]) => profiles.map(profile => {
  const selected = profile.isSelectedMetric ? "; selected KPI" : "";
  const preference = profile.kind === "date" && profile.datePreference ? `; ${profile.datePreference}` : "";
  const displayName = profile.label && profile.label !== profile.name ? `${profile.label} (${profile.name})` : profile.name;
  return `${displayName}: ${profile.kind} (${profile.confidence}%${selected}${preference})`;
}).join(" · ");
const profilingFailureMessage = (profiles: ColumnProfile[]) => `We could not identify both a reliable date column and numeric KPI. Profiled columns: ${profilingDetail(profiles)}.`;
const normaliseCategory = (value: unknown) => (value === null || value === undefined ? "" : String(value)).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || UNKNOWN;

function cleanRow(row: RawRecord, profiles: ColumnProfile[], stats: WorkerStats) {
  const rawValues: RawRecord = { ...row };
  const cleanedValues: RawRecord = {};
  const changes: CellChange[] = [];
  const issues: DataIssue[] = [];
  for (const profile of profiles) {
    if (profile.metricRecipe) {
      const recipe = profile.metricRecipe;
      const quantity = parseNumber(row[recipe.quantityColumn]);
      const unitValue = parseNumber(row[recipe.unitValueColumn]);
      if (quantity === null || unitValue === null) {
        cleanedValues[profile.name] = null;
        stats.missingNumeric++;
        issues.push({ type: "missing", column: profile.name, message: `Could not derive ${profile.label ?? profile.name} because ${quantity === null ? recipe.quantityColumn : recipe.unitValueColumn} is missing or invalid.` });
      } else {
        const adjustment = (column: string | undefined, direction: 1 | -1) => {
          if (!column) return 0;
          const parsed = parseNumber(row[column]);
          if (parsed === null) return 0;
          const header = normalise(column);
          const percentageLabel = /percent|percentage|pct|%|rate|\bvat\b|\bgst\b/.test(header);
          const amount = percentageLabel ? quantity * unitValue * (parsed / 100) : parsed;
          return direction * amount;
        };
        const derived = quantity * unitValue + adjustment(recipe.discountColumn, -1) + adjustment(recipe.taxColumn, 1);
        cleanedValues[profile.name] = derived;
        changes.push({ column: profile.name, from: null, to: derived, reason: recipe.kind === "quantity_times_price" ? `Derived amount from ${recipe.quantityColumn} × ${recipe.unitValueColumn}` : `Derived amount from ${recipe.quantityColumn} × ${recipe.unitValueColumn}` });
      }
      continue;
    }
    const raw = row[profile.name];
    if (missing(raw)) {
      cleanedValues[profile.name] = profile.kind === "category" ? UNKNOWN : null;
      if (profile.kind === "number") { stats.missingNumeric++; issues.push({ type: "missing", column: profile.name, message: "Missing numeric value" }); }
      continue;
    }
    if (profile.kind === "number") {
      const parsed = parseNumber(raw);
      if (parsed === null) { cleanedValues[profile.name] = null; stats.invalidNumeric++; issues.push({ type: "invalid-number", column: profile.name, message: "Could not parse numeric or currency value" }); }
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
      const normalized = normaliseCategory(raw);
      cleanedValues[profile.name] = normalized;
      const rawCategory = raw === null || raw === undefined ? "" : String(raw).replace(/\u00a0/g, " ");
      if (normalized !== rawCategory) { stats.categoryChanges++; changes.push({ column: profile.name, from: raw, to: normalized, reason: "Standardised category whitespace" }); }
      continue;
    }
    cleanedValues[profile.name] = text(raw);
  }
  return { rawValues, cleanedValues, changes, issues };
}

function eligibleForAnalysis(cleaned: RawRecord, metric: ColumnProfile, date: ColumnProfile) {
  return typeof cleaned[metric.name] === "number" && typeof cleaned[date.name] === "string" && /^\d{4}-\d{2}/.test(String(cleaned[date.name]));
}

function aggregateRow(cleaned: RawRecord, profiles: ColumnProfile[], metric: ColumnProfile, date: ColumnProfile, aggregateMap: Map<string, AggregateWrite>) {
  const metricValue = cleaned[metric.name];
  const isoDate = cleaned[date.name];
  if (!eligibleForAnalysis(cleaned, metric, date) || typeof metricValue !== "number" || typeof isoDate !== "string") return false;
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

type AnalysisAggregate = {
  metricColumn: string;
  period: string;
  dimension: string;
  segment: string;
  metricTotal: number | string;
  recordCount: number | bigint;
};

function analysisFromAggregates(input: { aggregates: AnalysisAggregate[]; profiles: ColumnProfile[]; usableRows: number }): KpiAnalysis {
  const metric = findMetric(input.profiles);
  const date = findDate(input.profiles);
  if (!metric || !date) throw new Error("We could not identify both a reliable date column and numeric KPI. Ensure at least 75% of non-empty values in each field are valid dates or amounts.");
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
    ? `${metric.name} ${direction} ${Math.abs(changePercent).toFixed(1)}% from ${longReadablePeriod(previousPeriod)} to ${longReadablePeriod(currentPeriod)}. The largest contributor was ${primary.dimension}: ${primary.value}. We are ${confidence}% confident in this explanation. If it had stayed flat, ${metric.name.toLowerCase()} would have been about ${(primary.counterfactual).toLocaleString(undefined, { maximumFractionDigits: 0 })}.`
    : `${metric.name} ${direction} ${Math.abs(changePercent).toFixed(1)}% from ${longReadablePeriod(previousPeriod)} to ${longReadablePeriod(currentPeriod)}. No material categorical driver was identified.`;
  return { metric: metric.name, metricLabel: metric.label ?? metric.name, currencySymbol: /revenue|sales|amount|value|income|turnover|purchase|spend|price|cost|profit/i.test(metric.name) || Boolean(metric.metricRecipe) ? "$" : "", dateColumn: date.name, previousPeriod, currentPeriod, previousTotal, currentTotal, change, changePercent, excludedMetricRows: 0, trend: periods.slice(-8).map(period => ({ period, total: totals.get(period) ?? 0 })), causes, confidence, summary, totalRowsUsed: input.usableRows };
}

function fullCauseImpact(aggregates: AnalysisAggregate[], metricColumn: string, dimension: string, value: string, previousPeriod: string, currentPeriod: string) {
  let previous = 0;
  let current = 0;
  aggregates.forEach(item => {
    if (item.metricColumn !== metricColumn || item.dimension !== dimension || item.segment !== value) return;
    if (item.period === previousPeriod) previous += Number(item.metricTotal);
    if (item.period === currentPeriod) current += Number(item.metricTotal);
  });
  return current - previous;
}

const logsFromStats = (stats: WorkerStats, metric?: ColumnProfile) => [
  ...(metric ? [{ key: "metric", title: "KPI selected", detail: metric.selectionReason ?? `Selected ${metric.label ?? metric.name} as the KPI.`, count: 1, severity: "success" as const }] : []),
  { key: "duplicates", title: "Exact duplicates excluded", detail: "Exact cleaned-row duplicates are retained for review but excluded from the default calculation.", count: stats.exactDuplicates, severity: stats.exactDuplicates ? "success" : "info" },
  { key: "possible", title: "Possible duplicates flagged", detail: "Rows sharing a company or customer, date, and KPI value are kept for your decision.", count: stats.possibleDuplicates, severity: stats.possibleDuplicates ? "warning" : "info" },
  { key: "fuzzy", title: "High-confidence category alias groups", detail: `${stats.fuzzyCategoryRows.toLocaleString()} individual category cells were reconciled across ${stats.fuzzyCategoryMerges.toLocaleString()} distinct alias group${stats.fuzzyCategoryMerges === 1 ? "" : "s"}.`, count: stats.fuzzyCategoryMerges, severity: stats.fuzzyCategoryMerges ? "success" : "info" },
  { key: "outliers", title: "Outliers flagged for review", detail: "IQR-based outlier flags never remove values automatically.", count: stats.outliers, severity: stats.outliers ? "warning" : "info" },
  { key: "dates", title: "Dates standardised", detail: "Recognisable mixed date formats were converted to ISO format.", count: stats.dateChanges, severity: "success" },
  { key: "numbers", title: "Numbers and currencies standardised", detail: "Currency symbols and supported currency codes were removed while retaining numeric values.", count: stats.numericChanges, severity: "success" },
  { key: "categories", title: "Category whitespace standardised", detail: "Count of individual category cells changed only to trim or collapse whitespace. Alias reconciliation is reported separately above.", count: stats.categoryChanges, severity: "success" },
  { key: "invalid", title: "Invalid numeric values flagged", detail: "Invalid numeric values remain visible but do not affect the selected KPI.", count: stats.invalidNumeric, severity: stats.invalidNumeric ? "warning" : "info" },
  { key: "missing", title: "Missing numeric values flagged", detail: "Missing numeric values remain visible but do not affect the selected KPI.", count: stats.missingNumeric, severity: stats.missingNumeric ? "warning" : "info" },
];

const levenshtein = (first: string, second: string) => {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let i = 1; i <= first.length; i++) {
    const current = [i];
    for (let j = 1; j <= second.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (first[i - 1] === second[j - 1] ? 0 : 1));
    for (let j = 0; j < previous.length; j++) previous[j] = current[j];
  }
  return previous[second.length];
};

const similarity = (first: string, second: string) => {
  const length = Math.max(first.length, second.length);
  return length ? 1 - levenshtein(first, second) / length : 1;
};

const knownCategoryAlias = (value: string, column: string) => {
  const compact = compactCategory(value);
  const columnName = normalise(column);
  if (/(region|state|city|location|area)/.test(columnName)) {
    if (["ny", "nyc", "newyork"].includes(compact)) return "New York";
    if (["la", "losangeles"].includes(compact)) return "Los Angeles";
    if (["uk", "unitedkingdom", "greatbritain"].includes(compact)) return "United Kingdom";
    if (["eastcoast", "ecoast"].includes(compact)) return "East Coast";
    if (["westcoast", "wcoast"].includes(compact)) return "West Coast";
  }
  if (/(country|nation|market)/.test(columnName) && compact === "unitedstates") return "United States";
  if (/(industry|sector)/.test(columnName) && ["crypto", "cryptocurrency"].includes(compact)) return "Crypto";
  if (/(channel|source|platform|medium)/.test(columnName)) {
    if (["online", "web", "website", "webstore", "ecommerce", "ecommercewebsite"].includes(compact)) return "Online";
    if (["instore", "retailstore", "physicalstore", "store"].includes(compact)) return "In Store";
  }
  return null;
};

const appendIssue = (row: ReviewRow, issue: DataIssue) => {
  if (!row.issues.some(existing => existing.type === issue.type && existing.column === issue.column && existing.message === issue.message)) row.issues.push(issue);
};

const payloadFor = (row: ReviewRow): ImportRowWrite => ({
  rowNumber: row.rowNumber,
  rawValues: row.rawValues,
  cleanedValues: row.cleanedValues,
  changes: row.changes,
  issues: row.issues,
  excluded: row.excluded,
  possibleDuplicate: row.possibleDuplicate,
  isOutlier: row.isOutlier,
  exactDuplicate: row.exactDuplicate,
  rowSignature: row.rowSignature,
});

const toReviewRows = (rows: Awaited<ReturnType<typeof getAllImportRows>>): ReviewRow[] => rows.map(row => ({
  rowNumber: row.rowNumber,
  rawValues: asRecord(row.rawValues),
  cleanedValues: asRecord(row.cleanedValues),
  changes: asArray<CellChange>(row.changes),
  issues: asArray<DataIssue>(row.issues),
  excluded: row.excluded,
  possibleDuplicate: row.possibleDuplicate,
  isOutlier: row.isOutlier,
  exactDuplicate: row.exactDuplicate,
  rowSignature: row.rowSignature,
}));

async function persistReviewRows(importId: string, rows: ReviewRow[]) {
  for (let index = 0; index < rows.length; index += BATCH_SIZE) await writeImportRows(importId, rows.slice(index, index + BATCH_SIZE).map(payloadFor));
}

function applyFuzzyCategoryReview(rows: ReviewRow[], profiles: ColumnProfile[], stats: WorkerStats) {
  const changedRows = new Set<number>();
  const aliasGroups = new Set<string>();
  const categoryProfiles = profiles.filter(profile => profile.kind === "category");
  for (const profile of categoryProfiles) {
    const frequency = new Map<string, number>();
    rows.filter(row => !row.excluded).forEach(row => {
      const value = String(row.cleanedValues[profile.name] ?? UNKNOWN);
      if (value !== UNKNOWN) frequency.set(value, (frequency.get(value) ?? 0) + 1);
    });
    const values = Array.from(frequency.keys());
    // Fuzzy reconciliation is for human-managed dimensions such as region/channel.
    // Skip very high-cardinality fields rather than risk slow or over-broad matching.
    if (values.length > MAX_FUZZY_CATEGORY_VALUES) continue;
    const replacementByValue = new Map<string, string>();
    values.sort((left, right) => (frequency.get(left) ?? 0) - (frequency.get(right) ?? 0) || left.localeCompare(right)).forEach(value => {
      const alias = knownCategoryAlias(value, profile.name);
      const candidates = values.filter(candidate => candidate !== value && candidate.length >= 4 && value.length >= 4 && (frequency.get(candidate) ?? 0) >= (frequency.get(value) ?? 0));
      const fuzzy = candidates.map(candidate => ({ candidate, score: similarity(compactCategory(value), compactCategory(candidate)) })).sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))[0];
      const replacement = alias ?? (fuzzy && fuzzy.score >= 0.93 ? fuzzy.candidate : null);
      if (replacement && replacement !== value) replacementByValue.set(value, replacement);
    });
    rows.forEach(row => {
      const current = String(row.cleanedValues[profile.name] ?? UNKNOWN);
      const replacement = replacementByValue.get(current);
      if (!replacement) return;
      row.cleanedValues[profile.name] = replacement;
      row.rowSignature = signatureFor(row.cleanedValues);
      row.changes.push({ column: profile.name, from: current, to: replacement, reason: "Merged a high-confidence near-duplicate category" });
      stats.fuzzyCategoryRows++;
      aliasGroups.add(`${profile.name}\u0000${replacement}`);
      changedRows.add(row.rowNumber);
    });
  }
  stats.fuzzyCategoryMerges = aliasGroups.size;
  return changedRows;
}

function applyPossibleDuplicateReview(rows: ReviewRow[], profiles: ColumnProfile[], stats: WorkerStats) {
  const changedRows = new Set<number>();
  const date = findDate(profiles);
  const metric = findMetric(profiles);
  const customer = profiles.find(profile => (profile.kind === "category" || profile.kind === "identifier") && /company|customer|client|employer|organisation|organization/i.test(profile.name));
  if (!date || !metric || !customer) return changedRows;
  const firstByKey = new Map<string, ReviewRow>();
  const entityLabel = normalise(customer.name);
  rows.filter(row => !row.excluded).forEach(row => {
    const dateValue = row.cleanedValues[date.name];
    const metricValue = row.cleanedValues[metric.name];
    const customerValue = row.cleanedValues[customer.name];
    if (typeof dateValue !== "string" || typeof metricValue !== "number" || typeof customerValue !== "string") return;
    const key = `${normalise(customerValue)}\u0000${dateValue}\u0000${metricValue}`;
    const first = firstByKey.get(key);
    if (!first) { firstByKey.set(key, row); return; }
    row.possibleDuplicate = true;
    first.possibleDuplicate = true;
    changedRows.add(row.rowNumber);
    changedRows.add(first.rowNumber);
    appendIssue(row, { type: "possible-duplicate", message: `Shares ${entityLabel}, date, and KPI value with row ${first.rowNumber}; kept for your review.` });
    appendIssue(first, { type: "possible-duplicate", message: `Shares ${entityLabel}, date, and KPI value with row ${row.rowNumber}; kept for your review.` });
  });
  stats.possibleDuplicates = rows.filter(row => row.possibleDuplicate).length;
  return changedRows;
}

function applyOutlierReview(rows: ReviewRow[], profiles: ColumnProfile[], stats: WorkerStats) {
  const changedRows = new Set<number>();
  profiles.filter(profile => profile.kind === "number").forEach(profile => {
    const values = rows.filter(row => !row.excluded).map(row => row.cleanedValues[profile.name]).filter((value): value is number => typeof value === "number").sort((left, right) => left - right);
    if (values.length < 5) return;
    const quantile = (fraction: number) => {
      const position = (values.length - 1) * fraction;
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      return values[lower] + (values[upper] - values[lower]) * (position - lower);
    };
    const q1 = quantile(0.25);
    const q3 = quantile(0.75);
    const iqr = q3 - q1;
    if (iqr <= 0) return;
    const lower = q1 - iqr * 1.5;
    const upper = q3 + iqr * 1.5;
    rows.filter(row => !row.excluded).forEach(row => {
      const value = row.cleanedValues[profile.name];
      if (typeof value !== "number" || (value >= lower && value <= upper)) return;
      row.isOutlier = true;
      changedRows.add(row.rowNumber);
      appendIssue(row, { type: "outlier", column: profile.name, message: `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} is outside the IQR review range (${lower.toLocaleString(undefined, { maximumFractionDigits: 2 })} to ${upper.toLocaleString(undefined, { maximumFractionDigits: 2 })}).` });
    });
  });
  stats.outliers = rows.filter(row => row.isOutlier).length;
  return changedRows;
}

async function writeAggregateMap(importId: string, aggregateMap: Map<string, AggregateWrite>) {
  const aggregates = Array.from(aggregateMap.values());
  for (let index = 0; index < aggregates.length; index += BATCH_SIZE) await writeImportAggregates(importId, aggregates.slice(index, index + BATCH_SIZE));
}

async function recalculateFromStoredRows(importId: string, profiles: ColumnProfile[]) {
  const rows = toReviewRows(await getAllImportRows(importId));
  const metric = findMetric(profiles);
  const date = findDate(profiles);
  if (!metric || !date) throw new Error("The import no longer has a reliable numeric KPI and date column.");
  const buildAggregateMap = (includeOutliers: boolean) => {
    const aggregateMap = new Map<string, AggregateWrite>();
    let usableRows = 0;
    rows.filter(row => !row.excluded && (includeOutliers || !row.isOutlier)).forEach(row => {
      if (aggregateRow(row.cleanedValues, profiles, metric, date, aggregateMap)) usableRows++;
    });
    return { aggregateMap, usableRows };
  };
  const baseline = buildAggregateMap(true);
  await clearImportAggregates(importId);
  await writeAggregateMap(importId, baseline.aggregateMap);
  const stats: WorkerStats = {
    sourceRows: rows.length,
    usableRows: baseline.usableRows,
    exactDuplicates: rows.filter(row => row.exactDuplicate).length,
    missingNumeric: rows.flatMap(row => row.issues).filter(issue => issue.type === "missing").length,
    invalidNumeric: rows.flatMap(row => row.issues).filter(issue => issue.type === "invalid-number").length,
    dateChanges: rows.flatMap(row => row.changes).filter(change => change.reason === "Standardised date").length,
    numericChanges: rows.flatMap(row => row.changes).filter(change => change.reason === "Standardised numeric or currency value").length,
    categoryChanges: rows.flatMap(row => row.changes).filter(change => change.reason === "Standardised category whitespace").length,
    fuzzyCategoryMerges: new Set(rows.flatMap(row => row.changes).filter(change => change.reason === "Merged a high-confidence near-duplicate category").map(change => `${change.column}\u0000${String(change.to)}`)).size,
    fuzzyCategoryRows: rows.flatMap(row => row.changes).filter(change => change.reason === "Merged a high-confidence near-duplicate category").length,
    possibleDuplicates: rows.filter(row => row.possibleDuplicate).length,
    outliers: rows.filter(row => row.isOutlier).length,
  };
  const baselineAnalysis = analysisFromAggregates({ aggregates: Array.from(baseline.aggregateMap.values()), profiles, usableRows: baseline.usableRows });
  const flaggedOutliers = rows.filter(row => !row.excluded && row.isOutlier);
  let analysis = baselineAnalysis;
  if (flaggedOutliers.length) {
    try {
      const withoutOutliers = buildAggregateMap(false);
      const outlierExcludedAnalysis = analysisFromAggregates({ aggregates: Array.from(withoutOutliers.aggregateMap.values()), profiles, usableRows: withoutOutliers.usableRows });
      const baselinePrimary = baselineAnalysis.causes[0] ?? null;
      const outlierExcludedPrimary = outlierExcludedAnalysis.causes[0] ?? null;
      const baselinePrimaryWithoutOutliers = baselinePrimary ? fullCauseImpact(Array.from(withoutOutliers.aggregateMap.values()), metric.name, baselinePrimary.dimension, baselinePrimary.value, baselineAnalysis.previousPeriod, baselineAnalysis.currentPeriod) : 0;
      const outlierImpactOnBaselinePrimary = baselinePrimary ? baselinePrimary.impact - baselinePrimaryWithoutOutliers : 0;
      const explanationChanged = Boolean(baselinePrimary && (!outlierExcludedPrimary || baselinePrimary.dimension !== outlierExcludedPrimary.dimension || baselinePrimary.value !== outlierExcludedPrimary.value || Math.abs(outlierImpactOnBaselinePrimary) >= Math.max(1, Math.abs(baselinePrimary.impact) * 0.5)));
      const outlierSensitivity = {
        outlierRows: flaggedOutliers.length,
        baselinePrimary: baselinePrimary ? { dimension: baselinePrimary.dimension, value: baselinePrimary.value, impact: baselinePrimary.impact } : null,
        outlierExcludedPrimary: outlierExcludedPrimary ? { dimension: outlierExcludedPrimary.dimension, value: outlierExcludedPrimary.value, impact: outlierExcludedPrimary.impact } : null,
        baselinePrimaryImpactWithoutOutliers: baselinePrimaryWithoutOutliers,
        outlierImpactOnBaselinePrimary,
        explanationChanged,
      };
      if (explanationChanged && baselinePrimary && outlierExcludedPrimary) {
        const confidence = Math.min(baselineAnalysis.confidence, outlierExcludedAnalysis.confidence, 65);
        analysis = {
          ...baselineAnalysis,
          causes: outlierExcludedAnalysis.causes,
          confidence,
          outlierSensitivity,
          summary: `${baselineAnalysis.metric} ${baselineAnalysis.change < 0 ? "decreased" : "increased"} ${Math.abs(baselineAnalysis.changePercent).toFixed(1)}% from ${longReadablePeriod(baselineAnalysis.previousPeriod)} to ${longReadablePeriod(baselineAnalysis.currentPeriod)} when all transactions are included. However, ${flaggedOutliers.length} IQR-flagged transaction${flaggedOutliers.length === 1 ? "" : "s"} materially change the driver ranking. ${baselinePrimary.dimension}: ${baselinePrimary.value} has an all-transaction impact of ${baselinePrimary.impact.toLocaleString(undefined, { maximumFractionDigits: 0 })}, but ${baselinePrimaryWithoutOutliers.toLocaleString(undefined, { maximumFractionDigits: 0 })} without flagged transactions. The driver view therefore uses the outlier-excluded sensitivity result, led by ${outlierExcludedPrimary.dimension}: ${outlierExcludedPrimary.value}.`,
        };
      } else analysis = { ...baselineAnalysis, outlierSensitivity };
    } catch {
      // Preserve the baseline if removing outliers leaves too little period coverage for a valid comparison.
    }
  }
  await updateKpiImport(importId, { status: "complete", sourceRowCount: rows.length, usableRowCount: baseline.usableRows, previewRowCount: rows.length, columnsJson: profiles, cleaningSummaryJson: logsFromStats(stats, metric), analysisJson: analysis, workerCheckpointJson: { phase: "complete", processedRows: rows.length, recalculated: true }, completedAt: new Date() });
  return analysis;
}

export async function processKpiImport(importId: string, options: { claimed?: boolean; maxSourceRows?: number } = {}) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  if (options.claimed && job.attemptCount > 1) await resetKpiImportData(importId);
  if (!options.claimed) await updateKpiImport(importId, { status: "profiling", startedAt: new Date(), attemptCount: job.attemptCount + 1, errorMessage: null });
  const profileSamples: RawRecord[] = [];
  let headers: string[] = [];
  let profiledRows = 0;
  const firstStream = await getImportObjectStream(job.storageKey);
  for await (const row of streamRecords(job.originalFileName, firstStream)) {
    profiledRows++;
    if (options.maxSourceRows && profiledRows > options.maxSourceRows) throw new Error(`File exceeds the ${options.maxSourceRows.toLocaleString()}-row limit for this no-worker version. Please upload a smaller file.`);
    if (!headers.length) headers = Object.keys(row);
    if (profileSamples.length < 5000) profileSamples.push(row);
  }
  if (!headers.length) throw new Error("The uploaded spreadsheet has no header row or data records.");
  const profiles = inferProfiles(headers, profileSamples);
  const metric = findMetric(profiles);
  const date = findDate(profiles);
  if (!metric || !date) {
    const detail = profilingFailureMessage(profiles);
    await updateKpiImport(importId, {
      status: "failed",
      columnsJson: profiles,
      cleaningSummaryJson: [{ key: "profiling", title: "Column profiling could not select an analysis pair", detail, count: profiles.length, severity: "warning" }],
      workerCheckpointJson: { phase: "profiling-failed", profiledRows, headers },
      errorMessage: detail,
      completedAt: new Date(),
    });
    throw new Error(detail);
  }
  await updateKpiImport(importId, { status: "ingesting", columnsJson: profiles, workerCheckpointJson: { phase: "ingesting", batchSize: BATCH_SIZE } });
  const stats: WorkerStats = { sourceRows: 0, usableRows: 0, exactDuplicates: 0, missingNumeric: 0, invalidNumeric: 0, dateChanges: 0, numericChanges: 0, categoryChanges: 0, fuzzyCategoryMerges: 0, fuzzyCategoryRows: 0, possibleDuplicates: 0, outliers: 0 };
  let rows: ReviewRow[] = [];
  const flush = async () => {
    const payloads = rows.map(payloadFor);
    const novelRows = await filterNovelImportRows(importId, payloads);
    const novelRowNumbers = new Set(novelRows.map(row => row.rowNumber));
    stats.exactDuplicates += payloads.length - novelRows.length;
    rows.forEach(row => {
      if (!novelRowNumbers.has(row.rowNumber)) {
        row.excluded = true;
        row.exactDuplicate = true;
        appendIssue(row, { type: "exact-duplicate", message: "Exact cleaned-row duplicate retained for review and excluded from the default calculation." });
      } else if (eligibleForAnalysis(row.cleanedValues, metric, date)) stats.usableRows++;
    });
    await writeImportRows(importId, rows.map(payloadFor));
    await updateKpiImport(importId, { processingCursor: stats.sourceRows, sourceRowCount: stats.sourceRows, usableRowCount: stats.usableRows, previewRowCount: stats.sourceRows, workerCheckpointJson: { phase: "ingesting", processedRows: stats.sourceRows, batchSize: BATCH_SIZE } });
    rows = [];
  };
  const source = await getImportObjectStream(job.storageKey);
  for await (const raw of streamRecords(job.originalFileName, source)) {
    stats.sourceRows++;
    const cleaned = cleanRow(raw, profiles, stats);
    rows.push({ rowNumber: stats.sourceRows, ...cleaned, excluded: false, possibleDuplicate: false, isOutlier: false, exactDuplicate: false, rowSignature: signatureFor(cleaned.cleanedValues) });
    if (rows.length >= BATCH_SIZE) await flush();
  }
  if (rows.length) await flush();
  await updateKpiImport(importId, { status: "analyzing", workerCheckpointJson: { phase: "analyzing", processedRows: stats.sourceRows } });
  const reviewRows = toReviewRows(await getAllImportRows(importId));
  const fuzzyChanges = applyFuzzyCategoryReview(reviewRows, profiles, stats);
  const duplicateChanges = applyPossibleDuplicateReview(reviewRows, profiles, stats);
  const outlierChanges = applyOutlierReview(reviewRows, profiles, stats);
  const changedRows = new Set(Array.from(fuzzyChanges).concat(Array.from(duplicateChanges), Array.from(outlierChanges)));
  await persistReviewRows(importId, reviewRows.filter(row => changedRows.has(row.rowNumber)));
  return recalculateFromStoredRows(importId, profiles);
}

export async function applyImportReviewAction(input: { importId: string; rowNumber: number; action: "undoChange" | "setExcluded" | "keepPossibleDuplicate" | "editValue"; column?: string; value?: string | null; excluded?: boolean }) {
  const job = await getKpiImport(input.importId);
  if (!job) throw new Error("Import job was not found.");
  const profiles = asArray<ColumnProfile>(job.columnsJson);
  const storedRow = await getImportRow(input.importId, input.rowNumber);
  const row = storedRow ? toReviewRows([storedRow])[0] : null;
  if (!row) throw new Error("Import row was not found.");
  if (input.action === "setExcluded") {
    row.excluded = Boolean(input.excluded);
    if (!row.excluded) {
      row.exactDuplicate = false;
      row.issues = row.issues.filter(issue => issue.type !== "exact-duplicate");
    }
  } else if (input.action === "keepPossibleDuplicate") {
    row.possibleDuplicate = false;
    row.issues = row.issues.filter(issue => issue.type !== "possible-duplicate");
  } else {
    if (!input.column) throw new Error("A column is required for this review action.");
    const profile = profiles.find(candidate => candidate.name === input.column);
    if (!profile) throw new Error("That column is not available for this import.");
    if (input.action === "undoChange") {
      const index = [...row.changes].map(change => change.column).lastIndexOf(input.column);
      if (index < 0) throw new Error("There is no automatic change to undo for this cell.");
      const change = row.changes[index];
      row.cleanedValues[input.column] = change.from;
      row.changes.splice(index, 1);
    } else {
      const rawValue = input.value ?? "";
      const value = profile.kind === "number" ? parseNumber(rawValue) : profile.kind === "date" ? parseDate(rawValue, profile.datePreference) : profile.kind === "category" ? (text(rawValue).replace(/\s+/g, " ").trim() || UNKNOWN) : rawValue;
      if (profile.kind === "number" && value === null && !missing(rawValue)) throw new Error("Enter a valid numeric value for this column.");
      if (profile.kind === "date" && value === null && !missing(rawValue)) throw new Error("Enter a valid date value for this column.");
      const previous = row.cleanedValues[input.column];
      row.cleanedValues[input.column] = value;
      row.changes.push({ column: input.column, from: previous, to: value, reason: "Edited during review" });
    }
    row.rowSignature = signatureFor(row.cleanedValues);
  }
  await updateImportRowReview({ importId: input.importId, rowNumber: input.rowNumber, cleanedValues: row.cleanedValues, changes: row.changes, issues: row.issues, excluded: row.excluded, possibleDuplicate: row.possibleDuplicate, isOutlier: row.isOutlier, rowSignature: row.rowSignature });
  return { success: true };
}

export async function recalculateKpiImport(importId: string) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  const profiles = asArray<ColumnProfile>(job.columnsJson);
  if (!profiles.length) throw new Error("The import has no stored column profile to recalculate.");
  await updateKpiImport(importId, { status: "analyzing", errorMessage: null, workerCheckpointJson: { phase: "review-recalculation" } });
  return recalculateFromStoredRows(importId, profiles);
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
  while (true) {
    try { await processNextQueuedImport(); }
    catch (error) { console.error("[KPI import worker]", error); }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

export const __kpiImportWorkerTesting = {
  inferProfiles,
  findMetric,
  findDate,
  parseDate,
  cleanRow,
  applyFuzzyCategoryReview,
  applyPossibleDuplicateReview,
  logsFromStats,
  profilingDetail,
  profilingFailureMessage,
  signatureFor,
};

if (process.env.KPI_IMPORT_WORKER_MODE === "1") runWorker().catch(error => { console.error(error); process.exit(1); });
