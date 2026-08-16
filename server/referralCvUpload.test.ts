import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = fs.readFileSync(path.resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
const routerSource = fs.readFileSync(path.resolve(process.cwd(), "server/routers.ts"), "utf8");
const schemaSource = fs.readFileSync(path.resolve(process.cwd(), "drizzle/schema.ts"), "utf8");

describe("candidate referral CV uploads", () => {
  it("offers an accessible CV field with clear file restrictions", () => {
    expect(homePageSource).toContain('id="candidate-cv"');
    expect(homePageSource).toContain('accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"');
    expect(homePageSource).toContain("PDF, DOC, or DOCX only — up to 6 MB.");
    expect(homePageSource).toContain("Attach the candidate’s CV in PDF, DOC, or DOCX format.");
    expect(homePageSource).toContain("I have permission to share these details and the candidate’s CV");
  });

  it("prepares the same recruitment email draft used by services requests", () => {
    expect(homePageSource).not.toContain("trpc.referrals.submit.useMutation()");
    expect(homePageSource).toContain("candidateCv!.name");
    expect(homePageSource).toContain("Please attach the selected CV file before sending this email.");
    expect(homePageSource).toContain("mailto:recruitment@willerssolutions.com");
    expect(homePageSource).toContain("setSubmitted(true);");
    expect(homePageSource).toContain("window.setTimeout(() => {");
    expect(homePageSource).toContain("Your email draft is addressed to recruitment@willerssolutions.com.");
    expect(homePageSource).toContain("Please attach the selected CV file in your email app before pressing Send.");
  });

  it("accepts only validated document formats, securely stores their bytes, and records only metadata", () => {
    expect(routerSource).toContain("const MAX_CV_BYTES = 6 * 1024 * 1024;");
    expect(routerSource).toContain("const cvMimeTypes = [");
    expect(routerSource).toContain("const validCvFile");
    expect(routerSource).toContain("storagePut(");
    expect(routerSource).toContain("createCandidateReferral({");
    expect(routerSource).toContain("await notifyOwner({");
    expect(routerSource).toContain('const recruitmentContactEmail = "recruitment@willerssolutions.com"');
    expect(routerSource).toContain("recruitmentContactEmail } as const");
    expect(schemaSource).toContain('export const candidateReferrals = mysqlTable("candidate_referrals"');
    expect(schemaSource).toContain('cvStorageKey: varchar("cvStorageKey"');
    expect(schemaSource).toContain('cvUrl: text("cvUrl")');
    expect(schemaSource).not.toContain("cvContent");
  });
});
