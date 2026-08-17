import { createClient } from "@supabase/supabase-js";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId, upsertUser } from "../db";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function authenticateSupabaseRequest(request: Request): Promise<User | null> {
  const token = bearerToken(request);
  if (!supabase || !token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const user = data.user;
  const name = typeof user.user_metadata?.full_name === "string"
    ? user.user_metadata.full_name
    : typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name
      : null;

  await upsertUser({
    openId: user.id,
    name,
    email: user.email ?? null,
    loginMethod: "supabase-email",
    lastSignedIn: new Date(),
  });

  return (await getUserByOpenId(user.id)) ?? null;
}
