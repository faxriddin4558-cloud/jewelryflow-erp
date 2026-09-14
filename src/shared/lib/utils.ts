import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class lists safely (last conflicting utility wins).
 * Required by every shadcn/ui component generated into `src/shared/ui`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
