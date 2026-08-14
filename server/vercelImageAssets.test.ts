import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
describe("Vercel image assets", () => {
  it("uses stable absolute published image URLs rather than Vercel-relative Manus storage paths", async () => {
    const source = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    expect(source).toContain('const publishedAsset = (file: string) => `https://willersrec-7ucxtuga.manus.space/manus-storage/${file}`');
    expect(source).toContain('hero: publishedAsset("willers-local-hero-lagos_10110178.jpg")');
    expect(source).not.toContain('hero: "/assets/');
  });
});
