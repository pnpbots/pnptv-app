import React, { useState, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://pnptv.app';

interface MentionUser {
  id: string;
  username: string;
  avatar_url?: string;
  creator_status?: string;
}

interface MentionInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  maxLength?: number;
}

/**
 * Textarea that detects `@username` at cursor and shows an autocomplete dropdown.
 * On selection, replaces the `@partial` text with `@username `.
 */
export default function MentionInput({
  value,
  onChange,
  placeholder,
  className = '',
  rows = 3,
  onKeyDown,
  disabled,
  maxLength,
}: MentionInputProps) {
  const [suggestions, setSuggestions] = useState<MentionUser[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const detectMention = useCallback((text: string, cursorPos: number): string | null => {
    const before = text.slice(0, cursorPos);
    const match = before.match(/@([a-zA-Z0-9_]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStart(before.lastIndexOf('@'));
      return match[1];
    }
    setShowDropdown(false);
    setMentionStart(-1);
    return null;
  }, []);

  const fetchSuggestions = useCallback((q: string) => {
    if (q.length < 1) { setSuggestions([]); setShowDropdown(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/webapp/users/mention-search?q=${encodeURIComponent(q)}`,
          { credentials: 'include' }
        );
        if (!res.ok) throw new Error('search failed');
        const data = await res.json();
        const users = data.users || [];
        setSuggestions(users);
        setShowDropdown(users.length > 0);
        setActiveIdx(0);
      } catch {
        setSuggestions([]);
        setShowDropdown(false);
      }
    }, 300);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    onChange(newVal);
    const cursor = e.target.selectionStart ?? newVal.length;
    const q = detectMention(newVal, cursor);
    if (q !== null) fetchSuggestions(q);
  };

  const selectUser = (user: MentionUser) => {
    if (mentionStart === -1) return;
    const before = value.slice(0, mentionStart);
    const after = value.slice(mentionStart + mentionQuery.length + 1);
    const newVal = `${before}@${user.username} ${after}`;
    onChange(newVal);
    setShowDropdown(false);
    setSuggestions([]);
    setMentionStart(-1);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        const pos = before.length + user.username.length + 2;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDropdown && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && suggestions[activeIdx]) {
        e.preventDefault();
        selectUser(suggestions[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setShowDropdown(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        rows={rows}
        disabled={disabled}
        maxLength={maxLength}
      />

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 bottom-full mb-1 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden">
          {suggestions.map((user, idx) => (
            <button
              key={user.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); selectUser(user); }}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                ${idx === activeIdx ? 'bg-zinc-700' : 'hover:bg-zinc-800'}
              `}
            >
              <img
                src={user.avatar_url || '/placeholder-avatar.png'}
                alt={user.username}
                className="w-7 h-7 rounded-full object-cover flex-shrink-0 bg-zinc-700"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm text-zinc-100 font-medium truncate">@{user.username}</span>
                {user.creator_status === 'approved' && (
                  <span className="text-xs bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    Creator
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
