import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("footer visual refinement", () => {
  it("uses a layered midnight-blue treatment with light-blue hierarchy and mobile link dividers", async () => {
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(styles).toContain("radial-gradient(circle at 88% 8%,rgba(42,128,164,.24)");
    expect(styles).toContain("border-top:1px solid rgba(153,230,255,.88)");
    expect(styles).toContain("border-left:2px solid #99e6ff");
    expect(styles).toContain(".footer-links>div");
    expect(styles).toContain(".footer-bottom::before");
    expect(styles).toContain(".footer-social a svg");
    expect(styles).toContain("rotate(-5deg)");
    expect(styles).toContain(".footer-social a:active");
  });

  it("includes a restrained linked development credit in the footer", async () => {
    const page = await readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8");
    const styles = await readFile(path.join(projectRoot, "client/src/index.css"), "utf8");

    expect(page).toContain("Designed and developed by");
    expect(page).toContain('href="https://github.com/Peter-Uwaechue"');
    expect(page).toContain(">September’s Very Own</a>");
    expect(page).not.toContain("Built for better people work.");
    expect(page).toContain("8, Adebambo Street, Obanikoro, Lagos");
    expect(page).not.toContain("5b, Samuel Adedoyin, Behind Zenith Headquarters, Victoria Island, Lagos");
    expect(page).toContain('href="https://www.google.com/maps/dir/?api=1&destination=8%2C%20Adebambo%20Street%2C%20Obanikoro%2C%20Lagos"');
    expect(page).toContain("Get directions to Willers Solutions in Obanikoro on Google Maps");
    expect(page).toContain("Hours: Mon–Sat, 8:00 AM–6:00 PM");
    expect(styles).toContain(".footer-credit");
    expect(styles).toContain(".footer-contact-detail");
    expect(styles).toContain(".footer-contact-detail:focus-visible");
    expect(styles).toContain(".footer-operating-hours");
    expect(styles).toContain("color:rgba(249,247,242,.54)");
  });
});
