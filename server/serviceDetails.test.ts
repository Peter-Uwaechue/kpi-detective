import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("service detail pages", () => {
  it("provides dedicated routes and connected homepage service cards", async () => {
    const [page, styles, app] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
      readFile(path.join(projectRoot, "client/src/App.tsx"), "utf8"),
    ]);

    expect(page).toContain("function ServiceDetail");
    expect(page).toContain('href: "/services/recruitment-executive-search"');
    expect(page).toContain('href: "/outsourcing"');
    expect(page).toContain('href: "/services/hr-advisory-organisation-design"');
    expect(page).toContain('href: "/services/people-operations-payroll"');
    expect(page).toContain('href: "/services/learning-capability-development"');
    expect(page).toContain('if (location === "/services/recruitment-executive-search")');
    expect(page).toContain("className=\"service-card-link\"");
    expect(app).toContain('<Route path="/services/:slug" component={Home} />');
    expect(styles).toContain(".service-detail-lead");
    expect(styles).toContain(".service-detail-focus");
    expect(styles).toContain(".service-detail-outcomes");
    expect(styles).toContain(".service-card:hover");
    expect(styles).toContain(".service-card:focus-within");
    expect(styles).toContain(".job-row:hover");
    expect(styles).toContain(".job-row:focus-within");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
