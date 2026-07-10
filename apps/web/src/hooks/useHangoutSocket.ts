import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { connectSocket } from "@/lib/socket";

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

export interface CallParticipant {
  userId: string;
  name: string;
  photoUrl: string;
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
  // Internal map tracks typing state by userId to prevent collisions when two
  // users share the same first name.  The exported typingUsers is derived from
  // the map's values so the external interface stays as string[].
  const typingMap = useRef<Map<string, string>>(new Map());
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [callState, setCallState] = useState<CallState>(EMPTY_CALL);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineMembers, setOnlineMembers] = useState<OnlineMember[]>([]);


  // Feature 1: Screen share state — name of the user currently sharing, or null
  const [screenShareUser, setScreenShareUser] = useState<string | null>(null);

  // Feature 2: Call started timestamp (ISO string)
  const [callStartedAt, setCallStartedAt] = useState<string | null>(null);

  // Feature 3: Rich participant list (separate from the legacy string[] in CallState)
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([]);

  // Read receipts: map of userId → lastReadMessageId
  const [readReceipts, setReadReceipts] = useState<Record<string, number>>({});

  // Refs for debouncing and cleanup
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingEmit = useRef(0);

  useEffect(() => {
    if (!groupId) {
      typingMap.current.clear();
      setTypingUsers([]);
      setCallState(EMPTY_CALL);
      setOnlineMembers([]);
      setScreenShareUser(null);
      setCallStartedAt(null);
      setCallParticipants([]);
      setReadReceipts({});
      return;
    }

    // Reset state before attaching to new group
    typingMap.current.clear();
    setTypingUsers([]);
    setCallState(EMPTY_CALL);
    setOnlineMembers([]);
    setScreenShareUser(null);
    setCallStartedAt(null);
    setCallParticipants([]);
    setReadReceipts({});

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

    const onTyping = (data: { userId: string; firstName: string }) => {
      if (data.userId === userId) return; // Ignore own typing
      // Cap firstName to 50 chars to prevent oversized display strings from
      // untrusted socket data.
      const safeName = (data.firstName || "Someone").slice(0, 50);

      // Deduplicate by userId (not by name) so two users with the same first
      // name are both tracked correctly.
      typingMap.current.set(data.userId, safeName);
      setTypingUsers(Array.from(typingMap.current.values()));

      // Clear after 3s of no further typing events from this user
      const existing = typingTimers.current.get(data.userId);
      if (existing) clearTimeout(existing);
      typingTimers.current.set(
        data.userId,
        setTimeout(() => {
          typingMap.current.delete(data.userId);
          setTypingUsers(Array.from(typingMap.current.values()));
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
      createdAt?: string;
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
      // Feature 2: capture timestamp if provided
      if (data.createdAt) {
        setCallStartedAt(data.createdAt);
      }
    };

    // Feature 3: Server sends full participant snapshot
    const onCallParticipants = (data: { participants: CallParticipant[] }) => {
      if (!Array.isArray(data.participants)) return;
      setCallParticipants(
        data.participants.map((p) => ({
          userId: String(p.userId).slice(0, 64),
          name: String(p.name || "").slice(0, 100),
          photoUrl: String(p.photoUrl || ""),
        }))
      );
    };

    const onParticipantLeft = (data: {
      participantCount?: number;
      user?: { userId: string };
    }) => {
      setCallState((prev) => ({
        ...prev,
        participantCount: data.participantCount ?? Math.max(0, prev.participantCount - 1),
      }));
      // Feature 3: remove leaver from rich participant list
      if (data.user?.userId) {
        const leftId = String(data.user.userId);
        setCallParticipants((prev) => prev.filter((p) => p.userId !== leftId));
        // Feature 1: clear screen share if the leaver was sharing
        setScreenShareUser((prev) => (prev === leftId ? null : prev));
      }
    };

    // Feature 1: Screen share state
    const onScreenShare = (data: { userId: string; sharing: boolean }) => {
      if (!data.userId) return;
      setScreenShareUser(data.sharing ? String(data.userId).slice(0, 64) : null);
    };

    // Read receipts: another user read up to a certain message (per-message)
    const onReadUpdate = (data: { userId: number; lastReadMessageId: number }) => {
      if (!data.userId || !data.lastReadMessageId) return;
      setReadReceipts((prev) => ({ ...prev, [String(data.userId)]: data.lastReadMessageId }));
    };

    // Read receipts: another user marked the whole group as read (group-level)
    const onGroupRead = (data: { userId: string; lastReadMessageId: number | null }) => {
      if (!data.userId || !data.lastReadMessageId) return;
      setReadReceipts((prev) => ({ ...prev, [String(data.userId)]: data.lastReadMessageId! }));
    };

    // Register ALL listeners BEFORE emitting join
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("hangout:typing", onTyping);
    socket.on("hangout:presence", onPresence);
    socket.on("hangout:call:active", onCallActive);
    socket.on("hangout:call:participant-left", onParticipantLeft);
    socket.on("hangout:call:participants", onCallParticipants);
    socket.on("hangout:call:screenshare", onScreenShare);
    socket.on("hangout:read:update", onReadUpdate);
    socket.on("hangout:read", onGroupRead);

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
      socket.off("hangout:typing", onTyping);
      socket.off("hangout:presence", onPresence);
      socket.off("hangout:call:active", onCallActive);
      socket.off("hangout:call:participant-left", onParticipantLeft);
      socket.off("hangout:call:participants", onCallParticipants);
      socket.off("hangout:call:screenshare", onScreenShare);
      socket.off("hangout:read:update", onReadUpdate);
      socket.off("hangout:read", onGroupRead);

      // Clear typing timers and map
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
      typingMap.current.clear();
      setTypingUsers([]);
      setOnlineMembers([]);
    };
  }, [groupId, userId]);

  // Emit typing indicator via Socket.IO (debounced 2s).
  const emitTyping = useCallback(
    (isRecording?: boolean) => {
      if (!groupId) return;
      if (isRecording) return;
      const now = Date.now();
      if (now - lastTypingEmit.current < 2000) return;
      lastTypingEmit.current = now;

      const socket = connectSocket();
      socket.emit("hangout:typing", { groupId });
    },
    [groupId]
  );

  const inviteToCall = useCallback(
    (targetUserId: string) => {
      if (!groupId) return;
      const socket = connectSocket();
      socket.emit("hangout:invite", { groupId, targetUserId });
    },
    [groupId]
  );

  // Feature 4: Emit mark-read so the server can broadcast to other participants
  const emitMarkRead = useCallback(() => {
    if (!groupId || !userId) return;
    const socket = connectSocket();
    socket.emit("hangout:mark-read", { groupId });
  }, [groupId, userId]);

  // Emit message edit via Socket.IO
  const emitEditMessage = useCallback(
    (messageId: number, content: string) => {
      if (!groupId) return;
      const socket = connectSocket();
      socket.emit("hangout:message:edit", { groupId, messageId, content });
    },
    [groupId]
  );

  // Emit message delete via Socket.IO
  const emitDeleteMessage = useCallback(
    (messageId: number, forAll: boolean = false) => {
      if (!groupId) return;
      const socket = connectSocket();
      socket.emit("hangout:message:delete", { groupId, messageId, forAll });
    },
    [groupId]
  );

  // Emit reaction toggle via Socket.IO
  const emitReaction = useCallback(
    (messageId: number, emoji: string) => {
      if (!groupId) return;
      const socket = connectSocket();
      socket.emit("hangout:reaction:toggle", { groupId, messageId, emoji });
    },
    [groupId]
  );

  // Emit read receipt via Socket.IO
  const emitReadMessage = useCallback(
    (messageId: number) => {
      if (!groupId || !userId) return;
      const socket = connectSocket();
      socket.emit("hangout:read:message", { groupId, messageId });
    },
    [groupId, userId]
  );

  const mergedTypingUsers = useMemo(() => typingUsers, [typingUsers]);

  return {
    emitTyping,
    typingUsers: mergedTypingUsers,
    callState,
    isConnected,
    onlineMembers,
    inviteToCall,
    // Feature 1
    screenShareUser,
    // Feature 2
    callStartedAt,
    // Feature 3
    callParticipants,
    emitMarkRead,
    emitEditMessage,
    emitDeleteMessage,
    emitReaction,
    emitReadMessage,
    readReceipts,
  };
}
