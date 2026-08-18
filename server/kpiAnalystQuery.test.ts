import { describe, expect, it } from "vitest";
import type { ColumnProfile, KpiAnalysis } from "../shared/kpiEngine";
import { answerPeterQuery, isAnswerablePeterSuggestion, peterSuggestionSignature, planPeterQuestion, type PeterAggregate, type PeterImportRow } from "./kpiAnalystQuery";

const analysis: KpiAnalysis = {
  metric: "total_laid_off",
  metricLabel: "Layoffs",
  currencySymbol: "",
  dateColumn: "date",
  previousPeriod: "2023-02",
  currentPeriod: "2023-03",
  previousTotal: 2000,
  currentTotal: 1400,
  change: -600,
  changePercent: -30,
  excludedMetricRows: 0,
  trend: [{ period: "2023-02", total: 2000 }, { period: "2023-03", total: 1400 }],
  confidence: 91,
  summary: "Layoffs decreased from February 2023 to March 2023.",
  totalRowsUsed: 8,
  causes: [
    { id: "country-us", dimension: "Country", value: "United States", impact: -400, previousValue: 1000, currentValue: 600, confidence: 91, shareOfChange: 0.67, counterfactual: 1800, trend: [] },
    { id: "product-saas", dimension: "Product", value: "SaaS", impact: -400, previousValue: 1000, currentValue: 600, confidence: 89, shareOfChange: 0.67, counterfactual: 1800, trend: [] },
  ],
};

const profiles: ColumnProfile[] = [
  { name: "date", kind: "date", confidence: 100, nonEmptyCount: 8, validCount: 8 },
  { name: "total_laid_off", kind: "number", confidence: 100, nonEmptyCount: 8, validCount: 8 },
  { name: "Country", kind: "category", confidence: 100, nonEmptyCount: 8, validCount: 8 },
  { name: "Product", kind: "category", confidence: 100, nonEmptyCount: 8, validCount: 8 },
  { name: "Region", kind: "category", confidence: 100, nonEmptyCount: 8, validCount: 8 },
  { name: "Company", kind: "identifier", confidence: 100, nonEmptyCount: 8, validCount: 8 },
];

const rows: PeterImportRow[] = [
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-03", total_laid_off: 700, Country: "United States", Product: "SaaS", Region: "West", Company: "Atlas Labs" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-13", total_laid_off: 300, Country: "United States", Product: "SaaS", Region: "West", Company: "Beacon Inc" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-06", total_laid_off: 800, Country: "Canada", Product: "Commerce", Region: "North", Company: "North Co" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-09", total_laid_off: 200, Country: "India", Product: "Fintech", Region: "South", Company: "East Co" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-03", total_laid_off: 200, Country: "United States", Product: "SaaS", Region: "West", Company: "Atlas Labs" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-13", total_laid_off: 400, Country: "United States", Product: "SaaS", Region: "West", Company: "Beacon Inc" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-06", total_laid_off: 500, Country: "Canada", Product: "Commerce", Region: "North", Company: "North Co" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-09", total_laid_off: 300, Country: "India", Product: "Fintech", Region: "South", Company: "East Co" } },
];

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
  const rowEvidence = plan.needsRows ? rows : undefined;
  if (rowEvidence) plan = planPeterQuestion(question, analysis, profiles, aggregateRows, rowEvidence);
  return answerPeterQuery({ question, analysis, profiles, aggregates: aggregateRows, rows: rowEvidence, plan });
};

describe("Ask Peter full-cleaned-data query service", () => {
  it("answers the other-country question with a genuinely different country and explicit exclusion evidence", () => {
    const result = ask("Why country number was high after the United States?");

    expect(result.plan.intent).toBe("compare");
    expect(result.answer).toContain("Excluding United States");
    expect(result.answer).toContain("Canada");
    expect(result.answer).not.toContain("is United States at");
    expect(result.evidence.exclusionApplied).toEqual(["United States"]);
    expect(result.evidence.items[0]?.value).toBe("Canada");
  });

  it("returns a country-only top-five list rather than an unrelated factor", () => {
    const result = ask("What are the top 5 highest layoffs country?");

    expect(result.plan.intent).toBe("top_n");
    expect(result.plan.dimension).toBe("Country");
    expect(result.answer).toContain("United States");
    expect(result.answer).toContain("Canada");
    expect(result.answer).toContain("India");
    expect(result.answer).toContain("only within Country");
    expect(result.evidence.items.every(item => item.dimension === "Country")).toBe(true);
    expect(result.answer).not.toContain("Product: SaaS");
  });

  it("retains a cross-dimension ranked-factor answer when no dimension is requested", () => {
    const result = ask("What is the 6th biggest factor that affected layoffs?");

    expect(result.plan.intent).toBe("factor_rank");
    expect(result.answer).toContain("6th biggest measured factor");
    expect(result.answer).toContain("February 2023");
  });

  it("explains an unscoped headline change using overall drivers instead of assuming a country", () => {
    const result = ask("Why did total laid off drop?");

    expect(result.plan.intent).toBe("overall_explain");
    expect(result.answer).toContain("Overall, layoffs decreased from 2,000 in February 2023 to 1,400 in March 2023");
    expect(result.answer).toContain("The largest measured top-level drivers were");
    expect(result.answer).toContain("Country: United States");
    expect(result.answer).toContain("Product: SaaS");
    expect(result.answer).toContain("can overlap and are not expected to sum");
    expect(result.evidence.items).toHaveLength(2);
    expect(result.evidence.source).toBe("aggregates");
  });

  it("returns a distinct-company count for the requested month rather than a ranking", () => {
    const result = ask("How many companies laid off workers in March?");

    expect(result.plan.intent).toBe("aggregate");
    expect(result.plan.aggregation).toBe("distinct_count");
    expect(result.plan.period).toBe("2023-03");
    expect(result.answer).toBe("4 companies had a positive recorded layoffs value in March 2023. This is a distinct-entity count from the cleaned rows, not a ranking of company-level changes.");
    expect(result.evidence.dimension).toBe("Company");
    expect(result.evidence.items[0]?.current).toBe(4);
    expect(result.evidence.source).toBe("cleaned_rows");
  });

  it("keeps the suggested why and counterfactual question behavior on the new service", () => {
    const why = ask("Why did United States change?");
    const whatIf = ask("What if United States had stayed flat?");

    expect(why.plan.intent).toBe("explain");
    expect(why.answer).toContain("United States moved");
    expect(why.evidence.source).toBe("cleaned_rows");
    expect(whatIf.plan.intent).toBe("counterfactual");
    expect(whatIf.answer).toContain("If Country: United States had stayed");
    expect(whatIf.answer).toContain("higher than the observed current-period total");
  });

  it("grounds a recommendation in data-backed negative dimension movements", () => {
    const result = ask("What should I fix first?");

    expect(result.plan.intent).toBe("recommend");
    expect(result.answer).toContain("Based on the cleaned data, prioritise");
    expect(result.answer).toContain("United States");
    expect(result.answer).toContain("not an external business diagnosis");
  });

  it("gives equivalent recommendation phrasings the same suggestion signature", () => {
    const fix = ask("What do I fix in the company?");
    const investigate = ask("What should I investigate next?");

    expect(fix.plan.intent).toBe("recommend");
    expect(investigate.plan.intent).toBe("recommend");
    expect(peterSuggestionSignature(fix)).toBe(peterSuggestionSignature(investigate));
  });

  it("calculates date-level movement as a distinct cleaned-row query", () => {
    const result = ask("Which dates moved most within United States?");

    expect(result.plan.intent).toBe("date_detail");
    expect(result.answer).toContain("Within Country: United States, the biggest comparable date-level movements were");
    expect(result.answer).toContain("February 3, 2023 → March 3, 2023");
    expect(result.evidence.dimension).toBe("Date");
    expect(result.evidence.source).toBe("cleaned_rows");
    expect(isAnswerablePeterSuggestion(result)).toBe(true);
  });

  it("calculates overlapping factors as a distinct cleaned-row query", () => {
    const result = ask("Which factors overlap with United States?");

    expect(result.plan.intent).toBe("overlap");
    expect(result.answer).toContain("Within Country: United States, the largest overlapping factors were");
    expect(result.answer).toContain("Product: SaaS");
    expect(result.answer).toContain("should not be added together");
    expect(result.evidence.source).toBe("cleaned_rows");
  });

  it("asks for clarification when an overlap request has no resolvable scope", () => {
    const result = ask("Which factors overlap?");

    expect(result.plan.intent).toBe("unsupported");
    expect(result.answer).toContain("I’m not fully sure what you’re asking — could you rephrase?");
    expect(result.answer).not.toContain("United States moved");
  });

  it("uses cleaned rows for a scoped company drilldown", () => {
    const result = ask("Which companies changed most within United States?");

    expect(result.plan.intent).toBe("drilldown");
    expect(result.plan.scope).toEqual({ dimension: "Country", value: "United States" });
    expect(result.answer).toContain("Atlas Labs");
    expect(result.answer).toContain("Beacon Inc");
    expect(result.evidence.source).toBe("cleaned_rows");
  });

  it("resolves a named company from cleaned-row evidence rather than precomputed driver cards", () => {
    const result = ask("Why did company Atlas Labs change?");

    expect(result.plan.intent).toBe("explain");
    expect(result.answer).toContain("Company: Atlas Labs moved");
    expect(result.evidence.source).toBe("cleaned_rows");
  });

  it("does not mark clarification responses as answerable suggestions", () => {
    const result = ask("Which factors overlap?");

    expect(isAnswerablePeterSuggestion(result)).toBe(false);
  });

  it("asks for clarification for an unrecognised free-typed request instead of selecting a nearest driver", () => {
    const result = ask("Tell me something useful about it");

    expect(result.plan.intent).toBe("unsupported");
    expect(result.answer).toContain("I’m not fully sure what you’re asking — could you rephrase?");
    expect(result.answer).not.toContain("United States moved");
    expect(result.answer).not.toContain("Based on the cleaned data, prioritise");
  });

  it("blocks a manually mismatched plan before any unrelated answer is rendered", () => {
    const aggregateRows = aggregates();
    const mismatchedPlan = { ...planPeterQuestion("Why did United States change?", analysis, profiles, aggregateRows), intent: "explain" as const };
    const result = answerPeterQuery({ question: "What are the top 5 countries?", analysis, profiles, aggregates: aggregateRows, rows, plan: mismatchedPlan });

    expect(result.answer).toContain("I’m not fully sure what you’re asking — could you rephrase?");
    expect(result.answer).toContain("asks for a ranking");
    expect(result.evidence.items).toHaveLength(0);
  });

  it("returns an honest limitation for a company not present in the import", () => {
    const result = ask("Why did company Missing Co change?");

    expect(result.plan.intent).toBe("unsupported");
    expect(result.answer).toContain("I can’t answer that specific question");
    expect(result.answer).not.toContain("United States moved");
  });

  it("returns an honest limitation for external or predictive questions", () => {
    const result = ask("What will layoffs be next quarter?");

    expect(result.plan.intent).toBe("unsupported");
    expect(result.answer).toContain("I’m not fully sure what you’re asking — could you rephrase?");
  });
});
