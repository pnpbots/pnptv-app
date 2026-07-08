import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  setAcceptingCalls,
  getAcceptingCallsStatus,
  getCreatorCallEarnings,
  getCreatorCallBookings,
  ApiError,
  type CreatorCallEarnings,
  type CreatorCallBooking,
} from "@/lib/api";
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

// ─── Call Earnings summary ────────────────────────────────────────────────────

function CallEarningsSummary() {
  const [earnings, setEarnings] = useState<CreatorCallEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCreatorCallEarnings()
      .then((res) => {
        if (!cancelled) setEarnings(res.earnings);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl p-4 animate-pulse"
            style={{ ...cardStyle, minHeight: 72 }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (error || !earnings) {
    return (
      <p className="text-xs text-center py-4" style={{ color: "rgba(255,255,255,0.38)" }}>
        Could not load earnings data.
      </p>
    );
  }

  const stats: { label: string; value: string }[] = [
    {
      label: "Total Revenue",
      value: `$${Number(earnings.totalRevenue).toFixed(2)}`,
    },
    {
      label: "Calls Sold",
      value: String(earnings.totalCallsSold),
    },
    {
      label: "Calls Completed",
      value: String(earnings.totalCallsCompleted),
    },
    {
      label: "Avg Rating",
      value:
        earnings.totalReviews > 0
          ? `⭐ ${Number(earnings.averageRating).toFixed(1)} / 5`
          : "No reviews yet",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map(({ label, value }) => (
        <div key={label} className="rounded-xl p-4 flex flex-col gap-1" style={cardStyle}>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.45)" }}>
            {label}
          </span>
          <span className="text-base font-bold leading-tight text-white">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Bookings list ────────────────────────────────────────────────────────────

type BookingTab = "upcoming" | "completed" | "cancelled";

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  upcoming:  { label: "Upcoming",   color: "#5AC8FA", bg: "rgba(90,200,250,0.12)"  },
  active:    { label: "Active",     color: "#34C759", bg: "rgba(52,199,89,0.12)"   },
  completed: { label: "Completed",  color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.07)" },
  cancelled: { label: "Cancelled",  color: "#FF453A", bg: "rgba(255,69,58,0.12)"   },
  expired:   { label: "Expired",    color: "#FF9F0A", bg: "rgba(255,159,10,0.12)"  },
  pending:   { label: "Pending",    color: "#FF9F0A", bg: "rgba(255,159,10,0.12)"  },
};

function statusBadge(status: string) {
  const cfg = STATUS_BADGE[status] ?? { label: status, color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.07)" };
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function BookingRow({ booking, tab }: { booking: CreatorCallBooking; tab: BookingTab }) {
  const remaining = booking.quantity_total - booking.quantity_used - booking.quantity_scheduled;

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Avatar + member */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {booking.member_photo ? (
          <img
            src={booking.member_photo}
            alt=""
            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
            style={{ background: "#D4007A" }}
            aria-hidden="true"
          >
            {(booking.member_display_name || booking.member_username || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-white truncate leading-snug">
            {booking.member_display_name || booking.member_username}
          </span>
          {booking.member_display_name && booking.member_username && (
            <span className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.45)" }}>
              @{booking.member_username}
            </span>
          )}
        </div>
      </div>

      {/* Package details */}
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-xs font-medium text-white truncate">{booking.package_title}</span>
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
          {booking.duration_minutes} min · ${Number(booking.price_usd).toFixed(2)}
        </span>
      </div>

      {/* Quantity */}
      <div className="flex flex-col gap-0.5 flex-shrink-0 text-right">
        <span className="text-xs font-medium text-white">
          {booking.quantity_used}/{booking.quantity_total} used
        </span>
        {tab === "upcoming" && remaining > 0 && (
          <span className="text-[11px]" style={{ color: "#D4007A" }}>
            {remaining} remaining
          </span>
        )}
      </div>

      {/* Right: status + date */}
      <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-1 flex-shrink-0">
        {statusBadge(booking.status)}
        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          {formatDate(booking.created_at)}
        </span>
      </div>
    </div>
  );
}

function CallBookingsList() {
  const [activeTab, setActiveTab] = useState<BookingTab>("upcoming");
  const [bookings, setBookings] = useState<CreatorCallBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getCreatorCallBookings(activeTab)
      .then((res) => {
        if (!cancelled) setBookings(res.bookings ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab]);

  const tabs: { key: BookingTab; label: string }[] = [
    { key: "upcoming",  label: "Upcoming"  },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Tab pills */}
      <div className="flex gap-2">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="text-xs font-semibold px-3 py-1 rounded-full transition-colors"
            style={
              activeTab === key
                ? { background: "#D4007A", color: "#fff" }
                : {
                    background: "rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.55)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }
            }
            aria-pressed={activeTab === key}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl animate-pulse"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                height: 72,
              }}
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-center py-6" style={{ color: "rgba(255,255,255,0.38)" }}>
          Could not load bookings. Please try again.
        </p>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-1 py-10">
          <span className="text-sm font-medium text-white">No calls yet</span>
          <span className="text-xs text-center" style={{ color: "rgba(255,255,255,0.38)" }}>
            {activeTab === "upcoming"
              ? "Members who purchase your call packages will appear here."
              : activeTab === "completed"
              ? "Completed sessions will appear here."
              : "Cancelled bookings will appear here."}
          </span>
        </div>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div className="flex flex-col gap-2">
          {bookings.map((b) => (
            <BookingRow key={b.id} booking={b} tab={activeTab} />
          ))}
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

          {/* ── Call Earnings ── */}
          <p className="text-[11px] font-bold uppercase tracking-widest mb-3 mt-8" style={{ color: "rgba(255,255,255,0.45)" }}>
            Call Earnings
          </p>
          <CallEarningsSummary />

          {/* ── Bookings ── */}
          <p className="text-[11px] font-bold uppercase tracking-widest mb-3 mt-8" style={{ color: "rgba(255,255,255,0.45)" }}>
            Call Bookings
          </p>
          <CallBookingsList />
        </div>
      </div>
    </>
  );
}
