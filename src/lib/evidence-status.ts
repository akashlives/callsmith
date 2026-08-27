import { z } from "zod";

export const EvidenceStatusSchema = z.enum([
  "pending",
  "conclusive",
  "inconclusive",
  "provider_failure",
]);

export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export interface EvidenceStatusAttemptLike {
  model?: unknown;
  seed?: unknown;
  contractVariant?: unknown;
  status?: unknown;
}

export interface EvidenceStatusRunLike {
  status?: unknown;
  contractVariants?: unknown;
  attempts?: unknown;
}

function attemptsFrom(run: EvidenceStatusRunLike): EvidenceStatusAttemptLike[] {
  if (!Array.isArray(run.attempts)) return [];
  return run.attempts.filter(
    (attempt): attempt is EvidenceStatusAttemptLike =>
      attempt !== null && typeof attempt === "object" && !Array.isArray(attempt),
  );
}

function hasRequestedPair(contractVariants: unknown): boolean {
  if (!Array.isArray(contractVariants)) return false;
  return (
    contractVariants.includes("weak") && contractVariants.includes("hardened")
  );
}

function completedPairKey(attempt: EvidenceStatusAttemptLike): string | undefined {
  if (
    attempt.status !== "completed" ||
    typeof attempt.model !== "string" ||
    typeof attempt.seed !== "number" ||
    !Number.isFinite(attempt.seed)
  ) {
    return undefined;
  }
  return JSON.stringify([attempt.model, attempt.seed]);
}

/**
 * Derive whether a run can support a safety verdict.
 *
 * A conclusive comparison requires completed weak and hardened attempts for an
 * identical model and seed. Run lifecycle takes precedence: evidence remains
 * pending until the run reaches a terminal status. The function accepts a
 * deliberately loose input so it can migrate old persisted reports before
 * their current Zod contract is applied.
 */
export function deriveEvidenceStatus(
  run: EvidenceStatusRunLike,
): EvidenceStatus {
  if (run.status === "queued" || run.status === "running") return "pending";

  const attempts = attemptsFrom(run);
  const completedAttempts = attempts.filter(
    (attempt) => attempt.status === "completed",
  );

  if (hasRequestedPair(run.contractVariants)) {
    const variantsByPair = new Map<string, Set<"weak" | "hardened">>();
    for (const attempt of completedAttempts) {
      if (
        attempt.contractVariant !== "weak" &&
        attempt.contractVariant !== "hardened"
      ) {
        continue;
      }
      const key = completedPairKey(attempt);
      if (!key) continue;
      const variants = variantsByPair.get(key) ?? new Set<"weak" | "hardened">();
      variants.add(attempt.contractVariant);
      variantsByPair.set(key, variants);
    }
    if ([...variantsByPair.values()].some((variants) => variants.size === 2)) {
      return "conclusive";
    }
  }

  const providerFailures = attempts.filter(
    (attempt) => attempt.status === "provider_failure",
  ).length;
  if (completedAttempts.length === 0 && providerFailures > 0) {
    return "provider_failure";
  }

  return "inconclusive";
}
