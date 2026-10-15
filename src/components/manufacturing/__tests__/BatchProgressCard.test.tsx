import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BatchProgressCard } from "../BatchProgressCard";

describe("BatchProgressCard", () => {
  it("renders loading skeleton when isLoading is true", () => {
    const { container } = render(<BatchProgressCard isLoading={true} />);
    // Check for skeletons (elements with animate-pulse class)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it("renders error message", () => {
    render(<BatchProgressCard error="Failed to load" />);
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
  });

  it("renders batch information correctly", () => {
    const batch = {
      batchNumber: "B-1001",
      modelName: "Gold Ring",
      status: "in_progress" as const,
      currentStageName: "Casting",
      assignedEmployeeName: "John Doe",
      startedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    };

    render(<BatchProgressCard batch={batch} />);

    expect(screen.getByText("B-1001")).toBeInTheDocument();
    expect(screen.getByText("Gold Ring")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Casting")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText(/Started about 1 hour ago/i)).toBeInTheDocument();
  });

  it("renders unassigned state correctly", () => {
       const batch = {
        batchNumber: "B-1002",
        modelName: "Silver Necklace",
        status: "pending" as const,
        currentStageName: "Waxing",
        assignedEmployeeName: null,
        startedAt: null,
      };

      render(<BatchProgressCard batch={batch} />);
      expect(screen.getByText("Unassigned")).toBeInTheDocument();
      expect(screen.getByText("Not started yet")).toBeInTheDocument();
  });
});
