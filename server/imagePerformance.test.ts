import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("image performance", () => {
  it("preloads the critical hero and defers below-the-fold photography", async () => {
    const [document, page] = await Promise.all([
      readFile(path.join(projectRoot, "client/index.html"), "utf8"),
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
    ]);

    expect(document).toContain('rel="preload" as="image"');
    expect(document).toContain('fetchpriority="high"');
    expect(page).toContain('function DeferredImage');
    expect(page).toContain('loading={priority ? "eager" : "lazy"}');
    expect(page).toContain('decoding="async"');
    expect(page).toContain('fetchPriority={priority ? "high" : "low"}');
    expect(page).toContain('loading={priority ? "eager" : "lazy"}');
    expect(page).toContain('priority />');
    expect(page).toContain('willers-workforce-team-optimized_c550d3f0.webp');
  });
});
