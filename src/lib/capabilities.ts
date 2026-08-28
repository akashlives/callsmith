import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function capabilityMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashCapabilityToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

