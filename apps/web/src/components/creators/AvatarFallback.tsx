import React from "react";

interface AvatarFallbackProps {
  username: string;
  size?: number;
}

export function AvatarFallback({ username, size = 40 }: AvatarFallbackProps) {
  return (
    <div
      className="flex items-center justify-center font-bold text-white rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #D4007A, #E69138)",
        fontSize: size / 2.8,
      }}
    >
      {username.slice(0, 2).toUpperCase()}
    </div>
  );
}
