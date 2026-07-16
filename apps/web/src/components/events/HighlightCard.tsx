import React from "react";
import { useNavigate } from "react-router-dom";
import { EventCard, type EventItem } from "./EventCard";

export interface AnnouncementItem {
  id: number;
  title: string;
  body: string;
  type: string;
  is_pinned: boolean;
  published_at: string;
  image?: string;
  link?: string;
}

export type HighlightItem = 
  | { kind: "event"; data: EventItem }
  | { kind: "announcement"; data: AnnouncementItem };

interface HighlightCardProps {
  item: HighlightItem;
  onRsvp?: (eventId: string, rsvpd: boolean) => void;
  onCancel?: (eventId: string) => void;
  canCancel?: boolean;
  onViewDetails?: (event: EventItem) => void;
}

export function HighlightCard({ item, onRsvp, onCancel, canCancel, onViewDetails }: HighlightCardProps) {
  const navigate = useNavigate();

  if (item.kind === "event") {
    return (
      <EventCard
        event={item.data}
        onRsvp={onRsvp}
        onCancel={onCancel}
        canCancel={canCancel}
        onViewDetails={onViewDetails}
      />
    );
  }

  const ann = item.data;
  const hasImage = !!ann.image && (ann.image.startsWith("/") || ann.image.startsWith("http"));
  const isInternal = ann.link && ann.link.startsWith("/") && !ann.link.startsWith("//");

  return (
    <div
      className="glass-card-sm flex-shrink-0 overflow-hidden cursor-pointer hover:border-white/15 transition-colors flex flex-col"
      style={{ width: 240, borderLeft: ann.is_pinned ? "3px solid rgba(212,0,122,0.4)" : undefined }}
      onClick={() => {
        if (!ann.link) return;
        if (isInternal) {
          navigate(ann.link);
        } else if (ann.link.startsWith("https://") || ann.link.startsWith("http://")) {
          const safeUrl = ann.link.startsWith("http://") ? ann.link.replace(/^http:\/\//, "https://") : ann.link;
          window.open(safeUrl, "_blank", "noopener,noreferrer");
        }
        // silently drop javascript:, ftp:, data:, etc.
      }}
    >
      {hasImage && (
        <div style={{ height: 110 }}>
          <img
            src={ann.image}
            alt={ann.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
      
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-1.5">
          {ann.is_pinned && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
              PINNED
            </span>
          )}
          <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: "#555" }}>
            {ann.type || "ANNOUNCEMENT"}
          </span>
        </div>
        
        <h3 className="text-sm font-semibold text-white leading-tight line-clamp-2 mb-1">{ann.title}</h3>
        <p className="text-[11px] leading-relaxed line-clamp-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          {ann.body}
        </p>
        
        <div className="mt-auto pt-2 flex items-center justify-between">
           <span className="text-[10px]" style={{ color: "#444" }}>
             {new Date(ann.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
           </span>
           {ann.link && (
             <span className="text-[10px] font-bold text-gradient uppercase tracking-wider">
               Read More
             </span>
           )}
        </div>
      </div>
    </div>
  );
}
