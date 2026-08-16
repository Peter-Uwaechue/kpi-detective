import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Remi Abubakar Bello leadership profile", () => {
  it("uses the approved original-site portrait and a source-grounded dedicated profile", async () => {
    const [source, app] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/App.tsx"), "utf8"),
    ]);

    expect(source).toContain('leadershipRemi: publishedAsset("remi-abubakar-bello-full_f903576c.png")');
    expect(source).toContain('name: "Remi Abubakar Bello"');
    expect(source).toContain('title: "Senior Energy & Operations Advisor"');
    expect(source).toContain("15 years with ExxonMobil");
    expect(source).toContain("Nigeria Society of Engineers");
    expect(source).toContain("/leadership/remi-abubakar-bello");
    expect(source).toContain("function RemiProfile()");
    expect(source).toContain('name="Remi Abubakar Bello" focus="Technical depth, operational discipline, and governance context."');
    expect(source).not.toContain("<RemiContactForm />");
    expect(source).not.toContain('<section id="contact-remi"');
    expect(source).not.toContain('href="#contact-remi"');
    expect(source).not.toContain('href="/about-us#leadership"');
    expect(source).toContain('<Link href="/leadership" className="profile-back"><ArrowLeft size={16} /><span>Back to Leadership</span></Link>');
    expect(source).toContain('<Link href="/leadership" className="profile-text-link">Meet the leadership team');
    expect(source).not.toContain('{ name: hannahProfile.name, title: hannahProfile.title, image: hannahProfile.image, position: "center 46%", profile: "/leadership/hannah-uwaechue"');
    expect(app).toContain('<Route path="/leadership/remi-abubakar-bello" component={Home} />');
  });
});
