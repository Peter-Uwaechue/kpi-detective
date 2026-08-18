import { describe, expect, it } from "vitest";
import { __kpiImportWorkerTesting } from "./kpiImportWorker";

type RawRecord = Record<string, unknown>;

const sourceRows: RawRecord[] = [
  { date: "2022-11-01", total_laid_off: 70, company: "Oda", location: "Oslo", percentage_laid_off: 0.1, country: "Norway", stage: "Series C", industry: "Retail" },
  { date: "2022-11-01", total_laid_off: 70, company: "Oda", location: "Oslo", percentage_laid_off: 0.2, country: "Sweden", stage: "Series C", industry: "Retail" },
  { date: "2022-11-01", total_laid_off: 70, company: "Oda", location: "Oslo", percentage_laid_off: 0.3, country: "Norway", stage: "Series D", industry: "Retail" },
  { date: "2022-05-27", total_laid_off: 50, company: "Terminus", location: "Atlanta", percentage_laid_off: null, country: "United States", stage: "Series B", industry: "SaaS" },
  { date: "2022-05-27", total_laid_off: 50, company: "Terminus", location: "Atlanta", percentage_laid_off: null, country: "United States", stage: "Series C", industry: "SaaS" },
  { date: "2022-03-01", total_laid_off: 15, company: "Coin Alpha", location: "New York", percentage_laid_off: 0.1, country: "United States", stage: "Seed", industry: "Crypto" },
  { date: "2022-03-02", total_laid_off: 12, company: "Coin Beta", location: "New York", percentage_laid_off: 0.1, country: "United States.", stage: "Seed", industry: "Crypto Currency" },
  { date: "2022-03-03", total_laid_off: 10, company: "Coin Gamma", location: "New York", percentage_laid_off: 0.1, country: "United States", stage: "Seed", industry: "CryptoCurrency" },
];

const stats = () => ({
  sourceRows: sourceRows.length,
  usableRows: 0,
  exactDuplicates: 0,
  missingNumeric: 0,
  invalidNumeric: 0,
  dateChanges: 0,
  numericChanges: 0,
  categoryChanges: 0,
  fuzzyCategoryMerges: 0,
  fuzzyCategoryRows: 0,
  possibleDuplicates: 0,
  outliers: 0,
});

const reviewRows = () => {
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(sourceRows[0]!), sourceRows);
  const workerStats = stats();
  const rows = sourceRows.map((source, index) => {
    const cleaned = __kpiImportWorkerTesting.cleanRow(source, profiles, workerStats);
    return {
      rowNumber: index + 1,
      ...cleaned,
      excluded: false,
      possibleDuplicate: false,
      isOutlier: false,
      exactDuplicate: false,
      rowSignature: __kpiImportWorkerTesting.signatureFor(cleaned.cleanedValues),
    };
  });
  return { profiles, workerStats, rows };
};

describe("KPI import cleaning transparency", () => {
  it("flags Oda and Terminus candidates when company, date, and KPI value match", () => {
    const { profiles, workerStats, rows } = reviewRows();

    __kpiImportWorkerTesting.applyPossibleDuplicateReview(rows, profiles, workerStats);

    expect(rows.filter(row => row.possibleDuplicate).map(row => row.rawValues.company)).toEqual(["Oda", "Oda", "Oda", "Terminus", "Terminus"]);
    expect(workerStats.possibleDuplicates).toBe(5);
    expect(rows[0]?.issues[0]?.message).toContain("company, date, and KPI value");
  });

  it("reconciles Crypto aliases and United States punctuation as two distinct high-confidence alias groups", () => {
    const { profiles, workerStats, rows } = reviewRows();

    __kpiImportWorkerTesting.applyFuzzyCategoryReview(rows, profiles, workerStats);

    expect(rows.slice(5).map(row => row.cleanedValues.industry)).toEqual(["Crypto", "Crypto", "Crypto"]);
    expect(rows.slice(5).map(row => row.cleanedValues.country)).toEqual(["United States", "United States", "United States"]);
    expect(workerStats.fuzzyCategoryMerges).toBe(2);
    expect(workerStats.fuzzyCategoryRows).toBe(3);
  });

  it("reports category whitespace and alias reconciliation as separate, auditable summary metrics", () => {
    const { profiles, workerStats, rows } = reviewRows();

    __kpiImportWorkerTesting.applyFuzzyCategoryReview(rows, profiles, workerStats);
    const logs = __kpiImportWorkerTesting.logsFromStats(workerStats);
    const aliasLog = logs.find(log => log.key === "fuzzy");
    const whitespaceLog = logs.find(log => log.key === "categories");

    expect(workerStats.categoryChanges).toBe(0);
    expect(aliasLog).toMatchObject({ title: "High-confidence category alias groups", count: 2 });
    expect(aliasLog?.detail).toContain("3 individual category cells");
    expect(whitespaceLog).toMatchObject({ title: "Category whitespace standardised", count: 0 });
    expect(whitespaceLog?.detail).toContain("Alias reconciliation is reported separately");
  });
});
