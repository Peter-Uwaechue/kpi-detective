import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("sector ticker", () => {
  it("keeps the industry slider moving without a Sector Excellence label", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");

    expect(page).toContain('function Ticker() { return <div className="ticker"><div className="ticker-track">');
    expect(page).not.toContain("SECTOR EXCELLENCE");
  });
});
