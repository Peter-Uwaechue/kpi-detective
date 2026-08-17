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
import {
  answerDataQuestion,
  cleanDataset,
  createDemoRows,
  formatMetric,
  investigateKpi,
  readablePeriod,
  type CleanedDataset,
  type CleanedRow,
  type KpiAnalysis,
} from "@shared/kpiEngine";
import "./KPIDetective.css";

type Stage = "upload" | "cleaning" | "review" | "results";
type ChatMessage = { id: string; role: "assistant" | "user"; text: string; confidence?: number; generated?: boolean };
type HistoryEntry = { id: string; at: string; metric: string; changePercent: number; summary: string; currentTotal?: number; previousTotal?: number; currentPeriod?: string; primaryCause?: string; primaryDimension?: string };
type BenchmarkInsight = { average: number; current: number; deltaPercent: number };
type PatternInsight = { cause: string; previousDate: string; previousChange: number } | null;

const stageDetails: Record<Exclude<Stage, "results">, { step: string; label: string }> = {
  upload: { step: "01", label: "Upload data" },
  cleaning: { step: "02", label: "Clean & validate" },
  review: { step: "03", label: "Review quality" },
};

// Small uploads are processed during the secure server request; larger files need a dedicated worker.
const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "1MB";

const currency = (value: number, symbol = "") => formatMetric(value, symbol);
const signedCurrency = (value: number, symbol = "") => `${value > 0 ? "+" : value < 0 ? "−" : ""}${currency(Math.abs(value), symbol)}`;
const changeText = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

type RemoteImport = {
  id: string;
  originalFileName: string;
  status: "uploading" | "queued" | "profiling" | "ingesting" | "analyzing" | "complete" | "failed" | "cancelled";
  sourceRowCount: number;
  usableRowCount: number;
  columnsJson: unknown;
  cleaningSummaryJson: unknown;
  analysisJson: unknown;
  errorMessage: string | null;
};

const remoteLogs = (value: unknown) => Array.isArray(value) ? value as Array<{ key: string; title: string; detail: string; count: number; severity: "success" | "warning" | "info" }> : [];
const remoteProfiles = (value: unknown) => Array.isArray(value) ? value as Array<{ name: string; kind: string }> : [];

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

function ConfidenceRing({ value }: { value: number }) {
  return <div className="confidence-ring" style={{ "--confidence": `${value * 3.6}deg` } as React.CSSProperties}><div><strong>{value}%</strong><span>confident</span></div></div>;
}

function TrendSparkline({ data, decline }: { data: { period: string; total: number }[]; decline: boolean }) {
  return <div className="sparkline"><ResponsiveContainer width="100%" height={52}><AreaChart data={data} margin={{ top: 4, right: 1, bottom: 0, left: 1 }}><defs><linearGradient id={`gradient-${decline ? "down" : "up"}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={decline ? "#ef7b73" : "#62c7a8"} stopOpacity={0.4} /><stop offset="100%" stopColor={decline ? "#ef7b73" : "#62c7a8"} stopOpacity={0.02} /></linearGradient></defs><Area type="monotone" dataKey="total" stroke={decline ? "#ef7b73" : "#62c7a8"} strokeWidth={2} fill={`url(#gradient-${decline ? "down" : "up"})`} /></AreaChart></ResponsiveContainer></div>;
}

function CauseCard({ cause, analysis }: { cause: KpiAnalysis["causes"][number]; analysis: KpiAnalysis }) {
  const decline = cause.impact < 0;
  return <article className={`cause-card ${decline ? "is-decline" : "is-growth"}`}>
    <div className="cause-card-top"><div><span className="cause-label">{cause.dimension}</span><h3>{cause.value}</h3></div><ConfidenceRing value={cause.confidence} /></div>
    <div className="cause-impact"><span>Impact on {analysis.metricLabel.toLowerCase()}</span><strong>{signedCurrency(cause.impact, analysis.currencySymbol)}</strong></div>
    <p className="cause-counterfactual">If this had stayed flat, {analysis.metricLabel.toLowerCase()} would be <b>{currency(cause.counterfactual, analysis.currencySymbol)}</b>.</p>
    <TrendSparkline data={cause.trend} decline={decline} />
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

function RemoteDataTable({ importId, profiles }: { importId: string; profiles: Array<{ name: string; kind: string }> }) {
  const [page, setPage] = useState(0);
  const preview = trpc.kpiImports.preview.useQuery({ importId, page, pageSize: 100 });
  const columns = profiles.slice(0, 7);
  const rows = preview.data?.rows ?? [];
  const total = preview.data?.total ?? 0;
  return <div className="data-table-wrap"><div className="data-table-toolbar"><span><TableProperties size={16} />{preview.isLoading ? "Loading preview…" : `Showing ${total ? page * 100 + 1 : 0}–${Math.min(total, (page + 1) * 100)} of ${total.toLocaleString()} rows`}</span><div><button onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0 || preview.isFetching}>Previous</button><button onClick={() => setPage(current => current + 1)} disabled={(page + 1) * 100 >= total || preview.isFetching}>Next</button></div></div><div className="data-table-scroll"><table><thead><tr><th>Row</th>{columns.map(column => <th key={column.name}>{column.name}<small>{column.kind}</small></th>)}</tr></thead><tbody>{rows.map(row => { const raw = row.rawValues as Record<string, unknown>; const cleaned = row.cleanedValues as Record<string, unknown>; const changes = Array.isArray(row.changes) ? row.changes as Array<{ column?: string }> : []; return <tr key={row.id} className={row.excluded ? "is-excluded" : row.possibleDuplicate ? "is-flagged" : ""}><td><b>{row.rowNumber}</b>{row.excluded && <span className="row-status">Excluded</span>}</td>{columns.map(column => <td key={column.name} className={changes.some(change => change.column === column.name) ? "cell-changed" : ""}>{cleaned[column.name] === null ? <em>Missing</em> : String(cleaned[column.name] ?? raw[column.name] ?? "")}</td>)}</tr>; })}</tbody></table></div><p className="table-note">This is a 100-row server page. The full dataset is stored and analysed in the backend; changing pages does not load the complete import into your browser.</p></div>;
}

function ChatPanel({ analysis, dataset }: { analysis: KpiAnalysis; dataset?: CleanedDataset | null }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "assistant", text: `I have investigated the ${analysis.metricLabel.toLowerCase()} change. Ask why a segment shifted, which customer contributed, or what the KPI would have been without a driver.`, confidence: analysis.confidence }]);
  const ask = trpc.kpi.ask.useMutation();
  const suggestions = [
    `Why did ${analysis.causes[0]?.value ?? "the KPI"} change?`,
    "Which customer contributed the most?",
    `What if ${analysis.causes[0]?.value ?? "the leading driver"} had stayed flat?`,
  ];
  const send = async (customQuestion?: string) => {
    const text = (customQuestion ?? question).trim();
    if (!text || ask.isPending) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", text };
    const local = dataset ? answerDataQuestion(text, dataset, analysis) : { answer: "I’m checking the backend analysis for that question…", confidence: analysis.confidence };
    const answerId = `assistant-${Date.now()}`;
    setMessages(current => [...current, userMessage, { id: answerId, role: "assistant", text: local.answer, confidence: local.confidence }]);
    setQuestion("");
    try {
      const response = await ask.mutateAsync({
        question: text,
        context: {
          metricLabel: analysis.metricLabel,
          summary: analysis.summary,
          previousPeriod: analysis.previousPeriod,
          currentPeriod: analysis.currentPeriod,
          currencySymbol: analysis.currencySymbol,
          confidence: analysis.confidence,
          causes: analysis.causes.map(cause => ({ dimension: cause.dimension, value: cause.value, impact: cause.impact, counterfactual: cause.counterfactual, confidence: cause.confidence })),
        },
      });
      if (response.generated) setMessages(current => current.map(message => message.id === answerId ? { ...message, text: response.answer, generated: true } : message));
    } catch {
      // The exact local calculation remains useful when the optional AI service is unavailable.
    }
  };
  return <section className="chat-panel"><div className="chat-heading"><div className="chat-orb"><Bot size={20} /></div><div><span className="eyebrow">Ask the analyst</span><h2>Keep investigating</h2></div><span className="context-chip"><LockKeyhole size={13} />Aggregated context only</span></div><div className="chat-messages">{messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === "assistant" ? <Sparkles size={15} /> : "You"}</div><div><p>{message.text}</p>{message.confidence !== undefined && <small>{message.generated ? "AI answer grounded in KPI context" : "Calculated confidence"}: {message.confidence}%</small>}</div></div>)}</div><div className="chat-suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}<ChevronRight size={14} /></button>)}</div><form className="chat-input" onSubmit={event => { event.preventDefault(); void send(); }}><input value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask anything about your data" aria-label="Ask anything about your data" /><button type="submit" disabled={!question.trim() || ask.isPending}>{ask.isPending ? <Loader2 className="spin" size={17} /> : <Send size={17} />}</button></form></section>;
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
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("kpi-detective-history") ?? "[]") as HistoryEntry[]; } catch { return []; }
  });

  const { isAuthenticated, loading: authLoading } = useAuth();
  const createUpload = trpc.kpiImports.createUpload.useMutation();
  const completeUpload = trpc.kpiImports.completeUpload.useMutation();
  const remoteStatus = trpc.kpiImports.get.useQuery({ importId: remoteImportId ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(remoteImportId), refetchInterval: query => {
    const status = (query.state.data as RemoteImport | undefined)?.status;
    return status === "complete" || status === "failed" || status === "cancelled" ? false : 2500;
  } });
  const remoteImport = remoteStatus.data as RemoteImport | undefined;

  useEffect(() => {
    document.title = "KPI Detective — Understand your numbers";
  }, []);

  useEffect(() => {
    if (!remoteImport) return;
    setFileName(remoteImport.originalFileName);
    if (remoteImport.status === "complete" && remoteImport.analysisJson) {
      setAnalysis(remoteImport.analysisJson as KpiAnalysis);
      setDataset(null);
      setStage("review");
    }
    if (remoteImport.status === "failed" || remoteImport.status === "cancelled") {
      setError(remoteImport.errorMessage || "This file could not be processed. Please use a smaller CSV or XLSX file and try again.");
      setStage("upload");
    }
  }, [remoteImport]);

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
      setError(reason instanceof Error ? reason.message : "We could not process this import. Please try a smaller file.");
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
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>KPI Detective report — ${analysis.metricLabel}</title><style>body{font:16px Arial,sans-serif;max-width:760px;margin:48px auto;color:#173142;line-height:1.6}h1{font-size:38px}h2{margin-top:32px}strong{color:#116f61}.meta{color:#64747b}li{margin:12px 0}</style></head><body><p class="meta">KPI Detective · ${readablePeriod(analysis.previousPeriod)} → ${readablePeriod(analysis.currentPeriod)}</p><h1>${analysis.metricLabel}: ${currency(analysis.currentTotal, analysis.currencySymbol)}</h1><p><strong>${analysis.changePercent.toFixed(1)}%</strong> change from ${currency(analysis.previousTotal, analysis.currencySymbol)}.</p><h2>What changed</h2><p>${analysis.summary}</p><h2>Priority causes</h2><ul>${causeRows}</ul><h2>Data quality</h2><p>${analysis.totalRowsUsed} usable rows; ${analysis.confidence}% calculated confidence.</p></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kpi-detective-${analysis.metricLabel.toLowerCase().replace(/\\W+/g, "-")}-report.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const closeTour = () => { setOnboarding(false); sessionStorage.setItem("kpi-detective-tour-dismissed", "true"); };

  if (stage === "results" && analysis && (dataset || remoteImportId)) return <main className={`kpi-app ${dark ? "dark-mode" : ""}`}>
    <header className="app-header dashboard-header"><button className="brand-button" onClick={() => { setStage("upload"); setAnalysis(null); setRemoteImportId(null); }}><Logo /></button><div className="dashboard-header-actions"><span className="analysis-date"><ClipboardCheck size={15} />Analysis complete</span><button className="icon-button" aria-label="Toggle colour theme" onClick={() => setDark(current => !current)}>{dark ? <Moon size={18} /> : <Moon size={18} />}</button><button className="outline-action" onClick={downloadReport}><Download size={16} />Download report</button><button className="secondary-action print-action" onClick={() => window.print()}>Print / PDF</button><button className="primary-action" onClick={() => { setStage("upload"); setAnalysis(null); setRemoteImportId(null); }}><UploadCloud size={16} />New analysis</button></div></header>
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar"><div className="sidebar-title">Analysis</div><button className="sidebar-link active"><PanelTop size={17} />Overview</button><button className="sidebar-link" onClick={() => setShowData(true)}><TableProperties size={17} />Cleaned data</button><div className="sidebar-bottom"><div className="sidebar-title">Recent</div>{history.slice(0, 3).map(item => <button className="history-item" key={item.id} title={item.summary}><History size={14} /><span>{item.metric}<small>{new Date(item.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span><b className={item.changePercent >= 0 ? "positive" : "negative"}>{changeText(item.changePercent)}</b></button>)}<Link href="/kpi-detective" className="back-site"><ArrowLeft size={15} />KPI Detective</Link></div></aside>
      <div className="dashboard-content"><section className="results-kicker"><div><span className="eyebrow">{readablePeriod(analysis.previousPeriod)} → {readablePeriod(analysis.currentPeriod)}</span><h1>Here’s what changed.</h1></div><MetricPill label="Data quality" value={`${analysis.totalRowsUsed} usable rows`} tone="positive" /></section>
        <section className={`hero-kpi ${analysis.change < 0 ? "is-decline" : "is-growth"}`}><div className="hero-kpi-copy"><span className="eyebrow light">Headline KPI · {analysis.metricLabel}</span><div className="hero-number"><strong>{currency(analysis.currentTotal, analysis.currencySymbol)}</strong><span>{analysis.change < 0 ? "↓" : "↑"} {Math.abs(analysis.changePercent).toFixed(1)}%</span></div><p>from {currency(analysis.previousTotal, analysis.currencySymbol)} in {readablePeriod(analysis.previousPeriod)}</p></div><div className="hero-kpi-visual"><div className="hero-confidence"><ConfidenceRing value={analysis.confidence} /><p>confidence in the primary explanation</p></div><div className="hero-mini-chart"><ResponsiveContainer width="100%" height={140}><AreaChart data={analysis.trend} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}><defs><linearGradient id="hero-trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b9f3dd" stopOpacity=".7"/><stop offset="100%" stopColor="#b9f3dd" stopOpacity="0"/></linearGradient></defs><Area type="monotone" dataKey="total" stroke="#b9f3dd" strokeWidth={2.5} fill="url(#hero-trend)" /><Tooltip formatter={(value: number) => currency(value, analysis.currencySymbol)} labelFormatter={label => readablePeriod(String(label))} contentStyle={{ background: "#0e2434", border: "1px solid #416372", borderRadius: 10 }} /></AreaChart></ResponsiveContainer></div></div></section>
        <section className="explanation-panel"><div className="explanation-symbol"><Sparkles size={20} /></div><div><span className="eyebrow">The explanation</span><p>{analysis.summary}</p></div><button onClick={() => document.getElementById("drivers")?.scrollIntoView({ behavior: "smooth" })}>See drivers <ArrowRight size={16} /></button></section>
        <section className="insight-grid">{benchmark && <article className="insight-card"><span className="eyebrow">Historical benchmark</span><h2>{currency(benchmark.current, analysis.currencySymbol)}</h2><p>Your current KPI is {Math.abs(benchmark.deltaPercent).toFixed(1)}% {benchmark.deltaPercent >= 0 ? "above" : "below"} the average of {currency(benchmark.average, analysis.currencySymbol)} across {history.filter(item => item.metric === analysis.metricLabel && typeof item.currentTotal === "number").length} saved analyses.</p></article>}{recurringPattern && <article className="insight-card pattern-card"><span className="eyebrow">Recurring pattern detected</span><h2>{recurringPattern.cause}</h2><p>This looks similar to your saved {recurringPattern.previousDate} analysis, when the KPI changed by {changeText(recurringPattern.previousChange)}.</p></article>}<article className="insight-card"><span className="eyebrow">Analysis history</span><h2>{history.length} saved investigations</h2><p>Analyses are saved in this browser so you can compare future changes with earlier findings.</p></article></section>
        <section className="dashboard-grid"><article className="chart-card trend-card"><div className="card-heading"><div><span className="eyebrow">KPI trend</span><h2>Performance over time</h2></div><span>{analysis.trend.length} months</span></div><div className="chart-area"><ResponsiveContainer width="100%" height={250}><AreaChart data={analysis.trend} margin={{ top: 10, right: 12, bottom: 0, left: -14 }}><defs><linearGradient id="main-trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4ba991" stopOpacity=".34"/><stop offset="100%" stopColor="#4ba991" stopOpacity="0"/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8eceb"/><XAxis dataKey="period" tickFormatter={label => readablePeriod(String(label)).split(" ")[0]} axisLine={false} tickLine={false} tick={{ fill: "#71808c", fontSize: 11 }} /><YAxis tickFormatter={value => currency(value, analysis.currencySymbol)} axisLine={false} tickLine={false} tick={{ fill: "#71808c", fontSize: 11 }} width={70}/><Tooltip formatter={(value: number) => currency(value, analysis.currencySymbol)} labelFormatter={label => readablePeriod(String(label))} cursor={{ stroke: "#9bb2ac", strokeDasharray: "3 4" }} contentStyle={{ border: "1px solid #dbe3e0", borderRadius: 12, boxShadow: "0 10px 30px rgba(19,43,51,.12)" }} /><Area type="monotone" dataKey="total" stroke="#1b8370" strokeWidth={2.5} fill="url(#main-trend)"/></AreaChart></ResponsiveContainer></div></article>
          <article className="chart-card drivers-card" id="drivers"><div className="card-heading"><div><span className="eyebrow">Contribution analysis</span><h2>What moved the number</h2></div><span>Top {chartData.length} factors</span></div><div className="chart-area"><ResponsiveContainer width="100%" height={250}><BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 22 }}><CartesianGrid horizontal={false} stroke="#eef1ef"/><XAxis type="number" tickFormatter={value => currency(value, analysis.currencySymbol)} axisLine={false} tickLine={false} tick={{ fill: "#71808c", fontSize: 11 }} /><YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#4c5c65", fontSize: 11 }} width={120}/><Tooltip formatter={(value: number) => signedCurrency(value, analysis.currencySymbol)} contentStyle={{ border: "1px solid #dbe3e0", borderRadius: 12, boxShadow: "0 10px 30px rgba(19,43,51,.12)" }}/><Bar dataKey="impact" radius={[0, 5, 5, 0]}>{chartData.map(item => <Cell key={item.name} fill={item.impact < 0 ? "#d96861" : "#33977c"}/>)}</Bar></BarChart></ResponsiveContainer></div></article></section>
        <section className="drivers-section"><div className="section-heading"><div><span className="eyebrow">Priority causes</span><h2>Where to focus next</h2></div><p>Only material drivers are shown. Each counterfactual compares the current period against its prior-month performance.</p></div><div className="cause-grid">{analysis.causes.map(cause => <CauseCard key={cause.id} cause={cause} analysis={analysis}/>)}</div></section>
        <ChatPanel analysis={analysis} dataset={dataset} />
      </div>
    </div>
    {showData && <div className="modal-backdrop" role="presentation"><section className="data-modal" role="dialog" aria-modal="true" aria-label="Cleaned data review"><div className="modal-head"><div><span className="eyebrow">Transparent cleaning</span><h2>Review the cleaned data</h2></div><button className="icon-button" onClick={() => setShowData(false)} aria-label="Close cleaned data"><X size={18} /></button></div>{remoteImportId && remoteImport ? <RemoteDataTable importId={remoteImportId} profiles={remoteProfiles(remoteImport.columnsJson)} /> : dataset ? <DataTable dataset={dataset} onToggleExclusion={toggleExclusion} onUndoChange={undoChange} onConfirmDuplicate={confirmDuplicate}/> : null}<div className="modal-foot"><p>{remoteImportId ? "This preview is fetched from the backend in 100-row pages; the complete import remains in database storage." : "Any edits will be used in your next investigation."}</p><button className="primary-action" onClick={() => { setShowData(false); runInvestigation(); }}><RefreshCcw size={16} />{remoteImportId ? "Back to analysis" : "Recalculate"}</button></div></section></div>}
  </main>;

  return <main className={`kpi-app landing ${dark ? "dark-mode" : ""}`}>
    <header className="app-header"><button className="brand-button" onClick={() => { setStage("upload"); setDataset(null); setRemoteImportId(null); }}><Logo /></button><div className="header-actions"><Link href="/kpi-detective" className="site-return"><ArrowLeft size={15} />KPI Detective</Link><button className="theme-control" onClick={() => setDark(current => !current)}><Moon size={16} />{dark ? "Light" : "Dark"}</button></div></header>
    <StageRail stage={stage} />
    {onboarding && stage === "upload" && <aside className="tour-card"><button onClick={closeTour} aria-label="Close onboarding"><X size={15}/></button><span className="eyebrow">New here?</span><strong>Three steps to clarity</strong><p>Upload a file, quickly review the cleaning work, and get a plain-English explanation of the change.</p><div><span>1 Upload</span><span>2 Review</span><span>3 Investigate</span></div></aside>}
    {stage === "upload" && <section className="upload-screen"><div className="upload-intro"><span className="eyebrow">An analyst for every spreadsheet</span><h1>Find out <em>why</em><br/>your number moved.</h1><p>KPI Detective cleans your business data, identifies the one change that matters, and explains the drivers in clear, practical language.</p><div className="trust-row"><span><LockKeyhole size={16}/>Your data stays private</span><span><Gauge size={16}/>Confidence on every finding</span></div></div><div className="upload-card"><div className="upload-card-head"><div><span className="upload-icon"><FileSpreadsheet size={22}/></span><h2>Start an investigation</h2></div><span>CSV or Excel</span></div><button className="dropzone" onClick={() => isAuthenticated ? fileInput.current?.click() : startLogin()} onDragOver={event => event.preventDefault()} onDrop={onDrop}><UploadCloud size={28}/><strong>Drop your file here</strong><span>or choose a CSV / .xlsx from your computer</span><i>Up to 1MB · processed securely in the backend</i></button><input ref={fileInput} type="file" accept=".csv,.xlsx" onChange={onInput} hidden/>{!authLoading && !isAuthenticated && <button className="signin-upload" onClick={() => startLogin()}>Sign in to upload private data</button>}<div className="upload-divider"><span>or explore the product</span></div><button className="demo-button" onClick={() => startCleaning(createDemoRows(), "KPI Detective sample retail data")}>Try the sample retail dataset <ArrowRight size={16}/></button>{error && <div className="upload-error"><AlertTriangle size={17}/><span>{error}</span><button onClick={() => setError("")}><X size={15}/></button></div>}<p className="privacy-note"><LockKeyhole size={13}/>Files up to 1MB upload directly to private storage and are processed securely on the backend. The browser receives only status updates, a small preview page, and aggregated findings.</p></div></section>}
    {stage === "cleaning" && <section className="progress-screen"><div className="processing-orbit"><div/><Sparkles size={30}/></div><span className="eyebrow">{stageDetails.cleaning.step} · Backend import</span><h1>Checking the evidence.</h1><p>Your small file is being processed securely on the backend. Please keep this page open while its data is cleaned and analysed.</p><div className="processing-steps"><span><Check size={15}/>Stored {fileName}</span><span><Loader2 className="spin" size={15}/>{remoteImport ? `${remoteImport.status} · ${remoteImport.sourceRowCount.toLocaleString()} rows processed` : "Starting secure analysis"}</span><span>{remoteImport?.status === "analyzing" ? "Calculating KPI drivers" : "Preparing database aggregates"}</span></div></section>}
    {stage === "review" && (dataset || remoteImport) && <section className="review-screen"><div className="review-heading"><div><span className="eyebrow">{stageDetails.review.step} · {stageDetails.review.label}</span><h1>Your data is <em>ready to investigate.</em></h1><p>{remoteImport ? "The complete upload was cleaned and analysed in the backend. The optional review view fetches 100 rows at a time." : "We made only high-confidence standardisations, retained outliers, and kept a traceable log of every action."}</p></div><MetricPill label="Source rows" value={String(remoteImport?.sourceRowCount ?? dataset?.sourceRowCount ?? 0)} /></div>{dataset?.warnings.length ? <div className="warning-banner"><AlertTriangle size={17}/><div><strong>A few fields need attention</strong><p>{dataset.warnings.join(" ")}</p></div></div> : null}{remoteImport ? <RemoteCleaningLog logs={remoteLogs(remoteImport.cleaningSummaryJson)} /> : dataset ? <CleaningLog dataset={dataset} /> : null}<div className="review-actions"><button className="secondary-action" onClick={() => setShowData(current => !current)}><TableProperties size={17}/>{showData ? "Hide cleaned data" : "View cleaned data"}</button><button className="primary-action large" onClick={runInvestigation}>Investigate {remoteImport ? remoteProfiles(remoteImport.columnsJson).find(column => column.kind === "number")?.name ?? "my KPI" : dataset?.columns.filter(column => column.kind === "number")[0]?.name ?? "my KPI"}<ArrowRight size={17}/></button></div>{error && <div className="inline-error"><AlertTriangle size={17}/>{error}</div>}{showData && (remoteImportId && remoteImport ? <RemoteDataTable importId={remoteImportId} profiles={remoteProfiles(remoteImport.columnsJson)} /> : dataset ? <DataTable dataset={dataset} onToggleExclusion={toggleExclusion} onUndoChange={undoChange} onConfirmDuplicate={confirmDuplicate}/> : null)}</section>}
  </main>;
}
