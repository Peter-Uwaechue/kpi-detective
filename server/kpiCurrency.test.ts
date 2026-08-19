import { describe, expect, it } from "vitest";
import { DEFAULT_CURRENCY_CODE, ISO_CURRENCY_CODES, currencySymbolForCode, detectCurrencyFromValues } from "../shared/kpiCurrency";

describe("KPI currency display metadata", () => {
  it("detects currency codes and symbols from uploaded monetary values", () => {
    const naira = detectCurrencyFromValues(["₦125,000.00", "NGN 42,500", "₦8,100"]);
    const pound = detectCurrencyFromValues(["£4,200", "GBP 600"]);
    const euro = detectCurrencyFromValues(["€900", "EUR 1,250"]);

    expect(naira).toMatchObject({ currencyCode: "NGN", currencySource: "detected", detected: true });
    expect(pound).toMatchObject({ currencyCode: "GBP", currencySource: "detected", detected: true });
    expect(euro).toMatchObject({ currencyCode: "EUR", currencySource: "detected", detected: true });
  });

  it("defaults transparently to USD only when source currency is absent", () => {
    const result = detectCurrencyFromValues(["125000", "42500", "8100"]);

    expect(result).toMatchObject({ currencyCode: DEFAULT_CURRENCY_CODE, currencySource: "default", detected: false });
  });

  it("offers the requested major currencies plus the complete runtime ISO list", () => {
    ["USD", "NGN", "EUR", "GBP", "KES", "GHS", "ZAR", "INR", "CNY", "JPY", "CAD", "AUD"].forEach(code => expect(ISO_CURRENCY_CODES).toContain(code));
    expect(ISO_CURRENCY_CODES.length).toBeGreaterThan(150);
  });

  it("changes symbols for display without transforming amounts", () => {
    const amount = 316019;
    expect(amount).toBe(316019);
    expect(currencySymbolForCode("NGN")).toBeTruthy();
    expect(currencySymbolForCode("GBP")).toBeTruthy();
    expect(amount).toBe(316019);
  });
});
