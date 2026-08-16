import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Vercel deployment configuration", () => {
  it("builds static assets and serves public routes through the SSR function", async () => {
    const [config, guide, viteServer] = await Promise.all([
      readFile(path.join(projectRoot, "vercel.json"), "utf8"),
      readFile(path.join(projectRoot, "VERCEL_DEPLOYMENT.md"), "utf8"),
      readFile(path.join(projectRoot, "server", "_core", "vite.ts"), "utf8"),
    ]);

    expect(config).toContain('"buildCommand": "pnpm run build"');
    expect(config).toContain('"outputDirectory": "dist/public"');
    expect(config).toContain('"api/ssr.js"');
    expect(config).toContain('"includeFiles": "dist/**"');
    expect(config).toContain('"destination": "/api/ssr"');
    expect(guide).toContain("Peter-Uwaechue/Willers-solutions");
    expect(guide).toContain("push to `main`");
    expect(viteServer).toContain('import(vitePackage)');
    expect(viteServer).not.toContain('from "vite"');
    expect(viteServer).toContain("pathToFileURL");
    expect(viteServer).toContain('import(viteConfigUrl)');
  });
});
