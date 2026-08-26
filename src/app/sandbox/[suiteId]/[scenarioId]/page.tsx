import { notFound } from "next/navigation";

import { getScenario, getSuite } from "@/lib/suites";

import { SandboxClient } from "./sandbox-client";

export default async function SandboxPage({
  params,
}: {
  params: Promise<{ suiteId: string; scenarioId: string }>;
}) {
  const { suiteId, scenarioId } = await params;
  const suite = getSuite(suiteId);
  const scenario = getScenario(suiteId, scenarioId);
  if (!suite || !scenario) notFound();

  return <SandboxClient suite={suite} scenario={scenario} />;
}
