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
      boxShadow: {
        none: "none",
        DEFAULT: "none",
      },
    },
  },
};

export default config;
