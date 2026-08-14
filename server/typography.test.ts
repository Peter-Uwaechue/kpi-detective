import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("editorial typography", () => {
  it("loads and applies the distinctive display and interface font pair", async () => {
    const [html, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/index.html"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(html).toContain("family=Alegreya");
    expect(html).toContain("family=Albert+Sans");
    expect(styles).toContain("font-family:'Albert Sans',sans-serif");
    expect(styles).toContain("font-family:'Alegreya',Georgia,serif!important");
    expect(styles).toContain("font-family:'Albert Sans',Arial,sans-serif!important");
  });
});
