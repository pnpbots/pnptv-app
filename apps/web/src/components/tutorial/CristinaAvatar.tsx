import React from "react";

export function CristinaAvatar({ size = 36 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="Cristina AI"
      className="cristina-avatar-glow shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, fontSize: size * 0.75, lineHeight: 1 }}
    >🧜‍♀️</span>
  );
}
