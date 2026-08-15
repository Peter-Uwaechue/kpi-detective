import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("compact navigation dropdown", () => {
  it("uses a header-anchored dropdown instead of a full-screen mobile drawer", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('aria-controls="site-navigation-menu"');
    expect(page).toContain('id="site-navigation-menu"');
    expect(page).toContain("setOpen((current) => !current)");
    expect(page).toContain('const primaryDrawerItems = ["Home", "Job Search", "For Employers", "Outsourcing", "About Us"]');
    expect(page).toContain('item === "Home" ? "/"');
    expect(styles).toContain("top:74px; right:clamp(16px,4vw,64px)");
    expect(styles).toContain("width:min(480px,calc(100vw - 32px))");
    expect(styles).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
  });
});
