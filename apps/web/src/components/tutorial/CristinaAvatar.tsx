import React from "react";

export function CristinaAvatar({ size = 36 }: { size?: number }) {
  return (
    <div
      className="cristina-avatar-glow rounded-full flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #5BC8F5, #00D4E8)",
      }}
    >
      <span style={{ fontSize: size * 0.5 }} role="img" aria-label="Cristina AI">
        🧜‍♀️
      </span>
    </div>
  );
}
