import { describe, expect, it } from "vitest";
import type { KpiAnalysis } from "../shared/kpiEngine";
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
    expect(answer).toContain("Feb 5 to Mar 5");
  });

  it("gives a distinct, action-oriented answer instead of recycling a driver paragraph", () => {
    const evidence = buildImportAnalystEvidence("What do I fix in the company?", analysis, [...rows]);
    const answer = answerImportQuestion("What do I fix in the company?", analysis, evidence);

    expect(answer).toContain("Start with Country: United States");
    expect(answer).toContain("Atlas Labs");
    expect(answer).not.toEqual(answerImportQuestion("Why did United States change?", analysis, evidence));
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
