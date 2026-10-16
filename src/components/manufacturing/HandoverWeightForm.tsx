import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StageLossWarning } from "./StageLossWarning";
import { useHandoverWeight } from "@/hooks/manufacturing/use-handover-weight";

export interface HandoverWeightFormProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  batchNumber: string;
  expectedInputWeight?: number;
  maxLossThreshold?: number;
  onSubmit: (data: { inputWeight: number; outputWeight: number; notes: string }) => void;
  isSubmitting?: boolean;
}

export function HandoverWeightForm({
  batchNumber,
  expectedInputWeight = 0,
  maxLossThreshold = 0.5,
  onSubmit,
  isSubmitting,
  className,
  ...props
}: HandoverWeightFormProps) {
  const { inputWeight, setInputWeight, outputWeight, setOutputWeight, isValid } = useHandoverWeight({ expectedInputWeight, maxLossThreshold });
  const [notes, setNotes] = React.useState<string>("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      inputWeight,
      outputWeight,
      notes
    });
  };

  return (
    <Card className={cn("overflow-hidden md:rounded-xl touch-manipulation", className)} {...props}>
      <CardHeader className="bg-muted/30 border-b p-4 md:p-6">
        <CardTitle className="text-xl md:text-2xl font-bold">
          Handover: <span className="font-mono text-primary">{batchNumber}</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4 md:p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label htmlFor="inputWeight" className="text-sm md:text-base font-semibold text-muted-foreground uppercase tracking-wider">
                Input Weight (g)
              </Label>
              <input
                id="inputWeight"
                type="number"
                step="0.01"
                value={inputWeight || ""}
                onChange={(e) => setInputWeight(parseFloat(e.target.value) || 0)}
                className="flex h-14 md:h-16 w-full rounded-lg border border-input bg-background px-4 py-2 text-2xl font-mono ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="0.00"
                required
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="outputWeight" className="text-sm md:text-base font-semibold text-muted-foreground uppercase tracking-wider">
                Output Weight (g)
              </Label>
              <input
                id="outputWeight"
                type="number"
                step="0.01"
                value={outputWeight || ""}
                onChange={(e) => setOutputWeight(parseFloat(e.target.value) || 0)}
                className="flex h-14 md:h-16 w-full rounded-lg border border-input bg-background px-4 py-2 text-2xl font-mono ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label htmlFor="notes" className="text-sm md:text-base font-semibold text-muted-foreground uppercase tracking-wider">
              Notes (Optional)
            </Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Any issues or remarks..."
            />
          </div>

          {isValid && (
            <div className="pt-2">
              <StageLossWarning
                inputWeight={inputWeight}
                outputWeight={outputWeight}
                maxLossThreshold={maxLossThreshold}
              />
            </div>
          )}

          <div className="pt-4 flex justify-end">
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || !isValid}
              className="w-full md:w-auto min-w-[200px] h-14 md:h-16 text-lg font-semibold"
            >
              {isSubmitting ? "Submitting..." : "Complete Handover"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
