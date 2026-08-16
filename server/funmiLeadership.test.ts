import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Funmi Bashorun leadership profile", () => {
  it("replaces Tunde’s carousel position with a rectangular portrait and source-grounded profile", async () => {
    const [source, app] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/App.tsx"), "utf8"),
    ]);

    expect(source).toContain('leadershipFunmi: publishedAsset("funmi-bashorun-colour-rectangular_aba3de2d.png")');
    expect(source).toContain('name: "Funmi Bashorun"');
    expect(source).toContain('title: "Energy Markets & Trade Advisor"');
    expect(source).toContain("18+ years in downstream petroleum and regional markets");
    expect(source).toContain("Shield Petroleum");
    expect(source).toContain("Nimex Petroleum Group");
    expect(source).toContain("Since joining Argus in 2020");
    expect(source).toContain("function FunmiProfile()");
    expect(source).toContain('name="Funmi Bashorun" focus="Energy markets, trade operations, and regional commercial clarity."');
    expect(source).not.toContain("<FunmiContactForm />");
    expect(source).not.toContain('<section id="contact-funmi"');
    expect(source).not.toContain('href="#contact-funmi"');
    expect(source).toContain('profile: "/leadership/funmi-bashorun"');
    expect(source).not.toContain('{ name: "Tunde Bello", title: "Director, Talent Advisory"');
    expect(app).toContain('<Route path="/leadership/funmi-bashorun" component={Home} />');
  });
});
