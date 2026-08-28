import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EvidenceReceiptV1Schema } from "@/lib/evidence-receipt";

describe("evidence receipt wire contract", () => {
  it("keeps its JSON schema reviewable across framework upgrades", () => {
    expect(z.toJSONSchema(EvidenceReceiptV1Schema)).toMatchSnapshot();
  });
});
