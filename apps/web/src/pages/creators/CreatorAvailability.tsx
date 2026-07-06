import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { setAcceptingCalls, getAcceptingCallsStatus, ApiError } from "@/lib/api";
import { CallPackageManager } from "@/pages/creator/CallPackageManager";

// ─── Countdown timer ─────────────────────────────────────────────────────────

function useCountdown(untilIso: string | null): string | null {
  const [display, setDisplay] = useState<string | null>(null);

  useEffect(() => {
    if (!untilIso) {
      setDisplay(null);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, new Date(untilIso).getTime() - Date.now());
      if (remaining === 0) {
        setDisplay("00:00");
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setDisplay(`${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [untilIso]);

  return display;
}

// ─── Inline microtoast (avoids dependency on NotificationProvider which
//     wraps the full app — these are ephemeral creator-local messages) ─────────

interface MicroToastState {
  message: string;
  variant: "success" | "error" | "info";
  id: number;
}

function MicroToast({ toast, onDone }: { toast: MicroToastState; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(id);
  }, [toast.id, onDone]);

  const colors: Record<MicroToastState["variant"], string> = {
    success: "rgba(52,199,89,0.15)",
    error: "rgba(255,69,58,0.15)",
    info: "rgba(90,200,250,0.12)",
  };
  const borders: Record<MicroToastState["variant"], string> = {
    success: "rgba(52,199,89,0.35)",
    error: "rgba(255,69,58,0.35)",
    info: "rgba(90,200,250,0.3)",
  };
  const textColors: Record<MicroToastState["variant"], string> = {
    success: "#34C759",
    error: "#FF453A",
    info: "#5AC8FA",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="text-xs font-medium px-3 py-2 rounded-xl text-center"
      style={{
        background: colors[toast.variant],
        border: `1px solid ${borders[toast.variant]}`,
        color: textColors[toast.variant],
      }}
    >
      {toast.message}
    </div>
  );
}

// ─── Toggle card ─────────────────────────────────────────────────────────────

function AcceptingCallsToggle() {
  const { user } = useAuth();
  const creatorId = String(user?.dbId || user?.id || "");

  const [accepting, setAccepting] = useState(false);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [acceptingUntil, setAcceptingUntil] = useState<string | null>(null);
  const [toast, setToast] = useState<MicroToastState | null>(null);
  const toastCounterRef = useRef(0);
  const countdown = useCountdown(accepting ? acceptingUntil : null);

  // When countdown hits "00:00" flip accepting off locally
  useEffect(() => {
    if (accepting && countdown === "00:00") {
      setAccepting(false);
      setAcceptingUntil(null);
    }
  }, [accepting, countdown]);

  const pushToast = useCallback(
    (message: string, variant: MicroToastState["variant"] = "info") => {
      toastCounterRef.current += 1;
      setToast({ message, variant, id: toastCounterRef.current });
    },
    []
  );

  // Load initial state
  useEffect(() => {
    if (!creatorId) return;
    let cancelled = false;
    getAcceptingCallsStatus(creatorId)
      .then((res) => {
        if (cancelled) return;
        setAccepting(res.accepting);
        setOnline(res.online);
      })
      .catch(() => {/* non-fatal — show defaults */})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [creatorId]);

  /**
   * Sends `accepting: desiredState` to the backend.
   *
   * Behaviour:
   *   - OFF → ON: normal activation; sets acceptingUntil from the response.
   *   - ON  → ON (re-click / explicit refresh): refreshes the 60-min TTL;
   *     shows "Refreshed" microtoast.
   *   - ON  → OFF (via "Turn off" button): deactivates.
   */
  const sendAccepting = useCallback(
    async (desired: boolean, isRefresh = false) => {
      if (toggling) return;
      setToggling(true);
      try {
        const res = await setAcceptingCalls(desired);
        setAccepting(desired);
        if (desired && res.acceptingUntil) {
          setAcceptingUntil(res.acceptingUntil);
          if (isRefresh) {
            pushToast("Refreshed — 60 min extended", "success");
          }
        } else if (!desired) {
          setAcceptingUntil(null);
        }
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === "must_be_online_first") {
            pushToast("You need to be active in the app first.", "error");
          } else if (err.code === "cannot_accept_calls_while_live") {
            pushToast("Can't accept calls while broadcasting Live. End your stream first.", "error");
          } else if (err.code === "no_active_packages") {
            pushToast("no_active_packages", "error");
          } else {
            pushToast(err.message || "Something went wrong. Please try again.", "error");
          }
        } else {
          pushToast("Something went wrong. Please try again.", "error");
        }
      } finally {
        setToggling(false);
      }
    },
    [toggling, pushToast]
  );

  // Toggle click: OFF → ON normal; ON → refresh TTL (do NOT turn off on toggle click)
  const handleToggleClick = useCallback(() => {
    if (accepting) {
      sendAccepting(true, true);
    } else {
      sendAccepting(true, false);
    }
  }, [accepting, sendAccepting]);

  // Explicit turn-off
  const handleTurnOff = useCallback(() => {
    sendAccepting(false, false);
  }, [sendAccepting]);

  if (loading) {
    return (
      <div
        className="p-4 rounded-xl animate-pulse"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 88 }}
        aria-hidden="true"
      />
    );
  }

  const isNoPackagesToast = toast?.message === "no_active_packages";

  return (
    <div
      className="p-4 rounded-xl space-y-3"
      style={{
        background: accepting
          ? "rgba(212,0,122,0.07)"
          : "var(--pnp-surface, #1C1C1E)",
        border: accepting
          ? "1px solid rgba(212,0,122,0.28)"
          : "1px solid rgba(255,255,255,0.08)",
        transition: "background 0.25s ease, border-color 0.25s ease",
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-white leading-snug">
            Available for private calls right now
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Members can book a call starting in the next 5-60 minutes. Auto-turns off after 60 min. You'll get a Telegram message and push notification to renew before it expires.
          </p>
        </div>

        {/*
          Toggle switch — aria role="switch" (ARIA toggle pattern).
          While ON: clicking again REFRESHES the TTL rather than turning off
          (spec-required). The "Turn off" link below is the explicit off path.
        */}
        <button
          role="switch"
          aria-checked={accepting}
          aria-label={
            accepting
              ? "Available for private calls — click to extend time"
              : "Toggle available for private calls right now"
          }
          onClick={handleToggleClick}
          disabled={toggling}
          className="flex-shrink-0 relative inline-flex h-[28px] w-[50px] items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: accepting ? "#D4007A" : "rgba(255,255,255,0.15)",
          }}
        >
          <span
            className="inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200"
            style={{ transform: accepting ? "translateX(24px)" : "translateX(3px)" }}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Active sub-row: countdown + turn-off */}
      {accepting && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background: "#D4007A",
                boxShadow: "0 0 6px rgba(212,0,122,0.6)",
              }}
              aria-hidden="true"
            />
            <span className="text-xs font-medium tabular-nums" style={{ color: "#D4007A" }}>
              {countdown && countdown !== "00:00"
                ? `Auto-off in ${countdown}`
                : "Turning off..."}
            </span>
          </div>
          <button
            onClick={handleTurnOff}
            disabled={toggling}
            className="text-xs px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "var(--pnp-text-secondary, #8E8E93)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            aria-label="Turn off accepting calls"
          >
            Turn off
          </button>
        </div>
      )}

      {/* Offline hint when toggle is OFF */}
      {!accepting && !online && (
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.38)" }}>
          You're shown as offline. Refresh or stay active in the app, then try again.
        </p>
      )}

      {/* Microtoast */}
      {toast && !isNoPackagesToast && (
        <MicroToast
          toast={toast}
          onDone={() => setToast(null)}
        />
      )}

      {/* Inline "no packages" call-to-action */}
      {isNoPackagesToast && toast && (
        <div
          role="status"
          aria-live="polite"
          className="text-xs font-medium px-3 py-2 rounded-xl flex flex-wrap items-center gap-1"
          style={{
            background: "rgba(255,69,58,0.12)",
            border: "1px solid rgba(255,69,58,0.3)",
            color: "#FF453A",
          }}
        >
          Add at least one active call package first.{" "}
          <Link
            to="/creators/availability"
            onClick={() => setToast(null)}
            className="underline font-semibold"
            style={{ color: "#FF9F0A" }}
          >
            Go to packages
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CreatorAvailability() {
  return (
    <>
      <Helmet>
        <title>Availability — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        <div className="space-y-4">
          <AcceptingCallsToggle />
          <CallPackageManager />
        </div>
      </div>
    </>
  );
}
