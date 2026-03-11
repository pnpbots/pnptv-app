import { useState, useEffect, useRef, useCallback } from "react";
import { connectSocket } from "@/lib/socket";
import { getGroupMessages, type GroupMessage } from "@/lib/api";

interface OnlineMember {
  userId: string;
  name: string;
  photoUrl: string | null;
}

interface CallState {
  isActive: boolean;
  participantCount: number;
  participants: string[];
  callId: string | null;
  roomName: string | null;
  endReason: string | null;
}

const EMPTY_CALL: CallState = {
  isActive: false,
  participantCount: 0,
  participants: [],
  callId: null,
  roomName: null,
  endReason: null,
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
  const [onlineMembers, setOnlineMembers] = useState<OnlineMember[]>([]);

  // Refs for debouncing and cleanup
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingEmit = useRef(0);
  const messagesRef = useRef<GroupMessage[]>([]);
  const isLoadingMoreRef = useRef(false);

  // Keep messagesRef in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
      setOnlineMembers([]);
      return;
    }

    // Reset state before attaching to new group (prevents stale messages flash)
    setMessages([]);
    setTypingUsers([]);
    setCallState(EMPTY_CALL);
    setHasMore(true);
    setOnlineMembers([]);

    const socket = connectSocket();

    // --- Define all handlers FIRST, register listeners BEFORE emitting join ---

    const onConnect = () => {
      setIsConnected(true);
      // (Re)join hangout room on connect/reconnect — only if userId is known
      if (userId) {
        socket.emit("hangout:join", { groupId });
      }
    };
    const onDisconnect = () => setIsConnected(false);

    const onHistory = (history: GroupMessage[]) => {
      setMessages(dedupeMessages(history));
      setHasMore(history.length >= 50);
    };

    const onMessage = (msg: GroupMessage) => {
      // Accept messages for this room; also accept if room field is absent (server-side routing)
      if (msg.room && msg.room !== `hangout:${groupId}`) return;
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

    const onPresence = (data: { groupId: number; online: OnlineMember[] }) => {
      if (data.groupId !== groupId) return;
      setOnlineMembers(data.online);
    };

    const ROOM_NAME_PATTERN = /^[\w\-\/]+$/;

    const onCallActive = (data: {
      callId: string;
      roomName: string;
      participantCount: number;
    }) => {
      if (!ROOM_NAME_PATTERN.test(data.roomName ?? "")) return;
      setCallState({
        isActive: true,
        participantCount: data.participantCount || 0,
        participants: [],
        callId: data.callId,
        roomName: data.roomName,
        endReason: null,
      });
    };

    // Server sends { call: { id, roomName, ... }, startedBy: { ... } }
    const onCallStarted = (data: {
      call?: { id: string; roomName: string };
      callId?: string;
      roomName?: string;
    }) => {
      const roomName = data.call?.roomName ?? data.roomName ?? null;
      if (roomName && !ROOM_NAME_PATTERN.test(roomName)) return;
      setCallState({
        isActive: true,
        participantCount: 0,
        participants: [],
        callId: data.call?.id ?? data.callId ?? null,
        roomName,
        endReason: null,
      });
    };

    const onCallEnded = (data?: { callId?: string; reason?: string }) => {
      setCallState((prev) => {
        // Only reset if this matches our known call (or no callId provided)
        if (data?.callId && prev.callId && prev.callId !== data.callId) return prev;
        return { ...EMPTY_CALL, endReason: data?.reason || null };
      });
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

    // Register ALL listeners BEFORE emitting join
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("hangout:history", onHistory);
    socket.on("chat:message", onMessage);
    socket.on("hangout:typing", onTyping);
    socket.on("hangout:presence", onPresence);
    socket.on("hangout:call:active", onCallActive);
    socket.on("hangout:call:started", onCallStarted);
    socket.on("hangout:call:ended", onCallEnded);
    socket.on("hangout:call:joined", onCallJoined);
    socket.on("hangout:call:participant:left", onParticipantLeft);

    // Now emit join — if already connected, emit directly; otherwise onConnect handles it
    // Guard behind userId: an unauthenticated socket must not join a private room
    if (socket.connected) {
      setIsConnected(true);
      if (userId) {
        socket.emit("hangout:join", { groupId });
      }
    }

    return () => {
      socket.emit("hangout:leave", { groupId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("hangout:history", onHistory);
      socket.off("chat:message", onMessage);
      socket.off("hangout:typing", onTyping);
      socket.off("hangout:presence", onPresence);
      socket.off("hangout:call:active", onCallActive);
      socket.off("hangout:call:started", onCallStarted);
      socket.off("hangout:call:ended", onCallEnded);
      socket.off("hangout:call:joined", onCallJoined);
      socket.off("hangout:call:participant:left", onParticipantLeft);

      // Clear typing timers
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
      setTypingUsers([]);
      setOnlineMembers([]);
    };
  }, [groupId, userId, dedupeMessages]);

  // Send message via socket
  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim().slice(0, 2000);
      if (!groupId || !trimmed) return;
      const socket = connectSocket();
      socket.emit("hangout:message", { groupId, content: trimmed });
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
  // Uses refs to avoid stale closures and prevent multiple concurrent calls
  const loadOlderMessages = useCallback(async () => {
    if (!groupId || isLoadingMoreRef.current || !hasMore) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const oldest = messagesRef.current[0];
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
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [groupId, hasMore, dedupeMessages]);

  const inviteToCall = useCallback(
    (targetUserId: string) => {
      if (!groupId) return;
      const socket = connectSocket();
      socket.emit("hangout:invite", { groupId, targetUserId });
    },
    [groupId]
  );

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
    onlineMembers,
    inviteToCall,
  };
}
