import React, { useState, useEffect, useRef, useCallback } from "react";
import { connectSocket } from "@/lib/socket";
import { type GroupMessage } from "@/lib/api";
import { sendTyping as matrixSendTyping, useRoomTyping } from "@/hooks/useMatrix";

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

  // Matrix typing users (merged below)
  const { typingUsers: matrixTypingUsers } = useRoomTyping(matrixRoomId ?? null);

  // Refs for debouncing and cleanup
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingEmit = useRef(0);

  useEffect(() => {
    if (!groupId) {
      typingMap.current.clear();
      setTypingUsers([]);
      setCallState(EMPTY_CALL);
      setOnlineMembers([]);
      return;
    }

    // Reset state before attaching to new group
    typingMap.current.clear();
    setTypingUsers([]);
    setCallState(EMPTY_CALL);
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
      socket.off("hangout:typing", onTyping);
      socket.off("hangout:presence", onPresence);
      socket.off("hangout:call:active", onCallActive);
      socket.off("hangout:call:started", onCallStarted);
      socket.off("hangout:call:ended", onCallEnded);
      socket.off("hangout:call:joined", onCallJoined);
      socket.off("hangout:call:participant:left", onParticipantLeft);

      // Clear typing timers and map
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
      typingMap.current.clear();
      setTypingUsers([]);
      setOnlineMembers([]);
    };
  }, [groupId, userId]);

  // Emit typing indicator (debounced 2s) — tries Matrix first, always emits via socket
  const emitTyping = useCallback(() => {
    if (!groupId) return;
    const now = Date.now();
    if (now - lastTypingEmit.current < 2000) return;
    lastTypingEmit.current = now;

    // Matrix typing (fire-and-forget)
    if (matrixRoomId) {
      matrixSendTyping(matrixRoomId, true, 3000).catch(() => {});
    }

    const socket = connectSocket();
    socket.emit("hangout:typing", { groupId });
  }, [groupId, matrixRoomId]);

  const inviteToCall = useCallback(
    (targetUserId: string) => {
      if (!groupId) return;
      const socket = connectSocket();
      socket.emit("hangout:invite", { groupId, targetUserId });
    },
    [groupId]
  );

  // Merge socket + Matrix typing users (deduplicate by name)
  const mergedTypingUsers = React.useMemo(() => {
    const names = new Set(typingUsers);
    for (const mu of matrixTypingUsers) {
      names.add(mu.displayName);
    }
    return Array.from(names);
  }, [typingUsers, matrixTypingUsers]);

  return {
    emitTyping,
    typingUsers: mergedTypingUsers,
    callState,
    isConnected,
    onlineMembers,
    inviteToCall,
  };
}
