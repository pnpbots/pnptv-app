import { useState, useEffect, useRef, useCallback } from "react";
import { connectSocket } from "@/lib/socket";

export interface LiveChatMessage {
  id: number;
  streamId: string;
  userId: string;
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

interface UseLiveSocketResult {
  messages: LiveChatMessage[];
  viewerCount: number;
  isConnected: boolean;
  sendMessage: (content: string) => void;
  latestTip: LiveTip | null;
  walletBalance: number | null;
  setWalletBalance: (b: number) => void;
  socketError: string | null;
}

export function useLiveSocket(streamId: string | null): UseLiveSocketResult {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [latestTip, setLatestTip] = useState<LiveTip | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  // Tracks the currently joined streamId so we can emit live:leave on change/unmount
  const joinedStreamRef = useRef<string | null>(null);

  // ── Always-on: personal event bus (wallet updates, connection state) ─────────
  // Runs once on mount — connects the socket regardless of streamId so that
  // wallet:updated events are received even on non-stream pages (e.g. Live lobby).
  useEffect(() => {
    const socket = connectSocket();

    const onWalletUpdated = (data: { balance: number }) => {
      setWalletBalance(data.balance);
    };
    const onConnect = () => {
      setIsConnected(true);
      setSocketError(null);
    };
    const onDisconnect = () => {
      setIsConnected(false);
      joinedStreamRef.current = null;
    };
    const onError = () => {
      setIsConnected(false);
    };
    const onLiveError = (data: { message: string }) => {
      setSocketError(data.message);
      setTimeout(() => setSocketError(null), 5000);
    };

    if (socket.connected) {
      setIsConnected(true);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onError);
    socket.on("wallet:updated", onWalletUpdated);
    socket.on("live:error", onLiveError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onError);
      socket.off("wallet:updated", onWalletUpdated);
      socket.off("live:error", onLiveError);
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
      setMessages([]);
      setViewerCount(0);
      return;
    }

    const socket = connectSocket();

    const joinStream = () => {
      socket.emit("live:join", { streamId });
      joinedStreamRef.current = streamId;
    };

    const onConnectForStream = () => {
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

    socket.on("connect", onConnectForStream);
    socket.on("live:history", onHistory);
    socket.on("live:message", onMessage);
    socket.on("live:viewer_count", onViewerCount);
    socket.on("live:tip", onTip);

    // Leave previous stream if switching mid-session
    if (joinedStreamRef.current && joinedStreamRef.current !== streamId) {
      socket.emit("live:leave", { streamId: joinedStreamRef.current });
      joinedStreamRef.current = null;
    }

    // Join immediately if already connected
    if (socket.connected) {
      joinStream();
    }

    setMessages([]);
    setViewerCount(0);

    return () => {
      if (joinedStreamRef.current) {
        socket.emit("live:leave", { streamId: joinedStreamRef.current });
        joinedStreamRef.current = null;
      }
      socket.off("connect", onConnectForStream);
      socket.off("live:history", onHistory);
      socket.off("live:message", onMessage);
      socket.off("live:viewer_count", onViewerCount);
      socket.off("live:tip", onTip);
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

  return { messages, viewerCount, isConnected, sendMessage, latestTip, walletBalance, setWalletBalance, socketError };
}
