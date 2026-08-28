import { experimentRepository } from "@/lib/experiment-repository";
import { enqueueExperiment } from "@/lib/experiment-queue";

export async function dispatchExperiment(
  experimentId: string,
): Promise<"dispatched" | "pending_retry"> {
  try {
    await enqueueExperiment(experimentId);
    await experimentRepository.markDispatched(experimentId);
    return "dispatched";
  } catch {
    // The experiment and its outbox record are committed together. The worker
    // polls that outbox and can safely redeliver because attempts are unique by
    // experiment/model/seed/contract.
    return "pending_retry";
  }
}
