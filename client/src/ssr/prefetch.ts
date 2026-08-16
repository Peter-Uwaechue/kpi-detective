import type { QueryClient } from "@tanstack/react-query";
import { getRouteMeta, type RouteMeta } from "@shared/seo";

export type HeadMeta = RouteMeta;
export type SsrPrefetch = Record<string, never>;

export async function prefetchForPath(url: string, _queryClient: QueryClient, _prefetch: SsrPrefetch): Promise<HeadMeta> {
  return getRouteMeta(url);
}
