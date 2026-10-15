import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StageQueueBoard, type QueuedBatch } from "../StageQueueBoard";

describe("StageQueueBoard", () => {
  it("renders empty state correctly", () => {
    render(<StageQueueBoard stageName="Casting" batches={[]} />);
    expect(screen.getByText("Casting Queue")).toBeInTheDocument();
    expect(screen.getByText("0 Batches")).toBeInTheDocument();
    expect(screen.getByText("No batches in queue")).toBeInTheDocument();
  });

  it("renders batches correctly", () => {
    const batches: QueuedBatch[] = [
      {
        id: "1",
        batchNumber: "B-2001",
        priority: "normal",
        queuedAt: new Date().toISOString(),
        modelName: "Silver Ring",
      },
      {
        id: "2",
        batchNumber: "B-2002",
        priority: "urgent",
        queuedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
        modelName: "Gold Necklace",
      },
    ];

    render(<StageQueueBoard stageName="Polishing" batches={batches} />);

    expect(screen.getByText("Polishing Queue")).toBeInTheDocument();
    expect(screen.getByText("2 Batches")).toBeInTheDocument();
    expect(screen.getByText("B-2001")).toBeInTheDocument();
    expect(screen.getByText("B-2002")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });

  it("calls onSelectBatch when a batch is clicked", () => {
    const handleSelect = vi.fn();
    const batches: QueuedBatch[] = [
      {
        id: "1",
        batchNumber: "B-2001",
        priority: "normal",
        queuedAt: new Date().toISOString(),
        modelName: "Silver Ring",
      },
    ];

    render(<StageQueueBoard stageName="Casting" batches={batches} onSelectBatch={handleSelect} />);

    const batchElement = screen.getByText("B-2001").closest('div[role="button"]');
    expect(batchElement).toBeInTheDocument();

    fireEvent.click(batchElement!);
    expect(handleSelect).toHaveBeenCalledWith("1");
  });
});
