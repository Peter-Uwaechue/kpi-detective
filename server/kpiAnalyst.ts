import type { CauseCard, KpiAnalysis } from "../shared/kpiEngine";

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

type CompanyChange = PeriodValues & { name: string };
type OverlapChange = PeriodValues & { dimension: string; value: string };
type DateChange = PeriodValues & { previousDate: string; currentDate: string };

export type ImportAnalystEvidence = {
  focus: CauseCard | null;
  focusValues: PeriodValues | null;
  companies: CompanyChange[];
  overlaps: OverlapChange[];
  dates: DateChange[];
  companyColumn: string | null;
  matchingRows: number;
  excludesOutliers: boolean;
};

const normalise = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
const formatMetric = (value: number, symbol: string) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${symbol}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const plainMetric = (value: number, symbol: string) => `${symbol}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const valuesOf = (row: ImportAnalystRow) => (row.cleanedValues && typeof row.cleanedValues === "object" && !Array.isArray(row.cleanedValues) ? row.cleanedValues as Record<string, unknown> : {});
const numericValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const periodFor = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 7) : null;
const dateFor = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const selectFocus = (question: string, causes: CauseCard[]) => {
  const text = normalise(question);
  const referenced = causes.find(cause => text.includes(normalise(cause.value)) || text.includes(normalise(cause.dimension)));
  if (referenced) return referenced;
  const downside = causes.filter(cause => cause.impact < 0).sort((left, right) => left.impact - right.impact)[0];
  return downside ?? causes[0] ?? null;
};

const sumPeriods = (rows: Array<{ values: Record<string, unknown>; metric: number; period: string }>, predicate: (row: { values: Record<string, unknown>; metric: number; period: string }) => boolean, previousPeriod: string, currentPeriod: string): PeriodValues => {
  let previous = 0;
  let current = 0;
  rows.forEach(row => {
    if (!predicate(row)) return;
    if (row.period === previousPeriod) previous += row.metric;
    if (row.period === currentPeriod) current += row.metric;
  });
  return { previous, current, impact: current - previous };
};

const isQuestionAboutAction = (text: string) => /\bfix|priority|prioritise|prioritize|focus|next step|what should|what do i\b/.test(text);

export const fallbackAnalystAnswer = (question: string, context: AnalystContext) => {
  const text = normalise(question);
  const causes = [...context.causes].sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact));
  const referenced = causes.find(cause => text.includes(normalise(cause.value)) || text.includes(normalise(cause.dimension)));
  const focus = referenced ?? causes.find(cause => cause.impact < 0) ?? causes[0];
  if (focus && /what if|stayed flat|flat/.test(text)) {
    return `If ${focus.dimension}: ${focus.value} had stayed at its ${context.previousPeriod} level, ${context.metricLabel.toLowerCase()} would have been about ${plainMetric(focus.counterfactual, context.currencySymbol)} in ${context.currentPeriod}. Its measured impact was ${formatMetric(focus.impact, context.currencySymbol)}.`;
  }
  if (focus && isQuestionAboutAction(text)) {
    return `Start with ${focus.dimension}: ${focus.value}. It is the largest measured ${focus.impact < 0 ? "downside" : "movement"} in the current comparison, at ${formatMetric(focus.impact, context.currencySymbol)}. The available aggregate context cannot identify company or date-level causes, so review that segment’s underlying records next rather than treating this as a company-wide diagnosis.`;
  }
  if (referenced && /why|cause|drop|decline|increase|change/.test(text)) {
    return `${referenced.dimension}: ${referenced.value} changed by ${formatMetric(referenced.impact, context.currencySymbol)} between ${context.previousPeriod} and ${context.currentPeriod}. The aggregate context confirms it is a material driver at ${referenced.confidence}% confidence, but does not contain company, date, or overlapping-segment evidence needed to explain the underlying operational cause.`;
  }
  if (/customer|client|company/.test(text) && !causes.some(cause => /customer|client|company/i.test(cause.dimension))) {
    return `The supplied aggregate context does not include a customer or company-level driver. ${context.summary}`;
  }
  return focus ? `The next evidence-backed question is why ${focus.dimension}: ${focus.value} moved by ${formatMetric(focus.impact, context.currencySymbol)}. Ask about that driver, its overlapping factors, or the action to prioritise.` : context.summary;
};

export const buildImportAnalystEvidence = (question: string, analysis: KpiAnalysis, importRows: ImportAnalystRow[]): ImportAnalystEvidence => {
  const focus = selectFocus(question, analysis.causes);
  if (!focus) return { focus: null, focusValues: null, companies: [], overlaps: [], dates: [], companyColumn: null, matchingRows: 0, excludesOutliers: false };

  const excludesOutliers = Boolean(analysis.outlierSensitivity?.explanationChanged);
  const comparisonRows = importRows.flatMap(row => {
    if (row.excluded || (excludesOutliers && row.isOutlier)) return [];
    const values = valuesOf(row);
    const metric = numericValue(values[analysis.metric]);
    const period = periodFor(values[analysis.dateColumn]);
    if (metric === null || !period || ![analysis.previousPeriod, analysis.currentPeriod].includes(period)) return [];
    return [{ values, metric, period }];
  });
  const focusRows = comparisonRows.filter(row => String(row.values[focus.dimension] ?? "Unknown") === focus.value);
  const focusValues = sumPeriods(focusRows, () => true, analysis.previousPeriod, analysis.currentPeriod);
  const allColumns = Array.from(new Set(focusRows.flatMap(row => Object.keys(row.values))));
  const companyColumn = allColumns.find(column => /customer|client|company|employer|organisation|organization/i.test(column)) ?? null;

  const companies = companyColumn ? Array.from(new Set(focusRows.map(row => String(row.values[companyColumn] ?? "Unknown")).filter(name => name && name !== "Unknown"))).map(name => {
    const values = sumPeriods(focusRows, row => String(row.values[companyColumn] ?? "Unknown") === name, analysis.previousPeriod, analysis.currentPeriod);
    return { name: name.slice(0, 120), ...values };
  }).filter(item => item.impact !== 0).sort((left, right) => focus.impact < 0 ? left.impact - right.impact : right.impact - left.impact).slice(0, 2) : [];

  const overlaps = analysis.causes.filter(cause => cause.dimension !== focus.dimension).map(cause => {
    const values = sumPeriods(focusRows, row => String(row.values[cause.dimension] ?? "Unknown") === cause.value, analysis.previousPeriod, analysis.currentPeriod);
    return { dimension: cause.dimension, value: cause.value, ...values };
  }).filter(item => item.impact !== 0).sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact)).slice(0, 2);

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
  const dates = Array.from(perDay.entries()).map(([day, values]) => ({
    ...values,
    impact: values.current - values.previous,
    previousDate: `${analysis.previousPeriod}-${day}`,
    currentDate: `${analysis.currentPeriod}-${day}`,
  })).filter(item => item.impact !== 0).sort((left, right) => focus.impact < 0 ? left.impact - right.impact : right.impact - left.impact).slice(0, 2);

  return { focus, focusValues, companies, overlaps, dates, companyColumn, matchingRows: focusRows.length, excludesOutliers };
};

export const answerImportQuestion = (question: string, analysis: KpiAnalysis, evidence: ImportAnalystEvidence) => {
  const text = normalise(question);
  const focus = evidence.focus;
  if (!focus || !evidence.focusValues) return fallbackAnalystAnswer(question, { metricLabel: analysis.metricLabel, summary: analysis.summary, previousPeriod: analysis.previousPeriod, currentPeriod: analysis.currentPeriod, currencySymbol: analysis.currencySymbol, confidence: analysis.confidence, causes: analysis.causes });
  const label = `${focus.dimension}: ${focus.value}`;
  const comparison = `${plainMetric(evidence.focusValues.previous, analysis.currencySymbol)} in ${analysis.previousPeriod} to ${plainMetric(evidence.focusValues.current, analysis.currencySymbol)} in ${analysis.currentPeriod}`;
  const dataNote = evidence.excludesOutliers ? " IQR-flagged rows are excluded here because the sensitivity check changed the driver ranking." : "";
  const companyDetail = evidence.companies.length ? ` Within that segment, ${evidence.companies.map(company => `${company.name} (${formatMetric(company.impact, analysis.currencySymbol)})`).join(" and ")} had the largest ${focus.impact < 0 ? "negative" : "positive"} changes.` : "";
  const overlapDetail = evidence.overlaps.length ? ` The strongest overlapping displayed factor${evidence.overlaps.length > 1 ? "s were" : " was"} ${evidence.overlaps.map(overlap => `${overlap.dimension}: ${overlap.value} (${formatMetric(overlap.impact, analysis.currencySymbol)} within ${focus.value})`).join(" and ")}. These factors overlap, so their impacts should not be added together.` : "";
  const dateDetail = evidence.dates.length ? ` The largest matched day movement was ${dateLabel(evidence.dates[0].previousDate)} to ${dateLabel(evidence.dates[0].currentDate)} (${formatMetric(evidence.dates[0].impact, analysis.currencySymbol)}).` : "";

  if (isQuestionAboutAction(text)) {
    return `Start with ${label}: it is the largest observed ${focus.impact < 0 ? "downside" : "movement"}, moving from ${comparison} (${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)}).${companyDetail}${overlapDetail}${dateDetail} The practical next step is to investigate the named segment and its overlapping factors before making a company-wide change.${dataNote}`;
  }
  if (/customer|client|company/.test(text)) {
    return evidence.companies.length ? `Within ${label}, the companies with the largest measured changes were ${evidence.companies.map(company => `${company.name} at ${formatMetric(company.impact, analysis.currencySymbol)}`).join(" and ")}. This comparison covers ${analysis.previousPeriod} to ${analysis.currentPeriod}.${dataNote}` : `I could not find a usable customer, client, company, or employer field within ${label}, so I cannot name a company from this import. The segment itself changed by ${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)}.`;
  }
  if (/date|when|day/.test(text)) {
    return evidence.dates.length ? `For ${label}, the biggest comparable date-level shifts were ${evidence.dates.map(date => `${dateLabel(date.previousDate)} to ${dateLabel(date.currentDate)} (${formatMetric(date.impact, analysis.currencySymbol)})`).join(" and ")}. These are measured daily changes inside the driver, not a claim that one date alone caused the full KPI movement.${dataNote}` : `I could not calculate comparable date-level shifts for ${label}, but its period total moved from ${comparison}.`;
  }
  if (/overlap|co-occur|alongside|together/.test(text)) {
    return evidence.overlaps.length ? `Inside ${label}, ${overlapDetail.trim()}${companyDetail}${dataNote}` : `No other displayed driver has a measurable overlap with ${label} in the two comparison periods. Its own movement was ${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)}.`;
  }
  if (/what if|stayed flat|flat|without/.test(text)) {
    return `If ${label} had stayed at its ${analysis.previousPeriod} level, ${analysis.metricLabel.toLowerCase()} would have been about ${plainMetric(focus.counterfactual, analysis.currencySymbol)} in ${analysis.currentPeriod}. That counterfactual uses the driver’s measured impact of ${formatMetric(focus.impact, analysis.currencySymbol)}.${dataNote}`;
  }
  if (/why|cause|drop|decline|increase|change/.test(text)) {
    return `${label} moved from ${comparison}, a ${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)} change.${companyDetail}${overlapDetail}${dateDetail} This is calculation-backed evidence from the affected rows, so it adds detail beyond the driver-card impact and confidence score.${dataNote}`;
  }
  return `The most actionable finding is ${label}, which moved by ${formatMetric(evidence.focusValues.impact, analysis.currencySymbol)} from ${analysis.previousPeriod} to ${analysis.currentPeriod}.${companyDetail}${overlapDetail} Ask why it changed, which companies were involved, the largest dates, or what to fix first.`;
};
