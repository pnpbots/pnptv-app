import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  KeyboardEvent,
} from "react";
import { searchMentions, type MentionUser } from "@/lib/api";

interface MentionInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  /** Called when Enter is pressed without Shift (if no dropdown is open). */
  onSubmit?: () => void;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

interface ActiveMention {
  query: string;
  /** Index in the full string where `@` starts. */
  start: number;
}

function getActiveMention(
  text: string,
  cursorPos: number
): ActiveMention | null {
  const before = text.slice(0, cursorPos);
  const match = before.match(/@([a-zA-Z0-9_]*)$/);
  if (!match) return null;
  return { query: match[1], start: cursorPos - match[0].length };
}

/**
 * Drop-in textarea with @mention autocomplete.
 *
 * When the user types `@` followed by non-space characters, a floating dropdown
 * appears above the input showing matching users fetched from the social API.
 * Selecting a user replaces the partial @token with `@username `.
 *
 * Exports both a named export (`MentionInput`) and a default export for
 * backward compatibility with any existing default import sites.
 */
export function MentionInput({
  value,
  onChange,
  placeholder,
  maxLength = 500,
  className,
  onSubmit,
  rows = 2,
  autoFocus = false,
  disabled = false,
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cursorPos, setCursorPos] = useState(0);
  const [dropdown, setDropdown] = useState<MentionUser[]>([]);
  const [dropdownLoading, setDropdownLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(
    null
  );

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setDropdown([]);
        setActiveMention(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newVal = e.target.value.slice(0, maxLength);
      const pos = e.target.selectionStart ?? newVal.length;
      onChange(newVal);
      setCursorPos(pos);

      const mention = getActiveMention(newVal, pos);

      if (!mention) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setDropdown([]);
        setActiveMention(null);
        setDropdownLoading(false);
        return;
      }

      setActiveMention(mention);
      setSelectedIndex(0);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (mention.query.length === 0) {
        // Just typed @, don't search yet
        setDropdown([]);
        setDropdownLoading(false);
        return;
      }

      setDropdownLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await searchMentions(mention.query);
          setDropdown(res.users || []);
        } catch {
          setDropdown([]);
        } finally {
          setDropdownLoading(false);
        }
      }, 200);
    },
    [onChange, maxLength]
  );

  const insertMention = useCallback(
    (user: MentionUser) => {
      const mention = activeMention;
      if (!mention) return;
      // Use current real cursor pos from the textarea, not stale state
      const pos = textareaRef.current?.selectionStart ?? cursorPos;
      const before = value.slice(0, mention.start);
      const after = value.slice(pos);
      const newText = `${before}@${user.username} ${after}`.slice(
        0,
        maxLength
      );
      onChange(newText);
      setDropdown([]);
      setActiveMention(null);
      setDropdownLoading(false);

      const newCursor = mention.start + user.username.length + 2; // @ + username + space
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursor, newCursor);
          setCursorPos(newCursor);
        }
      });
    },
    [activeMention, cursorPos, value, onChange, maxLength]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (dropdown.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, dropdown.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          insertMention(dropdown[selectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setDropdown([]);
          setActiveMention(null);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    },
    [dropdown, selectedIndex, insertMention, onSubmit]
  );

  const handleSelect = useCallback(() => {
    const pos = textareaRef.current?.selectionStart ?? 0;
    setCursorPos(pos);
  }, []);

  const showDropdown = dropdown.length > 0 || dropdownLoading;

  return (
    <div className="relative flex-1 min-w-0">
      {/* Mention dropdown — floats above the textarea */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 right-0 mb-1 rounded-xl overflow-hidden shadow-xl z-50"
          style={{
            background: "var(--pnp-surface, #1C1C1E)",
            border: "1px solid rgba(255,255,255,0.12)",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {dropdownLoading && dropdown.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              Searching...
            </div>
          ) : (
            dropdown.map((user, idx) => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(user);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                style={{
                  background:
                    idx === selectedIndex
                      ? "rgba(94,209,196,0.12)"
                      : "transparent",
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.username}
                    className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{
                      background: "linear-gradient(135deg, #D4007A, #E69138)",
                      color: "#fff",
                    }}
                  >
                    {(user.username || "?")[0].toUpperCase()}
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span
                    className="text-xs font-semibold truncate"
                    style={{ color: "#5ED1C4" }}
                  >
                    @{user.username}
                  </span>
                  {user.creator_status === "approved" && (
                    <span
                      className="text-[10px] leading-none"
                      style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
                    >
                      Creator
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        maxLength={maxLength}
        className={
          className ??
          "w-full bg-white/5 text-white text-xs rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 placeholder:text-white/30 resize-none"
        }
      />
    </div>
  );
}

export default MentionInput;
