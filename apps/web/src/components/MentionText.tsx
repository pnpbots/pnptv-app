import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

interface MentionTextProps {
  text: string;
  className?: string;
  /** Collapse text beyond this character count with a "View more" toggle */
  maxLength?: number;
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  return (cut > max * 0.4 ? text.slice(0, cut) : text.slice(0, max)).trimEnd();
}

/**
 * Renders a string with @username and #hashtag tokens converted to tappable links.
 * @username navigates to /profile/:username.
 * #hashtag navigates to /?tag=hashtagname for filtered feed.
 * Optionally collapses long text behind a "View more" toggle.
 */
export function MentionText({ text, className, maxLength }: MentionTextProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  if (!text) return <span className={className} />;

  const needsTruncation = maxLength != null && text.length > maxLength;
  const displayText = needsTruncation && !expanded
    ? truncateAtWord(text, maxLength)
    : text;

  // Split on both @mention and #hashtag tokens
  const parts = displayText.split(/(@[a-zA-Z0-9_]{2,32}|#[a-zA-Z0-9_\u00C0-\u024F]{1,64})/g);

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

        if (/^#[a-zA-Z0-9_\u00C0-\u024F]{1,64}$/.test(part)) {
          const tag = part.slice(1);
          return (
            <span
              key={i}
              className="font-medium cursor-pointer hover:underline"
              style={{ color: "#D4007A" }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/?tag=${encodeURIComponent(tag)}`);
              }}
            >
              {part}
            </span>
          );
        }

        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
      {needsTruncation && !expanded && (
        <>
          {"... "}
          <span
            className="font-medium cursor-pointer hover:underline"
            style={{ color: "#5ED1C4" }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            View more
          </span>
        </>
      )}
    </span>
  );
}
