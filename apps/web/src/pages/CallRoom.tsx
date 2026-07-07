import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getCallBooking } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const CALL_STRINGS = {
  en: {
    couldNotJoin: "Could not join call",
    couldNotLoad: "Could not load call",
    bookingNotFound: "This call booking was not found or has already ended.",
    goBack: "Go Back",
    leaveCall: "Leave call",
  },
  es: {
    couldNotJoin: "No se pudo unir a la llamada",
    couldNotLoad: "No se pudo cargar la llamada",
    bookingNotFound: "No se encontró la reserva o ya terminó.",
    goBack: "Atrás",
    leaveCall: "Salir de la llamada",
  },
};

// ── Skeleton ─────────────────────────────────────────────────────────────────

function CallRoomSkeleton() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4"
      style={{ background: "#000" }}
    >
      <div
        className="w-12 h-12 rounded-full animate-pulse"
        style={{ background: "rgba(255,255,255,0.08)" }}
      />
      <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
        Connecting to your call…
      </p>
    </div>
  );
}

// ── Countdown ────────────────────────────────────────────────────────────────

function Countdown({ targetUtc, creatorUsername, onReady }: { targetUtc: string; creatorUsername: string; onReady?: () => void }) {
  const [remaining, setRemaining] = useState(() => {
    return Math.max(0, Math.floor((new Date(targetUtc).getTime() - Date.now()) / 1000));
  });
  const firedRef = useRef(false);

  useEffect(() => {
    if (remaining <= 0) return;
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(iv); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (remaining <= 0 && onReady && !firedRef.current) {
      firedRef.current = true;
      setTimeout(onReady, 1000);
    }
  }, [remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  const formatted = new Date(targetUtc).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: "#000" }}
    >
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: "rgba(212,0,122,0.14)" }}
      >
        <svg
          className="w-8 h-8"
          style={{ color: "#D4007A" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <div className="space-y-1">
        <p className="text-base font-semibold" style={{ color: "#EBEBF5" }}>
          Call with @{creatorUsername}
        </p>
        <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          Scheduled for {formatted}
        </p>
      </div>

      {remaining > 0 ? (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Starts in
          </p>
          <p className="text-4xl font-bold tabular-nums" style={{ color: "#EBEBF5" }}>
            {label}
          </p>
        </div>
      ) : (
        <p className="text-sm" style={{ color: "#34C759" }}>
          Your call should be starting now. Please refresh if the room doesn't open.
        </p>
      )}

      <button
        type="button"
        onClick={() => window.history.back()}
        className="mt-2 min-h-[44px] px-6 rounded-2xl text-sm font-semibold transition-opacity hover:opacity-80"
        style={{
          background: "rgba(255,255,255,0.08)",
          color: "var(--pnp-text-secondary, #8E8E93)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        Back
      </button>
    </div>
  );
}

// ── WaitingRoom ───────────────────────────────────────────────────────────────

function WaitingRoom({
  startAt,
  creatorUsername,
  onAdmit,
}: {
  startAt: string;
  creatorUsername: string;
  onAdmit: () => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((new Date(startAt).getTime() - Date.now()) / 1000))
  );
  const admittedRef = useRef(false);

  useEffect(() => {
    if (remaining <= 0) {
      if (!admittedRef.current) { admittedRef.current = true; onAdmit(); }
      return;
    }
    const iv = setInterval(() => {
      setRemaining((r) => {
        const next = r - 1;
        if (next <= 0 && !admittedRef.current) { admittedRef.current = true; onAdmit(); }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: "#000" }}
    >
      <div className="relative flex items-center justify-center">
        <div
          className="absolute w-20 h-20 rounded-full animate-ping"
          style={{ background: "rgba(212,0,122,0.18)" }}
        />
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: "rgba(212,0,122,0.22)", border: "2px solid rgba(212,0,122,0.5)" }}
        >
          <svg
            className="w-7 h-7"
            style={{ color: "#D4007A" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-lg font-semibold" style={{ color: "#EBEBF5" }}>
          @{creatorUsername} is getting ready
        </p>
        <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          Your call starts in
        </p>
      </div>

      <p className="text-4xl font-bold tabular-nums" style={{ color: "#EBEBF5" }}>
        {pad(m)}:{pad(s)}
      </p>

      <p className="text-xs max-w-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
        You will be admitted automatically when the call begins. Make sure your camera and microphone are ready.
      </p>

      <button
        type="button"
        onClick={() => window.history.back()}
        className="mt-2 min-h-[44px] px-6 rounded-2xl text-sm font-semibold transition-opacity hover:opacity-80"
        style={{
          background: "rgba(255,255,255,0.08)",
          color: "var(--pnp-text-secondary, #8E8E93)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        Back
      </button>
    </div>
  );
}

// ── CallRoom ─────────────────────────────────────────────────────────────────

interface JoinData {
  jaasUrl: string;
  roomName: string;
  creatorUsername: string;
  startAt: string;
}

export default function CallRoom() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const i18n = useI18n();
  const cs = CALL_STRINGS[i18n.lang === "es" ? "es" : "en"];

  const [loading, setLoading] = useState(true);
  const [joinData, setJoinData] = useState<JoinData | null>(null);
  const [notYetTime, setNotYetTime] = useState<{ startAt: string; creatorUsername: string } | null>(null);
  const [waitingRoom, setWaitingRoom] = useState<{ startAt: string; creatorUsername: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const hasFetched = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!bookingId || hasFetched.current) return;
    hasFetched.current = true;
    // eslint-disable-next-line no-unused-expressions
    void retryKey;

    const controller = new AbortController();

    // Step 1: get booking metadata to confirm it exists and get times
    getCallBooking(bookingId)
      .then((res) => {
        if (controller.signal.aborted) return;
        const booking = res.booking;
        if (booking.start_at != null) {
          const startMs = new Date(booking.start_at).getTime();
          const nowMs = Date.now();
          if (startMs - nowMs > 15 * 60 * 1000) {
            setNotYetTime({ startAt: booking.start_at, creatorUsername: booking.creator_username });
            setLoading(false);
            return;
          }
        }

        // Step 2: call join endpoint to get JaaS URL
        return fetch(
          `/api/webapp/bookings/${encodeURIComponent(String(bookingId))}/join`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            signal: controller.signal,
          }
        )
          .then((r) => {
            if (!r.ok) {
              return r.json().then((body: unknown) => {
                const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
                if (r.status === 403 && typeof b.startAt === "string") {
                  setNotYetTime({ startAt: b.startAt as string, creatorUsername: booking.creator_username });
                  setLoading(false);
                  return null;
                }
                // FIX CRIT-01: payment webhook may not have landed yet — auto-retry in 5s
                // rather than showing an error screen immediately.
                if (r.status === 403) {
                  const msg = typeof b.error === "string" ? b.error : "";
                  if (
                    msg.toLowerCase().includes("not yet confirmed") ||
                    msg.toLowerCase().includes("awaiting") ||
                    b.code === "BOOKING_NOT_CONFIRMED"
                  ) {
                    setTimeout(() => {
                      hasFetched.current = false;
                      setRetryKey((k) => k + 1);
                    }, 5000);
                    setLoading(false);
                    return null;
                  }
                  setError(msg || cs.couldNotJoin);
                  setLoading(false);
                  return null;
                }
                const msg = typeof b.error === "string" ? b.error : cs.couldNotJoin;
                throw new Error(msg);
              });
            }
            return r.json() as Promise<{
              jaasUrl?: string;
              roomName?: string;
              ttlSeconds?: number;
              waiting?: boolean;
              startAt?: string;
              creatorUsername?: string;
            }>;
          })
          .then((data) => {
            if (!data || controller.signal.aborted) return;
            if (data.waiting) {
              setWaitingRoom({
                startAt: data.startAt ?? booking.start_at,
                creatorUsername: data.creatorUsername ?? booking.creator_username,
              });
              setLoading(false);
              return;
            }
            if (!data.jaasUrl) {
              setError(cs.couldNotJoin);
              setLoading(false);
              return;
            }
            setJoinData({
              jaasUrl: data.jaasUrl,
              roomName: data.roomName ?? "",
              creatorUsername: booking.creator_username,
              startAt: booking.start_at,
            });
            setLoading(false);
          });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : cs.couldNotLoad;
        if (msg.toLowerCase().includes("not found") || msg.includes("404")) {
          setError(cs.bookingNotFound);
        } else {
          setError(msg);
        }
        setLoading(false);
      });

    return () => controller.abort();
  }, [bookingId, retryKey]);

  const handleAdmit = useCallback(() => {
    if (!mountedRef.current) return;
    setWaitingRoom(null);
    setLoading(true);
    hasFetched.current = false;
    setRetryKey((k) => k + 1);
  }, []);

  if (loading) return <CallRoomSkeleton />;

  if (waitingRoom) {
    return (
      <WaitingRoom
        startAt={waitingRoom.startAt}
        creatorUsername={waitingRoom.creatorUsername}
        onAdmit={handleAdmit}
      />
    );
  }

  if (error) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: "#000" }}
      >
        <p className="text-sm font-medium" style={{ color: "#FF453A" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="min-h-[44px] px-6 rounded-2xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "var(--pnp-text-secondary, #8E8E93)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {cs.goBack}
        </button>
      </div>
    );
  }

  if (notYetTime) {
    return (
      <Countdown
        targetUtc={notYetTime.startAt}
        creatorUsername={notYetTime.creatorUsername}
        onReady={handleAdmit}
      />
    );
  }

  if (!joinData) return <CallRoomSkeleton />;

  return (
    <div className="fixed inset-0" style={{ background: "#000" }}>
      {/* Leave button — positioned over the iframe */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label={cs.leaveCall}
        className="absolute top-4 right-4 z-50 w-10 h-10 flex items-center justify-center rounded-xl transition-opacity hover:opacity-80"
        style={{
          background: "rgba(255,69,58,0.15)",
          color: "#FF453A",
          border: "1px solid rgba(255,69,58,0.25)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <iframe
        src={joinData.jaasUrl}
        allow="camera *; microphone *; fullscreen *; display-capture *; autoplay *; speaker-selection *; clipboard-write *; hid *"
        allowFullScreen
        style={{ width: "100%", height: "100dvh", border: "none" }}
        title="Private call"
      />
    </div>
  );
}
