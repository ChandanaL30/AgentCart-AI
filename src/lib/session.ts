import crypto from "crypto";
import { cookies } from "next/headers";
import { env } from "./env";

export const SESSION_COOKIE_NAME = "agentcart_session";
const SESSION_EXPIRY_DAYS = 30;

export interface GuestSessionPayload {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Generates a cryptographically random session token (32 bytes = 64 hex chars).
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes a secure SHA-256 HMAC hash of the session token.
 * This guarantees the raw cookie value is never stored in plain text.
 */
export function hashSessionToken(token: string): string {
  return crypto
    .createHmac("sha256", env.SESSION_SECRET)
    .update(token)
    .digest("hex");
}

/**
 * Computes an anonymized IP address hash for audit trails without storing PII.
 */
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto
    .createHmac("sha256", env.SESSION_SECRET)
    .update(ip)
    .digest("hex")
    .substring(0, 16);
}

/**
 * Standard cookie configuration for HttpOnly, SameSite guest session.
 */
export function getSessionCookieOptions() {
  const isProduction = env.NODE_ENV === "production";
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
  };
}

/**
 * Reads existing session token from cookies or generates a new one.
 */
export async function getOrCreateSessionToken(): Promise<{
  token: string;
  tokenHash: string;
  isNew: boolean;
}> {
  const cookieStore = await cookies();
  const existingCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (existingCookie?.value && existingCookie.value.length >= 32) {
    const token = existingCookie.value;
    return {
      token,
      tokenHash: hashSessionToken(token),
      isNew: false,
    };
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);

  cookieStore.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

  return {
    token,
    tokenHash,
    isNew: true,
  };
}

/**
 * Server-side ownership validator: verifies that an entity's guestSessionId matches the requester's session.
 */
export function verifySessionOwnership(
  requesterSessionId: string,
  resourceSessionId: string
): boolean {
  if (!requesterSessionId || !resourceSessionId) return false;
  return crypto.timingSafeEqual(
    Buffer.from(requesterSessionId),
    Buffer.from(resourceSessionId)
  );
}
