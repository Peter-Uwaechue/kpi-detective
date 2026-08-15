import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Remi leadership portrait interaction", () => {
  it("scopes a restrained zoom effect to Remi’s portrait and respects reduced-motion preferences", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('leader.name === remiProfile.name ? "remi-portrait-card" : ""');
    expect(styles).toContain(".remi-portrait-card:hover .portrait-image,.remi-portrait-card:focus-within .portrait-image { transform:translateY(-6px) scale(1.035); }");
    expect(styles).toContain("@media (prefers-reduced-motion:reduce) { .remi-portrait-card:hover .portrait-image,.remi-portrait-card:focus-within .portrait-image { transform:none; } }");
  });
});
