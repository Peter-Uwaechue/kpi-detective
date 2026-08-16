import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const homePageSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/Home.tsx"),
  "utf8",
);

describe("confirmed current vacancies", () => {
  it("replaces all placeholder job titles with the seven confirmed roles", () => {
    const roles = [
      "Product Sales Engineer (Turbomachinery)",
      "Product Sales Engineer (Valve)",
      "Product Sales Engineer (Air Filtration)",
      "Service Delivery Supervisor",
      "Enterprise Sales Executive",
      "Documentation & Reports Officer",
      "Sales and Business Development Manager",
    ];
    roles.forEach((role) => expect(homePageSource).toContain(role));
    expect(homePageSource).not.toContain('title: "Head of People & Culture"');
    expect(homePageSource).not.toContain('title: "Senior Product Manager"');
    expect(homePageSource).not.toContain('title: "Chief Financial Officer"');
    expect(homePageSource).not.toContain('title: "Project Director, Energy"');
  });

  it("uses the supplied locations, disclosed salaries, and full-time status", () => {
    expect(homePageSource).toContain('location: "Lekki, Lagos, Nigeria"');
    expect(homePageSource).toContain('location: "Ikeja, Lagos, Nigeria"');
    expect(homePageSource).toContain('salary: "₦250,000 – ₦400,000 net"');
    expect(homePageSource).toContain('salary: "₦500,000 – ₦600,000"');
    expect(homePageSource).toContain('type: "Full-Time"');
  });

  it("aligns salary and job-type filters with the confirmed vacancy data", () => {
    expect(homePageSource).toContain('value="250-499">₦250k – ₦499k / month');
    expect(homePageSource).toContain('value="500-plus">₦500k+ / month');
    expect(homePageSource).toContain('value="undisclosed">Salary not disclosed');
    expect(homePageSource).toContain('value="Full-Time">Full-Time');
    expect(homePageSource).toContain('value="Not specified">Not specified');
    expect(homePageSource).toContain('job.salaryMin === null');
  });

  it("uses per-role detail links and a CRLF-safe recruitment email draft", () => {
    expect(homePageSource).toContain('href={`/job-details?role=${job.slug}`}');
    expect(homePageSource).toContain('new URLSearchParams(window.location.search).get("role")');
    expect(homePageSource).toContain('const recruitmentContactEmail = "recruitment@willerssolutions.com"');
    expect(homePageSource).toContain('join("\\r\\n")');
    expect(homePageSource).toContain('mailto:${recruitmentContactEmail}');
  });
});
