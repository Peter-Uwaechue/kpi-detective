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
});

