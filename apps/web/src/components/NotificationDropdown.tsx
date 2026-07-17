import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/hooks/useNotifications";
import { useI18n } from "@/lib/i18n";
import { getNotificationDeepLink } from "@/lib/notificationDeepLink";
import { getNotifications as fetchNotificationsApi, setAcceptingCalls } from "@/lib/api";
import type { Notification } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";

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

function CategoryIcon({ id }: { id: Category }) {
  const cls = "w-5 h-5";
  if (id === "all") return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
    </svg>
  );
  if (id === "social") return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
  if (id === "messaging") return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
  if (id === "hangouts") return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  );
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
      <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
    </svg>
  );
}

interface Props {
  onClose: () => void;
  isMobile?: boolean;
}

// Categories that map 1:1 to a backend category value
const SERVER_FILTERED_CATEGORIES = new Set(["social", "messaging", "hangouts"]);

export function NotificationDropdown({ onClose, isMobile = false }: Props) {
  const {
    notifications, markAllRead, markRead, isLoading, error, fetchMore, hasMore,
    categoryUnreadCounts, unreadCount,
  } = useNotifications();
  const t = useI18n();
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const navigate = useNavigate();

  // State for server-filtered category views (social / messaging / hangouts)
  const [catNotifs, setCatNotifs] = useState<Notification[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState(false);
  const [catHasMore, setCatHasMore] = useState(false);
  const [catOffset, setCatOffset] = useState(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!SERVER_FILTERED_CATEGORIES.has(activeCategory)) return;

    // Cancel any in-flight request
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setCatNotifs([]);
    setCatOffset(0);
    setCatHasMore(false);
    setCatError(false);
    setCatLoading(true);

    fetchNotificationsApi(30, 0, activeCategory)
      .then((res) => {
        if (controller.signal.aborted) return;
        setCatNotifs(res.notifications);
        setCatHasMore(res.hasMore ?? false);
        setCatOffset(res.notifications.length);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCatError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatLoading(false);
      });

    return () => controller.abort();
  }, [activeCategory]);

  const fetchMoreCat = async () => {
    const res = await fetchNotificationsApi(30, catOffset, activeCategory);
    setCatNotifs((prev) => [...prev, ...res.notifications]);
    setCatHasMore(res.hasMore ?? false);
    setCatOffset((prev) => prev + res.notifications.length);
  };

  const CATEGORIES: { key: Category; label: string }[] = [
    { key: "all", label: t.notifications.all },
    { key: "social", label: t.notifications.social },
    { key: "messaging", label: t.notifications.messages },
    { key: "hangouts", label: t.notifications.hangouts },
    { key: "other", label: t.notifications.other },
  ];

  // Badge counts from server (accurate across all notifications, not just loaded 30)
  const unreadByCategory: Record<string, number> = {
    all: unreadCount,
    social: categoryUnreadCounts.social ?? 0,
    messaging: categoryUnreadCounts.messaging ?? 0,
    hangouts: categoryUnreadCounts.hangouts ?? 0,
    other: (categoryUnreadCounts.commerce ?? 0) + (categoryUnreadCounts.system ?? 0) + (categoryUnreadCounts.announcements ?? 0),
  };

  // For "other", client-filter the loaded "all" notifications
  const otherNotifs = notifications.filter(
    (n) => !["social", "messaging", "hangouts"].includes(n.category ?? "")
  );

  // Resolve which list / loading / hasMore to use for the current view
  const isServerCat = SERVER_FILTERED_CATEGORIES.has(activeCategory);
  const displayNotifs = activeCategory === "all"
    ? notifications
    : isServerCat
      ? catNotifs
      : otherNotifs;
  const displayLoading = activeCategory === "all" ? isLoading : (isServerCat ? catLoading : false);
  const displayError = activeCategory === "all" ? error : (isServerCat && catError ? "Failed to load" : null);
  const displayHasMore = activeCategory === "all" ? hasMore : (isServerCat ? catHasMore : false);
  const handleFetchMore = activeCategory === "all" ? fetchMore : fetchMoreCat;

  const hasUnread = notifications.some((n) => !n.isRead);

  const [renewingId, setRenewingId] = useState<string | null>(null);

  const handleRenew = async (e: React.MouseEvent, notif: Notification) => {
    e.stopPropagation();
    if (renewingId) return;
    setRenewingId(notif.id);
    try {
      await setAcceptingCalls(true);
      markRead([Number(notif.id)]);
      if (isServerCat) {
        setCatNotifs((prev) => prev.map((n) => n.id === notif.id ? { ...n, isRead: true } : n));
      }
      onClose();
      navigate("/creators/availability");
    } catch {
      // non-fatal — navigate anyway so creator can renew manually
      onClose();
      navigate("/creators/availability");
    } finally {
      setRenewingId(null);
    }
  };

  const handleTap = (notif: Notification) => {
    if (!notif.isRead) {
      markRead([Number(notif.id)]);
      // Also optimistically mark read in the category view
      if (isServerCat) {
        setCatNotifs((prev) => prev.map((n) => n.id === notif.id ? { ...n, isRead: true } : n));
      }
    }
    onClose();
    navigate(getNotificationDeepLink(notif));
  };

  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background";

  const containerCls = isMobile
    ? "w-full max-h-[82svh] flex flex-col rounded-t-2xl bg-pnp-background border-t border-pnp-border shadow-2xl overflow-hidden"
    : "w-[400px] max-w-[calc(100vw-2rem)] max-h-[82svh] flex flex-col rounded-xl bg-pnp-background border border-pnp-border shadow-xl overflow-hidden";

  return (
    <div
      role="dialog"
      aria-label={t.notifications.notifications}
      className={containerCls}
    >
      {/* Drag handle — mobile only */}
      {isMobile && (
        <div className="flex justify-center pt-3 pb-1 shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-pnp-border" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border shrink-0">
        <h3 className="text-sm font-semibold text-pnp-textPrimary">
          {t.notifications.notifications}
        </h3>
        <button
          onClick={onClose}
          aria-label="Close"
          className={`w-8 h-8 flex items-center justify-center rounded-full text-pnp-textSecondary hover:bg-white/10 hover:text-pnp-textPrimary transition-colors ${focusRing}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Category grid — 3+2 layout */}
      <div className="grid grid-cols-3 gap-2 p-3 border-b border-pnp-border shrink-0">
        {CATEGORIES.map((cat) => {
          const count = unreadByCategory[cat.key] ?? 0;
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`relative flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl text-xs font-medium transition-all ${focusRing} ${
                isActive
                  ? "bg-pnp-accent text-white"
                  : "bg-white/5 text-pnp-textSecondary hover:bg-white/10 hover:text-pnp-textPrimary"
              }`}
            >
              <CategoryIcon id={cat.key} />
              <span className="leading-tight text-center">{cat.label}</span>
              {count > 0 && !isActive && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5 leading-none pointer-events-none">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Mark all read */}
      {hasUnread && !displayLoading && !displayError && (
        <div className="px-4 py-2 border-b border-pnp-border/50 shrink-0">
          <button
            onClick={async () => {
              await markAllRead();
              setCatNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
            }}
            className={`w-full text-center text-xs text-pnp-accent hover:underline rounded py-0.5 ${focusRing}`}
          >
            {t.notifications.markAllRead}
          </button>
        </div>
      )}

      {/* Loading state */}
      {displayLoading && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-1 py-1 animate-pulse">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-pnp-surface" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 bg-pnp-surface rounded w-3/4" />
                <div className="h-2.5 bg-pnp-surface rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!displayLoading && displayError && (
        <div className="flex-1 flex flex-col items-center justify-center py-10 px-4 gap-3 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-pnp-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
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
      {!displayLoading && !displayError && (
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {displayNotifs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-pnp-textSecondary text-sm">
              {activeCategory === "all" ? t.notifications.noNotifications : t.notifications.noNotificationsInCategory}
            </div>
          ) : (
            <>
              {displayNotifs.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleTap(notif)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-white/5 active:bg-white/10 transition-colors border-b border-pnp-border/50 border-l-2 ${focusRing} ${
                    !notif.isRead
                      ? "bg-white/[0.04] border-l-pnp-accent"
                      : "border-l-transparent"
                  }`}
                >
                  {/* Actor avatar — hidden for system notifications with no actor */}
                  {notif.actorId ? (
                    <UserAvatar
                      userId={notif.actorId}
                      photoUrl={notif.actorPhotoUrl}
                      displayName={notif.actorFirstName || notif.actorUsername}
                      size="md"
                      onClick={(e) => { e.stopPropagation(); onClose(); navigate(`/profile/${notif.actorId}`); }}
                      linkToProfile={false}
                    />
                  ) : (
                    <span className="flex-shrink-0 w-10 h-10 rounded-full bg-pnp-accent/20 flex items-center justify-center text-pnp-accent" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </span>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] leading-snug ${!notif.isRead ? "text-pnp-textPrimary font-medium" : "text-pnp-textSecondary"}`}>
                      {notif.message}
                    </p>
                    {notif.type === "availability_expiring" && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleRenew(e, notif)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleRenew(e as unknown as React.MouseEvent, notif); }}
                        className={`inline-flex items-center mt-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors cursor-pointer ${renewingId === notif.id ? "opacity-60 pointer-events-none" : ""}`}
                        aria-label="Renew availability"
                      >
                        {renewingId === notif.id ? "Renewing..." : "Renew +60 min"}
                      </span>
                    )}
                    <span className="text-[11px] text-pnp-textSecondary mt-1 block">
                      {timeAgo(notif.createdAt)}
                    </span>
                  </div>

                  {!notif.isRead && (
                    <span className="flex-shrink-0 w-2 h-2 rounded-full bg-pnp-accent mt-2.5" aria-hidden="true" />
                  )}
                </button>
              ))}

              {displayHasMore && (
                <div className="p-3 flex justify-center">
                  <button
                    onClick={handleFetchMore}
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
