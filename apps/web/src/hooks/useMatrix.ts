import { useState, useEffect, useCallback, useRef } from "react";
import {
  createClient,
  EventType,
  type MatrixClient,
  type MatrixEvent,
  RoomEvent,
  RoomMemberEvent,
  ClientEvent,
  SyncState,
  type ISendEventResponse,
} from "matrix-js-sdk";
import { getMatrixToken } from "@/lib/api";

// ── Singleton Matrix client — shared across all hook instances ────────────────

let matrixClient: MatrixClient | null = null;
let initPromise: Promise<MatrixClient> | null = null;

/** Reset the singleton so the next initMatrix() call fetches a fresh token. */
function resetMatrixClient() {
  if (matrixClient) {
    try { matrixClient.stopClient(); } catch { /* ignore */ }
  }
  matrixClient = null;
  initPromise = null;
}

async function initMatrix(): Promise<MatrixClient> {
  if (matrixClient) return matrixClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { matrixUserId, accessToken, homeserverUrl } = await getMatrixToken();

    const client = createClient({
      baseUrl: homeserverUrl,
      accessToken,
      userId: matrixUserId,
    });

    // Auto-reset on auth failure so next call fetches a fresh token
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on(ClientEvent.Sync, (state: SyncState, _prev: SyncState | null, data?: any) => {
      if (state === SyncState.Error && (data?.error?.httpStatus === 401 || data?.error?.errcode === "M_UNKNOWN_TOKEN")) {
        console.warn("[Matrix] Token expired (401), resetting client for re-auth");
        resetMatrixClient();
      }
    });

    await client.startClient({ initialSyncLimit: 20 });
    matrixClient = client;
    return client;
  })();

  try {
    return await initPromise;
  } catch (err) {
    // Reset so next call retries cleanly
    initPromise = null;
    throw err;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatrixMessage {
  eventId: string;
  roomId: string;
  senderId: string;
  body: string;
  timestamp: number;
  isMine: boolean;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "file";
  mediaMime?: string;
  /** Reply-to info extracted from m.relates_to */
  replyToEventId?: string;
  replyToSenderId?: string;
  replyToBody?: string;
}

function eventToMessage(event: MatrixEvent, myUserId: string, roomTimeline?: MatrixEvent[]): MatrixMessage | null {
  if (event.getType() !== "m.room.message") return null;
  const content = event.getContent();
  const msgtype = content.msgtype;

  // Extract reply-to info from m.relates_to
  const relatesTo = content["m.relates_to"];
  const replyToEventId = relatesTo?.["m.in_reply_to"]?.event_id as string | undefined;
  let replyToSenderId: string | undefined;
  let replyToBody: string | undefined;

  if (replyToEventId && roomTimeline) {
    const replyEvent = roomTimeline.find((e) => e.getId() === replyToEventId);
    if (replyEvent) {
      replyToSenderId = replyEvent.getSender() ?? undefined;
      replyToBody = replyEvent.getContent()?.body ?? undefined;
    }
  }

  // Strip Matrix reply fallback from body (lines starting with "> ")
  let body = content.body ?? "";
  if (replyToEventId && typeof body === "string" && body.startsWith("> ")) {
    const lines = body.split("\n");
    const endIdx = lines.findIndex((l: string) => !l.startsWith("> ") && l !== "");
    if (endIdx > 0) body = lines.slice(endIdx).join("\n").trim();
  }

  const base = {
    eventId: event.getId() ?? `${event.getSender()}-${event.getTs()}`,
    roomId: event.getRoomId() ?? "",
    senderId: event.getSender() ?? "",
    timestamp: event.getTs(),
    isMine: event.getSender() === myUserId,
    replyToEventId,
    replyToSenderId,
    replyToBody,
  };

  if (msgtype === "m.text" && typeof body === "string") {
    return { ...base, body };
  }

  if (msgtype === "m.image" || msgtype === "m.video" || msgtype === "m.file") {
    const mediaType = msgtype === "m.image" ? "image" : msgtype === "m.video" ? "video" : "file";
    const url = content.url ?? content.external_url ?? "";
    return {
      ...base,
      body: body || "",
      mediaUrl: url,
      mediaType,
      mediaMime: content.info?.mimetype,
    };
  }

  return null;
}

// ── useRoomMessages — live-updating message list for a single room ─────────────

export function useRoomMessages(roomId: string | null): {
  messages: MatrixMessage[];
  loading: boolean;
} {
  const [messages, setMessages] = useState<MatrixMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const clientRef = useRef<MatrixClient | null>(null);

  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        const client = await initMatrix();
        if (cancelled) return;
        clientRef.current = client;
        const myId = client.getUserId() ?? "";

        // Load timeline from cached room
        const hydrateFromRoom = (): boolean => {
          const room = client.getRoom(roomId);
          if (!room) return false;
          const timeline = room.getLiveTimeline().getEvents();
          const msgs = timeline
            .map((ev) => eventToMessage(ev, myId, timeline))
            .filter((m): m is MatrixMessage => m !== null);
          if (!cancelled) setMessages(msgs);
          return true;
        };

        let roomFound = hydrateFromRoom();

        // If room is not in the client store yet (newly created / not yet synced),
        // try to join it explicitly and wait for it to appear via sync.
        if (!roomFound) {
          try {
            await client.joinRoom(roomId);
          } catch {
            // May already be joined — ignore
          }

          // Wait up to 10 seconds for the room to appear in sync
          roomFound = await new Promise<boolean>((resolve) => {
            if (cancelled) { resolve(false); return; }
            let settled = false;
            const settle = (val: boolean) => {
              if (settled) return;
              settled = true;
              client.off(ClientEvent.Sync, onSync);
              clearTimeout(timer);
              resolve(val);
            };

            const onSync = () => {
              if (client.getRoom(roomId)) {
                hydrateFromRoom();
                settle(true);
              }
            };

            client.on(ClientEvent.Sync, onSync);

            // Check immediately (may have appeared between joinRoom and listener)
            if (client.getRoom(roomId)) {
              hydrateFromRoom();
              settle(true);
              return;
            }

            const timer = setTimeout(() => settle(false), 10000);
          });
        }

        if (!cancelled) setLoading(false);

        // Listen for new events in this room
        const onRoomTimeline = (
          event: MatrixEvent,
          room: ReturnType<MatrixClient["getRoom"]> | undefined | null
        ) => {
          if (!room || room.roomId !== roomId) return;
          const timeline = room.getLiveTimeline().getEvents();
          const msg = eventToMessage(event, myId, timeline);
          if (msg) {
            setMessages((prev) => {
              // Deduplicate by eventId
              if (prev.some((m) => m.eventId === msg.eventId)) return prev;
              return [...prev, msg];
            });
          }
        };

        client.on(RoomEvent.Timeline, onRoomTimeline);

        return () => {
          client.off(RoomEvent.Timeline, onRoomTimeline);
        };
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    let cleanup: (() => void) | undefined;
    bootstrap().then((fn) => { cleanup = fn; }).catch(() => {});

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [roomId]);

  return { messages, loading };
}

// ── sendMatrixMessage — send a text message to a room ─────────────────────────

export async function sendMatrixMessage(
  roomId: string,
  text: string
): Promise<ISendEventResponse> {
  const attempt = async (): Promise<ISendEventResponse> => {
    const client = await initMatrix();
    try {
      return await client.sendTextMessage(roomId, text);
    } catch (err: unknown) {
      const errObj = err as { httpStatus?: number; errcode?: string };
      if (errObj.httpStatus === 403 || errObj.errcode === "M_FORBIDDEN") {
        console.warn("[Matrix] 403 on send, attempting rejoin...");
        try {
          await client.joinRoom(roomId);
          return await client.sendTextMessage(roomId, text);
        } catch { /* rejoin failed */ }
      }
      throw err;
    }
  };

  try {
    return await attempt();
  } catch (err: unknown) {
    const errObj = err as { httpStatus?: number; errcode?: string };
    if (errObj.httpStatus === 401 || errObj.errcode === "M_UNKNOWN_TOKEN") {
      console.warn("[Matrix] Token expired on sendMessage, re-authing...");
      resetMatrixClient();
      return await attempt();
    }
    throw err;
  }
}

// ── sendMatrixReply — send a reply to a specific event ────────────────────────

export async function sendMatrixReply(
  roomId: string,
  text: string,
  replyToEventId: string
): Promise<ISendEventResponse> {
  const client = await initMatrix();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.sendEvent(roomId, "m.room.message" as any, {
    msgtype: "m.text",
    body: text,
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: replyToEventId,
      },
    },
  });
}

// ── sendMatrixMediaMessage — send a media message (external URL) to a room ────

export async function sendMatrixMediaMessage(
  roomId: string,
  url: string,
  msgtype: "m.image" | "m.video" | "m.file",
  body: string
): Promise<ISendEventResponse> {
  const client = await initMatrix();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.sendEvent(roomId, "m.room.message" as any, {
    msgtype,
    body: body || "media",
    url,
  });
}

// ── sendTyping — send typing indicator to a room ─────────────────────────────

export async function sendTyping(
  roomId: string,
  isTyping: boolean,
  timeoutMs = 3000
): Promise<void> {
  const client = await initMatrix();
  await client.sendTyping(roomId, isTyping, timeoutMs);
}

// ── useRoomTyping — live typing users for a room ─────────────────────────────

export function useRoomTyping(roomId: string | null): { typingUsers: { userId: string; displayName: string }[] } {
  const [typingUsers, setTypingUsers] = useState<{ userId: string; displayName: string }[]>([]);

  useEffect(() => {
    if (!roomId) { setTypingUsers([]); return; }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        const client = await initMatrix();
        if (cancelled) return;
        const myId = client.getUserId() ?? "";

        const onTyping = () => {
          const room = client.getRoom(roomId);
          if (!room) return;
          const members = room.getMembers().filter((m) => m.typing && m.userId !== myId);
          if (!cancelled) {
            setTypingUsers(members.map((m) => ({ userId: m.userId, displayName: m.name || m.userId })));
          }
        };

        client.on(RoomMemberEvent.Typing, onTyping);
        return () => { client.off(RoomMemberEvent.Typing, onTyping); };
      } catch { /* Matrix unavailable */ }
    };

    let cleanup: (() => void) | undefined;
    bootstrap().then((fn) => { cleanup = fn; }).catch(() => {});

    return () => { cancelled = true; cleanup?.(); };
  }, [roomId]);

  return { typingUsers };
}

// ── sendReadReceipt — mark an event as read ──────────────────────────────────

export async function sendReadReceipt(
  roomId: string,
  eventId: string
): Promise<void> {
  try {
    const client = await initMatrix();
    const room = client.getRoom(roomId);
    if (!room) return;
    const event = room.getLiveTimeline().getEvents().find((ev) => ev.getId() === eventId);
    if (event) {
      await client.sendReadReceipt(event);
    }
  } catch {
    // Non-critical — silently ignore
  }
}

// ── sendReaction — add an emoji reaction to a message ─────────────────────────

export async function sendReaction(
  roomId: string,
  eventId: string,
  emoji: string
): Promise<ISendEventResponse> {
  const content = {
    "m.relates_to": {
      rel_type: "m.annotation",
      event_id: eventId,
      key: emoji,
    },
  };

  const attempt = async (): Promise<ISendEventResponse> => {
    const client = await initMatrix();
    try {
      return await client.sendEvent(roomId, EventType.Reaction, content);
    } catch (err: unknown) {
      const errObj = err as { httpStatus?: number; errcode?: string };
      if (errObj.httpStatus === 403 || errObj.errcode === "M_FORBIDDEN") {
        console.warn("[Matrix] 403 on sendReaction, attempting rejoin...");
        try {
          await client.joinRoom(roomId);
          return await client.sendEvent(roomId, EventType.Reaction, content);
        } catch { /* rejoin failed */ }
      }
      throw err;
    }
  };

  try {
    return await attempt();
  } catch (err: unknown) {
    const errObj = err as { httpStatus?: number; errcode?: string };
    if (errObj.httpStatus === 401 || errObj.errcode === "M_UNKNOWN_TOKEN") {
      console.warn("[Matrix] Token expired on sendReaction, re-authing...");
      resetMatrixClient();
      return await attempt();
    }
    throw err;
  }
}

// ── redactEvent — remove a reaction (or any event) ───────────────────────────

export async function redactEvent(
  roomId: string,
  eventId: string
): Promise<void> {
  const attempt = async (): Promise<void> => {
    const client = await initMatrix();
    try {
      await client.redactEvent(roomId, eventId);
    } catch (err: unknown) {
      const errObj = err as { httpStatus?: number; errcode?: string };
      if (errObj.httpStatus === 403 || errObj.errcode === "M_FORBIDDEN") {
        console.warn("[Matrix] 403 on redactEvent, attempting rejoin...");
        try {
          await client.joinRoom(roomId);
          await client.redactEvent(roomId, eventId);
          return;
        } catch { /* rejoin failed */ }
      }
      throw err;
    }
  };

  try {
    await attempt();
  } catch (err: unknown) {
    const errObj = err as { httpStatus?: number; errcode?: string };
    if (errObj.httpStatus === 401 || errObj.errcode === "M_UNKNOWN_TOKEN") {
      console.warn("[Matrix] Token expired on redactEvent, re-authing...");
      resetMatrixClient();
      await attempt();
      return;
    }
    throw err;
  }
}

// ── useRoomReactions — live reaction map for a room ──────────────────────────

export interface ReactionEntry {
  emoji: string;
  count: number;
  users: { userId: string; reactionEventId: string }[];
}

export function useRoomReactions(roomId: string | null): {
  /** Map from target eventId → list of reaction entries */
  reactions: Map<string, ReactionEntry[]>;
} {
  const [reactions, setReactions] = useState<Map<string, ReactionEntry[]>>(new Map());

  useEffect(() => {
    if (!roomId) { setReactions(new Map()); return; }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        const client = await initMatrix();
        if (cancelled) return;

        const buildReactionMap = () => {
          const room = client.getRoom(roomId);
          if (!room) return;

          const map = new Map<string, ReactionEntry[]>();
          const timeline = room.getLiveTimeline().getEvents();

          for (const ev of timeline) {
            if (ev.getType() !== "m.reaction") continue;
            if (ev.isRedacted()) continue;
            const rel = ev.getContent()?.["m.relates_to"];
            if (!rel || rel.rel_type !== "m.annotation") continue;

            const targetId = rel.event_id as string;
            const emoji = rel.key as string;
            if (!targetId || !emoji) continue;
            const senderId = ev.getSender() ?? "";
            const reactionEventId = ev.getId() ?? "";

            if (!map.has(targetId)) map.set(targetId, []);
            const entries = map.get(targetId)!;
            let entry = entries.find((e) => e.emoji === emoji);
            if (!entry) {
              entry = { emoji, count: 0, users: [] };
              entries.push(entry);
            }
            // Deduplicate by userId+emoji
            if (!entry.users.some((u) => u.userId === senderId)) {
              entry.count++;
              entry.users.push({ userId: senderId, reactionEventId });
            }
          }

          if (!cancelled) setReactions(map);
        };

        buildReactionMap();

        // Rebuild on any timeline event (new reaction or redaction)
        const onTimeline = (event: MatrixEvent, room: any) => {
          if (!room || room.roomId !== roomId) return;
          if (event.getType() === "m.reaction" || event.getType() === "m.room.redaction") {
            buildReactionMap();
          }
        };

        client.on(RoomEvent.Timeline, onTimeline);
        return () => { client.off(RoomEvent.Timeline, onTimeline); };
      } catch { /* Matrix unavailable */ }
    };

    let cleanup: (() => void) | undefined;
    bootstrap().then((fn) => { cleanup = fn; }).catch(() => {});

    return () => { cancelled = true; cleanup?.(); };
  }, [roomId]);

  return { reactions };
}

// ── getMatrixTimeline — synchronous snapshot of timeline events ───────────────

export function getMatrixTimeline(roomId: string): MatrixMessage[] {
  if (!matrixClient) return [];
  const myId = matrixClient.getUserId() ?? "";
  const room = matrixClient.getRoom(roomId);
  if (!room) return [];
  const timeline = room.getLiveTimeline().getEvents();
  return timeline
    .map((ev) => eventToMessage(ev, myId, timeline))
    .filter((m): m is MatrixMessage => m !== null);
}

// ── paginateRoom — load older messages via scrollback ─────────────────────────

export async function paginateRoom(
  roomId: string,
  limit = 50
): Promise<number> {
  const client = await initMatrix();
  const room = client.getRoom(roomId);
  if (!room) return 0;
  const res = await client.scrollback(room, limit);
  return res?.getLiveTimeline().getEvents().length ?? 0;
}

// ── Primary hook ──────────────────────────────────────────────────────────────

export function useMatrix() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    initMatrix()
      .then((client) => {
        if (cancelled) return;

        // If still in initial sync, wait for PREPARED state
        if (client.getSyncState() === SyncState.Prepared) {
          setReady(true);
          return;
        }

        const onSync = (state: SyncState) => {
          if (state === SyncState.Prepared || state === SyncState.Syncing) {
            if (!cancelled) setReady(true);
            client.off(ClientEvent.Sync, onSync);
          }
          if (state === SyncState.Error) {
            if (!cancelled) setError("Matrix sync error");
            client.off(ClientEvent.Sync, onSync);
            // Token may have expired — reset so a page navigation retries
            resetMatrixClient();
          }
        };

        client.on(ClientEvent.Sync, onSync);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Matrix init failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sendMessage = useCallback(async (roomId: string, text: string) => {
    return sendMatrixMessage(roomId, text);
  }, []);

  const getTimeline = useCallback((roomId: string): MatrixMessage[] => {
    return getMatrixTimeline(roomId);
  }, []);

  return {
    ready,
    error,
    client: matrixClient,
    sendMessage,
    getTimeline,
    useRoomMessages,
  };
}
