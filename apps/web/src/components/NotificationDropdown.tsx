import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/hooks/useNotifications";
import { useI18n } from "@/lib/i18n";
import { getNotificationDeepLink } from "@/lib/notificationDeepLink";
import type { Notification } from "@/lib/api";

type Category = "all" | "social" | "messaging" | "hangouts" | "other";

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

interface Props {
  onClose: () => void;
}

export function NotificationDropdown({ onClose }: Props) {
  const { notifications, markAllRead, markRead, isLoading, error, fetchMore, hasMore } = useNotifications();
  const t = useI18n();
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const navigate = useNavigate();

  const CATEGORIES: { key: Category; label: string }[] = [
    { key: "all", label: t.notifications.all },
    { key: "social", label: t.notifications.social },
    { key: "messaging", label: t.notifications.messages },
    { key: "hangouts", label: t.notifications.hangouts },
    { key: "other", label: t.notifications.other },
  ];

  const filtered = notifications.filter((n) => {
    if (activeCategory === "all") return true;
    if (activeCategory === "other") {
      return !["social", "messaging", "hangouts"].includes(n.category || "");
    }
    return n.category === activeCategory;
  });

  const hasUnread = notifications.some((n) => !n.isRead);

  const handleTap = (notif: Notification) => {
    // Mark as read on click
    if (!notif.isRead) {
      markRead([Number(notif.id)]);
    }
    onClose();
    navigate(getNotificationDeepLink(notif));
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
  };

  const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background";

  return (
    <div
      role="dialog"
      aria-label={t.notifications.notifications}
      className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col rounded-xl glass-nav border border-pnp-border shadow-xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border shrink-0">
        <h3 className="text-sm font-semibold text-pnp-textPrimary">
          {t.notifications.notifications}
        </h3>
        {hasUnread && (
          <button
            onClick={handleMarkAllRead}
            className={`text-xs text-pnp-accent hover:underline rounded ${focusRing}`}
          >
            {t.notifications.markAllRead}
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-pnp-border overflow-x-auto no-scrollbar shrink-0">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${focusRing} ${
              activeCategory === cat.key
                ? "bg-pnp-accent text-white"
                : "text-pnp-textSecondary hover:bg-white/10"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-1 py-1 animate-pulse">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-pnp-surface" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-pnp-surface rounded w-3/4" />
                <div className="h-2.5 bg-pnp-surface rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="flex-1 flex flex-col items-center justify-center py-10 px-4 gap-3 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-pnp-error"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm text-pnp-textSecondary">{t.notifications.failedToLoad}</p>
          <button
            onClick={() => window.location.reload()}
            className={`px-4 py-2 rounded-lg bg-pnp-accent text-white text-xs font-medium hover:opacity-90 transition-opacity active:scale-[0.98] ${focusRing}`}
          >
            {t.notifications.retry}
          </button>
        </div>
      )}

      {/* Notification list */}
      {!isLoading && !error && (
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-pnp-textSecondary text-sm">
              {activeCategory === "all"
                ? t.notifications.noNotifications
                : t.notifications.noNotificationsInCategory}
            </div>
          ) : (
            <>
              {filtered.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleTap(notif)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 active:bg-white/10 transition-colors border-b border-pnp-border/50 ${focusRing} ${
                    !notif.isRead ? "bg-white/[0.03]" : ""
                  }`}
                >
                  {/* Actor avatar */}
                  <div
                    className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-gradient-to-br from-[#D4007A] to-[#E69138] text-white overflow-hidden"
                    aria-hidden="true"
                  >
                    {notif.actorPhotoUrl ? (
                      <img
                        src={notif.actorPhotoUrl}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover"
                      />
                    ) : (
                      (notif.actorFirstName || notif.actorUsername || "?")[0].toUpperCase()
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-[13px] leading-snug ${
                        !notif.isRead
                          ? "text-pnp-textPrimary font-medium"
                          : "text-pnp-textSecondary"
                      }`}
                    >
                      {notif.message}
                    </p>
                    <span className="text-[11px] text-pnp-textSecondary mt-1 block">
                      {timeAgo(notif.createdAt)}
                    </span>
                  </div>

                  {!notif.isRead && (
                    <span
                      className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-pnp-accent mt-1.5"
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))}

              {/* Load more — only show when there are more to fetch */}
              {hasMore && (
                <div className="p-3 flex justify-center">
                  <button
                    onClick={fetchMore}
                    className={`text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors px-3 py-2 rounded-lg hover:bg-white/5 active:bg-white/10 ${focusRing}`}
                  >
                    {t.notifications.loadMore}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
