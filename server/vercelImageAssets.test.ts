import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const requiredAssets = [
  "willers-local-hero-lagos.jpg",
  "willers-local-recruitment.jpg",
  "willers-local-workforce.jpg",
  "willers-local-people-operations.jpg",
  "willers-local-learning.jpg",
  "hannah-uwaechue-director.jpg",
  "willers-solutions-limited-logo-transparent-exact.png",
  "industry-mark-technology.png",
  "industry-mark-community.png",
];

describe("Vercel image assets", () => {
  it("serves the site imagery from public assets rather than Manus-only storage paths", async () => {
    const source = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    expect(source).not.toContain("/manus-storage/");
    expect(source).toContain('hero: "/assets/willers-local-hero-lagos.jpg"');
    await Promise.all(requiredAssets.map((asset) => stat(path.join(projectRoot, "client/public/assets", asset))));
  });
});
