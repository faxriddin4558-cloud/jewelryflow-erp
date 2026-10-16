import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/ui/card";

export interface OperatorTouchPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string;
}

export function OperatorTouchPanel({
  className,
  title,
  description,
  isLoading,
  isEmpty,
  error,
  children,
  ...props
}: OperatorTouchPanelProps) {
  return (
    <Card className={cn("flex flex-col h-full min-h-[400px] w-full max-w-4xl mx-auto shadow-md md:rounded-xl", className)} {...props}>
      {(title || description) && (
        <CardHeader className="md:p-6 p-4">
          {title && <CardTitle className="text-xl md:text-2xl font-bold">{title}</CardTitle>}
          {description && <CardDescription className="text-base md:text-lg">{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="flex-1 md:p-6 p-4 pt-0">
        {isLoading && (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        )}
        {!isLoading && error && (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-destructive space-y-4">
            <p className="text-lg font-medium">Error Loading Panel</p>
            <p className="text-sm">{error}</p>
          </div>
        )}
        {!isLoading && !error && isEmpty && (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground space-y-4">
            <p className="text-lg font-medium">No Data Available</p>
          </div>
        )}
        {!isLoading && !error && !isEmpty && children}
      </CardContent>
    </Card>
  );
}
