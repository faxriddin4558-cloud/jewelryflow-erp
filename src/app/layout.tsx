import type { Metadata } from "next";
import { QueryProvider } from "@/shared/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "JewelryFlow ERP",
  description: "Manufacturing ERP for jewelry factories — orders, batches, and the factory floor workflow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
