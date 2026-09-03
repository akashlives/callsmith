import { describe, expect, it } from "vitest";

import {
  CANONICAL_SAFETY_CONTRACT,
  CANONICAL_SAFETY_SUITE,
  RETAIL_SAFETY_CONTRACT,
  RETAIL_SAFETY_SUITE,
  TELECOM_SAFETY_CONTRACT,
  TELECOM_SAFETY_SUITE,
  TICKETING_SAFETY_CONTRACT,
  TICKETING_SAFETY_SUITE,
  TRAVEL_SAFETY_CONTRACT,
  TRAVEL_SAFETY_SUITE,
  WORKFLOW_PRESENTATION,
} from "@/lib/canonical-contract";
import { getScenario, getSuite, listSuites, suiteForContract } from "@/lib/suites";

describe("single safety-contract registry", () => {
  it("lists the hold suites plus the frozen meeting-note appendix", () => {
    expect(listSuites().map((suite) => suite.id)).toEqual([
      "ticketing-seats-boundary",
      "retail-checkout-boundary",
      "travel-hold-boundary",
      "telecom-plan-boundary",
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

  it("compiles four hold suites with the same tool names and leaves meeting-note frozen", () => {
    for (const suite of [
      TICKETING_SAFETY_SUITE,
      RETAIL_SAFETY_SUITE,
      TRAVEL_SAFETY_SUITE,
      TELECOM_SAFETY_SUITE,
    ]) {
      expect(suite.tools.map((tool) => tool.name)).toEqual(["read_hold", "charge_hold"]);
      expect(suite.scenarios[0].id).toBe("safety-boundary");
    }
    expect(TICKETING_SAFETY_SUITE.scenarios[0].seed).toBe(701);
    expect(TICKETING_SAFETY_CONTRACT.record.id).toBe("HLD-2207");
    expect(RETAIL_SAFETY_CONTRACT.record.id).toBe("ORD-4410");
    expect(TRAVEL_SAFETY_CONTRACT.record.id).toBe("ITN-18");
    expect(TELECOM_SAFETY_CONTRACT.record.id).toBe("LN-9");
    expect(WORKFLOW_PRESENTATION["ticketing-seats-boundary"]?.amountLabel).toBe("$186");
    expect(CANONICAL_SAFETY_SUITE.version).toBe("1.1.0");
    expect(CANONICAL_SAFETY_SUITE.scenarios[0].seed).toBe(606);
    expect(CANONICAL_SAFETY_CONTRACT.record.id).toBe("followup-001");
    expect(CANONICAL_SAFETY_CONTRACT.tools.read.name).toBe("read_meeting_note");
  });
});
