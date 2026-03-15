import { useState, useEffect, useCallback, useRef } from "react";
import {
  createClient,
  type MatrixClient,
  type MatrixEvent,
  RoomEvent,
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
}

function eventToMessage(event: MatrixEvent, myUserId: string): MatrixMessage | null {
  if (event.getType() !== "m.room.message") return null;
  const content = event.getContent();
  if (content.msgtype !== "m.text" || typeof content.body !== "string") return null;
  return {
    eventId: event.getId() ?? `${event.getSender()}-${event.getTs()}`,
    roomId: event.getRoomId() ?? "",
    senderId: event.getSender() ?? "",
    body: content.body,
    timestamp: event.getTs(),
    isMine: event.getSender() === myUserId,
  };
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
