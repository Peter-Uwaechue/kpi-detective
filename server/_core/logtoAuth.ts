import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId, getUsersByVerifiedEmail, upsertUser } from "../db";

const LOGTO_ISSUER = (process.env.LOGTO_ISSUER || "https://xcv3hr.logto.app/oidc").replace(/\/$/, "");
const LOGTO_APP_ID = process.env.LOGTO_APP_ID || "pyb7fljckooo2g0anv35y";
const logtoJwks = createRemoteJWKSet(new URL(`${LOGTO_ISSUER}/jwks`));

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

const displayName = (payload: Record<string, unknown>) => {
  if (typeof payload.name === "string" && payload.name.trim()) return payload.name.trim();
  if (typeof payload.preferred_username === "string" && payload.preferred_username.trim()) {
    return payload.preferred_username.trim();
  }
  return null;
};

/**
 * Validates only ID tokens minted by KPI Detective's configured Logto SPA.
 * Existing Supabase identities are linked only when exactly one legacy account
 * has the same verified email address; ambiguous matches remain separate.
 */
export async function authenticateLogtoRequest(request: Request): Promise<User | null> {
  const token = bearerToken(request);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, logtoJwks, {
      issuer: LOGTO_ISSUER,
      audience: LOGTO_APP_ID,
    });

    const subject = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
    if (!subject || !email || payload.email_verified !== true) return null;

    const logtoOpenId = `logto:${subject}`;
    const existingLogtoUser = await getUserByOpenId(logtoOpenId);
    if (existingLogtoUser) {
      await upsertUser({
        openId: existingLogtoUser.openId,
        name: displayName(payload),
        email,
        loginMethod: "logto-email-code",
        lastSignedIn: new Date(),
      });
      return (await getUserByOpenId(existingLogtoUser.openId)) ?? null;
    }

    const sameEmailUsers = await getUsersByVerifiedEmail(email);
    if (sameEmailUsers.length === 1 && sameEmailUsers[0]?.loginMethod === "supabase-email") {
      const legacyUser = sameEmailUsers[0];
      await upsertUser({
        openId: legacyUser.openId,
        lastSignedIn: new Date(),
      });
      return (await getUserByOpenId(legacyUser.openId)) ?? legacyUser;
    }

    await upsertUser({
      openId: logtoOpenId,
      name: displayName(payload),
      email,
      loginMethod: "logto-email-code",
      lastSignedIn: new Date(),
    });

    return (await getUserByOpenId(logtoOpenId)) ?? null;
  } catch {
    return null;
  }
}
