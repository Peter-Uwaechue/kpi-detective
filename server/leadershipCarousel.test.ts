import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("leadership carousel mobile swipe cue", () => {
  it("renders a decorative directional cue that is scoped to mobile viewports", async () => {
    const [carouselSource, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(carouselSource).toContain('className="mobile-swipe-hint"');
    expect(carouselSource).toContain("Swipe to explore");
    expect(carouselSource).toContain('aria-hidden="true"');
    expect(styles).toContain(".mobile-swipe-hint { display:none;");
    expect(styles).toMatch(/@media \(max-width:700px\)[\s\S]*\.mobile-swipe-hint \{ display:flex;/);
  });

  it("keeps only Remi and Funmi in the roster and advances every two seconds", async () => {
    const source = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");

    expect(source).toContain('name: remiProfile.name');
    expect(source).toContain('name: funmiProfile.name');
    expect(source).not.toContain('{ name: "Nneka Eze", title: "Principal, Leadership Assessment"');
    expect(source).toContain("leadershipCarousel.length), 2000");
  });
});
