import { UNAUTHED_ERR_MSG } from "@shared/const";
import { HydrationBoundary, QueryClient, QueryClientProvider, type DehydratedState } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { hydrateRoot } from "react-dom/client";
import superjson from "superjson";
import { Router } from "wouter";
import App from "./App";
import { startLogin } from "./const";
import { getLogtoIdToken } from "./lib/logto";
import { trpc } from "./lib/trpc";
import { supabase } from "./lib/supabase";
import "./index.css";

declare global { interface Window { __RQ_STATE__?: unknown } }

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError) || error.message !== UNAUTHED_ERR_MSG) return;
  startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.query.state.error);
    console.error("[API Query Error]", event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.mutation.state.error);
    console.error("[API Mutation Error]", event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [httpBatchLink({
    url: "/api/trpc",
    transformer: superjson,
    async headers() {
      const logtoToken = getLogtoIdToken();
      if (logtoToken) return { Authorization: `Bearer ${logtoToken}` };

      const { data } = await supabase.auth.getSession();
      return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
    },
    fetch(input, init) { return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" }); },
  })],
});

const dehydratedState = window.__RQ_STATE__ ? superjson.deserialize(window.__RQ_STATE__ as any) as DehydratedState : undefined;

hydrateRoot(document.getElementById("root")!, <Router ssrPath={window.location.pathname} ssrSearch={window.location.search}><trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><HydrationBoundary state={dehydratedState}><App /></HydrationBoundary></QueryClientProvider></trpc.Provider></Router>);
