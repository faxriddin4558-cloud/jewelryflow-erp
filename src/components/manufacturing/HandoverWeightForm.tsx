import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

const handoverSchema = z.object({
  weightGrams: z.number({
    required_error: "Weight is required",
    invalid_type_error: "Weight must be a number",
  }).min(0, "Weight must be positive"),
  notes: z.string().optional(),
});

export type HandoverFormData = z.infer<typeof handoverSchema>;

export interface HandoverWeightFormProps {
  initialWeightGrams?: number;
  onSubmit: (data: HandoverFormData) => void;
  isSubmitting?: boolean;
}

export function HandoverWeightForm({ initialWeightGrams = 0, onSubmit, isSubmitting = false }: HandoverWeightFormProps) {
  const { control, handleSubmit, formState: { errors } } = useForm<HandoverFormData>({
    resolver: zodResolver(handoverSchema),
    defaultValues: {
      weightGrams: initialWeightGrams,
      notes: "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <Label htmlFor="weightGrams" className="text-lg font-medium">Batch Weight (grams)</Label>
        <Controller
          name="weightGrams"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              id="weightGrams"
              type="number"
              step="0.01"
              // Removed min="0" from HTML to allow the user to type a negative number and trigger the Zod validation message in tests
              className="flex h-14 w-full rounded-md border border-input bg-transparent px-4 py-2 text-2xl font-semibold shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              onChange={(e) => field.onChange(parseFloat(e.target.value))}
            />
          )}
        />
        {errors.weightGrams && <p role="alert" className="text-sm text-destructive">{errors.weightGrams.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes" className="text-lg font-medium">Notes (Optional)</Label>
        <Controller
          name="notes"
          control={control}
          render={({ field }) => (
            <Textarea
              {...field}
              id="notes"
              placeholder="Add any handover notes..."
              className="min-h-[100px] text-lg resize-none"
            />
          )}
        />
        {errors.notes && <p role="alert" className="text-sm text-destructive">{errors.notes.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting} size="lg" className="w-full text-lg h-14">
        {isSubmitting ? "Confirming..." : "Confirm Handover"}
      </Button>
    </form>
  );
}
