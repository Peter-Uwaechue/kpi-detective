import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Outsourcing hero hierarchy", () => {
  it("does not repeat the Outsourcing label above the main service headline", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    const heroStart = page.indexOf('className="outsourcing-hero"');
    const heroEnd = page.indexOf('className="outsourcing-story"', heroStart);
    const hero = page.slice(heroStart, heroEnd);

    expect(hero).toContain("Outsourcing support,");
    expect(hero).not.toContain('<Eyebrow>OUTSOURCING</Eyebrow><h1>');
  });
});
