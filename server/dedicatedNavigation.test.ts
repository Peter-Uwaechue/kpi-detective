import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("dedicated major navigation", () => {
  it("routes every homepage scenario card to a subject-matched dedicated service page", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    expect(page).toContain('assets.scenarioRecruitment, "/services/recruitment-executive-search"');
    expect(page).toContain('assets.scenarioHr, "/services/hr-advisory-organisation-design"');
    expect(page).toContain('assets.scenarioWorkforce, "/outsourcing/solutions"');
    expect(page).not.toContain('assets.scenarioRecruitment, "/for-employers"');
    expect(page).not.toContain('assets.scenarioHr, "/our-services"');
  });

  it("uses dedicated destinations in the homepage service-navigation section", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    expect(page).toContain('"Recruitment & search", "Talent acquisition, executive search, and hiring support for organisations building with intent.", "/services/recruitment-executive-search"');
    expect(page).toContain('"HR & talent advisory", "People strategy, organisation design, leadership, and everyday people practice.", "/services/hr-advisory-organisation-design"');
    expect(page).toContain('"Outsourcing", "Flexible operational capacity, project teams, and people operations support.", "/outsourcing/solutions"');
    expect(page).toContain('"Careers", "Search opportunities and take the next considered step in your career.", "/job-search"');
    expect(page).not.toContain('"HR & talent advisory", "People strategy, organisation design, leadership, and everyday people practice.", "/our-services"');
  });

  it("provides dedicated leadership and outsourcing destination routes", async () => {
    const [page, app] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/App.tsx"), "utf8"),
    ]);

    expect(page).toContain("function LeadershipDirectory()");
    expect(page).toContain('if (location === "/leadership") return <LeadershipDirectory />');
    expect(page).toContain('href="/outsourcing/enquiry"');
    expect(page).toContain('href="/outsourcing/solutions"');
    expect(page).toContain('href="/contact-us" className="profile-text-link"');
    expect(app).toContain('<Route path="/outsourcing/solutions" component={Home} />');
    expect(app).toContain('<Route path="/outsourcing/enquiry" component={Home} />');
  });
});
