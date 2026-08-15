import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("CTA interaction reliability", () => {
  it("keeps the full visible CTA surface responsive to pointer, touch, and keyboard input", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('const className = `editorial-button ${dark ? "button-dark" : ""}`');
    expect(styles).toContain("touch-action:manipulation");
    expect(styles).toContain("pointer-events:auto");
    expect(styles).toContain(".editorial-button>*");
    expect(styles).toContain("pointer-events:none");
    expect(styles).toContain("min-height:44px");
    expect(styles).toContain(".editorial-button:focus-visible");
  });
});
