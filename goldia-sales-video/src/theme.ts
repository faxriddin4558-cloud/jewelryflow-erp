import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const C = {
  navy950: "#040915",
  navy900: "#071024",
  navy800: "#0B1733",
  navy700: "#112244",
  navy600: "#18305A",
  navy500: "#21406F",
  gold: "#D4AF37",
  goldLight: "#F3D98A",
  goldPale: "#FBF0C9",
  goldDeep: "#9E7419",
  text: "#EEF1F8",
  muted: "#93A0BE",
  dim: "#5D6A8A",
  green: "#41D99B",
  red: "#FF6F6F",
  line: "rgba(212,175,55,0.22)",
  lineSoft: "rgba(148,163,200,0.14)",
  glass: "rgba(17,34,68,0.72)",
};

export const GOLD_GRADIENT =
  "linear-gradient(135deg, #FBEFB8 0%, #E8C766 28%, #D4AF37 52%, #A67C1B 78%, #E9CF7A 100%)";

export const SERIF = "Playfair Display";
export const SANS = "Inter";

let loaded = false;
export const loadFonts = () => {
  if (loaded) return;
  loaded = true;
  for (const w of [400, 500, 600, 700, 800]) {
    loadFont({ family: SANS, url: staticFile(`fonts/inter-latin-${w}-normal.woff2`), weight: String(w) });
  }
  for (const w of [600, 700]) {
    loadFont({ family: SERIF, url: staticFile(`fonts/playfair-display-latin-${w}-normal.woff2`), weight: String(w) });
    loadFont({
      family: SERIF,
      url: staticFile(`fonts/playfair-display-latin-${w}-italic.woff2`),
      weight: String(w),
      style: "italic",
    });
  }
};

// number formatting — Uzbek style: space thousand separators, dot decimals
export const fmt = (n: number, decimals = 0) => {
  const sign = n < 0 ? "−" : "";
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split(".");
  const spaced = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return sign + spaced + (dec ? "." + dec : "");
};
