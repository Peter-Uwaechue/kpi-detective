export type ColumnKind = "date" | "number" | "category" | "identifier" | "unknown";

export type ColumnProfile = {
  name: string;
  kind: ColumnKind;
  confidence: number;
  nonEmptyCount: number;
  validCount: number;
  ambiguous?: boolean;
  datePreference?: "day-first" | "month-first" | "ambiguous";
};

export type CellChange = {
  column: string;
  from: string;
  to: string;
  reason: string;
};

export type DataIssue = {
  type: "possible-duplicate" | "outlier" | "invalid-number" | "ambiguous-date" | "missing";
  column?: string;
  message: string;
};

export type CleanedRow = {
  id: string;
  rowNumber: number;
  values: Record<string, string | number | null>;
  changes: CellChange[];
  issues: DataIssue[];
  excluded: boolean;
  exclusionReason?: string;
  possibleDuplicate: boolean;
};

export type CleaningLog = {
  key: string;
  title: string;
  detail: string;
  count: number;
  severity: "success" | "info" | "warning";
};

export type CleanedDataset = {
  columns: ColumnProfile[];
  rows: CleanedRow[];
  logs: CleaningLog[];
  sourceRowCount: number;
  warnings: string[];
};

export type TrendPoint = {
  period: string;
  total: number;
};

export type CauseCard = {
  id: string;
  dimension: string;
  value: string;
  impact: number;
  previousValue: number;
  currentValue: number;
  confidence: number;
  shareOfChange: number;
  counterfactual: number;
  trend: TrendPoint[];
};

export type OutlierSensitivity = {
  outlierRows: number;
  baselinePrimary: Pick<CauseCard, "dimension" | "value" | "impact"> | null;
  outlierExcludedPrimary: Pick<CauseCard, "dimension" | "value" | "impact"> | null;
  baselinePrimaryImpactWithoutOutliers: number;
  outlierImpactOnBaselinePrimary: number;
  /** Explicit outlier-excluded comparison basis used by displayed driver cards. */
  outlierExcludedPreviousTotal?: number;
  outlierExcludedCurrentTotal?: number;
  outlierExcludedChange?: number;
  outlierExcludedChangePercent?: number;
  outlierExcludedRows?: number;
  explanationChanged: boolean;
};

export type KpiAnalysis = {
  metric: string;
  metricLabel: string;
  currencySymbol: string;
  /** ISO 4217 display currency; optional for analyses saved before currency selection existed. */
  currencyCode?: string;
  /** Whether the display currency was detected from source values, defaulted, or explicitly selected. */
  currencySource?: "detected" | "default" | "manual";
  dateColumn: string;
  previousPeriod: string;
  currentPeriod: string;
  previousTotal: number;
  currentTotal: number;
  change: number;
  changePercent: number;
  totalRowsUsed: number;
  excludedMetricRows: number;
  trend: TrendPoint[];
  causes: CauseCard[];
  /** Factors moving opposite to the overall KPI change; shown separately as offsets. */
  offsettingCauses?: CauseCard[];
  confidence: number;
  summary: string;
  outlierSensitivity?: OutlierSensitivity;
};

export type QuestionAnswer = {
  answer: string;
  confidence: number;
  supportingValue?: number;
};

const MISSING_VALUES = new Set(["", "-", "n/a", "na", "null", "none", "undefined", "(blank)"]);
const REVENUE_TERMS = ["revenue", "sales", "amount", "total", "value", "gmv", "income", "turnover", "net"];
const DATE_TERMS = ["date", "day", "time", "month", "week", "created", "ordered", "purchased", "transaction"];
const ID_TERMS = ["id", "identifier", "order", "invoice", "transaction", "reference", "sku", "code"];
const CATEGORY_TERMS = ["region", "state", "city", "location", "product", "category", "channel", "customer", "client", "segment", "store", "department", "brand", "type"];

const cellText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return String(value).replace(/\u00a0/g, " ").trim();
};

const isMissing = (value: unknown) => MISSING_VALUES.has(cellText(value).toLowerCase());

const titleCase = (value: string) => value
  .toLocaleLowerCase()
  .replace(/\b[a-z]/g, character => character.toLocaleUpperCase());

const normaliseText = (value: string) => value
  .trim()
  .replace(/\s+/g, " ")
  .replace(/[._-]+/g, " ")
  .trim()
  .toLocaleLowerCase();

const toIsoDate = (year: number, month: number, day: number) => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return candidate.toISOString().slice(0, 10);
};

const monthIndex = (value: string) => {
  const month = value.slice(0, 3).toLowerCase();
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(month) + 1;
};

const parseNumeric = (input: unknown): number | null => {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const original = cellText(input);
  if (isMissing(original)) return null;
  let value = original.replace(/[\s]/g, "").replace(/[₦$€£¥₹]/g, "");
  const parenthesesNegative = /^\(.*\)$/.test(value);
  if (parenthesesNegative) value = value.slice(1, -1);
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) value = value.replace(/\./g, "").replace(",", ".");
    else value = value.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const trailing = value.length - lastComma - 1;
    value = trailing === 3 && value.split(",").length > 2 ? value.replace(/,/g, "") : value.replace(",", ".");
  }
  const number = Number(value);
  return Number.isFinite(number) ? (parenthesesNegative ? -Math.abs(number) : number) : null;
};

const slashParts = (value: string) => {
  const match = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:\s+.*)?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return { first, second, year };
};

const inferDatePreference = (values: unknown[]): "day-first" | "month-first" | "ambiguous" => {
  let dayFirstSignals = 0;
  let monthFirstSignals = 0;
  values.forEach(value => {
    const parts = slashParts(cellText(value));
    if (!parts) return;
    if (parts.first > 12 && parts.second <= 12) dayFirstSignals += 1;
    if (parts.second > 12 && parts.first <= 12) monthFirstSignals += 1;
  });
  if (dayFirstSignals > monthFirstSignals) return "day-first";
  if (monthFirstSignals > dayFirstSignals) return "month-first";
  return "ambiguous";
};

const parseDate = (input: unknown, preference: "day-first" | "month-first" | "ambiguous") => {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString().slice(0, 10);
  const value = cellText(input);
  if (isMissing(value)) return null;
  const isoMatch = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const parts = slashParts(value);
  if (parts) {
    const dayFirst = preference !== "month-first";
    return toIsoDate(parts.year, dayFirst ? parts.second : parts.first, dayFirst ? parts.first : parts.second);
  }
  const named = value.match(/^(\d{1,2})\s*[- ]\s*([A-Za-z]{3,9})\s*[-, ]\s*(\d{2,4})/)
    ?? value.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})/);
  if (named) {
    const day = Number(named[1].match(/^\d/) ? named[1] : named[2]);
    const month = monthIndex(named[1].match(/^\d/) ? named[2] : named[1]);
    let year = Number(named[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return month ? toIsoDate(year, month, day) : null;
  }
  const looksLikeDate = (/\d{4}/.test(value) && /[T\s/.-]/.test(value)) || (/^[A-Za-z]{3,9}\s+\d{1,2}/.test(value) && /\d{2,4}/.test(value));
  if (!looksLikeDate) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const headerScore = (name: string, terms: string[]) => {
  const normalised = normaliseText(name);
  return terms.reduce((score, term) => score + (normalised === term ? 2 : normalised.includes(term) ? 1 : 0), 0);
};

const isIdentifierName = (name: string) => {
  const normalised = normaliseText(name);
  return ID_TERMS.some(term => normalised === term || normalised.endsWith(` ${term}`) || normalised.startsWith(`${term} `));
};

const classifyColumn = (name: string, values: unknown[]): ColumnProfile => {
  const nonEmpty = values.filter(value => !isMissing(value));
  if (!nonEmpty.length) return { name, kind: "unknown", confidence: 0, nonEmptyCount: 0, validCount: 0 };
  const preference = inferDatePreference(nonEmpty);
  const numericCount = nonEmpty.filter(value => parseNumeric(value) !== null).length;
  const dateCount = nonEmpty.filter(value => parseDate(value, preference) !== null).length;
  const distinct = new Set(nonEmpty.map(value => cellText(value))).size;
  const numericRate = numericCount / nonEmpty.length;
  const dateRate = dateCount / nonEmpty.length;
  const dateHint = headerScore(name, DATE_TERMS);
  const revenueHint = headerScore(name, REVENUE_TERMS);

  if (dateRate >= 0.72 && (dateHint > 0 || numericRate < 0.98)) {
    return { name, kind: "date", confidence: Math.round(Math.min(99, dateRate * 80 + dateHint * 8)), nonEmptyCount: nonEmpty.length, validCount: dateCount, ambiguous: preference === "ambiguous", datePreference: preference };
  }
  if (numericRate >= 0.72) {
    return { name, kind: "number", confidence: Math.round(Math.min(99, numericRate * 84 + revenueHint * 5)), nonEmptyCount: nonEmpty.length, validCount: numericCount };
  }
  if (isIdentifierName(name) || (distinct / nonEmpty.length > 0.92 && nonEmpty.length > 7 && /\d/.test(nonEmpty.map(cellText).join("")))) {
    return { name, kind: "identifier", confidence: 82, nonEmptyCount: nonEmpty.length, validCount: nonEmpty.length };
  }
  if (distinct / nonEmpty.length <= 0.9 || headerScore(name, CATEGORY_TERMS) > 0) {
    return { name, kind: "category", confidence: Math.round(Math.min(95, 70 + headerScore(name, CATEGORY_TERMS) * 6)), nonEmptyCount: nonEmpty.length, validCount: nonEmpty.length };
  }
  return { name, kind: "unknown", confidence: 48, nonEmptyCount: nonEmpty.length, validCount: nonEmpty.length, ambiguous: true };
};

const levenshtein = (first: string, second: string) => {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let i = 1; i <= first.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= second.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (first[i - 1] === second[j - 1] ? 0 : 1));
    }
    for (let j = 0; j < previous.length; j += 1) previous[j] = current[j];
  }
  return previous[second.length];
};

const similarity = (first: string, second: string) => {
  const length = Math.max(first.length, second.length);
  return length ? 1 - levenshtein(first, second) / length : 1;
};

const knownRegionAlias = (value: string, column: string) => {
  if (!/(region|state|city|location|area)/.test(normaliseText(column))) return null;
  const compact = normaliseText(value).replace(/\s/g, "");
  if (["ny", "nyc", "newyork"].includes(compact)) return "New York";
  if (["la", "losangeles"].includes(compact)) return "Los Angeles";
  if (["uk", "unitedkingdom", "greatbritain"].includes(compact)) return "United Kingdom";
  return null;
};

const compactNumber = (value: number, maximumFractionDigits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);

export const formatMetric = (value: number, symbol = "") => `${symbol}${compactNumber(value, 0)}`;

const periodLabel = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
};

export const longReadablePeriod = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
};

const findCurrencySymbol = (rawRows: Record<string, unknown>[], column: string) => {
  const sample = rawRows.map(row => cellText(row[column])).find(value => /[₦$€£¥₹]/.test(value));
  return sample?.match(/[₦$€£¥₹]/)?.[0] ?? "";
};

const sortedUnique = (values: string[]) => Array.from(new Set(values)).sort((first, second) => first.localeCompare(second));

export function cleanDataset(rawRows: Record<string, unknown>[]): CleanedDataset {
  const columns = sortedUnique(rawRows.flatMap(row => Object.keys(row))).map(name => classifyColumn(name, rawRows.map(row => row[name])));
  const warnings: string[] = [];
  columns.filter(column => column.kind === "unknown").forEach(column => warnings.push(`${column.name} could not be confidently classified and was left unchanged.`));
  columns.filter(column => column.kind === "date" && column.ambiguous).forEach(column => warnings.push(`${column.name} contains ambiguous dates. KPI Detective applied a day-first interpretation and marked this for review.`));

  const rows: CleanedRow[] = rawRows.map((source, index) => {
    const values: Record<string, string | number | null> = {};
    const changes: CellChange[] = [];
    const issues: DataIssue[] = [];
    columns.forEach(column => {
      const raw = cellText(source[column.name]);
      if (isMissing(raw)) {
        values[column.name] = null;
        if (column.kind === "number") issues.push({ type: "missing", column: column.name, message: "Missing numeric value; excluded only if this column is used as the KPI." });
        if (raw) changes.push({ column: column.name, from: raw, to: "", reason: "Recognised missing-value placeholder" });
        return;
      }
      if (column.kind === "date") {
        const parsed = parseDate(raw, column.datePreference ?? "ambiguous");
        values[column.name] = parsed ?? raw;
        if (parsed && parsed !== raw) changes.push({ column: column.name, from: raw, to: parsed, reason: "Standardised date" });
        if (!parsed) issues.push({ type: "ambiguous-date", column: column.name, message: `Could not standardise “${raw}” as a date.` });
        return;
      }
      if (column.kind === "number") {
        const parsed = parseNumeric(raw);
        values[column.name] = parsed ?? null;
        if (parsed === null) {
          issues.push({ type: "invalid-number", column: column.name, message: `“${raw}” was not recognised as a number.` });
        } else if (String(parsed) !== raw.replace(/,/g, "")) {
          changes.push({ column: column.name, from: raw, to: String(parsed), reason: "Standardised numeric or currency value" });
        }
        return;
      }
      if (column.kind === "category") {
        const normalised = normaliseText(raw);
        values[column.name] = normalised ? titleCase(normalised) : "Unknown";
        if (values[column.name] !== raw) changes.push({ column: column.name, from: raw, to: String(values[column.name]), reason: "Normalised category case and spacing" });
        return;
      }
      values[column.name] = raw;
    });
    return { id: `row-${index + 1}`, rowNumber: index + 1, values, changes, issues, excluded: false, possibleDuplicate: false };
  });

  columns.filter(column => column.kind === "category").forEach(column => {
    const canonicalByNormalised = new Map<string, string>();
    const frequency = new Map<string, number>();
    rows.forEach(row => {
      const value = row.values[column.name];
      if (typeof value !== "string" || value === "Unknown") return;
      frequency.set(value, (frequency.get(value) ?? 0) + 1);
    });
    Array.from(frequency.entries()).sort((first, second) => second[1] - first[1]).forEach(([value]) => {
      const key = normaliseText(value);
      if (!canonicalByNormalised.has(key)) canonicalByNormalised.set(key, value);
    });
    rows.forEach(row => {
      const current = row.values[column.name];
      if (typeof current !== "string" || current === "Unknown") return;
      const alias = knownRegionAlias(current, column.name);
      const same = canonicalByNormalised.get(normaliseText(current));
      const candidates = Array.from(frequency.keys()).filter(candidate => candidate.length >= 4 && current.length >= 4 && candidate !== current);
      const fuzzy = candidates
        .map(candidate => ({ candidate, score: similarity(normaliseText(candidate), normaliseText(current)) }))
        .sort((first, second) => second.score - first.score)[0];
      const replacement = alias ?? same ?? (fuzzy && fuzzy.score >= 0.93 ? fuzzy.candidate : null);
      if (replacement && replacement !== current) {
        row.values[column.name] = replacement;
        row.changes.push({ column: column.name, from: current, to: replacement, reason: alias ? "Matched a high-confidence regional alias" : "Merged a high-confidence near-duplicate category" });
      }
    });
  });

  const rawSignatures = new Map<string, CleanedRow>();
  rows.forEach(row => {
    const source = rawRows[row.rowNumber - 1];
    const signature = JSON.stringify(columns.map(column => cellText(source[column.name])));
    const first = rawSignatures.get(signature);
    if (first) {
      row.excluded = true;
      row.exclusionReason = `Exact duplicate of row ${first.rowNumber}`;
    } else {
      rawSignatures.set(signature, row);
    }
  });

  const dateColumn = columns.find(column => column.kind === "date")?.name;
  const numericColumn = [...columns].filter(column => column.kind === "number").sort((first, second) => headerScore(second.name, REVENUE_TERMS) - headerScore(first.name, REVENUE_TERMS))[0]?.name;
  const customerColumn = columns.find(column => /customer|client/.test(normaliseText(column.name)))?.name;
  if (dateColumn && numericColumn && customerColumn) {
    const signatures = new Map<string, CleanedRow>();
    rows.filter(row => !row.excluded).forEach(row => {
      const date = row.values[dateColumn];
      const amount = row.values[numericColumn];
      const customer = row.values[customerColumn];
      if (typeof date !== "string" || typeof amount !== "number" || typeof customer !== "string") return;
      const key = `${normaliseText(customer)}|${date}|${amount}`;
      const first = signatures.get(key);
      if (first) {
        row.possibleDuplicate = true;
        first.possibleDuplicate = true;
        const message = `Shares customer, date, and amount with row ${first.rowNumber}; kept for your confirmation.`;
        row.issues.push({ type: "possible-duplicate", message });
        first.issues.push({ type: "possible-duplicate", message: `Shares customer, date, and amount with row ${row.rowNumber}; kept for your confirmation.` });
      } else signatures.set(key, row);
    });
  }

  columns.filter(column => column.kind === "number").forEach(column => {
    const values = rows.filter(row => !row.excluded).map(row => row.values[column.name]).filter((value): value is number => typeof value === "number").sort((first, second) => first - second);
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
      const value = row.values[column.name];
      if (typeof value === "number" && (value < lower || value > upper)) {
        row.issues.push({ type: "outlier", column: column.name, message: `${compactNumber(value, 2)} is outside the IQR review range (${compactNumber(lower, 2)} to ${compactNumber(upper, 2)}).` });
      }
    });
  });

  const countChanges = (predicate: (change: CellChange) => boolean) => rows.flatMap(row => row.changes).filter(predicate).length;
  const outlierByColumn = rows.flatMap(row => row.issues)
    .filter(issue => issue.type === "outlier" && issue.column)
    .reduce<Record<string, number>>((counts, issue) => {
      const column = issue.column!;
      counts[column] = (counts[column] ?? 0) + 1;
      return counts;
    }, {});
  const outlierDetail = Object.entries(outlierByColumn)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([column, count]) => `${column}: ${count.toLocaleString()}`);
  const removedDuplicates = rows.filter(row => row.excluded).length;
  const possibleDuplicates = rows.filter(row => row.possibleDuplicate).length;
  const outliers = rows.filter(row => row.issues.some(issue => issue.type === "outlier")).length;
  const invalidValues = rows.flatMap(row => row.issues).filter(issue => issue.type === "invalid-number").length;
  const missingNumericValues = rows.flatMap(row => row.issues).filter(issue => issue.type === "missing").length;
  const logs: CleaningLog[] = [
    { key: "duplicates", title: "Exact duplicates removed", detail: removedDuplicates ? "Excluded only byte-for-byte duplicate source rows; probable duplicates remain for review." : "No exact duplicate source rows found.", count: removedDuplicates, severity: removedDuplicates ? "success" : "info" },
    { key: "possible", title: "Possible duplicates flagged", detail: "Rows with the same customer, date, and amount were kept rather than deleted.", count: possibleDuplicates, severity: possibleDuplicates ? "warning" : "info" },
    { key: "dates", title: "Dates standardised", detail: "Converted recognisable values to ISO format (YYYY-MM-DD).", count: countChanges(change => change.reason === "Standardised date"), severity: "success" },
    { key: "numbers", title: "Numbers and currencies standardised", detail: "Removed presentation formatting while preserving numeric values.", count: countChanges(change => change.reason === "Standardised numeric or currency value"), severity: "success" },
    { key: "categories", title: "Category values standardised", detail: "Applied high-confidence case, spacing, and category normalisation only.", count: countChanges(change => change.reason.includes("category") || change.reason.includes("alias") || change.reason.includes("case")), severity: "success" },
    { key: "invalid", title: "Invalid numeric values flagged", detail: "These values are excluded only when the affected field is chosen as the headline KPI.", count: invalidValues, severity: invalidValues ? "warning" : "info" },
    { key: "missing", title: "Missing numeric values flagged", detail: "These rows stay visible and are excluded only from the affected KPI calculation.", count: missingNumericValues, severity: missingNumericValues ? "warning" : "info" },
    { key: "outliers", title: "Outliers flagged for review", detail: outlierDetail.length ? `Potentially unusual values were retained and never removed automatically. Triggered by ${outlierDetail.join("; ")}; ${outliers.toLocaleString()} unique row${outliers === 1 ? "" : "s"} flagged in total.` : "Potentially unusual values were retained and never removed automatically.", count: outliers, severity: outliers ? "warning" : "info" },
  ];
  return { columns, rows, logs, sourceRowCount: rawRows.length, warnings };
}

const isDateSupportNumeric = (column: ColumnProfile, dateAvailable: boolean) => dateAvailable && /(^|\s)(year|month|day|week|quarter|fiscal)(\s|$)/.test(normaliseText(column.name));

const comparePeriods = (dataset: CleanedDataset) => {
  const date = dataset.columns.find(column => column.kind === "date");
  const metric = [...dataset.columns].filter(column => column.kind === "number" && !isDateSupportNumeric(column, Boolean(date))).sort((first, second) => {
    const score = (column: ColumnProfile) => headerScore(column.name, REVENUE_TERMS) * 20 + column.validCount / Math.max(1, column.nonEmptyCount) * 10;
    return score(second) - score(first);
  })[0];
  if (!date) throw new Error("We could not find a reliable date column. Add a date column to compare periods.");
  if (!metric) throw new Error("We could not find a reliable numeric column to use as the headline KPI.");
  const periods = sortedUnique(dataset.rows.filter(row => !row.excluded).map(row => row.values[date.name]).filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)).map(value => value.slice(0, 7)));
  if (periods.length < 2) throw new Error("We need at least two months of dated records before we can explain a KPI change.");
  return { date, metric, previousPeriod: periods[periods.length - 2], currentPeriod: periods[periods.length - 1], periods };
};

const sumMetric = (rows: CleanedRow[], metric: string) => rows.reduce((sum, row) => sum + (typeof row.values[metric] === "number" ? row.values[metric] as number : 0), 0);

const causeTrend = (rows: CleanedRow[], dateColumn: string, metric: string, periods: string[], dimension: string, value: string) => periods.slice(-8).map(period => ({
  period,
  total: sumMetric(rows.filter(row => row.values[dateColumn] === undefined ? false : typeof row.values[dateColumn] === "string" && String(row.values[dateColumn]).slice(0, 7) === period && String(row.values[dimension] ?? "Unknown") === value), metric),
}));

export function investigateKpi(dataset: CleanedDataset, sourceRows: Record<string, unknown>[] = []): KpiAnalysis {
  const { date, metric, previousPeriod, currentPeriod, periods } = comparePeriods(dataset);
  const eligible = dataset.rows.filter(row => !row.excluded && typeof row.values[date.name] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(row.values[date.name])));
  const used = eligible.filter(row => typeof row.values[metric.name] === "number");
  const previousRows = used.filter(row => String(row.values[date.name]).slice(0, 7) === previousPeriod);
  const currentRows = used.filter(row => String(row.values[date.name]).slice(0, 7) === currentPeriod);
  if (!previousRows.length || !currentRows.length) throw new Error("The most recent two months do not contain valid values for the selected KPI.");
  const previousTotal = sumMetric(previousRows, metric.name);
  const currentTotal = sumMetric(currentRows, metric.name);
  const change = currentTotal - previousTotal;
  const changePercent = previousTotal ? change / previousTotal * 100 : 0;
  const categories = dataset.columns.filter(column => column.kind === "category" || (column.kind === "identifier" && /customer|client/.test(normaliseText(column.name))));
  const causeRows: CauseCard[] = [];
  categories.forEach(column => {
    const values = new Set([...previousRows, ...currentRows].map(row => String(row.values[column.name] ?? "Unknown")));
    values.forEach(value => {
      const previousValue = sumMetric(previousRows.filter(row => String(row.values[column.name] ?? "Unknown") === value), metric.name);
      const currentValue = sumMetric(currentRows.filter(row => String(row.values[column.name] ?? "Unknown") === value), metric.name);
      const impact = currentValue - previousValue;
      if (Math.abs(impact) < 0.000001) return;
      const shareOfChange = Math.min(1, Math.abs(impact) / Math.max(Math.abs(change), 1));
      const sampleSize = previousRows.filter(row => String(row.values[column.name] ?? "Unknown") === value).length + currentRows.filter(row => String(row.values[column.name] ?? "Unknown") === value).length;
      const confidence = Math.round(Math.min(96, 54 + shareOfChange * 34 + Math.min(10, sampleSize * 1.5)));
      causeRows.push({
        id: `${column.name}-${value}`,
        dimension: column.name,
        value,
        impact,
        previousValue,
        currentValue,
        confidence,
        shareOfChange,
        counterfactual: currentTotal - impact,
        trend: causeTrend(used, date.name, metric.name, periods, column.name, value),
      });
    });
  });
  const materiality = Math.max(Math.abs(change) * 0.08, 0.01);
  const materialCauses = causeRows.filter(cause => Math.abs(cause.impact) >= materiality);
  const directionAlignedCauses = materialCauses.filter(cause => change === 0 || Math.sign(cause.impact) === Math.sign(change));
  const dimensionPriority = (dimension: string) => {
    const name = normaliseText(dimension);
    if (/product|category|sku|brand/.test(name)) return 0;
    if (/region|state|city|location/.test(name)) return 1;
    if (/customer|client/.test(name)) return 2;
    if (/channel|source/.test(name)) return 3;
    return 4;
  };
  const causes = (directionAlignedCauses.length ? directionAlignedCauses : materialCauses)
    .sort((first, second) => Math.abs(second.impact) - Math.abs(first.impact) || dimensionPriority(first.dimension) - dimensionPriority(second.dimension) || first.value.localeCompare(second.value))
    .slice(0, 5);
  const offsettingCauses = change === 0 ? [] : materialCauses
    .filter(cause => Math.sign(cause.impact) !== Math.sign(change))
    .sort((first, second) => Math.abs(second.impact) - Math.abs(first.impact) || dimensionPriority(first.dimension) - dimensionPriority(second.dimension) || first.value.localeCompare(second.value))
    .slice(0, 3);
  const weightedConfidence = causes.length ? Math.round(causes.reduce((sum, cause) => sum + cause.confidence * cause.shareOfChange, 0) / causes.reduce((sum, cause) => sum + cause.shareOfChange, 0)) : 50;
  const currencySymbol = sourceRows.length ? findCurrencySymbol(sourceRows, metric.name) : "";
  const name = metric.name.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
  const direction = change >= 0 ? "increased" : "decreased";
  const leading = causes.slice(0, 2);
  const factors = leading.length ? leading.map(cause => `${cause.dimension}: ${cause.value}`).join(" and ") : "a broad shift across the dataset";
  const counterfactual = leading[0]?.counterfactual ?? currentTotal;
  const counterfactualSentence = leading[0]
    ? `If ${leading[0].dimension}: ${leading[0].value} had stayed at its prior-month level, ${name.toLowerCase()} would have been about ${formatMetric(counterfactual, currencySymbol)}.`
    : `No individual category met the materiality threshold for a separate counterfactual.`;
  const summary = `${name} ${direction} ${Math.abs(changePercent).toFixed(1)}% from ${formatMetric(previousTotal, currencySymbol)} in ${longReadablePeriod(previousPeriod)} to ${formatMetric(currentTotal, currencySymbol)} in ${longReadablePeriod(currentPeriod)}. The largest contributors were ${factors}. We are ${weightedConfidence}% confident in this explanation. ${counterfactualSentence}`;
  return {
    metric: metric.name,
    metricLabel: name,
    currencySymbol,
    dateColumn: date.name,
    previousPeriod,
    currentPeriod,
    previousTotal,
    currentTotal,
    change,
    changePercent,
    totalRowsUsed: used.length,
    excludedMetricRows: eligible.length - used.length,
    trend: periods.slice(-12).map(period => ({ period, total: sumMetric(used.filter(row => String(row.values[date.name]).slice(0, 7) === period), metric.name) })),
    causes,
    offsettingCauses,
    confidence: weightedConfidence,
    summary,
  };
}

const topCustomerWithin = (dataset: CleanedDataset, analysis: KpiAnalysis, dimension?: CauseCard) => {
  const customer = dataset.columns.find(column => /customer|client/.test(normaliseText(column.name)));
  if (!customer) return null;
  const eligible = dataset.rows.filter(row => !row.excluded && typeof row.values[analysis.metric] === "number" && [analysis.previousPeriod, analysis.currentPeriod].includes(String(row.values[analysis.dateColumn]).slice(0, 7)) && (!dimension || String(row.values[dimension.dimension] ?? "Unknown") === dimension.value));
  const names = new Set(eligible.map(row => String(row.values[customer.name] ?? "Unknown")));
  const entries = Array.from(names).map(name => {
    const previous = sumMetric(eligible.filter(row => String(row.values[customer.name] ?? "Unknown") === name && String(row.values[analysis.dateColumn]).slice(0, 7) === analysis.previousPeriod), analysis.metric);
    const current = sumMetric(eligible.filter(row => String(row.values[customer.name] ?? "Unknown") === name && String(row.values[analysis.dateColumn]).slice(0, 7) === analysis.currentPeriod), analysis.metric);
    return { name, impact: current - previous };
  }).sort((first, second) => first.impact - second.impact);
  return entries[0] ?? null;
};

export function answerDataQuestion(question: string, dataset: CleanedDataset, analysis: KpiAnalysis): QuestionAnswer {
  const text = normaliseText(question);
  const referencedCause = analysis.causes.find(cause => text.includes(normaliseText(cause.value)) || text.includes(normaliseText(cause.dimension)));
  if (/customer|client/.test(text)) {
    const customer = topCustomerWithin(dataset, analysis, referencedCause);
    if (customer) {
      const scope = referencedCause ? ` within ${referencedCause.dimension}: ${referencedCause.value}` : " overall";
      return { answer: `${customer.name} had the largest negative change${scope}, contributing ${formatMetric(Math.abs(customer.impact), analysis.currencySymbol)} of decline between ${longReadablePeriod(analysis.previousPeriod)} and ${longReadablePeriod(analysis.currentPeriod)}.`, confidence: referencedCause?.confidence ?? analysis.confidence, supportingValue: customer.impact };
    }
  }
  if (/what if|without|flat|recover|recovering/.test(text) && referencedCause) {
    return { answer: `If ${referencedCause.dimension}: ${referencedCause.value} had stayed at its ${longReadablePeriod(analysis.previousPeriod)} level, ${analysis.metricLabel.toLowerCase()} would have been approximately ${formatMetric(referencedCause.counterfactual, analysis.currencySymbol)} in ${longReadablePeriod(analysis.currentPeriod)}—${formatMetric(Math.abs(referencedCause.impact), analysis.currencySymbol)} higher than observed.`, confidence: referencedCause.confidence, supportingValue: referencedCause.counterfactual };
  }
  if (/why|cause|drop|decline|increase|change/.test(text)) {
    const causes = referencedCause ? [referencedCause] : analysis.causes.slice(0, 2);
    const explanation = causes.length ? causes.map(cause => `${cause.dimension}: ${cause.value} (${cause.impact >= 0 ? "+" : "-"}${formatMetric(Math.abs(cause.impact), analysis.currencySymbol)})`).join(" and ") : "small changes spread across several dimensions";
    return { answer: `The clearest explanation is ${explanation}. These factors are measured against ${longReadablePeriod(analysis.previousPeriod)} and account for the largest part of the ${analysis.metricLabel.toLowerCase()} change in ${longReadablePeriod(analysis.currentPeriod)}.`, confidence: referencedCause?.confidence ?? analysis.confidence };
  }
  const leading = analysis.causes[0];
  return { answer: leading ? `The strongest finding is ${leading.dimension}: ${leading.value}, which changed ${analysis.metricLabel.toLowerCase()} by ${leading.impact >= 0 ? "+" : "-"}${formatMetric(Math.abs(leading.impact), analysis.currencySymbol)}. Ask me why it changed, which customer contributed, or what the KPI would have been without it.` : `I found a ${analysis.change >= 0 ? "positive" : "negative"} ${analysis.metricLabel.toLowerCase()} change, but no individual category met the materiality threshold for a confident driver.`, confidence: leading?.confidence ?? analysis.confidence };
}

export const createDemoRows = (): Record<string, unknown>[] => {
  const products = ["Shirts", "Shoes", "Trousers"];
  const regions = ["East Coast", "West Coast", "Midwest"];
  const channels = ["Online", "Retail", "Partner"];
  const customers = ["Apex Co", "Brooklyn House", "Cedar & Co", "Dune Retail", "Ember Works", "Fifth Avenue"];
  const rows: Record<string, unknown>[] = [];
  for (let month = 1; month <= 6; month += 1) {
    products.forEach((product, productIndex) => regions.forEach((region, regionIndex) => {
      const decline = month === 6 && region === "East Coast" && product === "Shirts" ? 4000 : 0;
      const amount = 4200 + month * 185 + productIndex * 330 + regionIndex * 240 - decline;
      rows.push({
        "Order Date": `${String(month).padStart(2, "0")}/15/2026`,
        Revenue: `$${amount.toLocaleString("en-US")}.00`,
        Product: product,
        Region: region === "East Coast" && month === 2 ? "East coast " : region,
        Channel: channels[productIndex],
        Customer: customers[regionIndex],
        "Order ID": `KD-${month}${productIndex}${regionIndex}`,
      });
    }));
  }
  rows.push({ ...rows[4] });
  rows.push({ "Order Date": "03/18/2026", Revenue: "$28,000.00", Product: "Shoes", Region: "West Coast", Channel: "Online", Customer: "Review Required", "Order ID": "KD-OUTLIER" });
  rows.push({ "Order Date": "06/22/2026", Revenue: "N/A", Product: "Trousers", Region: "Midwest", Channel: "Retail", Customer: "Unknown", "Order ID": "KD-MISSING" });
  return rows;
};

export const cleanRowsForExport = (dataset: CleanedDataset) => dataset.rows.map(row => ({ ...row.values, "__status": row.excluded ? row.exclusionReason ?? "Excluded" : row.possibleDuplicate ? "Possible duplicate" : "Included" }));

export const readablePeriod = periodLabel;
