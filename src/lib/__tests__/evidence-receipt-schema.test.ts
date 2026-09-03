import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EvidenceReceiptV1Schema, stillSrc } from "@/lib/evidence-receipt";

describe("evidence receipt wire contract", () => {
  it("keeps its JSON schema reviewable across framework upgrades", () => {
    expect(z.toJSONSchema(EvidenceReceiptV1Schema)).toMatchSnapshot();
  });

  it("prefixes raw JPEG base64 and ignores junk paths", () => {
    expect(stillSrc("/9j/xxxx")).toBe("data:image/jpeg;base64,/9j/xxxx");
    expect(stillSrc("data:image/jpeg;base64,/9j/xxxx")).toBe("data:image/jpeg;base64,/9j/xxxx");
    expect(stillSrc("https://example.test/hold.jpg")).toBe("https://example.test/hold.jpg");
    expect(stillSrc("/api/frames/hold")).toBeUndefined();
    expect(stillSrc(undefined)).toBeUndefined();
  });
});
