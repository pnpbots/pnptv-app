import { useState, useEffect, useRef, useCallback } from "react";
import { connectSocket } from "@/lib/socket";
import { getGroupMessages, type GroupMessage } from "@/lib/api";

interface CallState {
  isActive: boolean;
  participantCount: number;
  participants: string[];
  callId: string | null;
  roomName: string | null;
}

const EMPTY_CALL: CallState = {
  isActive: false,
  participantCount: 0,
  participants: [],
  callId: null,
  roomName: null,
};

export function useHangoutSocket(
  groupId: number | null,
  userId: string | undefined
) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [callState, setCallState] = useState<CallState>(EMPTY_CALL);
  const [isConnected, setIsConnected] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Refs for debouncing and cleanup
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingEmit = useRef(0);
  const prevGroupId = useRef<number | null>(null);

  // Deduplicate messages by id
  const dedupeMessages = useCallback((msgs: GroupMessage[]): GroupMessage[] => {
    const seen = new Set<number>();
    return msgs.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, []);

  useEffect(() => {
    if (!groupId) {
      setMessages([]);
      setTypingUsers([]);
      setCallState(EMPTY_CALL);
      setHasMore(true);
      return;
    }

    const socket = connectSocket();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    // Join hangout room
    socket.emit("hangout:join", { groupId });

    const onHistory = (history: GroupMessage[]) => {
      setMessages(dedupeMessages(history));
      setHasMore(history.length >= 50);
    };

    const onMessage = (msg: GroupMessage) => {
      // Only accept messages for this hangout room
      if (msg.room !== `hangout:${groupId}`) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const onTyping = (data: { userId: string; firstName: string }) => {
      if (data.userId === userId) return; // Ignore own typing
      const name = data.firstName;

      setTypingUsers((prev) => (prev.includes(name) ? prev : [...prev, name]));

      // Clear after 3s
      const existing = typingTimers.current.get(data.userId);
      if (existing) clearTimeout(existing);
      typingTimers.current.set(
        data.userId,
        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((n) => n !== name));
          typingTimers.current.delete(data.userId);
        }, 3000)
      );
    };

    const onCallActive = (data: {
      callId: string;
      roomName: string;
      participantCount: number;
    }) => {
      setCallState({
        isActive: true,
        participantCount: data.participantCount || 0,
        participants: [],
        callId: data.callId,
        roomName: data.roomName,
      });
    };

    const onCallStarted = (data: { callId: string; roomName: string }) => {
      setCallState((prev) => ({
        ...prev,
        isActive: true,
        callId: data.callId,
        roomName: data.roomName || prev.roomName,
      }));
    };

    const onCallEnded = () => {
      setCallState(EMPTY_CALL);
    };

    const onCallJoined = (data: { participantCount?: number }) => {
      setCallState((prev) => ({
        ...prev,
        participantCount: data.participantCount ?? prev.participantCount + 1,
      }));
    };

    const onParticipantLeft = (data: { participantCount?: number }) => {
      setCallState((prev) => ({
        ...prev,
        participantCount: data.participantCount ?? Math.max(0, prev.participantCount - 1),
      }));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("hangout:history", onHistory);
    socket.on("chat:message", onMessage);
    socket.on("hangout:typing", onTyping);
    socket.on("hangout:call:active", onCallActive);
    socket.on("hangout:call:started", onCallStarted);
    socket.on("hangout:call:ended", onCallEnded);
    socket.on("hangout:call:joined", onCallJoined);
    socket.on("hangout:call:participant:left", onParticipantLeft);

    if (socket.connected) setIsConnected(true);

    prevGroupId.current = groupId;

    return () => {
      socket.emit("hangout:leave", { groupId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("hangout:history", onHistory);
      socket.off("chat:message", onMessage);
      socket.off("hangout:typing", onTyping);
      socket.off("hangout:call:active", onCallActive);
      socket.off("hangout:call:started", onCallStarted);
      socket.off("hangout:call:ended", onCallEnded);
      socket.off("hangout:call:joined", onCallJoined);
      socket.off("hangout:call:participant:left", onParticipantLeft);

      // Clear typing timers
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
      setTypingUsers([]);
    };
  }, [groupId, userId, dedupeMessages]);

  // Send message via socket
  const sendMessage = useCallback(
    (content: string) => {
      if (!groupId || !content.trim()) return;
      const socket = connectSocket();
      socket.emit("hangout:message", { groupId, content: content.trim() });
    },
    [groupId]
  );

  // Emit typing indicator (debounced 2s)
  const emitTyping = useCallback(() => {
    if (!groupId) return;
    const now = Date.now();
    if (now - lastTypingEmit.current < 2000) return;
    lastTypingEmit.current = now;
    const socket = connectSocket();
    socket.emit("hangout:typing", { groupId });
  }, [groupId]);

  // Load older messages via HTTP (for infinite scroll)
  const loadOlderMessages = useCallback(async () => {
    if (!groupId || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const oldest = messages[0];
      const cursor = oldest?.created_at;
      const data = await getGroupMessages(groupId, cursor);
      const older = data.messages || [];
      if (older.length < 50) setHasMore(false);
      if (older.length > 0) {
        setMessages((prev) => dedupeMessages([...older, ...prev]));
      }
    } catch {
      // silent
    } finally {
      setIsLoadingMore(false);
    }
  }, [groupId, isLoadingMore, hasMore, messages, dedupeMessages]);

  return {
    messages,
    sendMessage,
    emitTyping,
    typingUsers,
    callState,
    isConnected,
    loadOlderMessages,
    hasMore,
    isLoadingMore,
  };
}
