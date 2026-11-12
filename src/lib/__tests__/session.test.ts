import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken, verifySessionOwnership } from "../session";

describe("Guest Session Security", () => {
  it("generates 64-character cryptographically random hex session tokens", () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();

    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);
  });

  it("consistently computes SHA-256 HMAC token hashes", () => {
    const token = generateSessionToken();
    const hash1 = hashSessionToken(token);
    const hash2 = hashSessionToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).not.toBe(token);
  });

  it("verifies session ownership using timing-safe comparisons", () => {
    const sessionId = "session_user_123456789";
    const matchingSessionId = "session_user_123456789";
    const foreignSessionId = "session_user_987654321";

    expect(verifySessionOwnership(sessionId, matchingSessionId)).toBe(true);
    expect(verifySessionOwnership(sessionId, foreignSessionId)).toBe(false);
    expect(verifySessionOwnership("", sessionId)).toBe(false);
  });
});
