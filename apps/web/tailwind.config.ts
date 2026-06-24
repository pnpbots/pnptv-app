import type { Config } from "tailwindcss";
import uiKitPreset from "@pnptv/ui-kit/tailwind";

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui-kit/src/**/*.{ts,tsx}",
  ],
  presets: [uiKitPreset as Partial<Config>],
  theme: {
    extend: {
      keyframes: {
        "slide-in-top": {
          "0%": { transform: "translateX(-50%) translateY(-100%)", opacity: "0" },
          "100%": { transform: "translateX(-50%) translateY(0)", opacity: "1" },
        },
        "slide-up": {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
      },
      animation: {
        "slide-in-top": "slide-in-top 0.3s ease-out",
        "slide-up": "slide-up 0.28s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
