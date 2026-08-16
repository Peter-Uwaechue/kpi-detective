import { describe, expect, it } from "vitest";
import { render } from "../client/src/entry-server";
import { getRouteMeta, SITE_NAME } from "../shared/seo";

describe("SSR route metadata", () => {
  it("provides a canonical, indexable home-page description", () => {
    const meta = getRouteMeta("/");
    expect(meta.canonicalPath).toBe("/");
    expect(meta.noindex).toBeUndefined();
    expect(meta.title).toContain(SITE_NAME);
  });

  it("gives each active vacancy a distinct canonical URL and article metadata", () => {
    const meta = getRouteMeta("/job-details?role=enterprise-sales-executive");
    expect(meta.title).toContain("Enterprise Sales Executive");
    expect(meta.canonicalPath).toBe("/job-details?role=enterprise-sales-executive");
    expect(meta.ogType).toBe("article");
  });

  it("keeps contact forms out of search results and returns genuine 404 metadata for unknown paths", () => {
    expect(getRouteMeta("/outsourcing/enquiry").noindex).toBe(true);
    expect(getRouteMeta("/not-a-real-page").notFound).toBe(true);
  });
});

describe("SSR public rendering", () => {
  it("renders vacancy content and the correct role into the initial HTML", async () => {
    const result = await render("/job-details?role=enterprise-sales-executive", {});
    expect(result.html).toContain("Enterprise Sales Executive");
    expect(result.html).toContain("Drive customer acquisition");
    expect(result.head.canonicalPath).toBe("/job-details?role=enterprise-sales-executive");
    expect(result.html).toContain('class="job-detail-share"');
    expect(result.html).toContain("https://www.linkedin.com/sharing/share-offsite/");
    expect(result.html).toContain("https://x.com/intent/post?");
    expect(result.html).toContain("https://wa.me/?text=");
    expect(result.html).toContain("Share Enterprise Sales Executive on LinkedIn");
    expect(result.html).toContain("Share Enterprise Sales Executive on X");
    expect(result.html).toContain("Share Enterprise Sales Executive on WhatsApp");
  });

  it("renders the dedicated employer enquiry form without browser globals", async () => {
    const result = await render("/outsourcing/enquiry", {});
    expect(result.html).toContain("Bring your people");
    expect(result.html).toContain("Organisation");
    expect(result.head.noindex).toBe(true);
  });

  it("embeds a complete, route-specific JobPosting record for each vacancy detail page", async () => {
    const disclosedSalary = await render("/job-details?role=enterprise-sales-executive", {});
    const undisclosedSalary = await render("/job-details?role=service-delivery-supervisor", {});
    const extractPosting = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1] ?? "{}") as Record<string, unknown>;
    const enterprise = extractPosting(disclosedSalary.html);
    const serviceDelivery = extractPosting(undisclosedSalary.html);

    expect(enterprise).toMatchObject({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Enterprise Sales Executive",
      datePosted: "2026-08-16",
      employmentType: "FULL_TIME",
      hiringOrganization: { name: "confidential" },
      jobLocation: { address: { addressCountry: "NG", addressRegion: "Lagos" } },
      baseSalary: { currency: "NGN", value: { minValue: 250000, maxValue: 400000, unitText: "MONTH" } },
    });
    expect(enterprise.description).toContain("<ul>");
    expect(enterprise.url).toBe("https://willers-solution-beta.vercel.app/job-details?role=enterprise-sales-executive");
    expect(serviceDelivery).toMatchObject({ "@type": "JobPosting", title: "Service Delivery Supervisor" });
    expect(serviceDelivery).not.toHaveProperty("baseSalary");
  });
});
