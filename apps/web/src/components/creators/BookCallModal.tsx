/**
 * BookCallModal — multi-step modal for booking a creator call.
 *
 * Steps:
 *  1. SELECT_PACKAGE  — choose 30 or 60 min package + quantity
 *  2. SELECT_SLOT     — choose an available time slot (offline creators only)
 *  3. CHECKOUT        — enter email + payment provider, submit
 *  4. SUCCESS         — confirmation screen (epayco / token payments only)
 *
 * For Daimo (USDC) payments the modal closes and the user is navigated to
 * the DaimoCheckout page in the same tab so the embedded Daimo modal can
 * render at full height without popup-blocker interference.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  getCreatorCallPackages,
  getBookingOptions,
  createCallCheckout,
  assertPaymentUrl,
  type CallPackage,
  type BookingSlot,
} from "@/lib/api";
import type { CreatorCardCreator } from "./CreatorCard";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "SELECT_PACKAGE" | "SELECT_SLOT" | "CHECKOUT" | "SUCCESS";
type Provider = "epayco" | "daimo";

export interface BookCallModalProps {
  creator: CreatorCardCreator;
  isOnline: boolean;
  open: boolean;
  onClose: () => void;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      style={{ width: size, height: size, color: "#D4007A" }}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// Re-export shared AvatarFallback for local use
import { AvatarFallback } from "./AvatarFallback";

// ─── Slot skeleton ────────────────────────────────────────────────────────────

function SlotSkeleton() {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading available slots">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-xl animate-pulse"
          style={{ background: "rgba(255,255,255,0.06)" }}
        />
      ))}
    </div>
  );
}

// ─── Format slot date/time ────────────────────────────────────────────────────

function formatSlotDate(utcString: string): { day: string; date: string; time: string } {
  const d = new Date(utcString);
  return {
    day: d.toLocaleDateString("en-US", { weekday: "short" }),
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookCallModal({
  creator,
  isOnline,
  open,
  onClose,
}: BookCallModalProps) {
  const navigate = useNavigate();

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("SELECT_PACKAGE");
  const [duration, setDuration] = useState<30 | 60>(30);
  const [quantity, setQuantity] = useState(1);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [provider, setProvider] = useState<Provider>("epayco");
  const [email, setEmail] = useState("");

  // ── Data state ──────────────────────────────────────────────────────────────
  const [packages, setPackages] = useState<CallPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesError, setPackagesError] = useState<string | null>(null);

  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [confirmedStartAt, setConfirmedStartAt] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const firstFocusRef = useRef<HTMLButtonElement>(null);
  // Bug H-01: in-flight guard prevents double-submit
  const checkoutInFlight = useRef(false);

  // ── Derived ─────────────────────────────────────────────────────────────────

  // Find matching package for selected duration
  const activePackage = packages.find((p) => p.duration_minutes === duration) ?? null;
  const pricePerUnit = activePackage ? parseFloat(activePackage.price_usd) : duration === 30 ? 60 : 100;
  const totalPrice = pricePerUnit * quantity;

  // ── Load packages on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    // Reset all state on open
    setStep("SELECT_PACKAGE");
    setDuration(30);
    setQuantity(1);
    setSelectedSlot(null);
    setProvider("epayco");
    setEmail("");
    setCheckoutError(null);
    setConfirmedStartAt(null);
    setIsProcessing(false);
    checkoutInFlight.current = false;

    let cancelled = false;
    setPackagesLoading(true);
    setPackagesError(null);

    getCreatorCallPackages(creator.id)
      .then((res) => {
        if (!cancelled) {
          setPackages(res.packages ?? []);
          setPackagesLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setPackagesError(err.message || "Failed to load packages.");
          setPackagesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, creator.id]);

  // ── Load slots when entering SELECT_SLOT ────────────────────────────────────
  useEffect(() => {
    if (step !== "SELECT_SLOT") return;

    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    setSlots([]);
    setSelectedSlot(null);

    getBookingOptions(creator.id, duration)
      .then((res) => {
        if (!cancelled) {
          setSlots(res.slots?.filter((s) => s.available) ?? []);
          setSlotsLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setSlotsError(err.message || "Failed to load available slots.");
          setSlotsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [step, creator.id, duration]);

  // ── Escape key — blocked while processing payment (Bug H-06) ────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isProcessing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, isProcessing]);

  // ── Auto-focus ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setTimeout(() => firstFocusRef.current?.focus(), 80);
    }
  }, [open]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleNextFromPackage = useCallback(() => {
    if (isOnline) {
      setStep("CHECKOUT");
    } else {
      setStep("SELECT_SLOT");
    }
  }, [isOnline]);

  const handleNextFromSlot = useCallback(() => {
    if (!selectedSlot) return;
    setStep("CHECKOUT");
  }, [selectedSlot]);

  const handleCheckout = useCallback(async () => {
    // Bug H-01: prevent double-submit
    if (checkoutInFlight.current || !activePackage) return;
    checkoutInFlight.current = true;
    setCheckoutLoading(true);
    setIsProcessing(true);
    setCheckoutError(null);

    try {
      const res = await createCallCheckout({
        packageId: activePackage.id,
        provider,
        email,
        quantity,
        selectedSlot: selectedSlot?.startUtc ?? null,
      });

      if (provider === "daimo" && res.checkoutUrl) {
        // Navigate in-tab to the Daimo checkout page.
        onClose();
        navigate(new URL(assertPaymentUrl(res.checkoutUrl)).pathname);
        return;
      }

      // Bug C-02: ePayco — redirect to checkoutUrl instead of showing fake SUCCESS screen.
      // The booking is not confirmed until payment webhook fires.
      if (provider === "epayco" && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }

      // Fallback: show success screen for any provider that doesn't redirect
      // (e.g. token-based or admin-created bookings)
      setConfirmedStartAt(res.startAt ?? null);
      setStep("SUCCESS");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Checkout failed. Please try again.";
      setCheckoutError(msg);
    } finally {
      setCheckoutLoading(false);
      setIsProcessing(false);
      checkoutInFlight.current = false;
    }
  }, [activePackage, provider, email, quantity, selectedSlot, onClose, navigate]);

  if (!open) return null;

  // ── Step title ───────────────────────────────────────────────────────────────

  const stepTitle: Record<Step, string> = {
    SELECT_PACKAGE: "Book a Call",
    SELECT_SLOT: "Choose a Time Slot",
    CHECKOUT: "Checkout",
    SUCCESS: "Booking Confirmed!",
  };

  // ── Render each step ─────────────────────────────────────────────────────────

  const renderPackageStep = () => {
    if (packagesLoading) {
      return (
        <div className="space-y-3 py-4" aria-busy="true">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
          ))}
        </div>
      );
    }

    if (packagesError) {
      return (
        <div className="py-6 flex flex-col items-center gap-3 text-center">
          <svg className="w-8 h-8" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm" style={{ color: "#FF453A" }}>{packagesError}</p>
          <button
            type="button"
            onClick={() => {
              setPackagesError(null);
              setPackagesLoading(true);
              getCreatorCallPackages(creator.id)
                .then((r) => { setPackages(r.packages ?? []); setPackagesLoading(false); })
                .catch((e: Error) => { setPackagesError(e.message); setPackagesLoading(false); });
            }}
            className="min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: "#D4007A" }}
          >
            Try Again
          </button>
        </div>
      );
    }

    if (packages.length === 0) {
      return (
        <div className="py-8 flex flex-col items-center gap-3 text-center">
          <svg className="w-10 h-10" style={{ color: "#636366" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#EBEBF5" }}>No packages available yet</p>
          <p className="text-xs" style={{ color: "#636366" }}>This creator hasn't set up call packages yet. Check back soon.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Online status notice */}
        {isOnline && (
          <div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm"
            style={{ background: "rgba(52,199,89,0.10)", border: "1px solid rgba(52,199,89,0.20)" }}
          >
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#34C759" }} />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: "#34C759" }} />
            </span>
            <span style={{ color: "#34C759" }}>
              Online Now — call starts in ~15 minutes
            </span>
          </div>
        )}

        {/* Duration options */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "#8E8E93" }}>Select Duration</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { mins: 30 as const, label: "30 min", badge: "Most Popular", price: packages.find((p) => p.duration_minutes === 30)?.price_usd ?? "60" },
              { mins: 60 as const, label: "60 min", badge: null, price: packages.find((p) => p.duration_minutes === 60)?.price_usd ?? "100" },
            ].map(({ mins, label, badge, price }) => {
              const isSelected = duration === mins;
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDuration(mins)}
                  aria-pressed={isSelected}
                  aria-label={`Select ${label} call for $${price}`}
                  className={clsx(
                    "relative flex flex-col items-center gap-1 min-h-[80px] rounded-2xl py-3 px-2",
                    "transition-all duration-150 active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  )}
                  style={
                    isSelected
                      ? {
                          background: "linear-gradient(135deg, rgba(212,0,122,0.18), rgba(230,145,56,0.12))",
                          border: "1.5px solid #D4007A",
                        }
                      : {
                          background: "rgba(255,255,255,0.04)",
                          border: "1.5px solid rgba(255,255,255,0.10)",
                        }
                  }
                >
                  {badge && (
                    <span
                      className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                      style={{ background: "linear-gradient(90deg, #D4007A, #E69138)", color: "#fff" }}
                    >
                      {badge}
                    </span>
                  )}
                  <span className="text-base font-bold" style={{ color: isSelected ? "#D4007A" : "#EBEBF5" }}>
                    {label}
                  </span>
                  <span className="text-xl font-extrabold" style={{ color: isSelected ? "#E69138" : "#EBEBF5" }}>
                    ${parseFloat(price).toFixed(0)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quantity stepper */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "#8E8E93" }}>Quantity</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80 active:scale-95"
              style={{ background: "rgba(255,255,255,0.08)", color: "#EBEBF5" }}
            >
              −
            </button>
            <span
              className="text-xl font-bold min-w-[2ch] text-center"
              aria-live="polite"
              aria-atomic="true"
              style={{ color: "#EBEBF5" }}
            >
              {quantity}
            </span>
            <button
              type="button"
              aria-label="Increase quantity"
              disabled={quantity >= 10}
              onClick={() => setQuantity((q) => Math.min(10, q + 1))}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80 active:scale-95"
              style={{ background: "rgba(255,255,255,0.08)", color: "#EBEBF5" }}
            >
              +
            </button>
            <span className="ml-auto text-base font-bold" style={{ color: "#EBEBF5" }}>
              Total: <span style={{ color: "#E69138" }}>${(pricePerUnit * quantity).toFixed(0)}</span>
            </span>
          </div>
        </div>

        {/* Go to Live Channel (when online) */}
        {isOnline && (
          <a
            href={`/live`}
            className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.06)", color: "#EBEBF5", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            Go to Live Channel
          </a>
        )}

        {/* Next button */}
        <button
          ref={firstFocusRef}
          type="button"
          onClick={handleNextFromPackage}
          disabled={packages.length === 0}
          className="w-full min-h-[48px] rounded-2xl text-base font-bold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
        >
          Next →
        </button>
      </div>
    );
  };

  const renderSlotStep = () => (
    <div className="space-y-4">
      {slotsLoading && <SlotSkeleton />}

      {!slotsLoading && slotsError && (
        <div className="py-6 flex flex-col items-center gap-3 text-center">
          <svg className="w-7 h-7" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-sm" style={{ color: "#FF453A" }}>{slotsError}</p>
          <button
            type="button"
            onClick={() => {
              setSlotsError(null);
              setSlotsLoading(true);
              getBookingOptions(creator.id, duration)
                .then((r) => { setSlots(r.slots?.filter((s) => s.available) ?? []); setSlotsLoading(false); })
                .catch((e: Error) => { setSlotsError(e.message); setSlotsLoading(false); });
            }}
            className="min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: "#D4007A" }}
          >
            Try Again
          </button>
        </div>
      )}

      {!slotsLoading && !slotsError && slots.length === 0 && (
        <div className="py-8 flex flex-col items-center gap-2 text-center">
          <svg className="w-10 h-10" style={{ color: "#636366" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#EBEBF5" }}>No available slots</p>
          <p className="text-xs" style={{ color: "#636366" }}>Try a different duration or check back later.</p>
        </div>
      )}

      {!slotsLoading && !slotsError && slots.length > 0 && (
        <div className="space-y-2.5" role="listbox" aria-label="Available time slots">
          <p className="text-xs pb-0.5" style={{ color: "#8E8E93" }}>
            Times shown in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
          </p>
          {slots.slice(0, 5).map((slot) => {
            const { day, date, time } = formatSlotDate(slot.startUtc);
            const isSelected = selectedSlot?.startUtc === slot.startUtc;
            return (
              <button
                key={slot.startUtc}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => setSelectedSlot(slot)}
                className={clsx(
                  "w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left",
                  "transition-all duration-150 active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                )}
                style={
                  isSelected
                    ? { background: "rgba(212,0,122,0.12)", border: "1.5px solid #D4007A" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
                }
              >
                <div
                  className="w-10 h-10 rounded-lg flex flex-col items-center justify-center flex-shrink-0"
                  style={{ background: isSelected ? "rgba(212,0,122,0.20)" : "rgba(255,255,255,0.06)" }}
                >
                  <span className="text-[10px] font-semibold uppercase" style={{ color: isSelected ? "#D4007A" : "#8E8E93" }}>{day}</span>
                  <span className="text-sm font-bold leading-tight" style={{ color: isSelected ? "#D4007A" : "#EBEBF5" }}>{date.split(" ")[1]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "#EBEBF5" }}>{date}</p>
                  <p className="text-xs" style={{ color: "#8E8E93" }}>{time} — {duration} min</p>
                </div>
                {isSelected && (
                  <svg className="w-5 h-5 flex-shrink-0" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        disabled={!selectedSlot}
        onClick={handleNextFromSlot}
        className="w-full min-h-[48px] rounded-2xl text-base font-bold text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
      >
        Next →
      </button>
    </div>
  );

  const renderCheckoutStep = () => (
    <div className="space-y-5">
      {/* Order summary */}
      <div
        className="rounded-2xl p-4 space-y-2.5"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8E8E93" }}>Order Summary</p>
        <div className="flex justify-between text-sm">
          <span style={{ color: "#8E8E93" }}>Creator</span>
          <span className="font-semibold" style={{ color: "#EBEBF5" }}>@{creator.username}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "#8E8E93" }}>Duration</span>
          <span className="font-semibold" style={{ color: "#EBEBF5" }}>{duration} min × {quantity}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "#8E8E93" }}>Time Slot</span>
          <span className="font-semibold" style={{ color: "#EBEBF5" }}>
            {isOnline
              ? "In ~15 minutes"
              : selectedSlot
                ? (() => { const { date, time } = formatSlotDate(selectedSlot.startUtc); return `${date} · ${time}`; })()
                : "—"}
          </span>
        </div>
        <div
          className="flex justify-between text-base pt-2 font-bold"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span style={{ color: "#EBEBF5" }}>Total</span>
          <span style={{ color: "#E69138" }}>${totalPrice.toFixed(0)}</span>
        </div>
      </div>

      {/* Payment provider toggle */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "#8E8E93" }}>Payment Method</p>
        <div className="flex gap-2">
          {(["epayco", "daimo"] as Provider[]).map((p) => {
            const label = p === "epayco" ? "Card (ePayco)" : "Crypto (Daimo)";
            return (
              <button
                key={p}
                type="button"
                aria-pressed={provider === p}
                onClick={() => setProvider(p)}
                className={clsx(
                  "flex-1 min-h-[44px] rounded-xl text-sm font-semibold transition-all duration-150 active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                )}
                style={
                  provider === p
                    ? { background: "rgba(212,0,122,0.16)", border: "1.5px solid #D4007A", color: "#D4007A" }
                    : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "#8E8E93" }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        {provider === "daimo" && (
          <p className="text-[11px] mt-2" style={{ color: "#8E8E93" }}>
            You will be taken to a secure USDC checkout page. Return here after completing payment.
          </p>
        )}
      </div>

      {/* Email input */}
      <div>
        <label htmlFor="checkout-email" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#8E8E93" }}>
          Email for Receipt
        </label>
        <input
          id="checkout-email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full px-4 py-3 rounded-xl text-sm transition-colors focus:outline-none"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#EBEBF5",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "#D4007A"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
        />
      </div>

      {/* Error */}
      {checkoutError && (
        <div className="flex items-start gap-2 text-sm" style={{ color: "#FF453A" }}>
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>{checkoutError}</span>
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        disabled={checkoutLoading || !email.trim() || !activePackage}
        onClick={handleCheckout}
        className={clsx(
          "w-full min-h-[48px] rounded-2xl text-base font-bold text-white",
          "flex items-center justify-center gap-2",
          "transition-opacity disabled:opacity-50 disabled:cursor-not-allowed",
          "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        )}
        style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
      >
        {checkoutLoading ? (
          <>
            <Spinner size={18} />
            <span>Processing...</span>
          </>
        ) : provider === "daimo" ? (
          "Pay with Crypto (USDC)"
        ) : (
          "Proceed to Checkout"
        )}
      </button>
    </div>
  );

  const renderSuccessStep = () => (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      {/* Animated checkmark */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center"
        style={{ background: "rgba(52,199,89,0.14)" }}
      >
        <svg
          className="w-10 h-10"
          style={{ color: "#34C759" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
            strokeDasharray="30"
            strokeDashoffset="0"
            style={{ animation: "draw-check 0.4s ease forwards" }}
          />
        </svg>
      </div>

      <div>
        <h3 className="text-xl font-bold" style={{ color: "#EBEBF5" }}>Booking Confirmed!</h3>
        <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
          {confirmedStartAt
            ? (() => { const { date, time } = formatSlotDate(confirmedStartAt); return `Your call is scheduled for ${date} at ${time}`; })()
            : isOnline
              ? "Your call will start in approximately 15 minutes."
              : "Your booking has been received."}
        </p>
      </div>

      <div
        className="w-full rounded-2xl p-4 text-left space-y-2"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8E8E93" }}>Call Details</p>
        <p className="text-sm" style={{ color: "#EBEBF5" }}>
          <span style={{ color: "#8E8E93" }}>Creator: </span>@{creator.username}
        </p>
        <p className="text-sm" style={{ color: "#EBEBF5" }}>
          <span style={{ color: "#8E8E93" }}>Duration: </span>{duration} min
        </p>
      </div>

      <div className="flex flex-col gap-2.5 w-full">
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] rounded-2xl text-sm font-semibold transition-opacity hover:opacity-80 active:scale-[0.98]"
          style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          Close
        </button>
      </div>
    </div>
  );

  const stepContent: Record<Step, React.ReactNode> = {
    SELECT_PACKAGE: renderPackageStep(),
    SELECT_SLOT: renderSlotStep(),
    CHECKOUT: renderCheckoutStep(),
    SUCCESS: renderSuccessStep(),
  };

  const canGoBack = step === "SELECT_SLOT" || step === "CHECKOUT";
  const handleBack = () => {
    if (step === "CHECKOUT") setStep(isOnline ? "SELECT_PACKAGE" : "SELECT_SLOT");
    if (step === "SELECT_SLOT") setStep("SELECT_PACKAGE");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.70)" }}
      onClick={isProcessing ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Book a call with ${creator.username}`}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{
          background: "#1C1C1E",
          border: "1px solid rgba(255,255,255,0.08)",
          maxHeight: "90dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Modal header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          {/* Back button */}
          {canGoBack && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Go back"
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-opacity hover:opacity-80 active:scale-95 focus-visible:outline-none focus-visible:ring-2"
              style={{ background: "rgba(255,255,255,0.08)", color: "#EBEBF5" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
          )}

          {/* Creator avatar + name */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
              {creator.photo_url
                ? <img src={creator.photo_url} alt="" className="w-full h-full object-cover" />
                : <AvatarFallback username={creator.username} size={32} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "#EBEBF5" }}>
                {stepTitle[step]}
              </p>
              <p className="text-xs truncate" style={{ color: "#8E8E93" }}>
                @{creator.username}
                {isOnline && (
                  <span className="ml-1.5" style={{ color: "#34C759" }}>● Online</span>
                )}
              </p>
            </div>
          </div>

          {/* Close — disabled while payment is in-flight (Bug H-06) */}
          <button
            type="button"
            onClick={isProcessing ? undefined : onClose}
            disabled={isProcessing}
            aria-label="Close booking modal"
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-opacity hover:opacity-80 active:scale-95 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "rgba(255,255,255,0.08)", color: "#8E8E93" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator (dots) */}
        {step !== "SUCCESS" && (
          <div className="flex items-center justify-center gap-1.5 py-2.5 flex-shrink-0" aria-hidden="true">
            {(["SELECT_PACKAGE", "SELECT_SLOT", "CHECKOUT"] as Step[]).map((s) => {
              const steps: Step[] = isOnline
                ? ["SELECT_PACKAGE", "CHECKOUT"]
                : ["SELECT_PACKAGE", "SELECT_SLOT", "CHECKOUT"];
              if (!steps.includes(s)) return null;
              const isActive = s === step;
              const isDone = steps.indexOf(step) > steps.indexOf(s);
              return (
                <span
                  key={s}
                  className="transition-all duration-200 rounded-full"
                  style={{
                    width: isActive ? 20 : 6,
                    height: 6,
                    background: isDone ? "#34C759" : isActive ? "#D4007A" : "rgba(255,255,255,0.15)",
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-2">
          {stepContent[step]}
        </div>
      </div>

      {/* CSS for checkmark draw animation */}
      <style>{`
        @keyframes draw-check {
          from { stroke-dashoffset: 30; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
