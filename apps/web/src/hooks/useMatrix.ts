import { useState, useEffect, useCallback, useRef } from "react";
import {
  createClient,
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
}

function eventToMessage(event: MatrixEvent, myUserId: string): MatrixMessage | null {
  if (event.getType() !== "m.room.message") return null;
  const content = event.getContent();
  const msgtype = content.msgtype;

  const base = {
    eventId: event.getId() ?? `${event.getSender()}-${event.getTs()}`,
    roomId: event.getRoomId() ?? "",
    senderId: event.getSender() ?? "",
    timestamp: event.getTs(),
    isMine: event.getSender() === myUserId,
  };

  if (msgtype === "m.text" && typeof content.body === "string") {
    return { ...base, body: content.body };
  }

  if (msgtype === "m.image" || msgtype === "m.video" || msgtype === "m.file") {
    const mediaType = msgtype === "m.image" ? "image" : msgtype === "m.video" ? "video" : "file";
    const url = content.url ?? content.external_url ?? "";
    return {
      ...base,
      body: content.body ?? "",
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

        // Load timeline from cached room or wait for sync
        const hydrateFromRoom = () => {
          const room = client.getRoom(roomId);
          if (!room) return;
          const timeline = room.getLiveTimeline().getEvents();
          const msgs = timeline
            .map((ev) => eventToMessage(ev, myId))
            .filter((m): m is MatrixMessage => m !== null);
          if (!cancelled) setMessages(msgs);
        };

        hydrateFromRoom();
        setLoading(false);

        // Listen for new events in this room
        const onRoomTimeline = (
          event: MatrixEvent,
          room: ReturnType<MatrixClient["getRoom"]> | undefined | null
        ) => {
          if (!room || room.roomId !== roomId) return;
          const msg = eventToMessage(event, myId);
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
  const client = await initMatrix();
  return client.sendTextMessage(roomId, text);
}

// ── sendMatrixMediaMessage — send a media message (external URL) to a room ────

export async function sendMatrixMediaMessage(
  roomId: string,
  url: string,
  msgtype: "m.image" | "m.video" | "m.file",
  body: string
): Promise<ISendEventResponse> {
  const client = await initMatrix();
  return client.sendEvent(roomId, "m.room.message", {
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
  const client = await initMatrix();
  return client.sendEvent(roomId, "m.reaction", {
    "m.relates_to": {
      rel_type: "m.annotation",
      event_id: eventId,
      key: emoji,
    },
  });
}

// ── redactEvent — remove a reaction (or any event) ───────────────────────────

export async function redactEvent(
  roomId: string,
  eventId: string
): Promise<void> {
  const client = await initMatrix();
  await client.redactEvent(roomId, eventId);
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
            const rel = ev.getContent()?.["m.relates_to"];
            if (!rel || rel.rel_type !== "m.annotation") continue;

            const targetId = rel.event_id as string;
            const emoji = rel.key as string;
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
  return room
    .getLiveTimeline()
    .getEvents()
    .map((ev) => eventToMessage(ev, myId))
    .filter((m): m is MatrixMessage => m !== null);
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
