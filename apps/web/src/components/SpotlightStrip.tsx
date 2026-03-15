import React, { type ReactNode } from "react";
import type { EventItem } from "@/components/events/EventCard";

export type SpotlightItem =
  | { kind: "event"; data: EventItem; pinned?: boolean }
  | {
      kind: "action";
      id: string;
      label: string;
      sublabel: string;
      icon: ReactNode;
      gradient: string;
      onClick: () => void;
      pinned?: boolean;
    };

export interface SpotlightStripProps {
  items: SpotlightItem[];
  onItemClick?: (item: SpotlightItem) => void;
  onAction?: () => void;
  actionLabel?: string;
  showAction?: boolean;
  className?: string;
  emptyAction?: () => void;
}

/* ── tiny sub-components ─────────────────────────────────── */

function ActionCard({ item }: { item: Extract<SpotlightItem, { kind: "action" }> }) {
  return (
    <button
      onClick={item.onClick}
      className="flex-shrink-0 w-28 rounded-xl overflow-hidden glass-card-sm hover:border-white/20 active:scale-[0.97] transition-all"
    >
      <div
        className="h-16 flex items-center justify-center"
        style={{ background: item.gradient }}
      >
        {item.icon}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-bold text-white truncate">{item.label}</p>
        <p className="text-[8px] text-white/40">{item.sublabel}</p>
      </div>
    </button>
  );
}

function EventCard({
  item,
  onClick,
}: {
  item: Extract<SpotlightItem, { kind: "event" }>;
  onClick?: () => void;
}) {
  const ev = item.data;
  const isLive = ev.type === "live_stream";
  const spotsLeft = ev.maxAttendees ? ev.maxAttendees - ev.rsvpCount : null;
  const isFull = spotsLeft !== null && spotsLeft <= 0;

  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-28 rounded-xl overflow-hidden glass-card-sm hover:border-white/20 active:scale-[0.97] transition-all"
    >
      {/* Cover */}
      <div className="h-16 relative bg-white/5">
        {ev.coverImage ? (
          <img src={ev.coverImage} alt="" className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{
              background: isLive
                ? "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(230,145,56,0.2))"
                : "linear-gradient(135deg, rgba(162,89,255,0.25), rgba(94,209,196,0.2))",
            }}
          >
            {isLive ? (
              <svg className="w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            )}
          </div>
        )}
        {/* Type badge */}
        <span
          className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[7px] font-bold uppercase"
          style={
            isLive
              ? { background: "rgba(212,0,122,0.85)", color: "#fff" }
              : { background: "rgba(162,89,255,0.85)", color: "#fff" }
          }
        >
          {isLive ? "LIVE" : "HANGOUT"}
        </span>
      </div>
      {/* Info */}
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-bold text-white truncate">{ev.title}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[8px] text-white/40">
            {new Date(ev.scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
          <span className={"text-[8px] font-semibold " + (isFull ? "text-red-400" : "text-white/50")}>
            {isFull ? "FULL" : spotsLeft !== null ? `${spotsLeft} left` : `${ev.rsvpCount} going`}
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyCard({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-28 rounded-xl overflow-hidden glass-card-sm border border-dashed border-white/10 hover:border-white/20 active:scale-[0.97] transition-all"
    >
      <div className="h-16 flex items-center justify-center" style={{ background: "rgba(162,89,255,0.08)" }}>
        <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </div>
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-bold text-white/40 truncate">No events</p>
        <p className="text-[8px] text-white/25">Create one</p>
      </div>
    </button>
  );
}

/* ── main component ──────────────────────────────────────── */

export function SpotlightStrip({
  items,
  onItemClick,
  onAction,
  actionLabel = "Create event",
  showAction = false,
  className = "",
  emptyAction,
}: SpotlightStripProps) {
  const pinnedItems = items.filter((i) => i.pinned);
  const scrollItems = items.filter((i) => !i.pinned);
  const hasContent = items.length > 0;

  const renderCard = (item: SpotlightItem, idx: number) => {
    if (item.kind === "action") {
      return <ActionCard key={item.id} item={item} />;
    }
    return (
      <EventCard
        key={item.data.id ?? idx}
        item={item}
        onClick={() => onItemClick?.(item)}
      />
    );
  };

  return (
    <div className={`relative mb-3 ${className}`}>
      {/* [+] action button */}
      {showAction && (
        <button
          onClick={onAction}
          className="absolute -top-1 right-0 z-10 w-6 h-6 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-90 transition-all"
          aria-label={actionLabel}
        >
          <svg className="w-3.5 h-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      )}

      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
        {/* Pinned cards */}
        {pinnedItems.map((item, i) => renderCard(item, i))}

        {/* Scrollable cards */}
        {scrollItems.map((item, i) => renderCard(item, pinnedItems.length + i))}

        {/* Empty state */}
        {!hasContent && <EmptyCard onClick={emptyAction ?? onAction} />}
      </div>
    </div>
  );
}
