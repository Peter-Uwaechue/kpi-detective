import { describe, expect, it } from "vitest";
import { longReadablePeriod, type ColumnProfile, type KpiAnalysis } from "../shared/kpiEngine";
import { answerImportQuestion, buildImportAnalystEvidence, fallbackAnalystAnswer } from "./kpiAnalyst";

const analysis: KpiAnalysis = {
  metric: "total_laid_off",
  metricLabel: "Layoffs",
  currencySymbol: "",
  dateColumn: "date",
  previousPeriod: "2023-02",
  currentPeriod: "2023-03",
  previousTotal: 4200,
  currentTotal: 2500,
  change: -1700,
  changePercent: -40.5,
  totalRowsUsed: 8,
  excludedMetricRows: 0,
  trend: [],
  confidence: 82,
  summary: "Layoffs decreased from 4,200 in February to 2,500 in March.",
  causes: [
    { id: "country-United States", dimension: "Country", value: "United States", impact: -1200, previousValue: 3200, currentValue: 2000, confidence: 90, shareOfChange: 0.71, counterfactual: 3700, trend: [] },
    { id: "stage-Post IPO", dimension: "Stage", value: "Post-IPO", impact: -900, previousValue: 2600, currentValue: 1700, confidence: 82, shareOfChange: 0.53, counterfactual: 3400, trend: [] },
    { id: "location-SF Bay Area", dimension: "Location", value: "SF Bay Area", impact: -700, previousValue: 1900, currentValue: 1200, confidence: 76, shareOfChange: 0.41, counterfactual: 3200, trend: [] },
  ],
};

const profiles: ColumnProfile[] = [
  { name: "date", kind: "date", confidence: 100, nonEmptyCount: 12, validCount: 12 },
  { name: "total_laid_off", kind: "number", confidence: 100, nonEmptyCount: 12, validCount: 12 },
  { name: "Country", kind: "category", confidence: 100, nonEmptyCount: 12, validCount: 12 },
  { name: "Stage", kind: "category", confidence: 100, nonEmptyCount: 12, validCount: 12 },
  { name: "Location", kind: "category", confidence: 100, nonEmptyCount: 12, validCount: 12 },
  { name: "Industry", kind: "category", confidence: 100, nonEmptyCount: 12, validCount: 12 },
  { name: "Company", kind: "identifier", confidence: 100, nonEmptyCount: 12, validCount: 12 },
];

const rows = [
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-05", total_laid_off: 1000, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Company: "Atlas Labs" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-05", total_laid_off: 250, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Company: "Atlas Labs" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-12", total_laid_off: 700, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Company: "Beacon Inc" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-12", total_laid_off: 250, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Company: "Beacon Inc" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-20", total_laid_off: 1500, Country: "United States", Stage: "Private", Location: "New York", Company: "Cedar Co" } },
  { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-20", total_laid_off: 1500, Country: "United States", Stage: "Private", Location: "New York", Company: "Cedar Co" } },
] as const;

describe("import-backed KPI analyst", () => {
  it("adds company, overlap, and date evidence to a driver-specific why answer", () => {
    const evidence = buildImportAnalystEvidence("Why did United States change?", analysis, [...rows]);
    const answer = answerImportQuestion("Why did United States change?", analysis, evidence);

    expect(answer).toContain("Atlas Labs");
    expect(answer).toContain("Post-IPO");
    expect(answer).toContain("SF Bay Area");
    expect(answer).toContain("February 5, 2023 to March 5, 2023");
  });

  it("gives a distinct, action-oriented answer instead of recycling a driver paragraph", () => {
    const evidence = buildImportAnalystEvidence("What do I fix in the company?", analysis, [...rows]);
    const answer = answerImportQuestion("What do I fix in the company?", analysis, evidence);

    expect(answer).toContain("Start with Country: United States");
    expect(answer).toContain("Atlas Labs");
    expect(answer).not.toEqual(answerImportQuestion("Why did United States change?", analysis, evidence));
  });

  it("formats analyst period wording with clear full month names", () => {
    const evidence = buildImportAnalystEvidence("Why did United States change?", analysis, [...rows], profiles);
    const answer = answerImportQuestion("Why did United States change?", analysis, evidence);

    expect(longReadablePeriod("2023-02")).toBe("February 2023");
    expect(answer).toContain("February 2023");
    expect(answer).toContain("March 2023");
    expect(answer).not.toContain("in 2023-02");
  });

  it("answers a free-typed request for another country instead of falling back to the leading country", () => {
    const countryRows = [
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-03", total_laid_off: 1600, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Industry: "SaaS", Company: "Atlas Labs" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-03", total_laid_off: 400, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Industry: "SaaS", Company: "Atlas Labs" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-06", total_laid_off: 900, Country: "Canada", Stage: "Growth", Location: "Toronto", Industry: "Commerce", Company: "North Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-06", total_laid_off: 300, Country: "Canada", Stage: "Growth", Location: "Toronto", Industry: "Commerce", Company: "North Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-09", total_laid_off: 700, Country: "India", Stage: "Late", Location: "Bengaluru", Industry: "Fintech", Company: "East Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-09", total_laid_off: 300, Country: "India", Stage: "Late", Location: "Bengaluru", Industry: "Fintech", Company: "East Co" } },
    ];
    const evidence = buildImportAnalystEvidence("Why country number was high after the United States?", analysis, countryRows, profiles);
    const answer = answerImportQuestion("Why country number was high after the United States?", analysis, evidence);

    expect(answer).toContain("Canada");
    expect(answer).toContain("highest other country");
    expect(answer).not.toContain("is United States at");
  });

  it("returns a top-N list constrained to the named dimension rather than an unrelated overall factor", () => {
    const countryRows = [
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-03", total_laid_off: 1600, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Industry: "SaaS", Company: "Atlas Labs" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-03", total_laid_off: 400, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Industry: "SaaS", Company: "Atlas Labs" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-06", total_laid_off: 900, Country: "Canada", Stage: "Growth", Location: "Toronto", Industry: "Commerce", Company: "North Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-06", total_laid_off: 300, Country: "Canada", Stage: "Growth", Location: "Toronto", Industry: "Commerce", Company: "North Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-09", total_laid_off: 700, Country: "India", Stage: "Late", Location: "Bengaluru", Industry: "Fintech", Company: "East Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-09", total_laid_off: 300, Country: "India", Stage: "Late", Location: "Bengaluru", Industry: "Fintech", Company: "East Co" } },
    ];
    const evidence = buildImportAnalystEvidence("What are the top 5 highest layoffs country?", analysis, countryRows, profiles);
    const answer = answerImportQuestion("What are the top 5 highest layoffs country?", analysis, evidence);

    expect(answer).toContain("within Country");
    expect(answer).toContain("United States");
    expect(answer).toContain("Canada");
    expect(answer).toContain("India");
    expect(answer).not.toContain("Industry: Commerce");
  });

  it("returns the requested ranked factor from all eligible factor values", () => {
    const countryRows = [
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-03", total_laid_off: 1600, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Industry: "SaaS", Company: "Atlas Labs" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-03", total_laid_off: 400, Country: "United States", Stage: "Post-IPO", Location: "SF Bay Area", Industry: "SaaS", Company: "Atlas Labs" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-06", total_laid_off: 900, Country: "Canada", Stage: "Growth", Location: "Toronto", Industry: "Commerce", Company: "North Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-06", total_laid_off: 300, Country: "Canada", Stage: "Growth", Location: "Toronto", Industry: "Commerce", Company: "North Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-02-09", total_laid_off: 700, Country: "India", Stage: "Late", Location: "Bengaluru", Industry: "Fintech", Company: "East Co" } },
      { excluded: false, isOutlier: false, cleanedValues: { date: "2023-03-09", total_laid_off: 300, Country: "India", Stage: "Late", Location: "Bengaluru", Industry: "Fintech", Company: "East Co" } },
    ];
    const evidence = buildImportAnalystEvidence("What is the 6th biggest factor that affected the KPI?", analysis, countryRows, profiles);
    const answer = answerImportQuestion("What is the 6th biggest factor that affected the KPI?", analysis, evidence);

    expect(answer).toContain("6th biggest measured factor");
    expect(answer).toMatch(/(Country: Canada|Industry: Commerce|Location: Toronto)/);
    expect(answer).not.toContain("Country: United States");
  });

  it("states a clear limitation instead of returning an unrelated leading-driver answer", () => {
    const evidence = buildImportAnalystEvidence("What was the CEO salary?", analysis, [...rows], profiles);
    const answer = answerImportQuestion("What was the CEO salary?", analysis, evidence);

    expect(answer).toContain("I can’t answer that specific question");
    expect(answer).toContain("What I found instead");
  });

  it("keeps aggregate-only fallback questions action-specific when row evidence is unavailable", () => {
    const answer = fallbackAnalystAnswer("What do I fix in the company?", {
      metricLabel: analysis.metricLabel,
      summary: analysis.summary,
      previousPeriod: analysis.previousPeriod,
      currentPeriod: analysis.currentPeriod,
      currencySymbol: analysis.currencySymbol,
      confidence: analysis.confidence,
      causes: analysis.causes,
    });

    expect(answer).toContain("Start with Country: United States");
    expect(answer).toContain("underlying records");
  });
});
