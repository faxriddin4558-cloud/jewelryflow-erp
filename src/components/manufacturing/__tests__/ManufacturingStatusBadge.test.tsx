import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ManufacturingStatusBadge } from "../ManufacturingStatusBadge";

describe("ManufacturingStatusBadge", () => {
  it("renders pending status correctly", () => {
    render(<ManufacturingStatusBadge status="pending" />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders in_progress status correctly", () => {
    render(<ManufacturingStatusBadge status="in_progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("renders rejected status with destructive variant", () => {
    render(<ManufacturingStatusBadge status="rejected" />);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("renders delayed status correctly", () => {
      render(<ManufacturingStatusBadge status="delayed" />);
      expect(screen.getByText("Delayed")).toBeInTheDocument();
  });
});
