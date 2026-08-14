import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("streamlined navigation drawer", () => {
  it("prioritises four main destinations and groups all secondary destinations without removing routes", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('const primaryDrawerItems = ["Job Search", "For Employers", "Outsourcing", "About Us"]');
    expect(page).toContain('const secondaryDrawerItems = ["Industries", "Our Services", "Resources", "Insights", "Contact Us"]');
    expect(page).toContain("drawer-primary-links");
    expect(page).toContain("drawer-secondary-links");
    expect(page).toContain("drawer-social");
    expect(page).toContain("Willers Solutions on LinkedIn");
    expect(page).toContain("Willers Solutions on Instagram");
    expect(page).toContain("Willers Solutions on Facebook");
    expect(styles).toContain(".drawer-primary-links");
    expect(styles).toContain(".drawer-secondary-links");
    expect(styles).toContain(".drawer-social");
  });
});
