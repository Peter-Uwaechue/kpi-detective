import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("homepage hero layout", () => {
  it("reserves vertical room for the hero statistics at desktop and mobile sizes", async () => {
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(styles).toContain(".hero { height:auto; min-height:860px; max-height:none; }");
    expect(styles).toContain(".hero-inner { min-height:860px; height:auto; padding-bottom:154px; }");
    expect(styles).toContain("@media (max-width:900px) { .hero { min-height:900px; }");
    expect(styles).toContain("@media (max-width:600px) { .hero { min-height:1000px; }");
  });
});
