import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPreviewAttempt,
  createProviderFailureAttempt,
} from "@/lib/evaluation";
import { InMemoryRunStore } from "@/lib/run-store";
import { SALES_GAUNTLET_SUITE } from "@/lib/suites";

const suite = SALES_GAUNTLET_SUITE;
const scenario = suite.scenarios[0];

describe("InMemoryRunStore", () => {
  let store: InMemoryRunStore;

  beforeEach(() => {
    store = new InMemoryRunStore();
  });

  function create() {
    return store.create({
      suiteId: suite.id,
      suiteVersion: suite.version,
      scenarioId: scenario.id,
      models: ["preview"],
      repetitions: 1,
      seed: scenario.seed,
      provenance: "deterministic_preview",
      contractVariants: ["hardened"],
    });
  }

  it("isolates records and returned snapshots", () => {
    const first = create();
    const second = create();
    first.attempts.push(createPreviewAttempt(suite, scenario, "success"));
    first.status = "failed";

    expect(first.id).not.toBe(second.id);
    expect(store.get(first.id)?.attempts).toHaveLength(0);
    expect(store.get(first.id)?.status).toBe("queued");
    expect(store.get(second.id)?.attempts).toHaveLength(0);
    expect(store.get(second.id)?.evidenceStatus).toBe("pending");
  });

  it("recomputes evidence after every append and status update", () => {
    const run = store.create({
      suiteId: suite.id,
      suiteVersion: suite.version,
      scenarioId: scenario.id,
      models: ["preview"],
      repetitions: 1,
      seed: scenario.seed,
      provenance: "deterministic_preview",
      contractVariants: ["weak", "hardened"],
    });
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

    expect(run.evidenceStatus).toBe("pending");
    expect(store.appendAttempt(run.id, weak).evidenceStatus).toBe("pending");
    expect(store.appendAttempt(run.id, hardened).evidenceStatus).toBe("pending");
    expect(store.update(run.id, { status: "completed" }).evidenceStatus).toBe(
      "conclusive",
    );
    expect(
      store.update(run.id, (current) => ({
        ...current,
        evidenceStatus: "provider_failure",
      })).evidenceStatus,
    ).toBe("conclusive");
  });

  it("distinguishes one-contract and provider-failure terminal runs", () => {
    const oneContract = create();
    store.appendAttempt(
      oneContract.id,
      createPreviewAttempt(suite, scenario, "success"),
    );
    expect(
      store.update(oneContract.id, { status: "completed" }).evidenceStatus,
    ).toBe("inconclusive");

    const failed = store.create({
      suiteId: suite.id,
      suiteVersion: suite.version,
      scenarioId: scenario.id,
      models: ["gpt-5.6-luna"],
      repetitions: 1,
      seed: scenario.seed,
      provenance: "server_simulation",
      contractVariants: ["weak", "hardened"],
    });
    store.appendAttempt(
      failed.id,
      createProviderFailureAttempt(
        suite,
        scenario,
        "gpt-5.6-luna",
        scenario.seed,
        "Provider unavailable",
        0,
        { contractVariant: "weak" },
      ),
    );
    expect(store.update(failed.id, { status: "failed" }).evidenceStatus).toBe(
      "provider_failure",
    );
  });

  it("publishes defensive copies and supports unsubscribe", () => {
    const run = create();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(run.id, listener);
    store.update(run.id, { status: "running" });
    expect(listener).toHaveBeenCalledOnce();
    listener.mock.calls[0][0].status = "failed";
    expect(store.get(run.id)?.status).toBe("running");

    unsubscribe();
    store.update(run.id, { status: "completed" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("appends attempts, redacts nested secrets, and preserves evidence", () => {
    const run = create();
    const attempt = createPreviewAttempt(suite, scenario, "success");
    attempt.trace[0].metadata = {
      apiKey: "should-not-survive",
      nested: { authorization: "Bearer secret", safe: true },
    };
    const updated = store.appendAttempt(run.id, attempt);
    expect(updated.attempts).toHaveLength(1);
    expect(updated.attempts[0].trace[0].metadata).toEqual({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]", safe: true },
    });
  });

  it("creates stable unlisted tokens and read-only lookup copies", () => {
    const run = create();
    const token = store.share(run.id);
    expect(token.length).toBeGreaterThan(48);
    expect(store.share(run.id)).toBe(token);

    const shared = store.getByShareToken(token);
    expect(shared?.id).toBe(run.id);
    if (shared) {
      (shared as { status: string }).status = "failed";
    }
    expect(store.getByShareToken(token)?.status).toBe("queued");
  });

  it("rejects unknown run updates", () => {
    expect(() => store.update("missing", { status: "running" })).toThrow(
      /Unknown run/,
    );
  });
});
