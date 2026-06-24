import React, { useState, useCallback, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  getRtmpKey,
  provisionChannel,
  broadcastLiveNow,
  getWalletBalance,
  getLiveGoal,
  setLiveGoal,
  clearLiveGoal,
  getMyTipMenu,
  saveTipMenu,
  type TipGoal,
  type TipMenuItem,
} from "@/lib/api";
import { useLiveSocket } from "@/hooks/useLiveSocket";

const STUDIO_URL = `/login?returnTo=${encodeURIComponent("https://studio.pnptv.app/")}`;

export default function CreatorLive() {
  const { user } = useAuth();
  const t = useI18n().creator;

  const [rtmpInfo, setRtmpInfo] = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  // "idle" | "loading" | "provisioning" | "ready" | "error"
  const [phase, setPhase] = useState<"idle" | "loading" | "provisioning" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // ── Notify followers state ────────────────────────────────────────────────
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastStatus, setBroadcastStatus] = useState<"idle" | "sending" | "done" | "dedup" | "error">("idle");
  const [broadcastDisabled, setBroadcastDisabled] = useState(false);
  const [broadcastToast, setBroadcastToast] = useState<string | null>(null);

  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  useEffect(() => {
    getWalletBalance().then((res) => { if (typeof res.balance === "number") setTokenBalance(res.balance); }).catch(() => {});
  }, []);

  // ── Channel ref (populated after credentials load) ─────────────────────────
  const [channelRef, setChannelRef] = useState<string | null>(null);

  // ── Tip alert audio + toast ────────────────────────────────────────────────
  const tipAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    tipAudioRef.current = new Audio("/sounds/tip-ding.mp3");
    tipAudioRef.current.volume = 0.6;
  }, []);

  const { tipAlert } = useLiveSocket(channelRef);

  useEffect(() => {
    if (!tipAlert) return;
    tipAudioRef.current?.play().catch(() => {});
  }, [tipAlert]);

  // ── Tip goal state ─────────────────────────────────────────────────────────
  const [goalAmount, setGoalAmount] = useState("");
  const [goalLabel, setGoalLabel] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [currentGoal, setCurrentGoal] = useState<TipGoal | null>(null);
  const [showGoalEditor, setShowGoalEditor] = useState(false);

  useEffect(() => {
    if (!channelRef) return;
    getLiveGoal(channelRef)
      .then((res) => { if (res.goalAmount !== null) setCurrentGoal(res); })
      .catch(() => {});
  }, [channelRef]);

  const handleSetGoal = useCallback(async () => {
    const amt = parseInt(goalAmount);
    if (!amt || amt <= 0) return;
    setGoalSaving(true);
    try {
      await setLiveGoal(amt, goalLabel.trim() || "Goal");
      setCurrentGoal({ goalAmount: amt, goalLabel: goalLabel.trim() || "Goal", progress: 0, completed: false });
      setGoalAmount("");
      setGoalLabel("");
      setShowGoalEditor(false);
    } catch {
      // silently ignore — user will retry
    } finally {
      setGoalSaving(false);
    }
  }, [goalAmount, goalLabel]);

  const handleClearGoal = useCallback(async () => {
    await clearLiveGoal().catch(() => {});
    setCurrentGoal(null);
  }, []);

  // ── Tip menu state ─────────────────────────────────────────────────────────
  const [tipMenuItems, setTipMenuItems] = useState<TipMenuItem[]>([]);
  const [menuEditing, setMenuEditing] = useState(false);
  const [newItemAmount, setNewItemAmount] = useState("");
  const [newItemLabel, setNewItemLabel] = useState("");

  useEffect(() => {
    getMyTipMenu()
      .then((res) => setTipMenuItems(res.items || []))
      .catch(() => {});
  }, []);

  const handleAddMenuItem = useCallback(async () => {
    const amt = parseInt(newItemAmount);
    if (!amt || !newItemLabel.trim()) return;
    const newItems: TipMenuItem[] = [
      ...tipMenuItems,
      { id: Date.now(), tokensAmount: amt, label: newItemLabel.trim(), sortOrder: tipMenuItems.length },
    ];
    setTipMenuItems(newItems);
    setNewItemAmount("");
    setNewItemLabel("");
    await saveTipMenu(
      newItems.map(({ tokensAmount, label, sortOrder }) => ({ tokensAmount, label, sortOrder }))
    ).catch(() => {});
  }, [newItemAmount, newItemLabel, tipMenuItems]);

  const handleRemoveMenuItem = useCallback(async (id: number) => {
    const newItems = tipMenuItems.filter((i) => i.id !== id);
    setTipMenuItems(newItems);
    await saveTipMenu(
      newItems.map(({ tokensAmount, label, sortOrder }) => ({ tokensAmount, label, sortOrder }))
    ).catch(() => {});
  }, [tipMenuItems]);

  const handleBroadcast = useCallback(async () => {
    if (broadcastDisabled || broadcastStatus === "sending") return;
    setBroadcastStatus("sending");
    setBroadcastDisabled(true);
    setBroadcastToast(null);
    try {
      const res = await broadcastLiveNow({ message: broadcastMsg.trim() || undefined });
      if (res.success) {
        if (res.skippedDedup) {
          setBroadcastStatus("dedup");
          setBroadcastToast("Already notified today — followers can only be alerted once every 6 hours.");
        } else {
          setBroadcastStatus("done");
          setBroadcastToast(`Notified ${res.dispatched} follower${res.dispatched !== 1 ? "s" : ""}`);
        }
      } else {
        setBroadcastStatus("error");
        setBroadcastToast("Failed to send — please try again.");
        setBroadcastDisabled(false);
      }
    } catch {
      setBroadcastStatus("error");
      setBroadcastToast("Network error — please try again.");
      setBroadcastDisabled(false);
    }
    // Re-enable button after 10s regardless
    setTimeout(() => {
      setBroadcastDisabled(false);
      setBroadcastStatus("idle");
    }, 10_000);
  }, [broadcastDisabled, broadcastMsg, broadcastStatus]);

  const loading = phase === "loading" || phase === "provisioning";

  const loadCredentials = useCallback(async () => {
    if (rtmpInfo) return;
    setPhase("loading");
    setError(null);
    try {
      // First try the normal RTMP key fetch (succeeds if channel already assigned).
      const result = await getRtmpKey();
      if (result.success && result.rtmpUrl && result.streamKey) {
        setRtmpInfo({ rtmpUrl: result.rtmpUrl, streamKey: result.streamKey });
        if (result.channelRef) setChannelRef(result.channelRef);
        setPhase("ready");
        return;
      }

      // Channel not yet assigned (404) — self-provision automatically.
      // Any other error falls through to the catch block below.
      setPhase("provisioning");
      const provision = await provisionChannel();
      if (provision.success && provision.rtmpUrl && provision.streamKey) {
        setRtmpInfo({ rtmpUrl: provision.rtmpUrl, streamKey: provision.streamKey });
        if (provision.channelRef) setChannelRef(provision.channelRef);
        setPhase("ready");
      } else {
        setError(provision.error || "Could not set up your streaming channel");
        setPhase("error");
      }
    } catch {
      setError("Network error — please try again");
      setPhase("error");
    }
  }, [rtmpInfo]);

  const copy = (text: string, field: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(field);
        setTimeout(() => setCopied(null), 2000);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <>
      <Helmet>
        <title>Go Live — PNPtv!</title>
      </Helmet>

      {/* Tip alert toast */}
      {tipAlert && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl bg-pnp-surface border border-pnp-accent/40 shadow-lg shadow-pnp-accent/10 max-w-xs pointer-events-none">
          <p className="text-sm font-bold text-pnp-accent">+{tipAlert.amount} tokens</p>
          <p className="text-xs text-pnp-textSecondary">from @{tipAlert.username}</p>
          {tipAlert.message && (
            <p className="text-xs text-pnp-textPrimary mt-0.5 italic">"{tipAlert.message}"</p>
          )}
        </div>
      )}

      <div className="p-4 lg:p-6 space-y-5 max-w-2xl mx-auto">

        {/* Token balance chip */}
        {tokenBalance !== null && (
          <div className="flex items-center gap-1.5 self-start px-3 py-1.5 rounded-full w-fit"
            style={{ background: "rgba(0,140,231,0.12)", border: "1px solid rgba(0,140,231,0.25)" }}>
            <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#008CE7" }}>
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-white"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/></svg>
            </div>
            <span className="text-xs font-semibold tabular-nums" style={{ color: "#5BB8F5" }}>{tokenBalance} tokens</span>
          </div>
        )}

        {/* Notify followers card */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <svg className="w-4 h-4" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            Notify Followers Now
          </h2>
          <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Alert your followers before you connect OBS. Max one notification per 6 hours.
          </p>
          <div className="space-y-2">
            <textarea
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                minHeight: "68px",
              }}
              placeholder={`Optional message (max 240 chars) — default: "🔴 You are going live!"`}
              maxLength={240}
              value={broadcastMsg}
              onChange={(e) => setBroadcastMsg(e.target.value)}
              disabled={broadcastDisabled}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px]" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                {broadcastMsg.length}/240
              </span>
              <button
                onClick={handleBroadcast}
                disabled={broadcastDisabled}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
                style={{
                  background: broadcastDisabled
                    ? "rgba(255,255,255,0.08)"
                    : "linear-gradient(135deg, #D4007A, #7B61FF)",
                  opacity: broadcastDisabled ? 0.6 : 1,
                  cursor: broadcastDisabled ? "not-allowed" : "pointer",
                }}
              >
                {broadcastStatus === "sending" ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Broadcast to followers
                  </>
                )}
              </button>
            </div>
          </div>
          {broadcastToast && (
            <div
              className="px-3 py-2 rounded-lg text-xs"
              style={{
                background: broadcastStatus === "done"
                  ? "rgba(94,209,196,0.1)"
                  : broadcastStatus === "dedup"
                    ? "rgba(245,166,35,0.1)"
                    : "rgba(212,0,122,0.1)",
                color: broadcastStatus === "done"
                  ? "#5ED1C4"
                  : broadcastStatus === "dedup"
                    ? "#F5A623"
                    : "#D4007A",
                border: `1px solid ${broadcastStatus === "done" ? "rgba(94,209,196,0.2)" : broadcastStatus === "dedup" ? "rgba(245,166,35,0.2)" : "rgba(212,0,122,0.2)"}`,
              }}
            >
              {broadcastToast}
            </div>
          )}
        </Card>

        {/* How do you want to stream? */}
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <svg className="w-4 h-4" style={{ color: "#5ED1C4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              How do you want to stream?
            </h2>
            <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              Choose one. You can switch anytime.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Option 1 — Stream from this app (recommended) */}
            <a
              href={STUDIO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="relative block rounded-xl p-4 transition-all hover:scale-[1.02]"
              style={{
                background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(123,97,255,0.15))",
                border: "1px solid rgba(212,0,122,0.35)",
              }}
            >
              <span
                className="absolute top-2 right-2 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
                style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
              >
                Recommended
              </span>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-2"
                style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
              >
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-white">Stream from this app</p>
              <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.65)" }}>
                No setup — just your camera & mic. Scenes, filters, chat & auto-messages included.
              </p>
              <p className="text-[11px] mt-2 flex items-center gap-1 font-semibold" style={{ color: "#5ED1C4" }}>
                Open PNPtv Studio
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </p>
            </a>

            {/* Option 2 — Use OBS / External RTMP */}
            <button
              type="button"
              onClick={() => {
                document.getElementById("rtmp-credentials")?.scrollIntoView({ behavior: "smooth", block: "start" });
                if (!rtmpInfo) loadCredentials();
              }}
              className="relative block text-left rounded-xl p-4 transition-all hover:scale-[1.02]"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-2"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                <svg className="w-5 h-5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-white">Use OBS or external RTMP</p>
              <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
                Stream from OBS Studio, Streamlabs, or any RTMP-compatible app using the credentials below.
              </p>
              <p className="text-[11px] mt-2 flex items-center gap-1 font-semibold text-white/70">
                See RTMP credentials
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </p>
            </button>
          </div>
        </Card>

        {/* Hero */}
        <div
          className="relative rounded-2xl overflow-hidden p-6"
          style={{
            background: "linear-gradient(135deg, #0D2030 0%, #1A0A2E 50%, #2C0A18 100%)",
          }}
        >
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
              >
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">{t.tabGoLive}</h1>
                <p className="text-xs text-white/50">Stream live to your audience on PNPtv</p>
              </div>
            </div>
            <p className="text-sm text-white/60 leading-relaxed">
              Prefer external software? Use OBS Studio, Streamlabs, or any RTMP-compatible app with the credentials below.
              Your stream will appear on the Live page for all members.
            </p>
          </div>
          {/* Decorative grid */}
          <div className="absolute inset-0 opacity-5" style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }} />
        </div>

        {/* Quick Setup Guide */}
        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Quick Setup
          </h2>
          <div className="space-y-3">
            {[
              { step: 1, title: "Get your stream key", desc: "Click below to reveal your unique RTMP credentials" },
              { step: 2, title: "Open OBS Studio", desc: "Go to Settings → Stream → Service: Custom" },
              { step: 3, title: "Paste credentials", desc: "Set the Server URL and Stream Key from below" },
              { step: 4, title: "Start streaming!", desc: "Click 'Start Streaming' in OBS — you're live!" },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex items-start gap-3">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                  style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
                >
                  {step}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="text-xs text-pnp-textSecondary">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* RTMP Credentials */}
        <div id="rtmp-credentials" />
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Stream Credentials
            </h2>
            {rtmpInfo && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold">
                Ready
              </span>
            )}
          </div>

          {!rtmpInfo ? (
            <Button
              onClick={loadCredentials}
              disabled={loading}
              className="w-full"
            >
              {phase === "provisioning" ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Setting up your channel...
                </span>
              ) : phase === "loading" ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Loading...
                </span>
              ) : (
                "Set Up My Channel"
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              {/* Server URL */}
              <div>
                <label className="text-[10px] text-pnp-textSecondary uppercase tracking-wider font-semibold block mb-1">
                  RTMP Server URL
                </label>
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <code className="text-sm text-white flex-1 break-all font-mono">{rtmpInfo.rtmpUrl}</code>
                  <button
                    onClick={() => copy(rtmpInfo.rtmpUrl, "url")}
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    {copied === "url" ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Stream Key */}
              <div>
                <label className="text-[10px] text-pnp-textSecondary uppercase tracking-wider font-semibold block mb-1">
                  Stream Key
                </label>
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <code className="text-sm text-white flex-1 font-mono">
                    {showKey ? rtmpInfo.streamKey : "\u2022".repeat(Math.min(rtmpInfo.streamKey.length, 24))}
                  </code>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {showKey ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
                      ) : (
                        <>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </>
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => copy(rtmpInfo.streamKey, "key")}
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    {copied === "key" ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-red-400/80 mt-1.5 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Never share your stream key — anyone with it can stream on your channel
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-xl text-xs bg-red-500/10 border border-red-500/20 text-red-300">
              {error}
            </div>
          )}
        </Card>

        {/* Recommended Settings */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Recommended OBS Settings
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Resolution", value: "1920×1080" },
              { label: "FPS", value: "30" },
              { label: "Encoder", value: "x264 or NVENC" },
              { label: "Bitrate", value: "4500 kbps" },
              { label: "Keyframe", value: "2 seconds" },
              { label: "Audio", value: "AAC 128 kbps" },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="px-3 py-2 rounded-lg"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <p className="text-[10px] text-pnp-textSecondary uppercase tracking-wider">{label}</p>
                <p className="text-sm font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Tips */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Pro Tips
          </h2>
          <ul className="space-y-2 text-xs text-pnp-textSecondary">
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">•</span>
              <span>Test your stream privately first — use the preview in Restreamer before going live</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">•</span>
              <span>Use a wired ethernet connection for the most stable stream</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">•</span>
              <span>Engage with chat — viewers who feel seen are more likely to tip and subscribe</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">•</span>
              <span>Set a schedule — regular streams build a loyal audience</span>
            </li>
          </ul>
        </Card>

        {/* Tip Goal */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              Tip Goal
            </h2>
            <button
              onClick={() => setShowGoalEditor((v) => !v)}
              className="text-[10px] text-pnp-accent hover:underline"
            >
              {showGoalEditor ? "Cancel" : currentGoal ? "Edit" : "Set goal"}
            </button>
          </div>

          {currentGoal ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-pnp-textPrimary">{currentGoal.goalLabel || "Goal"}</span>
                <span className="text-xs text-pnp-textSecondary">
                  {Math.round(currentGoal.progress)}/{Math.round(currentGoal.goalAmount ?? 0)} tokens
                </span>
              </div>
              <div className="h-2 rounded-full bg-pnp-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${currentGoal.completed ? "bg-green-500" : "bg-pnp-accent"}`}
                  style={{ width: `${currentGoal.goalAmount && currentGoal.goalAmount > 0 ? Math.min(100, Math.round(((currentGoal.progress ?? 0) / currentGoal.goalAmount) * 100)) : 0}%` }}
                />
              </div>
              {currentGoal.completed && (
                <p className="text-[10px] text-green-400 font-semibold text-center">Goal reached!</p>
              )}
              <button
                onClick={handleClearGoal}
                className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
              >
                Clear goal
              </button>
            </div>
          ) : (
            !showGoalEditor && (
              <p className="text-xs text-pnp-textSecondary">No active goal. Set one to motivate your viewers.</p>
            )
          )}

          {showGoalEditor && (
            <div className="space-y-2 pt-1 border-t border-pnp-border">
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Tokens (e.g. 500)"
                  value={goalAmount}
                  onChange={(e) => setGoalAmount(e.target.value)}
                  className="w-32 rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent"
                />
                <input
                  type="text"
                  placeholder="Label (optional)"
                  maxLength={60}
                  value={goalLabel}
                  onChange={(e) => setGoalLabel(e.target.value)}
                  className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent"
                />
              </div>
              <button
                onClick={handleSetGoal}
                disabled={goalSaving || !goalAmount}
                className="px-4 py-2 rounded-lg btn-gradient text-white text-xs font-semibold disabled:opacity-50 transition-all active:scale-95"
              >
                {goalSaving ? "Saving..." : "Set goal"}
              </button>
            </div>
          )}
        </Card>

        {/* Tip Menu */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              Tip Menu
            </h2>
            <button
              onClick={() => setMenuEditing((v) => !v)}
              className="text-[10px] text-pnp-accent hover:underline"
            >
              {menuEditing ? "Done" : "Edit"}
            </button>
          </div>

          {tipMenuItems.length === 0 && !menuEditing && (
            <p className="text-xs text-pnp-textSecondary">
              No tip menu items. Add items so viewers can tip for specific actions.
            </p>
          )}

          {tipMenuItems.length > 0 && (
            <ul className="space-y-1.5">
              {tipMenuItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 py-1 border-b border-pnp-border/50 last:border-0">
                  <span className="text-xs text-pnp-textPrimary">
                    <span className="text-pnp-accent font-bold">{item.tokensAmount}T</span>
                    <span className="text-pnp-textSecondary mx-1.5">·</span>
                    {item.label}
                  </span>
                  {menuEditing && (
                    <button
                      onClick={() => handleRemoveMenuItem(item.id)}
                      className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {menuEditing && (
            <div className="pt-2 border-t border-pnp-border space-y-2">
              <p className="text-[10px] text-pnp-textSecondary font-medium uppercase tracking-wider">Add item</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Tokens"
                  value={newItemAmount}
                  onChange={(e) => setNewItemAmount(e.target.value)}
                  className="w-24 rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent"
                />
                <input
                  type="text"
                  placeholder="What you'll do (e.g. Take off shirt)"
                  maxLength={80}
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddMenuItem(); } }}
                  className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent"
                />
              </div>
              <button
                onClick={handleAddMenuItem}
                disabled={!newItemAmount || !newItemLabel.trim()}
                className="px-3 py-1.5 rounded-lg bg-pnp-accent/20 border border-pnp-accent/40 text-pnp-accent text-xs font-semibold disabled:opacity-40 transition-colors active:scale-95"
              >
                Add item
              </button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
