import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";
import React from "react";
import { useAuth } from "@/hooks/useAuth";
import { connectSocket } from "@/lib/socket";
import {
  getNotifications as fetchNotifications,
  getNotificationCounts as fetchCounts,
  markNotificationsAsRead,
  type Notification,
} from "@/lib/api";
import { subscribeToPush, isPushSubscribed } from "@/lib/pushNotifications";

interface ToastData {
  id: number;
  message: string;
  actor?: { id: string; username?: string; firstName?: string; photoUrl?: string } | null;
  type: string;
  entityType?: string;
  entityId?: string;
}

interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  latestToast: ToastData | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  markAllRead: () => Promise<void>;
  markRead: (ids: number[]) => Promise<void>;
  fetchMore: () => Promise<void>;
  dismissToast: () => void;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestToast, setLatestToast] = useState<ToastData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial notifications & counts + register push subscription
  useEffect(() => {
    if (!isAuthenticated) return;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [notifRes, countRes] = await Promise.all([
          fetchNotifications(30, 0),
          fetchCounts(),
        ]);
        setNotifications(notifRes.notifications);
        setUnreadCount(countRes.counts.total);
        setOffset(notifRes.notifications.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notifications");
      } finally {
        setIsLoading(false);
      }

      // Register push subscription if not already subscribed
      try {
        const subscribed = await isPushSubscribed();
        if (!subscribed && Notification.permission === "granted") {
          await subscribeToPush();
        }
      } catch {
        // push registration is best-effort
      }
    };
    load();
  }, [isAuthenticated]);

  // Socket.IO connection + event listeners
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const socket = connectSocket();

    const onConnect = () => {
      setIsConnected(true);
      // Clear fallback poll — socket is live
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const onDisconnect = () => {
      setIsConnected(false);
      // Start fallback poll only while disconnected
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          try {
            const res = await fetchCounts();
            setUnreadCount(res.counts.total);
          } catch {
            // ignore transient failures
          }
        }, 30000);
      }
    };

    const onNewNotification = (data: any) => {
      const notif: Notification = {
        id: String(data.id),
        type: data.type,
        category: data.category,
        priority: data.priority,
        actorId: data.actor?.id || "",
        actorUsername: data.actor?.username || "",
        actorFirstName: data.actor?.firstName || "",
        actorPhotoUrl: data.actor?.photoUrl || null,
        entityType: data.entityType,
        entityId: data.entityId,
        message: data.message,
        metadata: data.metadata,
        isRead: false,
        createdAt: data.createdAt,
      };

      setNotifications((prev) => [notif, ...prev]);
      setUnreadCount((prev) => prev + 1);

      // Show toast for high-priority notifications.
      // The auto-dismiss timer is owned entirely by the Toast component so it
      // can pause on hover — the provider only sets the toast data.
      if (data.priority === "high") {
        setLatestToast({
          id: data.id,
          message: data.message,
          actor: data.actor,
          type: data.type,
          entityType: data.entityType,
          entityId: data.entityId,
        });
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("notification:new", onNewNotification);

    return () => {
      // Remove only the notification-specific listeners.
      // Do NOT call disconnectSocket() — other hooks (chat, hangouts) share the singleton.
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("notification:new", onNewNotification);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isAuthenticated, user?.id]);

  const markAllRead = useCallback(async () => {
    try {
      await markNotificationsAsRead("all");
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }, []);

  const markRead = useCallback(async (ids: number[]) => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "https://pnptv.app"}/api/webapp/notifications/mark-read`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationIds: ids }),
        }
      );
      if (res.ok) {
        const idSet = new Set(ids.map(String));
        setNotifications((prev) =>
          prev.map((n) => (idSet.has(String(n.id)) ? { ...n, isRead: true } : n))
        );
        // Refetch the authoritative count from the server instead of
        // decrementing client-side (avoids drift when notifications are
        // marked read through other channels, e.g. bot or push).
        try {
          const countRes = await fetchCounts();
          setUnreadCount(countRes.counts.total);
        } catch {
          // Non-fatal: leave the count as-is if the refetch fails
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchMore = useCallback(async () => {
    try {
      const res = await fetchNotifications(30, offset);
      setNotifications((prev) => [...prev, ...res.notifications]);
      setOffset((prev) => prev + res.notifications.length);
    } catch {
      // ignore
    }
  }, [offset]);

  const dismissToast = useCallback(() => {
    setLatestToast(null);
  }, []);

  const value: NotificationsState = {
    notifications,
    unreadCount,
    latestToast,
    isConnected,
    isLoading,
    error,
    markAllRead,
    markRead,
    fetchMore,
    dismissToast,
  };

  return React.createElement(NotificationsContext.Provider, { value }, children);
}

export function useNotifications(): NotificationsState {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications must be used within NotificationProvider");
  return context;
}
