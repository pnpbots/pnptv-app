import { useState, useEffect, useCallback, useRef } from "react";
import { getAcceptingCallsStatus } from "@/lib/api";
import { getSocket } from "@/lib/socket";

const POLL_INTERVAL_MS = 30_000;

export interface AcceptingCallsState {
  accepting: boolean;
  online: boolean;
  loading: boolean;
}

/**
 * Returns the real-time accepting-calls state for any creatorId.
 *
 * Strategy — dual-layer, matching usePresence:
 *   1. Socket.IO: listens for `creator:accepting_calls_changed` events
 *      emitted by the backend when the creator toggles or the TTL expires.
 *   2. Polling: fetches the REST endpoint every 30s as a fallback when the
 *      socket is disconnected (mobile background, flaky network).
 *
 * Pass null/undefined to disable — the hook becomes a no-op returning defaults.
 */
export function useAcceptingCalls(
  creatorId: string | null | undefined
): AcceptingCallsState {
  const [accepting, setAccepting] = useState(false);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async (id: string) => {
    try {
      const res = await getAcceptingCallsStatus(id);
      if (!mountedRef.current) return;
      setAccepting(res.accepting);
      setOnline(res.online);
    } catch {
      // ignore — next tick will retry
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!creatorId) {
      setAccepting(false);
      setOnline(false);
      setLoading(false);
      return;
    }

    const id = String(creatorId);

    // Initial fetch
    setLoading(true);
    fetchStatus(id).finally(() => {
      if (mountedRef.current) setLoading(false);
    });

    // Socket listener — `creator:accepting_calls_changed` event
    // Expected payload: { creatorId: string; accepting: boolean; online: boolean }
    const socket = getSocket();
    const onChanged = (data: {
      creatorId: string;
      accepting: boolean;
      online: boolean;
    }) => {
      if (String(data?.creatorId) !== id) return;
      if (!mountedRef.current) return;
      setAccepting(!!data.accepting);
      setOnline(!!data.online);
    };
    socket.on("creator:accepting_calls_changed", onChanged);

    // Polling fallback
    pollTimerRef.current = window.setInterval(() => {
      fetchStatus(id);
    }, POLL_INTERVAL_MS);

    return () => {
      socket.off("creator:accepting_calls_changed", onChanged);
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [creatorId, fetchStatus]);

  return { accepting, online, loading };
}
