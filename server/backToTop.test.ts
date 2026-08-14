import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("global back-to-top control", () => {
  it("adds a globally mounted accessible control with a sensible visibility threshold and motion preference support", async () => {
    const [app, component, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/App.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/components/BackToTop.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(app).toContain("<BackToTop />");
    expect(component).toContain("const SCROLL_THRESHOLD = 520");
    expect(component).toContain('aria-label="Back to top"');
    expect(component).toContain('behavior: reducedMotion ? "auto" : "smooth"');
    expect(styles).toContain(".back-to-top");
    expect(styles).toContain(".back-to-top.is-visible");
  });
});
