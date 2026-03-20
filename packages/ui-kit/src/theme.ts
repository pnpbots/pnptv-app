/**
 * PNPtv! Design System — Flat, premium aesthetic.
 * No glow, shadow, neon, blur, or gradient effects.
 * Primary palette: Background #121212, Magenta #D4007A, Neon Lemon #FBFF00
 */
export const colors = {
  /** Primary background — near-black base for all surfaces. */
  background: "#121212",
  surface: "#1E1E1E",
  surfaceHover: "#2A2A2A",
  /** Brand magenta — primary interactive and highlight color. */
  accent: "#D4007A",
  accentHover: "#E6198E",
  amber: "#E69138",
  /** Neon lemon — reserved for high-contrast accent pops only. */
  lemon: "#FBFF00",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1A3",
  success: "#E69138",
  error: "#FF453A",
  warning: "#FFD60A",
  border: "#2A2A2A",
} as const;

export type ColorToken = keyof typeof colors;
