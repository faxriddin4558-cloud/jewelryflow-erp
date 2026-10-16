import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export interface StageLossWarningProps extends React.HTMLAttributes<HTMLDivElement> {
  inputWeight: number;
  outputWeight: number;
  maxLossThreshold?: number;
}

export function StageLossWarning({
  inputWeight,
  outputWeight,
  maxLossThreshold = 0.5,
  className,
  ...props
}: StageLossWarningProps) {
  const diff = inputWeight - outputWeight;
  const isLoss = diff > 0;
  const isCriticalLoss = diff > maxLossThreshold;
  const isGain = diff < 0;

  if (inputWeight <= 0 || outputWeight <= 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-lg p-3 md:p-4 flex items-start gap-3 border transition-colors",
        isCriticalLoss
          ? "bg-destructive/10 border-destructive/20 text-destructive"
          : isGain
            ? "bg-orange-100 border-orange-200 text-orange-800 dark:bg-orange-900/30 dark:border-orange-800 dark:text-orange-300"
            : "bg-green-100 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-300",
        className
      )}
      {...props}
    >
      {isCriticalLoss || isGain ? (
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
      ) : (
        <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
      )}

      <div className="flex flex-col">
        <p className="font-semibold text-sm md:text-base">
          {isCriticalLoss
            ? "Discrepancy Detected"
            : isGain
              ? "Unexpected Weight Gain"
              : "Loss Within Tolerance"}
        </p>
        <p className="text-xs md:text-sm opacity-90 mt-1">
          {isLoss && !isGain && (
            <>Loss: <span className="font-mono font-bold">{diff.toFixed(2)}g</span> ({((diff/inputWeight)*100).toFixed(2)}%)</>
          )}
          {isGain && (
            <>Gain: <span className="font-mono font-bold">{Math.abs(diff).toFixed(2)}g</span></>
          )}
          {isCriticalLoss && (
            <span className="block mt-1">This discrepancy requires supervisor approval.</span>
          )}
        </p>
      </div>
    </div>
  );
}
