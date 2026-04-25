import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CarouselLayout,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { getCallBooking } from "@/lib/api";

// ── View modes ───────────────────────────────────────────────────────────────

type ViewMode = "grid" | "spotlight" | "cinema";
const VIEW_MODE_STORAGE_KEY = "pnptv:call:viewMode";

function readStoredMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === "grid" || v === "spotlight" || v === "cinema") return v;
  } catch {
    /* ignore */
  }
  return "spotlight";
}

function refKey(t: TrackReferenceOrPlaceholder | undefined): string {
  if (!t) return "";
  const src = (t.publication?.source as string | undefined) ?? (t.source as unknown as string);
  return `${t.participant.identity}:${src}`;
}

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
            color: "var(--pnp-text-secondary, #8E8E93)",
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
    <div className="fixed inset-0" data-call-container style={{ background: "#000" }}>
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
        <CallStage />
      </LiveKitRoom>
    </div>
  );
}

// ── CallStage ────────────────────────────────────────────────────────────────

export function CallStage() {
  const [mode, setMode] = useState<ViewMode>(() => readStoredMode());

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const layoutContext = useCreateLayoutContext();
  const pinnedTracks = usePinnedTracks(layoutContext);

  const screenShareTracks = useMemo(
    () => tracks.filter((t) => t.publication?.source === Track.Source.ScreenShare),
    [tracks],
  );

  // Auto-pin the first incoming screen share (same behavior as LiveKit's VideoConference prefab)
  const lastAutoPinnedRef = useRef<string | null>(null);
  useEffect(() => {
    const dispatch = layoutContext.pin.dispatch;
    if (!dispatch) return;
    const current = pinnedTracks?.[0];
    if (screenShareTracks.length > 0) {
      const ss = screenShareTracks[0];
      const key = refKey(ss);
      if (!current && lastAutoPinnedRef.current !== key) {
        dispatch({ msg: "set_pin", trackReference: ss });
        lastAutoPinnedRef.current = key;
      }
    } else if (lastAutoPinnedRef.current && current && refKey(current) === lastAutoPinnedRef.current) {
      dispatch({ msg: "clear_pin" });
      lastAutoPinnedRef.current = null;
    }
  }, [screenShareTracks, pinnedTracks, layoutContext.pin.dispatch]);

  const focusTrack: TrackReferenceOrPlaceholder | undefined =
    pinnedTracks?.[0] ??
    screenShareTracks[0] ??
    tracks.find((t) => !t.participant.isLocal) ??
    tracks[0];

  const focusKey = refKey(focusTrack);
  const carouselTracks = useMemo(
    () => tracks.filter((t) => refKey(t) !== focusKey),
    [tracks, focusKey],
  );

  return (
    <LayoutContextProvider value={layoutContext}>
      <ViewModeToggle value={mode} onChange={setMode} />
      <FullscreenButton />

      <div
        className="absolute inset-0"
        style={{ paddingBottom: "96px" /* leave room for ControlBar */ }}
      >
        {mode === "grid" && (
          <GridLayout tracks={tracks} style={{ height: "100%" }}>
            <ParticipantTile />
          </GridLayout>
        )}

        {mode === "spotlight" && focusTrack && (
          <FocusLayoutContainer style={{ height: "100%" }}>
            <CarouselLayout tracks={carouselTracks}>
              <ParticipantTile />
            </CarouselLayout>
            <FocusLayout trackRef={focusTrack} />
          </FocusLayoutContainer>
        )}

        {mode === "cinema" && focusTrack && (
          <div className="w-full h-full flex items-center justify-center">
            <FocusLayout trackRef={focusTrack} style={{ width: "100%", height: "100%" }} />
          </div>
        )}
      </div>

      <RoomAudioRenderer />
      <ControlBar
        variation="minimal"
        controls={{ chat: false, screenShare: true, leave: true }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
        }}
      />
    </LayoutContextProvider>
  );
}

// ── ViewModeToggle ───────────────────────────────────────────────────────────

const MODES: Array<{ id: ViewMode; label: string; icon: JSX.Element; title: string }> = [
  {
    id: "grid",
    label: "Grid",
    title: "Everyone equally",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "spotlight",
    label: "Spotlight",
    title: "One large + thumbnails",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x="3" y="3" width="18" height="13" rx="1.8" />
        <rect x="3" y="18" width="5" height="3" rx="0.8" />
        <rect x="10" y="18" width="5" height="3" rx="0.8" />
        <rect x="17" y="18" width="4" height="3" rx="0.8" />
      </svg>
    ),
  },
  {
    id: "cinema",
    label: "Cinema",
    title: "Focus one cam, full screen",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path strokeLinecap="round" d="M8 10l4 2.5L8 15z" fill="currentColor" />
      </svg>
    ),
  },
];

// ── FullscreenButton ─────────────────────────────────────────────────────────

function FullscreenButton() {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [isFs, setIsFs] = useState(() =>
    typeof document !== "undefined" && document.fullscreenElement !== null,
  );

  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const target = btnRef.current?.closest<HTMLElement>("[data-call-container]");
    if (!target) return;
    target.requestFullscreen().catch(() => {});
  };

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={toggle}
      aria-label={isFs ? "Exit full screen" : "Enter full screen"}
      title={isFs ? "Exit full screen" : "Full screen"}
      className="absolute top-4 z-50 w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-80"
      style={{
        right: "calc(3.25rem + env(safe-area-inset-right, 0px))",
        background: "rgba(0,0,0,0.55)",
        color: "#EBEBF5",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      {isFs ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9H5V5m0 14h4v-4m10 4h-4v-4m0-6h4V5" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4" />
        </svg>
      )}
    </button>
  );
}

function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex gap-1 p-1 rounded-2xl"
      style={{
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
      role="tablist"
      aria-label="Call view mode"
    >
      {MODES.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={m.title}
            onClick={() => onChange(m.id)}
            className="min-h-[36px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
            style={{
              background: active ? "#D4007A" : "transparent",
              color: active ? "#FFFFFF" : "#EBEBF5",
              opacity: active ? 1 : 0.75,
            }}
          >
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
