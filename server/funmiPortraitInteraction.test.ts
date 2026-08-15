import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Funmi leadership portrait interaction", () => {
  it("matches Remi’s restrained zoom treatment and retains a reduced-motion fallback", async () => {
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(styles).toContain('.portrait-card:has(.leadership-profile-link[href="/leadership/funmi-bashorun"]):hover .portrait-image,.portrait-card:has(.leadership-profile-link[href="/leadership/funmi-bashorun"]):focus-within .portrait-image { transform:translateY(-6px) scale(1.035); }');
    expect(styles).toContain('@media (prefers-reduced-motion:reduce) { .portrait-card:has(.leadership-profile-link[href="/leadership/funmi-bashorun"]):hover .portrait-image,.portrait-card:has(.leadership-profile-link[href="/leadership/funmi-bashorun"]):focus-within .portrait-image { transform:none; } }');
  });
});
