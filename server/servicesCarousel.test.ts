import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("services carousel", () => {
  it("provides leadership-style automatic, manual, and mobile-swipe interactions", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain("function ServicesCarousel()");
    expect(page).toContain("(current + 1) % services.length), 3000");
    expect(page).toContain('aria-label="Previous service"');
    expect(page).toContain('aria-label="Next service"');
    expect(page).toContain("Pause automatic services carousel");
    expect(page).toContain('className="mobile-swipe-hint service-swipe-hint"');
    expect(page).toContain('tabIndex={0} onFocus={() => setActive(index)}');
    expect(styles).toContain(".service-carousel-rail");
    expect(styles).toContain(".service-carousel-rail .service-card.is-current");
    expect(styles).toContain(".service-carousel-rail .service-card { flex:0 0 100%");
    expect(styles).toContain(".service-carousel-viewport { overflow:hidden; }");
    expect(styles).toContain(".service-carousel { position:relative; padding-top:clamp(110px,12vw,172px); }");
    expect(styles).toContain(".service-carousel-rail .service-card:hover");
    expect(styles).toContain("@media (prefers-reduced-motion:reduce) { .service-carousel-rail .service-card");
  });
});
