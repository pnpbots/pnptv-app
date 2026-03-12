import React from "react";
import { useNavigate } from "react-router-dom";

interface MentionTextProps {
  text: string;
  className?: string;
}

/**
 * Renders a string with @username tokens converted to tappable links
 * that navigate to /profile/:username.
 */
export function MentionText({ text, className }: MentionTextProps) {
  const navigate = useNavigate();

  if (!text) return <span className={className} />;

  const parts = text.split(/(@[a-zA-Z0-9_]{2,32})/g);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (/^@[a-zA-Z0-9_]{2,32}$/.test(part)) {
          const username = part.slice(1);
          return (
            <span
              key={i}
              className="font-medium cursor-pointer hover:underline"
              style={{ color: "#5ED1C4" }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/profile/${username}`);
              }}
            >
              {part}
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}
