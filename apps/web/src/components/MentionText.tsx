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
 * Renders a string with @username / #hashtag / URL tokens converted to tappable links.
 * @username navigates to /profile/:username.
 * #hashtag navigates to /?tag=hashtagname for filtered feed.
 * Plain http(s) URLs open in a new tab.
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

  // Split on @mention, #hashtag, and URL tokens
  const parts = displayText.split(/(@[a-zA-Z0-9_]{2,32}|#[a-zA-Z0-9_À-ɏ]{1,64}|https?:\/\/[^\s<>"]+)/g);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (/^https?:\/\/[^\s<>"]+$/.test(part)) {
          // Strip trailing punctuation that isn't part of the URL
          const trimmed = part.replace(/[.,;:!?)\]]+$/, "");
          const trailing = part.slice(trimmed.length);
          return (
            <React.Fragment key={i}>
              <a
                href={trimmed}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline underline-offset-2 decoration-1 font-medium break-all inline-flex items-center gap-0.5"
                style={{ color: "#5ED1C4" }}
              >
                {trimmed}
                <svg
                  aria-hidden="true"
                  className="w-3 h-3 flex-shrink-0 inline-block"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              {trailing}
            </React.Fragment>
          );
        }

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

        if (/^#[a-zA-Z0-9_À-ɏ]{1,64}$/.test(part)) {
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
