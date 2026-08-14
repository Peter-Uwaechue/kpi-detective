import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("homepage company identity hierarchy", () => {
  it("wraps the company name in a distinct identity label before the services headline", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(page).toContain('className="company-identity-label"');
    expect(styles).toContain(".company-identity-label");
    expect(styles).toContain("margin:0 0 32px");
    expect(styles).toContain("margin-bottom:39px");
  });
});
