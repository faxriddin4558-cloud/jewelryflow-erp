import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export interface StageLossWarningProps extends React.HTMLAttributes<HTMLDivElement> {
  expectedLossGrams: number;
  actualLossGrams: number;
  toleranceGrams: number;
}

export function StageLossWarning({
  expectedLossGrams,
  actualLossGrams,
  toleranceGrams,
  className,
  ...props
}: StageLossWarningProps) {
  const isExcessiveLoss = actualLossGrams > expectedLossGrams + toleranceGrams;
  const isGain = actualLossGrams < 0;

  if (!isExcessiveLoss && !isGain) {
    return null; // Within tolerance, no warning needed
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-sm shadow-sm",
        isExcessiveLoss ? "border-destructive bg-destructive/10 text-destructive" : "border-amber-500 bg-amber-500/10 text-amber-700",
        className
      )}
      {...props}
    >
      {isExcessiveLoss ? (
        <AlertTriangle className="h-5 w-5 shrink-0" />
      ) : (
        <Info className="h-5 w-5 shrink-0 text-amber-600" />
      )}
      <div className="flex-1 space-y-1">
        <p className="font-semibold">
          {isExcessiveLoss ? "Excessive Weight Loss Detected" : "Unexpected Weight Gain Detected"}
        </p>
        <p className={isExcessiveLoss ? "text-destructive/80" : "text-amber-700/80"}>
          {isExcessiveLoss
            ? `The actual loss (${actualLossGrams}g) exceeds the expected loss (${expectedLossGrams}g) plus tolerance (${toleranceGrams}g). Supervisor approval will be required.`
            : `The batch gained weight instead of losing it (${Math.abs(actualLossGrams)}g gained). Please verify measurements.`}
        </p>
      </div>
    </div>
  );
}
