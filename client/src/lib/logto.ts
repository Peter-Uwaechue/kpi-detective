const LOGTO_ENDPOINT = (import.meta.env.VITE_LOGTO_ENDPOINT || "https://xcv3hr.logto.app/oidc").replace(/\/$/, "");
const LOGTO_APP_ID = import.meta.env.VITE_LOGTO_APP_ID || "pyb7fljckooo2g0anv35y";

const STATE_KEY = "kpi-detective.logto.state";
const VERIFIER_KEY = "kpi-detective.logto.verifier";
const TOKEN_KEY = "kpi-detective.logto.tokens";

type StoredTokens = {
  idToken: string;
  accessToken: string;
  expiresAt: number;
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const randomValue = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
};

const callbackUrl = () => `${window.location.origin}/auth/logto/callback`;

export const startLogtoLogin = async () => {
  const state = randomValue();
  const verifier = randomValue();
  const challenge = await sha256(verifier);

  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: LOGTO_APP_ID,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "openid profile email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.assign(`${LOGTO_ENDPOINT}/auth?${params.toString()}`);
};

export const finishLogtoLogin = async () => {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);

  if (error) {
    throw new Error("Sign-in was not completed. Please request a new code and try again.");
  }
  if (!code || !state || !verifier || state !== expectedState) {
    throw new Error("Your sign-in session could not be verified. Please try again.");
  }

  const response = await fetch(`${LOGTO_ENDPOINT}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: LOGTO_APP_ID,
      code,
      redirect_uri: callbackUrl(),
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error("We could not finish your sign-in. Please request a new code and try again.");
  }

  const payload = await response.json() as { id_token?: string; access_token?: string; expires_in?: number };
  if (!payload.id_token || !payload.access_token) {
    throw new Error("Your sign-in response was incomplete. Please try again.");
  }

  const tokens: StoredTokens = {
    idToken: payload.id_token,
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 300) * 1000,
  };

  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
};

export const getLogtoIdToken = () => {
  try {
    const tokens = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null") as StoredTokens | null;
    if (!tokens?.idToken || tokens.expiresAt <= Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return tokens.idToken;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    return null;
  }
};

export const clearLogtoSession = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
};

export const logtoSignOutUrl = () => {
  const params = new URLSearchParams({
    client_id: LOGTO_APP_ID,
    post_logout_redirect_uri: `${window.location.origin}/`,
  });
  return `${LOGTO_ENDPOINT}/session/end?${params.toString()}`;
};
