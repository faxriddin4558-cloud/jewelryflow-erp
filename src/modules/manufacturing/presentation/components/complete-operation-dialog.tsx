"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Textarea } from "@/shared/ui/textarea";
import { useCompleteOperation } from "../hooks/use-operation-mutations";

const formSchema = z.object({
  outputWeightGrams: z.coerce.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function CompleteOperationDialog({
  operationId,
  stageName,
  trigger,
}: {
  operationId: string;
  stageName: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const completeOperation = useCompleteOperation();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { notes: "" },
  });

  async function onSubmit(values: FormValues) {
    await completeOperation.mutateAsync({ operationId, ...values });
    form.reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {stageName}</DialogTitle>
          <DialogDescription>
            This closes out the current stage and moves the batch to the next stage in the
            pipeline automatically.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="outputWeightGrams">Output weight (grams)</Label>
            <input
              id="outputWeightGrams"
              type="number"
              step="0.001"
              min={0}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              {...form.register("outputWeightGrams")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="completeNotes">Notes</Label>
            <Textarea id="completeNotes" rows={3} {...form.register("notes")} />
          </div>

          {completeOperation.isError && (
            <p className="text-xs text-destructive">{completeOperation.error.message}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={completeOperation.isPending}>
              {completeOperation.isPending ? "Completing…" : "Complete Stage"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
