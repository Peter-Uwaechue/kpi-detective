import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("company positioning", () => {
  it("presents Willers Solutions primarily as an HR, recruitment, and talent advisory partner", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain("HR, recruitment,");
    expect(page).toContain("outsourcing & talent advisory");
    expect(page).toContain("WILLERS SOLUTIONS LIMITED");
    expect(page).toContain("HR Advisory & Organisation Design");
    expect(page).toContain("Learning & Capability Development");
    expect(page).toContain("Outsourcing");
    expect(page).toContain("People Operations & Payroll Support");
    expect(page).toContain("Workforce support");
    expect(page).toContain("function PeoplePlatform()");
    expect(page).toContain("function ContentDossier");
    expect(page).toContain("function CorporateQuickAccess()");
    expect(page).toContain("permanent hiring, specialist recruitment, and workforce programmes");
    expect(page).toContain("Our recruitment work sits alongside broader HR, workforce, and outsourcing conversations");
    expect(styles).toContain(".people-platform");
    expect(styles).toContain(".capability-dossier");
  });
});
