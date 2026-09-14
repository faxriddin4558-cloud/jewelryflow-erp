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
import { useRejectForRework } from "../hooks/use-operation-mutations";

const formSchema = z.object({
  reason: z.string().min(1, "A reason is required."),
});
type FormValues = z.infer<typeof formSchema>;

/**
 * Rejects the current attempt and re-queues a new attempt at the SAME
 * stage (rework). Backing up further than one stage is a deliberate
 * follow-up action from the QC module (passing an explicit
 * `targetStageId`), not something this generic department-floor dialog
 * exposes — a department operator rejecting their own stage's work is
 * always sending it back to redo, not routing it elsewhere.
 */
export function RejectReworkDialog({
  operationId,
  stageName,
  trigger,
}: {
  operationId: string;
  stageName: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const rejectForRework = useRejectForRework();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: "" },
  });

  async function onSubmit(values: FormValues) {
    await rejectForRework.mutateAsync({ operationId, reason: values.reason });
    form.reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {stageName} for Rework</DialogTitle>
          <DialogDescription>
            This closes the current attempt as rejected and opens a new attempt at the same
            stage.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="reworkReason">Reason</Label>
            <Textarea id="reworkReason" rows={3} {...form.register("reason")} />
            {form.formState.errors.reason && (
              <p className="text-xs text-destructive">{form.formState.errors.reason.message}</p>
            )}
          </div>

          {rejectForRework.isError && (
            <p className="text-xs text-destructive">{rejectForRework.error.message}</p>
          )}

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={rejectForRework.isPending}>
              {rejectForRework.isPending ? "Rejecting…" : "Reject for Rework"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
