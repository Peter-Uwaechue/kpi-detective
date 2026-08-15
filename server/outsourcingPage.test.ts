import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("outsourcing page", () => {
  it("provides a dedicated route, service detail, and structured employer enquiry form", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('if (location === "/outsourcing" || location === "/services/workforce-outsourcing") return <OutsourcingExperience />');
    expect(page).toContain("function OutsourcingPage()");
    expect(page).toContain("function OutsourcingExperience()");
    expect(page).not.toContain('<Eyebrow>OUTSOURCING</Eyebrow><h1>Outsourcing support,');
    expect(page).toContain("Outsourcing support,");
    expect(page).toContain("A simpler way");
    expect(page).toContain("REQUEST OUTSOURCING SUPPORT");
    expect(page).toContain("Primary outsourcing need");
    expect(page).toContain("Estimated scope");
    expect(page).toContain("Project or contract support");
    expect(page).toContain('href="/outsourcing"');
    expect(page).toContain('<a href="#outsourcing-enquiry" className="text-link">Discuss your outsourcing need');
    expect(page).toContain('return href.startsWith("#") ? <a href={href} className={className}>{content}</a>');
    expect(styles).toContain(".outsourcing-enquiry");
    expect(styles).toContain(".outsourcing-form-grid");
    expect(styles).toContain(".outsourcing-hero");
    expect(styles).toContain(".outsourcing-showcase");
  });
});
