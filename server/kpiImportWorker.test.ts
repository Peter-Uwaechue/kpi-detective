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


describe("KPI import real-world data-shape matrix", () => {
  const freshStats = () => ({
    sourceRows: 0,
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

  it("derives a selected Amount from Quantity and UnitPrice while standardising mixed date formats with timestamps", () => {
    const rows: RawRecord[] = [
      { InvoiceDate: "2026-05-29 09:50:00", Quantity: "2", UnitPrice: "$10.00", Discount: "1.50", Tax: "0.50", Country: "United States" },
      { InvoiceDate: "28-May-2026", Quantity: "3", UnitPrice: "€4.00", Discount: "0", Tax: "0.60", Country: "United States" },
      { InvoiceDate: "04/09/2026", Quantity: "4", UnitPrice: "NGN 5.00", Discount: "0", Tax: "0", Country: "United States" },
      { InvoiceDate: "05/10/2026", Quantity: "1", UnitPrice: "6.00", Discount: "TBD", Tax: "cash", Country: "United States" },
      { InvoiceDate: "10-Oct-2026", Quantity: "2", UnitPrice: "TBD", Discount: "0", Tax: "0", Country: "United States" },
    ];
    const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
    const metric = __kpiImportWorkerTesting.findMetric(profiles);
    const date = __kpiImportWorkerTesting.findDate(profiles);
    const stats = freshStats();
    const cleaned = rows.map(row => __kpiImportWorkerTesting.cleanRow(row, profiles, stats));

    expect(metric).toMatchObject({ name: "__derived_amount__", isSelectedMetric: true, label: "Derived Amount" });
    expect(metric?.selectionReason).toContain("Quantity × UnitPrice");
    expect(date).toMatchObject({ name: "InvoiceDate", kind: "date", datePreference: "day-first" });
    expect(cleaned.map(row => row.cleanedValues.InvoiceDate)).toEqual(["2026-05-29", "2026-05-28", "2026-09-04", "2026-10-05", "2026-10-10"]);
    expect(cleaned.map(row => row.cleanedValues.__derived_amount__)).toEqual([19, 12.6, 20, 6, null]);
    expect(cleaned[0]?.changes.some(change => change.column === "__derived_amount__" && change.reason.includes("Quantity × UnitPrice"))).toBe(true);
    expect(cleaned[4]?.issues.some(issue => issue.column === "__derived_amount__" && issue.type === "missing")).toBe(true);
  });

  it("uses Quantity × Cost and applies separate percentage discount and tax when no sales-price column exists", () => {
    const rows: RawRecord[] = [
      { TransactionDate: "2026-04-01", Quantity: "10", UnitCost: "5", DiscountPercent: "10", VAT: "20", Store: "A" },
      { TransactionDate: "2026-05-01", Quantity: "2", UnitCost: "8", DiscountPercent: "0", VAT: "0", Store: "A" },
    ];
    const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
    const metric = __kpiImportWorkerTesting.findMetric(profiles);
    const cleaned = __kpiImportWorkerTesting.cleanRow(rows[0]!, profiles, freshStats());

    expect(metric).toMatchObject({ name: "__derived_amount__", metricRecipe: { kind: "quantity_times_cost", quantityColumn: "Quantity", unitValueColumn: "UnitCost", discountColumn: "DiscountPercent", taxColumn: "VAT" } });
    expect(cleaned.cleanedValues.__derived_amount__).toBe(55);
  });

  it("prefers a labelled combined Amount over a possible derived amount", () => {
    const rows: RawRecord[] = [
      { Date: "2026-04-01", Quantity: "2", UnitPrice: "10", Amount: "$17.50" },
      { Date: "2026-05-01", Quantity: "3", UnitPrice: "10", Amount: "$30.00" },
    ];
    const metric = __kpiImportWorkerTesting.findMetric(__kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows));

    expect(metric).toMatchObject({ name: "Amount", isSelectedMetric: true });
    expect(metric?.selectionReason).toContain("labelled monetary column");
  });

  it("selects and discloses a deterministic best numeric fallback instead of rejecting an otherwise analysable file", () => {
    const rows: RawRecord[] = [
      { Date: "2026-04-01", Forecast: "100", Target: "120", Region: "East" },
      { Date: "2026-05-01", Forecast: "140", Target: "120", Region: "West" },
    ];
    const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
    const metric = __kpiImportWorkerTesting.findMetric(profiles);
    const logs = __kpiImportWorkerTesting.logsFromStats(freshStats(), metric);

    expect(metric).toMatchObject({ name: "Forecast", isSelectedMetric: true });
    expect(metric?.selectionReason).toContain("highest-confidence usable numeric column");
    expect(logs[0]).toMatchObject({ key: "metric", title: "KPI selected", count: 1 });
    expect(logs[0]?.detail).toContain("Forecast");
  });
});


  it("profiles the exact invoice header shape with high-cardinality Quantity as a derived invoice KPI, not an identifier", () => {
    const rows: RawRecord[] = Array.from({ length: 10 }, (_, index) => ({
      InvoiceNo: `INV-${1000 + index}`,
      StockCode: `SKU-${2000 + index}`,
      Description: `Product ${index + 1}`,
      Quantity: String(index + 1),
      InvoiceDate: index % 3 === 0 ? `2026-05-${String(index + 1).padStart(2, "0")} 09:50:00` : index % 3 === 1 ? `${index + 1}-May-2026` : `${String(index + 1).padStart(2, "0")}/05/2026`,
      UnitPrice: `£${(index + 1).toLocaleString("en-GB")}.50`,
      CustomerID: String(10000 + index),
      Country: "United Kingdom",
    }));
    const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
    const metric = __kpiImportWorkerTesting.findMetric(profiles);
    const date = __kpiImportWorkerTesting.findDate(profiles);
    const quantity = profiles.find(profile => profile.name === "Quantity");
    const cleaned = __kpiImportWorkerTesting.cleanRow(rows[9]!, profiles, stats());

    expect(quantity).toMatchObject({ kind: "number" });
    expect(profiles.find(profile => profile.name === "InvoiceNo")).toMatchObject({ kind: "identifier" });
    expect(profiles.find(profile => profile.name === "CustomerID")).toMatchObject({ kind: "identifier" });
    expect(date).toMatchObject({ name: "InvoiceDate", kind: "date", datePreference: "day-first" });
    expect(metric).toMatchObject({ name: "__derived_amount__", metricRecipe: { kind: "quantity_times_price", quantityColumn: "Quantity", unitValueColumn: "UnitPrice" } });
    expect(cleaned.cleanedValues.__derived_amount__).toBe(105);
  });


it("explains rejected profiling decisions with the selected and classified columns", () => {
  const rows: RawRecord[] = [
    { InvoiceNo: "INV-1000", Quantity: "1", UnitPrice: "£10.00", InvoiceDate: "28-May-2026" },
    { InvoiceNo: "INV-1001", Quantity: "2", UnitPrice: "£11.00", InvoiceDate: "29-May-2026" },
  ];
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const detail = __kpiImportWorkerTesting.profilingDetail(profiles);

  expect(detail).toContain("InvoiceNo: identifier");
  expect(detail).toContain("Quantity: number");
  expect(detail).toContain("UnitPrice: number");
  expect(detail).toContain("InvoiceDate: date");
  expect(detail).toContain("Derived Amount (__derived_amount__): number");
  expect(detail).toContain("selected KPI");
});


it("profiles a mixed InvoiceDate column as a date when ISO and textual dates anchor ambiguous slash timestamps", () => {
  const dates = [
    "2026-05-29 09:50:00",
    "28-May-2026",
    "Jun 08, 2026",
    "2026-05-30T12:00:00",
    "29-May-2026 15:42",
    "Jun 09, 2026 15:42",
    "2026-06-01",
    "04/03/2026 15:42",
    "04/09/2026",
    "05/10/2026 15:42",
  ];
  const rows: RawRecord[] = dates.map((InvoiceDate, index) => ({
    InvoiceNo: `INV-${1000 + index}`,
    Quantity: String(index + 1),
    UnitPrice: `£${index + 1}.50`,
    InvoiceDate,
    Country: "United Kingdom",
  }));
  // Repeated invoice days keep the date column below the high-cardinality
  // identifier threshold, reproducing the original 70% category outcome.
  rows.push({ ...rows[0]!, InvoiceNo: "INV-1010" });

  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const date = __kpiImportWorkerTesting.findDate(profiles);
  const workerStats = stats();
  const cleaned = rows.map(row => __kpiImportWorkerTesting.cleanRow(row, profiles, workerStats));

  expect(date).toMatchObject({ name: "InvoiceDate", kind: "date", datePreference: "month-first" });
  expect(cleaned.map(row => row.cleanedValues.InvoiceDate)).toEqual([
    "2026-05-29",
    "2026-05-28",
    "2026-06-08",
    "2026-05-30",
    "2026-05-29",
    "2026-06-09",
    "2026-06-01",
    "2026-04-03",
    "2026-04-09",
    "2026-05-10",
    "2026-05-29",
  ]);
  expect(__kpiImportWorkerTesting.findMetric(profiles)).toMatchObject({ name: "__derived_amount__", isSelectedMetric: true });
});
