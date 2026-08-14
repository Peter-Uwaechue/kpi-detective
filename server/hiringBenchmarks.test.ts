import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("hiring benchmark counters", () => {
  it("uses the supplied verified Willers Solutions recruitment metrics for January–December 2025", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain("<HiringBenchmarks />");
    expect(page).toContain("function AnimatedBenchmarkCounter");
    expect(page).toContain("value: 81, suffix: \"%\", label: \"Offer acceptance\"");
    expect(page).toContain('value: 29, suffix: " days", label: "Average time to hire"');
    expect(page).toContain("value: 31, suffix: \"%\", label: \"Applicant to interview\"");
    expect(page).toContain("value: 26, suffix: \"%\", label: \"Interview to offer\"");
    expect(page).toContain("value: 88, suffix: \"%\", label: \"Quality of hire\"");
    expect(page).toContain("value: 91, suffix: \"%\", label: \"12-month candidate retention\"");
    expect(page).toContain("value: 93, suffix: \"%\", label: \"Client satisfaction\"");
    expect(page).toContain("value: 95, suffix: \"%\", label: \"Process completion\"");
    expect(page).toContain("January–December 2025");
    expect(page).toContain('className="hiring-benchmarks-cta"');
    expect(page).toContain('<Button href="/post-a-job">Start hiring with Willers</Button>');
    expect(page).not.toContain("www.crosschq.com/blog/time-to-hire-offer-acceptance-rate");
    expect(page).not.toContain("2022-Recruiting-Metrics-Report.pdf");
    expect(styles).toContain(".hiring-benchmarks");
    expect(styles).toContain(".hiring-benchmarks-metrics");
    expect(styles).toContain(".hiring-benchmarks-cta");
  });
});
