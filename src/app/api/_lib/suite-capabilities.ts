import { SuiteRepositoryError } from "@/lib/suite-repository";

import { jsonError } from "./http";

export function bearerCapability(request: Request): string | undefined {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  return token || undefined;
}

export function confirmationCapability(request: Request): string | undefined {
  const token = request.headers
    .get("x-callsmith-confirmation-token")
    ?.trim();
  return token || undefined;
}

/**
 * Capability failures intentionally collapse to a small public error surface.
 * Repository diagnostics stay server-side and never reveal whether a draft,
 * owner token, or confirmation token was the part that matched.
 */
export function suiteRepositoryError(error: unknown): Response {
  if (!(error instanceof SuiteRepositoryError)) {
    return jsonError(500, "Unable to process the suite request");
  }

  switch (error.code) {
    case "INVALID_DRAFT":
    case "DRAFT_TOO_LARGE":
    case "INVALID_SUITE":
      return jsonError(422, "Suite draft is invalid");
    case "DRAFT_NOT_FOUND":
    case "CONFIRMATION_INVALID":
      return jsonError(404, "Suite draft not found");
    case "CONFIRMATION_EXPIRED":
      return jsonError(410, "Confirmation is no longer valid");
    case "DRAFT_REJECTED":
    case "DRAFT_ALREADY_PUBLISHED":
    case "CONFIRMATION_REQUIRED":
    case "STALE_DRAFT":
    case "SUITE_VERSION_EXISTS":
      return jsonError(409, "Suite draft cannot be approved");
  }
}

/** Rejection keeps the same capability non-enumeration as owner reads. */
export function suiteRejectionError(error: unknown): Response {
  if (!(error instanceof SuiteRepositoryError)) {
    return jsonError(500, "Unable to process the suite request");
  }

  if (error.code === "DRAFT_NOT_FOUND") {
    return jsonError(404, "Suite draft not found");
  }
  return jsonError(409, "Suite draft cannot be rejected");
}
