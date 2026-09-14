import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        // Status-token variants map 1:1 to the CSS custom properties defined
        // in globals.css (`--status-*`), shared across batches/operations.
        pending: "border-transparent bg-[hsl(var(--status-pending))] text-white",
        queued: "border-transparent bg-[hsl(var(--status-queued))] text-white",
        progress: "border-transparent bg-[hsl(var(--status-progress))] text-white",
        delayed: "border-transparent bg-[hsl(var(--status-delayed))] text-white",
        hold: "border-transparent bg-[hsl(var(--status-hold))] text-white",
        completed: "border-transparent bg-[hsl(var(--status-completed))] text-white",
        cancelled: "border-transparent bg-[hsl(var(--status-cancelled))] text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
