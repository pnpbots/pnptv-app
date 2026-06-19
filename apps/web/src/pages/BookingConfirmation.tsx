import React, { useState, useEffect, useMemo, useCallback } from "react";
// Note: joining state removed — call now opens Telegram directly
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { getCallBooking, getBookingPaymentStatus } from "@/lib/api";
import { PostCallSurveyModal } from "@/components/creators/PostCallSurveyModal";
import { useI18n } from "@/lib/i18n";

const STRINGS = {
  en: {
    invalidBooking: "Invalid booking ID.",
    failedToLoad: "Failed to load booking",
    bookingNotFound: "Booking not found",
    goBack: "Go Back",
    startingNow: "Starting now",
    startsInMin: "Starts in {n} min",
    startsInHr: "Starts in {h}h {m}m",
    callConfirmed: "Your Call is Confirmed!",
    creator: "Creator",
    dateTime: "Date & Time",
    duration: "Duration",
    minutes: "minutes",
    status: "Status",
    joinCall: "Join Call",
    howToJoinTitle: "How to Join & Call Rules",
    howToJoinHeading: "How to Join",
    howToJoinSteps: [
      "Return to this page 15 minutes before your call.",
      'Click "Join Call" — your browser opens the video call room.',
      "Allow camera and microphone access when prompted.",
      "The creator will join at the scheduled time.",
    ],
    callEtiquetteHeading: "Call Etiquette",
    callEtiquetteRules: [
      "Be on time — the call starts at the scheduled time.",
      "Use a quiet, well-lit space.",
      "Treat your host and other participants with respect.",
      "Recording or screenshots are not permitted.",
      "If you experience issues, refresh the page and rejoin.",
    ],
    backToHangouts: "Back to Hangouts",
    creatorFallback: "Creator",
  },
  es: {
    invalidBooking: "ID de reserva inválido.",
    failedToLoad: "No pudimos cargar la reserva",
    bookingNotFound: "Reserva no encontrada",
    goBack: "Atrás",
    startingNow: "Empezando ahora",
    startsInMin: "Empieza en {n} min",
    startsInHr: "Empieza en {h}h {m}m",
    callConfirmed: "¡Tu llamada está confirmada!",
    creator: "Creador",
    dateTime: "Fecha y hora",
    duration: "Duración",
    minutes: "minutos",
    status: "Estado",
    joinCall: "Unirse a la llamada",
    howToJoinTitle: "Cómo unirte y reglas de la llamada",
    howToJoinHeading: "Cómo unirte",
    howToJoinSteps: [
      "Vuelve a esta página 15 minutos antes de tu llamada.",
      'Toca "Unirse a la llamada" — tu navegador abre la sala de videollamada.',
      "Permite acceso a cámara y micrófono cuando se solicite.",
      "El creador se unirá a la hora programada.",
    ],
    callEtiquetteHeading: "Etiqueta de la llamada",
    callEtiquetteRules: [
      "Sé puntual — la llamada inicia a la hora programada.",
      "Usa un espacio tranquilo y bien iluminado.",
      "Trata a tu anfitrión y a los demás participantes con respeto.",
      "No se permiten grabaciones ni capturas de pantalla.",
      "Si tienes problemas, recarga la página y vuelve a entrar.",
    ],
    backToHangouts: "Volver a Hangouts",
    creatorFallback: "Creador",
  },
};

export default function BookingConfirmation() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const i18n = useI18n();
  const s = STRINGS[i18n.lang === "es" ? "es" : "en"];
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Open survey if coming from the post-call notification deep-link (?survey=1)
  const [showSurvey, setShowSurvey] = useState(() => searchParams.get("survey") === "1");
  const [pollingPayment, setPollingPayment] = useState(false);

  // FIX M-1: Poll payment status after NowPayments redirect until confirmed
  useEffect(() => {
    const isNowPaymentsReturn = searchParams.get("nowpayments") === "success";
    if (!isNowPaymentsReturn || !bookingId) return;
    if (!(/^\d+$/.test(bookingId) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId))) return;

    let stopped = false;
    const POLL_INTERVAL_MS = 4_000;
    const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    const pollStart = Date.now();

    setPollingPayment(true);

    const intervalId = setInterval(async () => {
      if (stopped) return;
      if (Date.now() - pollStart >= POLL_TIMEOUT_MS) {
        clearInterval(intervalId);
        setPollingPayment(false);
        return;
      }
      try {
        const statusRes = await getBookingPaymentStatus(bookingId);
        if (statusRes.status === "paid" || statusRes.status === "completed" as string) {
          clearInterval(intervalId);
          stopped = true;
          setPollingPayment(false);
          // Reload booking to get confirmed state
          getCallBooking(bookingId)
            .then((res) => setBooking(res.booking))
            .catch(() => {});
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(intervalId);
      setPollingPayment(false);
    };
  }, [bookingId, searchParams]);

  useEffect(() => {
    if (!bookingId) return;

    // Validate bookingId: accept pure integer strings OR UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!bookingId || (!/^\d+$/.test(bookingId) && !UUID_RE.test(bookingId))) {
      setError(s.invalidBooking);
      setLoading(false);
      return;
    }

    getCallBooking(bookingId)
      .then((res) => {
        setBooking(res.booking);
        // Check if user just returned from a completed call
        try {
          const key = `pnptv:call:ended:${bookingId}`;
          if (sessionStorage.getItem(key)) {
            sessionStorage.removeItem(key);
            setShowSurvey(true);
          }
        } catch { /* private browsing */ }
      })
      .catch((err) => setError(err instanceof Error ? err.message : s.failedToLoad))
      .finally(() => setLoading(false));
  }, [bookingId, s.invalidBooking, s.failedToLoad]);

  const handleJoinCall = useCallback(() => {
    if (!bookingId) return;
    navigate(`/call/${encodeURIComponent(bookingId)}`);
  }, [bookingId, navigate]);

  const startTime = booking?.start_at ? new Date(booking.start_at) : null;
  const [canJoin, setCanJoin] = useState(() => {
    if (!startTime) return false;
    return Date.now() >= startTime.getTime() - 15 * 60 * 1000;
  });

  // Bug M-05: re-evaluate canJoin every 30 seconds so the Join button enables automatically
  useEffect(() => {
    // Sync initial value whenever booking loads
    if (booking?.start_at) {
      const start = new Date(booking.start_at);
      setCanJoin(Date.now() >= start.getTime() - 15 * 60 * 1000);
    }
    const interval = setInterval(() => {
      if (booking?.start_at) {
        const start = new Date(booking.start_at);
        setCanJoin(Date.now() >= start.getTime() - 15 * 60 * 1000);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [booking?.start_at]);

  const timeUntilStart = useMemo(() => {
    if (!startTime) return "";
    const diff = startTime.getTime() - Date.now();
    if (diff <= 0) return s.startingNow;
    const mins = Math.ceil(diff / 60000);
    if (mins < 60) return s.startsInMin.replace("{n}", String(mins));
    const hrs = Math.floor(mins / 60);
    return s.startsInHr.replace("{h}", String(hrs)).replace("{m}", String(mins % 60));
  }, [startTime, s]);

  const handleCallEnd = () => {
    setShowSurvey(true);
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--pnp-background, #121212)" }}>
        <div className="space-y-4 w-full max-w-md px-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--pnp-surface, #1C1C1E)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-4" style={{ background: "var(--pnp-background, #121212)" }}>
        <p className="text-sm" style={{ color: "#FF6B6B" }}>{error || s.bookingNotFound}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-6 py-2 rounded-xl text-sm font-medium text-white"
          style={{ background: "var(--pnp-surface-hover, #2C2C2E)" }}
        >
          {s.goBack}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh py-8 px-4" style={{ background: "var(--pnp-background, #121212)" }}>
      <div className="max-w-md mx-auto space-y-5">
        {/* NowPayments polling banner */}
        {pollingPayment && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "rgba(255,204,0,0.10)", border: "1px solid rgba(255,204,0,0.25)" }}
            role="status"
            aria-live="polite"
          >
            <svg
              className="animate-spin flex-shrink-0"
              style={{ width: 16, height: 16, color: "#FFCC00" }}
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium" style={{ color: "#FFCC00" }}>
              Confirming your payment…
            </span>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col items-center gap-3 pt-4 pb-2">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "rgba(52,199,89,0.12)" }}
          >
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#34C759" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-white font-bold text-xl">{s.callConfirmed}</h1>
          <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{timeUntilStart}</p>
        </div>

        {/* Call details card */}
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{s.creator}</span>
            <span className="text-white font-medium">{booking.creator_display_name || booking.creator_username || booking.creator_id}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{s.dateTime}</span>
            <span className="text-white font-medium">
              {startTime?.toLocaleDateString(i18n.lang, { weekday: "short", month: "short", day: "numeric" })}{" "}
              {startTime?.toLocaleTimeString(i18n.lang, { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{s.duration}</span>
            <span className="text-white font-medium">{booking.duration_minutes} {s.minutes}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{s.status}</span>
            <span
              className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{
                background: booking.status === "confirmed" ? "rgba(52,199,89,0.15)" : "rgba(255,204,0,0.15)",
                color: booking.status === "confirmed" ? "#34C759" : "#FFCC00",
              }}
            >
              {booking.status}
            </span>
          </div>
        </div>

        {/* Join call button — opens Telegram DM with creator */}
        <button
          onClick={handleJoinCall}
          disabled={!canJoin}
          className="w-full py-3.5 rounded-xl font-semibold text-white text-sm transition-opacity disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          {canJoin ? s.joinCall : timeUntilStart}
        </button>

        {/* Tutorial / Rules */}
        <details
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <summary className="px-5 py-3.5 text-sm font-semibold text-white cursor-pointer select-none">
            {s.howToJoinTitle}
          </summary>
          <div className="px-5 pb-4 space-y-3 text-sm" style={{ color: "#AEAEB2" }}>
            <div>
              <p className="font-medium text-white mb-1">{s.howToJoinHeading}</p>
              <ol className="list-decimal list-inside space-y-1">
                {s.howToJoinSteps.map((step, i) => (<li key={i}>{step}</li>))}
              </ol>
            </div>
            <div>
              <p className="font-medium text-white mb-1">{s.callEtiquetteHeading}</p>
              <ul className="list-disc list-inside space-y-1">
                {s.callEtiquetteRules.map((rule, i) => (<li key={i}>{rule}</li>))}
              </ul>
            </div>
          </div>
        </details>

        <button
          onClick={() => navigate("/hangouts")}
          className="w-full py-2.5 rounded-xl text-sm font-medium"
          style={{ color: "var(--pnp-text-secondary, #8E8E93)", background: "none", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {s.backToHangouts}
        </button>
      </div>

      <PostCallSurveyModal
        open={showSurvey}
        bookingId={bookingId}
        creatorName={booking.creator_username || s.creatorFallback}
        onClose={() => setShowSurvey(false)}
      />
    </div>
  );
}
