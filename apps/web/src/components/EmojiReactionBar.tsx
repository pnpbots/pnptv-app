import React, { useState, useRef, useEffect } from 'react';

export type Reaction = {
  emoji: string;
  count: number;
  users: { id: string; username: string }[];
};

export const DEFAULT_EMOJIS = ['❤️', '🔥', '💊', '😍', '😂', '👀'];

interface EmojiReactionBarProps {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
  currentUserId?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export default function EmojiReactionBar({
  reactions,
  onToggle,
  currentUserId,
  size = 'sm',
  className = '',
}: EmojiReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const pillH = size === 'sm' ? 'h-7' : 'h-8';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  const userHasReacted = (emoji: string) =>
    !!currentUserId &&
    (reactions.find(r => r.emoji === emoji)?.users.some(u => u.id === currentUserId) ?? false);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  if (!reactions.length && !currentUserId) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {reactions.map(r => {
        const reacted = userHasReacted(r.emoji);
        const tooltipNames = r.users.slice(0, 3).map(u => `@${u.username}`).join(', ');
        return (
          <div key={r.emoji} className="relative group">
            <button
              onClick={() => onToggle(r.emoji)}
              aria-label={`${r.emoji} ${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}`}
              className={`
                flex items-center gap-1 px-2 ${pillH} rounded-full border transition-all select-none
                ${textSize} font-medium
                ${
                  reacted
                    ? 'bg-violet-900/40 border-violet-500 text-violet-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500'
                }
              `}
            >
              <span>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
            {/* Tooltip */}
            {tooltipNames && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 pointer-events-none hidden group-hover:block">
                <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 whitespace-nowrap shadow-lg max-w-[180px] truncate">
                  {tooltipNames}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add reaction button */}
      {currentUserId && (
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen(v => !v)}
            aria-label="Add reaction"
            className={`
              flex items-center justify-center w-7 ${pillH} rounded-full border border-zinc-700
              bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-all ${textSize}
            `}
          >
            +
          </button>

          {pickerOpen && (
            <div className="absolute bottom-full left-0 mb-1.5 z-50 bg-zinc-900 border border-zinc-700 rounded-xl p-2 shadow-xl flex gap-1.5">
              {DEFAULT_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => { onToggle(emoji); setPickerOpen(false); }}
                  className="text-lg hover:scale-125 transition-transform p-1 rounded hover:bg-zinc-700"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
