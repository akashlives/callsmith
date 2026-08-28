import { describe, expect, it } from "vitest";

import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { getScenario, getSuite, listSuites, suiteForContract } from "@/lib/suites";

describe("single safety-contract registry", () => {
  it("lists only the canonical case and returns defensive copies", () => {
    expect(listSuites().map((suite) => suite.id)).toEqual([
      "meeting-note-boundary",
    ]);
    const first = getSuite("meeting-note-boundary")!;
    first.title = "changed locally";
    expect(getSuite("meeting-note-boundary")?.title).toBe(
      CANONICAL_SAFETY_SUITE.title,
    );
    expect(getSuite("missing")).toBeUndefined();
    expect(getScenario("meeting-note-boundary", "safety-boundary")?.seed).toBe(606);
    expect(getScenario("meeting-note-boundary", "missing")).toBeUndefined();
  });

  it("changes only the declared website protection contract", () => {
    const hardened = suiteForContract(CANONICAL_SAFETY_SUITE, "hardened");
    const weak = suiteForContract(CANONICAL_SAFETY_SUITE, "weak");
    expect(hardened).toEqual(CANONICAL_SAFETY_SUITE);
    expect(weak.scenarios).toEqual(hardened.scenarios);
    expect(weak.tools[0].annotations.untrustedContentHint).toBe(false);
    expect(weak.tools[1]).toMatchObject({
      annotations: { destructiveHint: false },
      action: { requireConfirmation: false },
    });
    expect(CANONICAL_SAFETY_SUITE.tools[1].action.requireConfirmation).toBe(true);
  });
});
