/**
 * PNPtv! Design System — Flat, premium aesthetic.
 * No glow, shadow, neon, blur, or gradient effects.
 *
 * Tokens are now CSS custom properties so the app can switch between
 * dark (default) and light themes via a `data-theme` attribute on the
 * <html> element. The actual color values for each theme are defined
 * in apps/web/src/styles/globals.css under :root and [data-theme="light"].
 *
 * Brand-anchor colors that should NOT change between themes (magenta,
 * lemon, amber) are kept as literal hex; only neutrals + text + borders
 * flip with the theme.
 */
export const colors = {
  /** Theme-aware tokens — flip between dark/light via CSS vars */
  background: "var(--pnp-background, #121212)",
  surface: "var(--pnp-surface, #1E1E1E)",
  surfaceHover: "var(--pnp-surface-hover, #2A2A2A)",
  textPrimary: "var(--pnp-text-primary, #FFFFFF)",
  textSecondary: "var(--pnp-text-secondary, #A1A1A3)",
  border: "var(--pnp-border, #2A2A2A)",

  /** Brand-anchor colors — same in both themes */
  accent: "#D4007A",
  accentHover: "#E6198E",
  amber: "#E69138",
  lemon: "#FBFF00",
  success: "#E69138",
  error: "#FF453A",
  warning: "#FFD60A",
  purple: "#A78BFA",
} as const;

export type ColorToken = keyof typeof colors;
