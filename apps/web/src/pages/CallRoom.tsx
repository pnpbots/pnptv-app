import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  LiveKitRoom,
  VideoConference,
} from "@livekit/components-react";
import { getCallBooking } from "@/lib/api";

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
      <p className="text-sm" style={{ color: "#8E8E93" }}>
        Connecting to your call…
      </p>
    </div>
  );
}

// ── Countdown ────────────────────────────────────────────────────────────────

function Countdown({ targetUtc, creatorUsername }: { targetUtc: string; creatorUsername: string }) {
  const [remaining, setRemaining] = useState(() => {
    return Math.max(0, Math.floor((new Date(targetUtc).getTime() - Date.now()) / 1000));
  });

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
        <p className="text-sm" style={{ color: "#8E8E93" }}>
          Scheduled for {formatted}
        </p>
      </div>

      {remaining > 0 ? (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: "#8E8E93" }}>
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
          color: "#8E8E93",
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
  token: string;
  livekitUrl: string;
  roomName: string;
  creatorUsername: string;
  startAt: string;
}

export default function CallRoom() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [joinData, setJoinData] = useState<JoinData | null>(null);
  const [notYetTime, setNotYetTime] = useState<{ startAt: string; creatorUsername: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasFetched = useRef(false);

  useEffect(() => {
    if (!bookingId || hasFetched.current) return;
    hasFetched.current = true;

    const controller = new AbortController();

    // Step 1: get booking metadata to confirm it exists and get times
    getCallBooking(bookingId)
      .then((res) => {
        if (controller.signal.aborted) return;
        const booking = res.booking;
        const startMs = new Date(booking.start_at).getTime();
        const nowMs = Date.now();
        const windowMs = 15 * 60 * 1000;

        // Not yet within join window
        if (startMs - nowMs > windowMs) {
          setNotYetTime({ startAt: booking.start_at, creatorUsername: booking.creator_username });
          setLoading(false);
          return;
        }

        // Step 2: call join endpoint to get LiveKit token
        return fetch(
          `/api/webapp/bookings/${encodeURIComponent(String(bookingId))}/join`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
          }
        )
          .then((r) => {
            if (!r.ok) {
              return r.json().then((body: unknown) => {
                const msg =
                  typeof body === "object" &&
                  body !== null &&
                  "message" in body &&
                  typeof (body as Record<string, unknown>).message === "string"
                    ? (body as Record<string, string>).message
                    : "Could not join call";
                throw new Error(msg);
              });
            }
            return r.json() as Promise<{ token?: string; livekitUrl?: string; roomName?: string }>;
          })
          .then((data) => {
            if (controller.signal.aborted) return;
            if (!data.token || !data.livekitUrl) {
              // Room not ready yet — show countdown
              setNotYetTime({ startAt: booking.start_at, creatorUsername: booking.creator_username });
              setLoading(false);
              return;
            }
            setJoinData({
              token: data.token,
              livekitUrl: data.livekitUrl,
              roomName: data.roomName ?? "",
              creatorUsername: booking.creator_username,
              startAt: booking.start_at,
            });
            setLoading(false);
          });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Could not load call";
        // 404 — booking not found or not belonging to this user
        if (msg.toLowerCase().includes("not found") || msg.includes("404")) {
          setError("This call booking was not found or has already ended.");
        } else {
          setError(msg);
        }
        setLoading(false);
      });

    return () => controller.abort();
  }, [bookingId]);

  if (loading) return <CallRoomSkeleton />;

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
            color: "#8E8E93",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  if (notYetTime) {
    return (
      <Countdown
        targetUtc={notYetTime.startAt}
        creatorUsername={notYetTime.creatorUsername}
      />
    );
  }

  if (!joinData) return <CallRoomSkeleton />;

  return (
    <div className="fixed inset-0" style={{ background: "#000" }}>
      {/* Close button */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Leave call"
        className="absolute top-4 right-4 z-50 w-10 h-10 flex items-center justify-center rounded-xl transition-opacity hover:opacity-80"
        style={{
          background: "rgba(255,69,58,0.15)",
          color: "#FF453A",
          border: "1px solid rgba(255,69,58,0.25)",
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

      <LiveKitRoom
        token={joinData.token}
        serverUrl={joinData.livekitUrl}
        connect={true}
        audio={true}
        video={true}
        options={{ adaptiveStream: true, dynacast: true }}
        onDisconnected={() => navigate(-1)}
        style={{ height: "100dvh" }}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
