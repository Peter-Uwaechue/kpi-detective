import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const homePageSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/Home.tsx"),
  "utf8",
);

describe("employer partnership mailto fallback", () => {
  it("addresses employer briefs to the published Human Capital inbox", () => {
    expect(homePageSource).toContain('const employerContactEmail = "humancapital@willerssolutions.com"');
    expect(homePageSource).toContain("mailto:${employerContactEmail}");
  });

  it("includes the completed employer brief fields in the draft body", () => {
    expect(homePageSource).toContain("formValues.firstName");
    expect(homePageSource).toContain("formValues.organisation");
    expect(homePageSource).toContain("formValues.supportNeeded");
    expect(homePageSource).toContain("formValues.servicePriority");
    expect(homePageSource).toContain("formValues.scope");
    expect(homePageSource).toContain("formValues.timeline");
    expect(homePageSource).toContain("encodeURIComponent(body)");
  });

  it("uses encoded CRLF line breaks instead of literal backslash-n text in the email draft", () => {
    expect(homePageSource).toContain('const employerBriefLineBreak = "\\r\\n"');
    expect(homePageSource).toContain("].join(employerBriefLineBreak)");
    expect(homePageSource).not.toContain('].join("\\\\n")');
  });

  it("keeps the Human Capital email address out of the employer success message", () => {
    expect(homePageSource).toContain("Your completed brief has been prepared in an email draft.");
    expect(homePageSource).toContain("Your email draft is ready. Please press Send in your email app to complete your request.");
    expect(homePageSource).not.toContain("deliver the completed brief to ${employerContactEmail}");
  });

  it("gives visitors a private fallback when no default email app is configured", () => {
    expect(homePageSource).toContain("No email app opened?");
    expect(homePageSource).toContain("Set up a default email app in your device settings");
  });
});
