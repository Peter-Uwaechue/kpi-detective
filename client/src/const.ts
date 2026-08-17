import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Starts passwordless email sign-in. Supabase sends a magic link and restores
 * the session when the user returns to this same browser and approved domain.
 */
export const startLogin = async () => {
  if (!isSupabaseConfigured) {
    window.alert("Private uploads are being configured. Please try again shortly.");
    return;
  }

  const email = window.prompt("Enter your work email to receive a secure sign-in link:");
  if (!email?.trim()) return;

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin },
  });

  if (error) {
    window.alert(error.message || "We could not send your sign-in link. Please try again.");
    return;
  }

  window.alert("Check your email for your secure KPI Detective sign-in link.");
};
