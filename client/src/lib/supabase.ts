import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

// The fallback values keep local builds type-safe while the sign-in UI reports a
// useful configuration error instead of throwing during module evaluation.
export const supabase = createClient(
  url || "https://unconfigured.supabase.co",
  publishableKey || "unconfigured-publishable-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
