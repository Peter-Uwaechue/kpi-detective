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
  });

  it("renders the dedicated employer enquiry form without browser globals", async () => {
    const result = await render("/outsourcing/enquiry", {});
    expect(result.html).toContain("Bring your people");
    expect(result.html).toContain("Organisation");
    expect(result.head.noindex).toBe(true);
  });
});
