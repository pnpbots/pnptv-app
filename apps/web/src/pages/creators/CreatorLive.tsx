import React, { useState, useCallback, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  getRtmpKey,
  provisionChannel,
  ApiError,
  broadcastLiveNow,
  getWalletBalance,
  getLiveGoal,
  setLiveGoal,
  clearLiveGoal,
  getMyTipMenu,
  saveTipMenu,
  getStreamProfile,
  saveStreamProfile,
  startAutoMessages,
  stopAutoMessages,
  getStreamMeta,
  saveStreamMeta,
  setBrb,
  type TipGoal,
  type TipMenuItem,
  type StreamMeta,
} from "@/lib/api";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { StreamHealthPanel } from "@/components/stream/StreamHealthPanel";

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

  useEffect(() => {
    if (user?.liveChannel && !channelRef) {
      setChannelRef(user.liveChannel);
    }
  }, [user?.liveChannel, channelRef]);

  // ── Live status — driven by StreamHealthPanel's onHealth callback ──────────
  const [isLive, setIsLive] = useState(false);

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"setup" | "show" | "chat">("setup");
  const [chatUnread, setChatUnread] = useState(0);
  const historyLoadedRef = useRef(false);

  useEffect(() => {
    if (isLive) setActiveTab("chat");
  }, [isLive]);

  // ── Tip alert audio + toast ────────────────────────────────────────────────
  const loadingRef = useRef(false);
  const tipAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const audio = new Audio("/sounds/tip-ding.mp3");
    audio.volume = 0.6;
    tipAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      tipAudioRef.current = null;
    };
  }, []);

  const { tipAlert, viewerCount, messages: chatMessages, sendMessage, reconnecting, socketError } = useLiveSocket(channelRef);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrolledOnce = useRef(false);

  useEffect(() => {
    if (!chatScrolledOnce.current && chatMessages.length > 0) {
      chatScrolledOnce.current = true;
      return; // skip scroll-into-view on initial history load
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Track unread chat messages while not on chat tab ──────────────────────
  useEffect(() => {
    if (!historyLoadedRef.current && chatMessages.length > 0) {
      historyLoadedRef.current = true;
      return; // don't count history as unread
    }
    if (historyLoadedRef.current && activeTab !== "chat") {
      setChatUnread((n) => n + 1);
    }
  }, [chatMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabSwitch = (tab: "setup" | "show" | "chat") => {
    setActiveTab(tab);
    if (tab === "chat") setChatUnread(0);
  };

  useEffect(() => {
    if (!tipAlert) return;
    tipAudioRef.current?.play().catch(() => {});
  }, [tipAlert]);

  // ── Tip goal state ─────────────────────────────────────────────────────────
  const [goalAmount, setGoalAmount] = useState("");
  const [goalLabel, setGoalLabel] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
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
    if (!amt || amt <= 0 || amt > 10000) {
      setGoalError("Goal must be between 1 and 10,000 tokens.");
      return;
    }
    setGoalSaving(true);
    try {
      await setLiveGoal(amt, goalLabel.trim() || "Goal");
      setCurrentGoal({ goalAmount: amt, goalLabel: goalLabel.trim() || "Goal", progress: 0, completed: false });
      setGoalError(null);
      setGoalAmount("");
      setGoalLabel("");
      setShowGoalEditor(false);
    } catch {
      setGoalError("Failed to save goal. Please try again.");
    } finally {
      setGoalSaving(false);
    }
  }, [goalAmount, goalLabel]);

  const handleClearGoal = useCallback(async () => {
    const prev = currentGoal;
    setCurrentGoal(null);
    try {
      await clearLiveGoal();
    } catch {
      setCurrentGoal(prev);
    }
  }, [currentGoal]);

  // ── Tip menu state ─────────────────────────────────────────────────────────
  const [tipMenuItems, setTipMenuItems] = useState<TipMenuItem[]>([]);
  const [menuEditing, setMenuEditing] = useState(false);
  const [newItemAmount, setNewItemAmount] = useState("");
  const [newItemLabel, setNewItemLabel] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);

  useEffect(() => {
    getMyTipMenu()
      .then((res) => setTipMenuItems(res.items || []))
      .catch(() => {});
  }, []);

  const handleAddMenuItem = useCallback(async () => {
    const amt = parseInt(newItemAmount);
    if (!amt || !newItemLabel.trim()) return;
    const newItem: TipMenuItem = { id: Date.now() + Math.random(), tokensAmount: amt, label: newItemLabel.trim(), sortOrder: tipMenuItems.length };
    const newItems: TipMenuItem[] = [...tipMenuItems, newItem];
    setTipMenuItems(newItems);
    setNewItemAmount("");
    setNewItemLabel("");
    try {
      await saveTipMenu(
        newItems.map(({ tokensAmount, label, sortOrder }) => ({ tokensAmount, label, sortOrder }))
      );
      setMenuError(null);
    } catch {
      setTipMenuItems((prev) => prev.filter((i) => i.id !== newItem.id));
      setMenuError("Failed to save tip menu. Please try again.");
    }
  }, [newItemAmount, newItemLabel, tipMenuItems]);

  const handleRemoveMenuItem = useCallback(async (id: number) => {
    const prev = tipMenuItems;
    const newItems = tipMenuItems.filter((i) => i.id !== id);
    setTipMenuItems(newItems);
    try {
      await saveTipMenu(newItems.map(({ tokensAmount, label, sortOrder }) => ({ tokensAmount, label, sortOrder })));
    } catch {
      setTipMenuItems(prev);
      setMenuError("Failed to remove item. Please try again.");
    }
  }, [tipMenuItems]);

  // ── Stream metadata (title / description / tags shown on Live page) ──────────
  const [streamMeta, setStreamMeta] = useState<StreamMeta>({ title: "", description: "", tags: [] });
  const [metaTagInput, setMetaTagInput] = useState("");
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    getStreamMeta()
      .then((res) => { if (res.meta) setStreamMeta(res.meta); })
      .catch(() => {});
  }, []);

  const handleSaveMeta = useCallback(async () => {
    if (!streamMeta.title.trim()) return;
    setMetaSaving(true);
    setMetaSaved(false);
    setMetaError(null);
    try {
      await saveStreamMeta({
        title: streamMeta.title.trim(),
        description: streamMeta.description.trim(),
        tags: streamMeta.tags,
      });
      setMetaSaved(true);
      setTimeout(() => setMetaSaved(false), 3000);
    } catch {
      setMetaError("Failed to save stream info. Please try again.");
    } finally {
      setMetaSaving(false);
    }
  }, [streamMeta]);

  // ── BRB toggle ────────────────────────────────────────────────────────────────
  const [brbOn, setBrbOn] = useState(false);
  const [brbToggling, setBrbToggling] = useState(false);
  const [brbError, setBrbError] = useState<string | null>(null);

  const handleToggleBrb = useCallback(async () => {
    setBrbToggling(true);
    setBrbError(null);
    try {
      const res = await setBrb(!brbOn);
      setBrbOn(res.on ?? !brbOn);
    } catch {
      setBrbError("Failed to toggle BRB. Please try again.");
    } finally {
      setBrbToggling(false);
    }
  }, [brbOn]);

  // ── Auto-messages state ────────────────────────────────────────────────────
  const [autoProfile, setAutoProfile] = useState<{
    boundaries: string;
    turnOns: string;
    streamGoal: string;
  }>({ boundaries: "", turnOns: "", streamGoal: "" });
  const [autoMessages, setAutoMessages] = useState<string[]>([]);
  const [autoActive, setAutoActive] = useState(false);
  const [autoPhase, setAutoPhase] = useState<"idle" | "generating" | "toggling">("idle");
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoFallback, setAutoFallback] = useState(false);

  useEffect(() => {
    getStreamProfile()
      .then((res) => {
        if (res.profile) {
          setAutoProfile({
            boundaries: res.profile.boundaries,
            turnOns: res.profile.turnOns,
            streamGoal: res.profile.streamGoal,
          });
          setAutoMessages(res.profile.messages);
          setAutoActive(res.profile.isActive);
        }
      })
      .catch(() => {});
  }, []);

  const handleGenerateMessages = useCallback(async () => {
    const { boundaries, turnOns, streamGoal } = autoProfile;
    if (!boundaries.trim() || !turnOns.trim() || !streamGoal.trim()) return;
    setAutoPhase("generating");
    setAutoError(null);
    setAutoFallback(false);
    try {
      const res = await saveStreamProfile(boundaries.trim(), turnOns.trim(), streamGoal.trim());
      setAutoMessages(res.messages);
      setAutoFallback(!res.aiGenerated);
    } catch (err: unknown) {
      setAutoError(err instanceof Error ? err.message : "Failed to generate messages");
    } finally {
      setAutoPhase("idle");
    }
  }, [autoProfile]);

  const handleToggleAuto = useCallback(async () => {
    setAutoPhase("toggling");
    setAutoError(null);
    try {
      if (autoActive) {
        await stopAutoMessages();
        setAutoActive(false);
      } else {
        await startAutoMessages();
        setAutoActive(true);
      }
    } catch (err: unknown) {
      setAutoError(err instanceof Error ? err.message : "Failed to toggle auto-messages");
    } finally {
      setAutoPhase("idle");
    }
  }, [autoActive]);

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
    if (rtmpInfo || loadingRef.current) return;
    loadingRef.current = true;
    setPhase("loading");
    setError(null);
    try {
      const result = await getRtmpKey();
      setRtmpInfo({ rtmpUrl: result.rtmpUrl!, streamKey: result.streamKey! });
      if (result.channelRef) setChannelRef(result.channelRef);
      setPhase("ready");
      loadingRef.current = false;
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.status === 404) {
        // No channel yet — self-provision automatically
        setPhase("provisioning");
        try {
          const provision = await provisionChannel();
          setRtmpInfo({ rtmpUrl: provision.rtmpUrl!, streamKey: provision.streamKey! });
          if (provision.channelRef) setChannelRef(provision.channelRef);
          setPhase("ready");
          loadingRef.current = false;
        } catch {
          setError("Could not load stream credentials. Please refresh the page or contact support.");
          setPhase("error");
          loadingRef.current = false;
        }
      } else {
        setError("Could not load stream credentials. Please refresh the page or contact support.");
        setPhase("error");
        loadingRef.current = false;
      }
    }
  }, [rtmpInfo]);

  // Auto-load credentials on mount once channelRef is available
  useEffect(() => {
    if (channelRef && !rtmpInfo) loadCredentials();
  }, [channelRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also trigger on first render if user has no liveChannel yet (provision flow)
  useEffect(() => {
    if (!user?.liveChannel && !rtmpInfo && phase === "idle") loadCredentials();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="min-h-screen" style={{ background: "var(--pnp-bg)" }}>
      <Helmet>
        <title>Go Live — PNPtv!</title>
      </Helmet>

      {/* Tip alert toast */}
      {tipAlert && (
        <div className="fixed right-4 z-50 px-4 py-3 rounded-xl bg-pnp-surface border border-pnp-accent/40 shadow-lg shadow-pnp-accent/10 max-w-xs pointer-events-none" style={{ top: "calc(1rem + env(safe-area-inset-top, 0px))" }}>
          <p className="text-sm font-bold text-pnp-accent">+{tipAlert.amount} tokens</p>
          <p className="text-xs text-pnp-textSecondary">from @{tipAlert.username}</p>
          {tipAlert.message && (
            <p className="text-xs text-pnp-textPrimary mt-0.5 italic">"{tipAlert.message}"</p>
          )}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

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

        {/* You Are Live banner */}
        {isLive && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
            style={{
              background: "rgba(52,199,89,0.1)",
              border: "1px solid rgba(52,199,89,0.3)",
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-bold text-green-400">YOU ARE LIVE</span>
                {viewerCount > 0 && (
                  <span className="ml-2 text-xs text-green-300/80">{viewerCount} watching</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* BRB toggle */}
              <div className="flex flex-col items-end gap-0.5">
                <button
                  onClick={handleToggleBrb}
                  disabled={brbToggling}
                  className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                    brbOn
                      ? "bg-amber-500/20 border border-amber-500/40 text-amber-300"
                      : "bg-white/8 border border-white/12 text-white/60 hover:text-white/90"
                  }`}
                >
                  {brbToggling ? "…" : brbOn ? "BRB ON" : "BRB"}
                </button>
                {brbError && (
                  <p className="text-red-400 text-xs mt-1">{brbError}</p>
                )}
              </div>
              {/* Watch link */}
              {channelRef && (
                <a
                  href={`/live/${encodeURIComponent(channelRef)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 transition-all"
                >
                  Watch →
                </a>
              )}
            </div>
          </div>
        )}

        {/* Stream health panel */}
        {channelRef && (
          <div className="bg-pnp-surface rounded-xl border border-white/8 p-4">
            <StreamHealthPanel streamId={channelRef} onHealth={(live) => setIsLive(live)} />
          </div>
        )}

        {/* ── Tab bar ── */}
        <div className="flex rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {(["setup", "show", "chat"] as const).map((tab) => {
            const labels: Record<typeof tab, string> = { setup: "📡 Setup", show: "🎭 Show", chat: "💬 Chat" };
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabSwitch(tab)}
                className="flex-1 relative py-2.5 text-sm font-semibold transition-all"
                style={{
                  background: isActive ? "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(123,97,255,0.25))" : "transparent",
                  color: isActive ? "#fff" : "rgba(255,255,255,0.45)",
                  borderBottom: isActive ? "2px solid #D4007A" : "2px solid transparent",
                }}
              >
                {labels[tab]}
                {tab === "chat" && chatUnread > 0 && (
                  <span
                    className="absolute top-1.5 right-3 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1"
                    style={{ background: "#D4007A", color: "#fff" }}
                  >
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Setup tab ── */}
        {activeTab === "setup" && (
          <div className="space-y-4">

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
                        Alert followers
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
                {phase === "ready" && rtmpInfo && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold">
                    Ready
                  </span>
                )}
              </div>

              {/* Loading / provisioning state */}
              {loading && (
                <div className="flex items-center justify-center gap-3 py-6">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span className="text-sm text-pnp-textSecondary">
                    {phase === "provisioning" ? "Setting up your channel…" : "Loading credentials…"}
                  </span>
                </div>
              )}

              {/* Credentials ready */}
              {phase === "ready" && rtmpInfo && (
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
                        {showKey ? rtmpInfo.streamKey : "•".repeat(Math.min(rtmpInfo.streamKey.length, 24))}
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
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
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

              {/* Error state with retry button */}
              {phase === "error" && (
                <div className="space-y-3">
                  <div className="px-4 py-3 rounded-xl text-xs bg-red-500/10 border border-red-500/20 text-red-300">
                    {error}
                  </div>
                  <Button onClick={loadCredentials} disabled={loading} className="w-full">
                    Retry
                  </Button>
                </div>
              )}

              {/* Idle state — should not normally appear since we auto-load, but fallback */}
              {phase === "idle" && !loading && !rtmpInfo && (
                <Button onClick={loadCredentials} disabled={loading} className="w-full">
                  Load credentials
                </Button>
              )}
            </Card>

            {/* OBS Setup Guide */}
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                OBS Setup Guide
              </h2>
              <div className="space-y-4">
                {/* Step 1 */}
                <div className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
                  >
                    1
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Download OBS Studio</p>
                    <p className="text-xs text-pnp-textSecondary">Get it free at obsproject.com — Windows, macOS, and Linux</p>
                    <a
                      href="https://obsproject.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-1 text-xs font-semibold text-pnp-accent hover:underline"
                    >
                      Download →
                    </a>
                  </div>
                </div>
                {/* Step 2 */}
                <div className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
                  >
                    2
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Open Settings → Stream</p>
                    <p className="text-xs text-pnp-textSecondary">In OBS: top menu → File → Settings → Stream tab</p>
                  </div>
                </div>
                {/* Step 3 */}
                <div className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
                  >
                    3
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Configure the service</p>
                    <p className="text-xs text-pnp-textSecondary">Set Service to 'Custom...', then paste the Server URL above. For Stream Key, copy it from Stream Credentials above.</p>
                  </div>
                </div>
                {/* Step 4 */}
                <div className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
                  >
                    4
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Set encoder settings</p>
                    <p className="text-xs text-pnp-textSecondary">In Settings → Output → Encoding: Video Bitrate 4500 kbps, Keyframe 2s, Audio 128 kbps AAC</p>
                  </div>
                </div>
                {/* Step 5 */}
                <div className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
                  >
                    5
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Click Start Streaming</p>
                    <p className="text-xs text-pnp-textSecondary">Press Start Streaming in OBS. Check the YOU ARE LIVE banner at the top — it confirms your signal is connected.</p>
                  </div>
                </div>
                {/* Step 6 */}
                <div className="flex items-start gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)", color: "#fff" }}
                  >
                    6
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Watch the chat here</p>
                    <p className="text-xs text-pnp-textSecondary">Switch to the Chat tab on this page to see and reply to viewers in real time.</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Recommended OBS Settings */}
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

            {/* Pro Tips */}
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

          </div>
        )}

        {/* ── Show tab ── */}
        {activeTab === "show" && (
          <div className="space-y-4">

            {/* Stream Info card */}
            <div id="stream-info-section">
              <Card className="p-5 space-y-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  Stream Info
                </h2>
                <p className="text-xs text-pnp-textSecondary">Shown on the Live discovery page to viewers.</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Stream title (e.g. Hot Sunday Show 🔥)"
                    maxLength={80}
                    value={streamMeta.title}
                    onChange={(e) => setStreamMeta((m) => ({ ...m, title: e.target.value }))}
                    className="w-full rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-2 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent"
                  />
                  <textarea
                    rows={2}
                    placeholder="Short description (optional)"
                    maxLength={200}
                    value={streamMeta.description}
                    onChange={(e) => setStreamMeta((m) => ({ ...m, description: e.target.value }))}
                    className="w-full rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent resize-none"
                  />
                  {/* Tags */}
                  {streamMeta.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {streamMeta.tags.map((tag) => (
                        <span
                          key={tag}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-pnp-accent/15 text-pnp-accent border border-pnp-accent/25"
                        >
                          #{tag}
                          <button
                            onClick={() => setStreamMeta((m) => ({ ...m, tags: m.tags.filter((t) => t !== tag) }))}
                            className="text-pnp-accent/60 hover:text-pnp-accent transition-colors"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {streamMeta.tags.length < 5 && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Add tag (e.g. latex, party, solo)"
                        maxLength={30}
                        value={metaTagInput}
                        onChange={(e) => setMetaTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            const tag = metaTagInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
                            if (tag && !streamMeta.tags.includes(tag)) {
                              setStreamMeta((m) => ({ ...m, tags: [...m.tags, tag] }));
                            }
                            setMetaTagInput("");
                          }
                        }}
                        className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent"
                      />
                      <button
                        onClick={() => {
                          const tag = metaTagInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
                          if (tag && !streamMeta.tags.includes(tag)) {
                            setStreamMeta((m) => ({ ...m, tags: [...m.tags, tag] }));
                          }
                          setMetaTagInput("");
                        }}
                        disabled={!metaTagInput.trim()}
                        className="px-3 py-1.5 rounded-lg bg-pnp-accent/20 border border-pnp-accent/40 text-pnp-accent text-xs font-semibold disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                  )}
                  <button
                    onClick={handleSaveMeta}
                    disabled={metaSaving || !streamMeta.title.trim()}
                    className="w-full py-2 rounded-lg btn-gradient text-white text-xs font-semibold disabled:opacity-50 transition-all active:scale-95"
                  >
                    {metaSaving ? "Saving…" : metaSaved ? "Saved ✓" : "Save stream info"}
                  </button>
                  {metaError && (
                    <p className="text-red-400 text-xs mt-1">{metaError}</p>
                  )}
                </div>
              </Card>
            </div>

            {/* Tip Goal */}
            <div id="tip-goal-section">
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
                    <p className="text-xs text-pnp-textSecondary">
                      No active goal. Set one now — it's ready as soon as you go live.
                    </p>
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
                    {goalError && (
                      <p className="text-[10px] text-red-400 mt-1">{goalError}</p>
                    )}
                  </div>
                )}
              </Card>
            </div>

            {/* Tip Menu */}
            <div id="tip-menu-section">
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
                {menuError && (
                  <p className="text-[10px] text-red-400 mt-1">{menuError}</p>
                )}
              </Card>
            </div>

            {/* Auto-Messages */}
            <div id="auto-messages-section">
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <svg className="w-4 h-4" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    Auto-Messages
                  </h2>
                  {autoMessages.length > 0 && (
                    <button
                      onClick={handleToggleAuto}
                      disabled={autoPhase === "toggling"}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${autoActive ? "bg-pnp-accent" : "bg-pnp-border"}`}
                      role="switch"
                      aria-checked={autoActive}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${autoActive ? "translate-x-4" : "translate-x-0"}`}
                      />
                    </button>
                  )}
                </div>

                <p className="text-xs text-pnp-textSecondary -mt-1">
                  PNPtv! will post engagement messages in your stream chat automatically every 3–5 minutes. Generated by AI from your profile.
                </p>

                {/* Profile fields */}
                <div className="space-y-3">
                  {(
                    [
                      { key: "boundaries", label: "What you won't do", placeholder: "e.g. No face reveal, no explicit requests…" },
                      { key: "turnOns", label: "What turns you on / what you enjoy showing", placeholder: "e.g. dancing, teasing, connecting with fans…" },
                      { key: "streamGoal", label: "Tonight's stream goal", placeholder: "e.g. Reach 500 tokens for a full show, hit follower milestone…" },
                    ] as const
                  ).map(({ key, label, placeholder }) => (
                    <div key={key}>
                      <label className="text-[10px] text-pnp-textSecondary uppercase tracking-wider font-semibold block mb-1">
                        {label}
                      </label>
                      <textarea
                        rows={2}
                        maxLength={500}
                        placeholder={placeholder}
                        value={autoProfile[key]}
                        onChange={(e) => setAutoProfile((p) => ({ ...p, [key]: e.target.value }))}
                        className="w-full rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent resize-none"
                      />
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleGenerateMessages}
                  disabled={
                    autoPhase === "generating" ||
                    !autoProfile.boundaries.trim() ||
                    !autoProfile.turnOns.trim() ||
                    !autoProfile.streamGoal.trim()
                  }
                  className="w-full py-2 rounded-lg btn-gradient text-white text-xs font-semibold disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  {autoPhase === "generating" ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Generating messages…
                    </>
                  ) : autoMessages.length > 0 ? (
                    "Regenerate messages"
                  ) : (
                    "Generate 12 messages"
                  )}
                </button>

                {autoFallback && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                    <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Grok credits exhausted — using default messages. They'll work fine.
                  </div>
                )}

                {autoError && (
                  <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                    {autoError}
                  </div>
                )}

                {autoMessages.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-pnp-textSecondary uppercase tracking-wider font-semibold">
                      Preview — {autoMessages.length} messages (cycling every 3–5 min)
                    </p>
                    <ul className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {autoMessages.map((msg, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <span className="text-[10px] font-bold text-pnp-textSecondary w-4 flex-shrink-0 mt-0.5">{i + 1}</span>
                          <span className="text-xs text-pnp-textPrimary leading-snug">{msg}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-pnp-textSecondary">
                      {autoActive
                        ? "Auto-messages are running. Toggle off to stop."
                        : !isLive
                          ? "Start streaming first, then toggle on to send messages during your stream."
                          : "Toggle on (top-right) to start sending these during your stream."}
                    </p>
                  </div>
                )}
              </Card>
            </div>

          </div>
        )}

        {/* ── Chat tab ── */}
        {activeTab === "chat" && (
          <div className="space-y-4">
            <div id="live-chat-section">
              <Card className="p-5 space-y-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <svg className="w-4 h-4 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Live Chat
                </h2>

                {/* Message list */}
                <div className="max-h-[60vh] overflow-y-auto rounded-lg space-y-1.5 pr-1" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", padding: "8px" }}>
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-pnp-textSecondary text-center py-6">No messages yet — be the first to chat!</p>
                  ) : (
                    chatMessages.map((msg) => {
                      const isOwn = msg.userId !== undefined && msg.userId === String(user?.id);
                      return (
                        <div key={msg.id} className="text-xs leading-snug">
                          <span className={`font-semibold ${isOwn ? "text-green-400" : "text-pnp-accent"}`}>
                            {msg.username}
                          </span>
                          <span className="text-white/80">: {msg.content}</span>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Reconnecting / socket error status */}
                {reconnecting && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1 py-1">
                    <span className="inline-block animate-spin">⟳</span> Reconnecting…
                  </p>
                )}
                {socketError && (
                  <p className="text-[10px] text-red-400 py-1">{socketError}</p>
                )}

                {/* Input row */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Say something…"
                    maxLength={300}
                    disabled={!channelRef}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        const trimmed = chatInput.trim();
                        if (!trimmed || !channelRef) return;
                        sendMessage(trimmed);
                        setChatInput("");
                      }
                    }}
                    className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-2.5 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-1 focus:ring-pnp-accent disabled:opacity-40"
                  />
                  <button
                    disabled={!chatInput.trim() || !channelRef}
                    onClick={() => {
                      const trimmed = chatInput.trim();
                      if (!trimmed || !channelRef) return;
                      sendMessage(trimmed);
                      setChatInput("");
                    }}
                    className="px-3 py-2 rounded-lg bg-pnp-accent/20 border border-pnp-accent/40 text-pnp-accent text-xs font-semibold disabled:opacity-40 transition-colors active:scale-95 flex-shrink-0"
                  >
                    Send
                  </button>
                </div>
                {!channelRef && (
                  <p className="text-[10px] text-pnp-textSecondary">Connecting to chat…</p>
                )}
              </Card>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
