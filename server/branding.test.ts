import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("site branding", () => {
  it("uses the supplied Willers logo cleanly without coloured square background treatments", async () => {
    const [page, styles] = await Promise.all([
      readFile(path.join(projectRoot, "client/src/pages/Home.tsx"), "utf8"),
      readFile(path.join(projectRoot, "client/src/index.css"), "utf8"),
    ]);

    expect(page).toContain('mark: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663078623467/JxGlgVxeIGKRvwFP.png"');
    expect((page.match(/className="brand-logo"/g) ?? [])).toHaveLength(2);
    expect((page.match(/alt="Willers Solutions Limited"/g) ?? [])).toHaveLength(2);
    expect(page).toContain('className="footer-logo-mark"');
    expect(page).not.toContain('className="footer-logo-name-overlay"');
    expect(page).not.toContain('className="drawer-foot"');
    expect(page).toContain('return <div className="corporate-home"><Header /><main>');
    expect(styles).toContain(".brand-logo,.footer .brand-logo");
    expect(styles).toContain("padding:0!important; border:0!important; background:transparent!important; box-shadow:none!important");
    expect(styles).toContain(".footer .brand-logo { filter:none; opacity:1; }");
    expect(styles).toContain(".footer-logo-mark-frame { display:block; width:168px; height:56px; overflow:hidden; }");
    expect(styles).toContain(".header-dark .menu-toggle");
    expect(styles).toContain(".footer .brand-logo");
  });
});
