import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const homePageSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/Home.tsx"),
  "utf8",
);

describe("employer partnership mailto fallback", () => {
  it("addresses employer briefs to the published Human Capital inbox", () => {
    expect(homePageSource).toContain('const employerContactEmail = "humancapital@willerssolutions.com"');
    expect(homePageSource).toContain("mailto:${employerContactEmail}");
  });

  it("includes the completed employer brief fields in the draft body", () => {
    expect(homePageSource).toContain("formValues.firstName");
    expect(homePageSource).toContain("formValues.organisation");
    expect(homePageSource).toContain("formValues.supportNeeded");
    expect(homePageSource).toContain("formValues.servicePriority");
    expect(homePageSource).toContain("formValues.scope");
    expect(homePageSource).toContain("formValues.timeline");
    expect(homePageSource).toContain("createEmailDraftHref(subject, body)");
    expect(homePageSource).toContain('`First name: ${formValues.firstName || "Not provided"}`,\n        "",\n        `Last name: ${formValues.lastName || "Not provided"}`');
    expect(homePageSource).toContain('`Support needed: ${formValues.supportNeeded || "Not provided"}`,\n        "",\n        `Service priority: ${formValues.servicePriority || "Not provided"}`');
  });

  it("uses encoded CRLF line breaks instead of literal backslash-n text in the email draft", () => {
    expect(homePageSource).toContain('const employerBriefLineBreak = "\\r\\n"');
    expect(homePageSource).toContain("const body = lines.join(employerBriefLineBreak)");
    expect(homePageSource).not.toMatch(/join\(["']\\\\n["']\)/);
  });

  it("keeps the Human Capital email address out of the employer success message", () => {
    expect(homePageSource).toContain("Your completed brief has been prepared in an email draft.");
    expect(homePageSource).toContain("Your email draft is ready. Please press Send in your email app to complete your request.");
    expect(homePageSource).not.toContain("deliver the completed brief to ${employerContactEmail}");
  });

  it("gives visitors a private fallback when no default email app is configured", () => {
    expect(homePageSource).toContain("No email app opened?");
    expect(homePageSource).toContain("Set up a default email app in your device settings");
  });

  it("routes support notes to the same Human Capital inbox with the shared CRLF draft builder", () => {
    expect(homePageSource).toContain("function ContactForm()");
    expect(homePageSource).toContain('const subject = `Support request — ${formValues.name || "New note"}`');
    expect(homePageSource).toContain('"New website support request"');
    expect(homePageSource).toContain("createEmailDraftHref(subject, [");
    expect(homePageSource).toContain("formValues.phone");
    expect(homePageSource).toContain("Phone number:");
    expect(homePageSource).toContain('label="Phone number" name="phone" type="tel"');
    expect(homePageSource).toContain('`Name: ${formValues.name || "Not provided"}`,\n        "",\n        `Email address: ${formValues.email || "Not provided"}`,\n        "",\n        `Phone number: ${formValues.phone || "Not provided"}`,\n        "",\n        `Support request: ${formValues.support || "Not provided"}`');
  });

  it("applies the same strict phone pattern across reusable and direct form fields", () => {
    expect(homePageSource).toContain('const phoneInputPattern = "\\\\+?[0-9][0-9\\\\s().-]{6,18}[0-9]"');
    expect(homePageSource).toContain("const sanitizePhoneInput = (value: string)");
    expect(homePageSource).toContain("replace(/[^0-9+.()");
    expect(homePageSource).toContain('type="tel" pattern={phoneInputPattern}');
    expect(homePageSource).toContain('type="tel" pattern={phoneInputPattern}');
    expect(homePageSource).toContain('type === "tel" ? sanitizePhoneInput(event.target.value) : event.target.value');
    expect(homePageSource).toContain('sanitizePhoneInput(event.target.value)');
  });

  it("shows immediate submitting feedback followed by a clear confirmation", () => {
    expect(homePageSource).toContain("const [isSubmitting, setIsSubmitting] = useState(false)");
    expect(homePageSource).toContain("setIsSubmitting(true)");
    expect(homePageSource).toContain("form-submit-spinner");
    expect(homePageSource).toContain("Preparing your email draft…");
    expect(homePageSource).toContain("Your email draft is ready. Please press Send");
  });
});
