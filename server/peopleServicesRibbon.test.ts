import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("middle-page people-services ribbon", () => {
  it("adds a continuous animated statement of Willers’ connected people-services offer", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain("<PeopleServicesRibbon />");
    expect(page).toContain("Recruitment & executive search");
    expect(page).toContain("HR advisory & organisation design");
    expect(page).toContain("Outsourcing, built to deliver");
    expect(page).toContain("Learning & capability development");
    expect(styles).toContain(".people-services-ribbon");
    expect(styles).toContain("@keyframes people-services-flow");
    expect(styles).toContain("prefers-reduced-motion:reduce");
  });
});
