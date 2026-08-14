import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("At a Glance panel treatment", () => {
  it("uses a deep blue-green image overlay instead of a flat black shade", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");

    expect(page).toContain("linear-gradient(135deg,rgba(5,42,58,.96)");
    expect(page).toContain("rgba(8,62,79,.8)");
    expect(page).toContain("rgba(13,32,47,.64)");
  });
});
