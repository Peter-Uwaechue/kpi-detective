import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { __kpiImportWorkerTesting, streamRecords } from "./kpiImportWorker";

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
    "2026-04-30 09:50:00",
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

  expect(date).toMatchObject({ name: "InvoiceDate", kind: "date", datePreference: "contextual", dateContext: { startPeriod: "2026-04", endPeriod: "2026-06", fallbackPreference: "month-first" } });
  expect(cleaned.map(row => row.cleanedValues.InvoiceDate)).toEqual([
    "2026-04-30",
    "2026-05-28",
    "2026-06-08",
    "2026-05-30",
    "2026-05-29",
    "2026-06-09",
    "2026-06-01",
    "2026-04-03",
    "2026-04-09",
    "2026-05-10",
    "2026-04-30",
  ]);
  expect(__kpiImportWorkerTesting.findMetric(profiles)).toMatchObject({ name: "__derived_amount__", isSelectedMetric: true });
});


it("handles a different day-first operational window with numeric date-times, ISO dates, and text dates", () => {
  const rows: RawRecord[] = [
    { InvoiceNo: "EU-1", Quantity: "1", UnitPrice: "10", InvoiceDate: "2027-09-17 09:00:00" },
    { InvoiceNo: "EU-2", Quantity: "1", UnitPrice: "10", InvoiceDate: "18-Sep-2027 10:30" },
    { InvoiceNo: "EU-3", Quantity: "1", UnitPrice: "10", InvoiceDate: "04/09/2027 14:20" },
    { InvoiceNo: "EU-4", Quantity: "1", UnitPrice: "10", InvoiceDate: "09/10/2027" },
    { InvoiceNo: "EU-5", Quantity: "1", UnitPrice: "10", InvoiceDate: "24/10/2027 08:10" },
  ];
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const date = __kpiImportWorkerTesting.findDate(profiles);
  const cleaned = rows.map(row => __kpiImportWorkerTesting.cleanRow(row, profiles, stats()));

  expect(date).toMatchObject({ name: "InvoiceDate", kind: "date", datePreference: "day-first" });
  expect(cleaned.map(row => row.cleanedValues.InvoiceDate)).toEqual(["2027-09-17", "2027-09-18", "2027-09-04", "2027-10-09", "2027-10-24"]);
});

it("handles a different month-first operational window with numeric date-times, ISO dates, and text dates", () => {
  const rows: RawRecord[] = [
    { InvoiceNo: "US-1", Quantity: "1", UnitPrice: "10", InvoiceDate: "2025-01-31T09:00:00" },
    { InvoiceNo: "US-2", Quantity: "1", UnitPrice: "10", InvoiceDate: "January 30, 2025 10:30" },
    { InvoiceNo: "US-3", Quantity: "1", UnitPrice: "10", InvoiceDate: "01/31/2025 14:20" },
    { InvoiceNo: "US-4", Quantity: "1", UnitPrice: "10", InvoiceDate: "02/01/2025" },
    { InvoiceNo: "US-5", Quantity: "1", UnitPrice: "10", InvoiceDate: "02/14/2025 08:10" },
  ];
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const date = __kpiImportWorkerTesting.findDate(profiles);
  const cleaned = rows.map(row => __kpiImportWorkerTesting.cleanRow(row, profiles, stats()));

  expect(date).toMatchObject({ name: "InvoiceDate", kind: "date", datePreference: "month-first" });
  expect(cleaned.map(row => row.cleanedValues.InvoiceDate)).toEqual(["2025-01-31", "2025-01-30", "2025-01-31", "2025-02-01", "2025-02-14"]);
});


it("keeps unique dates, unique identifiers, and unique monetary values in their correct classifier lanes", () => {
  const rows: RawRecord[] = Array.from({ length: 12 }, (_, index) => ({
    order_date: index % 3 === 0 ? `1/${20 + index}/2021` : index % 3 === 1 ? `10/${index + 1}/2026` : `2026-10-${String(index + 1).padStart(2, "0")} 09:30:00`,
    event_time: `2026-10-${String(index + 1).padStart(2, "0")}T09:30:00`,
    order_id: `ORD-${10001 + index}`,
    invoice_no: `INV-${20001 + index}`,
    stock_code: `SKU-${30001 + index}`,
    customer_id: String(40001 + index),
    revenue_usd: String(100.25 + index * 37.5),
    unit_price: String(1.5 + index / 10),
    quantity: String(index + 1),
    region: index % 2 ? "North" : "South",
  }));
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const profileByName = new Map(profiles.map(profile => [profile.name, profile]));

  expect(profileByName.get("order_date")).toMatchObject({ kind: "date" });
  expect(profileByName.get("event_time")).toMatchObject({ kind: "date" });
  expect(profileByName.get("order_id")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("invoice_no")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("stock_code")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("customer_id")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("revenue_usd")).toMatchObject({ kind: "number", isSelectedMetric: true });
  expect(profileByName.get("unit_price")).toMatchObject({ kind: "number" });
  expect(profileByName.get("quantity")).toMatchObject({ kind: "number" });
  expect(profileByName.get("region")).toMatchObject({ kind: "category" });
});

it("does not misread identifier strings with year-like digits as dates", () => {
  const rows: RawRecord[] = Array.from({ length: 12 }, (_, index) => ({
    order_id: `ORD-${10001 + index}`,
    transaction_code: `TXN-${20260101 + index}`,
    transaction_id: String(1704067200 + index * 86400),
    reference: `REF-2026-${100 + index}`,
    created_at: `2026-11-${String(index + 1).padStart(2, "0")} 08:00:00`,
    amount: String(50 + index),
  }));
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const profileByName = new Map(profiles.map(profile => [profile.name, profile]));

  expect(profileByName.get("order_id")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("transaction_code")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("transaction_id")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("reference")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("created_at")).toMatchObject({ kind: "date" });
  expect(profileByName.get("amount")).toMatchObject({ kind: "number", isSelectedMetric: true });
});


it("classifies Selling Date text and Excel serial dates without confusing IDs or revenue", () => {
  const rows: RawRecord[] = Array.from({ length: 12 }, (_, index) => ({
    "Selling Date": index % 2 === 0 ? `1/${index + 1}/2022` : `10/${index + 1}/2026`,
    "Excel Selling Date": String(44562 + index),
    order_id: `ORD-${10001 + index}`,
    transaction_code: `TXN-${20260101 + index}`,
    revenue_usd: String(150.25 + index * 19.5),
  }));
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const profileByName = new Map(profiles.map(profile => [profile.name, profile]));
  const cleaned = rows.map(row => __kpiImportWorkerTesting.cleanRow(row, profiles, stats()));

  expect(profileByName.get("Selling Date")).toMatchObject({ kind: "date" });
  expect(profileByName.get("Excel Selling Date")).toMatchObject({ kind: "date", acceptsExcelSerialDates: true });
  expect(profileByName.get("order_id")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("transaction_code")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("revenue_usd")).toMatchObject({ kind: "number", isSelectedMetric: true });
  expect(cleaned.slice(0, 3).map(row => row.cleanedValues["Excel Selling Date"])).toEqual(["2022-01-01", "2022-01-02", "2022-01-03"]);
});

it("does not treat serial-sized numbers as dates without a date-labelled column", () => {
  const rows: RawRecord[] = Array.from({ length: 12 }, (_, index) => ({
    order_id: String(44562 + index),
    inventory_value: String(44562 + index),
    revenue_usd: String(120 + index),
  }));
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const profileByName = new Map(profiles.map(profile => [profile.name, profile]));

  expect(profileByName.get("order_id")).toMatchObject({ kind: "identifier" });
  expect(profileByName.get("inventory_value")).toMatchObject({ kind: "number" });
  expect(profileByName.get("revenue_usd")).toMatchObject({ kind: "number" });
  expect(__kpiImportWorkerTesting.findMetric(profiles)?.kind).toBe("number");
});


it("passes the permanent real-world business import capability matrix as one streamed CSV", async () => {
  const fixture = new URL("./fixtures/real-world-import-capability-matrix.csv", import.meta.url);
  const rows: RawRecord[] = [];
  for await (const row of streamRecords("real-world-import-capability-matrix.csv", createReadStream(fixture))) rows.push(row);
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const byName = new Map(profiles.map(profile => [profile.name, profile]));
  const cleaned = rows.map(row => __kpiImportWorkerTesting.cleanRow(row, profiles, stats()));

  expect(rows).toHaveLength(12);
  expect(__kpiImportWorkerTesting.findMetric(profiles)).toMatchObject({ name: "Revenue USD", kind: "number", isSelectedMetric: true });
  expect(byName.get("Occurred At")).toMatchObject({ kind: "date" });
  expect(byName.get("Excel Selling Date")).toMatchObject({ kind: "date", acceptsExcelSerialDates: true });
  expect(byName.get("Unix Timestamp Seconds")).toMatchObject({ kind: "date", acceptsUnixTimestamps: true });
  expect(byName.get("Unix Timestamp Millis")).toMatchObject({ kind: "date", acceptsUnixTimestamps: true });
  expect(byName.get("Unix Timestamp Micros")).toMatchObject({ kind: "date", acceptsUnixTimestamps: true });
  expect(byName.get("Compact Date")).toMatchObject({ kind: "date" });
  expect(byName.get("Compact Period")).toMatchObject({ kind: "date" });
  expect(byName.get("Period")).toMatchObject({ kind: "date" });
  expect(byName.get("Quarter")).toMatchObject({ kind: "date" });
  expect(byName.get("__derived_date__")).toMatchObject({ kind: "date", dateRecipe: { kind: "year_month_day", yearColumn: "Year", monthColumn: "Month", dayColumn: "Day" } });
  expect(byName.get("Order ID")).toMatchObject({ kind: "identifier" });
  expect(byName.get("Customer ID")).toMatchObject({ kind: "identifier" });
  expect(byName.get("SKU")).toMatchObject({ kind: "identifier" });
  expect(byName.get("Revenue USD")).toMatchObject({ kind: "number" });
  expect(byName.get("Amount Text")).toMatchObject({ kind: "number" });
  expect(byName.get("Accounting Amount")).toMatchObject({ kind: "number" });
  expect(byName.get("Quantity")).toMatchObject({ kind: "number" });
  expect(byName.get("Unit Price")).toMatchObject({ kind: "number" });
  expect(cleaned[0]?.cleanedValues).toMatchObject({
    "Occurred At": "2026-01-01",
    "Excel Selling Date": "2022-01-01",
    "Unix Timestamp Seconds": "2024-01-01",
    "Unix Timestamp Millis": "2024-01-01",
    "Unix Timestamp Micros": "2024-01-01",
    "Compact Date": "2026-01-01",
    "Compact Period": "2026-01-01",
    Period: "2026-01-01",
    Quarter: "2026-01-01",
    "__derived_date__": "2026-01-01",
    "Customer ID": "00001001",
    "Amount Text": 1234.5,
  });
  expect(cleaned[2]?.cleanedValues["Revenue USD"]).toBe(1250);
  expect(cleaned[3]?.cleanedValues["Amount Text"]).toBe(-1250);
  expect(cleaned[4]?.cleanedValues["Amount Text"]).toBe(3000.5);
  expect(cleaned[1]?.cleanedValues["Accounting Amount"]).toBe(-2345.67);
  expect(cleaned[2]?.cleanedValues["Accounting Amount"]).toBe(1234567.89);
  expect(cleaned[3]?.cleanedValues["Accounting Amount"]).toBe(-1250);
  expect(cleaned[4]?.cleanedValues["Accounting Amount"]).toBe(1250);
  expect(cleaned[5]?.cleanedValues["Accounting Amount"]).toBe(-2000);
  expect(cleaned[6]?.cleanedValues["Accounting Amount"]).toBe(1000000);
  expect(cleaned[11]?.cleanedValues.Quantity).toBe(2050);
  expect(cleaned[9]?.cleanedValues["Revenue USD"]).toBe(4200);
});


it("reads native XLSX dates, serial dates, formula results, and numeric cells through the production stream", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  sheet.addRow(["Selling Date", "Excel Serial Date", "Revenue USD", "Order ID"]);
  for (let index = 0; index < 12; index++) {
    const row = sheet.addRow([new Date(Date.UTC(2026, 0, index + 1)), 44562 + index, 1000 + index * 25, `ORD-${1000 + index}`]);
    if (index === 0) row.getCell(3).value = { formula: "44562/44.562", result: 1000 };
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const rows: RawRecord[] = [];
  for await (const row of streamRecords("native-spreadsheet.xlsx", Readable.from([Buffer.from(bytes)]))) rows.push(row);
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const byName = new Map(profiles.map(profile => [profile.name, profile]));
  const cleaned = rows.map(row => __kpiImportWorkerTesting.cleanRow(row, profiles, stats()));

  expect(rows).toHaveLength(12);
  expect(byName.get("Selling Date")).toMatchObject({ kind: "date" });
  expect(byName.get("Excel Serial Date")).toMatchObject({ kind: "date", acceptsExcelSerialDates: true });
  expect(byName.get("Revenue USD")).toMatchObject({ kind: "number", isSelectedMetric: true });
  expect(byName.get("Order ID")).toMatchObject({ kind: "identifier" });
  expect(cleaned[0]?.cleanedValues).toMatchObject({ "Selling Date": "2026-01-01", "Excel Serial Date": "2022-01-01", "Revenue USD": 1000 });
});


it("keeps multiple strong KPI candidates visible and permits a manual metric selection", () => {
  const rows: RawRecord[] = Array.from({ length: 12 }, (_, index) => ({
    order_date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    Revenue: String(1200 + index * 35),
    Profit: String(310 + index * 9),
    Losses: String(45 + index),
    "Units Sold": String(18 + index),
    order_id: `ORD-${1000 + index}`,
  }));
  const profiles = __kpiImportWorkerTesting.inferProfiles(Object.keys(rows[0]!), rows);
  const candidates = profiles.filter(profile => profile.isMetricCandidate).map(profile => profile.name);

  expect(candidates).toEqual(expect.arrayContaining(["Revenue", "Profit", "Losses", "Units Sold"]));
  expect(__kpiImportWorkerTesting.findMetric(profiles)).toMatchObject({ name: "Revenue", isSelectedMetric: true });

  const profitSelection = __kpiImportWorkerTesting.applyMetricSelection(profiles, "Profit");
  expect(__kpiImportWorkerTesting.findMetric(profitSelection)).toMatchObject({ name: "Profit", isSelectedMetric: true });
  expect(profitSelection.find(profile => profile.name === "Revenue")).toMatchObject({ isMetricCandidate: true, isSelectedMetric: false });
  expect(profitSelection.find(profile => profile.name === "order_date")).toMatchObject({ kind: "date" });
  expect(profitSelection.find(profile => profile.name === "order_id")).toMatchObject({ kind: "identifier" });
});


it("separates offsetting positive factors from factors driving an overall KPI decline", () => {
  const profiles = [
    { name: "order_date", kind: "date", confidence: 99 },
    { name: "Revenue", kind: "number", confidence: 99, isSelectedMetric: true, label: "Revenue" },
    { name: "CustomerAge", kind: "category", confidence: 99 },
    { name: "Region", kind: "category", confidence: 99 },
  ];
  const aggregates = [
    { metricColumn: "Revenue", period: "2026-01", dimension: "__total__", segment: "__all__", metricTotal: 1_000_000, recordCount: 100 },
    { metricColumn: "Revenue", period: "2026-02", dimension: "__total__", segment: "__all__", metricTotal: 500_000, recordCount: 100 },
    { metricColumn: "Revenue", period: "2026-01", dimension: "Region", segment: "North", metricTotal: 700_000, recordCount: 50 },
    { metricColumn: "Revenue", period: "2026-02", dimension: "Region", segment: "North", metricTotal: 300_000, recordCount: 50 },
    { metricColumn: "Revenue", period: "2026-01", dimension: "Region", segment: "West", metricTotal: 300_000, recordCount: 50 },
    { metricColumn: "Revenue", period: "2026-02", dimension: "Region", segment: "West", metricTotal: 0, recordCount: 50 },
    { metricColumn: "Revenue", period: "2026-01", dimension: "CustomerAge", segment: "38", metricTotal: 10_000, recordCount: 2 },
    { metricColumn: "Revenue", period: "2026-02", dimension: "CustomerAge", segment: "38", metricTotal: 326_019, recordCount: 2 },
  ];

  const analysis = __kpiImportWorkerTesting.analysisFromAggregates({ aggregates, profiles, usableRows: 100 });
  expect(analysis.change).toBe(-500_000);
  expect(analysis.causes).toEqual(expect.arrayContaining([
    expect.objectContaining({ dimension: "Region", value: "North", impact: -400_000 }),
    expect.objectContaining({ dimension: "Region", value: "West", impact: -300_000 }),
  ]));
  expect(analysis.causes.every(cause => cause.impact < 0)).toBe(true);
  expect(analysis.offsettingCauses).toEqual([
    expect.objectContaining({ dimension: "CustomerAge", value: "38", impact: 316_019 }),
  ]);
});


describe("KPI import display currency", () => {
  const metricProfile = { name: "revenue_usd", kind: "number" as const, confidence: 100, nonEmptyCount: 2, validCount: 2 };
  const currencyRows = [
    { rowNumber: 1, rawValues: { revenue_usd: "₦125,000", CurrencyCode: "NGN" }, cleanedValues: { revenue_usd: 125000 }, changes: [], issues: [], excluded: false, possibleDuplicate: false, isOutlier: false, exactDuplicate: false, rowSignature: "currency-1" },
    { rowNumber: 2, rawValues: { revenue_usd: "NGN 42,500", CurrencyCode: "NGN" }, cleanedValues: { revenue_usd: 42500 }, changes: [], issues: [], excluded: false, possibleDuplicate: false, isOutlier: false, exactDuplicate: false, rowSignature: "currency-2" },
  ];

  it("detects source currency and preserves the cleaned numeric amounts", () => {
    const result = __kpiImportWorkerTesting.displayCurrencyForRows(currencyRows, metricProfile, null);

    expect(result).toMatchObject({ currencyCode: "NGN", currencySource: "detected", detected: true });
    expect(currencyRows.map(row => row.cleanedValues.revenue_usd)).toEqual([125000, 42500]);
  });

  it("preserves a manual display choice through later recalculation metadata", () => {
    const result = __kpiImportWorkerTesting.displayCurrencyForRows(currencyRows, metricProfile, { currencyCode: "GBP", currencySource: "manual" });

    expect(result).toMatchObject({ currencyCode: "GBP", currencySource: "manual" });
    expect(currencyRows.map(row => row.cleanedValues.revenue_usd)).toEqual([125000, 42500]);
  });
});
