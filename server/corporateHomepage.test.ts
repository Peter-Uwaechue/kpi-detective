import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("corporate homepage structure", () => {
  it("uses a compact introduction and direct pathways instead of the campaign-style hero", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('return <div className="corporate-home"><Header /><main>');
    expect(page).toContain("function CorporateQuickAccess()");
    expect(page).toContain("function CorporateDifference()");
    expect(page).toContain("function CorporateEngagementPath()");
    expect(page).toContain("function CorporateScenarios()");
    expect(page).toContain("function CorporateSectorJournal()");
    expect(page).toContain("function CorporateInsights()");
    expect(page).toContain("Find the part of");
    expect(page).toContain("WHAT MAKES US DIFFERENT");
    expect(page).toContain("A considered");
    expect(page).toContain("THE QUESTIONS WE HELP SOLVE");
    expect(page).toContain("FROM THE WILLERS NOTEBOOK");
    expect(page).toContain("THE WILLERS PRACTICE");
    expect(page).toContain("People support,");
    expect(page).toContain("For employers");
    expect(page).toContain("Outsourcing");
    expect(page).toContain("Careers");
    expect(styles).toContain(".corporate-masthead");
    expect(styles).toContain(".corporate-quick-access");
    expect(styles).toContain(".corporate-difference");
    expect(styles).toContain(".corporate-engagement-path");
    expect(styles).toContain(".corporate-scenarios");
    expect(styles).toContain(".corporate-sector-journal");
    expect(styles).toContain(".corporate-insights");
    expect(styles).toContain(".corporate-home .hero,.corporate-home .hero-stats,.corporate-home .hero-scroll { display:none; }");
  });
});
