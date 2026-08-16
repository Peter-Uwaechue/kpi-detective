import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const homePageSource = fs.readFileSync(path.resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
const routerSource = fs.readFileSync(path.resolve(process.cwd(), "server/routers.ts"), "utf8");
const schemaSource = fs.readFileSync(path.resolve(process.cwd(), "drizzle/schema.ts"), "utf8");

describe("candidate referral CV uploads", () => {
  it("keeps CV attachment guidance clear without duplicating the upload field", () => {
    expect(homePageSource).not.toContain('id="candidate-cv"');
    expect(homePageSource).not.toContain("candidateCv");
    expect(homePageSource).toContain("when your email opens, attach the candidate’s CV before pressing Send.");
    expect(homePageSource).toContain("No CV upload is needed in this form");
    expect(homePageSource).toContain("Please attach the candidate’s CV to this email before pressing Send.");
    expect(homePageSource).toContain("I have permission to share these details and the candidate’s CV");
    expect(homePageSource).toContain('className="referral-attachment-reminder"');
    expect(homePageSource).toContain("remember to attach the candidate’s CV in your email.");
  });

  it("prepares the same recruitment email draft used by services requests", () => {
    expect(homePageSource).not.toContain("trpc.referrals.submit.useMutation()");
    expect(homePageSource).not.toContain("candidateCv!.name");
    expect(homePageSource).not.toContain("Please attach the selected CV file before sending this email.");
    expect(homePageSource).toContain("mailto:recruitment@willerssolutions.com");
    expect(homePageSource).toContain("setSubmitted(true);");
    expect(homePageSource).toContain("window.setTimeout(() => {");
    expect(homePageSource).toContain("Your email draft is addressed to recruitment@willerssolutions.com.");
    expect(homePageSource).toContain("No CV upload is needed in this form—attach the candidate’s CV to the email before pressing Send.");
    expect(homePageSource).toContain('].join("\\r\\n")');
    expect(homePageSource).not.toContain('].join("\\\\r\\\\n")');
    expect(homePageSource).toContain('...(linkedin.trim() ? [`LinkedIn: ${linkedin.trim()}`, ""] : [])');
    expect(homePageSource).not.toContain('LinkedIn: ${linkedin || "Not provided"}');
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
