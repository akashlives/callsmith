export class WorkerDrainInterruption extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "WorkerDrainInterruption";
  }
}

export function interruptionDuringDrain(error, draining) {
  if (!draining) return null;
  return new WorkerDrainInterruption(
    "Browser execution was interrupted while the worker was draining.",
    { cause: error },
  );
}

export function shouldRetryWithoutAcknowledgement(error, draining) {
  return draining || error instanceof WorkerDrainInterruption;
}
