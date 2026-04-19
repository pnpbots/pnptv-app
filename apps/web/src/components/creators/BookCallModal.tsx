/**
 * BookCallModal — multi-step modal for booking a creator call.
 *
 * Steps:
 *  0. SELECT_MODEL  — pick a performer from a grid (only when no creator is
 *                     pre-selected, i.e. user clicked a package card directly)
 *  1. SELECT_SLOT   — choose a time slot; shows "NOW" when creator is online,
 *                     live-show banner when they are live, "See More" for page 2
 *  2. CHECKOUT      — enter email + payment provider, submit
 *  3. SUCCESS       — confirmation (non-redirect providers only)
 *
 * When `skipPackageStep` is true the SELECT_PACKAGE step is bypassed and
 * `initialDuration` is used as the fixed duration (set by CallPackageCards).
 *
 * For Daimo (USDC) payments the modal closes and the user is navigated to
 * the DaimoCheckout page in the same tab so the embedded Daimo modal can
 * render at full height without popup-blocker interference.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n";
import {
  getCreatorCallPackages,
  getBookingOptions,
  createCallCheckout,
  createCallCheckoutDash,
  getBookingPaymentStatus,
  assertPaymentUrl,
  type CallPackage,
  type BookingSlot,
  type FeaturedPerformer,
} from "@/lib/api";
import type { CreatorCardCreator } from "./CreatorCard";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "SELECT_MODEL" | "SELECT_PACKAGE" | "SELECT_SLOT" | "CHECKOUT" | "SUCCESS";
type Provider = "epayco" | "dash";

export interface BookCallModalProps {
  creator: CreatorCardCreator;
  isOnline: boolean;
  open: boolean;
  onClose: () => void;
  /** When set, skip SELECT_PACKAGE and use this as the fixed duration. */
  initialDuration?: 30 | 60;
  /** When true, skip the SELECT_PACKAGE step entirely. */
  skipPackageStep?: boolean;
  /** Performer list for SELECT_MODEL step. Only used when creator.id is empty. */
  performers?: FeaturedPerformer[];
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

// ─── Slot skeleton ────────────────────────────────────────────────────────────

function SlotSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label={label}>
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

// ─── Performer grid skeleton ───────────────────────────────────────────────────

function PerformerSkeleton({ label }: { label: string }) {
  return (
    <div
      className="grid gap-2.5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5">
          <div className="w-16 h-16 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
          <div className="h-3 w-14 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
      ))}
    </div>
  );
}

// ─── Format slot date/time ────────────────────────────────────────────────────

function formatSlotDate(utcString: string): { day: string; date: string; time: string } {
  const d = new Date(utcString);
  const timeParts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(d);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "";
  const dayPeriod = timeParts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const tzName = timeParts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return {
    day: d.toLocaleDateString("en-US", { weekday: "short" }),
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    time: `${hour}:${minute} ${dayPeriod}${tzName ? ` ${tzName}` : ""}`.trim(),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookCallModal({
  creator: initialCreator,
  isOnline: initialIsOnline,
  open,
  onClose,
  initialDuration = 30,
  skipPackageStep = false,
  performers = [],
}: BookCallModalProps) {
  const navigate = useNavigate();
  const t = useI18n();

  // ── Wizard state ────────────────────────────────────────────────────────────
  const needsModelStep = skipPackageStep && !initialCreator.id;
  const firstStep: Step = needsModelStep
    ? "SELECT_MODEL"
    : skipPackageStep
    ? "SELECT_SLOT"
    : "SELECT_PACKAGE";

  const [step, setStep] = useState<Step>(firstStep);
  const [creator, setCreator] = useState<CreatorCardCreator>(initialCreator);
  const [isOnline, setIsOnline] = useState(initialIsOnline);
  const [duration, setDuration] = useState<30 | 60>(initialDuration);
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
  const [hasMoreSlots, setHasMoreSlots] = useState(false);
  const [slotsOffset, setSlotsOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isCreatorLive, setIsCreatorLive] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [confirmedStartAt, setConfirmedStartAt] = useState<string | null>(null);
  const [confirmedRoomName, setConfirmedRoomName] = useState<string | null>(null);
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | number | null>(null);
  const [dashTimedOut, setDashTimedOut] = useState(false);
  const [dashPaymentId, setDashPaymentId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryPayload, setRetryPayload] = useState<{
    packageId: number;
    provider: Provider;
    email: string;
    quantity: number;
    selectedSlot: string | null;
  } | null>(null);

  // Join Call state (loading/error shown while navigating)
  const [joinCallLoading, setJoinCallLoading] = useState(false);
  const [joinCallError, setJoinCallError] = useState<string | null>(null);

  // Permission preflight state
  const [permissionWarning, setPermissionWarning] = useState<"camera" | "microphone" | "both" | null>(null);

  // Performer search state (SELECT_MODEL step)
  const [performersLoading] = useState(false);

  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const checkoutInFlight = useRef(false);
  const dashPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const activePackage = packages.find((p) => p.duration_minutes === duration) ?? null;
  const pricePerUnit = activePackage
    ? parseFloat(activePackage.price_usd)
    : duration === 30
    ? 60
    : 100;

  // ── Reset on open / cleanup on close ────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      // Clear Dash poll on modal close
      if (dashPollRef.current) {
        clearInterval(dashPollRef.current);
        dashPollRef.current = null;
      }
      return;
    }

    const initStep: Step = !initialCreator.id
      ? "SELECT_MODEL"
      : skipPackageStep
      ? "SELECT_SLOT"
      : "SELECT_PACKAGE";

    setStep(initStep);
    setCreator(initialCreator);
    setIsOnline(initialIsOnline);
    setDuration(initialDuration);
    setSelectedSlot(null);
    setProvider("epayco");
    setEmail("");
    setCheckoutError(null);
    setConfirmedStartAt(null);
    setConfirmedRoomName(null);
    setConfirmedBookingId(null);
    setDashTimedOut(false);
    setDashPaymentId(null);
    setIsProcessing(false);
    setRetryPayload(null);
    setJoinCallLoading(false);
    setJoinCallError(null);
    checkoutInFlight.current = false;
    setSlots([]);
    setSlotsOffset(0);
    setHasMoreSlots(false);
    setIsCreatorLive(false);
    setLiveMessage(null);

    // Permissions preflight
    if (typeof navigator.permissions?.query === "function") {
      Promise.allSettled([
        navigator.permissions.query({ name: "camera" as PermissionName }),
        navigator.permissions.query({ name: "microphone" as PermissionName }),
      ]).then(([camResult, micResult]) => {
        const camDenied = camResult.status === "fulfilled" && camResult.value.state === "denied";
        const micDenied = micResult.status === "fulfilled" && micResult.value.state === "denied";
        if (camDenied && micDenied) setPermissionWarning("both");
        else if (camDenied) setPermissionWarning("camera");
        else if (micDenied) setPermissionWarning("microphone");
        else setPermissionWarning(null);
      });
    }
  }, [open, initialCreator, initialIsOnline, initialDuration, skipPackageStep]);

  // Clear Dash poll on unmount
  useEffect(() => {
    return () => {
      if (dashPollRef.current) {
        clearInterval(dashPollRef.current);
        dashPollRef.current = null;
      }
    };
  }, []);

  // ── Load packages ────────────────────────────────────────────────────────────
  // Runs when entering SELECT_PACKAGE (normal flow) OR when entering SELECT_SLOT
  // after skipPackageStep=true so that packages are ready by CHECKOUT.
  useEffect(() => {
    const shouldLoad =
      (step === "SELECT_PACKAGE" || step === "SELECT_SLOT") &&
      creator.id &&
      packages.length === 0 &&
      !packagesLoading &&
      !packagesError;

    if (!shouldLoad) return;

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
          setPackagesError(err.message || t.creator.failedLoadPackages);
          setPackagesLoading(false);
        }
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, creator.id]);

  // ── Load slots when entering SELECT_SLOT ────────────────────────────────────
  const loadSlots = useCallback(
    (offset: number, append: boolean) => {
      if (!creator.id) return;

      if (append) {
        setLoadingMore(true);
      } else {
        setSlotsLoading(true);
        setSlotsError(null);
        if (!append) setSlots([]);
        setSelectedSlot(null);
      }

      getBookingOptions(creator.id, duration, offset)
        .then((res) => {
          const newSlots = (res.slots ?? []).filter((s) => s.available);
          setSlots((prev) => (append ? [...prev, ...newSlots] : newSlots));
          setHasMoreSlots(res.hasMore ?? false);
          setIsCreatorLive(res.isLive ?? false);
          setLiveMessage(res.liveMessage ?? null);
        })
        .catch((err: Error) => {
          if (!append) setSlotsError(err.message || t.creator.failedLoadSlots);
        })
        .finally(() => {
          setSlotsLoading(false);
          setLoadingMore(false);
        });
    },
    [creator.id, duration]
  );

  useEffect(() => {
    if (step !== "SELECT_SLOT") return;
    setSlotsOffset(0);
    loadSlots(0, false);
  }, [step, creator.id, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeeMore = () => {
    const newOffset = slotsOffset + 5;
    setSlotsOffset(newOffset);
    loadSlots(newOffset, true);
  };

  // ── Escape key + focus trap ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isProcessing) {
        onClose();
        return;
      }
      // Focus trap: constrain Tab/Shift+Tab within modal
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const focusableArr = Array.from(focusable).filter((el) => !el.hasAttribute("disabled"));
        if (focusableArr.length === 0) return;
        const first = focusableArr[0];
        const last = focusableArr[focusableArr.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, isProcessing]);

  // ── Auto-focus ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setTimeout(() => firstFocusRef.current?.focus(), 80);
    }
  }, [open]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleSelectPerformer = (p: FeaturedPerformer) => {
    const asCreator: CreatorCardCreator = {
      id: p.userId ?? p.id,
      username: p.displayName,
      photo_url: p.photoUrl,
      creator_type: "full_time",
      creator_price_usd: p.basePrice ?? 60,
      bio: p.bio,
    };
    setCreator(asCreator);
    setIsOnline(p.isLive === true);
    setStep("SELECT_SLOT");
  };

  const handleNextFromPackage = useCallback(() => {
    if (isOnline) {
      setStep("CHECKOUT");
    } else {
      setStep("SELECT_SLOT");
    }
  }, [isOnline]);

  const handleNextFromSlot = useCallback(() => {
    if (!selectedSlot && !isOnline) return;
    setStep("CHECKOUT");
  }, [selectedSlot, isOnline]);

  const handleCheckout = useCallback(async () => {
    if (checkoutInFlight.current || !activePackage) return;
    checkoutInFlight.current = true;
    setCheckoutLoading(true);
    setIsProcessing(true);
    setCheckoutError(null);

    try {
      // Dash uses a separate endpoint that creates a BTCPay invoice
      if (provider === "dash") {
        const dashRes = await createCallCheckoutDash(
          activePackage.id,
          selectedSlot?.startUtc ?? undefined,
          selectedSlot?.endUtc ?? undefined
        );
        if (dashRes.checkoutUrl) {
          window.open(dashRes.checkoutUrl, "_blank");
        }
        // Store paymentId for retry if needed
        setDashPaymentId(dashRes.paymentId ?? null);

        // Poll /api/webapp/bookings/:paymentId/payment-status every 5s, hard-stop at 15min
        if (dashRes.paymentId) {
          if (dashPollRef.current) clearInterval(dashPollRef.current);

          const pollId = dashRes.paymentId;
          const POLL_INTERVAL_MS = 5_000;
          const POLL_TIMEOUT_MS = 900_000; // 15 min
          const pollStart = Date.now();

          dashPollRef.current = setInterval(async () => {
            // Hard-stop after 15 minutes
            if (Date.now() - pollStart >= POLL_TIMEOUT_MS) {
              if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
              setCheckoutLoading(false);
              setIsProcessing(false);
              checkoutInFlight.current = false;
              setDashTimedOut(true);
              return;
            }
            try {
              const status = await getBookingPaymentStatus(pollId);
              if (status.status === "paid") {
                if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
                setConfirmedRoomName(status.roomName ?? null);
                setConfirmedBookingId(status.bookingId ?? pollId);
                // Preserve slot start time so SUCCESS step can show "scheduled for"
                if (selectedSlot?.startUtc) setConfirmedStartAt(selectedSlot.startUtc);
                setStep("SUCCESS");
                setCheckoutLoading(false);
                setIsProcessing(false);
                checkoutInFlight.current = false;
              } else if (status.status === "expired" || status.status === "failed") {
                if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
                setCheckoutError(
                  status.status === "expired"
                    ? "Dash invoice expired. Please try again."
                    : "Payment failed. Please try again."
                );
                setRetryPayload({
                  packageId: activePackage.id,
                  provider: "dash",
                  email,
                  quantity: 1,
                  selectedSlot: selectedSlot?.startUtc ?? null,
                });
                setCheckoutLoading(false);
                setIsProcessing(false);
                checkoutInFlight.current = false;
              }
              // status === 'pending' → keep polling
            } catch {
              // Network hiccup — keep polling
            }
          }, POLL_INTERVAL_MS);
        }
        return;
      }

      const payload = {
        packageId: activePackage.id,
        provider,
        email,
        quantity: 1,
        selectedSlot: selectedSlot?.startUtc ?? null,
      };
      const res = await createCallCheckout(payload);

      if (provider === "epayco" && res.checkoutUrl) {
        window.location.href = assertPaymentUrl(res.checkoutUrl);
        return;
      }

      setConfirmedStartAt(res.startAt ?? null);
      setStep("SUCCESS");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.creator.checkoutFailed;
      setCheckoutError(msg);
      // Store payload so user can retry with same data
      if (activePackage) {
        setRetryPayload({
          packageId: activePackage.id,
          provider,
          email,
          quantity: 1,
          selectedSlot: selectedSlot?.startUtc ?? null,
        });
      }
    } finally {
      setCheckoutLoading(false);
      setIsProcessing(false);
      checkoutInFlight.current = false;
    }
  }, [activePackage, provider, email, selectedSlot]);

  if (!open) return null;

  // ── Step titles ──────────────────────────────────────────────────────────────

  const stepTitle: Record<Step, string> = {
    SELECT_MODEL: t.creator.stepTitleChooseModel,
    SELECT_PACKAGE: t.creator.stepTitleBookCall,
    SELECT_SLOT: t.creator.stepTitleChooseSlot,
    CHECKOUT: t.creator.stepTitleCheckout,
    SUCCESS: t.creator.stepTitleBookingConfirmed,
  };

  // ── SELECT_MODEL step ────────────────────────────────────────────────────────

  const renderModelStep = () => {
    if (performersLoading) {
      return (
        <div className="py-2">
          <PerformerSkeleton label={t.creator.ariaLoadingPerformers} />
        </div>
      );
    }

    if (performers.length === 0) {
      return (
        <div className="py-10 flex flex-col items-center gap-3 text-center">
          <svg className="w-10 h-10" style={{ color: "#636366" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#EBEBF5" }}>{t.creator.noModelsAvailable}</p>
          <p className="text-xs" style={{ color: "#636366" }}>{t.creator.checkBackSoonPerformers}</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-xs" style={{ color: "#8E8E93" }}>
          {t.creator.pickModelHint(duration)}
        </p>
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          role="listbox"
          aria-label={t.creator.ariaAvailablePerformers}
        >
          {performers.map((p) => {
            const live = p.isLive === true;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={live ? t.creator.selectPerformerLive(p.displayName) : t.creator.selectPerformer(p.displayName)}
                onClick={() => handleSelectPerformer(p)}
                className={clsx(
                  "flex flex-col items-center gap-1.5 p-2.5 rounded-xl text-center",
                  "transition-all duration-150 active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  "hover:brightness-110"
                )}
                style={{
                  background: live
                    ? "rgba(255,59,48,0.10)"
                    : "rgba(255,255,255,0.05)",
                  border: live
                    ? "1px solid rgba(255,59,48,0.30)"
                    : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div className="relative">
                  {p.photoUrl ? (
                    <img
                      src={p.photoUrl}
                      alt={p.displayName}
                      className="w-14 h-14 rounded-full object-cover"
                      style={{
                        border: live ? "2px solid #FF3B30" : "2px solid rgba(255,255,255,0.12)",
                      }}
                    />
                  ) : (
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      {p.displayName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  {live && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    </span>
                  )}
                </div>
                <span
                  className="text-xs font-medium leading-tight line-clamp-2 w-full"
                  style={{ color: "#EBEBF5" }}
                >
                  {p.displayName}
                </span>
                {live && (
                  <span
                    className="text-[9px] font-bold uppercase tracking-wide"
                    style={{ color: "#FF3B30" }}
                  >
                    {t.creator.liveLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ── SELECT_PACKAGE step ──────────────────────────────────────────────────────

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
            {t.creator.tryAgain}
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
          <p className="text-sm font-medium" style={{ color: "#EBEBF5" }}>{t.creator.noPackagesAvailable}</p>
          <p className="text-xs" style={{ color: "#636366" }}>{t.creator.noPackagesHint}</p>
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
            <span style={{ color: "#34C759" }}>{t.creator.onlineNowBanner}</span>
          </div>
        )}

        {/* Duration options */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "#8E8E93" }}>{t.creator.selectDurationLabel}</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { mins: 30 as const, label: t.creator.slotDuration(30), badge: t.creator.mostPopularBadge, price: packages.find((p) => p.duration_minutes === 30)?.price_usd ?? "60" },
              { mins: 60 as const, label: t.creator.slotDuration(60), badge: null, price: packages.find((p) => p.duration_minutes === 60)?.price_usd ?? "100" },
            ].map(({ mins, label, badge, price }) => {
              const isSelected = duration === mins;
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDuration(mins)}
                  aria-pressed={isSelected}
                  aria-label={t.creator.selectCallLabel(mins, price)}
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

        {/* Go to Live Channel (when online) */}
        {isOnline && (
          <a
            href="/live"
            className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.06)", color: "#EBEBF5", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            {t.creator.goToLiveChannel}
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
          {t.creator.nextBtn}
        </button>
      </div>
    );
  };

  // ── SELECT_SLOT step ─────────────────────────────────────────────────────────

  const renderSlotStep = () => (
    <div className="space-y-4">
      {/* Live show banner */}
      {isCreatorLive && liveMessage && (
        <div
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
          style={{ background: "rgba(255,59,48,0.10)", border: "1px solid rgba(255,59,48,0.25)" }}
          role="alert"
          aria-live="polite"
        >
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#FF3B30" }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: "#FF3B30" }} />
          </span>
          <span className="text-xs font-medium" style={{ color: "#FF3B30" }}>
            {liveMessage}
          </span>
        </div>
      )}

      {/* "NOW" option — creator is online but not live */}
      {isOnline && !isCreatorLive && (
        <button
          type="button"
          aria-pressed={selectedSlot === null}
          onClick={() => setSelectedSlot(null)}
          className={clsx(
            "w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left",
            "transition-all duration-150 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          )}
          style={
            selectedSlot === null
              ? { background: "rgba(52,199,89,0.12)", border: "1.5px solid #34C759" }
              : { background: "rgba(52,199,89,0.06)", border: "1px solid rgba(52,199,89,0.25)" }
          }
        >
          <div
            className="w-10 h-10 rounded-lg flex flex-col items-center justify-center flex-shrink-0"
            style={{ background: "rgba(52,199,89,0.18)" }}
          >
            <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#34C759" }}>{t.creator.callNowLabel}</span>
            <span className="relative flex h-2 w-2 mt-0.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#34C759" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#34C759" }} />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: "#34C759" }}>{t.creator.callNowLabel}</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>{t.creator.callNowStartsIn(duration)}</p>
          </div>
          {selectedSlot === null && (
            <svg className="w-5 h-5 flex-shrink-0" style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}

      {slotsLoading && <SlotSkeleton label={t.creator.ariaLoadingSlots} />}

      {!slotsLoading && slotsError && (
        <div className="py-6 flex flex-col items-center gap-3 text-center">
          <svg className="w-7 h-7" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-sm" style={{ color: "#FF453A" }}>{slotsError}</p>
          <button
            type="button"
            onClick={() => { setSlotsOffset(0); loadSlots(0, false); }}
            className="min-h-[44px] px-5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: "#D4007A" }}
          >
            {t.creator.tryAgain}
          </button>
        </div>
      )}

      {!slotsLoading && !slotsError && slots.length === 0 && !isOnline && (
        <div className="py-8 flex flex-col items-center gap-2 text-center">
          <svg className="w-10 h-10" style={{ color: "#636366" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#EBEBF5" }}>{t.creator.noSlotsAvailable}</p>
          <p className="text-xs mb-2" style={{ color: "#636366" }}>
            {t.creator.noSlotsHint}
          </p>
          <a
            href={creator.id ? `/profile/${creator.id}` : "/live"}
            className="text-xs font-semibold underline underline-offset-2 transition-opacity hover:opacity-70"
            style={{ color: "#D4007A" }}
          >
            {t.creator.viewFullCalendar}
          </a>
        </div>
      )}

      {!slotsLoading && !slotsError && slots.length > 0 && (
        <>
          <div className="max-h-[40vh] overflow-y-auto space-y-2.5 -mx-1 px-1" role="listbox" aria-label={t.creator.ariaAvailableSlots}>
            <p className="text-xs pb-0.5" style={{ color: "#8E8E93" }}>
              {t.creator.timesInLocalTz(Intl.DateTimeFormat().resolvedOptions().timeZone)}
            </p>
            {slots.map((slot) => {
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
                    <p className="text-xs" style={{ color: "#8E8E93" }}>{time} — {t.creator.slotDuration(duration)}</p>
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

          {/* See More / loading more */}
          {hasMoreSlots && (
            <button
              type="button"
              onClick={handleSeeMore}
              disabled={loadingMore}
              className={clsx(
                "w-full min-h-[40px] rounded-xl text-sm font-medium",
                "flex items-center justify-center gap-2",
                "transition-opacity hover:opacity-80 active:scale-[0.98]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              )}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "#8E8E93",
              }}
            >
              {loadingMore ? (
                <>
                  <Spinner size={14} />
                  <span>{t.creator.loadingMore}</span>
                </>
              ) : (
                t.creator.seeMoreSlots
              )}
            </button>
          )}

          {/* Exhausted — all 10 slots shown, none suitable */}
          {!hasMoreSlots && slots.length >= 10 && (
            <div
              className="rounded-xl px-4 py-3 flex items-start gap-2.5"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs" style={{ color: "#8E8E93" }}>
                  {t.creator.noneWorkQuestion}{" "}
                  <a
                    href={creator.id ? `/profile/${creator.id}` : "/live"}
                    className="font-semibold underline underline-offset-2 transition-opacity hover:opacity-70"
                    style={{ color: "#D4007A" }}
                  >
                    {t.creator.viewFullCalendarLink}
                  </a>
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <button
        type="button"
        disabled={!selectedSlot && !isOnline}
        onClick={handleNextFromSlot}
        className="w-full min-h-[48px] rounded-2xl text-base font-bold text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
      >
        {isOnline && !selectedSlot ? t.creator.callNowBtn : t.creator.nextBtn}
      </button>
    </div>
  );

  // ── CHECKOUT step ────────────────────────────────────────────────────────────

  const renderCheckoutStep = () => (
    <div className="space-y-5">
      {/* Package not loaded warning (only when skipPackageStep and load failed) */}
      {skipPackageStep && !activePackage && !packagesLoading && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl" style={{ background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.25)" }}>
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: "#FF453A" }}>
              {t.creator.couldNotLoadPackage}{" "}
              <button
                type="button"
                className="underline underline-offset-2 font-semibold"
                onClick={() => {
                  setPackages([]);
                  setPackagesError(null);
                  setPackagesLoading(true);
                  getCreatorCallPackages(creator.id)
                    .then((r) => { setPackages(r.packages ?? []); setPackagesLoading(false); })
                    .catch((e: Error) => { setPackagesError(e.message); setPackagesLoading(false); });
                }}
              >
                {t.creator.retryLink}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* Order summary */}
      <div
        className="rounded-2xl p-4 space-y-2.5"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8E8E93" }}>{t.creator.orderSummaryTitle}</p>
        <div className="flex justify-between text-sm">
          <span style={{ color: "#8E8E93" }}>{t.creator.orderCreatorLabel}</span>
          <span className="font-semibold" style={{ color: "#EBEBF5" }}>@{creator.username}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "#8E8E93" }}>{t.creator.orderDurationLabel}</span>
          <span className="font-semibold" style={{ color: "#EBEBF5" }}>{t.creator.slotDuration(duration)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "#8E8E93" }}>{t.creator.orderTimeSlotLabel}</span>
          <span className="font-semibold" style={{ color: "#EBEBF5" }}>
            {isOnline && !selectedSlot
              ? t.creator.orderSlotSoon
              : selectedSlot
                ? (() => { const { date, time } = formatSlotDate(selectedSlot.startUtc); return `${date} · ${time}`; })()
                : "—"}
          </span>
        </div>
        <div
          className="flex justify-between text-base pt-2 font-bold"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span style={{ color: "#EBEBF5" }}>{t.creator.orderTotalLabel}</span>
          <span style={{ color: "#E69138" }}>${pricePerUnit.toFixed(0)}</span>
        </div>
      </div>

      {/* Payment provider toggle */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "#8E8E93" }}>{t.creator.paymentMethodLabel}</p>
        <div className="flex gap-2">
          {(["epayco", "dash"] as Provider[]).map((p) => {
            const label = p === "epayco" ? t.creator.payMethodCard : "Dash";
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
      </div>

      {/* Email input */}
      <div>
        <label
          htmlFor="checkout-email"
          className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
          style={{ color: "#8E8E93" }}
        >
          {t.creator.emailForReceiptLabel}
        </label>
        <input
          id="checkout-email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t.creator.emailPlaceholder}
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

      {/* Dash: 15-min timeout recovery card */}
      {provider === "dash" && dashTimedOut && (
        <div
          className="rounded-xl px-4 py-4 space-y-3"
          style={{ background: "rgba(255,159,10,0.10)", border: "1px solid rgba(255,159,10,0.25)" }}
          role="alert"
        >
          <p className="text-sm font-semibold" style={{ color: "#FF9F0A" }}>
            Still waiting?
          </p>
          <p className="text-xs" style={{ color: "#8E8E93" }}>
            Refresh this page after paying to check status. If you already paid, your booking will be confirmed automatically.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: "rgba(255,255,255,0.08)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.10)" }}
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                setDashTimedOut(false);
                setCheckoutError(null);
                checkoutInFlight.current = false;
                handleCheckout();
              }}
              className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: "#D4007A" }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Dash: waiting for payment indicator */}
      {provider === "dash" && checkoutLoading && !dashTimedOut && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <div className="flex items-center gap-2">
            <Spinner size={16} />
            <span className="text-sm" style={{ color: "#8E8E93" }}>{t.creator.waitingForPayment}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
              setCheckoutLoading(false);
              setIsProcessing(false);
              checkoutInFlight.current = false;
            }}
            className="text-xs font-semibold px-3 min-h-[32px] rounded-lg transition-opacity hover:opacity-80"
            style={{ color: "#FF453A", background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.20)" }}
          >
            {t.creator.cancelBtn}
          </button>
        </div>
      )}

      {/* Error */}
      {checkoutError && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm" style={{ color: "#FF453A" }}>
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span>{checkoutError}</span>
          </div>
          {retryPayload && (
            <button
              type="button"
              onClick={() => { setCheckoutError(null); setRetryPayload(null); handleCheckout(); }}
              className="min-h-[40px] px-4 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: "#D4007A" }}
            >
              {t.creator.retryPayment}
            </button>
          )}
        </div>
      )}

      {/* Submit */}
      {!(provider === "dash" && (checkoutLoading || dashTimedOut)) && (
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
              <span>{t.creator.processing}</span>
            </>
          ) : (
            t.creator.proceedToCheckout
          )}
        </button>
      )}
    </div>
  );

  // ── SUCCESS step ─────────────────────────────────────────────────────────────

  // Determine if start is within ±15min of now
  const startTimeForJoin = confirmedStartAt ?? (selectedSlot?.startUtc ?? null);
  const isWithinJoinWindow = startTimeForJoin
    ? Math.abs(new Date(startTimeForJoin).getTime() - Date.now()) <= 15 * 60 * 1000
    : isOnline; // online + now booking = always in window

  // Navigate to /call/:bookingId — CallRoom page handles LiveKit connection
  const handleJoinCallWithToken = () => {
    if (!confirmedBookingId) return;
    onClose();
    navigate(`/call/${encodeURIComponent(String(confirmedBookingId))}`);
  };

  const renderSuccessStep = () => (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <>
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
            <h3 className="text-xl font-bold" style={{ color: "#EBEBF5" }}>{t.creator.bookingConfirmedTitle}</h3>
            <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
              {startTimeForJoin
                ? (() => { const { date, time } = formatSlotDate(startTimeForJoin); return t.creator.callScheduledFor(date, time); })()
                : isOnline
                  ? t.creator.callStartsInFifteen
                  : t.creator.bookingReceived}
            </p>
          </div>

          <div
            className="w-full rounded-2xl p-4 text-left space-y-2"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8E8E93" }}>{t.creator.callDetailsTitle}</p>
            <p className="text-sm" style={{ color: "#EBEBF5" }}>
              <span style={{ color: "#8E8E93" }}>{t.creator.callDetailCreator}</span>@{creator.username}
            </p>
            <p className="text-sm" style={{ color: "#EBEBF5" }}>
              <span style={{ color: "#8E8E93" }}>{t.creator.callDetailDuration}</span>{t.creator.slotDuration(duration)}
            </p>
            {startTimeForJoin && (
              <p className="text-sm" style={{ color: "#EBEBF5" }}>
                <span style={{ color: "#8E8E93" }}>Starts: </span>
                {(() => { const { date, time } = formatSlotDate(startTimeForJoin); return `${date} · ${time}`; })()}
              </p>
            )}
          </div>

          {/* Join Call button — only within ±15min of start */}
          {isWithinJoinWindow && confirmedBookingId ? (
            <div className="w-full space-y-2">
              {joinCallError && (
                <p className="text-xs text-center" style={{ color: "#FF453A" }}>{joinCallError}</p>
              )}
              <button
                type="button"
                disabled={joinCallLoading}
                onClick={handleJoinCallWithToken}
                className="w-full min-h-[48px] rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(90deg, #7B61FF, #D4007A)" }}
              >
                {joinCallLoading ? (
                  <>
                    <Spinner size={18} />
                    <span>Joining…</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <span>Join Call</span>
                  </>
                )}
              </button>
            </div>
          ) : startTimeForJoin && !isWithinJoinWindow ? (
            <div
              className="w-full rounded-xl px-4 py-3 text-sm text-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#8E8E93" }}
            >
              Your call with <span style={{ color: "#EBEBF5" }}>@{creator.username}</span> is scheduled for{" "}
              <span style={{ color: "#EBEBF5" }}>
                {(() => { const { date, time } = formatSlotDate(startTimeForJoin); return `${date} at ${time}`; })()}
              </span>. We'll send a reminder 15 min before.
            </div>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-2xl text-sm font-semibold transition-opacity hover:opacity-80 active:scale-[0.98]"
            style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            {t.creator.closeBtn}
          </button>
      </>
    </div>
  );

  // ── Step content map ───────────────────────────────────────────────────────────

  const stepContent: Record<Step, React.ReactNode> = {
    SELECT_MODEL: renderModelStep(),
    SELECT_PACKAGE: renderPackageStep(),
    SELECT_SLOT: renderSlotStep(),
    CHECKOUT: renderCheckoutStep(),
    SUCCESS: renderSuccessStep(),
  };

  // ── Back navigation ───────────────────────────────────────────────────────────

  const canGoBack =
    step === "SELECT_SLOT" ||
    step === "CHECKOUT" ||
    (step === "SELECT_PACKAGE" && needsModelStep);

  const handleBack = () => {
    if (step === "CHECKOUT") {
      if (isOnline) {
        setStep(skipPackageStep ? "SELECT_SLOT" : "SELECT_PACKAGE");
      } else {
        setStep("SELECT_SLOT");
      }
    } else if (step === "SELECT_SLOT") {
      setStep(skipPackageStep && needsModelStep ? "SELECT_MODEL" : "SELECT_PACKAGE");
    } else if (step === "SELECT_PACKAGE") {
      setStep("SELECT_MODEL");
    }
  };

  // ── Step dots ─────────────────────────────────────────────────────────────────

  const getStepDots = (): Step[] => {
    if (needsModelStep) {
      return isOnline
        ? ["SELECT_MODEL", "CHECKOUT"]
        : ["SELECT_MODEL", "SELECT_SLOT", "CHECKOUT"];
    }
    if (skipPackageStep) {
      return isOnline
        ? ["SELECT_SLOT", "CHECKOUT"]
        : ["SELECT_SLOT", "CHECKOUT"];
    }
    return isOnline
      ? ["SELECT_PACKAGE", "CHECKOUT"]
      : ["SELECT_PACKAGE", "SELECT_SLOT", "CHECKOUT"];
  };

  const stepDots = getStepDots();

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.70)" }}
      onClick={isProcessing ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label={creator.username ? t.creator.ariaBookCallWith(creator.username) : t.creator.ariaBookPrivateCall}
    >
      {/* aria-live region for step transitions */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {stepTitle[step]}
      </div>

      <div
        ref={modalRef}
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

        {/* Permission warning banner */}
        {permissionWarning && (
          <div
            className="flex items-start gap-2.5 px-4 py-2.5 flex-shrink-0"
            style={{ background: "rgba(255,159,10,0.12)", borderBottom: "1px solid rgba(255,159,10,0.25)" }}
            role="alert"
          >
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#FF9F0A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            <p className="text-xs flex-1" style={{ color: "#FF9F0A" }}>
              {permissionWarning === "both"
                ? t.creator.permBothBlocked
                : permissionWarning === "camera"
                ? t.creator.permCameraBlocked
                : t.creator.permMicBlocked}
            </p>
          </div>
        )}

        {/* Modal header */}
        <div
          className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          {/* Back button */}
          {canGoBack && (
            <button
              type="button"
              onClick={handleBack}
              aria-label={t.creator.ariaGoBack}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-opacity hover:opacity-80 active:scale-95 focus-visible:outline-none focus-visible:ring-2"
              style={{ background: "rgba(255,255,255,0.08)", color: "#EBEBF5" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
          )}

          {/* Creator avatar + name / step title */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {creator.id && (
              <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                {creator.photo_url
                  ? <img src={creator.photo_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>{creator.username?.slice(0, 2).toUpperCase()}</div>
                }
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "#EBEBF5" }}>
                {stepTitle[step]}
              </p>
              {creator.username && (
                <p className="text-xs truncate" style={{ color: "#8E8E93" }}>
                  @{creator.username}
                  {isOnline && (
                    <span className="ml-1.5" style={{ color: "#34C759" }}>● {t.creator.onlineIndicator}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={isProcessing ? undefined : onClose}
            disabled={isProcessing}
            aria-label={t.creator.ariaCloseBookingModal}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-opacity hover:opacity-80 active:scale-95 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "rgba(255,255,255,0.08)", color: "#8E8E93" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator dots */}
        {step !== "SUCCESS" && (
          <div className="flex items-center justify-center gap-1.5 py-2.5 flex-shrink-0" aria-hidden="true">
            {stepDots.map((s) => {
              const isActive = s === step;
              const isDone = stepDots.indexOf(step) > stepDots.indexOf(s);
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
