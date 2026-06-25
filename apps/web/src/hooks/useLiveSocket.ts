import { useState, useEffect, useRef, useCallback } from "react";
import { connectSocket } from "@/lib/socket";
import type { TipGoal } from "@/lib/api";

export interface LiveChatMessage {
  id: number;
  streamId: string;
  userId?: string;
  username: string;
  content: string;
  createdAt: string;
}

export interface LiveTip {
  id: number;
  amount: number;
  username: string;
  performerName: string;
  message?: string;
  createdAt: string;
  paymentMethod?: string;
}

export interface LiveRaidEvent {
  sourceChannelRef: string;
  targetChannelRef: string;
  targetName: string;
  targetHlsUrl: string;
  viewerCount: number;
  raidedBy: string | number;
}

export interface LiveTipAlert {
  amount: number;
  username: string;
  message: string;
}

interface UseLiveSocketResult {
  messages: LiveChatMessage[];
  viewerCount: number;
  isConnected: boolean;
  reconnecting: boolean;
  sendMessage: (content: string) => void;
  latestTip: LiveTip | null;
  walletBalance: number | null;
  /** FE-M1: true once the socket has delivered at least one wallet:updated event.
   *  Callers should prefer the socket value over HTTP-fetched values once true. */
  socketBalanceReceived: boolean;
  setWalletBalance: (b: number) => void;
  socketError: string | null;
  /** Raid event received from the server — non-null while a raid is in progress. */
  raidEvent: LiveRaidEvent | null;
  /** Dismiss the active raid overlay (viewer clicked Cancel). */
  dismissRaid: () => void;
  /** Current tip goal state — updated via live:goal_update socket event. */
  tipGoal: TipGoal | null;
  /** Latest tip alert — auto-clears after 4 seconds. */
  tipAlert: LiveTipAlert | null;
  /** True when the server has banned this socket from the stream chat. */
  chatBanned: boolean;
}

export function useLiveSocket(streamId: string | null): UseLiveSocketResult {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [latestTip, setLatestTip] = useState<LiveTip | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [raidEvent, setRaidEvent] = useState<LiveRaidEvent | null>(null);
  const [tipGoal, setTipGoal] = useState<TipGoal | null>(null);
  const [tipAlert, setTipAlert] = useState<LiveTipAlert | null>(null);
  const [chatBanned, setChatBanned] = useState(false);
  const [socketBalanceReceived, setSocketBalanceReceived] = useState(false);
  const tipAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raidDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks the currently joined streamId so we can emit live:leave on change/unmount
  const joinedStreamRef = useRef<string | null>(null);
  // SOCK-H6: prevent double live:join emissions when the effect re-runs
  const hasJoinedRef = useRef(false);
  // FE-M1: once the socket delivers a balance, prefer it over HTTP-fetched values.
  // Used as an internal guard inside socket callbacks (avoids stale closure over state).
  const socketBalanceReceivedRef = useRef(false);

  // ── Always-on: personal event bus (wallet updates, connection state) ─────────
  // Runs once on mount — connects the socket regardless of streamId so that
  // wallet:updated events are received even on non-stream pages (e.g. Live lobby).
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = connectSocket();

    const onWalletUpdated = (data: { balance: number }) => {
      // FE-M1: mark that the authoritative socket value has arrived;
      // callers that set balance via HTTP should check this flag first.
      socketBalanceReceivedRef.current = true;
      setSocketBalanceReceived(true);
      setWalletBalance(data.balance);
    };
    const onConnect = () => {
      setIsConnected(true);
      setReconnecting(false);
      setSocketError(null);
    };
    const onDisconnect = () => {
      setIsConnected(false);
      joinedStreamRef.current = null;
    };
    const onReconnectAttempt = () => {
      setReconnecting(true);
    };
    const onError = () => {
      setIsConnected(false);
    };
    const onLiveError = (data: { message: string; code?: string }) => {
      if (data.code === "CHAT_BANNED") {
        setChatBanned(true);
        return;
      }
      setSocketError(data.message);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setSocketError(null), 5000);
    };

    const onGoalUpdate = (data: TipGoal) => {
      setTipGoal(data);
    };

    const onTipAlert = (data: LiveTipAlert) => {
      setTipAlert(data);
      if (tipAlertTimerRef.current) clearTimeout(tipAlertTimerRef.current);
      tipAlertTimerRef.current = setTimeout(() => {
        setTipAlert(null);
        tipAlertTimerRef.current = null;
      }, 4000);
    };

    if (socket.connected) {
      setIsConnected(true);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect_attempt", onReconnectAttempt);
    socket.on("connect_error", onError);
    socket.on("wallet:updated", onWalletUpdated);
    socket.on("live:error", onLiveError);
    socket.on("live:goal_update", onGoalUpdate);
    socket.on("live:tip_alert", onTipAlert);

    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (tipAlertTimerRef.current) clearTimeout(tipAlertTimerRef.current);
      if (raidDismissTimerRef.current) clearTimeout(raidDismissTimerRef.current);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off("connect_error", onError);
      socket.off("wallet:updated", onWalletUpdated);
      socket.off("live:error", onLiveError);
      socket.off("live:goal_update", onGoalUpdate);
      socket.off("live:tip_alert", onTipAlert);
    };
  }, []);

  // ── Stream-specific: join/leave room, messages, viewer count, tips ───────────
  useEffect(() => {
    if (!streamId) {
      if (joinedStreamRef.current) {
        const socket = connectSocket();
        socket.emit("live:leave", { streamId: joinedStreamRef.current });
        joinedStreamRef.current = null;
      }
      hasJoinedRef.current = false;
      setMessages([]);
      setViewerCount(0);
      setRaidEvent(null);
      return;
    }

    const socket = connectSocket();

    // Leave previous stream and clear state immediately on stream change
    if (joinedStreamRef.current && joinedStreamRef.current !== streamId) {
      socket.emit("live:leave", { streamId: joinedStreamRef.current });
      joinedStreamRef.current = null;
      hasJoinedRef.current = false;
    }

    // Reset UI state before registering new listeners so stale messages
    // from the previous stream are never visible on the incoming stream
    setMessages([]);
    setViewerCount(0);
    setRaidEvent(null);

    const joinStream = () => {
      // SOCK-H6: guard against double join when effect re-runs (e.g. StrictMode
      // double-invoke or hot reload) while the socket is already connected.
      if (hasJoinedRef.current) return;
      hasJoinedRef.current = true;
      socket.emit("live:join", { streamId });
      joinedStreamRef.current = streamId;
    };

    const onConnectForStream = () => {
      // Reset the guard on reconnect so we rejoin after a disconnect
      hasJoinedRef.current = false;
      joinStream();
    };

    const onHistory = (data: LiveChatMessage[] | { messages: LiveChatMessage[] }) => {
      const msgs = Array.isArray(data) ? data : (data.messages ?? []);
      setMessages(msgs);
    };

    const MAX_MESSAGES = 200;
    const onMessage = (msg: LiveChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });
    };

    const onViewerCount = (data: { streamId: string; count: number }) => {
      if (data.streamId !== streamId) return;
      setViewerCount(data.count);
    };

    const onTip = (tip: LiveTip) => {
      setLatestTip(tip);
    };

    // Raid handler — broadcast to all viewers in the source stream room
    const onRaid = (data: LiveRaidEvent) => {
      setRaidEvent(data);
      // Auto-dismiss after 30s if the viewer hasn't acted
      if (raidDismissTimerRef.current) clearTimeout(raidDismissTimerRef.current);
      raidDismissTimerRef.current = setTimeout(() => {
        setRaidEvent((cur) => (cur === data ? null : cur));
        raidDismissTimerRef.current = null;
      }, 30_000);
    };

    socket.on("connect", onConnectForStream);
    socket.on("live:history", onHistory);
    socket.on("live:message", onMessage);
    socket.on("live:viewer_count", onViewerCount);
    socket.on("live:tip", onTip);
    socket.on("live:raid", onRaid);

    // Join immediately if already connected
    if (socket.connected) {
      joinStream();
    }

    return () => {
      if (joinedStreamRef.current) {
        socket.emit("live:leave", { streamId: joinedStreamRef.current });
        joinedStreamRef.current = null;
      }
      // SOCK-H6: reset join guard on cleanup so re-mounting can join cleanly
      hasJoinedRef.current = false;
      if (raidDismissTimerRef.current) clearTimeout(raidDismissTimerRef.current);
      socket.off("connect", onConnectForStream);
      socket.off("live:history", onHistory);
      socket.off("live:message", onMessage);
      socket.off("live:viewer_count", onViewerCount);
      socket.off("live:tip", onTip);
      socket.off("live:raid", onRaid);
    };
  }, [streamId]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!streamId || !content.trim()) return;
      const socket = connectSocket();
      if (!socket.connected) return;
      // Re-join if not already joined (handles reconnect edge case)
      if (joinedStreamRef.current !== streamId) {
        socket.emit("live:join", { streamId });
        joinedStreamRef.current = streamId;
      }
      socket.emit("live:message", { streamId, content: content.trim() });
    },
    [streamId]
  );

  const dismissRaid = useCallback(() => {
    setRaidEvent(null);
  }, []);

  const emitRaid = useCallback((sid: string, targetChannelRef: string) => {
    const socket = connectSocket();
    if (!socket.connected) return;
    socket.emit("live:raid:initiate", { streamId: sid, targetChannelRef });
  }, []);

  return {
    messages,
    viewerCount,
    isConnected,
    reconnecting,
    sendMessage,
    latestTip,
    walletBalance,
    socketBalanceReceived,
    setWalletBalance,
    socketError,
    raidEvent,
    dismissRaid,
    tipGoal,
    tipAlert,
    chatBanned,
  };
}
