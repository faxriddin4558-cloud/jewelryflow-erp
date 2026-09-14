"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { delayReasonCategorySchema } from "@/shared/lib/validation/enums";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { useFlagDelay } from "../hooks/use-operation-mutations";

const DELAY_REASON_OPTIONS = delayReasonCategorySchema.options;

const formSchema = z.object({
  delayReasonCategory: delayReasonCategorySchema,
  delayReasonNotes: z.string().max(2000).optional(),
  delayedMinutes: z.coerce.number().int().positive().optional(),
});
type FormValues = z.infer<typeof formSchema>;

const DELAY_REASON_LABEL: Record<(typeof DELAY_REASON_OPTIONS)[number], string> = {
  machine_breakdown: "Machine Breakdown",
  material_shortage: "Material Shortage",
  employee_unavailable: "Employee Unavailable",
  power_outage: "Power Outage",
  quality_rework: "Quality Rework",
  design_change: "Design Change",
  other: "Other",
};

export function FlagDelayDialog({
  operationId,
  trigger,
}: {
  operationId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const flagDelay = useFlagDelay();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { delayReasonNotes: "" },
  });

  async function onSubmit(values: FormValues) {
    await flagDelay.mutateAsync({ operationId, ...values });
    form.reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flag Delay</DialogTitle>
          <DialogDescription>
            Record why this operation is delayed. This is required before the board shows it in
            the Delayed column.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="delayReasonCategory">Reason</Label>
            <Select
              onValueChange={(value) =>
                form.setValue("delayReasonCategory", value as FormValues["delayReasonCategory"], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="delayReasonCategory">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {DELAY_REASON_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {DELAY_REASON_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.delayReasonCategory && (
              <p className="text-xs text-destructive">
                {form.formState.errors.delayReasonCategory.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="delayedMinutes">Estimated delay (minutes)</Label>
            <input
              id="delayedMinutes"
              type="number"
              min={1}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              {...form.register("delayedMinutes")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="delayReasonNotes">Notes</Label>
            <Textarea id="delayReasonNotes" rows={3} {...form.register("delayReasonNotes")} />
          </div>

          {flagDelay.isError && (
            <p className="text-xs text-destructive">{flagDelay.error.message}</p>
          )}

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={flagDelay.isPending}>
              {flagDelay.isPending ? "Flagging…" : "Flag Delay"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
