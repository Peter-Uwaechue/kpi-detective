import { longReadablePeriod, type ColumnProfile, type KpiAnalysis } from "../shared/kpiEngine";
import { invokeLLM } from "./_core/llm";

export type PeterImportRow = {
  cleanedValues: unknown;
  excluded: boolean;
  isOutlier: boolean;
};

export type PeterAggregate = {
  metricColumn: string;
  period: string;
  dimension: string;
  segment: string;
  metricTotal: number | string;
  recordCount: number | bigint;
};

type PeriodValues = { previous: number; current: number; impact: number; records: number };
export type PeterFactor = PeriodValues & { dimension: string; value: string; confidence: number };
export type PeterIntent = "top_n" | "factor_rank" | "compare" | "counterfactual" | "overlap" | "explain" | "recommend" | "drilldown" | "unsupported";

export type PeterQueryPlan = {
  intent: PeterIntent;
  dimension: string | null;
  entity: string | null;
  exclusions: string[];
  limit: number;
  rankBy: "current" | "absolute_change";
  scope?: { dimension: string; value: string };
  needsRows: boolean;
  reason: string;
};

export type PeterAnswer = {
  answer: string;
  confidence: number;
  plan: PeterQueryPlan;
  evidence: {
    dimension: string | null;
    items: Array<Pick<PeterFactor, "dimension" | "value" | "previous" | "current" | "impact">>;
    exclusionApplied: string[];
    source: "aggregates" | "cleaned_rows";
  };
};

type ComparisonRow = { values: Record<string, unknown>; metric: number; period: string };

const PETER_PLANNER_TIMEOUT_MS = 4_000;

const normalise = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
const safeText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isUnknown = (value: string) => !value || /^(unknown|n\/a|na|null|none|undefined|\(blank\))$/i.test(value);
const plainMetric = (value: number, symbol: string) => `${symbol}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const signedMetric = (value: number, symbol: string) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${symbol}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const ordinal = (value: number) => {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th"}`;
};
const pluralise = (value: string, count: number) => count === 1 ? value : value.endsWith("y") ? `${value.slice(0, -1)}ies` : `${value}s`;

const topicForQuestion = (question: string): "top" | "compare" | "counterfactual" | "overlap" | "recommend" | "drilldown" | "explain" | "clarify" => {
  const text = normalise(question);
  if (/\boverlap\b|\bco-?occur(?:ring|rence)?\b|\btogether with\b/.test(text)) return "overlap";
  if (/\baside\b|\bbesides\b|\bother\b|\bexcluding\b|\bexcept\b|\bafter\b/.test(text)) return "compare";
  if (/\btop\b|\bhighest\b|\blargest\b|\bbiggest\b|\brank(?:ed|ing)?\b/.test(text)) return "top";
  if (/\bwhat if\b|\bstayed flat\b|\bwithout\b/.test(text)) return "counterfactual";
  if (/\bfix\b|\bpriority\b|\bprioritise\b|\bprioritize\b|\bwhat should\b|\bnext step\b|\bfocus on\b/.test(text)) return "recommend";
  if (/\bcompany\b|\bcompanies\b|\bcustomer\b|\bclient\b|\bemployer\b|\brow\b|\brows\b|\btransaction\b/.test(text) && !/\bwhy\b|\bcause\b|\bexplain\b/.test(text)) return "drilldown";
  if (/\bwhy\b|\bcause\b|\bexplain\b|\bchanged?\b|\bdrop\b|\bdecline\b|\bincrease\b/.test(text)) return "explain";
  return "clarify";
};

const planMatchesQuestionTopic = (question: string, plan: PeterQueryPlan) => {
  const topic = topicForQuestion(question);
  if (topic === "clarify") return "I’m not fully sure which analysis you want. Please name the comparison, ranking, explanation, overlap, counterfactual, or recommendation you need.";
  if (topic === "top" && !["top_n", "factor_rank"].includes(plan.intent)) return "Your question asks for a ranking, but the resolved query is not a ranking.";
  if (topic !== "top" && topic !== plan.intent) return `Your question asks for ${topic}, but the resolved query is ${plan.intent}.`;
  return null;
};

const rankLimit = (question: string) => {
  const text = normalise(question);
  const numeric = text.match(/\btop\s+(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+(?:biggest|largest|highest|factor|driver)\b/);
  if (numeric) return Math.min(Math.max(Number(numeric[1] ?? numeric[2]), 1), 20);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const found = Object.entries(words).find(([word]) => new RegExp(`\\btop\\s+${word}\\b|\\b${word}\\s+(?:biggest|largest|highest)`, "i").test(text));
  return found ? found[1] : 5;
};

const comparisonRowsFromImport = (rows: PeterImportRow[], analysis: KpiAnalysis) => rows.flatMap(row => {
  if (row.excluded || (analysis.outlierSensitivity?.explanationChanged && row.isOutlier)) return [];
  if (!row.cleanedValues || typeof row.cleanedValues !== "object" || Array.isArray(row.cleanedValues)) return [];
  const values = row.cleanedValues as Record<string, unknown>;
  const metric = values[analysis.metric];
  const date = values[analysis.dateColumn];
  if (typeof metric !== "number" || !Number.isFinite(metric) || typeof date !== "string" || !/^\d{4}-\d{2}/.test(date)) return [];
  const period = date.slice(0, 7);
  if (period !== analysis.previousPeriod && period !== analysis.currentPeriod) return [];
  return [{ values, metric, period }];
});

const eligibleDimensions = (profiles: ColumnProfile[]) => profiles
  .filter(profile => profile.kind === "category" || profile.kind === "identifier")
  .filter(profile => profile.name !== "__total__")
  .map(profile => profile.name);

const dimensionAliases = (dimension: string) => {
  const base = normalise(dimension);
  const singular = base.replace(/ies$/, "y").replace(/s$/, "");
  const plural = singular.endsWith("y") ? `${singular.slice(0, -1)}ies` : `${singular}s`;
  const aliases = new Set([base, singular, plural]);
  if (/country|nation|market/.test(base)) ["country", "countries", "nation", "nations", "market", "markets"].forEach(value => aliases.add(value));
  if (/company|customer|client|employer|organisation|organization/.test(base)) ["company", "companies", "customer", "customers", "client", "clients", "employer", "employers"].forEach(value => aliases.add(value));
  return Array.from(aliases);
};

const resolveDimension = (question: string, dimensions: string[]) => {
  const text = normalise(question);
  return dimensions.find(dimension => dimensionAliases(dimension).some(alias => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))) ?? null;
};

const buildFactorsFromRows = (rows: PeterImportRow[], profiles: ColumnProfile[], analysis: KpiAnalysis): PeterFactor[] => {
  const totals = new Map<string, { dimension: string; value: string; previous: number; current: number; records: number }>();
  const dimensions = eligibleDimensions(profiles).filter(dimension => dimension !== analysis.metric && dimension !== analysis.dateColumn);
  comparisonRowsFromImport(rows, analysis).forEach(row => dimensions.forEach(dimension => {
    const value = safeText(row.values[dimension]);
    if (isUnknown(value)) return;
    const key = `${dimension}\u0000${value}`;
    const current = totals.get(key) ?? { dimension, value, previous: 0, current: 0, records: 0 };
    if (row.period === analysis.previousPeriod) current.previous += row.metric;
    else current.current += row.metric;
    current.records += 1;
    totals.set(key, current);
  }));
  return materialiseFactors(totals.values(), analysis);
};

const buildFactorsFromAggregates = (aggregates: PeterAggregate[], profiles: ColumnProfile[], analysis: KpiAnalysis): PeterFactor[] => {
  const allowed = new Set(eligibleDimensions(profiles));
  const totals = new Map<string, { dimension: string; value: string; previous: number; current: number; records: number }>();
  aggregates.filter(row => row.metricColumn === analysis.metric && allowed.has(row.dimension) && (row.period === analysis.previousPeriod || row.period === analysis.currentPeriod)).forEach(row => {
    const value = safeText(row.segment);
    if (isUnknown(value)) return;
    const key = `${row.dimension}\u0000${value}`;
    const current = totals.get(key) ?? { dimension: row.dimension, value, previous: 0, current: 0, records: 0 };
    const total = Number(row.metricTotal);
    const count = Number(row.recordCount);
    if (row.period === analysis.previousPeriod) current.previous += Number.isFinite(total) ? total : 0;
    else current.current += Number.isFinite(total) ? total : 0;
    current.records += Number.isFinite(count) ? count : 0;
    totals.set(key, current);
  });
  return materialiseFactors(totals.values(), analysis);
};

const materialiseFactors = (totals: Iterable<{ dimension: string; value: string; previous: number; current: number; records: number }>, analysis: KpiAnalysis) => Array.from(totals, item => {
  const impact = item.current - item.previous;
  const contribution = Math.abs(analysis.change) > 0 ? Math.min(1, Math.abs(impact) / Math.abs(analysis.change)) : 0;
  return { ...item, impact, confidence: Math.round(Math.min(99, 65 + contribution * 34)) };
});

const byCurrent = (left: PeterFactor, right: PeterFactor) => right.current - left.current || Math.abs(right.impact) - Math.abs(left.impact) || left.value.localeCompare(right.value);
const byAbsoluteChange = (left: PeterFactor, right: PeterFactor) => Math.abs(right.impact) - Math.abs(left.impact) || left.dimension.localeCompare(right.dimension) || left.value.localeCompare(right.value);

const findMentionedFactor = (question: string, factors: PeterFactor[], dimension: string | null = null) => {
  const text = normalise(question);
  return [...factors]
    .filter(factor => !dimension || factor.dimension === dimension)
    .sort((left, right) => right.value.length - left.value.length)
    .find(factor => text.includes(normalise(factor.value))) ?? null;
};

export const planPeterQuestion = (question: string, analysis: KpiAnalysis, profiles: ColumnProfile[], aggregates: PeterAggregate[], rows?: PeterImportRow[]): PeterQueryPlan => {
  const text = normalise(question);
  const dimensions = eligibleDimensions(profiles).filter(dimension => dimension !== analysis.metric && dimension !== analysis.dateColumn);
  const availableFactors = rows ? buildFactorsFromRows(rows, profiles, analysis) : buildFactorsFromAggregates(aggregates, profiles, analysis);
  const dimension = resolveDimension(text, dimensions);
  const mentionedFactor = findMentionedFactor(question, availableFactors);
  const entity = mentionedFactor?.value ?? null;
  const asksTop = /\btop\b|\bhighest\b|\blargest\b|\bbiggest\b|\brank(?:ed|ing)?\b/.test(text);
  const asksOther = /\baside\b|\bbesides\b|\bother\b|\bexcluding\b|\bexcept\b|\bafter\b/.test(text);
  const asksExplicitTopList = /\btop\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(text);
  const asksRecommendation = /\bfix\b|\bpriority\b|\bprioritise\b|\bprioritize\b|\bwhat should\b|\bnext step\b|\bfocus on\b/.test(text);
  const asksOverlap = /\boverlap\b|\bco-?occur(?:ring|rence)?\b|\btogether with\b/.test(text);
  const asksCounterfactual = /\bwhat if\b|\bstayed flat\b|\bwithout\b/.test(text);
  const asksCompanyOrRows = /\bcompany\b|\bcompanies\b|\bcustomer\b|\bclient\b|\bemployer\b|\brow\b|\brows\b|\btransaction\b/.test(text);
  const namedCompanyReference = /\b(?:company|customer|client|employer)\s+(?!changed?\b|changes?\b|with\b|within\b|or\b|and\b|that\b)([a-z0-9][a-z0-9 .&-]{1,80})/.test(text);
  const companyFactor = findMentionedFactor(question, availableFactors.filter(factor => /company|customer|client|employer|organisation|organization/i.test(factor.dimension)));
  const asksWhy = /\bwhy\b|\bcause\b|\bexplain\b|\bchanged?\b|\bdrop\b|\bdecline\b|\bincrease\b/.test(text);
  const exclusions = asksOther && entity ? [entity] : [];
  const rankBy: PeterQueryPlan["rankBy"] = /\bfactor\b|\bimpact\b|\baffected\b|\bchange\b/.test(text) && !/\btop\s+\d+\s+(?:countries|country|products|product|companies|company|regions|region)\b/.test(text) ? "absolute_change" : "current";
  if (asksOverlap && !entity && !rows) return { intent: "overlap", dimension: null, entity: null, exclusions: [], limit: 5, rankBy: "absolute_change", needsRows: true, reason: "resolve_overlap_scope_in_rows" };
  if (asksOverlap && !entity) return { intent: "unsupported", dimension: null, entity: null, exclusions: [], limit: 0, rankBy: "current", needsRows: false, reason: "overlap_scope_not_found" };
  if (asksOverlap) return { intent: "overlap", dimension: mentionedFactor?.dimension ?? dimension, entity, exclusions: [], limit: 5, rankBy: "absolute_change", needsRows: true, reason: "co_occurrence_request" };
  if (namedCompanyReference && !companyFactor && !rows) return { intent: "drilldown", dimension, entity: null, exclusions: [], limit: rankLimit(question), rankBy: "absolute_change", needsRows: true, reason: "resolve_named_company_in_rows" };
  if (namedCompanyReference && !companyFactor) return { intent: "unsupported", dimension: null, entity: null, exclusions: [], limit: 0, rankBy: "current", needsRows: false, reason: "named_company_not_found" };
  if (asksOther && dimension && !asksExplicitTopList) return { intent: "compare", dimension, entity, exclusions, limit: 1, rankBy: "current", needsRows: !availableFactors.some(factor => factor.dimension === dimension) || Boolean(analysis.outlierSensitivity?.explanationChanged), reason: "excluded_entity_comparison" };
  if (asksTop && dimension) return { intent: "top_n", dimension, entity, exclusions, limit: rankLimit(question), rankBy, needsRows: !availableFactors.some(factor => factor.dimension === dimension) || Boolean(analysis.outlierSensitivity?.explanationChanged), reason: "dimension_rank_request" };
  if (asksTop) return { intent: "factor_rank", dimension: null, entity: null, exclusions: [], limit: rankLimit(question), rankBy: "absolute_change", needsRows: Boolean(analysis.outlierSensitivity?.explanationChanged), reason: "cross_dimension_factor_rank" };
  if (asksCounterfactual) return { intent: "counterfactual", dimension, entity, exclusions, limit: 1, rankBy: "absolute_change", needsRows: Boolean(analysis.outlierSensitivity?.explanationChanged), reason: "counterfactual_request" };
  if (asksRecommendation) return { intent: "recommend", dimension, entity, exclusions, limit: 3, rankBy: "absolute_change", needsRows: Boolean(analysis.outlierSensitivity?.explanationChanged), reason: "data_priority_request" };
  if (asksCompanyOrRows && entity && asksWhy && mentionedFactor?.dimension === dimension) return { intent: "explain", dimension, entity, exclusions, limit: 3, rankBy: "absolute_change", needsRows: true, reason: "named_company_explanation" };
  if (asksCompanyOrRows) return { intent: "drilldown", dimension, entity, exclusions, scope: mentionedFactor && mentionedFactor.dimension !== dimension ? { dimension: mentionedFactor.dimension, value: mentionedFactor.value } : undefined, limit: rankLimit(question), rankBy: "absolute_change", needsRows: true, reason: "company_or_row_drilldown" };
  if (asksWhy || entity || dimension) return { intent: "explain", dimension, entity, exclusions, limit: 3, rankBy: "absolute_change", needsRows: true, reason: "entity_or_explanation_request" };
  return { intent: "unsupported", dimension: null, entity: null, exclusions: [], limit: 0, rankBy: "current", needsRows: false, reason: "no_safe_query_interpretation" };
};

export const resolvePeterPlanWithAi = async (question: string, analysis: KpiAnalysis, profiles: ColumnProfile[], aggregates: PeterAggregate[], fallback: PeterQueryPlan): Promise<PeterQueryPlan> => {
  const dimensions = eligibleDimensions(profiles).filter(dimension => dimension !== analysis.metric && dimension !== analysis.dateColumn);
  const factors = buildFactorsFromAggregates(aggregates, profiles, analysis);
  if (!dimensions.length) return fallback;
  try {
    const response = await Promise.race([
      invokeLLM({
      model: "gpt-5-mini",
      maxTokens: 300,
      reasoning: { effort: "minimal" },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "peter_query_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              intent: { type: "string", enum: ["top_n", "compare", "counterfactual", "overlap", "explain", "recommend", "drilldown", "unsupported"] },
              dimension: { type: ["string", "null"] },
              entity: { type: ["string", "null"] },
              exclusion: { type: ["string", "null"] },
              limit: { type: "integer", minimum: 1, maximum: 20 },
              rankBy: { type: "string", enum: ["current", "absolute_change"] },
            },
            required: ["intent", "dimension", "entity", "exclusion", "limit", "rankBy"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: "Interpret a KPI analyst question into a query plan. You do not calculate results or answer the user. Use only the supplied dimensions and known entities. If the request needs outside knowledge, prediction, or an entity that is not present, return intent unsupported. Preserve an explicit exclusion such as 'other than United States'.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            metric: analysis.metricLabel,
            comparison: { previous: analysis.previousPeriod, current: analysis.currentPeriod },
            dimensions: dimensions.map(dimension => ({ dimension, examples: factors.filter(factor => factor.dimension === dimension).sort(byCurrent).slice(0, 30).map(factor => factor.value) })),
          }),
        },
      ],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Peter query planning timed out")), PETER_PLANNER_TIMEOUT_MS)),
    ]);
    const content = response.choices[0]?.message.content;
    if (typeof content !== "string") return fallback;
    const proposed = JSON.parse(content) as { intent?: PeterIntent; dimension?: string | null; entity?: string | null; exclusion?: string | null; limit?: number; rankBy?: "current" | "absolute_change" };
    if (!proposed.intent || proposed.intent === "unsupported") return { ...fallback, intent: "unsupported", reason: "ai_could_not_safely_interpret" };
    const dimension = proposed.dimension ? dimensions.find(candidate => normalise(candidate) === normalise(proposed.dimension!)) ?? null : null;
    if (["top_n", "compare"].includes(proposed.intent) && !dimension) return fallback;
    const entityExists = (value: string | null | undefined) => !value || factors.some(factor => (!dimension || factor.dimension === dimension) && normalise(factor.value) === normalise(value));
    if (!entityExists(proposed.entity) || !entityExists(proposed.exclusion)) return { ...fallback, intent: "unsupported", reason: "ai_entity_not_present" };
    if (proposed.intent === "compare" && !proposed.exclusion) return fallback;
    const limit = Math.min(Math.max(Number(proposed.limit) || 1, 1), 20);
    const needsRows = ["explain", "drilldown"].includes(proposed.intent) || Boolean(analysis.outlierSensitivity?.explanationChanged) || (Boolean(dimension) && !factors.some(factor => factor.dimension === dimension));
    return {
      intent: proposed.intent,
      dimension,
      entity: proposed.entity ?? null,
      exclusions: proposed.exclusion ? [proposed.exclusion] : [],
      limit,
      rankBy: proposed.rankBy === "absolute_change" ? "absolute_change" : "current",
      needsRows,
      reason: "structured_ai_plan",
    };
  } catch {
    return fallback;
  }
};

const limitation = (analysis: KpiAnalysis, dimensions: string[], reason: string) => `I can’t answer that specific question from this import with confidence. ${reason} I can reliably compare ${dimensions.slice(0, 8).join(", ") || "the detected dimensions"}, rank a specific dimension, explain a named segment, show overlapping factors within a named segment, or show company-level changes where that field exists.`;
const clarification = (reason: string) => `I’m not fully sure what you’re asking — could you rephrase? ${reason} For example, you can ask for a top-ranked dimension, why a named segment changed, which factors overlap within it, or what would have happened if it stayed flat.`;

const factorFromPlan = (plan: PeterQueryPlan, factors: PeterFactor[]) => {
  const scoped = factors.filter(factor => (!plan.dimension || factor.dimension === plan.dimension) && !plan.exclusions.some(value => normalise(value) === normalise(factor.value)));
  const entity = plan.entity;
  if (entity) return scoped.find(factor => normalise(factor.value) === normalise(entity)) ?? null;
  return [...scoped].sort(plan.rankBy === "current" ? byCurrent : byAbsoluteChange)[0] ?? null;
};

const rowsForFactor = (rows: PeterImportRow[], factor: PeterFactor, analysis: KpiAnalysis) => comparisonRowsFromImport(rows, analysis).filter(row => safeText(row.values[factor.dimension]) === factor.value);

const factorDetails = (rows: ComparisonRow[], profiles: ColumnProfile[], analysis: KpiAnalysis, factor: PeterFactor) => {
  const companyColumn = profiles.find(profile => /company|customer|client|employer|organisation|organization/i.test(profile.name))?.name ?? null;
  const topCompanies = companyColumn ? (() => {
    const values = new Map<string, { previous: number; current: number }>();
    rows.forEach(row => {
      const name = safeText(row.values[companyColumn]);
      if (isUnknown(name)) return;
      const current = values.get(name) ?? { previous: 0, current: 0 };
      if (row.period === analysis.previousPeriod) current.previous += row.metric;
      else current.current += row.metric;
      values.set(name, current);
    });
    return Array.from(values, ([value, amounts]) => ({ dimension: companyColumn, value, previous: amounts.previous, current: amounts.current, impact: amounts.current - amounts.previous, records: 0, confidence: factor.confidence })).filter(item => item.impact !== 0).sort(byAbsoluteChange).slice(0, 3);
  })() : [];
  return { companyColumn, topCompanies };
};

const validateResult = (plan: PeterQueryPlan, items: PeterFactor[]) => {
  if (plan.intent === "top_n" && plan.dimension && items.some(item => item.dimension !== plan.dimension)) return "The calculated ranking did not stay within the requested dimension.";
  if (plan.exclusions.length && items.some(item => plan.exclusions.some(exclusion => normalise(exclusion) === normalise(item.value)))) return "The calculated comparison included an entity the question explicitly excluded.";
  if (plan.intent === "compare" && !items.length) return "No comparable entity remained after applying the requested exclusion.";
  return null;
};

export const answerPeterQuery = (input: { question: string; analysis: KpiAnalysis; profiles: ColumnProfile[]; aggregates: PeterAggregate[]; rows?: PeterImportRow[]; plan: PeterQueryPlan }): PeterAnswer => {
  const { question, analysis, profiles, aggregates, rows, plan } = input;
  const dimensions = eligibleDimensions(profiles).filter(dimension => dimension !== analysis.metric && dimension !== analysis.dateColumn);
  const source = rows ? "cleaned_rows" as const : "aggregates" as const;
  const factors = rows ? buildFactorsFromRows(rows, profiles, analysis) : buildFactorsFromAggregates(aggregates, profiles, analysis);
  const previous = longReadablePeriod(analysis.previousPeriod);
  const current = longReadablePeriod(analysis.currentPeriod);
  const unsupported = (reason: string): PeterAnswer => ({ answer: limitation(analysis, dimensions, reason), confidence: analysis.confidence, plan, evidence: { dimension: plan.dimension, items: [], exclusionApplied: plan.exclusions, source } });
  const askForClarification = (reason: string): PeterAnswer => ({ answer: clarification(reason), confidence: analysis.confidence, plan, evidence: { dimension: null, items: [], exclusionApplied: [], source } });
  const topicMismatch = plan.intent === "unsupported" ? (plan.reason === "no_safe_query_interpretation" || plan.reason === "ai_could_not_safely_interpret" ? "I could not confidently map this wording to a distinct data query." : null) : planMatchesQuestionTopic(question, plan);
  if (topicMismatch) return askForClarification(topicMismatch);
  if (plan.intent === "unsupported") {
    if (plan.reason === "named_company_not_found") return unsupported("I could not find a matching company, customer, client, or employer in the cleaned data.");
    if (plan.reason === "ai_entity_not_present") return unsupported("The named entity was not present in the cleaned data, so I will not substitute a different segment.");
    if (plan.reason === "overlap_scope_not_found") return askForClarification("I could not identify the named segment whose overlapping factors you want to examine.");
    return askForClarification("I could not confidently map this wording to a distinct data query.");
  }
  if (plan.intent === "top_n") {
    if (!plan.dimension) return unsupported("Please name a dimension, such as countries, products, regions, or companies.");
    const items = factors.filter(factor => factor.dimension === plan.dimension && !plan.exclusions.some(exclusion => normalise(exclusion) === normalise(factor.value))).sort(plan.rankBy === "current" ? byCurrent : byAbsoluteChange).slice(0, plan.limit);
    const invalid = validateResult(plan, items);
    if (invalid || !items.length) return unsupported(invalid ?? `No measurable ${plan.dimension} values were found in the comparison periods.`);
    const listed = items.map((item, index) => `${index + 1}. ${item.value} — ${plainMetric(plan.rankBy === "current" ? item.current : Math.abs(item.impact), analysis.currencySymbol)}${plan.rankBy === "current" ? ` in ${current}` : " absolute change"} (from ${plainMetric(item.previous, analysis.currencySymbol)}; ${signedMetric(item.impact, analysis.currencySymbol)} change)`).join("; ");
    return { answer: `The top ${items.length} ${pluralise(plan.dimension.toLowerCase(), items.length)} by ${plan.rankBy === "current" ? `current-period ${analysis.metricLabel.toLowerCase()}` : "absolute change"} are: ${listed}. This ranking is calculated only within ${plan.dimension}, not across unrelated dimensions.`, confidence: Math.round(items.reduce((total, item) => total + item.confidence, 0) / items.length), plan, evidence: { dimension: plan.dimension, items, exclusionApplied: plan.exclusions, source } };
  }
  if (plan.intent === "factor_rank") {
    const items = factors.sort(byAbsoluteChange);
    const focus = items[plan.limit - 1];
    if (!focus) return unsupported(`This import has only ${items.length} measurable factor${items.length === 1 ? "" : "s"} across its eligible dimensions.`);
    return { answer: `The ${ordinal(plan.limit)} biggest measured factor is ${focus.dimension}: ${focus.value}. It moved from ${plainMetric(focus.previous, analysis.currencySymbol)} in ${previous} to ${plainMetric(focus.current, analysis.currencySymbol)} in ${current}, an impact of ${signedMetric(focus.impact, analysis.currencySymbol)}. This is ranked across individual dimension/value factors, so overlapping factors should not be added together.`, confidence: focus.confidence, plan, evidence: { dimension: null, items: [focus], exclusionApplied: [], source } };
  }
  if (plan.intent === "compare") {
    if (!plan.dimension || !plan.exclusions.length) return unsupported("A comparison needs a named dimension and an entity to compare against.");
    const items = factors.filter(factor => factor.dimension === plan.dimension && !plan.exclusions.some(exclusion => normalise(exclusion) === normalise(factor.value))).sort(byCurrent).slice(0, 1);
    const invalid = validateResult(plan, items);
    if (invalid || !items.length) return unsupported(invalid ?? `No other ${plan.dimension} values were available after the exclusion.`);
    const focus = items[0];
    return { answer: `Excluding ${plan.exclusions.join(", ")}, the highest ${plan.dimension.toLowerCase()} by current-period ${analysis.metricLabel.toLowerCase()} is ${focus.value} at ${plainMetric(focus.current, analysis.currencySymbol)} in ${current}. It was ${plainMetric(focus.previous, analysis.currencySymbol)} in ${previous}, a ${signedMetric(focus.impact, analysis.currencySymbol)} change.`, confidence: focus.confidence, plan, evidence: { dimension: plan.dimension, items, exclusionApplied: plan.exclusions, source } };
  }
  if (plan.intent === "recommend") {
    const items = factors.filter(factor => factor.impact < 0 && !/company|customer|client|employer/i.test(factor.dimension)).sort(byAbsoluteChange).slice(0, plan.limit);
    if (!items.length) return unsupported("There were no negative measurable dimension changes in the selected comparison.");
    const listed = items.map((item, index) => `${index + 1}. ${item.dimension}: ${item.value} (${signedMetric(item.impact, analysis.currencySymbol)})`).join("; ");
    return { answer: `Based on the cleaned data, prioritise: ${listed}. These are the largest negative dimension-level movements between ${previous} and ${current}; they are evidence-backed priorities, not an external business diagnosis.`, confidence: Math.round(items.reduce((total, item) => total + item.confidence, 0) / items.length), plan, evidence: { dimension: null, items, exclusionApplied: [], source } };
  }
  if (plan.intent === "overlap") {
    if (!rows || !plan.dimension || !plan.entity) return askForClarification("I need a named segment and its cleaned-row evidence to calculate overlapping factors.");
    const scopeFactor = factors.find(factor => factor.dimension === plan.dimension && normalise(factor.value) === normalise(plan.entity ?? ""));
    if (!scopeFactor) return askForClarification(`I could not find ${plan.dimension}: ${plan.entity} in the cleaned data.`);
    const scopedRows = rowsForFactor(rows, scopeFactor, analysis);
    const overlapTotals = new Map<string, { dimension: string; value: string; previous: number; current: number; records: number }>();
    scopedRows.forEach(row => dimensions.filter(dimension => dimension !== scopeFactor.dimension).forEach(dimension => {
      const value = safeText(row.values[dimension]);
      if (isUnknown(value)) return;
      const key = `${dimension}\u0000${value}`;
      const current = overlapTotals.get(key) ?? { dimension, value, previous: 0, current: 0, records: 0 };
      if (row.period === analysis.previousPeriod) current.previous += row.metric;
      else current.current += row.metric;
      current.records += 1;
      overlapTotals.set(key, current);
    }));
    const items = materialiseFactors(overlapTotals.values(), analysis).filter(item => item.impact !== 0).sort(byAbsoluteChange).slice(0, plan.limit);
    if (!items.length) return unsupported(`No measurable overlapping dimension changes were found within ${scopeFactor.dimension}: ${scopeFactor.value}.`);
    const listed = items.map((item, index) => `${index + 1}. ${item.dimension}: ${item.value} (${plainMetric(item.previous, analysis.currencySymbol)} → ${plainMetric(item.current, analysis.currencySymbol)}; ${signedMetric(item.impact, analysis.currencySymbol)})`).join("; ");
    return { answer: `Within ${scopeFactor.dimension}: ${scopeFactor.value}, the largest overlapping factors were: ${listed}. Each factor is calculated independently from rows that co-occur with this segment between ${previous} and ${current}, so the impacts can overlap and should not be added together.`, confidence: Math.round(items.reduce((total, item) => total + item.confidence, 0) / items.length), plan, evidence: { dimension: scopeFactor.dimension, items, exclusionApplied: [], source: "cleaned_rows" } };
  }
  if (plan.intent === "drilldown") {
    if (!rows) return unsupported("A row-level drilldown was not available for this request.");
    const companyColumn = profiles.find(profile => /company|customer|client|employer|organisation|organization/i.test(profile.name))?.name ?? null;
    if (!companyColumn) return unsupported("I could not find a usable company, customer, client, or employer field in this import.");
    const scopeFactor = plan.scope ? factors.find(factor => factor.dimension === plan.scope?.dimension && normalise(factor.value) === normalise(plan.scope?.value ?? "")) ?? null : null;
    if (plan.scope && !scopeFactor) return unsupported(`I could not find ${plan.scope.dimension}: ${plan.scope.value} in the cleaned data.`);
    if (scopeFactor) {
      const scopeRows = rowsForFactor(rows, scopeFactor, analysis);
      const details = factorDetails(scopeRows, profiles, analysis, scopeFactor);
      if (!details.topCompanies.length) return unsupported(`I could not calculate company-level changes within ${scopeFactor.dimension}: ${scopeFactor.value}.`);
      const items = details.topCompanies.slice(0, plan.limit);
      const listed = items.map((item, index) => `${index + 1}. ${item.value} (${signedMetric(item.impact, analysis.currencySymbol)})`).join("; ");
      return { answer: `Within ${scopeFactor.dimension}: ${scopeFactor.value}, the companies with the largest measured changes were: ${listed}. This is calculated from matching cleaned rows in ${previous} and ${current}.`, confidence: scopeFactor.confidence, plan, evidence: { dimension: companyColumn, items, exclusionApplied: [], source } };
    }
    const items = factors.filter(factor => factor.dimension === companyColumn).sort(byAbsoluteChange).slice(0, plan.limit);
    if (!items.length) return unsupported(`I could not calculate measurable company-level changes for ${companyColumn}.`);
    const listed = items.map((item, index) => `${index + 1}. ${item.value} (${signedMetric(item.impact, analysis.currencySymbol)})`).join("; ");
    return { answer: `The companies with the largest measured changes were: ${listed}. This is calculated from cleaned rows in ${previous} and ${current}.`, confidence: Math.round(items.reduce((total, item) => total + item.confidence, 0) / items.length), plan, evidence: { dimension: companyColumn, items, exclusionApplied: [], source } };
  }
  const focus = factorFromPlan(plan, factors);
  if (!focus) return unsupported(plan.entity ? `I could not find “${plan.entity}” in ${plan.dimension ?? "the detected dimensions"}.` : "No matching segment was found for that question.");
  const scopedRows = rows ? rowsForFactor(rows, focus, analysis) : [];
  if (plan.intent === "counterfactual") {
    const counterfactual = analysis.currentTotal - focus.impact;
    return { answer: `If ${focus.dimension}: ${focus.value} had stayed at its ${previous} level, ${analysis.metricLabel.toLowerCase()} would have been about ${plainMetric(counterfactual, analysis.currencySymbol)} in ${current}. That is ${plainMetric(Math.abs(focus.impact), analysis.currencySymbol)} ${focus.impact < 0 ? "higher" : "lower"} than the observed current-period total, based on this segment’s measured impact.`, confidence: focus.confidence, plan, evidence: { dimension: focus.dimension, items: [focus], exclusionApplied: [], source } };
  }
  const detail = rows ? factorDetails(scopedRows, profiles, analysis, focus) : { companyColumn: null, topCompanies: [] };
  const companyText = detail.topCompanies.length ? ` The largest company-level changes within this segment were ${detail.topCompanies.map(item => `${item.value} (${signedMetric(item.impact, analysis.currencySymbol)})`).join(" and ")}.` : "";
  return { answer: `${focus.dimension}: ${focus.value} moved from ${plainMetric(focus.previous, analysis.currencySymbol)} in ${previous} to ${plainMetric(focus.current, analysis.currencySymbol)} in ${current}, a ${signedMetric(focus.impact, analysis.currencySymbol)} change.${companyText} This explanation is calculated from the matching cleaned data, not inferred from the visible driver cards alone.`, confidence: focus.confidence, plan, evidence: { dimension: focus.dimension, items: [focus, ...detail.topCompanies], exclusionApplied: plan.exclusions, source } };
};
