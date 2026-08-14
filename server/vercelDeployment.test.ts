import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Vercel deployment configuration", () => {
  it("builds the Vite site and supports direct navigation to client-side routes", async () => {
    const [config, guide] = await Promise.all([
      readFile(path.join(projectRoot, "vercel.json"), "utf8"),
      readFile(path.join(projectRoot, "VERCEL_DEPLOYMENT.md"), "utf8"),
    ]);

    expect(config).toContain('"buildCommand": "pnpm run build"');
    expect(config).toContain('"outputDirectory": "dist/public"');
    expect(config).toContain('"destination": "/index.html"');
    expect(guide).toContain("Peter-Uwaechue/Willers-solutions");
    expect(guide).toContain("push to `main`");
  });
});
