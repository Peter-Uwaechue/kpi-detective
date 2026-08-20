import { startLogtoLogin } from "@/lib/logto";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Starts the provider-managed email verification-code flow. The user enters the
 * code in Logto's secure sign-in page and returns through the verified callback.
 */
export const startLogin = () => {
  void startLogtoLogin().catch(() => {
    window.alert("We could not start sign-in. Please refresh the page and try again.");
  });
};
