import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OperatorTouchPanel, type ActiveOperationInfo } from "../OperatorTouchPanel";
import { type BatchProgressInfo } from "../BatchProgressCard";

describe("OperatorTouchPanel", () => {
  const defaultProps = {
    operatorName: "Jane Smith",
    departmentName: "Casting",
    queuedBatches: [],
    onStartBatch: vi.fn(),
    onPauseBatch: vi.fn(),
    onResumeBatch: vi.fn(),
    onCompleteBatch: vi.fn(),
  };

  it("renders dashboard header correctly", () => {
    render(<OperatorTouchPanel {...defaultProps} />);
    expect(screen.getByText("Casting Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Operator: Jane Smith")).toBeInTheDocument();
  });

  it("defaults to Queue tab when there is no active batch", () => {
    render(<OperatorTouchPanel {...defaultProps} />);

    // The Active tab should be disabled
    const activeTabTrigger = screen.getByRole("tab", { name: /Active Task/i });
    expect(activeTabTrigger).toBeDisabled();

    // The Queue tab content should be visible (e.g. empty queue text)
    expect(screen.getByText("No batches in queue")).toBeInTheDocument();
  });

  it("defaults to Active tab when there is an active batch", () => {
    const activeBatch: BatchProgressInfo = {
      batchNumber: "B-123",
      modelName: "Test Model",
      status: "in_progress",
      currentStageName: "Casting",
      assignedEmployeeName: "Jane Smith",
      startedAt: new Date().toISOString(),
    };

    const activeOperation: ActiveOperationInfo = {
        batchId: "batch-1",
        expectedLossGrams: 5,
        toleranceGrams: 2,
        status: "in_progress"
    }

    render(<OperatorTouchPanel {...defaultProps} activeBatch={activeBatch} activeOperation={activeOperation} />);

    const activeTabTrigger = screen.getByRole("tab", { name: /Active Task/i });
    expect(activeTabTrigger).not.toBeDisabled();
    expect(activeTabTrigger).toHaveAttribute("aria-selected", "true");

    // Content of active tab should be visible
    expect(screen.getByText("B-123")).toBeInTheDocument();
    expect(screen.getByText("Complete Operation")).toBeInTheDocument();
  });

  it("shows resume button when operation is paused", () => {
     const activeBatch: BatchProgressInfo = {
      batchNumber: "B-123",
      modelName: "Test Model",
      status: "in_progress", // Keep as a valid BatchStatus
      currentStageName: "Casting",
      assignedEmployeeName: "Jane Smith",
      startedAt: new Date().toISOString(),
    };

    const activeOperation: ActiveOperationInfo = {
        batchId: "batch-1",
        expectedLossGrams: 5,
        toleranceGrams: 2,
        status: "paused" // This dictates the button state
    }

    render(<OperatorTouchPanel {...defaultProps} activeBatch={activeBatch} activeOperation={activeOperation} />);

    const resumeButton = screen.getByRole("button", { name: /Resume Operation/i });
    expect(resumeButton).toBeInTheDocument();

    fireEvent.click(resumeButton);
    expect(defaultProps.onResumeBatch).toHaveBeenCalledWith("batch-1");
  });
});
