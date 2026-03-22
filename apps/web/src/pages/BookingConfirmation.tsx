import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getCallBooking } from "@/lib/api";
import { JitsiMeetComponent } from "@/components/hangouts";
import { PostCallSurveyModal } from "@/components/creators/PostCallSurveyModal";

export default function BookingConfirmation() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<any>(null);
  const [meetingData, setMeetingData] = useState<{ meetingUrl: string; roomName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inCall, setInCall] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);

  useEffect(() => {
    if (!bookingId) return;

    // Bug: bookingId NaN crash — validate it's a pure integer string before casting
    if (!/^\d+$/.test(bookingId)) {
      setError("Invalid booking ID.");
      setLoading(false);
      return;
    }

    getCallBooking(Number(bookingId))
      .then((res) => {
        setBooking(res.booking);
        // Don't store token at load time — fetch fresh on join
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load booking"))
      .finally(() => setLoading(false));
  }, [bookingId]);

  // BC-H-03: Fetch fresh JaaS token on "Join Call" click, not at page load
  const handleJoinCall = useCallback(async () => {
    if (!bookingId || !/^\d+$/.test(bookingId)) return;
    setJoining(true);
    try {
      // API returns { booking } where booking.jaas contains { meetingUrl, roomName, token }
      const res = await getCallBooking(Number(bookingId));
      const callData = (res.booking as any).jaas ?? (res as any).jaas ?? null;
      if (callData?.meetingUrl) {
        setMeetingData({ meetingUrl: callData.meetingUrl, roomName: callData.roomName });
        setInCall(true);
      } else {
        setError("Unable to generate call token. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join call");
    } finally {
      setJoining(false);
    }
  }, [bookingId]);

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
    if (diff <= 0) return "Starting now";
    const mins = Math.ceil(diff / 60000);
    if (mins < 60) return `Starts in ${mins} min`;
    const hrs = Math.floor(mins / 60);
    return `Starts in ${hrs}h ${mins % 60}m`;
  }, [startTime]);

  const handleCallEnd = () => {
    setInCall(false);
    setShowSurvey(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#121212" }}>
        <div className="space-y-4 w-full max-w-md px-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "#1C1C1E" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ background: "#121212" }}>
        <p className="text-sm" style={{ color: "#FF6B6B" }}>{error || "Booking not found"}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-6 py-2 rounded-xl text-sm font-medium text-white"
          style={{ background: "#2C2C2E" }}
        >
          Go Back
        </button>
      </div>
    );
  }

  if (inCall && meetingData) {
    return (
      <div className="h-screen" style={{ background: "#111113" }}>
        <JitsiMeetComponent
          meetingUrl={meetingData.meetingUrl}
          roomName={meetingData.roomName}
          onCallEnd={handleCallEnd}
          fullScreen
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4" style={{ background: "#121212" }}>
      <div className="max-w-md mx-auto space-y-5">
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
          <h1 className="text-white font-bold text-xl">Your Call is Confirmed!</h1>
          <p className="text-sm" style={{ color: "#8E8E93" }}>{timeUntilStart}</p>
        </div>

        {/* Call details card */}
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex justify-between text-sm">
            <span style={{ color: "#8E8E93" }}>Creator</span>
            <span className="text-white font-medium">{booking.creator_username || booking.creator_id}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "#8E8E93" }}>Date & Time</span>
            <span className="text-white font-medium">
              {startTime?.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}{" "}
              {startTime?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "#8E8E93" }}>Duration</span>
            <span className="text-white font-medium">{booking.duration_minutes} minutes</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "#8E8E93" }}>Status</span>
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

        {/* Join call button */}
        <button
          onClick={handleJoinCall}
          disabled={!canJoin || joining}
          className="w-full py-3.5 rounded-xl font-semibold text-white text-sm transition-opacity disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          {joining ? "Connecting..." : canJoin ? "Join Call" : timeUntilStart}
        </button>

        {/* Tutorial / Rules */}
        <details
          className="rounded-2xl overflow-hidden"
          style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <summary className="px-5 py-3.5 text-sm font-semibold text-white cursor-pointer select-none">
            How to Join & Call Rules
          </summary>
          <div className="px-5 pb-4 space-y-3 text-sm" style={{ color: "#AEAEB2" }}>
            <div>
              <p className="font-medium text-white mb-1">How to Join</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Return to this page 15 minutes before your call.</li>
                <li>Click "Join Call" — your camera & mic will activate.</li>
                <li>Allow browser permissions for camera and microphone.</li>
                <li>Test your audio/video before the call starts.</li>
              </ol>
            </div>
            <div>
              <p className="font-medium text-white mb-1">Call Etiquette</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Be on time — the call starts at the scheduled time.</li>
                <li>Use a quiet, well-lit space.</li>
                <li>Treat your host and other participants with respect.</li>
                <li>Recording or screenshots are not permitted.</li>
                <li>If you experience issues, refresh the page and rejoin.</li>
              </ul>
            </div>
          </div>
        </details>

        <button
          onClick={() => navigate("/hangouts")}
          className="w-full py-2.5 rounded-xl text-sm font-medium"
          style={{ color: "#8E8E93", background: "none", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Back to Hangouts
        </button>
      </div>

      <PostCallSurveyModal
        open={showSurvey}
        bookingId={Number(bookingId)}
        creatorName={booking.creator_username || "Creator"}
        onClose={() => setShowSurvey(false)}
      />
    </div>
  );
}
