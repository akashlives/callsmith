import { notFound } from "next/navigation";

import { getScenario, getSuite } from "@/lib/suites";
import type { ContractVariant } from "@/lib/contracts";

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
  }>;
}) {
  const { suiteId, scenarioId } = await params;
  const query = await searchParams;
  const suite = getSuite(suiteId);
  const scenario = getScenario(suiteId, scenarioId);
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
