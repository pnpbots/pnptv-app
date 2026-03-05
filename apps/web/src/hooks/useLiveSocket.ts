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
}

interface UseLiveSocketResult {
  messages: LiveChatMessage[];
  viewerCount: number;
  isConnected: boolean;
  sendMessage: (content: string) => void;
  latestTip: LiveTip | null;
}

export function useLiveSocket(streamId: string | null): UseLiveSocketResult {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [latestTip, setLatestTip] = useState<LiveTip | null>(null);

  // Tracks the currently joined streamId so we can emit live:leave on change/unmount
  const joinedStreamRef = useRef<string | null>(null);

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

    const onConnect = () => {
      setIsConnected(true);
      socket.emit("live:join", { streamId });
      joinedStreamRef.current = streamId;
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onError = () => {
      setIsConnected(false);
    };

    const onHistory = (data: LiveChatMessage[] | { messages: LiveChatMessage[] }) => {
      const msgs = Array.isArray(data) ? data : (data.messages ?? []);
      setMessages(msgs);
    };

    const onMessage = (msg: LiveChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const onViewerCount = (data: { streamId: string; count: number }) => {
      if (data.streamId !== streamId) return;
      setViewerCount(data.count);
    };

    const onTip = (tip: LiveTip) => {
      setLatestTip(tip);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onError);
    socket.on("live:history", onHistory);
    socket.on("live:message", onMessage);
    socket.on("live:viewer_count", onViewerCount);
    socket.on("live:tip", onTip);

    // Leave previous stream if switching mid-session
    if (joinedStreamRef.current && joinedStreamRef.current !== streamId) {
      socket.emit("live:leave", { streamId: joinedStreamRef.current });
    }

    if (socket.connected) {
      setIsConnected(true);
      socket.emit("live:join", { streamId });
      joinedStreamRef.current = streamId;
    }

    setMessages([]);
    setViewerCount(0);

    return () => {
      if (joinedStreamRef.current) {
        socket.emit("live:leave", { streamId: joinedStreamRef.current });
        joinedStreamRef.current = null;
      }
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onError);
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
      socket.emit("live:message", { streamId, content: content.trim() });
    },
    [streamId]
  );

  return { messages, viewerCount, isConnected, sendMessage, latestTip };
}
