import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { searchNearby, getLiveStreams, type LiveStream, type GroupMessage } from "@/lib/api";
import { useTier } from "@/hooks/useTier";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SocketChatData {
  messages: GroupMessage[];
  sendMessage: (content: string) => void;
  emitTyping: () => void;
  typingUsers: string[];
}

interface VideoCallSidePanelProps {
  groupId: number;
  userId: string;
  /** Collapse to icon tabs on mobile */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Pre-wired socket data from parent — avoids duplicate useHangoutSocket */
  socketChat?: SocketChatData;
}

interface MobileBottomBarProps {
  groupId: number;
  userId: string;
  isAdmin?: boolean;
  isLandscape?: boolean;
  onOpenModBot?: () => void;
  /** Pre-wired socket data from parent — avoids duplicate useHangoutSocket */
  socketChat?: SocketChatData;
}

// ─── Shared hooks ────────────────────────────────────────────────────────────

function useNearbyCount() {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchNearby = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const res = await searchNearby(pos.coords.latitude, pos.coords.longitude, 25, 1);
            if (!cancelled) {
              setCount((res as any).count ?? (res as any).total ?? 0);
            }
          } catch {
            if (!cancelled) setCount(null);
          } finally {
            if (!cancelled) setLoading(false);
          }
        },
        () => {
          if (!cancelled) {
            setCount(null);
            setLoading(false);
          }
        },
        { maximumAge: 60000, timeout: 10000 }
      );
    };

    fetchNearby();
    const interval = setInterval(fetchNearby, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return { count, loading };
}

function useLiveCount() {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchLive = async () => {
      try {
        const res = await getLiveStreams();
        if (!cancelled) {
          setStreams(res.streams?.filter((s) => s.isLive) || []);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchLive();
    const interval = setInterval(fetchLive, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return { liveCount: streams.length, loading };
}

// ─── Mini Nearby Widget ──────────────────────────────────────────────────────

function MiniNearbyWidget() {
  const navigate = useNavigate();
  const { count, loading } = useNearbyCount();

  return (
    <button
      onClick={() => navigate("/nearby")}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-pnp-surface/50 hover:bg-pnp-surface active:scale-[0.98] transition-all text-left"
    >
      <div className="relative flex-shrink-0 w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <svg className="w-4.5 h-4.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        {count !== null && count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-pnp-textPrimary">Nearby</p>
        <p className="text-[10px] text-pnp-textSecondary truncate">
          {loading ? "Locating..." : count === null ? "Enable location" : `${count} member${count !== 1 ? "s" : ""} near you`}
        </p>
      </div>
      <svg className="w-3.5 h-3.5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </button>
  );
}

// ─── Mini Live Widget ────────────────────────────────────────────────────────

function MiniLiveWidget() {
  const navigate = useNavigate();
  const { liveCount, loading } = useLiveCount();

  return (
    <button
      onClick={() => navigate("/live")}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-pnp-surface/50 hover:bg-pnp-surface active:scale-[0.98] transition-all text-left"
    >
      <div className="relative flex-shrink-0 w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
        <svg className="w-4.5 h-4.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
        {liveCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-pnp-textPrimary">Live</p>
        <p className="text-[10px] text-pnp-textSecondary truncate">
          {loading ? "Checking..." : liveCount === 0 ? "No active streams" : `${liveCount} streaming now`}
        </p>
      </div>
      <svg className="w-3.5 h-3.5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </button>
  );
}

// ─── Side Panel Chat ─────────────────────────────────────────────────────────

function SidePanelChat({ groupId, userId, className, socketChat }: { groupId: number; userId: string; className?: string; socketChat?: SocketChatData }) {
  // Use pre-wired socket data when available (avoids duplicate hangout:join)
  const messages = socketChat?.messages ?? [];
  const sendMessage = socketChat?.sendMessage ?? (() => {});
  const emitTyping = socketChat?.emitTyping ?? (() => {});
  const typingUsers = socketChat?.typingUsers ?? [];
  const { isBanned, isFree } = useTier();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevMsgCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isBanned || isFree) return;
    sendMessage(input.trim());
    setInput("");
  }, [input, sendMessage, isBanned, isFree]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${className || ""}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <svg className="w-3.5 h-3.5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
        <span className="text-xs font-semibold text-pnp-textPrimary">Chat</span>
        <span className="text-[10px] text-pnp-textSecondary ml-auto">{messages.length}</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin">
        {messages.length === 0 && (
          <p className="text-[10px] text-pnp-textSecondary text-center py-4">No messages yet</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="flex items-start gap-1.5 group">
            {msg.photo_url ? (
              <img
                src={msg.photo_url}
                alt=""
                className="w-5 h-5 rounded-full flex-shrink-0 mt-0.5 object-cover"
              />
            ) : (
              <div className="w-5 h-5 rounded-full flex-shrink-0 mt-0.5 bg-pnp-accent/20 flex items-center justify-center">
                <span className="text-[8px] font-bold text-pnp-accent">
                  {(msg.first_name || msg.username || "?")[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-semibold text-pnp-accent mr-1">
                {msg.first_name || msg.username}
              </span>
              {msg.content && (
                <span className="text-[11px] text-pnp-textPrimary break-words">{msg.content}</span>
              )}
              {msg.media_url && (
                <div className="mt-0.5">
                  {msg.media_type === "image" ? (
                    <img src={msg.media_url} alt="" className="max-w-full max-h-20 rounded object-cover" />
                  ) : (
                    <span className="text-[10px] text-pnp-textSecondary italic">[video]</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-3 py-1">
          <p className="text-[9px] text-pnp-textSecondary italic truncate">
            {typingUsers.join(", ")} typing...
          </p>
        </div>
      )}

      {/* Input */}
      <div className="p-2 border-t border-white/5">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); emitTyping(); }}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            disabled={isBanned || isFree}
            className="flex-1 min-w-0 text-xs bg-pnp-surface/50 border border-white/5 rounded-lg px-2.5 py-1.5 text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 focus:outline-none focus:ring-1 focus:ring-pnp-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
            maxLength={2000}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-pnp-accent/20 hover:bg-pnp-accent/30 disabled:opacity-30 active:scale-95 transition-all"
          >
            <svg className="w-3.5 h-3.5 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mobile Bottom Bar + Sheet ───────────────────────────────────────────────

type MobileTab = "nearby" | "live" | "chat" | "radio" | "mod" | null;

export function MobileBottomBar({ groupId, userId, isAdmin = false, isLandscape = false, onOpenModBot, socketChat }: MobileBottomBarProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<MobileTab>(null);
  const { count: nearbyCount } = useNearbyCount();
  const { liveCount } = useLiveCount();

  const toggleTab = useCallback((tab: MobileTab) => {
    setActiveTab((prev) => (prev === tab ? null : tab));
  }, []);

  // ─── Shared tab buttons ─────────────────────────────────────────────

  const tabButtons = (
    <>
      {/* Nearby */}
      <button
        onClick={() => toggleTab("nearby")}
        className={`flex ${isLandscape ? "flex-col" : "flex-col"} items-center justify-center flex-1 ${isLandscape ? "w-full py-3" : "h-full"} active:scale-95 transition-all ${
          activeTab === "nearby" ? "text-emerald-400" : "text-pnp-textSecondary"
        }`}
      >
        <div className="relative">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          {nearbyCount !== null && nearbyCount > 0 && (
            <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full bg-emerald-500 text-[8px] font-bold text-white">
              {nearbyCount > 99 ? "99+" : nearbyCount}
            </span>
          )}
        </div>
        <span className="text-[9px] mt-0.5">Nearby</span>
      </button>

      {/* Live */}
      <button
        onClick={() => toggleTab("live")}
        className={`flex flex-col items-center justify-center flex-1 ${isLandscape ? "w-full py-3" : "h-full"} active:scale-95 transition-all ${
          activeTab === "live" ? "text-red-400" : "text-pnp-textSecondary"
        }`}
      >
        <div className="relative">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
          {liveCount > 0 && (
            <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
              {liveCount}
            </span>
          )}
        </div>
        <span className="text-[9px] mt-0.5">Live</span>
      </button>

      {/* Chat */}
      <button
        onClick={() => toggleTab("chat")}
        className={`flex flex-col items-center justify-center flex-1 ${isLandscape ? "w-full py-3" : "h-full"} active:scale-95 transition-all ${
          activeTab === "chat" ? "text-pnp-accent" : "text-pnp-textSecondary"
        }`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
        <span className="text-[9px] mt-0.5">Chat</span>
      </button>

      {/* Radio */}
      <button
        onClick={() => toggleTab("radio")}
        className={`flex flex-col items-center justify-center flex-1 ${isLandscape ? "w-full py-3" : "h-full"} active:scale-95 transition-all`}
        style={{ color: activeTab === "radio" ? "#F5A623" : undefined }}
      >
        <svg
          className={`w-5 h-5 ${activeTab === "radio" ? "" : "text-pnp-textSecondary"}`}
          style={activeTab === "radio" ? { color: "#F5A623" } : undefined}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
        </svg>
        <span className="text-[9px] mt-0.5">Radio</span>
      </button>

      {/* Mod Bot (admin only) */}
      {isAdmin && onOpenModBot && (
        <button
          onClick={() => { setActiveTab(null); onOpenModBot(); }}
          className={`flex flex-col items-center justify-center flex-1 ${isLandscape ? "w-full py-3" : "h-full"} active:scale-95 transition-all text-pnp-textSecondary`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[9px] mt-0.5">Mod</span>
        </button>
      )}
    </>
  );

  // ─── Sheet content ───────────────────────────────────────────────────

  const sheetContent = activeTab && activeTab !== "mod" ? (
    <>
      {activeTab === "nearby" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <MiniNearbyWidget />
          <p className="text-[10px] text-pnp-textSecondary text-center pt-2">
            Tap above to see who's nearby
          </p>
        </div>
      )}
      {activeTab === "live" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <MiniLiveWidget />
          <p className="text-[10px] text-pnp-textSecondary text-center pt-2">
            Tap above to watch live streams
          </p>
        </div>
      )}
      {activeTab === "chat" && (
        <SidePanelChat groupId={groupId} userId={userId} socketChat={socketChat} />
      )}
      {activeTab === "radio" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <button
            onClick={() => navigate("/media")}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-pnp-surface/50 hover:bg-pnp-surface active:scale-[0.98] transition-all text-left"
          >
            <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(245,166,35,0.15)" }}>
              <svg className="w-4.5 h-4.5" style={{ color: "#F5A623" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-pnp-textPrimary">Radio</p>
              <p className="text-[10px] text-pnp-textSecondary truncate">Open the media player</p>
            </div>
            <svg className="w-3.5 h-3.5 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
          <p className="text-[10px] text-pnp-textSecondary text-center pt-2">
            Tap above to open Radio
          </p>
        </div>
      )}
    </>
  ) : null;

  // ─── Landscape layout: vertical sidebar + right-side sheet ──────────

  if (isLandscape) {
    return (
      <>
        {/* Right-side sheet — slides in from left-12 */}
        {activeTab && activeTab !== "mod" && (
          <>
            {/* Backdrop */}
            <div
              className="absolute inset-0 z-20"
              onClick={() => setActiveTab(null)}
            />
            <div className="absolute left-12 inset-y-0 z-30 w-64 flex flex-col bg-pnp-background/95 backdrop-blur-md border-r border-white/10 animate-fade-in-up overflow-hidden">
              {/* Close handle row */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
                <span className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wide">
                  {activeTab === "nearby" ? "Nearby" : activeTab === "live" ? "Live" : activeTab === "chat" ? "Chat" : "Radio"}
                </span>
                <button
                  onClick={() => setActiveTab(null)}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 active:scale-95 transition-all"
                >
                  <svg className="w-3 h-3 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {sheetContent}
            </div>
          </>
        )}

        {/* Vertical tab bar on the left */}
        <div className="absolute left-0 inset-y-0 z-40 w-12 flex flex-col justify-around items-center bg-pnp-background/90 backdrop-blur-md border-r border-white/10">
          {tabButtons}
        </div>
      </>
    );
  }

  // ─── Portrait layout: horizontal bottom bar + slide-up sheet ────────

  return (
    <>
      {/* Slide-up sheet */}
      {activeTab && activeTab !== "mod" && (
        <div
          className="absolute bottom-12 inset-x-0 z-30 animate-fade-in-up"
          style={{ height: "55%" }}
        >
          {/* Backdrop — tap to close */}
          <div
            className="absolute inset-0 -top-[200%]"
            onClick={() => setActiveTab(null)}
          />
          <div className="relative h-full flex flex-col bg-pnp-background/95 backdrop-blur-md border-t border-white/10 rounded-t-2xl overflow-hidden">
            {/* Drag handle */}
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            {sheetContent}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="absolute bottom-0 inset-x-0 z-40 flex items-center justify-around h-12 bg-pnp-background/90 backdrop-blur-md border-t border-white/10 safe-area-pb">
        {tabButtons}
      </div>
    </>
  );
}

// ─── Main Side Panel (desktop) ───────────────────────────────────────────────

export function VideoCallSidePanel({
  groupId,
  userId,
  collapsed = false,
  onToggleCollapse,
  socketChat,
}: VideoCallSidePanelProps) {
  if (collapsed) {
    return (
      <div className="flex sm:flex-col gap-1 p-1 bg-pnp-background/80 backdrop-blur-sm rounded-xl border border-white/5">
        <button
          onClick={onToggleCollapse}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5 active:scale-95 transition-all"
          aria-label="Open side panel"
        >
          <svg className="w-5 h-5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-72 max-h-full bg-pnp-background/80 backdrop-blur-sm rounded-xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-xs font-semibold text-pnp-textPrimary">Activity</span>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/5 active:scale-95 transition-all"
            aria-label="Collapse panel"
          >
            <svg className="w-3.5 h-3.5 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}
      </div>

      {/* Mini widgets */}
      <div className="p-2 space-y-1.5 flex-shrink-0">
        <MiniNearbyWidget />
        <MiniLiveWidget />
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5 mx-2" />

      {/* Chat takes remaining space */}
      <SidePanelChat groupId={groupId} userId={userId} socketChat={socketChat} />
    </div>
  );
}
