import crypto from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import { longReadablePeriod, type KpiAnalysis } from "../shared/kpiEngine";
import { DEFAULT_CURRENCY_CODE, currencySymbolForCode, detectCurrencyFromValues, normaliseCurrencyCode, type CurrencyDetection } from "../shared/kpiCurrency";
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
const KPI_CANDIDATE_TERMS = [...REVENUE_TERMS, "loss", "losses", "margin", "expense", "expenses", "balance", "volume", "units", "quantity", "orders", "count"];
const QUANTITY_TERMS = ["quantity", "qty", "units", "unit count", "items", "volume"];
const UNIT_PRICE_TERMS = ["unit price", "unitprice", "price", "rate"];
const COST_TERMS = ["unit cost", "unitcost", "cost"];
const DISCOUNT_TERMS = ["discount", "rebate", "markdown"];
const TAX_TERMS = ["tax", "vat", "gst", "sales tax"];
const DATE_TERMS = ["date", "day", "time", "month", "week", "created", "ordered", "purchased", "timestamp", "event", "occurred", "selling", "sold", "shipped", "delivery", "posted", "recorded", "booking", "period", "quarter", "fiscal"];
const NUMERIC_DATE_TERMS = ["date", "time", "timestamp", "period", "quarter", "fiscal", "year", "month", "week", "day"];
const CATEGORY_TERMS = ["region", "state", "city", "location", "product", "category", "channel", "customer", "client", "company", "employer", "industry", "sector", "country", "nation", "stage", "segment", "store", "department", "brand", "type"];
const FREE_TEXT_TERMS = ["description", "notes", "note", "comment", "comments", "remark", "remarks", "narrative", "message", "details", "address"];
const IDENTIFIER_PATTERN = /(?:^|[_\s-])(id|order|invoice|transaction|reference|sku|code|zip|postal|phone|telephone|account|member)(?:$|[_\s-])|(?:invoice|order|transaction|reference|sku|stock|customer)(?:no|number|id|code)?$|(?:id|code|sku|reference|zip|postal|phone|telephone|account|member)$/i;
const CURRENCY_CODE_PATTERN = /\b(NGN|USD|EUR|GBP|CAD|AUD|ZAR|KES|GHS|AED|INR|JPY|CNY|RMB|CHF|BRL|MXN|NZD|SGD|HKD|KRW|TRY|ILS|SEK|NOK|DKK|PLN|CZK|HUF|THB|IDR|MYR|PHP|VND)\b/gi;

type RawRecord = Record<string, unknown>;
type ColumnKind = "date" | "number" | "category" | "identifier" | "unknown";
type DatePreference = "day-first" | "month-first" | "ambiguous" | "contextual";
type DateContext = {
  startPeriod?: string;
  endPeriod?: string;
  fallbackPreference: "day-first" | "month-first";
};
type DateRecipe = {
  kind: "year_month_day";
  yearColumn: string;
  monthColumn: string;
  dayColumn: string;
};
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
  datePreference?: DatePreference;
  dateContext?: DateContext;
  acceptsExcelSerialDates?: boolean;
  acceptsUnixTimestamps?: boolean;
  dateRecipe?: DateRecipe;
  isSelectedMetric?: boolean;
  isMetricCandidate?: boolean;
  candidateReason?: string;
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
type CategoryReconciliationStats = {
  groups: number;
  rows: number;
};
type ContainmentReviewStatus = "pending" | "merged" | "kept-separate" | "superseded";
type ContainmentReviewProposal = {
  id: string;
  column: string;
  containedValue: string;
  containingValue: string;
  containedCount: number;
  containingCount: number;
  status: ContainmentReviewStatus;
};
type ContainmentReviewState = {
  proposals: ContainmentReviewProposal[];
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

const WINDOWS_1252_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const repairCommonUtf8Mojibake = (value: string) => {
  if (!/[ÃÂâ]/.test(value)) return value;
  const candidateBytes = Array.from(value, character => {
    const code = character.codePointAt(0)!;
    return code <= 0xff ? code : WINDOWS_1252_TO_BYTE.get(code);
  });
  if (candidateBytes.some(byte => byte === undefined)) return value;
  const bytes = candidateBytes as number[];
  try {
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    return repaired.includes("\ufffd") ? value : repaired;
  } catch {
    return value;
  }
};

const stripInvisibleFormatting = (value: string) => value.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "");
const text = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return stripInvisibleFormatting(repairCommonUtf8Mojibake(String(value))).normalize("NFC").replace(/\u00a0/g, " ").trim();
};
const normalise = (value: unknown) => text(value).replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const categoryMatchKey = (value: unknown) => text(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
  .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
  .replace(/[-\u2010-\u2015_\\/]+/g, " ")
  .replace(/[.,;:!?]+/g, " ")
  .replace(/['\"]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase();
const compactCategory = (value: unknown) => categoryMatchKey(value).replace(/[^a-z0-9]+/g, "");
const title = (value: string) => value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
const missing = (value: unknown) => ["", "n/a", "na", "null", "none", "-", "undefined", "(blank)"].includes(normalise(value));
const headerScore = (name: string, terms: string[]) => terms.reduce((sum, term) => sum + (normalise(name) === term ? 2 : normalise(name).includes(term) ? 1 : 0), 0);
const asRecord = (value: unknown): RawRecord => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const containmentReviewState = (checkpoint: unknown): ContainmentReviewState => {
  const review = asRecord(asRecord(checkpoint).containmentReview);
  const statuses = new Set<ContainmentReviewStatus>(["pending", "merged", "kept-separate", "superseded"]);
  const proposals = asArray<Partial<ContainmentReviewProposal>>(review.proposals).flatMap(proposal => {
    const id = text(proposal.id);
    const column = text(proposal.column);
    const containedValue = text(proposal.containedValue);
    const containingValue = text(proposal.containingValue);
    const status = text(proposal.status) as ContainmentReviewStatus;
    if (!id || !column || !containedValue || !containingValue || !statuses.has(status)) return [];
    return [{
      id,
      column,
      containedValue,
      containingValue,
      containedCount: Math.max(0, Number(proposal.containedCount) || 0),
      containingCount: Math.max(0, Number(proposal.containingCount) || 0),
      status,
    }];
  });
  return { proposals };
};

const withContainmentReviewState = (checkpoint: unknown, state: ContainmentReviewState, updates: RawRecord = {}) => ({
  ...asRecord(checkpoint),
  ...updates,
  containmentReview: state,
});
const signatureFor = (values: RawRecord) => crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value).replace(/^'/, ""); // Excel/Sheets text-preservation apostrophe.
  if (!raw || missing(raw)) return null;
  const accountingSuffix = raw.match(/\b(CR|DR)\s*$/i)?.[1]?.toUpperCase();
  const negative = /^\(.*\)$/.test(raw) || /^\s*-/.test(raw) || /-\s*$/.test(raw) || accountingSuffix === "DR";
  const compact = raw
    .replace(/-\s*$/, "")
    .replace(/\b(?:CR|DR)\s*$/i, "")
    .replace(/R\$/gi, "")
    .replace(CURRENCY_CODE_PATTERN, "")
    .replace(/[()\s$€£¥₦₹₩₺₪₫₱฿%]/g, "")
    .replace(/[’']/g, "");
  const suffix = compact.match(/([KMB])$/i)?.[1]?.toUpperCase();
  const withoutSuffix = suffix ? compact.slice(0, -1) : compact;
  if (!withoutSuffix || /[A-DF-Za-df-z]/.test(withoutSuffix)) return null;
  const scientific = withoutSuffix.match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))[eE]([+-]?\d+)$/);
  const mantissa = scientific?.[1] ?? withoutSuffix;
  const exponent = scientific ? `e${scientific[2]}` : "";
  const comma = mantissa.lastIndexOf(",");
  const dot = mantissa.lastIndexOf(".");
  let numberText = mantissa;
  if (comma !== -1 && dot !== -1) numberText = comma > dot ? mantissa.replace(/\./g, "").replace(",", ".") : mantissa.replace(/,/g, "");
  else if (comma !== -1 && dot === -1) numberText = /,\d{1,2}$/.test(mantissa) ? mantissa.replace(",", ".") : mantissa.replace(/,/g, "");
  else if (dot !== -1 && comma === -1 && (mantissa.match(/\./g)?.length ?? 0) > 1) numberText = mantissa.replace(/\./g, "");
  const parsed = Number(`${numberText}${exponent}`);
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  const adjusted = parsed * multiplier;
  return Number.isFinite(adjusted) ? (negative ? -Math.abs(adjusted) : adjusted) : null;
};

const toIso = (year: number, month: number, day: number) => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day ? candidate.toISOString().slice(0, 10) : null;
};

// A bare number is treated as an Excel/Sheets serial only when it is in a
// modern business-date range. This prevents Year (2026), Month (1–12), Day
// (1–31), quantities, and small counters from being silently recast as dates.
const EXCEL_SERIAL_MIN = 20_000; // 1954-10-03 in the 1900 system.
const EXCEL_SERIAL_MAX = 80_000; // 2119-01-12 in the 1900 system.

const parseExcelSerialDate = (value: unknown) => {
  const serial = parseNumber(value);
  if (serial === null || serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) return null;
  // Excel includes a fictitious 1900-02-29 at serial 60. Subtract it from
  // later serials so modern workbook dates map to their actual calendar day.
  const wholeDays = Math.floor(serial);
  const adjustedDays = wholeDays >= 60 ? wholeDays - 1 : wholeDays;
  return new Date(Date.UTC(1899, 11, 31) + adjustedDays * 86_400_000).toISOString().slice(0, 10);
};

const parseUnixTimestamp = (value: unknown) => {
  const numeric = parseNumber(value);
  if (numeric === null) return null;
  // Seconds, milliseconds, microseconds, and nanoseconds since 1970. The
  // range deliberately covers 1980–2100 to avoid treating normal IDs as time.
  const epochStart = Date.UTC(1980, 0, 1);
  const epochEnd = Date.UTC(2100, 0, 1);
  const candidates = [numeric * 1_000, numeric, numeric / 1_000, numeric / 1_000_000];
  const milliseconds = candidates.find(candidate => Number.isFinite(candidate) && candidate >= epochStart && candidate <= epochEnd);
  return milliseconds === undefined ? null : new Date(milliseconds).toISOString().slice(0, 10);
};

const withinObservedPeriodWindow = (value: string, context?: DateContext) => {
  const period = value.slice(0, 7);
  return (!context?.startPeriod || period >= context.startPeriod) && (!context?.endPeriod || period <= context.endPeriod);
};

const parseDate = (value: unknown, preference: DatePreference = "ambiguous", context?: DateContext, acceptsExcelSerialDates = false, acceptsUnixTimestamps = false) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value).replace(/^'/, "");
  if (!raw || missing(raw)) return null;
  const compactCalendar = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[T\s]?(\d{2})(\d{2})(\d{2})?)?$/);
  if (compactCalendar) return toIso(Number(compactCalendar[1]), Number(compactCalendar[2]), Number(compactCalendar[3]));
  const compactPeriod = raw.match(/^(\d{4})(\d{2})$/);
  if (compactPeriod) return toIso(Number(compactPeriod[1]), Number(compactPeriod[2]), 1);
  const period = raw.match(/^(\d{4})[/-](\d{1,2})$/);
  if (period) return toIso(Number(period[1]), Number(period[2]), 1);
  const namedPeriod = raw.match(/^([A-Za-z]{3,9})[\s-]+(\d{4})$/);
  if (namedPeriod) {
    const parsed = Date.parse(`1 ${namedPeriod[1]} ${namedPeriod[2]}`);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
  }
  const quarter = raw.match(/^(?:Q([1-4])\s*[-/]?\s*(\d{4})|(\d{4})\s*[-/]?\s*Q([1-4]))$/i);
  if (quarter) {
    const quarterNumber = Number(quarter[1] ?? quarter[4]);
    const year = Number(quarter[2] ?? quarter[3]);
    return toIso(year, (quarterNumber - 1) * 3 + 1, 1);
  }
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
    const dayFirst = toIso(year, second, first);
    const monthFirst = toIso(year, first, second);
    if (dayFirst && dayFirst === monthFirst) return dayFirst;
    if (preference === "day-first") return dayFirst;
    if (preference === "month-first") return monthFirst;
    if (preference === "contextual") {
      const contextualCandidates = [dayFirst, monthFirst].filter((candidate): candidate is string => candidate !== null && withinObservedPeriodWindow(candidate, context));
      if (contextualCandidates.length === 1) return contextualCandidates[0];
      if (contextualCandidates.length === 2) return context?.fallbackPreference === "month-first" ? monthFirst : dayFirst;
      return context?.fallbackPreference === "month-first" ? monthFirst : dayFirst;
    }
    return null;
  }
  const namedTime = "(?:[T\\s]+\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[AaPp][Mm])?)?";
  const namedDayFirst = raw.match(new RegExp(`^(\\d{1,2})\\s*[- ]\\s*([A-Za-z]{3,9})\\s*[-, ]\\s*(\\d{2,4})${namedTime}$`));
  const namedMonthFirst = raw.match(new RegExp(`^([A-Za-z]{3,9})\\s*[- ]?\\s*(\\d{1,2}),?\\s*[- ]\\s*(\\d{2,4})${namedTime}$`));
  if (namedDayFirst || namedMonthFirst) {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
  }
  if (acceptsExcelSerialDates) {
    const serialDate = parseExcelSerialDate(value);
    if (serialDate) return serialDate;
  }
  if (acceptsUnixTimestamps) return parseUnixTimestamp(value);
  // Do not pass arbitrary identifier-looking strings to Date.parse: engines can
  // interpret values such as ORD-10001 as a year, producing a false date rate.
  return null;
};

const inferDateProfile = (values: unknown[]): { preference: DatePreference; context?: DateContext } => {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  const knownDates = new Set<string>();
  const dayFirstMonths = new Set<string>();
  const monthFirstMonths = new Set<string>();

  const addKnownDate = (value: string | null) => { if (value) knownDates.add(value); };
  values.forEach(value => {
    const raw = text(value);
    if (!raw) return;
    const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (iso) { addKnownDate(toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))); return; }

    const namedDayFirst = raw.match(/^(\d{1,2})\s*[- ]\s*([A-Za-z]{3,9})\s*[-, ]\s*(\d{2,4})/);
    if (namedDayFirst) { dayFirstEvidence++; addKnownDate(parseDate(raw)); return; }
    const namedMonthFirst = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})/);
    if (namedMonthFirst) { monthFirstEvidence++; addKnownDate(parseDate(raw)); return; }

    const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (!parts) { addKnownDate(parseDate(raw)); return; }
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    let year = Number(parts[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (first > 12 && second <= 12) { dayFirstEvidence++; addKnownDate(toIso(year, second, first)); return; }
    if (second > 12 && first <= 12) { monthFirstEvidence++; addKnownDate(toIso(year, first, second)); return; }
    const dayFirst = toIso(year, second, first);
    const monthFirst = toIso(year, first, second);
    if (dayFirst) dayFirstMonths.add(dayFirst.slice(0, 7));
    if (monthFirst) monthFirstMonths.add(monthFirst.slice(0, 7));
    if (dayFirst && dayFirst === monthFirst) addKnownDate(dayFirst);
  });

  if (dayFirstEvidence && !monthFirstEvidence) return { preference: "day-first" };
  if (monthFirstEvidence && !dayFirstEvidence) return { preference: "month-first" };

  let fallbackPreference: "day-first" | "month-first" = dayFirstEvidence >= monthFirstEvidence ? "day-first" : "month-first";
  if (dayFirstMonths.size && monthFirstMonths.size) {
    const knownMonths = new Set(Array.from(knownDates, value => value.slice(0, 7)));
    const totalMonths = (candidateMonths: Set<string>) => new Set(Array.from(knownMonths).concat(Array.from(candidateMonths))).size;
    const dayFirstTotal = totalMonths(dayFirstMonths);
    const monthFirstTotal = totalMonths(monthFirstMonths);
    if (monthFirstTotal < dayFirstTotal) fallbackPreference = "month-first";
    if (dayFirstTotal < monthFirstTotal) fallbackPreference = "day-first";
  }
  const orderedKnownDates = Array.from(knownDates).sort();
  return {
    preference: "contextual",
    context: {
      startPeriod: orderedKnownDates[0]?.slice(0, 7),
      endPeriod: orderedKnownDates.at(-1)?.slice(0, 7),
      fallbackPreference,
    },
  };
};

const inferBaseProfiles = (headers: string[], samples: RawRecord[]): ColumnProfile[] => headers.map(name => {
  const values = samples.map(row => row[name]).filter(value => !missing(value));
  if (!values.length) return { name, kind: "unknown", confidence: 0 };
  const dateProfile = inferDateProfile(values);
  const numericRate = values.filter(value => parseNumber(value) !== null).length / values.length;
  const dateHint = headerScore(name, DATE_TERMS);
  const numericDateHint = headerScore(name, NUMERIC_DATE_TERMS);
  const acceptsExcelSerialDates = numericDateHint > 0 && values.some(value => parseExcelSerialDate(value) !== null);
  const acceptsUnixTimestamps = numericDateHint > 0 && values.some(value => parseUnixTimestamp(value) !== null);
  const dateRate = values.filter(value => parseDate(value, dateProfile.preference, dateProfile.context, acceptsExcelSerialDates, acceptsUnixTimestamps) !== null).length / values.length;
  const distinctRate = new Set(values.map(text)).size / values.length;
  const numericHint = headerScore(name, REVENUE_TERMS);
  const candidateMetricHint = headerScore(name, KPI_CANDIDATE_TERMS);
  const explicitIdentifier = IDENTIFIER_PATTERN.test(name);
  const isReliableDate = dateRate >= PROFILE_MIN_VALID_RATE && (dateHint > 0 || numericRate < 0.98);
  // Values—not header uniqueness—decide whether a date-like column is a date.
  // Headers such as order_date and transaction_date must not be captured by
  // the identifier heuristic merely because every date/time is distinct.
  if (isReliableDate) return { name, kind: "date", confidence: Math.round(Math.min(99, dateRate * 88 + dateHint * 5)), datePreference: dateProfile.preference, dateContext: dateProfile.context, acceptsExcelSerialDates: acceptsExcelSerialDates || undefined, acceptsUnixTimestamps: acceptsUnixTimestamps || undefined };
  const quantityHint = headerScore(name, QUANTITY_TERMS);
  const categoryHint = headerScore(name, CATEGORY_TERMS);
  const freeTextHint = headerScore(name, FREE_TEXT_TERMS);
  const longTextRate = values.filter(value => {
    const candidate = text(value);
    return candidate.length >= 80 && /\s/.test(candidate);
  }).length / values.length;
  // Long descriptions and narrative fields are retained as text, never treated as dimensions for fuzzy matching.
  if (freeTextHint > 0 || longTextRate >= 0.5) return { name, kind: "unknown", confidence: Math.round(Math.min(95, 75 + Math.max(freeTextHint, longTextRate * 15))) };
  if (explicitIdentifier || (distinctRate > 0.92 && values.length > 7 && /\d/.test(values.map(text).join("")) && numericHint === 0 && candidateMetricHint === 0 && quantityHint === 0)) return { name, kind: "identifier", confidence: 82 };
  if (categoryHint > 0 && numericHint === 0) return { name, kind: "category", confidence: Math.round(Math.min(95, 70 + categoryHint * 6)) };
  if (numericRate >= PROFILE_MIN_VALID_RATE) return { name, kind: "number", confidence: Math.round(Math.min(99, numericRate * 88 + numericHint * 5)) };
  if (distinctRate <= 0.96 || categoryHint > 0) return { name, kind: "category", confidence: Math.round(Math.min(95, 70 + categoryHint * 6)) };
  return { name, kind: "unknown", confidence: 48 };
});

const headerMatches = (name: string, terms: string[]) => terms.some(term => normalise(name) === term || normalise(name).includes(term));

const deriveMetricProfile = (profiles: ColumnProfile[]): ColumnProfile | null => {
  const numeric = profiles.filter(profile => profile.kind === "number");
  const quantity = numeric.filter(profile => headerMatches(profile.name, QUANTITY_TERMS)).sort((left, right) => headerScore(right.name, QUANTITY_TERMS) - headerScore(left.name, QUANTITY_TERMS))[0];
  const unitPrice = numeric.filter(profile => headerMatches(profile.name, UNIT_PRICE_TERMS)).sort((left, right) => headerScore(right.name, UNIT_PRICE_TERMS) - headerScore(left.name, UNIT_PRICE_TERMS))[0];
  const unitCost = numeric.filter(profile => headerMatches(profile.name, COST_TERMS)).sort((left, right) => headerScore(right.name, COST_TERMS) - headerScore(left.name, COST_TERMS))[0];
  if (!quantity || !(unitPrice || unitCost)) return null;
  const unitValue = unitPrice ?? unitCost!;
  const discount = numeric.find(profile => headerMatches(profile.name, DISCOUNT_TERMS));
  const tax = numeric.find(profile => headerMatches(profile.name, TAX_TERMS));
  const recipe: MetricRecipe = { kind: unitPrice ? "quantity_times_price" : "quantity_times_cost", quantityColumn: quantity.name, unitValueColumn: unitValue.name, ...(discount ? { discountColumn: discount.name } : {}), ...(tax ? { taxColumn: tax.name } : {}) };
  const adjustments = [discount && `less ${discount.name}`, tax && `plus ${tax.name}`].filter(Boolean).join("; ");
  return { name: "__derived_amount__", kind: "number", confidence: Math.min(quantity.confidence, unitValue.confidence), label: "Derived Amount", selectionReason: `Calculated as ${quantity.name} × ${unitValue.name}${adjustments ? `; ${adjustments}` : ""}.`, metricRecipe: recipe };
};

const selectMetricProfile = (profiles: ColumnProfile[]): ColumnProfile | null => {
  const numeric = profiles.filter(profile => profile.kind === "number");
  const direct = numeric.filter(profile => headerMatches(profile.name, DIRECT_KPI_TERMS)).sort((left, right) => headerScore(right.name, DIRECT_KPI_TERMS) - headerScore(left.name, DIRECT_KPI_TERMS) || right.confidence - left.confidence)[0];
  if (direct) return { ...direct, isSelectedMetric: true, label: direct.name, selectionReason: `Selected the labelled monetary column “${direct.name}”.` };
  const derived = deriveMetricProfile(profiles);
  if (derived) return { ...derived, isSelectedMetric: true };
  const fallback = numeric.filter(profile => !headerMatches(profile.name, QUANTITY_TERMS) && !headerMatches(profile.name, DISCOUNT_TERMS) && !headerMatches(profile.name, TAX_TERMS)).sort((left, right) => headerScore(right.name, REVENUE_TERMS) - headerScore(left.name, REVENUE_TERMS) || right.confidence - left.confidence || left.name.localeCompare(right.name))[0];
  return fallback ? { ...fallback, isSelectedMetric: true, label: fallback.name, selectionReason: `No labelled monetary total or complete quantity-price pair was found; selected the highest-confidence usable numeric column “${fallback.name}”.` } : null;
};

const findYearComponent = (headers: string[]) => headers.filter(header => normalise(header).includes("year")).sort((left, right) => headerScore(right, ["year"]) - headerScore(left, ["year"]) || left.localeCompare(right))[0];
const findMonthComponent = (headers: string[]) => headers.filter(header => normalise(header).includes("month")).sort((left, right) => headerScore(right, ["month"]) - headerScore(left, ["month"]) || left.localeCompare(right))[0];
const findDayComponent = (headers: string[]) => headers.filter(header => /(^|\s)day($|\s)|day of month|date day/.test(normalise(header)) && !normalise(header).includes("weekday")).sort((left, right) => headerScore(right, ["day of month", "date day", "day"]) - headerScore(left, ["day of month", "date day", "day"]) || left.localeCompare(right))[0];

const deriveYearMonthDayProfile = (headers: string[], samples: RawRecord[]): ColumnProfile | null => {
  const yearColumn = findYearComponent(headers);
  const monthColumn = findMonthComponent(headers);
  const dayColumn = findDayComponent(headers);
  if (!yearColumn || !monthColumn || !dayColumn || new Set([yearColumn, monthColumn, dayColumn]).size !== 3) return null;
  const validRows = samples.filter(row => {
    const year = parseNumber(row[yearColumn]);
    const month = parseNumber(row[monthColumn]);
    const day = parseNumber(row[dayColumn]);
    return year !== null && month !== null && day !== null && Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) && year >= 1900 && year <= 2100 && toIso(year, month, day) !== null;
  }).length;
  const confidence = samples.length ? validRows / samples.length : 0;
  if (confidence < PROFILE_MIN_VALID_RATE) return null;
  return {
    name: "__derived_date__",
    label: "Derived Date (Year + Month + Day)",
    kind: "date",
    confidence: Math.round(Math.min(99, confidence * 88 + 5)),
    dateRecipe: { kind: "year_month_day", yearColumn, monthColumn, dayColumn },
  };
};

const metricCandidateReason = (profile: ColumnProfile) => {
  if (profile.metricRecipe) return profile.selectionReason ?? `Calculated as ${profile.label ?? profile.name}.`;
  if (headerMatches(profile.name, DIRECT_KPI_TERMS)) return `Strong monetary KPI signal from the “${profile.name}” header.`;
  if (headerMatches(profile.name, QUANTITY_TERMS)) return `Usable numeric quantity or volume field (${profile.confidence}% valid values).`;
  return `Usable numeric field (${profile.confidence}% valid values).`;
};

const markMetricCandidates = (profiles: ColumnProfile[], selectedMetric: ColumnProfile | null, derivedMetric: ColumnProfile | null) => {
  const selectedName = selectedMetric?.name;
  const annotatedProfiles = profiles.map(profile => {
    if (profile.kind !== "number" || profile.confidence < PROFILE_MIN_VALID_RATE * 100) return profile;
    return { ...profile, isMetricCandidate: true, candidateReason: metricCandidateReason(profile), isSelectedMetric: profile.name === selectedName, ...(profile.name === selectedName ? { label: selectedMetric?.label ?? profile.label ?? profile.name, selectionReason: selectedMetric?.selectionReason ?? profile.selectionReason } : {}) };
  });
  const derived = derivedMetric ? { ...derivedMetric, isSelectedMetric: selectedName === derivedMetric.name, isMetricCandidate: true, candidateReason: metricCandidateReason(derivedMetric) } : null;
  return [...annotatedProfiles, ...(derived ? [derived] : [])];
};

const applyMetricSelection = (profiles: ColumnProfile[], metricName: string) => {
  const candidate = profiles.find(profile => profile.isMetricCandidate && profile.kind === "number" && profile.name === metricName);
  if (!candidate) throw new Error("That KPI column is not available for this import.");
  return profiles.map(profile => {
    if (!profile.isMetricCandidate || profile.kind !== "number") return profile;
    const selected = profile.name === metricName;
    return {
      ...profile,
      isSelectedMetric: selected,
      ...(selected ? { label: profile.label ?? profile.name, selectionReason: `Selected manually from ${profiles.filter(item => item.isMetricCandidate && item.kind === "number").length} available KPI candidates.` } : {}),
    };
  });
};

const inferProfiles = (headers: string[], samples: RawRecord[]): ColumnProfile[] => {
  const profiles = inferBaseProfiles(headers, samples);
  const selectedMetric = selectMetricProfile(profiles);
  const derivedMetric = deriveMetricProfile(profiles);
  const derivedDate = deriveYearMonthDayProfile(headers, samples);
  return [...markMetricCandidates(profiles, selectedMetric, derivedMetric), ...(derivedDate ? [derivedDate] : [])];
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
      const values = (row.values as unknown[]).slice(1).map(value => {
        const resolved = value && typeof value === "object" && "result" in (value as Record<string, unknown>) ? (value as { result?: unknown }).result : value;
        if (resolved instanceof Date) return resolved.toISOString().slice(0, 10);
        if (resolved && typeof resolved === "object" && "text" in (resolved as Record<string, unknown>)) return String((resolved as { text?: unknown }).text ?? "");
        return resolved ?? "";
      });
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
const findDate = (profiles: ColumnProfile[]) => profiles.filter(profile => profile.kind === "date").sort((a, b) => Number(Boolean(a.dateRecipe)) - Number(Boolean(b.dateRecipe)) || headerScore(b.name, DATE_TERMS) - headerScore(a.name, DATE_TERMS) || b.confidence - a.confidence)[0];
const profilingDetail = (profiles: ColumnProfile[]) => profiles.map(profile => {
  const selected = profile.isSelectedMetric ? "; selected KPI" : "";
  const preference = profile.kind === "date" && profile.datePreference ? `; ${profile.datePreference}${profile.dateContext?.startPeriod && profile.dateContext?.endPeriod ? `; observed ${profile.dateContext.startPeriod} to ${profile.dateContext.endPeriod}` : ""}${profile.acceptsExcelSerialDates ? "; Excel serials supported" : ""}${profile.acceptsUnixTimestamps ? "; Unix timestamps supported" : ""}` : "";
  const displayName = profile.label && profile.label !== profile.name ? `${profile.label} (${profile.name})` : profile.name;
  return `${displayName}: ${profile.kind} (${profile.confidence}%${selected}${preference})`;
}).join(" · ");
const profilingFailureMessage = (profiles: ColumnProfile[]) => `We could not identify both a reliable date column and numeric KPI. Profiled columns: ${profilingDetail(profiles)}.`;
const normaliseCategory = (value: unknown) => text(value).replace(/\s+/g, " ").trim() || UNKNOWN;

function cleanRow(row: RawRecord, profiles: ColumnProfile[], stats: WorkerStats) {
  const rawValues: RawRecord = { ...row };
  const cleanedValues: RawRecord = {};
  const changes: CellChange[] = [];
  const issues: DataIssue[] = [];
  for (const profile of profiles) {
    if (profile.dateRecipe) {
      const recipe = profile.dateRecipe;
      const year = parseNumber(row[recipe.yearColumn]);
      const month = parseNumber(row[recipe.monthColumn]);
      const day = parseNumber(row[recipe.dayColumn]);
      const derived = year !== null && month !== null && day !== null ? toIso(year, month, day) : null;
      cleanedValues[profile.name] = derived;
      if (derived) { stats.dateChanges++; changes.push({ column: profile.name, from: null, to: derived, reason: `Derived date from ${recipe.yearColumn}, ${recipe.monthColumn}, and ${recipe.dayColumn}` }); }
      else issues.push({ type: "ambiguous-date", column: profile.name, message: `Could not derive a valid date from ${recipe.yearColumn}, ${recipe.monthColumn}, and ${recipe.dayColumn}.` });
      continue;
    }
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
      const parsed = parseDate(raw, profile.datePreference, profile.dateContext, profile.acceptsExcelSerialDates, profile.acceptsUnixTimestamps);
      cleanedValues[profile.name] = parsed ?? raw;
      if (parsed && parsed !== raw) { stats.dateChanges++; changes.push({ column: profile.name, from: raw, to: parsed, reason: "Standardised date" }); }
      if (!parsed) issues.push({ type: "ambiguous-date", column: profile.name, message: "Could not standardise date" });
      continue;
    }
    if (profile.kind === "category") {
      const normalized = normaliseCategory(raw);
      cleanedValues[profile.name] = normalized;
      const rawCategory = raw === null || raw === undefined ? "" : String(raw);
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

function analysisFromAggregates(input: { aggregates: AnalysisAggregate[]; profiles: ColumnProfile[]; usableRows: number; currency?: CurrencyDetection }): KpiAnalysis {
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
  const allCauses = Array.from(byCause.values()).map(cause => {
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
  }).filter(cause => Math.abs(cause.impact) > 0).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const sameDirectionCauses = change === 0 ? allCauses : allCauses.filter(cause => Math.sign(cause.impact) === Math.sign(change));
  const causes = (sameDirectionCauses.length ? sameDirectionCauses : allCauses).slice(0, 5);
  const offsettingCauses = change === 0 ? [] : allCauses.filter(cause => Math.sign(cause.impact) !== Math.sign(change)).slice(0, 3);
  const primary = causes[0];
  const confidence = primary?.confidence ?? 50;
  const direction = change < 0 ? "decreased" : "increased";
  const summary = primary
    ? `${metric.name} ${direction} ${Math.abs(changePercent).toFixed(1)}% from ${longReadablePeriod(previousPeriod)} to ${longReadablePeriod(currentPeriod)}. The largest contributor was ${primary.dimension}: ${primary.value}. We are ${confidence}% confident in this explanation. If it had stayed flat, ${metric.name.toLowerCase()} would have been about ${(primary.counterfactual).toLocaleString(undefined, { maximumFractionDigits: 0 })}.`
    : `${metric.name} ${direction} ${Math.abs(changePercent).toFixed(1)}% from ${longReadablePeriod(previousPeriod)} to ${longReadablePeriod(currentPeriod)}. No material categorical driver was identified.`;
  const currency = input.currency ?? { currencyCode: DEFAULT_CURRENCY_CODE, currencySymbol: currencySymbolForCode(DEFAULT_CURRENCY_CODE), currencySource: "default" as const, detected: false };
  return { metric: metric.name, metricLabel: metric.label ?? metric.name, currencySymbol: currency.currencySymbol, currencyCode: currency.currencyCode, currencySource: currency.currencySource, dateColumn: date.name, previousPeriod, currentPeriod, previousTotal, currentTotal, change, changePercent, excludedMetricRows: 0, trend: periods.slice(-8).map(period => ({ period, total: totals.get(period) ?? 0 })), causes, offsettingCauses, confidence, summary, totalRowsUsed: input.usableRows };
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

const logsFromStats = (stats: WorkerStats, metric?: ColumnProfile, currency?: CurrencyDetection, reconciliations: CategoryReconciliationStats = { groups: stats.fuzzyCategoryMerges, rows: stats.fuzzyCategoryRows }) => [
  ...(metric ? [{ key: "metric", title: "KPI selected", detail: metric.selectionReason ?? `Selected ${metric.label ?? metric.name} as the KPI.`, count: 1, severity: "success" as const }] : []),
  ...(currency ? [{ key: "currency", title: "Display currency", detail: currency.detected ? `${currency.currencyCode} was detected from the uploaded KPI values. You can change this display setting at any time; values are not converted.` : `Currency was not detected, so display defaults to ${currency.currencyCode}. You can change this display setting at any time; values are not converted.`, count: 1, severity: currency.detected ? "success" as const : "info" as const }] : []),
  { key: "duplicates", title: "Exact duplicates excluded", detail: "Exact cleaned-row duplicates are retained for review but excluded from the default calculation.", count: stats.exactDuplicates, severity: stats.exactDuplicates ? "success" : "info" },
  { key: "possible", title: "Possible duplicates flagged", detail: "Rows sharing a company or customer, date, and KPI value are kept for your decision.", count: stats.possibleDuplicates, severity: stats.possibleDuplicates ? "warning" : "info" },
  { key: "fuzzy", title: "Category reconciliation groups", detail: `${reconciliations.rows.toLocaleString()} individual category cells were reconciled across ${reconciliations.groups.toLocaleString()} distinct reconciliation group${reconciliations.groups === 1 ? "" : "s"}. Includes deterministic formatting variants (case, whitespace, punctuation, separators, and Unicode), controlled aliases, and only unambiguous high-confidence near-duplicates.`, count: reconciliations.groups, severity: reconciliations.groups ? "success" : "info" },
  { key: "outliers", title: "Outliers flagged for review", detail: "IQR-based outlier flags never remove values automatically.", count: stats.outliers, severity: stats.outliers ? "warning" : "info" },
  { key: "dates", title: "Dates standardised", detail: "Recognisable mixed date formats were converted to ISO format.", count: stats.dateChanges, severity: "success" },
  { key: "numbers", title: "Numbers and currencies standardised", detail: "Currency symbols and supported currency codes were removed while retaining numeric values.", count: stats.numericChanges, severity: "success" },
  { key: "categories", title: "Category whitespace standardised", detail: "Count of individual category cells changed during direct trim or internal-whitespace cleanup. Reconciliation groups are reported separately above.", count: stats.categoryChanges, severity: "success" },
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
    // Missing separators are deterministic formatting; acronym-style values (NY, LA, UK, E Coast)
    // are intentionally excluded and can only appear as review-only possible aliases.
    if (compact === "newyork") return "New York";
    if (compact === "losangeles") return "Los Angeles";
    if (compact === "eastcoast") return "East Coast";
    if (compact === "westcoast") return "West Coast";
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

const preferredCategoryDisplay = (values: string[], frequency: Map<string, number>) => {
  const display = (value: string) => text(value).normalize("NFKC").replace(/[-\u2010-\u2015_\\/]+/g, " ").replace(/[.,;:!?]+$/g, "").replace(/\s+/g, " ").trim();
  const winner = values.slice().sort((left, right) => {
    const leftDisplay = display(left);
    const rightDisplay = display(right);
    const leftPenalty = left === leftDisplay ? 0 : 1;
    const rightPenalty = right === rightDisplay ? 0 : 1;
    const leftTitle = /^[A-Z]/.test(leftDisplay) ? 0 : 1;
    const rightTitle = /^[A-Z]/.test(rightDisplay) ? 0 : 1;
    return (frequency.get(right) ?? 0) - (frequency.get(left) ?? 0)
      || leftPenalty - rightPenalty
      || leftTitle - rightTitle
      || leftDisplay.localeCompare(rightDisplay);
  })[0]!;
  return display(winner);
};

const isAbbreviationToken = (value: string) => /^(?:[A-Z]{2,5}|(?:[A-Z]\.){2,5})$/.test(text(value));
const deprecatedAutomaticAbbreviationChange = (change: CellChange) => change.reason === "Mapped a controlled category alias" && isAbbreviationToken(String(change.from));

function revertDeprecatedAutomaticAbbreviationChanges(rows: ReviewRow[]) {
  const changedRows: ReviewRow[] = [];
  rows.forEach(row => {
    const deprecated = row.changes.filter(deprecatedAutomaticAbbreviationChange);
    if (!deprecated.length) return;
    let changed = false;
    deprecated.forEach(change => {
      // Never overwrite a subsequent user edit; only reverse the old automatic alias when its result is still present.
      if (row.cleanedValues[change.column] === change.to) {
        row.cleanedValues[change.column] = change.from;
        changed = true;
      }
    });
    if (!changed) return;
    row.changes = row.changes.filter(change => !deprecatedAutomaticAbbreviationChange(change));
    row.rowSignature = signatureFor(row.cleanedValues);
    changedRows.push(row);
  });
  return changedRows;
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
    const replacementByValue = new Map<string, { value: string; reason: string }>();

    // Formatting-only equivalence is deterministic and remains safe even in a high-cardinality column.
    const valuesByKey = new Map<string, string[]>();
    values.forEach(value => {
      const key = categoryMatchKey(value);
      if (!key) return;
      const group = valuesByKey.get(key) ?? [];
      group.push(value);
      valuesByKey.set(key, group);
    });
    valuesByKey.forEach(group => {
      if (group.length < 2) return;
      const replacement = preferredCategoryDisplay(group, frequency);
      group.forEach(value => {
        if (value !== replacement) replacementByValue.set(value, { value: replacement, reason: "Standardised equivalent category formatting" });
      });
    });

    values.sort((left, right) => (frequency.get(left) ?? 0) - (frequency.get(right) ?? 0) || left.localeCompare(right)).forEach(value => {
      if (replacementByValue.has(value)) return;
      const alias = knownCategoryAlias(value, profile.name);
      if (alias && alias !== value) {
        replacementByValue.set(value, { value: alias, reason: "Mapped a controlled category alias" });
        return;
      }
      // Fuzzy matching is intentionally conservative: only remaining category values, never high-cardinality fields,
      // no short labels/acronyms, and no merge when the nearest candidate is ambiguous.
      if (values.length > MAX_FUZZY_CATEGORY_VALUES) return;
      const valueKey = compactCategory(value);
      if (valueKey.length < 4) return;
      const valueFrequency = frequency.get(value) ?? 0;
      const candidates = values.filter(candidate => {
        const candidateKey = compactCategory(candidate);
        const candidateFrequency = frequency.get(candidate) ?? 0;
        return candidate !== value
          && !replacementByValue.has(candidate)
          && candidateKey.length >= 4
          && (candidateFrequency > valueFrequency || (candidateFrequency === valueFrequency && candidateKey.length >= valueKey.length));
      });
      const ranked = candidates.map(candidate => ({ candidate, score: similarity(valueKey, compactCategory(candidate)) })).sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate));
      const fuzzy = ranked[0];
      const runnerUp = ranked[1];
      const longMinorTypo = valueKey.length >= 8 && (fuzzy?.candidate.length ?? 0) >= 8 && (fuzzy?.score ?? 0) >= 0.88;
      const highSimilarity = (fuzzy?.score ?? 0) >= 0.93 || longMinorTypo;
      const unambiguous = !runnerUp || (fuzzy!.score - runnerUp.score) >= 0.04;
      if (fuzzy && highSimilarity && unambiguous) replacementByValue.set(value, { value: fuzzy.candidate, reason: "Merged a high-confidence near-duplicate category" });
    });

    rows.forEach(row => {
      const current = String(row.cleanedValues[profile.name] ?? UNKNOWN);
      const replacement = replacementByValue.get(current);
      if (!replacement) return;
      row.cleanedValues[profile.name] = replacement.value;
      row.rowSignature = signatureFor(row.cleanedValues);
      row.changes.push({ column: profile.name, from: current, to: replacement.value, reason: replacement.reason });
      stats.fuzzyCategoryRows++;
      aliasGroups.add(`${profile.name}\u0000${replacement.value}`);
      changedRows.add(row.rowNumber);
    });
  }
  stats.fuzzyCategoryMerges = aliasGroups.size;
  return changedRows;
}

const containmentProposalId = (column: string, containedValue: string, containingValue: string) => `containment-${crypto.createHash("sha256").update(JSON.stringify([column, containedValue, containingValue])).digest("hex")}`;

const publicImportFailureMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message.trim() : "";
  // Preserve the deliberate, actionable importer validation messages. Database
  // driver output can include SQL and user data, so it must never be persisted
  // to an import record or reflected back to the browser.
  if (/^(File exceeds|The uploaded spreadsheet has no header row|KPI Detective supports streaming CSV and XLSX|We could not identify both a reliable numeric KPI and date column|At least two dated periods are required)/.test(message)) return message.slice(0, 1200);
  return "We could not process this import. Please try again, or use a smaller CSV or XLSX file.";
};

function detectContainmentReviewProposals(rows: ReviewRow[], profiles: ColumnProfile[], existing: ContainmentReviewState): ContainmentReviewState {
  const existingById = new Map(existing.proposals.map(proposal => [proposal.id, proposal]));
  const detected: ContainmentReviewProposal[] = [];
  profiles.filter(profile => profile.kind === "category").forEach(profile => {
    const frequency = new Map<string, number>();
    rows.filter(row => !row.excluded).forEach(row => {
      const value = String(row.cleanedValues[profile.name] ?? UNKNOWN);
      if (value !== UNKNOWN) frequency.set(value, (frequency.get(value) ?? 0) + 1);
    });
    const values = Array.from(frequency.keys());
    // The same value-cardinality guard used by fuzzy review protects the confirmation screen from noisy, high-cardinality free text.
    if (values.length > MAX_FUZZY_CATEGORY_VALUES) return;
    const keyed = values.map(value => ({ value, key: categoryMatchKey(value), count: frequency.get(value) ?? 0 })).filter(item => item.key.length >= 3);
    keyed.forEach(shorter => {
      keyed.forEach(longer => {
        const isWholeValueContainment = (` ${longer.key} `).includes(` ${shorter.key} `);
        if (shorter.value === longer.value || longer.key.length <= shorter.key.length || !isWholeValueContainment) return;
        const id = containmentProposalId(profile.name, shorter.value, longer.value);
        const previous = existingById.get(id);
        detected.push(previous ?? {
          id,
          column: profile.name,
          containedValue: shorter.value,
          containingValue: longer.value,
          containedCount: shorter.count,
          containingCount: longer.count,
          status: "pending",
        });
      });
    });
  });
  const detectedIds = new Set(detected.map(proposal => proposal.id));
  const retained = existing.proposals.filter(proposal => !detectedIds.has(proposal.id) && proposal.status !== "pending");
  return { proposals: [...detected, ...retained].sort((left, right) => left.column.localeCompare(right.column) || left.containedValue.localeCompare(right.containedValue) || left.containingValue.localeCompare(right.containingValue)) };
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

const automaticCategoryReconciliation = (change: CellChange) => [
  "Standardised category whitespace",
  "Standardised equivalent category formatting",
  "Mapped a controlled category alias",
  "Merged a high-confidence near-duplicate category",
].includes(change.reason);

const categoryReconciliationStats = (rows: ReviewRow[], profiles: ColumnProfile[]): CategoryReconciliationStats => {
  const categoryColumns = new Set(profiles.filter(profile => profile.kind === "category").map(profile => profile.name));
  const groups = new Set<string>();
  let reconciledCells = 0;
  rows.forEach(row => {
    categoryColumns.forEach(column => {
      if (!row.changes.some(change => change.column === column && automaticCategoryReconciliation(change))) return;
      const raw = String(row.rawValues[column] ?? "");
      const final = String(row.cleanedValues[column] ?? UNKNOWN);
      if (!raw || raw === final) return;
      groups.add(`${column}\u0000${final}`);
      reconciledCells++;
    });
  });
  return { groups: groups.size, rows: reconciledCells };
};

const storedWorkerStats = (rows: ReviewRow[], usableRows: number): WorkerStats => ({
  sourceRows: rows.length,
  usableRows,
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
});

const displayCurrencyForRows = (rows: ReviewRow[], metric: ColumnProfile, existingAnalysis: unknown): CurrencyDetection => {
  const existing = asRecord(existingAnalysis);
  const manualCode = existing.currencySource === "manual" ? normaliseCurrencyCode(text(existing.currencyCode)) : null;
  if (manualCode) return { currencyCode: manualCode, currencySymbol: currencySymbolForCode(manualCode), currencySource: "manual", detected: true };
  const metricValues = metric.metricRecipe
    ? rows.map(row => row.rawValues[metric.metricRecipe!.unitValueColumn])
    : rows.map(row => row.rawValues[metric.name]);
  const explicitCurrencyValues = rows.flatMap(row => Object.entries(row.rawValues)
    .filter(([column]) => /(?:^|[_\s-])(?:currency(?:[_\s-]?code)?|ccy)(?:$|[_\s-])/i.test(column))
    .map(([, value]) => value));
  return detectCurrencyFromValues([...metricValues, ...explicitCurrencyValues]);
};

async function recalculateFromStoredRows(importId: string, profiles: ColumnProfile[]) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  const rows = toReviewRows(await getAllImportRows(importId));
  const containmentReview = containmentReviewState(job.workerCheckpointJson);
  const revertedAutomaticAbbreviations = revertDeprecatedAutomaticAbbreviationChanges(rows);
  if (revertedAutomaticAbbreviations.length) await persistReviewRows(importId, revertedAutomaticAbbreviations);
  const metric = findMetric(profiles);
  const date = findDate(profiles);
  if (!metric || !date) throw new Error("The import no longer has a reliable numeric KPI and date column.");
  const currency = displayCurrencyForRows(rows, metric, job.analysisJson);
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
  const stats = storedWorkerStats(rows, baseline.usableRows);
  const reconciliations = categoryReconciliationStats(rows, profiles);
  const baselineAnalysis = analysisFromAggregates({ aggregates: Array.from(baseline.aggregateMap.values()), profiles, usableRows: baseline.usableRows, currency });
  const flaggedOutliers = rows.filter(row => !row.excluded && row.isOutlier);
  let analysis = baselineAnalysis;
  if (flaggedOutliers.length) {
    try {
      const withoutOutliers = buildAggregateMap(false);
      const outlierExcludedAnalysis = analysisFromAggregates({ aggregates: Array.from(withoutOutliers.aggregateMap.values()), profiles, usableRows: withoutOutliers.usableRows, currency });
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
          offsettingCauses: outlierExcludedAnalysis.offsettingCauses,
          confidence,
          outlierSensitivity,
          summary: `${baselineAnalysis.metric} ${baselineAnalysis.change < 0 ? "decreased" : "increased"} ${Math.abs(baselineAnalysis.changePercent).toFixed(1)}% from ${longReadablePeriod(baselineAnalysis.previousPeriod)} to ${longReadablePeriod(baselineAnalysis.currentPeriod)} when all transactions are included. However, ${flaggedOutliers.length} IQR-flagged transaction${flaggedOutliers.length === 1 ? "" : "s"} materially change the driver ranking. ${baselinePrimary.dimension}: ${baselinePrimary.value} has an all-transaction impact of ${baselinePrimary.impact.toLocaleString(undefined, { maximumFractionDigits: 0 })}, but ${baselinePrimaryWithoutOutliers.toLocaleString(undefined, { maximumFractionDigits: 0 })} without flagged transactions. The driver view therefore uses the outlier-excluded sensitivity result, led by ${outlierExcludedPrimary.dimension}: ${outlierExcludedPrimary.value}.`,
        };
      } else analysis = { ...baselineAnalysis, outlierSensitivity };
    } catch {
      // Preserve the baseline if removing outliers leaves too little period coverage for a valid comparison.
    }
  }
  await updateKpiImport(importId, { status: "complete", sourceRowCount: rows.length, usableRowCount: baseline.usableRows, previewRowCount: rows.length, columnsJson: profiles, cleaningSummaryJson: logsFromStats(stats, metric, currency, reconciliations), analysisJson: analysis, workerCheckpointJson: withContainmentReviewState(job.workerCheckpointJson, containmentReview, { phase: "complete", processedRows: rows.length, recalculated: true }), completedAt: new Date() });
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
  const containmentReview = detectContainmentReviewProposals(reviewRows, profiles, containmentReviewState(job.workerCheckpointJson));
  const duplicateChanges = applyPossibleDuplicateReview(reviewRows, profiles, stats);
  const outlierChanges = applyOutlierReview(reviewRows, profiles, stats);
  const changedRows = new Set(Array.from(fuzzyChanges).concat(Array.from(duplicateChanges), Array.from(outlierChanges)));
  await persistReviewRows(importId, reviewRows.filter(row => changedRows.has(row.rowNumber)));
  await updateKpiImport(importId, { workerCheckpointJson: withContainmentReviewState(job.workerCheckpointJson, containmentReview, { phase: "containment-review", processedRows: stats.sourceRows }) });
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
      const value = profile.kind === "number" ? parseNumber(rawValue) : profile.kind === "date" ? parseDate(rawValue, profile.datePreference, profile.dateContext, profile.acceptsExcelSerialDates, profile.acceptsUnixTimestamps) : profile.kind === "category" ? (text(rawValue).replace(/\s+/g, " ").trim() || UNKNOWN) : rawValue;
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

export async function applyContainmentReviewDecision(input: { importId: string; proposalId: string; decision: "merge" | "keep-separate" }) {
  const job = await getKpiImport(input.importId);
  if (!job) throw new Error("Import job was not found.");
  const profiles = asArray<ColumnProfile>(job.columnsJson);
  const state = containmentReviewState(job.workerCheckpointJson);
  const proposal = state.proposals.find(candidate => candidate.id === input.proposalId);
  if (!proposal || proposal.status !== "pending") throw new Error("That containment review item is no longer awaiting a decision.");
  let nextState: ContainmentReviewState;
  if (input.decision === "keep-separate") {
    nextState = { proposals: state.proposals.map(candidate => candidate.id === proposal.id ? { ...candidate, status: "kept-separate" } : candidate) };
    await updateKpiImport(input.importId, { workerCheckpointJson: withContainmentReviewState(job.workerCheckpointJson, nextState, { phase: "containment-review" }) });
    return { changedRows: 0, analysis: job.analysisJson, decision: "keep-separate" as const };
  }
  const rows = toReviewRows(await getAllImportRows(input.importId));
  const changedRows = rows.filter(row => row.cleanedValues[proposal.column] === proposal.containedValue);
  if (!changedRows.length) throw new Error("Those values have already changed, so this review item can no longer be merged.");
  changedRows.forEach(row => {
    row.cleanedValues[proposal.column] = proposal.containingValue;
    row.changes.push({ column: proposal.column, from: proposal.containedValue, to: proposal.containingValue, reason: "Merged after user-confirmed containment review" });
    row.rowSignature = signatureFor(row.cleanedValues);
  });
  await persistReviewRows(input.importId, changedRows);
  nextState = {
    proposals: state.proposals.map(candidate => {
      if (candidate.id === proposal.id) return { ...candidate, status: "merged" };
      if (candidate.status === "pending" && candidate.column === proposal.column && candidate.containedValue === proposal.containedValue) return { ...candidate, status: "superseded" };
      return candidate;
    }),
  };
  await updateKpiImport(input.importId, { status: "analyzing", workerCheckpointJson: withContainmentReviewState(job.workerCheckpointJson, nextState, { phase: "containment-review-merge" }) });
  const analysis = await recalculateFromStoredRows(input.importId, profiles);
  return { changedRows: changedRows.length, analysis, decision: "merge" as const };
}

export async function repairDeprecatedAutomaticAbbreviationMerges(importId: string) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  const profiles = asArray<ColumnProfile>(job.columnsJson);
  if (!profiles.length) return false;
  const rows = toReviewRows(await getAllImportRows(importId));
  const reverted = revertDeprecatedAutomaticAbbreviationChanges(rows);
  if (!reverted.length) return false;
  await persistReviewRows(importId, reverted);
  await recalculateFromStoredRows(importId, profiles);
  return true;
}

export async function refreshKpiImportCleaningSummary(importId: string) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  const profiles = asArray<ColumnProfile>(job.columnsJson);
  const metric = findMetric(profiles);
  if (!profiles.length || !metric) return false;
  const rows = toReviewRows(await getAllImportRows(importId));
  const currency = displayCurrencyForRows(rows, metric, job.analysisJson);
  const nextSummary = logsFromStats(
    storedWorkerStats(rows, job.usableRowCount ?? 0),
    metric,
    currency,
    categoryReconciliationStats(rows, profiles),
  );
  if (JSON.stringify(job.cleaningSummaryJson) === JSON.stringify(nextSummary)) return false;
  await updateKpiImport(importId, { cleaningSummaryJson: nextSummary });
  return true;
}

export async function recalculateKpiImport(importId: string) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  const profiles = asArray<ColumnProfile>(job.columnsJson);
  if (!profiles.length) throw new Error("The import has no stored column profile to recalculate.");
  await updateKpiImport(importId, { status: "analyzing", errorMessage: null, workerCheckpointJson: withContainmentReviewState(job.workerCheckpointJson, containmentReviewState(job.workerCheckpointJson), { phase: "review-recalculation" }) });
  return recalculateFromStoredRows(importId, profiles);
}

export async function setKpiImportCurrency(importId: string, currencyCode: string) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  const code = normaliseCurrencyCode(currencyCode);
  if (!code) throw new Error("Choose a valid ISO 4217 currency code.");
  const current = asRecord(job.analysisJson);
  if (!current.metric || !current.dateColumn) throw new Error("This import does not yet have a complete analysis.");
  const analysis = { ...current, currencyCode: code, currencySymbol: currencySymbolForCode(code), currencySource: "manual" } as KpiAnalysis;
  const existingSummary = asArray<Record<string, unknown>>(job.cleaningSummaryJson).filter(item => item.key !== "currency");
  existingSummary.splice(1, 0, { key: "currency", title: "Display currency", detail: `${code} was selected manually for display. Values are not converted.`, count: 1, severity: "success" });
  await updateKpiImport(importId, { analysisJson: analysis, cleaningSummaryJson: existingSummary });
  return analysis;
}

export async function selectKpiImportMetric(importId: string, metricName: string) {
  const job = await getKpiImport(importId);
  if (!job) throw new Error("Import job was not found.");
  const profiles = asArray<ColumnProfile>(job.columnsJson);
  if (!profiles.length) throw new Error("The import has no stored column profile to update.");
  const selectedProfiles = applyMetricSelection(profiles, metricName);
  await updateKpiImport(importId, { status: "analyzing", columnsJson: selectedProfiles, errorMessage: null, workerCheckpointJson: withContainmentReviewState(job.workerCheckpointJson, containmentReviewState(job.workerCheckpointJson), { phase: "kpi-selection", metricName }) });
  const analysis = await recalculateFromStoredRows(importId, selectedProfiles);
  return { analysis, profiles: selectedProfiles };
}

export async function processNextQueuedImport() {
  const job = await claimNextQueuedImport();
  if (!job) return null;
  try { await processKpiImport(job.id, { claimed: true }); return job.id; }
  catch (error) {
    await updateKpiImport(job.id, { status: "failed", errorMessage: publicImportFailureMessage(error), completedAt: new Date() });
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
  applyMetricSelection,
  analysisFromAggregates,
  displayCurrencyForRows,
  parseDate,
  parseExcelSerialDate,
  parseUnixTimestamp,
  cleanRow,
  applyFuzzyCategoryReview,
  detectContainmentReviewProposals,
  revertDeprecatedAutomaticAbbreviationChanges,
  repairDeprecatedAutomaticAbbreviationMerges,
  applyPossibleDuplicateReview,
  logsFromStats,
  categoryReconciliationStats,
  storedWorkerStats,
  profilingDetail,
  profilingFailureMessage,
  publicImportFailureMessage,
  signatureFor,
};

if (process.env.KPI_IMPORT_WORKER_MODE === "1") runWorker().catch(error => { console.error(error); process.exit(1); });
