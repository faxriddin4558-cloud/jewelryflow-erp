"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

/**
 * One `QueryClient` per browser session, created lazily inside a ref so
 * concurrent React rendering (or Fast Refresh) never recreates it mid
 * session and drops in-flight cache state. Defaults are tuned for a
 * factory-floor board: short `staleTime` since operators expect the
 * Queue/Working/Delayed columns to reflect what just happened on the
 * floor, and `refetchOnWindowFocus` on since floor tablets are frequently
 * backgrounded and resumed.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      )}
    </QueryClientProvider>
  );
}
