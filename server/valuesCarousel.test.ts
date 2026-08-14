import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("values carousel", () => {
  it("rotates the about-page values every two seconds with accessible manual controls", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain("function ValuesCarousel()");
    expect(page).toContain("window.setInterval(() => advance(), 2000)");
    expect(page).toContain("Pause automatic values carousel");
    expect(page).toContain('aria-label="Show previous value"');
    expect(page).toContain("<ValuesCarousel /><LeadershipCarousel />");
    expect(styles).toContain(".values-carousel-stage { position:relative");
    expect(styles).toContain("@media (prefers-reduced-motion:reduce) { .values-slide { transition:none; } }");
  });
});
