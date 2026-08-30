import { describe, expect, it } from "vitest";

import {
  WorkerDrainInterruption,
  interruptionDuringDrain,
  shouldRetryWithoutAcknowledgement,
} from "../scripts/lib/worker-lifecycle.mjs";

describe("browser worker lifecycle", () => {
  it("turns an execution failure during drain into a retryable interruption", () => {
    const cause = new Error("Navigating frame was detached");
    const interruption = interruptionDuringDrain(cause, true);

    expect(interruption).toBeInstanceOf(WorkerDrainInterruption);
    expect(interruption?.cause).toBe(cause);
    expect(shouldRetryWithoutAcknowledgement(interruption, false)).toBe(true);
  });

  it("preserves ordinary provider failures as terminal evidence", () => {
    const failure = new Error("Provider rejected the request");

    expect(interruptionDuringDrain(failure, false)).toBeNull();
    expect(shouldRetryWithoutAcknowledgement(failure, false)).toBe(false);
  });

  it("leaves any in-flight job unacknowledged once shutdown begins", () => {
    expect(shouldRetryWithoutAcknowledgement(new Error("aborted"), true)).toBe(
      true,
    );
  });
});
