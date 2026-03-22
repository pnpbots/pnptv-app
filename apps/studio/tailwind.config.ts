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
    extend: {},
  },
  plugins: [],
};

export default config;
