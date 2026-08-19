import type { Express, Request } from "express";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const PRODUCTION_ORIGIN = "https://kpi-detective.vercel.app";
const REQUEST_COOLDOWN_MS = 60_000;
const recentRequests = new Map<string, number>();

function publicOrigin(request: Request) {
  const host = request.get("host")?.toLowerCase();
  const protocol = request.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.protocol;
  if (!host) return "";
  return `${protocol}://${host}`;
}

function isAllowedOrigin(request: Request) {
  const origin = request.get("origin");
  const expected = publicOrigin(request);
  if (!origin) return true;
  return origin === expected || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost(?::\d+)?$/.test(origin));
}

function requestKey(request: Request, email: string) {
  const forwarded = request.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.ip || "unknown";
  return `${address}:${email.toLowerCase()}`;
}

export function registerMagicLinkRoute(app: Express) {
  app.post("/api/auth/magic-link", async (request, response) => {
    if (!isAllowedOrigin(request)) {
      response.status(403).json({ error: "This sign-in request must come from KPI Detective." });
      return;
    }

    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      response.status(400).json({ error: "Enter a valid email address." });
      return;
    }

    if (!supabase) {
      response.status(503).json({ error: "Secure sign-in is temporarily unavailable. Please try again shortly." });
      return;
    }

    const key = requestKey(request, email);
    const previous = recentRequests.get(key) ?? 0;
    if (Date.now() - previous < REQUEST_COOLDOWN_MS) {
      response.status(429).json({ error: "Please wait one minute before requesting another sign-in link." });
      return;
    }

    recentRequests.set(key, Date.now());
    const redirectTo = process.env.NODE_ENV === "production" ? PRODUCTION_ORIGIN : publicOrigin(request);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) {
        recentRequests.delete(key);
        response.status(error.status && error.status >= 400 && error.status < 500 ? error.status : 502).json({ error: error.message || "We could not send your sign-in link. Please try again." });
        return;
      }
      response.status(200).json({ success: true });
    } catch (error) {
      recentRequests.delete(key);
      console.error("[Auth] Failed to request Supabase magic link", error);
      response.status(502).json({ error: "We could not reach the secure sign-in service. Please try again." });
    }
  });
}
