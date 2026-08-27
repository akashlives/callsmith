import { describe, expect, it } from "vitest";

import { RunResultSchema } from "@/lib/contracts";
import {
  EvidenceStatusSchema,
  deriveEvidenceStatus,
} from "@/lib/evidence-status";
import { createPreviewAttempt } from "@/lib/evaluation";
import { SALES_GAUNTLET_SUITE } from "@/lib/suites";

const completed = (
  contractVariant: "weak" | "hardened",
  model = "gpt-5.6-luna",
  seed = 101,
) => ({ status: "completed", contractVariant, model, seed });

describe("deriveEvidenceStatus", () => {
  it("exposes the four stable evidence states", () => {
    expect(EvidenceStatusSchema.options).toEqual([
      "pending",
      "conclusive",
      "inconclusive",
      "provider_failure",
    ]);
  });

  it.each(["queued", "running"])(
    "keeps %s runs pending even when a complete pair exists",
    (status) => {
      expect(
        deriveEvidenceStatus({
          status,
          contractVariants: ["weak", "hardened"],
          attempts: [completed("weak"), completed("hardened")],
        }),
      ).toBe("pending");
    },
  );

  it("is conclusive for a terminal same-model, same-seed completed pair", () => {
    expect(
      deriveEvidenceStatus({
        status: "partial_failure",
        contractVariants: ["hardened", "weak"],
        attempts: [
          completed("weak", "gpt-5.6-terra", 707),
          completed("hardened", "gpt-5.6-terra", 707),
          {
            status: "provider_failure",
            contractVariant: "weak",
            model: "gpt-5.6-luna",
            seed: 707,
          },
        ],
      }),
    ).toBe("conclusive");
  });

  it.each([
    {
      name: "different models",
      attempts: [
        completed("weak", "gpt-5.6-luna", 101),
        completed("hardened", "gpt-5.6-terra", 101),
      ],
    },
    {
      name: "different seeds",
      attempts: [
        completed("weak", "gpt-5.6-luna", 101),
        completed("hardened", "gpt-5.6-luna", 102),
      ],
    },
    {
      name: "only one completed contract",
      attempts: [
        completed("weak"),
        {
          status: "provider_failure",
          contractVariant: "hardened",
          model: "gpt-5.6-luna",
          seed: 101,
        },
      ],
    },
  ])("is inconclusive for $name", ({ attempts }) => {
    expect(
      deriveEvidenceStatus({
        status: "completed",
        contractVariants: ["weak", "hardened"],
        attempts,
      }),
    ).toBe("inconclusive");
  });

  it("never calls a one-contract run conclusive", () => {
    expect(
      deriveEvidenceStatus({
        status: "completed",
        contractVariants: ["hardened"],
        attempts: [completed("weak"), completed("hardened")],
      }),
    ).toBe("inconclusive");
  });

  it("uses provider_failure only when no attempt completed", () => {
    expect(
      deriveEvidenceStatus({
        status: "failed",
        contractVariants: ["weak", "hardened"],
        attempts: [
          {
            status: "provider_failure",
            contractVariant: "weak",
            model: "gpt-5.6-luna",
            seed: 101,
          },
          {
            status: "cancelled",
            contractVariant: "hardened",
            model: "gpt-5.6-luna",
            seed: 101,
          },
        ],
      }),
    ).toBe("provider_failure");

    expect(
      deriveEvidenceStatus({
        status: "partial_failure",
        contractVariants: ["weak", "hardened"],
        attempts: [
          completed("weak"),
          {
            status: "provider_failure",
            contractVariant: "hardened",
            model: "gpt-5.6-luna",
            seed: 101,
          },
        ],
      }),
    ).toBe("inconclusive");
  });

  it("uses inconclusive for a terminal run with no completed or failed provider attempt", () => {
    expect(
      deriveEvidenceStatus({
        status: "failed",
        contractVariants: ["weak", "hardened"],
        attempts: [{ status: "cancelled" }],
      }),
    ).toBe("inconclusive");
  });
});

describe("RunResult evidence migration", () => {
  it("derives missing persisted evidence and overrides stale stored claims", () => {
    const suite = SALES_GAUNTLET_SUITE;
    const scenario = suite.scenarios[0];
    const weak = createPreviewAttempt(
      suite,
      scenario,
      "failure",
      "preview",
      scenario.seed,
      "weak",
    );
    const hardened = createPreviewAttempt(
      suite,
      scenario,
      "success",
      "preview",
      scenario.seed,
      "hardened",
    );
    const canonicalLegacyRun = {
      id: "run-persisted",
      suiteId: suite.id,
      suiteVersion: suite.version,
      scenarioId: scenario.id,
      models: ["preview"],
      repetitions: 1,
      seed: scenario.seed,
      provenance: "deterministic_preview",
      contractVariants: ["weak", "hardened"],
      status: "completed",
      attempts: [weak, hardened],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:01.000Z",
    };

    expect(RunResultSchema.parse(canonicalLegacyRun).evidenceStatus).toBe(
      "conclusive",
    );
    expect(
      RunResultSchema.parse({
        ...canonicalLegacyRun,
        attempts: [weak],
        evidenceStatus: "conclusive",
      }).evidenceStatus,
    ).toBe("inconclusive");
  });
});
