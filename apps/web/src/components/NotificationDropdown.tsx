import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/hooks/useNotifications";

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "social", label: "Social" },
  { key: "messaging", label: "Messages" },
  { key: "hangouts", label: "Hangouts" },
  { key: "other", label: "Other" },
] as const;

type Category = (typeof CATEGORIES)[number]["key"];

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getDeepLink(notif: any): string {
  switch (notif.entityType) {
    case "post":
      return "/social";
    case "message":
      return `/dm/${notif.actorId}`;
    case "group":
      return "/chat";
    case "payment":
      return "/profile";
    default:
      return "/";
  }
}

interface Props {
  onClose: () => void;
}

export function NotificationDropdown({ onClose }: Props) {
  const { notifications, markAllRead } = useNotifications();
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const navigate = useNavigate();

  const filtered = notifications.filter((n) => {
    if (activeCategory === "all") return true;
    if (activeCategory === "other") {
      return !["social", "messaging", "hangouts"].includes(n.category || "");
    }
    return n.category === activeCategory;
  });

  const handleTap = (notif: any) => {
    onClose();
    navigate(getDeepLink(notif));
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
  };

  return (
    <div className="absolute right-0 top-10 w-80 max-h-[70vh] flex flex-col rounded-xl glass-nav border border-pnp-border shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border">
        <h3 className="text-sm font-semibold text-pnp-textPrimary">Notifications</h3>
        <button
          onClick={handleMarkAllRead}
          className="text-xs text-pnp-accent hover:underline"
        >
          Mark all read
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-pnp-border overflow-x-auto no-scrollbar">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat.key
                ? "bg-pnp-accent text-white"
                : "text-pnp-textSecondary hover:bg-white/10"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-pnp-textSecondary text-sm">
            No notifications
          </div>
        ) : (
          filtered.map((notif) => (
            <button
              key={notif.id}
              onClick={() => handleTap(notif)}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-pnp-border/50 ${
                !notif.isRead ? "bg-white/[0.03]" : ""
              }`}
            >
              {/* Actor avatar */}
              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {notif.actorPhotoUrl ? (
                  <img
                    src={notif.actorPhotoUrl}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  (notif.actorFirstName || notif.actorUsername || "?")[0].toUpperCase()
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-snug ${!notif.isRead ? "text-pnp-textPrimary font-medium" : "text-pnp-textSecondary"}`}>
                  {notif.message}
                </p>
                <span className="text-[10px] text-pnp-textSecondary mt-0.5 block">
                  {timeAgo(notif.createdAt)}
                </span>
              </div>

              {!notif.isRead && (
                <span className="flex-shrink-0 w-2 h-2 rounded-full bg-pnp-accent mt-1.5" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
