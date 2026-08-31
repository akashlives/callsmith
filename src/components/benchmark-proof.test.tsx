// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BenchmarkProof } from "./benchmark-proof";

describe("canonical benchmark proof", () => {
  afterEach(cleanup);

  it("shows honest coverage and exposes the immutable JSON artifact", () => {
    render(<BenchmarkProof />);

    expect(
      screen.getByRole("heading", {
        name: /Appendix · 10 of 10 matched pairs exposed what expected-call checks missed/i,
      }),
    ).toBeVisible();
    expect(screen.getByText(/Every seed and failure is retained/)).toBeVisible();
    expect(screen.getAllByText(/10\/10 · 100%/)).toHaveLength(4);
    expect(screen.getByRole("link", { name: /Download benchmark JSON/i })).toHaveAttribute(
      "href",
      "/evidence/canonical-benchmark-v1.json",
    );
  });
});
