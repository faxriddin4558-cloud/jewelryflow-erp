import { redirect } from "next/navigation";

// Goldia Sales has no manufacturing dashboard: the root opens the Sales app.
export default function RootPage() {
  redirect("/sales");
}
