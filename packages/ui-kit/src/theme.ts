export const colors = {
  background: "#121212",
  surface: "#1E1E1E",
  surfaceHover: "#2A2A2A",
  accent: "#D4007A",
  accentHover: "#E6198E",
  amber: "#E69138",
  lemon: "#FBFF00",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1A3",
  success: "#E69138",
  error: "#FF453A",
  warning: "#FFD60A",
  border: "#2A2A2A",
} as const;

export type ColorToken = keyof typeof colors;
