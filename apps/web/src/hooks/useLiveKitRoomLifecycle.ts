import { useEffect, useState } from "react";
import type { Room, Participant, ConnectionQuality } from "livekit-client";
import { RoomEvent } from "livekit-client";

type Callbacks = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onActiveSpeakers?: (speakers: Participant[]) => void;
  onQuality?: (quality: ConnectionQuality, participant: Participant) => void;
};

/**
 * Shared LiveKit room lifecycle wiring used by MainStage's StageRoom and the
 * hangout LiveKitCallDock. Centralises:
 *   - connected / reconnecting state
 *   - body.allow-landscape class + screen.orientation lock dance
 *   - RoomEvent subscriptions
 *
 * Consumer-specific state (active-speaker set, own quality, call-ended
 * banner) stays in the caller via the optional callbacks.
 */
export function useLiveKitRoomLifecycle(
  room: Room | undefined,
  callbacks: Callbacks = {},
): { connected: boolean; reconnecting: boolean } {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!room) return;

    const handleConnected = () => {
      setConnected(true);
      setReconnecting(false);
      document.body.classList.add("allow-landscape");
      try { (screen.orientation as any)?.unlock?.(); } catch {}
      callbacks.onConnected?.();
    };
    const handleDisconnected = () => {
      setConnected(false);
      document.body.classList.remove("allow-landscape");
      try { (screen.orientation as any)?.lock?.("portrait").catch(() => {}); } catch {}
      // Transient disconnects during reconnect flip us to reconnecting so
      // callers can show the right overlay without wiring extra events.
      if (room.state === "reconnecting") setReconnecting(true);
      else setReconnecting(false);
      callbacks.onDisconnected?.();
    };
    const handleReconnecting = () => {
      setReconnecting(true);
      setConnected(false);
      callbacks.onReconnecting?.();
    };
    const handleReconnected = () => {
      setReconnecting(false);
      setConnected(true);
      callbacks.onReconnected?.();
    };
    const handleActiveSpeakers = (speakers: Participant[]) => {
      callbacks.onActiveSpeakers?.(speakers);
    };
    const handleQuality = (q: ConnectionQuality, p: Participant) => {
      callbacks.onQuality?.(q, p);
    };

    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    if (callbacks.onQuality) {
      room.on(RoomEvent.ConnectionQualityChanged, handleQuality);
    }

    if (room.state === "connected") {
      setConnected(true);
      callbacks.onConnected?.();
    }

    return () => {
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
      if (callbacks.onQuality) {
        room.off(RoomEvent.ConnectionQualityChanged, handleQuality);
      }
    };
    // Intentionally only re-run when the room identity changes; callbacks are
    // captured by closure and would cause a reconnect storm if included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  return { connected, reconnecting };
}
