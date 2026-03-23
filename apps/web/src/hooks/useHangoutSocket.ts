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

export interface ReadReceiptEntry {
  name: string;
  photoUrl: string;
  lastReadAt: string;
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
  userId: string | undefined,
  matrixRoomId?: string | null
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

  // Feature 4: Read receipts keyed by userId
  const [readReceipts, setReadReceipts] = useState<Map<string, ReadReceiptEntry>>(new Map());

  // Typing is handled by Element Web iframe — no parent-side Matrix SDK needed

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
      setReadReceipts(new Map());
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
    setReadReceipts(new Map());

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

    // Server sends { call: { id, roomName, createdAt, ... }, startedBy: { ... } }
    const onCallStarted = (data: {
      call?: { id: string; roomName: string; createdAt?: string };
      callId?: string;
      roomName?: string;
      createdAt?: string;
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
      // Feature 2: capture timestamp — prefer nested call object, fall back to top-level
      const ts = data.call?.createdAt ?? data.createdAt ?? null;
      setCallStartedAt(ts);
      // Reset participants when a new call starts
      setCallParticipants([]);
      setScreenShareUser(null);
    };

    const onCallEnded = (data?: { callId?: string; reason?: string }) => {
      setCallState((prev) => {
        // Only reset if this matches our known call (or no callId provided)
        if (data?.callId && prev.callId && prev.callId !== data.callId) return prev;
        return { ...EMPTY_CALL, endReason: data?.reason || null };
      });
      // Clear call-scoped state
      setCallStartedAt(null);
      setCallParticipants([]);
      setScreenShareUser(null);
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

    const onCallJoined = (data: {
      participantCount?: number;
      user?: CallParticipant;
    }) => {
      setCallState((prev) => ({
        ...prev,
        participantCount: data.participantCount ?? prev.participantCount + 1,
      }));
      // Feature 3: add joiner to rich participant list if server provides user info
      if (data.user?.userId) {
        const joiner: CallParticipant = {
          userId: String(data.user.userId).slice(0, 64),
          name: String(data.user.name || "").slice(0, 100),
          photoUrl: String(data.user.photoUrl || ""),
        };
        setCallParticipants((prev) => {
          // Avoid duplicates
          if (prev.some((p) => p.userId === joiner.userId)) return prev;
          return [...prev, joiner];
        });
      }
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

    // Feature 4: Incoming read receipt from another user
    const onRead = (data: {
      userId: string;
      name: string;
      photoUrl: string;
      lastReadAt: string;
    }) => {
      if (!data.userId || data.userId === userId) return;
      setReadReceipts((prev) => {
        const next = new Map(prev);
        next.set(String(data.userId).slice(0, 64), {
          name: String(data.name || "").slice(0, 100),
          photoUrl: String(data.photoUrl || ""),
          lastReadAt: String(data.lastReadAt),
        });
        return next;
      });
    };

    // Register ALL listeners BEFORE emitting join
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("hangout:typing", onTyping);
    socket.on("hangout:presence", onPresence);
    socket.on("hangout:call:active", onCallActive);
    socket.on("hangout:call:started", onCallStarted);
    socket.on("hangout:call:ended", onCallEnded);
    socket.on("hangout:call:joined", onCallJoined);
    socket.on("hangout:call:participant:left", onParticipantLeft);
    socket.on("hangout:call:participants", onCallParticipants);
    socket.on("hangout:call:screenshare", onScreenShare);
    socket.on("hangout:read", onRead);

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
      socket.off("hangout:call:started", onCallStarted);
      socket.off("hangout:call:ended", onCallEnded);
      socket.off("hangout:call:joined", onCallJoined);
      socket.off("hangout:call:participant:left", onParticipantLeft);
      socket.off("hangout:call:participants", onCallParticipants);
      socket.off("hangout:call:screenshare", onScreenShare);
      socket.off("hangout:read", onRead);

      // Clear typing timers and map
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
      typingMap.current.clear();
      setTypingUsers([]);
      setOnlineMembers([]);
    };
  }, [groupId, userId]);

  // Emit typing indicator via Socket.IO (debounced 2s).
  // Matrix typing is handled natively by Element Web iframe.
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

  // Typing users from Socket.IO (Matrix typing handled by Element Web)
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
    // Feature 4
    readReceipts,
    emitMarkRead,
  };
}
