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
      },
      animation: {
        "slide-in-top": "slide-in-top 0.3s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
