import { notFound } from "next/navigation";

import { getScenario, getSuite } from "@/lib/suites";
import type { ContractVariant } from "@/lib/contracts";
import { experimentRepository } from "@/lib/experiment-repository";
import { verifyWorkerSandboxAccess } from "@/lib/worker-sandbox-access";

import { SandboxClient } from "./sandbox-client";

export default async function SandboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ suiteId: string; scenarioId: string }>;
  searchParams: Promise<{
    contract?: string;
    seed?: string;
    attempt?: string;
    run?: string;
    expires?: string;
    access?: string;
  }>;
}) {
  const { suiteId, scenarioId } = await params;
  const query = await searchParams;
  let suite = getSuite(suiteId);
  if (!suite) {
    const expiresAtMs = Number(query.expires);
    const runnerSecret = process.env.CALLSMITH_RUNNER_TOKEN?.trim() ?? "";
    const authorized = verifyWorkerSandboxAccess(
      {
        runId: query.run ?? "",
        attemptId: query.attempt ?? "",
        expiresAtMs,
        signature: query.access ?? "",
      },
      runnerSecret,
    );
    if (!authorized) notFound();

    const experiment = await experimentRepository.getInternal(query.run ?? "");
    if (
      !experiment ||
      experiment.contractId !== suiteId
    ) {
      notFound();
    }
    suite = await experimentRepository.getSuite(experiment.id);
  }
  const scenario =
    suite?.scenarios.find((candidate) => candidate.id === scenarioId) ??
    getScenario(suiteId, scenarioId);
  if (!suite || !scenario) notFound();

  const contractVariant: ContractVariant =
    query.contract === "weak" ? "weak" : "hardened";
  const requestedSeed = Number(query.seed);
  const seed = Number.isInteger(requestedSeed) ? requestedSeed : scenario.seed;

  return (
    <SandboxClient
      suite={suite}
      scenario={scenario}
      contractVariant={contractVariant}
      seed={seed}
      attemptId={query.attempt}
    />
  );
}
