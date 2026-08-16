import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { renderToString } from "react-dom/server";
import superjson from "superjson";
import { Router } from "wouter";
import App from "./App";
import { trpc } from "./lib/trpc";
import { prefetchForPath, type HeadMeta, type SsrPrefetch } from "./ssr/prefetch";

export type RenderResult = { html: string; dehydratedState: unknown; head: HeadMeta };

export async function render(url: string, prefetch: SsrPrefetch): Promise<RenderResult> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const queryIndex = url.indexOf("?");
  const ssrPath = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const ssrSearch = queryIndex === -1 ? "" : url.slice(queryIndex + 1);
  const head = await prefetchForPath(url, queryClient, prefetch);
  const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })] });
  const html = renderToString(
    <Router ssrPath={ssrPath} ssrSearch={ssrSearch}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
      </trpc.Provider>
    </Router>,
  );

  return { html, dehydratedState: dehydrate(queryClient), head };
}
