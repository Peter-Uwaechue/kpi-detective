import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("locally grounded photography", () => {
  it("uses original Nigerian executive and workforce image assets across the shared image map", async () => {
    const source = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");

    expect(source).toContain("willers-local-hero-lagos_10110178.jpg");
    expect(source).toContain("willers-local-recruitment_6dcf4b4c.jpg");
    expect(source).toContain("willers-local-workforce_0b686b00.jpg");
    expect(source).toContain("willers-local-people-operations_75aefed4.jpg");
    expect(source).toContain("willers-local-learning_1f52898c.jpg");
    expect(source).toContain("learning: publishedAsset(\"willers-local-learning_1f52898c.jpg\")");
    expect(source).toContain("scenarioRecruitment");
    expect(source).toContain("scenarioHr");
    expect(source).toContain("scenarioWorkforce");
    expect(source).toContain("insightWorkforce");
    expect(source).toContain("insightEmployer");
    expect(source).toContain("insightOutsourcing");
    expect(source).toContain("outsourcingManaged");
    expect(source).toContain("outsourcingFlexible");
  });

  it("presents HR, recruitment, outsourcing, and talent advisory as a balanced core offer", async () => {
    const source = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    const serviceBlock = source.slice(source.indexOf("const services = ["), source.indexOf("const serviceDetailData"));

    expect(serviceBlock).toMatch(/01.*Recruitment & Executive Search[\s\S]*02.*HR Advisory & Organisation Design[\s\S]*03.*People Operations & Payroll Support[\s\S]*04.*Learning & Capability Development[\s\S]*05.*Outsourcing/);
    expect(source).toContain("HR, recruitment,<br /><em>outsourcing & talent advisory.</em>");
  });
});
