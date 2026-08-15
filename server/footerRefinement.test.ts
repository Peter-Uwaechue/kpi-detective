import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("footer visual refinement", () => {
  it("uses a layered midnight-blue treatment with light-blue hierarchy and mobile link dividers", async () => {
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(styles).toContain("radial-gradient(circle at 88% 8%,rgba(42,128,164,.24)");
    expect(styles).toContain("border-top:1px solid rgba(153,230,255,.88)");
    expect(styles).toContain("border-left:2px solid #99e6ff");
    expect(styles).toContain(".footer-links>div");
    expect(styles).toContain(".footer-bottom::before");
  });

  it("includes a restrained linked development credit in the footer", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(page).toContain("Designed and developed by");
    expect(page).toContain('href="https://github.com/Peter-Uwaechue"');
    expect(page).toContain(">September’s Very Own</a>");
    expect(styles).toContain(".footer-credit");
  });
});
