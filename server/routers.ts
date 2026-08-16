import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { createCandidateReferral } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";

const recruitmentContactEmail = "recruitment@willerssolutions.com";
const MAX_CV_BYTES = 6 * 1024 * 1024;
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
