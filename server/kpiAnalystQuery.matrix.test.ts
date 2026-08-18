import { describe, expect, it } from "vitest";
import type { ColumnProfile, KpiAnalysis } from "../shared/kpiEngine";
import { answerPeterQuery, planPeterQuestion, type PeterAggregate, type PeterImportRow } from "./kpiAnalystQuery";

const profiles: ColumnProfile[] = [
  { name: "date", kind: "date", confidence: 100, nonEmptyCount: 4, validCount: 4 },
  { name: "total_laid_off", kind: "number", confidence: 100, nonEmptyCount: 4, validCount: 4 },
  { name: "Country", kind: "category", confidence: 100, nonEmptyCount: 4, validCount: 4 },
  { name: "Stage", kind: "category", confidence: 100, nonEmptyCount: 4, validCount: 4 },
  { name: "Location", kind: "category", confidence: 100, nonEmptyCount: 4, validCount: 4 },
  { name: "Industry", kind: "category", confidence: 100, nonEmptyCount: 4, validCount: 4 },
  { name: "Company", kind: "identifier", confidence: 100, nonEmptyCount: 4, validCount: 4 },
];

const rows: PeterImportRow[] = [
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-01", total_laid_off: 100, Country: "United States", Stage: "Post IPO", Location: "SF Bay Area", Industry: "Transportation", Company: "Alpha Transit" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-01", total_laid_off: 50, Country: "United States", Stage: "Post IPO", Location: "SF Bay Area", Industry: "Transportation", Company: "Alpha Transit" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-02", total_laid_off: 80, Country: "Canada", Stage: "Acquired", Location: "Toronto", Industry: "Retail", Company: "Beta Retail" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-02", total_laid_off: 20, Country: "Canada", Stage: "Acquired", Location: "Toronto", Industry: "Retail", Company: "Beta Retail" } },
];

const analysis: KpiAnalysis = {
  metric: "total_laid_off",
  metricLabel: "Layoffs",
  currencySymbol: "",
  dateColumn: "date",
  previousPeriod: "2023-02",
  currentPeriod: "2023-03",
  previousTotal: 180,
  currentTotal: 70,
  change: -110,
  changePercent: -61.1,
  excludedMetricRows: 0,
  trend: [{ period: "2023-02", total: 180 }, { period: "2023-03", total: 70 }],
  confidence: 90,
  summary: "Layoffs decreased from February 2023 to March 2023.",
  totalRowsUsed: 4,
  causes: [
    { id: "country-us", dimension: "Country", value: "United States", previousValue: 100, currentValue: 50, impact: -50, shareOfChange: 0.45, confidence: 80, counterfactual: 120, trend: [] },
    { id: "stage-post-ipo", dimension: "Stage", value: "Post IPO", previousValue: 100, currentValue: 50, impact: -50, shareOfChange: 0.45, confidence: 80, counterfactual: 120, trend: [] },
    { id: "stage-acquired", dimension: "Stage", value: "Acquired", previousValue: 80, currentValue: 20, impact: -60, shareOfChange: 0.55, confidence: 84, counterfactual: 130, trend: [] },
    { id: "location-sf", dimension: "Location", value: "SF Bay Area", previousValue: 100, currentValue: 50, impact: -50, shareOfChange: 0.45, confidence: 80, counterfactual: 120, trend: [] },
    { id: "industry-transportation", dimension: "Industry", value: "Transportation", previousValue: 100, currentValue: 50, impact: -50, shareOfChange: 0.45, confidence: 80, counterfactual: 120, trend: [] },
  ],
};

const aggregates = (): PeterAggregate[] => {
  const totals = new Map<string, PeterAggregate>();
  rows.forEach(row => {
    const values = row.cleanedValues as Record<string, unknown>;
    const period = String(values.date).slice(0, 7);
    const metric = Number(values.total_laid_off);
    profiles.filter(profile => profile.kind === "category" || profile.kind === "identifier").forEach(profile => {
      const segment = String(values[profile.name]);
      const key = `${period}\u0000${profile.name}\u0000${segment}`;
      const current = totals.get(key) ?? { metricColumn: "total_laid_off", period, dimension: profile.name, segment, metricTotal: 0, recordCount: 0 };
      current.metricTotal = Number(current.metricTotal) + metric;
      current.recordCount = Number(current.recordCount) + 1;
      totals.set(key, current);
    });
  });
  return Array.from(totals.values());
};

const ask = (question: string) => {
  const aggregateRows = aggregates();
  let plan = planPeterQuestion(question, analysis, profiles, aggregateRows);
  if (plan.needsRows) plan = planPeterQuestion(question, analysis, profiles, aggregateRows, rows);
  return answerPeterQuery({ question, analysis, profiles, aggregates: aggregateRows, rows: plan.needsRows ? rows : undefined, plan });
};

const drivers = analysis.causes.map(cause => ({ dimension: cause.dimension, value: cause.value, counterfactual: cause.counterfactual }));

const questionCases = (driver: (typeof drivers)[number]) => [
  {
    label: "why",
    question: `Why did ${driver.value} change?`,
    verify: (result: ReturnType<typeof ask>) => result.plan.intent === "explain" && result.plan.dimension === driver.dimension && result.plan.entity === driver.value && result.answer.includes(`${driver.dimension}: ${driver.value}`),
  },
  {
    label: "companies within",
    question: `Which companies changed most within ${driver.value}?`,
    verify: (result: ReturnType<typeof ask>) => result.plan.intent === "drilldown" && result.plan.scope?.dimension === driver.dimension && result.plan.scope?.value === driver.value && result.answer.includes(`Within ${driver.dimension}: ${driver.value}`),
  },
  {
    label: "counterfactual",
    question: `What if ${driver.value} stayed flat?`,
    verify: (result: ReturnType<typeof ask>) => result.plan.intent === "counterfactual" && result.plan.dimension === driver.dimension && result.plan.entity === driver.value && result.answer.includes(driver.counterfactual.toLocaleString()) && result.answer.includes(`${driver.dimension}: ${driver.value}`),
  },
  {
    label: "overlap",
    question: `Which factors overlap with ${driver.value}?`,
    verify: (result: ReturnType<typeof ask>) => result.plan.intent === "overlap" && result.plan.dimension === driver.dimension && result.plan.entity === driver.value && result.answer.includes(`${driver.dimension}: ${driver.value}`),
  },
  {
    label: "top N in dimension",
    question: `What are the top 3 ${driver.dimension} values by layoffs?`,
    verify: (result: ReturnType<typeof ask>) => result.plan.intent === "top_n" && result.plan.dimension === driver.dimension && result.evidence.items.every(item => item.dimension === driver.dimension),
  },
  {
    label: "highest in dimension",
    question: `Which ${driver.dimension} had the most layoffs?`,
    verify: (result: ReturnType<typeof ask>) => result.plan.intent === "top_n" && result.plan.dimension === driver.dimension && result.evidence.items.length >= 1 && result.evidence.items.every(item => item.dimension === driver.dimension),
  },
];

describe("Ask Peter displayed-driver quality matrix", () => {
  it("refuses a manually mismatched Post IPO counterfactual plan instead of substituting United States", () => {
    const question = "What would total layoff be if Post IPO stayed flat?";
    const aggregateRows = aggregates();
    const correctPlan = planPeterQuestion(question, analysis, profiles, aggregateRows, rows);
    const mismatchedPlan = { ...correctPlan, dimension: "Country", entity: "United States" };
    const result = answerPeterQuery({ question, analysis, profiles, aggregates: aggregateRows, rows, plan: mismatchedPlan });

    expect(result.answer).toContain("identified Stage: Post IPO");
    expect(result.answer).toContain("will not substitute a different segment");
    expect(result.answer).not.toContain("Country: United States had stayed");
  });

  it.each(drivers.flatMap(driver => questionCases(driver).map(questionCase => ({ driver, ...questionCase }))))("binds $label question to $driver.dimension: $driver.value", ({ driver, label, question, verify }) => {
    const result = ask(question);

    expect(verify(result), `${label} failed for ${driver.dimension}: ${driver.value}. Answer: ${result.answer}`).toBe(true);
  });
});
