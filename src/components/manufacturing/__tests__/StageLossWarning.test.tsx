import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StageLossWarning } from "../StageLossWarning";

describe("StageLossWarning", () => {
  it("renders null when loss is within tolerance", () => {
    const { container } = render(
      <StageLossWarning expectedLossGrams={5} actualLossGrams={5} toleranceGrams={2} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders warning for excessive weight loss", () => {
    render(
      <StageLossWarning expectedLossGrams={5} actualLossGrams={10} toleranceGrams={2} />
    );
    expect(screen.getByText("Excessive Weight Loss Detected")).toBeInTheDocument();
    expect(screen.getByText(/exceeds the expected loss/i)).toBeInTheDocument();
  });

  it("renders warning for unexpected weight gain", () => {
    render(
      <StageLossWarning expectedLossGrams={5} actualLossGrams={-2} toleranceGrams={2} />
    );
    expect(screen.getByText("Unexpected Weight Gain Detected")).toBeInTheDocument();
    expect(screen.getByText(/gained weight instead of losing it/i)).toBeInTheDocument();
  });
});
