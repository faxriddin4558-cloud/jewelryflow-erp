import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HandoverWeightForm } from "../HandoverWeightForm";

describe("HandoverWeightForm", () => {
  it("renders correctly with initial weight", () => {
    render(<HandoverWeightForm initialWeightGrams={150} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText(/Batch Weight/i) as HTMLInputElement;
    expect(input.value).toBe("150");
  });

  it("submits the form with correct data", async () => {
    const handleSubmit = vi.fn();
    render(<HandoverWeightForm onSubmit={handleSubmit} />);

    const input = screen.getByLabelText(/Batch Weight/i);
    fireEvent.change(input, { target: { value: '200' } });

    const submitButton = screen.getByRole('button', { name: /Confirm Handover/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ weightGrams: 200, notes: "" }),
        expect.anything()
      );
    });
  });

  it("shows error for negative weight", async () => {
      render(<HandoverWeightForm onSubmit={vi.fn()} />);
      const input = screen.getByLabelText(/Batch Weight/i);

      // Need to use -10 for testing the zod number parser correctly
      fireEvent.change(input, { target: { value: '-10' } });

      const submitButton = screen.getByRole('button', { name: /Confirm Handover/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
          expect(screen.getByText("Weight must be positive")).toBeInTheDocument();
      });
  });
});
