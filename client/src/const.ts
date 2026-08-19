

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Starts passwordless email sign-in. Supabase sends a magic link and restores
 * the session when the user returns to this same browser and approved domain.
 */
export const startLogin = async () => {
  const email = window.prompt("Enter your email address to receive a secure sign-in link:");
  if (!email?.trim()) return;

  try {
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const payload = await response.json().catch(() => ({} as { error?: string }));

    if (!response.ok) {
      window.alert(payload.error || "We could not send your sign-in link. Please try again.");
      return;
    }

    window.alert("Check your email for your secure KPI Detective sign-in link.");
  } catch {
    window.alert("We could not connect to KPI Detective to request your sign-in link. Please refresh the page and try again.");
  }
};
