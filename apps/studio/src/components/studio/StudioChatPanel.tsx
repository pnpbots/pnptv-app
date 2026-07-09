import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import type { LiveTip } from "@/hooks/useLiveSocket";
import { ChatIcon } from "./shared";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface StudioChatPanelProps {
  streamId: string | null;
  isLive: boolean;
  className?: string;
  channelRef?: string | null;
  onGoalUpdate?: (goal: import("@/lib/api").LiveGoal) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatBalance(n: number | null): string {
  if (n === null) return "—";
  return `${n.toLocaleString()} T`;
}

// ─── TipBanner ──────────────────────────────────────────────────────────────

interface TipBannerProps {
  tip: LiveTip;
}

function TipBanner({ tip }: TipBannerProps) {
  return (
    <div
      className="
        flex items-center gap-2 px-3 py-2 rounded-xl
        border border-pnp-warning/40
        animate-fade-in-up
      "
      style={{ background: "rgba(255,214,10,0.08)" }}
      role="status"
      aria-live="polite"
      aria-label={`New tip from ${tip.username}: ${tip.amount} tokens`}
    >
      {/* Coin icon */}
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-base"
        style={{ background: "rgba(255,214,10,0.18)" }}
        aria-hidden="true"
      >
        💰
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-pnp-warning leading-none">
          {tip.username}
          <span className="font-normal text-pnp-textSecondary ml-1">tipped</span>
          <span className="ml-1">{tip.amount} T</span>
        </p>
        {tip.message && (
          <p className="text-[10px] text-pnp-textSecondary mt-0.5 truncate">
            "{tip.message}"
          </p>
        )}
      </div>
    </div>
  );
}

// ─── OfflinePlaceholder ─────────────────────────────────────────────────────

function OfflinePlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 py-10 text-center px-4">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <ChatIcon className="w-6 h-6 text-pnp-textSecondary" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-pnp-textPrimary">
          Chat is offline
        </p>
        <p className="text-xs text-pnp-textSecondary mt-1">
          Go live to start chatting with your viewers
        </p>
      </div>
    </div>
  );
}

// ─── ConnectionStatus ───────────────────────────────────────────────────────

interface ConnectionStatusProps {
  isConnected: boolean;
  reconnecting: boolean;
  viewerCount: number;
  walletBalance: number | null;
}

function ConnectionStatus({
  isConnected,
  reconnecting,
  viewerCount,
  walletBalance,
}: ConnectionStatusProps) {
  const dotColor = isConnected ? "#5ED1C4" : reconnecting ? "#FFD60A" : "#FF453A";
  const statusLabel = isConnected ? "Connected" : reconnecting ? "Reconnecting…" : "Disconnected";

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-pnp-border">
      {/* Connection dot + label */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            background: dotColor,
            boxShadow: isConnected ? `0 0 5px ${dotColor}` : undefined,
          }}
          aria-hidden="true"
        />
        <span className="text-[10px] text-pnp-textSecondary font-medium">
          {statusLabel}
        </span>
        {viewerCount > 0 && (
          <span
            className="ml-1 text-[10px] text-pnp-textSecondary"
            aria-label={`${viewerCount} viewers`}
          >
            · {viewerCount} watching
          </span>
        )}
      </div>

      {/* Wallet balance */}
      <div className="text-[10px] text-pnp-textSecondary tabular-nums">
        <span className="text-pnp-textSecondary/60">Wallet</span>
        {" "}
        <span className="font-semibold" style={{ color: "#5ED1C4" }}>
          {formatBalance(walletBalance)}
        </span>
      </div>
    </div>
  );
}

// ─── StudioChatPanel ────────────────────────────────────────────────────────

export function StudioChatPanel({
  streamId,
  isLive,
  className = "",
  onGoalUpdate,
}: StudioChatPanelProps) {
  const {
    messages,
    tips,
    viewerCount,
    isConnected,
    reconnecting,
    sendMessage,
    latestTip,
    walletBalance,
    socketError,
    liveGoal,
    banUser,
  } = useLiveSocket(isLive ? streamId : null);

  const [inputValue, setInputValue] = useState("");
  const [pendingBanUserId, setPendingBanUserId] = useState<string | null>(null);
  const [lastTipId, setLastTipId] = useState<number | null>(null);
  const [visibleTip, setVisibleTip] = useState<LiveTip | null>(null);
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtBottomRef = useRef(true);

  // Auto-scroll only when the user is already near the bottom — otherwise
  // they're reading earlier messages and we shouldn't yank the scroll position.
  // When suppressed, show a "↓ new messages" pill they can tap.
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowNewMessagesPill(false);
    } else if (messages.length > 0) {
      setShowNewMessagesPill(true);
    }
  }, [messages]);

  // Track scroll position so we know whether to auto-scroll the next batch.
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      isAtBottomRef.current = nearBottom;
      if (nearBottom) setShowNewMessagesPill(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = () => {
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    setShowNewMessagesPill(false);
  };

  // Animate new tips — show banner for 5 seconds
  useEffect(() => {
    if (!latestTip) return;
    if (latestTip.id === lastTipId) return;

    setLastTipId(latestTip.id);
    setVisibleTip(latestTip);

    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    tipTimerRef.current = setTimeout(() => setVisibleTip(null), 5000);

    return () => {
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    };
  }, [latestTip, lastTipId]);

  // Propagate socket-pushed goal updates to parent (BrowserStream)
  useEffect(() => {
    if (liveGoal && onGoalUpdate) onGoalUpdate(liveGoal);
  }, [liveGoal, onGoalUpdate]);

  // Auto-cancel pending ban after 5 seconds if not confirmed
  useEffect(() => {
    if (!pendingBanUserId) return;
    const timer = setTimeout(() => setPendingBanUserId(null), 5000);
    return () => clearTimeout(timer);
  }, [pendingBanUserId]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !isConnected) return;
    sendMessage(trimmed);
    setInputValue("");
    inputRef.current?.focus();
  }, [inputValue, isConnected, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div
      className={`flex flex-col bg-pnp-surface border border-pnp-border rounded-2xl overflow-hidden ${className}`}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-pnp-border bg-pnp-background">
        <ChatIcon className="w-4 h-4 text-pnp-accent flex-shrink-0" aria-hidden="true" />
        <p className="text-xs font-semibold text-pnp-textPrimary flex-1">Live Chat</p>
        {isLive && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(212,0,122,0.18)", color: "#D4007A" }}
          >
            LIVE
          </span>
        )}
      </div>

      {/* ── Not-live placeholder ─────────────────────────────────────────── */}
      {!isLive ? (
        <OfflinePlaceholder />
      ) : (
        <>
          {/* ── Connection status row ──────────────────────────────────── */}
          <ConnectionStatus
            isConnected={isConnected}
            reconnecting={reconnecting}
            viewerCount={viewerCount}
            walletBalance={walletBalance}
          />

          {/* ── Tip banner (animated, auto-dismisses) ─────────────────── */}
          {visibleTip && (
            <div className="px-3 pt-2">
              <TipBanner tip={visibleTip} />
            </div>
          )}

          {/* ── Recent tips horizontal strip (improvement #8) ─────────── */}
          {tips.length > 0 && (
            <div className="px-3 pt-2">
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {tips.slice(-10).reverse().map((t) => (
                  <div
                    key={t.id}
                    className="flex-shrink-0 px-2 py-1 rounded-lg bg-pnp-warning/10 border border-pnp-warning/20 text-[9px] font-bold text-pnp-warning"
                  >
                    {t.username}: {t.amount}T
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Socket error notice ───────────────────────────────────── */}
          {socketError && (
            <div
              className="mx-3 mt-2 px-3 py-1.5 rounded-xl text-[10px] text-pnp-error border border-pnp-error/30"
              style={{ background: "rgba(255,69,58,0.08)" }}
              role="alert"
              aria-live="assertive"
            >
              {socketError}
            </div>
          )}

          {/* ── Message list ──────────────────────────────────────────── */}
          <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={messageListRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0"
            style={{ scrollbarWidth: "thin" }}
            role="log"
            aria-label="Live chat messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.length === 0 ? (
              <p className="text-[11px] text-pnp-textSecondary text-center py-6">
                No messages yet — be the first to say hi!
              </p>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="group flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span
                      className="text-[11px] font-semibold flex-shrink-0"
                      style={{ color: "#D4007A" }}
                    >
                      {msg.username}
                    </span>
                    <span className="text-[9px] text-pnp-textSecondary/60 flex-shrink-0 tabular-nums">
                      {formatTime(msg.createdAt)}
                    </span>
                    {msg.userId && (
                      pendingBanUserId === msg.userId ? (
                        <span className="ml-auto flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => { banUser(msg.userId); setPendingBanUserId(null); }}
                            className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(255,69,58,0.85)" }}
                            aria-label={`Confirm ban ${msg.username}`}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setPendingBanUserId(null)}
                            className="text-[9px] font-bold text-pnp-textSecondary px-1.5 py-0.5 rounded border border-pnp-border"
                            aria-label="Cancel ban"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setPendingBanUserId(msg.userId)}
                          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-bold text-pnp-error hover:text-red-400 flex-shrink-0 px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(255,69,58,0.12)" }}
                          title={`Ban ${msg.username}`}
                          aria-label={`Ban ${msg.username}`}
                        >
                          BAN
                        </button>
                      )
                    )}
                  </div>
                  <p className="text-xs text-pnp-textPrimary break-words leading-snug">
                    {msg.content}
                  </p>
                </div>
              ))
            )}
          </div>
          {showNewMessagesPill && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-semibold text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
              aria-label="Scroll to newest messages"
            >
              ↓ New messages
            </button>
          )}
          </div>

          {/* ── Message input ─────────────────────────────────────────── */}
          <div className="px-3 pb-3 pt-2 border-t border-pnp-border">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isConnected}
                maxLength={300}
                placeholder={
                  isConnected ? "Say something to your viewers…" : "Connecting…"
                }
                className="
                  flex-1 bg-pnp-background border border-pnp-border rounded-xl
                  px-3 py-2 text-xs text-pnp-textPrimary
                  placeholder-pnp-textSecondary/50
                  focus:outline-none focus:ring-2 focus:ring-pnp-accent
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors duration-150
                  min-h-[36px]
                "
                aria-label="Chat message"
              />
              <button
                onClick={handleSend}
                disabled={!isConnected || !inputValue.trim()}
                className="
                  flex-shrink-0 w-9 h-9 rounded-xl
                  flex items-center justify-center
                  transition-all duration-150
                  disabled:opacity-40 disabled:cursor-not-allowed
                  hover:opacity-90 active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                "
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                aria-label="Send message"
              >
                {/* Send arrow */}
                <svg
                  className="w-4 h-4 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
