export type CurrencySource = "detected" | "default" | "manual";

export const DEFAULT_CURRENCY_CODE = "USD";

type IntlWithCurrencyList = typeof Intl & {
  supportedValuesOf?: (key: "currency") => string[];
};

const majorCurrencyFallback = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "FOK", "GBP", "GEL", "GGP", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS", "IMP", "INR", "IQD", "IRR", "ISK", "JEP", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KID", "KMF", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SLL", "SOS", "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TVD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWL",
] as const;

const supportedCurrencyCodes = () => {
  const intl = Intl as IntlWithCurrencyList;
  const values = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("currency") : [];
  return Array.from(new Set([...values, ...majorCurrencyFallback])).filter(code => /^[A-Z]{3}$/.test(code)).sort();
};

export const ISO_CURRENCY_CODES = supportedCurrencyCodes();

export const normaliseCurrencyCode = (value: string | null | undefined) => {
  const code = String(value ?? "").trim().toUpperCase();
  return ISO_CURRENCY_CODES.includes(code) ? code : null;
};

export const currencySymbolForCode = (value: string | null | undefined) => {
  const code = normaliseCurrencyCode(value) ?? DEFAULT_CURRENCY_CODE;
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).formatToParts(0);
    return parts.find(part => part.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
};

export const currencyNameForCode = (value: string) => {
  const code = normaliseCurrencyCode(value) ?? value.toUpperCase();
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
};

export const currencyOptionLabel = (value: string) => `${value} — ${currencyNameForCode(value)} (${currencySymbolForCode(value)})`;

const text = (value: unknown) => typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);

const sourceTokens: Array<{ pattern: RegExp; code: string; weight: number }> = [
  { pattern: /\b(?:NGN|NAIRA)\b/i, code: "NGN", weight: 4 },
  { pattern: /₦/, code: "NGN", weight: 3 },
  { pattern: /\b(?:GBP|STERLING)\b/i, code: "GBP", weight: 4 },
  { pattern: /£/, code: "GBP", weight: 3 },
  { pattern: /\bEUR\b/i, code: "EUR", weight: 4 },
  { pattern: /€/, code: "EUR", weight: 3 },
  { pattern: /\b(?:KES|KSH)\b/i, code: "KES", weight: 4 },
  { pattern: /\bGHS\b|GH₵/i, code: "GHS", weight: 4 },
  { pattern: /\bZAR\b/i, code: "ZAR", weight: 4 },
  { pattern: /\bINR\b/i, code: "INR", weight: 4 },
  { pattern: /₹/, code: "INR", weight: 3 },
  { pattern: /\b(?:CNY|RMB)\b/i, code: "CNY", weight: 4 },
  { pattern: /CN¥|￥/, code: "CNY", weight: 3 },
  { pattern: /\bJPY\b/i, code: "JPY", weight: 4 },
  { pattern: /¥/, code: "JPY", weight: 2 },
  { pattern: /\bCAD\b|CA\$/i, code: "CAD", weight: 4 },
  { pattern: /\bAUD\b|A\$/i, code: "AUD", weight: 4 },
  { pattern: /\bUSD\b|US\$/i, code: "USD", weight: 4 },
  { pattern: /\$/, code: "USD", weight: 1 },
];

const codePattern = new RegExp(`\\b(${ISO_CURRENCY_CODES.join("|")})\\b`, "i");

export type CurrencyDetection = {
  currencyCode: string;
  currencySymbol: string;
  currencySource: CurrencySource;
  detected: boolean;
};

export const detectCurrencyFromValues = (values: unknown[]): CurrencyDetection => {
  const scores = new Map<string, number>();
  const add = (code: string, score: number) => scores.set(code, (scores.get(code) ?? 0) + score);
  values.forEach(value => {
    const raw = text(value);
    if (!raw) return;
    const explicitCode = raw.match(codePattern)?.[1]?.toUpperCase();
    if (explicitCode && normaliseCurrencyCode(explicitCode)) add(explicitCode, 5);
    sourceTokens.forEach(token => { if (token.pattern.test(raw)) add(token.code, token.weight); });
  });
  const ranked = Array.from(scores, ([currencyCode, score]) => ({ currencyCode, score })).sort((left, right) => right.score - left.score || left.currencyCode.localeCompare(right.currencyCode));
  const detected = ranked[0]?.currencyCode;
  if (!detected) return { currencyCode: DEFAULT_CURRENCY_CODE, currencySymbol: currencySymbolForCode(DEFAULT_CURRENCY_CODE), currencySource: "default", detected: false };
  return { currencyCode: detected, currencySymbol: currencySymbolForCode(detected), currencySource: "detected", detected: true };
};

export const currencyDisplay = (value: number, currencyCode: string, maximumFractionDigits = 0) => new Intl.NumberFormat("en", {
  style: "currency",
  currency: normaliseCurrencyCode(currencyCode) ?? DEFAULT_CURRENCY_CODE,
  maximumFractionDigits,
}).format(value);
