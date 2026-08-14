import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("global scroll manager", () => {
  it("resets link navigation while preserving saved positions for history navigation", async () => {
    const source = await readFile(path.join(projectRoot, "client/src/components/ScrollManager.tsx"), "utf8");

    expect(source).toContain('const SCROLL_STATE_KEY = "__willersScrollPosition"');
    expect(source).toContain("window.history.scrollRestoration = \"manual\"");
    expect(source).toContain("window.history.replaceState");
    expect(source).toContain("window.addEventListener(\"popstate\", markHistoryNavigation)");
    expect(source).toContain("const saved = getSavedPosition()");
    expect(source).toContain("window.scrollTo({ top: saved.y, left: saved.x, behavior: \"auto\" })");
    expect(source).toContain("linkNavigation.current = true");
    expect(source).toContain("sameDocument && destination.hash");
  });
});
