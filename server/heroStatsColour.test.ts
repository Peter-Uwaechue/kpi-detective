import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("hero statistics colour treatment", () => {
  it("cycles through five high-contrast accent colours and disables the effect for reduced motion", async () => {
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(styles).toContain("animation:hero-stat-colour-cycle 15s ease-in-out infinite");
    expect(styles).toContain("#e3a064");
    expect(styles).toContain("#b8d4c0");
    expect(styles).toContain("#f2d08a");
    expect(styles).toContain("#a8c9e7");
    expect(styles).toContain("@media (prefers-reduced-motion:reduce) { .hero-stats strong { animation:none; color:#f9f7f2; }");
  });
});
