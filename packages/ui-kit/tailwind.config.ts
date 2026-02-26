import type { Config } from "tailwindcss";
import { colors } from "./src/theme";

const config: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        pnp: colors,
      },
      fontFamily: {
        sans: ["Roboto Mono", "monospace"],
        mono: ["Roboto Mono", "monospace"],
        display: ["Ethnocentric Rg", "Roboto Mono", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
};

export default config;
