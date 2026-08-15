import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Willers social channels", () => {
  it("provides Instagram, Facebook, X, and TikTok links in the footer and mobile drawer", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");

    expect(page).toContain('className="footer-social"');
    expect(page).toContain("https://ng.linkedin.com/company/willers-talents-limited");
    expect(page).toContain("https://www.instagram.com/willerssolutionlimited/");
    expect(page).toContain("https://www.facebook.com/Willers-Solutions-Limited-1037677022974258");
    expect(page).toContain("https://x.com/WillersLtd");
    expect(page).toContain("https://www.tiktok.com/@willerssl");
    expect(page).toContain('aria-label="Willers Solutions on TikTok"');
  });
});
