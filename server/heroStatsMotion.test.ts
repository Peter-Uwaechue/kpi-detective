import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("hero statistics motion", () => {
  it("uses a brief staggered opacity-and-transform reveal with a reduced-motion safeguard", async () => {
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(styles).toContain("@media (prefers-reduced-motion:no-preference) { .hero-stats>div");
    expect(styles).toContain("animation:hero-stat-reveal .62s");
    expect(styles).toContain(".hero-stats>div:nth-child(2) { animation-delay:.12s; }");
    expect(styles).toContain("@media (prefers-reduced-motion:reduce) { .hero-stats>div { opacity:1; transform:none; animation:none; } }");
  });
});
