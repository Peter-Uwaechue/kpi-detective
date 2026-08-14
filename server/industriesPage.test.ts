import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("industries page", () => {
  it("provides a dedicated industries route and sector-specific recruitment and outsourcing pathways", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('if (location === "/industries") return <IndustriesPage />');
    expect(page).toContain("function IndustriesPage()");
    expect(page).toContain("Financial services");
    expect(page).toContain("Energy & infrastructure");
    expect(page).toContain("Healthcare & life sciences");
    expect(page).toContain("Public sector & development");
    expect(page).toContain("FULL SECTOR DIRECTORY");
    expect(page).toContain("Software & SaaS");
    expect(page).toContain("Construction");
    expect(page).toContain("Hospitality & tourism");
    expect(page).toContain("Oil & gas");
    expect(page).toContain("Education & edtech");
    expect(page).toContain("industry-mark-technology");
    expect(page).toContain("industry-directory-group-title");
    expect(page).toContain("Request outsourcing support");
    expect(page).toContain('"Industries", "About Us"');
    expect(styles).toContain(".industries-grid");
    expect(styles).toContain(".industries-cta");
    expect(styles).toContain(".industry-directory");
    expect(styles).toContain(".industry-mark");
    expect(styles).toContain(".industries-grid article:hover,.industries-grid article:focus-within");
    expect(styles).toContain(".industries-grid .industry-card-link:focus-visible");
  });
});
