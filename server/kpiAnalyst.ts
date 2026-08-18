import { longReadablePeriod, type CauseCard, type ColumnProfile, type KpiAnalysis } from "../shared/kpiEngine";

export type AnalystContext = {
  metricLabel: string;
  summary: string;
  previousPeriod: string;
  currentPeriod: string;
  currencySymbol: string;
  confidence: number;
  causes: Array<Pick<CauseCard, "dimension" | "value" | "impact" | "counterfactual" | "confidence">>;
};

type ImportAnalystRow = {
  cleanedValues: unknown;
  excluded: boolean;
  isOutlier: boolean;
};

type PeriodValues = { previous: number; current: number; impact: number };
type FactorChange = PeriodValues & { dimension: string; value: string; confidence: number; counterfactual: number };
type CompanyChange = PeriodValues & { name: string };
type OverlapChange = PeriodValues & { dimension: string; value: string };
type DateChange = PeriodValues & { previousDate: string; currentDate: string };

export type ImportAnalystEvidence = {
  focus: FactorChange | null;
  factors: FactorChange[];
  countryFactors: FactorChange[];
  countryRequest: boolean;
  asksForAlternativeCountry: boolean;
  rankRequest: number | null;
  rankedDimension: string | null;
  dimensionRankedFactors: FactorChange[];
  focusValues: PeriodValues | null;
  companies: CompanyChange[];
  overlaps: OverlapChange[];
  dates: DateChange[];
  companyColumn: string | null;
  matchingRows: number;
  excludesOutliers: boolean;
  availableDimensions: string[];
};

type ComparisonRow = { values: Record<string, unknown>; metric: number; period: string };

const normalise = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
const formatMetric = (value: number, symbol: string) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${symbol}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const plainMetric = (value: number, symbol: string) => `${symbol}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const ordinal = (value: number) => {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th"}`;
};

const valuesOf = (row: ImportAnalystRow) => row.cleanedValues && typeof row.cleanedValues === "object" && !Array.isArray(row.cleanedValues) ? row.cleanedValues as Record<string, unknown> : {};
const numericValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const periodFor = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 7) : null;
const dateFor = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const isQuestionAboutAction = (text: string) => /\bfix|priority|prioritise|prioritize|focus|next step|what should|what do i\b/.test(text);
const isCountryDimension = (dimension: string) => /country|nation|market/i.test(dimension);
const isUnknown = (value: string) => !value || /^(unknown|n\/a|na|null|none|undefined|\(blank\))$/i.test(value);

const rankFromQuestion = (text: string) => {
  const topNumeric = text.match(/\btop\s+(\d+)\b/i);
  if (topNumeric) return Number(topNumeric[1]);
  const numeric = text.match(/(?:#|number\s*)?(\d+)(?:st|nd|rd|th)?\s+(?:biggest|largest|top|highest|factor|driver)/i);
  if (numeric) return Number(numeric[1]);
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const word = Object.entries(words).find(([label]) => new RegExp(`\\b(?:top\\s+)?${label}\\s+(?:biggest|largest|top|highest|factor|driver)`, "i").test(text));
  return word ? word[1] : null;
};

const dimensionMentionedIn = (text: string, dimension: string) => {
  const label = normalise(dimension);
  const singular = label.replace(/ies$/, "y").replace(/s$/, "");
  const plural = singular.endsWith("y") ? `${singular.slice(0, -1)}ies` : `${singular}s`;
  return text.includes(label) || text.includes(singular) || text.includes(plural) || (isCountryDimension(dimension) && /\bcountry|countries|nation|nations\b/.test(text));
};

const sumPeriods = (rows: ComparisonRow[], predicate: (row: ComparisonRow) => boolean, previousPeriod: string, currentPeriod: string): PeriodValues => {
  let previous = 0;
  let current = 0;
  rows.forEach(row => {
    if (!predicate(row)) return;
    if (row.period === previousPeriod) previous += row.metric;
    if (row.period === currentPeriod) current += row.metric;
  });
  return { previous, current, impact: current - previous };
};

const eligibleDimensions = (profiles: ColumnProfile[] | undefined, rows: ComparisonRow[], analysis: KpiAnalysis) => {
  const profileDimensions = (profiles ?? []).filter(profile => profile.name !== analysis.metric && profile.name !== analysis.dateColumn && (profile.kind === "category" || (profile.kind === "identifier" && /customer|client/i.test(profile.name)))).map(profile => profile.name);
  if (profileDimensions.length) return profileDimensions;
  const knownDimension = /country|nation|market|region|state|city|location|stage|industry|sector|department|channel|category|product|segment|customer|client/i;
  return Array.from(new Set(rows.flatMap(row => Object.keys(row.values)))).filter(name => name !== analysis.metric && name !== analysis.dateColumn && knownDimension.test(name));
};

const buildFactors = (rows: ComparisonRow[], dimensions: string[], analysis: KpiAnalysis): FactorChange[] => {
  const totals = new Map<string, { dimension: string; value: string; previous: number; current: number }>();
  rows.forEach(row => dimensions.forEach(dimension => {
    const value = String(row.values[dimension] ?? "").trim();
    if (isUnknown(value)) return;
    const key = `${dimension}\u0000${value}`;
    const item = totals.get(key) ?? { dimension, value, previous: 0, current: 0 };
    if (row.period === analysis.previousPeriod) item.previous += row.metric;
    if (row.period === analysis.currentPeriod) item.current += row.metric;
    totals.set(key, item);
  }));
  return Array.from(totals.values()).map(item => {
    const impact = item.current - item.previous;
    const contribution = Math.abs(analysis.change) ? Math.min(1, Math.abs(impact) / Math.abs(analysis.change)) : 0;
    return { ...item, impact, confidence: Math.round(Math.min(99, 65 + contribution * 34)), counterfactual: analysis.currentTotal - impact };
  }).filter(item => item.impact !== 0).sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact) || left.dimension.localeCompare(right.dimension) || left.value.localeCompare(right.value));
};

const factorMentionedIn = (text: string, factor: FactorChange) => text.includes(normalise(factor.value));
const currentTotalOrder = (left: FactorChange, right: FactorChange) => right.current - left.current || Math.abs(right.impact) - Math.abs(left.impact) || left.value.localeCompare(right.value);

export const fallbackAnalystAnswer = (question: string, context: AnalystContext) => {
  const text = normalise(question);
  const previous = longReadablePeriod(context.previousPeriod);
  const current = longReadablePeriod(context.currentPeriod);
  const causes = [...context.causes].sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact));
  const referenced = causes.find(cause => text.includes(normalise(cause.value)) || text.includes(normalise(cause.dimension)));
  const focus = referenced ?? causes.find(cause => cause.impact < 0) ?? causes[0];
  if (focus && /what if|stayed flat|flat/.test(text)) {
    return `If ${focus.dimension}: ${focus.value} had stayed at its ${previous} level, ${context.metricLabel.toLowerCase()} would have been about ${plainMetric(focus.counterfactual, context.currencySymbol)} in ${current}. Its measured impact was ${formatMetric(focus.impact, context.currencySymbol)}.`;
  }
  if (focus && isQuestionAboutAction(text)) {
    return `Start with ${focus.dimension}: ${focus.value}. It is the largest measured ${focus.impact < 0 ? "downside" : "movement"} in the current comparison, at ${formatMetric(focus.impact, context.currencySymbol)}. The available aggregate context cannot identify company or date-level causes, so review that segment’s underlying records next rather than treating this as a company-wide diagnosis.`;
  }
  if (referenced && /why|cause|drop|decline|increase|change/.test(text)) {
    return `${referenced.dimension}: ${referenced.value} changed by ${formatMetric(referenced.impact, context.currencySymbol)} between ${previous} and ${current}. The aggregate context confirms it is a material driver at ${referenced.confidence}% confidence, but does not contain company, date, or overlapping-segment evidence needed to explain the underlying operational cause.`;
  }
  if (/customer|client|company/.test(text) && !causes.some(cause => /customer|client|company/i.test(cause.dimension))) {
    return `The supplied aggregate context does not include a customer or company-level driver. ${context.summary}`;
  }
  return `I can’t answer that specific question from the available aggregate context yet. I can explain the displayed drivers, their counterfactuals, and the next action to prioritise. ${focus ? `What I found instead: ${focus.dimension}: ${focus.value} moved by ${formatMetric(focus.impact, context.currencySymbol)}.` : context.summary}`;
};

export const buildImportAnalystEvidence = (question: string, analysis: KpiAnalysis, importRows: ImportAnalystRow[], profiles?: ColumnProfile[]): ImportAnalystEvidence => {
  const excludesOutliers = Boolean(analysis.outlierSensitivity?.explanationChanged);
  const comparisonRows = importRows.flatMap(row => {
    if (row.excluded || (excludesOutliers && row.isOutlier)) return [];
    const values = valuesOf(row);
    const metric = numericValue(values[analysis.metric]);
    const period = periodFor(values[analysis.dateColumn]);
    if (metric === null || !period || ![analysis.previousPeriod, analysis.currentPeriod].includes(period)) return [];
    return [{ values, metric, period }];
  });
  const availableDimensions = eligibleDimensions(profiles, comparisonRows, analysis);
  const factors = buildFactors(comparisonRows, availableDimensions, analysis);
  const countryFactors = factors.filter(factor => isCountryDimension(factor.dimension));
  const text = normalise(question);
  const rankRequest = rankFromQuestion(text);
  const countryRequest = /\bcountry|countries|nation|nations\b/.test(text);
  const mentionedCountries = countryFactors.filter(factor => factorMentionedIn(text, factor));
  const explicitlyAsksForAlternative = /\baside\b|\bbesides\b|\bother\b|\bexcluding\b|\bexcept\b/.test(text);
  const asksForAlternativeCountry = countryRequest && mentionedCountries.length > 0 && (explicitlyAsksForAlternative || /\bafter\b/.test(text));
  const namedFactor = [...factors].sort((left, right) => right.value.length - left.value.length).find(factor => factorMentionedIn(text, factor));
  const rankedDimension = rankRequest ? availableDimensions.find(dimension => dimensionMentionedIn(text, dimension)) ?? null : null;
  const dimensionRankedFactors = rankedDimension ? factors.filter(factor => factor.dimension === rankedDimension).sort(currentTotalOrder) : [];
  const dashboardFocus = analysis.causes.map(cause => factors.find(factor => factor.dimension === cause.dimension && factor.value === cause.value)).find((factor): factor is FactorChange => Boolean(factor));
  const rankFocus = rankRequest && !rankedDimension ? factors[rankRequest - 1] ?? null : null;
  const countryFocus = countryRequest ? (asksForAlternativeCountry
    ? [...countryFactors].filter(factor => !mentionedCountries.some(mentioned => normalise(mentioned.value) === normalise(factor.value))).sort(currentTotalOrder)[0] ?? null
    : mentionedCountries[0] ?? [...countryFactors].sort(currentTotalOrder)[0] ?? null) : null;
  const focus = rankFocus ?? countryFocus ?? namedFactor ?? dashboardFocus ?? factors[0] ?? null;
  const focusRows = focus ? comparisonRows.filter(row => String(row.values[focus.dimension] ?? "Unknown") === focus.value) : [];
  const focusValues = focus ? sumPeriods(focusRows, () => true, analysis.previousPeriod, analysis.currentPeriod) : null;
  const allColumns = Array.from(new Set(focusRows.flatMap(row => Object.keys(row.values))));
  const companyColumn = allColumns.find(column => /customer|client|company|employer|organisation|organization/i.test(column)) ?? null;
  const companies = focus && companyColumn ? Array.from(new Set(focusRows.map(row => String(row.values[companyColumn] ?? "Unknown")).filter(name => !isUnknown(name)))).map(name => ({ name: name.slice(0, 120), ...sumPeriods(focusRows, row => String(row.values[companyColumn] ?? "Unknown") === name, analysis.previousPeriod, analysis.currentPeriod) })).filter(item => item.impact !== 0).sort((left, right) => focus.impact < 0 ? left.impact - right.impact : right.impact - left.impact).slice(0, 2) : [];
  const overlaps = focus ? analysis.causes.filter(cause => cause.dimension !== focus.dimension).map(cause => ({ dimension: cause.dimension, value: cause.value, ...sumPeriods(focusRows, row => String(row.values[cause.dimension] ?? "Unknown") === cause.value, analysis.previousPeriod, analysis.currentPeriod) })).filter(item => item.impact !== 0).sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact)).slice(0, 2) : [];
  const perDay = new Map<string, { previous: number; current: number }>();
  focusRows.forEach(row => {
    const date = dateFor(row.values[analysis.dateColumn]);
    if (!date) return;
    const day = date.slice(-2);
    const entry = perDay.get(day) ?? { previous: 0, current: 0 };
    if (row.period === analysis.previousPeriod) entry.previous += row.metric;
    if (row.period === analysis.currentPeriod) entry.current += row.metric;
    perDay.set(day, entry);
  });
  const dates = Array.from(perDay.entries()).map(([day, values]) => ({ ...values, impact: values.current - values.previous, previousDate: `${analysis.previousPeriod}-${day}`, currentDate: `${analysis.currentPeriod}-${day}` })).filter(item => item.impact !== 0).sort((left, right) => focus && focus.impact < 0 ? left.impact - right.impact : right.impact - left.impact).slice(0, 2);
  return { focus, factors, countryFactors, countryRequest, asksForAlternativeCountry, rankRequest, rankedDimension, dimensionRankedFactors, focusValues, companies, overlaps, dates, companyColumn, matchingRows: focusRows.length, excludesOutliers, availableDimensions };
};

const limitationMessage = (analysis: KpiAnalysis, evidence: ImportAnalystEvidence) => {
  const dimensions = evidence.availableDimensions.slice(0, 6).join(", ");
  return `I can’t answer that specific question from this import yet. I can answer questions about ${dimensions || "the detected dimensions"}, including a named country or segment, top countries or products by current-period total, the biggest factors, affected companies, dates, and overlaps. ${analysis.causes[0] ? `What I found instead: ${analysis.causes[0].dimension}: ${analysis.causes[0].value} is the leading displayed driver.` : ""}`;
};

export const answerImportQuestion = (question: string, analysis: KpiAnalysis, evidence: ImportAnalystEvidence) => {
  const text = normalise(question);
  const previous = longReadablePeriod(analysis.previousPeriod);
  const current = longReadablePeriod(analysis.currentPeriod);
  if (evidence.rankRequest && evidence.rankedDimension) {
    if (!evidence.dimensionRankedFactors.length) return `I can’t answer that specific ${evidence.rankedDimension} ranking because no measurable values were found for that dimension. ${limitationMessage(analysis, evidence)}`;
    const requestedCount = Math.min(evidence.rankRequest, evidence.dimensionRankedFactors.length);
    const listed = evidence.dimensionRankedFactors.slice(0, requestedCount).map((factor, index) => `${index + 1}. ${factor.value} — ${plainMetric(factor.current, analysis.currencySymbol)} (from ${plainMetric(factor.previous, analysis.currencySymbol)}; ${formatMetric(factor.impact, analysis.currencySymbol)} change)`).join("; ");
    const availabilityNote = evidence.rankRequest > requestedCount ? ` This import contains ${requestedCount} measurable ${evidence.rankedDimension.toLowerCase()} value${requestedCount === 1 ? "" : "s"} in the comparison.` : "";
    return `The top ${requestedCount} ${evidence.rankedDimension.toLowerCase()} by current-period ${analysis.metricLabel.toLowerCase()} in ${current} are: ${listed}.${availabilityNote} These are ranked only within ${evidence.rankedDimension}, not across unrelated dimensions.`;
  }
  if (evidence.rankRequest) {
    if (!evidence.focus || evidence.factors.length < evidence.rankRequest) return `I can’t answer that specific rank because this import has only ${evidence.factors.length} measurable factor${evidence.factors.length === 1 ? "" : "s"} across the eligible dimensions. ${limitationMessage(analysis, evidence)}`;
    const focus = evidence.focus;
    return `The ${ordinal(evidence.rankRequest)} biggest measured factor is ${focus.dimension}: ${focus.value}. It moved from ${plainMetric(focus.previous, analysis.currencySymbol)} in ${previous} to ${plainMetric(focus.current, analysis.currencySymbol)} in ${current}, an impact of ${formatMetric(focus.impact, analysis.currencySymbol)}. This rank is across individual dimension/value factors, ordered by absolute change, so overlapping factors should not be added together.`;
  }
  if (evidence.countryRequest) {
    if (!evidence.focus || !isCountryDimension(evidence.focus.dimension)) return `I can’t answer the country comparison because this import does not contain a usable country dimension. ${limitationMessage(analysis, evidence)}`;
    const focus = evidence.focus;
    const comparisonLabel = evidence.asksForAlternativeCountry ? "the highest other country" : `${focus.value}’s country-level total`;
    return `Interpreting “high numbers” as the current-period ${analysis.metricLabel.toLowerCase()} total, ${comparisonLabel} in ${current} is ${focus.value} at ${plainMetric(focus.current, analysis.currencySymbol)}. It was ${plainMetric(focus.previous, analysis.currencySymbol)} in ${previous}, a ${formatMetric(focus.impact, analysis.currencySymbol)} change. This is a country-level comparison and is independent of overlapping factors.`;
  }
  const focus = evidence.focus;
  if (!focus || !evidence.focusValues) return limitationMessage(analysis, evidence);
  const label = `${focus.dimension}: ${focus.value}`;
  const comparison = `${plainMetric(evidence.focusValues.previous, analysis.currencySymbol)} in ${previous} to ${plainMetric(evidence.focusValues.current, analysis.currencySymbol)} in ${current}`;
  const dataNote = evidence.excludesOutliers ? " IQR-flagged rows are excluded here because the sensitivity check changed the driver ranking." : "";
  const companyDetail = evidence.companies.length ? ` Within that segment, ${evidence.companies.map(company => `${company.name} (${formatMetric(company.impact, analysis.currencySymbol)})`).join(" and ")} had the largest ${focus.impact < 0 ? "negative" : "positive"} changes.` : "";
  const overlapDetail = evidence.overlaps.length ? ` The strongest overlapping displayed factor${evidence.overlaps.length > 1 ? "s were" : " was"} ${evidence.overlaps.map(overlap => `${overlap.dimension}: ${overlap.value} (${formatMetric(overlap.impact, analysis.currencySymbol)} within ${focus.value})`).join(" and ")}. These factors overlap, so their impacts should not be added together.` : "";
  const dateDetail = evidence.dates.length ? ` The largest matched day movement was ${dateLabel(evidence.dates[0].previousDate)} to ${dateLabel(evidence.dates[0].currentDate)} (${formatMetric(evidence.dates[0].impact, analysis.currencySymbol)}).` : "";
  if (isQuestionAboutAction(text)) return `Start with ${label}: it is the largest observed ${focus.impact < 0 ? "downside" : "movement"}, moving from ${comparison} (${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)}).${companyDetail}${overlapDetail}${dateDetail} The practical next step is to investigate the named segment and its overlapping factors before making a company-wide change.${dataNote}`;
  if (/customer|client|company/.test(text)) return evidence.companies.length ? `Within ${label}, the companies with the largest measured changes were ${evidence.companies.map(company => `${company.name} at ${formatMetric(company.impact, analysis.currencySymbol)}`).join(" and ")}. This comparison covers ${previous} to ${current}.${dataNote}` : `I could not find a usable customer, client, company, or employer field within ${label}, so I cannot name a company from this import. The segment itself changed by ${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)}.`;
  if (/date|when|day/.test(text)) return evidence.dates.length ? `For ${label}, the biggest comparable date-level shifts were ${evidence.dates.map(date => `${dateLabel(date.previousDate)} to ${dateLabel(date.currentDate)} (${formatMetric(date.impact, analysis.currencySymbol)})`).join(" and ")}. These are measured daily changes inside the driver, not a claim that one date alone caused the full KPI movement.${dataNote}` : `I could not calculate comparable date-level shifts for ${label}, but its period total moved from ${comparison}.`;
  if (/overlap|co-occur|alongside|together/.test(text)) return evidence.overlaps.length ? `Inside ${label}, ${overlapDetail.trim()}${companyDetail}${dataNote}` : `No other displayed driver has a measurable overlap with ${label} in the two comparison periods. Its own movement was ${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)}.`;
  if (/what if|stayed flat|flat|without/.test(text)) return `If ${label} had stayed at its ${previous} level, ${analysis.metricLabel.toLowerCase()} would have been about ${plainMetric(focus.counterfactual, analysis.currencySymbol)} in ${current}. That counterfactual uses the driver’s measured impact of ${formatMetric(focus.impact, analysis.currencySymbol)}.${dataNote}`;
  if (/why|cause|drop|decline|increase|change/.test(text)) return `${label} moved from ${comparison}, a ${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)} change.${companyDetail}${overlapDetail}${dateDetail} This is calculation-backed evidence from the affected rows, so it adds detail beyond the driver-card impact and confidence score.${dataNote}`;
  return limitationMessage(analysis, evidence);
};
