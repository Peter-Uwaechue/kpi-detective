import type { Request, Response } from "express";
import type { SsrPrefetch } from "../../client/src/ssr/prefetch";

// Public Willers pages currently render from approved in-code content, so no
// request-specific data is prefetched. Keeping this boundary makes it safe to
// add viewer-independent tRPC prefetching later without changing SSR plumbing.
export async function buildSsrPrefetch(_req: Request, _res: Response): Promise<SsrPrefetch> {
  return {};
}
