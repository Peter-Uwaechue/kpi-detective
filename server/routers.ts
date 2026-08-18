import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { createCandidateReferral } from "./db";
import { createKpiImport, getAllImportRows, getImportAggregates, getKpiImport, getPreviewPage, resetKpiImportData, updateKpiImport } from "./kpiImportDb";
import { createImportUploadUrl, getImportObjectInfo } from "./kpiImportStorage";
import { applyImportReviewAction, processKpiImport, recalculateKpiImport } from "./kpiImportWorker";
import { invokeLLM } from "./_core/llm";
import { fallbackAnalystAnswer, type AnalystContext } from "./kpiAnalyst";
import { answerPeterQuery, isAnswerablePeterSuggestion, peterSuggestionSignature, planPeterQuestion, resolvePeterPlanWithAi } from "./kpiAnalystQuery";
import type { ColumnProfile, KpiAnalysis } from "../shared/kpiEngine";
import { getSessionCookieOptions } from "./_core/cookies";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";

const recruitmentContactEmail = "recruitment@willerssolutions.com";
const MAX_CV_BYTES = 6 * 1024 * 1024;
// The no-worker deployment processes imports synchronously inside a Vercel Hobby function.
// These limits are based on real end-to-end import benchmarks and preserve timeout headroom.
const MAX_KPI_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_KPI_IMPORT_ROWS = 100_000;
const KPI_UPLOAD_LIMIT_MESSAGE = "File exceeds 5MB — please upload a smaller file for now.";
const ANALYST_LLM_TIMEOUT_MS = 8_000;
const MAX_CV_BASE64_LENGTH = Math.ceil(MAX_CV_BYTES / 3) * 4;
const cvMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const validCvFile = (buffer: Buffer, mimeType: (typeof cvMimeTypes)[number]) => {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("utf8") === "%PDF-";
  if (mimeType === "application/msword") return buffer.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
  return buffer.subarray(0, 2).toString("utf8") === "PK";
};

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 180);

const analystContextInput = z.object({
  metricLabel: z.string().max(160),
  summary: z.string().max(2200),
  previousPeriod: z.string().max(40),
  currentPeriod: z.string().max(40),
  currencySymbol: z.string().max(4),
  confidence: z.number().min(0).max(100),
  causes: z.array(z.object({
    dimension: z.string().max(160),
    value: z.string().max(260),
    impact: z.number(),
    counterfactual: z.number(),
    confidence: z.number().min(0).max(100),
  })).max(5),
});

const validImportedAnalysis = (value: unknown): value is KpiAnalysis => {
  if (!value || typeof value !== "object") return false;
  const analysis = value as Partial<KpiAnalysis>;
  return typeof analysis.metric === "string" && typeof analysis.dateColumn === "string" && typeof analysis.previousPeriod === "string" && typeof analysis.currentPeriod === "string" && Array.isArray(analysis.causes);
};

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  kpiImports: router({
    createUpload: protectedProcedure.input(z.object({
      fileName: z.string().trim().min(1).max(520),
      contentType: z.string().trim().min(1).max(180),
      fileBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })).mutation(async ({ input, ctx }) => {
      const extension = input.fileName.split(".").pop()?.toLowerCase();
      if (!extension || !["csv", "xlsx"].includes(extension)) throw new Error("KPI Detective supports CSV and XLSX files. Convert legacy XLS files before upload.");
      if (input.fileBytes > MAX_KPI_UPLOAD_BYTES) throw new Error(KPI_UPLOAD_LIMIT_MESSAGE);
      const importId = globalThis.crypto.randomUUID();
      const upload = await createImportUploadUrl({ importId, fileName: input.fileName, contentType: input.contentType });
      await createKpiImport({
        id: importId,
        ownerOpenId: ctx.user.openId,
        originalFileName: input.fileName,
        contentType: input.contentType,
        storageKey: upload.key,
        storageUrl: `s3://${process.env.KPI_S3_BUCKET ?? "configured-bucket"}/${upload.key}`,
        fileBytes: input.fileBytes,
        status: "uploading",
      });
      return { importId, uploadUrl: upload.uploadUrl, expiresInSeconds: upload.expiresInSeconds };
    }),
    completeUpload: protectedProcedure.input(z.object({ importId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job) throw new Error("Import job was not found.");
      const object = await getImportObjectInfo(job.storageKey);
      if (!object.bytes) throw new Error("The uploaded file is empty or object storage has not finished receiving it.");
      if (object.bytes > MAX_KPI_UPLOAD_BYTES) throw new Error(KPI_UPLOAD_LIMIT_MESSAGE);
      await updateKpiImport(input.importId, { fileBytes: object.bytes, contentType: object.contentType, errorMessage: null });
      try {
        await processKpiImport(input.importId, { maxSourceRows: MAX_KPI_IMPORT_ROWS });
        return { importId: input.importId, status: "complete" as const, bytes: object.bytes };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message.slice(0, 4000) : "The import could not be processed.";
        await updateKpiImport(input.importId, { status: "failed", errorMessage, completedAt: new Date() });
        throw new Error(errorMessage);
      }
    }),
    get: protectedProcedure.input(z.object({ importId: z.string().uuid() })).query(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job) throw new Error("Import job was not found.");
      return job;
    }),
    preview: protectedProcedure.input(z.object({ importId: z.string().uuid(), page: z.number().int().min(0).default(0), pageSize: z.number().int().min(1).max(200).default(100) })).query(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job) throw new Error("Import job was not found.");
      return getPreviewPage(input.importId, input.page, input.pageSize);
    }),
    reviewAction: protectedProcedure.input(z.object({
      importId: z.string().uuid(),
      rowNumber: z.number().int().positive(),
      action: z.enum(["undoChange", "setExcluded", "keepPossibleDuplicate", "editValue"]),
      column: z.string().trim().min(1).max(255).optional(),
      value: z.string().max(2000).nullable().optional(),
      excluded: z.boolean().optional(),
    })).mutation(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job) throw new Error("Import job was not found.");
      if (job.status !== "complete") throw new Error("Wait for the import to finish before reviewing cleaned data.");
      return applyImportReviewAction(input);
    }),
    recalculate: protectedProcedure.input(z.object({ importId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job) throw new Error("Import job was not found.");
      if (job.status !== "complete") throw new Error("This import is not ready for recalculation.");
      try {
        const analysis = await recalculateKpiImport(input.importId);
        return { importId: input.importId, status: "complete" as const, analysis };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message.slice(0, 4000) : "The import could not be recalculated.";
        await updateKpiImport(input.importId, { status: "failed", errorMessage, completedAt: new Date() });
        throw new Error(errorMessage);
      }
    }),
    retry: protectedProcedure.input(z.object({ importId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job) throw new Error("Import job was not found.");
      if (!["failed", "cancelled"].includes(job.status)) throw new Error("Only failed or cancelled imports can be retried.");
      if (job.fileBytes > MAX_KPI_UPLOAD_BYTES) {
        await updateKpiImport(input.importId, { status: "failed", errorMessage: KPI_UPLOAD_LIMIT_MESSAGE, completedAt: new Date() });
        throw new Error(KPI_UPLOAD_LIMIT_MESSAGE);
      }
      await resetKpiImportData(input.importId);
      try {
        await processKpiImport(input.importId, { maxSourceRows: MAX_KPI_IMPORT_ROWS });
        return { importId: input.importId, status: "complete" as const };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message.slice(0, 4000) : "The import could not be processed.";
        await updateKpiImport(input.importId, { status: "failed", errorMessage, completedAt: new Date() });
        throw new Error(errorMessage);
      }
    }),
  }),
  kpi: router({
    ask: publicProcedure.input(z.object({
      question: z.string().trim().min(2).max(500),
      context: analystContextInput,
    })).mutation(async ({ input }) => {
      const factSheet = JSON.stringify(input.context);
      try {
        const response = await Promise.race([
          invokeLLM({
            model: "gpt-5-mini",
            maxTokens: 650,
            reasoning: { effort: "minimal" },
            messages: [
              {
                role: "system",
                content: "You are Peter, KPI Detective’s AI analyst feature. Answer using only the supplied calculated KPI context; do not invent data, trends, customers, or causes. Write plain English for a non-technical business owner. State the relevant confidence score where possible, and keep the response concise (under 150 words). If the context cannot answer the question, say so directly and suggest a question it can answer.",
              },
              {
                role: "user",
                content: `Question: ${input.question}\n\nCalculated KPI context (aggregated only): ${factSheet}`,
              },
            ],
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Analyst AI request timed out")), ANALYST_LLM_TIMEOUT_MS)),
        ]);
        const content = response.choices[0]?.message.content;
        const answer = typeof content === "string" ? content.trim() : "";
        if (!answer) throw new Error("The analyst did not return an answer.");
        return { answer, generated: true };
      } catch (error) {
        console.warn("[KPI Detective] Analyst fallback used:", error);
        return {
          answer: fallbackAnalystAnswer(input.question, input.context as AnalystContext),
          generated: false,
        };
      }
    }),
    askImport: protectedProcedure.input(z.object({
      importId: z.string().uuid(),
      question: z.string().trim().min(2).max(500),
    })).mutation(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job) throw new Error("Import job was not found.");
      if (!validImportedAnalysis(job.analysisJson)) throw new Error("This import does not yet have a complete analysis.");
      const analysis = job.analysisJson;
      const profiles = Array.isArray(job.columnsJson) ? job.columnsJson as ColumnProfile[] : [];
      const aggregates = await getImportAggregates(input.importId);
      const deterministicPlan = planPeterQuestion(input.question, analysis, profiles, aggregates);
      let plan = deterministicPlan.intent === "unsupported"
        ? await resolvePeterPlanWithAi(input.question, analysis, profiles, aggregates, deterministicPlan)
        : deterministicPlan;
      const rows = plan.needsRows ? await getAllImportRows(input.importId) : undefined;
      if (rows && plan.reason !== "structured_ai_plan") plan = planPeterQuestion(input.question, analysis, profiles, aggregates, rows);
      const response = answerPeterQuery({ question: input.question, analysis, profiles, aggregates, rows, plan });
      return {
        answer: response.answer,
        generated: false,
        confidence: response.confidence,
      };
    }),
    suggestions: protectedProcedure.input(z.object({
      importId: z.string().uuid(),
    })).query(async ({ input, ctx }) => {
      const job = await getKpiImport(input.importId, ctx.user.openId);
      if (!job || !validImportedAnalysis(job.analysisJson)) return [];
      const analysis = job.analysisJson;
      const profiles = Array.isArray(job.columnsJson) ? job.columnsJson as ColumnProfile[] : [];
      const primaryDriver = analysis.causes[0]?.value;
      if (!primaryDriver) return [];
      const candidates = [
        `Why did ${primaryDriver} change?`,
        `Which companies changed most within ${primaryDriver}?`,
        `What if ${primaryDriver} had stayed flat?`,
        `Which factors overlap with ${primaryDriver}?`,
        `Which dates moved most within ${primaryDriver}?`,
        "What do I fix in the company?",
        "Which customer contributed the most?",
        "What should I investigate next?",
      ];
      const [aggregates, rows] = await Promise.all([getImportAggregates(input.importId), getAllImportRows(input.importId)]);
      const seenResults = new Set<string>();
      return candidates.filter(question => {
        const plan = planPeterQuestion(question, analysis, profiles, aggregates, rows);
        if (plan.intent === "unsupported") return false;
        const response = answerPeterQuery({ question, analysis, profiles, aggregates, rows, plan });
        if (!isAnswerablePeterSuggestion(response)) return false;
        const signature = peterSuggestionSignature(response);
        if (seenResults.has(signature)) return false;
        seenResults.add(signature);
        return true;
      });
    }),
  }),
  referrals: router({
    submit: publicProcedure.input(z.object({
      jobSlug: z.string().trim().min(1).max(180),
      jobTitle: z.string().trim().min(1).max(260),
      referrerName: z.string().trim().min(2).max(180),
      referrerEmail: z.string().trim().email().max(320),
      candidateName: z.string().trim().min(2).max(180),
      candidateEmail: z.string().trim().email().max(320),
      candidateLinkedin: z.string().trim().max(520).optional(),
      rationale: z.string().trim().min(20).max(5000),
      cvFileName: z.string().trim().min(5).max(255),
      cvMimeType: z.enum(cvMimeTypes),
      cvBase64: z.string().min(1).max(MAX_CV_BASE64_LENGTH),
    })).mutation(async ({ input }) => {
      const cvBuffer = Buffer.from(input.cvBase64, "base64");
      if (!cvBuffer.length || cvBuffer.length > MAX_CV_BYTES || !validCvFile(cvBuffer, input.cvMimeType)) {
        throw new Error("Please upload a valid PDF, DOC, or DOCX CV up to 6 MB.");
      }

      const fileName = safeFileName(input.cvFileName);
      const { key, url } = await storagePut(
        `candidate-referrals/${Date.now()}-${globalThis.crypto.randomUUID()}-${fileName}`,
        cvBuffer,
        input.cvMimeType,
      );

      await createCandidateReferral({
        jobSlug: input.jobSlug,
        jobTitle: input.jobTitle,
        referrerName: input.referrerName,
        referrerEmail: input.referrerEmail,
        candidateName: input.candidateName,
        candidateEmail: input.candidateEmail,
        candidateLinkedin: input.candidateLinkedin || null,
        rationale: input.rationale,
        cvFileName: fileName,
        cvMimeType: input.cvMimeType,
        cvStorageKey: key,
        cvUrl: url,
      });

      const cvLink = `https://willersrec-7ucxtuga.manus.space${url}`;
      const ownerNotified = await notifyOwner({
        title: `Candidate referral: ${input.candidateName} for ${input.jobTitle}`,
        content: [
          `Role: ${input.jobTitle}`,
          `Candidate: ${input.candidateName} (${input.candidateEmail})`,
          `Referrer: ${input.referrerName} (${input.referrerEmail})`,
          `LinkedIn: ${input.candidateLinkedin || "Not provided"}`,
          `Rationale: ${input.rationale}`,
          `CV: ${cvLink}`,
        ].join("\n"),
      });

      return { success: true, ownerNotified, cvUrl: cvLink, recruitmentContactEmail } as const;
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
