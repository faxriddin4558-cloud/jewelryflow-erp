import { redirect } from "next/navigation";

// The separate mobile workspace was merged into the Goldia Sales pages. Old links, the installed PWA and the
// Telegram login keep working: /sales/mobile now opens Skaner Savdo (route guards apply as usual).
export default function SalesMobilePage() {
  redirect("/sales/app/scan");
}
