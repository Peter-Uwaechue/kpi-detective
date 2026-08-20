import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Gauge,
  History,
  Loader2,
  LockKeyhole,
  MessageCircle,
  Moon,
  PanelTop,
  RefreshCcw,
  Send,
  Sparkles,
  TableProperties,
  UploadCloud,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ISO_CURRENCY_CODES, currencyOptionLabel } from "@shared/kpiCurrency";
import {
  answerDataQuestion,
  cleanDataset,
  createDemoRows,
  formatMetric,
  investigateKpi,
  longReadablePeriod,
  readablePeriod,
  type CleanedDataset,
  type CleanedRow,
  type KpiAnalysis,
} from "@shared/kpiEngine";
import "./KPIDetective.css";

type Stage = "upload" | "cleaning" | "review" | "results";
type ChatMessage = { id: string; role: "assistant" | "user"; text: string; confidence?: number; generated?: boolean; failed?: boolean };
type HistoryEntry = { id: string; at: string; metric: string; changePercent: number; summary: string; currentTotal?: number; previousTotal?: number; currentPeriod?: string; primaryCause?: string; primaryDimension?: string };
type BenchmarkInsight = { average: number; current: number; deltaPercent: number };
type PatternInsight = { cause: string; previousDate: string; previousChange: number } | null;

const stageDetails: Record<Exclude<Stage, "results">, { step: string; label: string }> = {
  upload: { step: "01", label: "Upload data" },
  cleaning: { step: "02", label: "Clean & validate" },
  review: { step: "03", label: "Review quality" },
};

// Imports run synchronously in the no-worker deployment and are capped from end-to-end benchmark results.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "5MB";
const MAX_UPLOAD_ROWS_LABEL = "100,000 rows";

const currency = (value: number, symbol = "") => formatMetric(value, symbol);
const signedCurrency = (value: number, symbol = "") => `${value > 0 ? "+" : value < 0 ? "−" : ""}${currency(Math.abs(value), symbol)}`;
const changeText = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const displayPeriod = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? readablePeriod(value) : "";
const humanizePeriodText = (value: string) => value.replace(/\b\d{4}-(?:0[1-9]|1[0-2])\b/g, period => longReadablePeriod(period));

type RemoteProfile = { name: string; kind: string; confidence?: number; isSelectedMetric?: boolean; isMetricCandidate?: boolean; candidateReason?: string; label?: string; selectionReason?: string };
type RemoteImport = {
  id: string;
  originalFileName: string;
  status: "uploading" | "queued" | "profiling" | "ingesting" | "analyzing" | "complete" | "failed" | "cancelled";
  sourceRowCount: number;
  usableRowCount: number;
  columnsJson: unknown;
  cleaningSummaryJson: unknown;
  analysisJson: unknown;
  workerCheckpointJson: unknown;
  errorMessage: string | null;
};

type ContainmentReviewProposal = { id: string; column: string; containedValue: string; containingValue: string; containedCount: number; containingCount: number; finalLabel?: string; status: "pending" | "merged" | "kept-separate" | "superseded" };
type RemoteCleaningLogEntry = { key: string; title: string; detail: string; count: number; severity: "success" | "warning" | "info" };
const remoteLogs = (value: unknown) => Array.isArray(value) ? value as RemoteCleaningLogEntry[] : [];
const remoteProfiles = (value: unknown) => Array.isArray(value) ? value as RemoteProfile[] : [];
const containmentReviewProposals = (value: unknown) => {
  const checkpoint = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const review = checkpoint.containmentReview && typeof checkpoint.containmentReview === "object" && !Array.isArray(checkpoint.containmentReview) ? checkpoint.containmentReview as Record<string, unknown> : {};
  return Array.isArray(review.proposals) ? review.proposals as ContainmentReviewProposal[] : [];
};

const safeImportError = (reason: unknown, fallback: string) => {
  const message = reason instanceof Error ? reason.message.trim() : "";
  // Do not expose database internals, SQL fragments, JSON payloads, or stack
  // details if an unexpected server failure reaches a browser mutation.
  if (!message || message.length > 320 || /failed query|worker_checkpoint|kpi_import|cleaning_summary|jsonb|postgres|drizzle|sqlstate|\b(?:select|update|insert|delete)\b.+\b(?:from|set|into)\b|\$\d+|\{[^}]*\"(?:proposals|params)\"/i.test(message)) return fallback;
  return message;
};

function Logo() {
  return <div className="kpi-logo" aria-label="KPI Detective"><span className="kpi-logo-mark"><span /><span /><span /></span><span>KPI <b>Detective</b></span></div>;
}

function StageRail({ stage }: { stage: Stage }) {
  const items = ["Upload", "Clean", "Investigate", "Explain"];
  const activeIndex = stage === "upload" ? 0 : stage === "cleaning" ? 1 : stage === "review" ? 2 : 3;
  return <div className="stage-rail" aria-label="Analysis progress">{items.map((item, index) => <div className={`stage-item ${index <= activeIndex ? "is-active" : ""} ${index === activeIndex ? "is-current" : ""}`} key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></div>)}</div>;
}

function MetricPill({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "positive" | "negative" }) {
  return <div className={`metric-pill ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function AnimatedMetric({ value, symbol }: { value: number; symbol: string }) {
  const [displayedValue, setDisplayedValue] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setDisplayedValue(value); return; }
    const duration = 460;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedValue(Math.round(value * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return <strong className="animated-metric">{currency(displayedValue, symbol)}</strong>;
}

function CleaningLog({ dataset }: { dataset: CleanedDataset }) {
  return <div className="cleaning-log">{dataset.logs.map(log => <div key={log.key} className={`cleaning-log-row ${log.severity}`}>
    <div className="log-icon">{log.severity === "warning" ? <AlertTriangle size={16} /> : log.count ? <Check size={16} /> : <CircleHelp size={16} />}</div>
    <div><strong>{log.title}</strong><p>{log.detail}</p></div>
    <b>{log.count}</b>
  </div>)}</div>;
}

function RemoteCleaningLog({ logs }: { logs: ReturnType<typeof remoteLogs> }) {
  return <div className="cleaning-log">{logs.map(log => <div key={log.key} className={`cleaning-log-row ${log.severity}`}>
    <div className="log-icon">{log.severity === "warning" ? <AlertTriangle size={16} /> : log.count ? <Check size={16} /> : <CircleHelp size={16} />}</div>
    <div><strong>{log.title}</strong><p>{log.detail}</p></div>
    <b>{log.count}</b>
  </div>)}</div>;
}

function ContainmentReviewPanel({ proposals, savingProposalId, onDecision }: { proposals: ContainmentReviewProposal[]; savingProposalId: string | null; onDecision: (proposalId: string, decision: "merge" | "keep-separate", finalLabel?: string) => void }) {
  const items = proposals.filter(proposal => proposal.status === "pending");
  const [finalLabels, setFinalLabels] = useState<Record<string, string>>({});
  if (!items.length) return null;
  return <section className="containment-review-panel" aria-labelledby="containment-review-heading"><div className="containment-review-heading"><div><span className="eyebrow">Review-only relationship check</span><h2 id="containment-review-heading">Could these labels describe the same thing?</h2></div><span>{items.length} pending</span></div><p>Each pair is suggested only because the shorter value is contained in the longer one after the same whitespace, case, punctuation, Unicode, and invisible-character normalisation used by category matching. This is not proof, and no values have changed.</p><div className="containment-review-list">{items.map(proposal => { const isSaving = proposal.id === savingProposalId; const defaultLabel = `${proposal.containedValue} / ${proposal.containingValue} (merged)`; const finalLabel = finalLabels[proposal.id] ?? defaultLabel; return <article className="containment-review-item" key={proposal.id}><div><strong>{proposal.column}</strong><p><b>{proposal.containedValue}</b> ({proposal.containedCount.toLocaleString()} rows) is contained within <b>{proposal.containingValue}</b> ({proposal.containingCount.toLocaleString()} rows).</p><label className="containment-final-label">Final display label after merge<input value={finalLabel} maxLength={160} onChange={event => setFinalLabels(current => ({ ...current, [proposal.id]: event.target.value }))} disabled={isSaving} /></label><small>This label will be used in the dashboard, export, and Peter’s follow-up questions.</small></div><div className="containment-review-actions"><button className="secondary-action" onClick={() => onDecision(proposal.id, "keep-separate")} disabled={isSaving}>{isSaving ? "Saving…" : "No, keep separate"}</button><button className="primary-action" onClick={() => onDecision(proposal.id, "merge", finalLabel.trim() || defaultLabel)} disabled={isSaving}>{isSaving ? "Saving…" : "Yes, merge them"}</button></div></article>; })}</div></section>;
}

function ConfidenceRing({ value }: { value: number }) {
  return <div className="confidence-ring" style={{ "--confidence": `${value * 3.6}deg` } as React.CSSProperties}><div><strong>{value}%</strong><span>confident</span></div></div>;
}

function TrendSparkline({ data, decline, delay }: { data: { period: string; total: number }[]; decline: boolean; delay: number }) {
  return <div className="sparkline"><ResponsiveContainer width="100%" height={52}><AreaChart data={data} margin={{ top: 4, right: 1, bottom: 0, left: 1 }}><defs><linearGradient id={`gradient-${decline ? "down" : "up"}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={decline ? "#ef7b73" : "#62c7a8"} stopOpacity={0.4} /><stop offset="100%" stopColor={decline ? "#ef7b73" : "#62c7a8"} stopOpacity={0.02} /></linearGradient></defs><Area type="monotone" dataKey="total" stroke={decline ? "#ef7b73" : "#62c7a8"} strokeWidth={2} fill={`url(#gradient-${decline ? "down" : "up"})`} isAnimationActive animationDuration={380} animationBegin={delay} /></AreaChart></ResponsiveContainer></div>;
}

function CurrencySelector({ analysis, onSelect, pending, compact = false }: { analysis: KpiAnalysis; onSelect: (currencyCode: string) => void; pending: boolean; compact?: boolean }) {
  const currencyCode = analysis.currencyCode ?? "USD";
  const sourceMessage = analysis.currencySource === "manual"
    ? `Using your selected ${currencyCode} display setting.`
    : analysis.currencySource === "detected"
      ? `${currencyCode} detected from your uploaded KPI values.`
      : `Currency not detected — displaying ${currencyCode} by default.`;
  return <section className={`currency-selector ${compact ? "is-compact" : ""}`} aria-label="Display currency"><div className="currency-selector-copy"><span className="eyebrow">Display currency</span>{!compact && <p>{sourceMessage} Values are not converted.</p>}</div><label><span className="sr-only">Choose display currency</span><select value={currencyCode} onChange={event => onSelect(event.target.value)} disabled={pending} aria-label="Choose display currency">{ISO_CURRENCY_CODES.map(code => <option value={code} key={code}>{currencyOptionLabel(code)}</option>)}</select></label>{pending && <Loader2 className="spin" size={16} aria-label="Updating currency"/>}</section>;
}

function CauseCard({ cause, analysis, index }: { cause: KpiAnalysis["causes"][number]; analysis: KpiAnalysis; index: number }) {
  const decline = cause.impact < 0;
  const outlierAdjusted = Boolean(analysis.outlierSensitivity?.explanationChanged);
  const counterfactualBase = cause.counterfactual + cause.impact;
  const basisLabel = outlierAdjusted ? "Based on outlier-excluded current total" : "Based on current-period total";
  return <article className={`cause-card ${decline ? "is-decline" : "is-growth"}`} style={{ "--cause-delay": `${index * 70}ms` } as React.CSSProperties}>
    <div className="cause-card-top"><div><span className="cause-label">{cause.dimension}</span><h3>{cause.value}</h3></div><ConfidenceRing value={cause.confidence} /></div>
    <div className="cause-impact"><span>Impact on {analysis.metricLabel.toLowerCase()} {outlierAdjusted && <b className="adjustment-badge">Outlier-adjusted</b>}</span><strong>{signedCurrency(cause.impact, analysis.currencySymbol)}</strong></div>
    <p className="cause-counterfactual">If this had stayed flat, {analysis.metricLabel.toLowerCase()} would be <b>{currency(cause.counterfactual, analysis.currencySymbol)}</b> {outlierAdjusted && <span className="adjustment-badge">Outlier-adjusted</span>}.</p>
    <p className="counterfactual-basis">{basisLabel} of <b>{currency(counterfactualBase, analysis.currencySymbol)}</b>.</p>
    <TrendSparkline data={cause.trend} decline={decline} delay={index * 70} />
    <div className="cause-footer"><span>{readablePeriod(analysis.previousPeriod)}</span><span>{readablePeriod(analysis.currentPeriod)}</span></div>
  </article>;
}

function DataTable({ dataset, onToggleExclusion, onUndoChange, onConfirmDuplicate }: { dataset: CleanedDataset; onToggleExclusion: (row: CleanedRow) => void; onUndoChange: (row: CleanedRow) => void; onConfirmDuplicate: (row: CleanedRow) => void }) {
  const [page, setPage] = useState(0);
  const columns = dataset.columns.slice(0, 7);
  const rows = dataset.rows.slice(page * 8, page * 8 + 8);
  return <div className="data-table-wrap"><div className="data-table-toolbar"><span><TableProperties size={16} />Showing {Math.min(dataset.rows.length, page * 8 + 1)}–{Math.min(dataset.rows.length, page * 8 + 8)} of {dataset.rows.length} rows</span><div><button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Previous</button><button onClick={() => setPage(Math.min(Math.ceil(dataset.rows.length / 8) - 1, page + 1))} disabled={(page + 1) * 8 >= dataset.rows.length}>Next</button></div></div>
    <div className="data-table-scroll"><table><thead><tr><th>Row</th>{columns.map(column => <th key={column.name}>{column.name}<small>{column.kind}</small></th>)}<th>Review</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className={row.excluded ? "is-excluded" : row.possibleDuplicate ? "is-flagged" : ""}><td><b>{row.rowNumber}</b>{row.excluded && <span className="row-status">Excluded</span>}</td>{columns.map(column => { const changed = row.changes.some(change => change.column === column.name); const value = row.values[column.name]; return <td key={column.name} className={changed ? "cell-changed" : ""}>{value === null ? <em>Missing</em> : String(value)}</td>; })}<td><div className="table-actions">{row.changes.length > 0 && <button onClick={() => onUndoChange(row)}>Undo fix</button>}{row.possibleDuplicate && <button onClick={() => onConfirmDuplicate(row)}>Keep row</button>}<button onClick={() => onToggleExclusion(row)}>{row.excluded ? "Restore" : "Exclude"}</button></div></td></tr>)}</tbody></table></div><p className="table-note">Highlighted cells were standardised. Excluded rows are greyed out and do not influence the investigation. Your adjustments take effect before the KPI is recalculated.</p></div>;
}

function RemoteDataTable({ importId, profiles, onChanged }: { importId: string; profiles: RemoteProfile[]; onChanged: () => void }) {
  const [page, setPage] = useState(0);
  const [reviewError, setReviewError] = useState("");
  const preview = trpc.kpiImports.preview.useQuery({ importId, page, pageSize: 100 });
  const reviewAction = trpc.kpiImports.reviewAction.useMutation();
  const columns = profiles.slice(0, 7);
  const rows = preview.data?.rows ?? [];
  const total = preview.data?.total ?? 0;
  const apply = async (input: { rowNumber: number; action: "undoChange" | "setExcluded" | "keepPossibleDuplicate" | "editValue"; column?: string; value?: string | null; excluded?: boolean }) => {
    try {
      setReviewError("");
      await reviewAction.mutateAsync({ importId, ...input });
      await preview.refetch();
      onChanged();
    } catch (reason) { setReviewError(reason instanceof Error ? reason.message : "We could not save that review change."); }
  };
  const editCell = (rowNumber: number, column: string, current: unknown) => {
    const next = window.prompt(`Edit cleaned ${column}`, current === null || current === undefined ? "" : String(current));
    if (next !== null) void apply({ rowNumber, action: "editValue", column, value: next });
  };
  return <div className="data-table-wrap"><div className="data-table-toolbar"><span><TableProperties size={16} />{preview.isLoading ? "Loading preview…" : `Showing ${total ? page * 100 + 1 : 0}–${Math.min(total, (page + 1) * 100)} of ${total.toLocaleString()} rows`}</span><div><button onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0 || preview.isFetching}>Previous</button><button onClick={() => setPage(current => current + 1)} disabled={(page + 1) * 100 >= total || preview.isFetching}>Next</button></div></div>{reviewError && <div className="inline-error"><AlertTriangle size={16}/>{reviewError}</div>}<div className="data-table-scroll"><table><thead><tr><th>Row</th>{columns.map(column => <th key={column.name}>{column.name}<small>{column.kind}</small></th>)}<th>Review</th></tr></thead><tbody>{rows.map(row => { const raw = row.rawValues as Record<string, unknown>; const cleaned = row.cleanedValues as Record<string, unknown>; const changes = Array.isArray(row.changes) ? row.changes as Array<{ column?: string }> : []; const lastChange = changes[changes.length - 1]; return <tr key={row.id} className={row.excluded ? "is-excluded" : row.possibleDuplicate || row.isOutlier ? "is-flagged" : ""}><td><b>{row.rowNumber}</b>{row.excluded && <span className="row-status">Excluded</span>}{row.possibleDuplicate && <span className="row-status">Possible duplicate</span>}{row.isOutlier && <span className="row-status">Outlier</span>}</td>{columns.map(column => { const value = cleaned[column.name] ?? raw[column.name] ?? ""; return <td key={column.name} className={changes.some(change => change.column === column.name) ? "cell-changed" : ""}><button className="cell-edit" title={`Edit cleaned ${column.name}`} onClick={() => editCell(row.rowNumber, column.name, value)}>{value === null ? <em>Missing</em> : String(value)}</button></td>; })}<td><div className="table-actions">{lastChange?.column && <button onClick={() => void apply({ rowNumber: row.rowNumber, action: "undoChange", column: lastChange.column })} disabled={reviewAction.isPending}>Undo last fix</button>}{row.possibleDuplicate && <button onClick={() => void apply({ rowNumber: row.rowNumber, action: "keepPossibleDuplicate" })} disabled={reviewAction.isPending}>Keep as real</button>}<button onClick={() => void apply({ rowNumber: row.rowNumber, action: "setExcluded", excluded: !row.excluded })} disabled={reviewAction.isPending}>{row.excluded ? "Restore" : "Exclude"}</button></div></td></tr>; })}</tbody></table></div><p className="table-note">This is a 100-row server page. Select any displayed value to edit it, undo the latest automatic change, review flagged duplicates, or restore/exclude a row. Press Recalculate when your review is complete.</p></div>;
}

function ChatPanel({ analysis, dataset, importId }: { analysis: KpiAnalysis; dataset?: CleanedDataset | null; importId?: string | null }) {
  const [question, setQuestion] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [askedSuggestions, setAskedSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "assistant", text: `Peter’s analysis found a change in ${analysis.metricLabel.toLowerCase()}. Ask why a segment shifted, which customer contributed, or what the KPI would have been without a driver.`, confidence: analysis.confidence }]);
  const ask = trpc.kpi.ask.useMutation();
  const askImport = trpc.kpi.askImport.useMutation();
  const importSuggestions = trpc.kpi.suggestions.useQuery({ importId: importId ?? "" }, { enabled: Boolean(importId), staleTime: 60_000 });
  const primaryDriver = analysis.causes[0]?.value ?? "the leading driver";
  const localSuggestionPool = useMemo(() => analysis.causes[0] ? [
    `Why did ${primaryDriver} change?`,
    `What if ${primaryDriver} had stayed flat?`,
  ] : [], [analysis.causes, primaryDriver]);
  const suggestionPool = importId ? (importSuggestions.data ?? []) : localSuggestionPool;
  const suggestions = suggestionPool.filter(suggestion => !askedSuggestions.includes(suggestion)).slice(0, 3);
  const send = async (customQuestion?: string) => {
    const text = (customQuestion ?? question).trim();
    if (!text || isSending) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", text };
    const local = dataset ? answerDataQuestion(text, dataset, analysis) : { answer: "Peter is preparing an answer from the backend analysis…", confidence: analysis.confidence };
    const answerId = `assistant-${Date.now()}`;
    const context = {
      metricLabel: analysis.metricLabel,
      summary: analysis.summary,
      previousPeriod: analysis.previousPeriod,
      currentPeriod: analysis.currentPeriod,
      currencySymbol: analysis.currencySymbol,
      confidence: analysis.confidence,
      causes: analysis.causes.map(cause => ({ dimension: cause.dimension, value: cause.value, impact: cause.impact, counterfactual: cause.counterfactual, confidence: cause.confidence })),
    };
    if (customQuestion) setAskedSuggestions(current => current.includes(customQuestion) ? current : [...current, customQuestion]);
    const request = importId
      ? askImport.mutateAsync({ importId, question: text })
      : ask.mutateAsync({ question: text, context });
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error("Analyst response timed out")), 12_000); });
    setMessages(current => [...current, userMessage, { id: answerId, role: "assistant", text: local.answer, confidence: local.confidence }]);
    setQuestion("");
    setIsSending(true);
    try {
      const response = await Promise.race([request, timeout]);
      const responseConfidence = "confidence" in response && typeof response.confidence === "number" ? response.confidence : undefined;
      if (response.generated || !dataset) setMessages(current => current.map(message => message.id === answerId ? { ...message, text: response.answer, generated: response.generated, confidence: responseConfidence ?? message.confidence } : message));
    } catch {
      if (!dataset) setMessages(current => current.map(message => message.id === answerId ? { ...message, text: "Something went wrong, please try again.", confidence: undefined, failed: true } : message));
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      setIsSending(false);
    }
  };
  return <section className="chat-panel"><div className="chat-heading"><div className="chat-orb"><Bot size={20} /></div><div><span className="eyebrow">Ask Peter the Analyst</span><h2>Keep investigating with Peter</h2></div><span className="context-chip"><LockKeyhole size={13} />{importId ? "Private import evidence" : "Aggregated context only"}</span></div><p className="chat-scope"><strong>Comparison scope:</strong> {longReadablePeriod(analysis.previousPeriod)} through {longReadablePeriod(analysis.currentPeriod)}. Peter’s drivers, rankings, and comparisons use this same window as the dashboard. Full-history rankings and year-over-year comparisons are not available yet.</p><div className="chat-messages">{messages.map(message => <div className={`chat-message ${message.role} ${message.failed ? "is-error" : ""}`} key={message.id}><div className="message-avatar">{message.role === "assistant" ? <Sparkles size={15} /> : "You"}</div><div><p>{message.text}</p>{message.confidence !== undefined && <small>{message.generated ? "Peter’s AI answer grounded in KPI context" : "Calculated confidence"}: {message.confidence}%</small>}</div></div>)}</div><div className="chat-suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => void send(suggestion)} disabled={isSending}>{suggestion}<ChevronRight size={14} /></button>)}</div><form className="chat-input" onSubmit={event => { event.preventDefault(); void send(); }}><input value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask Peter about your data" aria-label="Ask Peter about your data" disabled={isSending} /><button type="submit" disabled={!question.trim() || isSending}>{isSending ? <Loader2 className="spin" size={17} /> : <Send size={17} />}</button></form></section>;
}

export default function KPIDetective() {
  const [, navigate] = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [dataset, setDataset] = useState<CleanedDataset | null>(null);
  const [remoteImportId, setRemoteImportId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<KpiAnalysis | null>(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [dark, setDark] = useState(false);
  const [showData, setShowData] = useState(false);
  const [onboarding, setOnboarding] = useState(() => typeof window !== "undefined" && sessionStorage.getItem("kpi-detective-tour-dismissed") !== "true");
  const [requestedMetric, setRequestedMetric] = useState("");
  const [savingContainmentProposalId, setSavingContainmentProposalId] = useState<string | null>(null);
  const containmentDecisionQueue = useRef(Promise.resolve());
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("kpi-detective-history") ?? "[]") as HistoryEntry[]; } catch { return []; }
  });

  const { isAuthenticated, loading: authLoading } = useAuth();
  const createUpload = trpc.kpiImports.createUpload.useMutation();
  const completeUpload = trpc.kpiImports.completeUpload.useMutation();
  const recalculateImport = trpc.kpiImports.recalculate.useMutation();
  const selectRemoteMetric = trpc.kpiImports.selectMetric.useMutation();
  const setRemoteCurrency = trpc.kpiImports.setCurrency.useMutation();
  const reviewContainment = trpc.kpiImports.reviewContainment.useMutation();
  const remoteStatus = trpc.kpiImports.get.useQuery({ importId: remoteImportId ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(remoteImportId), refetchInterval: query => {
    const status = (query.state.data as RemoteImport | undefined)?.status;
    return status === "complete" || status === "failed" || status === "cancelled" ? false : 2500;
  } });
  const remoteImport = remoteStatus.data as RemoteImport | undefined;
  const remoteMetricCandidates = (remoteImport ? remoteProfiles(remoteImport.columnsJson) : []).filter(profile => profile.kind === "number" && profile.isMetricCandidate);
  const recommendedMetric = remoteMetricCandidates.find(profile => profile.isSelectedMetric) ?? remoteMetricCandidates[0];
  const activeRequestedMetric = requestedMetric || recommendedMetric?.name || "";
  const recalculateRemoteImport = async () => {
    if (!remoteImportId || recalculateImport.isPending) return;
    try {
      setError("");
      const result = await recalculateImport.mutateAsync({ importId: remoteImportId });
      setAnalysis(result.analysis as KpiAnalysis);
      await remoteStatus.refetch();
      setShowData(false);
      setStage("results");
    } catch (reason) { setError(safeImportError(reason, "We could not recalculate this import. Please try again.")); }
  };

  useEffect(() => {
    document.title = "KPI Detective — Understand your numbers";
  }, []);

  useEffect(() => {
    if (!remoteImport) return;
    setFileName(remoteImport.originalFileName);
    const selectedMetric = remoteProfiles(remoteImport.columnsJson).find(profile => profile.kind === "number" && profile.isMetricCandidate && profile.isSelectedMetric);
    if (selectedMetric) setRequestedMetric(selectedMetric.name);
    if (remoteImport.status === "complete" && remoteImport.analysisJson) {
      setAnalysis(remoteImport.analysisJson as KpiAnalysis);
      setDataset(null);
      setStage("review");
    }
    if (remoteImport.status === "failed" || remoteImport.status === "cancelled") {
      setError(safeImportError(new Error(remoteImport.errorMessage || ""), "This file could not be processed. Please use a smaller CSV or XLSX file and try again."));
      setStage("upload");
    }
  }, [remoteImport]);

  const decideRemoteContainment = (proposalId: string, decision: "merge" | "keep-separate", finalLabel?: string) => {
    if (!remoteImportId) return;
    // Import review updates the same persisted checkpoint. Queue rapid actions so
    // each card can stay independently interactive without racing a later save.
    containmentDecisionQueue.current = containmentDecisionQueue.current.catch(() => undefined).then(async () => {
      setSavingContainmentProposalId(proposalId);
      try {
        setError("");
        const result = await reviewContainment.mutateAsync({ importId: remoteImportId, proposalId, decision, ...(decision === "merge" && finalLabel ? { finalLabel } : {}) });
        if (result.analysis) setAnalysis(result.analysis as KpiAnalysis);
        await remoteStatus.refetch();
      } catch (reason) { setError(safeImportError(reason, "Something went wrong saving your review — please try again.")); }
      finally { setSavingContainmentProposalId(null); }
    });
  };

  const chooseRemoteCurrency = async (currencyCode: string) => {
    if (!remoteImportId || !analysis || currencyCode === (analysis.currencyCode ?? "USD") || setRemoteCurrency.isPending) return;
    try {
      setError("");
      const result = await setRemoteCurrency.mutateAsync({ importId: remoteImportId, currencyCode });
      setAnalysis(result.analysis as KpiAnalysis);
      await remoteStatus.refetch();
    } catch (reason) { setError(safeImportError(reason, "We could not update the display currency. Please try again.")); }
  };

  const chooseRemoteMetric = async () => {
    if (!remoteImportId || !activeRequestedMetric || activeRequestedMetric === recommendedMetric?.name || selectRemoteMetric.isPending) return;
    try {
      setError("");
      const result = await selectRemoteMetric.mutateAsync({ importId: remoteImportId, metricName: activeRequestedMetric });
      setAnalysis(result.analysis as KpiAnalysis);
      setRequestedMetric(activeRequestedMetric);
      await remoteStatus.refetch();
    } catch (reason) { setError(safeImportError(reason, "We could not update the KPI selection. Please try again.")); }
  };

  const startCleaning = (rows: Record<string, unknown>[], name: string) => {
    setError("");
    setRemoteImportId(null);
    setFileName(name);
    setRawRows(rows);
    setAnalysis(null);
    setDataset(null);
    setStage("cleaning");
    window.setTimeout(() => {
      try {
        setDataset(cleanDataset(rows));
        setStage("review");
      } catch (reason) {
        setStage("upload");
        setError(reason instanceof Error ? reason.message : "We could not clean this file. Please try another export.");
      }
    }, 780);
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setStage("upload");
      setFileName(file.name);
      setError(`File exceeds ${MAX_UPLOAD_LABEL} — please upload a smaller file for now.`);
      return;
    }
    if (authLoading) { setError("Checking your secure upload session. Please try again in a moment."); return; }
    if (!isAuthenticated) { setError("Sign in to upload and keep this private backend import linked to your account."); return; }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["csv", "xlsx"].includes(extension)) { setError("Upload a CSV or XLSX file. Convert legacy XLS files before import."); return; }
    try {
      setError("");
      setDataset(null);
      setAnalysis(null);
      setRawRows([]);
      setFileName(file.name);
      setStage("cleaning");
      const prepared = await createUpload.mutateAsync({ fileName: file.name, contentType: file.type || (extension === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), fileBytes: file.size });
      setRemoteImportId(prepared.importId);
      const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!upload.ok) throw new Error(`Upload to secure storage failed (${upload.status}).`);
      await completeUpload.mutateAsync({ importId: prepared.importId });
    } catch (reason) {
      setStage("upload");
      setError(safeImportError(reason, "We could not process this import. Please try a smaller file."));
    }
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => { void handleFile(event.target.files?.[0]); event.target.value = ""; };
  const onDrop = (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); void handleFile(event.dataTransfer.files?.[0]); };

  const updateDataset = (mutate: (current: CleanedDataset) => CleanedDataset) => {
    setDataset(current => current ? mutate(current) : current);
    setAnalysis(null);
  };
  const toggleExclusion = (row: CleanedRow) => updateDataset(current => ({ ...current, rows: current.rows.map(item => item.id === row.id ? { ...item, excluded: !item.excluded, exclusionReason: item.excluded ? undefined : "Excluded during review" } : item) }));
  const undoChange = (row: CleanedRow) => updateDataset(current => ({ ...current, rows: current.rows.map(item => {
    if (item.id !== row.id || !item.changes.length) return item;
    const change = item.changes[item.changes.length - 1];
    return { ...item, values: { ...item.values, [change.column]: change.from }, changes: item.changes.slice(0, -1) };
  }) }));
  const confirmDuplicate = (row: CleanedRow) => updateDataset(current => ({ ...current, rows: current.rows.map(item => item.id === row.id ? { ...item, possibleDuplicate: false, issues: item.issues.filter(issue => issue.type !== "possible-duplicate") } : item) }));

  const runInvestigation = () => {
    if (remoteImportId && analysis) {
      setStage("results");
      setShowData(false);
      return;
    }
    if (!dataset) return;
    try {
      const result = investigateKpi(dataset, rawRows);
      setAnalysis(result);
      setStage("results");
      setShowData(false);
      const primaryCause = result.causes[0];
      const entry: HistoryEntry = {
        id: `${Date.now()}`,
        at: new Date().toISOString(),
        metric: result.metricLabel,
        changePercent: result.changePercent,
        summary: result.summary,
        currentTotal: result.currentTotal,
        previousTotal: result.previousTotal,
        currentPeriod: result.currentPeriod,
        primaryCause: primaryCause?.value,
        primaryDimension: primaryCause?.dimension,
      };
      const next = [entry, ...history].slice(0, 10);
      setHistory(next);
      localStorage.setItem("kpi-detective-history", JSON.stringify(next));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "We could not complete the investigation."); }
  };

  const chartData = useMemo(() => analysis?.causes.map(cause => ({ name: `${cause.dimension}: ${cause.value}`, impact: cause.impact })) ?? [], [analysis]);
  const offsettingCauses = analysis?.offsettingCauses ?? [];
  const usesOutlierAdjustedDrivers = Boolean(analysis?.outlierSensitivity?.explanationChanged && typeof analysis.outlierSensitivity.outlierExcludedChange === "number");
  const displayedDriverChange = usesOutlierAdjustedDrivers ? analysis?.outlierSensitivity?.outlierExcludedChange ?? 0 : analysis?.change ?? 0;
  const driverDirection = displayedDriverChange === 0 ? "moving the KPI" : displayedDriverChange < 0 ? "driving the decline" : "driving the growth";
  const offsetDirection = displayedDriverChange < 0 ? "Positive factors offsetting the decline" : "Negative factors offsetting the growth";
  const driverBasisDescription = usesOutlierAdjustedDrivers
    ? `Outlier-adjusted driver basis: ${currency(analysis?.outlierSensitivity?.outlierExcludedPreviousTotal ?? 0, analysis?.currencySymbol)} to ${currency(analysis?.outlierSensitivity?.outlierExcludedCurrentTotal ?? 0, analysis?.currencySymbol)}; ${changeText(analysis?.outlierSensitivity?.outlierExcludedChangePercent ?? 0)}.`
    : "Driver basis: all included transactions, matching the headline KPI.";
  const benchmark = useMemo<BenchmarkInsight | null>(() => {
    if (!analysis) return null;
    const prior = history.filter(item => item.metric === analysis.metricLabel && typeof item.currentTotal === "number");
    if (!prior.length) return null;
    const average = prior.reduce((sum, item) => sum + (item.currentTotal ?? 0), 0) / prior.length;
    return { average, current: analysis.currentTotal, deltaPercent: average ? ((analysis.currentTotal - average) / average) * 100 : 0 };
  }, [analysis, history]);
  const recurringPattern = useMemo<PatternInsight>(() => {
    if (!analysis?.causes[0]) return null;
    const match = history.find(item => item.metric === analysis.metricLabel && item.primaryCause === analysis.causes[0].value && item.currentPeriod !== analysis.currentPeriod);
    return match && match.currentPeriod ? { cause: `${match.primaryDimension ?? "Driver"}: ${match.primaryCause}`, previousDate: match.currentPeriod, previousChange: match.changePercent } : null;
  }, [analysis, history]);
  const downloadReport = () => {
    if (!analysis) return;
    const causeRows = analysis.causes.map(cause => `<li><strong>${cause.dimension}: ${cause.value}</strong> — ${signedCurrency(cause.impact, analysis.currencySymbol)} impact; ${cause.confidence}% confidence; counterfactual ${currency(cause.counterfactual, analysis.currencySymbol)}.</li>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>KPI Detective report — ${analysis.metricLabel}</title><style>body{font:16px Arial,sans-serif;max-width:760px;margin:48px auto;color:#173142;line-height:1.6}h1{font-size:38px}h2{margin-top:32px}strong{color:#116f61}.meta{color:#64747b}li{margin:12px 0}</style></head><body><p class="meta">KPI Detective · ${readablePeriod(analysis.previousPeriod)} → ${readablePeriod(analysis.currentPeriod)}</p><h1>${analysis.metricLabel}: ${currency(analysis.currentTotal, analysis.currencySymbol)}</h1><p><strong>${analysis.changePercent.toFixed(1)}%</strong> change from ${currency(analysis.previousTotal, analysis.currencySymbol)}.</p><h2>What changed</h2><p>${humanizePeriodText(analysis.summary)}</p><h2>Priority causes</h2><ul>${causeRows}</ul><h2>Data quality</h2><p>${analysis.totalRowsUsed} usable rows; ${analysis.confidence}% calculated confidence.</p></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kpi-detective-${analysis.metricLabel.toLowerCase().replace(/\\W+/g, "-")}-report.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const closeTour = () => { setOnboarding(false); sessionStorage.setItem("kpi-detective-tour-dismissed", "true"); };

  if (stage === "results" && analysis && (dataset || remoteImportId)) return <main className={`kpi-app ${dark ? "dark-mode" : ""}`}>
    <header className="app-header dashboard-header"><button className="brand-button" onClick={() => { setStage("upload"); setAnalysis(null); setRemoteImportId(null); }}><Logo /></button><div className="dashboard-header-actions"><span className="analysis-date"><ClipboardCheck size={15} />Analysis complete</span>{remoteImportId && <CurrencySelector analysis={analysis} onSelect={currencyCode => void chooseRemoteCurrency(currencyCode)} pending={setRemoteCurrency.isPending} compact/>}<button className="icon-button" aria-label="Toggle colour theme" onClick={() => setDark(current => !current)}>{dark ? <Moon size={18} /> : <Moon size={18} />}</button><button className="outline-action" onClick={downloadReport}><Download size={16} />Download report</button><button className="secondary-action print-action" onClick={() => window.print()}>Print / PDF</button><button className="primary-action" onClick={() => { setStage("upload"); setAnalysis(null); setRemoteImportId(null); }}><UploadCloud size={16} />New analysis</button></div></header>
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar"><div className="sidebar-title">Analysis</div><button className="sidebar-link active"><PanelTop size={17} />Overview</button><button className="sidebar-link" onClick={() => setShowData(true)}><TableProperties size={17} />Cleaned data</button><div className="sidebar-bottom"><div className="sidebar-title">Recent</div>{history.slice(0, 3).map(item => <button className="history-item" key={item.id} title={humanizePeriodText(item.summary)}><History size={14} /><span>{item.metric}<small>{new Date(item.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span><b className={item.changePercent >= 0 ? "positive" : "negative"}>{changeText(item.changePercent)}</b></button>)}<Link href="/kpi-detective" className="back-site"><ArrowLeft size={15} />KPI Detective</Link></div></aside>
      <div className="dashboard-content"><section className="results-kicker"><div><span className="eyebrow">{readablePeriod(analysis.previousPeriod)} → {readablePeriod(analysis.currentPeriod)}</span><h1>Here’s what changed.</h1></div><MetricPill label="Data quality" value={`${analysis.totalRowsUsed} usable rows`} tone="positive" /></section>
        <section className={`hero-kpi ${analysis.change < 0 ? "is-decline" : "is-growth"}`}><div className="hero-kpi-copy"><span className="eyebrow light">Headline KPI · {analysis.metricLabel}</span><div className="hero-number"><AnimatedMetric value={analysis.currentTotal} symbol={analysis.currencySymbol} /><span>{analysis.change < 0 ? "↓" : "↑"} {Math.abs(analysis.changePercent).toFixed(1)}%</span></div><p>from {currency(analysis.previousTotal, analysis.currencySymbol)} in {readablePeriod(analysis.previousPeriod)}</p></div><div className="hero-kpi-visual"><div className="hero-confidence"><ConfidenceRing value={analysis.confidence} /><p>confidence in the primary explanation</p></div><div className="hero-mini-chart"><ResponsiveContainer width="100%" height={140}><AreaChart data={analysis.trend} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}><defs><linearGradient id="hero-trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b9f3dd" stopOpacity=".7"/><stop offset="100%" stopColor="#b9f3dd" stopOpacity="0"/></linearGradient></defs><Area type="monotone" dataKey="total" stroke="#b9f3dd" strokeWidth={2.5} fill="url(#hero-trend)" isAnimationActive animationDuration={420} animationBegin={80} /><Tooltip formatter={(value: number) => [currency(value, analysis.currencySymbol), "Headline total (all transactions)"]} labelFormatter={label => `${displayPeriod(label)} · monthly total`} contentStyle={{ background: "#0e2434", border: "1px solid #416372", borderRadius: 10 }} /></AreaChart></ResponsiveContainer></div></div></section>
        <section className="explanation-panel"><div className="explanation-symbol"><Sparkles size={20} /></div><div><span className="eyebrow">The explanation</span><p>{humanizePeriodText(analysis.summary)}</p></div><button onClick={() => document.getElementById("drivers")?.scrollIntoView({ behavior: "smooth" })}>See drivers <ArrowRight size={16} /></button></section>{analysis.outlierSensitivity?.explanationChanged && <section className="outlier-sensitivity"><AlertTriangle size={19}/><div><span className="eyebrow">Outlier sensitivity check</span><strong>The original leading driver was materially affected by {analysis.outlierSensitivity.outlierRows} IQR-flagged transaction{analysis.outlierSensitivity.outlierRows === 1 ? "" : "s"}.</strong><p>The driver chart now uses the outlier-excluded sensitivity view. {analysis.outlierSensitivity.baselinePrimary?.dimension}: {analysis.outlierSensitivity.baselinePrimary?.value} changed from {signedCurrency(analysis.outlierSensitivity.baselinePrimary?.impact ?? 0, analysis.currencySymbol)} including flagged transactions to {signedCurrency(analysis.outlierSensitivity.baselinePrimaryImpactWithoutOutliers, analysis.currencySymbol)} without them.</p></div><button onClick={() => setShowData(true)}>Review flagged rows <ArrowRight size={16}/></button></section>}
        <section className="insight-grid">{benchmark && <article className="insight-card"><span className="eyebrow">Historical benchmark</span><h2>{currency(benchmark.current, analysis.currencySymbol)}</h2><p>Your current KPI is {Math.abs(benchmark.deltaPercent).toFixed(1)}% {benchmark.deltaPercent >= 0 ? "above" : "below"} the average of {currency(benchmark.average, analysis.currencySymbol)} across {history.filter(item => item.metric === analysis.metricLabel && typeof item.currentTotal === "number").length} saved analyses.</p></article>}{recurringPattern && <article className="insight-card pattern-card"><span className="eyebrow">Recurring pattern detected</span><h2>{recurringPattern.cause}</h2><p>This looks similar to your saved {recurringPattern.previousDate} analysis, when the KPI changed by {changeText(recurringPattern.previousChange)}.</p></article>}<article className="insight-card"><span className="eyebrow">Analysis history</span><h2>{history.length} saved investigations</h2><p>Analyses are saved in this browser so you can compare future changes with earlier findings.</p></article></section>
        <section className="dashboard-grid"><article className="chart-card trend-card"><div className="card-heading"><div><span className="eyebrow">KPI trend</span><h2>Performance over time</h2></div><span>{analysis.trend.length} months</span></div><div className="chart-area"><ResponsiveContainer width="100%" height={250}><AreaChart data={analysis.trend} margin={{ top: 10, right: 12, bottom: 0, left: -14 }}><defs><linearGradient id="main-trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4ba991" stopOpacity=".34"/><stop offset="100%" stopColor="#4ba991" stopOpacity="0"/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8eceb"/><XAxis dataKey="period" tickFormatter={label => displayPeriod(label).split(" ")[0] ?? ""} axisLine={false} tickLine={false} tick={{ fill: "#71808c", fontSize: 11 }} /><YAxis tickFormatter={value => currency(value, analysis.currencySymbol)} axisLine={false} tickLine={false} tick={{ fill: "#71808c", fontSize: 11 }} width={70}/><Tooltip formatter={(value: number) => [currency(value, analysis.currencySymbol), "Headline total (all transactions)"]} labelFormatter={label => `${displayPeriod(label)} · monthly total`} cursor={{ stroke: "#9bb2ac", strokeDasharray: "3 4" }} contentStyle={{ border: "1px solid #dbe3e0", borderRadius: 12, boxShadow: "0 10px 30px rgba(19,43,51,.12)" }} /><Area type="monotone" dataKey="total" stroke="#1b8370" strokeWidth={2.5} fill="url(#main-trend)" isAnimationActive animationDuration={420} animationBegin={120}/></AreaChart></ResponsiveContainer></div></article>
          <article className="chart-card drivers-card" id="drivers"><div className="card-heading"><div><span className="eyebrow">{usesOutlierAdjustedDrivers ? "Outlier-adjusted contribution analysis" : "Contribution analysis"}</span><h2>Factors {driverDirection}</h2></div><span>Top {chartData.length} drivers</span></div><p className="contribution-note">{driverBasisDescription} These are the largest factors moving in the same direction as this displayed basis. Factors can overlap and will not necessarily sum to the total change — each is shown independently and ranked by impact.</p><div className="chart-area"><ResponsiveContainer width="100%" height={250}><BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 22 }}><defs><linearGradient id="contribution-positive" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#2b9278"/><stop offset="100%" stopColor="#62bda3"/></linearGradient><linearGradient id="contribution-negative" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#c9605a"/><stop offset="100%" stopColor="#e8877f"/></linearGradient></defs><CartesianGrid horizontal={false} stroke="#eef1ef"/><XAxis type="number" tickFormatter={value => currency(value, analysis.currencySymbol)} axisLine={false} tickLine={false} tick={{ fill: "#71808c", fontSize: 11 }} /><YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#4c5c65", fontSize: 11 }} width={120}/><Tooltip formatter={(value: number) => signedCurrency(value, analysis.currencySymbol)} contentStyle={{ border: "1px solid #dbe3e0", borderRadius: 12, boxShadow: "0 10px 30px rgba(19,43,51,.12)" }}/><Bar dataKey="impact" radius={[0, 7, 7, 0]} isAnimationActive animationDuration={420} animationBegin={160}>{chartData.map(item => <Cell key={item.name} fill={item.impact < 0 ? "url(#contribution-negative)" : "url(#contribution-positive)"}/>)}</Bar></BarChart></ResponsiveContainer></div></article></section>
        <section className="drivers-section"><div className="section-heading"><div><span className="eyebrow">Priority causes</span><h2>Factors {driverDirection}</h2></div><p>{driverBasisDescription} Only material factors moving in the same direction as this displayed basis are shown here. Each counterfactual compares the current period against its prior-month performance. Factors can overlap, so card impacts are independent and do not necessarily sum to the headline change.</p></div><div className="cause-grid">{analysis.causes.map((cause, index) => <CauseCard key={cause.id} cause={cause} analysis={analysis} index={index}/>)}</div></section>{offsettingCauses.length > 0 && <section className="offsetting-section"><div className="section-heading"><div><span className="eyebrow">Counterbalancing movement</span><h2>{offsetDirection}</h2></div><p>These factors moved against the overall result. They did not cause the headline change; they reduced part of its magnitude.</p></div><div className="cause-grid offsetting-grid">{offsettingCauses.map((cause, index) => <CauseCard key={`offset-${cause.id}`} cause={cause} analysis={analysis} index={index}/>)}</div></section>}
        <ChatPanel analysis={analysis} dataset={dataset} importId={remoteImportId} />
      </div>
    </div>
    {showData && <div className="modal-backdrop" role="presentation"><section className="data-modal" role="dialog" aria-modal="true" aria-label="Cleaned data review"><div className="modal-head"><div><span className="eyebrow">Transparent cleaning</span><h2>Review the cleaned data</h2></div><button className="icon-button" onClick={() => setShowData(false)} aria-label="Close cleaned data"><X size={18} /></button></div>{remoteImportId && remoteImport ? <RemoteDataTable importId={remoteImportId} profiles={remoteProfiles(remoteImport.columnsJson)} onChanged={() => { void remoteStatus.refetch(); }} /> : dataset ? <DataTable dataset={dataset} onToggleExclusion={toggleExclusion} onUndoChange={undoChange} onConfirmDuplicate={confirmDuplicate}/> : null}<div className="modal-foot"><p>{remoteImportId ? "This preview is fetched from the backend in 100-row pages; the complete import remains in database storage. Recalculate applies your saved review choices to the real backend analysis." : "Any edits will be used in your next investigation."}</p><button className="primary-action" onClick={() => { if (remoteImportId) void recalculateRemoteImport(); else { setShowData(false); runInvestigation(); } }} disabled={remoteImportId ? recalculateImport.isPending : false}><RefreshCcw size={16} />{remoteImportId ? recalculateImport.isPending ? "Recalculating…" : "Recalculate analysis" : "Recalculate"}</button></div></section></div>}
  </main>;

  return <main className={`kpi-app landing ${dark ? "dark-mode" : ""}`}>
    <header className="app-header"><button className="brand-button" onClick={() => { setStage("upload"); setDataset(null); setRemoteImportId(null); }}><Logo /></button><div className="header-actions"><Link href="/kpi-detective" className="site-return"><ArrowLeft size={15} />KPI Detective</Link><button className="theme-control" onClick={() => setDark(current => !current)}><Moon size={16} />{dark ? "Light" : "Dark"}</button></div></header>
    <StageRail stage={stage} />
    {onboarding && stage === "upload" && <aside className="tour-card"><button onClick={closeTour} aria-label="Close onboarding"><X size={15}/></button><span className="eyebrow">New here?</span><strong>Three steps to clarity</strong><p>Upload a file, quickly review the cleaning work, and get a plain-English explanation of the change.</p><div><span>1 Upload</span><span>2 Review</span><span>3 Investigate</span></div></aside>}
    {stage === "upload" && <section className="upload-screen"><div className="upload-intro"><span className="eyebrow">An analyst for every spreadsheet</span><h1>Find out <em>why</em><br/>your number moved.</h1><p>KPI Detective cleans your business data, identifies the one change that matters, and explains the drivers in clear, practical language.</p><div className="trust-row"><span><LockKeyhole size={16}/>Your data stays private</span><span><Gauge size={16}/>Confidence on every finding</span></div></div><div className="upload-card"><div className="upload-card-head"><div><span className="upload-icon"><FileSpreadsheet size={22}/></span><h2>Start an investigation</h2></div><span>CSV or Excel</span></div><button className="dropzone" onClick={() => isAuthenticated ? fileInput.current?.click() : startLogin()} onDragOver={event => event.preventDefault()} onDrop={onDrop}><UploadCloud size={28}/><strong>Drop your file here</strong><span>or choose a CSV / .xlsx from your computer</span><i>Up to {MAX_UPLOAD_LABEL} / {MAX_UPLOAD_ROWS_LABEL} · processed securely in the backend</i></button><input ref={fileInput} type="file" accept=".csv,.xlsx" onChange={onInput} hidden/>{!authLoading && !isAuthenticated && <button className="signin-upload" onClick={() => startLogin()}>Sign in to upload private data</button>}<div className="upload-divider"><span>or explore the product</span></div><button className="demo-button" onClick={() => startCleaning(createDemoRows(), "KPI Detective sample retail data")}>Try the sample retail dataset <ArrowRight size={16}/></button>{error && <div className="upload-error"><AlertTriangle size={17}/><span>{error}</span><button onClick={() => setError("")}><X size={15}/></button></div>}<p className="privacy-note"><LockKeyhole size={13}/>Files up to {MAX_UPLOAD_LABEL} and {MAX_UPLOAD_ROWS_LABEL} upload directly to private storage and are processed securely on the backend. The browser receives only status updates, a small preview page, and aggregated findings.</p></div></section>}
    {stage === "cleaning" && <section className="progress-screen"><div className="processing-orbit"><div/><Sparkles size={30}/></div><span className="eyebrow">{stageDetails.cleaning.step} · Backend import</span><h1>Checking the evidence.</h1><p>Your file is being processed securely on the backend. This no-worker version supports up to {MAX_UPLOAD_LABEL} and {MAX_UPLOAD_ROWS_LABEL} per import.</p><div className="processing-steps"><span><Check size={15}/>Stored {fileName}</span><span><i className="loading-pulse" aria-hidden="true"/>{remoteImport ? `${remoteImport.status} · ${remoteImport.sourceRowCount.toLocaleString()} rows processed` : "Starting secure analysis"}</span><span>{remoteImport?.status === "analyzing" ? "Calculating KPI drivers" : "Preparing database aggregates"}</span></div></section>}
    {stage === "review" && (dataset || remoteImport) && <section className="review-screen"><div className="review-heading"><div><span className="eyebrow">{stageDetails.review.step} · {stageDetails.review.label}</span><h1>Your data is <em>ready to investigate.</em></h1><p>{remoteImport ? "The complete upload was cleaned and analysed in the backend. The optional review view fetches 100 rows at a time." : "We made only high-confidence standardisations, retained outliers, and kept a traceable log of every action."}</p></div><MetricPill label="Source rows" value={String(remoteImport?.sourceRowCount ?? dataset?.sourceRowCount ?? 0)} /></div>{dataset?.warnings.length ? <div className="warning-banner"><AlertTriangle size={17}/><div><strong>A few fields need attention</strong><p>{dataset.warnings.join(" ")}</p></div></div> : null}{remoteImport ? <><RemoteCleaningLog logs={remoteLogs(remoteImport.cleaningSummaryJson)} /><ContainmentReviewPanel proposals={containmentReviewProposals(remoteImport.workerCheckpointJson)} savingProposalId={savingContainmentProposalId} onDecision={decideRemoteContainment} /></> : dataset ? <CleaningLog dataset={dataset} /> : null}{remoteImport && analysis && <CurrencySelector analysis={analysis} onSelect={currencyCode => void chooseRemoteCurrency(currencyCode)} pending={setRemoteCurrency.isPending} />}{remoteImport && remoteMetricCandidates.length > 1 && <section className="kpi-candidate-panel" aria-labelledby="kpi-candidate-heading"><div className="kpi-candidate-heading"><div><span className="eyebrow">Choose the headline KPI</span><h2 id="kpi-candidate-heading">Which number should Peter investigate?</h2></div><span>{remoteMetricCandidates.length} strong candidates</span></div><p>The recommendation is based on the column headers and valid numeric values. You can switch to another candidate—such as Profit instead of Revenue—without changing the cleaning, outlier checks, confidence method, or driver calculations.</p><div className="kpi-candidate-list" role="radiogroup" aria-label="KPI candidates">{remoteMetricCandidates.map(candidate => { const selected = activeRequestedMetric === candidate.name; const recommended = candidate.name === recommendedMetric?.name; return <label className={`kpi-candidate-option ${selected ? "is-selected" : ""}`} key={candidate.name}><input type="radio" name="kpi-candidate" value={candidate.name} checked={selected} onChange={() => setRequestedMetric(candidate.name)} /><span className="candidate-radio" aria-hidden="true"/><span className="candidate-copy"><strong>{candidate.label ?? candidate.name}</strong><small>{candidate.candidateReason ?? `Usable numeric field (${candidate.confidence ?? 0}% valid values).`}</small></span>{recommended && <b>Recommended</b>}</label>; })}</div>{activeRequestedMetric !== recommendedMetric?.name && <div className="kpi-selection-action"><span>Switching the KPI recalculates the existing cleaned import; it does not clean the file again.</span><button className="secondary-action" onClick={() => void chooseRemoteMetric()} disabled={selectRemoteMetric.isPending}>{selectRemoteMetric.isPending ? <Loader2 className="spin" size={16}/> : <Check size={16}/>} {selectRemoteMetric.isPending ? "Updating KPI…" : `Use ${remoteMetricCandidates.find(candidate => candidate.name === activeRequestedMetric)?.label ?? activeRequestedMetric}`}</button></div>}</section>}<div className="review-actions"><button className="secondary-action" onClick={() => setShowData(current => !current)}><TableProperties size={17}/>{showData ? "Hide cleaned data" : "View cleaned data"}</button><button className="primary-action large" onClick={runInvestigation}>Investigate {remoteImport ? recommendedMetric?.label ?? recommendedMetric?.name ?? "my KPI" : dataset?.columns.filter(column => column.kind === "number")[0]?.name ?? "my KPI"}<ArrowRight size={17}/></button></div>{error && <div className="inline-error"><AlertTriangle size={17}/>{error}</div>}{showData && (remoteImportId && remoteImport ? <RemoteDataTable importId={remoteImportId} profiles={remoteProfiles(remoteImport.columnsJson)} onChanged={() => { void remoteStatus.refetch(); }} /> : dataset ? <DataTable dataset={dataset} onToggleExclusion={toggleExclusion} onUndoChange={undoChange} onConfirmDuplicate={confirmDuplicate}/> : null)}</section>}
  </main>;
}
