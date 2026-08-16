export type RouteMeta = {
  title: string;
  description: string;
  canonicalPath?: string;
  ogType?: "website" | "article";
  ogImage?: string;
  noindex?: boolean;
  notFound?: boolean;
};

export const SITE_NAME = "Willers Solutions Limited";
export const SITE_DESCRIPTION = "Willers Solutions is a people partner for recruitment, outsourcing, HR advisory, and talent development in Nigeria.";
export const DEFAULT_OG_IMAGE = "https://willersrec-7ucxtuga.manus.space/manus-storage/willers-local-hero-lagos_10110178.jpg";

const withSite = (title: string) => `${title} | ${SITE_NAME}`;

const staticRoutes: Record<string, RouteMeta> = {
  "/": { title: withSite("HR, recruitment, outsourcing & talent advisory"), description: SITE_DESCRIPTION, canonicalPath: "/" },
  "/job-search": { title: withSite("Current job opportunities"), description: "Explore current recruitment opportunities managed by Willers Solutions across engineering, sales, operations, technology, and packaging.", canonicalPath: "/job-search" },
  "/for-employers": { title: withSite("Employer services"), description: "Connect recruitment, outsourcing, HR advisory, and people operations through a practical employer partnership with Willers Solutions.", canonicalPath: "/for-employers" },
  "/outsourcing": { title: withSite("Outsourcing services"), description: "Build dependable workforce capacity with outsourcing support shaped around your operational requirements and people priorities.", canonicalPath: "/outsourcing" },
  "/outsourcing/solutions": { title: withSite("Outsourcing solutions"), description: "Explore practical outsourcing models for operational capacity, people operations, and changing workforce requirements.", canonicalPath: "/outsourcing/solutions" },
  "/industries": { title: withSite("Industries we support"), description: "Explore the industries Willers Solutions supports through recruitment, outsourcing, HR advisory, and talent development.", canonicalPath: "/industries" },
  "/about-us": { title: withSite("About Willers Solutions"), description: "Learn how Willers Solutions connects people strategy, recruitment, outsourcing, and practical HR support.", canonicalPath: "/about-us" },
  "/leadership": { title: withSite("Leadership"), description: "Meet the experienced leaders whose perspective guides Willers Solutions across talent, operations, and workforce decisions.", canonicalPath: "/leadership" },
  "/leadership/hannah-uwaechue": { title: withSite("Hannah Uwaechue"), description: "Read Hannah Uwaechue’s leadership profile as Director, Strategy & Talent Advisory at Willers Solutions Limited.", canonicalPath: "/leadership/hannah-uwaechue" },
  "/leadership/remi-abubakar-bello": { title: withSite("Remi Abubakar Bello"), description: "Read Remi Abubakar Bello’s leadership profile and his perspective on energy operations, technical leadership, and governance.", canonicalPath: "/leadership/remi-abubakar-bello" },
  "/leadership/funmi-bashorun": { title: withSite("Funmi Bashorun"), description: "Read Funmi Bashorun’s leadership profile and her perspective on energy markets, trade operations, and commercial clarity.", canonicalPath: "/leadership/funmi-bashorun" },
  "/our-services": { title: withSite("Our services"), description: "Explore recruitment, outsourcing, HR advisory, people operations, and learning support from Willers Solutions.", canonicalPath: "/our-services" },
  "/resources": { title: withSite("Resources"), description: "Explore practical Willers Solutions resources for hiring, outsourcing, workforce planning, and HR practice.", canonicalPath: "/resources" },
  "/insights": { title: withSite("Insights"), description: "Read Willers Solutions perspectives on recruitment, outsourcing, HR operations, leadership, and workforce planning.", canonicalPath: "/insights" },
  "/insights/preparing-capability-for-the-work-ahead": { title: withSite("Preparing capability for the work ahead"), description: "A practical Willers Solutions guide to talent planning, workforce capability, leadership needs, and preparing for the work ahead.", canonicalPath: "/insights/preparing-capability-for-the-work-ahead", ogType: "article" },
  "/insights/making-the-first-hiring-brief-more-useful": { title: withSite("Making the first hiring brief more useful"), description: "A Willers Solutions employer guide to clearer hiring briefs, role mandates, operating context, and essential capability.", canonicalPath: "/insights/making-the-first-hiring-brief-more-useful", ogType: "article" },
  "/insights/what-to-clarify-before-strengthening-hr-operations": { title: withSite("What to clarify before strengthening HR operations"), description: "A practical Willers Solutions note on HR operations, compliance, responsibility, and the employee experience.", canonicalPath: "/insights/what-to-clarify-before-strengthening-hr-operations", ogType: "article" },
  "/resources/hiring-and-workforce-planning": { title: withSite("Hiring and workforce planning"), description: "A practical Willers Solutions resource for clarifying work, capability, and workforce support before a hiring decision.", canonicalPath: "/resources/hiring-and-workforce-planning", ogType: "article" },
  "/resources/outsourcing-playbooks": { title: withSite("Outsourcing playbooks"), description: "A Willers Solutions resource on shaping flexible outsourcing models with clarity, oversight, and care.", canonicalPath: "/resources/outsourcing-playbooks", ogType: "article" },
  "/resources/manager-and-hr-practice": { title: withSite("Manager and HR practice"), description: "A practical Willers Solutions resource for onboarding, performance conversations, employee experience, and everyday people leadership.", canonicalPath: "/resources/manager-and-hr-practice", ogType: "article" },
  "/resources/career-development": { title: withSite("Career development"), description: "A Willers Solutions resource for professionals preparing for their next move and building durable capability.", canonicalPath: "/resources/career-development", ogType: "article" },
  "/contact-us": { title: withSite("Contact us"), description: "Start a conversation with Willers Solutions about recruitment, outsourcing, HR advisory, people operations, or talent needs.", canonicalPath: "/contact-us" },
  "/services/recruitment-executive-search": { title: withSite("Recruitment & executive search"), description: "Recruit executive, specialist, permanent, and high-volume talent with a process built around business context.", canonicalPath: "/services/recruitment-executive-search" },
  "/services/hr-advisory-organisation-design": { title: withSite("HR advisory & organisation design"), description: "Create people structures, workforce plans, and HR practices that help organisations grow with intent.", canonicalPath: "/services/hr-advisory-organisation-design" },
  "/services/people-operations-payroll": { title: withSite("People operations & payroll support"), description: "Bring reliable structure to people operations, workforce coordination, payroll support, and the employee lifecycle.", canonicalPath: "/services/people-operations-payroll" },
  "/services/learning-capability-development": { title: withSite("Learning & capability development"), description: "Build practical leadership and workforce capability that is connected to the work your teams need to deliver.", canonicalPath: "/services/learning-capability-development" },
};

const jobTitles: Record<string, string> = {
  "product-sales-engineer-turbomachinery": "Product Sales Engineer (Turbomachinery)",
  "product-sales-engineer-valve": "Product Sales Engineer (Valve)",
  "product-sales-engineer-air-filtration": "Product Sales Engineer (Air Filtration)",
  "service-delivery-supervisor": "Service Delivery Supervisor",
  "enterprise-sales-executive": "Enterprise Sales Executive",
  "documentation-reports-officer": "Documentation & Reports Officer",
  "sales-business-development-manager": "Sales and Business Development Manager",
};

export function getRouteMeta(rawUrl: string): RouteMeta {
  const url = new URL(rawUrl, "https://willers-ssr.local");
  const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
  const role = url.searchParams.get("role");

  if (pathname === "/job-details") {
    const title = role ? jobTitles[role] : undefined;
    if (!title) return { title: withSite("Page not found"), description: SITE_DESCRIPTION, notFound: true };
    return {
      title: withSite(title),
      description: `Apply for the ${title} opportunity managed by Willers Solutions. Review the role requirements, qualifications, and application instructions.`,
      canonicalPath: `/job-details?role=${encodeURIComponent(role ?? "")}`,
      ogType: "article",
    };
  }

  if (pathname === "/services/workforce-outsourcing") {
    return { ...staticRoutes["/outsourcing"]!, canonicalPath: "/outsourcing" };
  }
  if (pathname === "/reading-insights") return { ...staticRoutes["/insights"]!, canonicalPath: "/insights" };
  if (pathname === "/apply-now") return { title: withSite("Apply now"), description: "Submit a considered application to Willers Solutions for a relevant opportunity.", noindex: true };
  if (pathname === "/post-a-job" || pathname === "/outsourcing/enquiry") {
    return { title: withSite("Start an employer conversation"), description: "Share your recruitment, outsourcing, HR, or people operations requirement with Willers Solutions.", noindex: true };
  }
  return staticRoutes[pathname] ?? { title: withSite("Page not found"), description: SITE_DESCRIPTION, notFound: true };
}
