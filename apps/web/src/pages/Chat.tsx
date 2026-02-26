import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  getHangoutGroups,
  createHangoutGroup,
  getGroupMessages,
  sendGroupMessage,
  startGroupCall,
  leaveHangoutGroup,
  deleteHangoutGroup,
  type HangoutGroup,
  type GroupMessage,
} from "@/lib/api";

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

type View = "list" | "chat";

export default function Chat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isPrime = user?.subscriptionType === "prime" || user?.subscriptionType === "active";

  // Group list state
  const [groups, setGroups] = useState<HangoutGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create group
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Chat view state
  const [view, setView] = useState<View>("list");
  const [activeGroup, setActiveGroup] = useState<HangoutGroup | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Video call
  const [callUrl, setCallUrl] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const data = await getHangoutGroups();
      setGroups(data.groups || []);
      setError(null);
    } catch {
      setError("Failed to load groups");
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadGroups().finally(() => setIsLoading(false));
  }, [loadGroups]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await createHangoutGroup(newName.trim(), newDesc.trim());
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      loadGroups();
    } catch {
      // silent
    } finally {
      setCreating(false);
    }
  };

  const openChat = async (group: HangoutGroup) => {
    setActiveGroup(group);
    setView("chat");
    setMessages([]);
    setCallUrl(null);
    setMessagesLoading(true);
    try {
      const data = await getGroupMessages(group.id);
      setMessages(data.messages || []);
    } catch {
      // silent
    } finally {
      setMessagesLoading(false);
    }

    // Auto-show active call banner
    if (group.hasActiveCall) {
      try {
        const callData = await startGroupCall(group.id);
        if (callData.jitsiUrl) setCallUrl(callData.jitsiUrl);
      } catch { /* silent */ }
    }

    // Poll for new messages every 5s
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await getGroupMessages(group.id);
        setMessages(data.messages || []);
      } catch {
        // silent
      }
    }, 5000);
  };

  const closeChat = () => {
    setView("list");
    setActiveGroup(null);
    setMessages([]);
    setCallUrl(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    loadGroups();
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!msgInput.trim() || sending || !activeGroup) return;
    setSending(true);
    const text = msgInput.trim();
    setMsgInput("");
    try {
      const data = await sendGroupMessage(activeGroup.id, text);
      if (data.success && data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
    } catch {
      // silent
    } finally {
      setSending(false);
    }
  };

  const handleStartCall = async () => {
    if (!activeGroup) return;
    try {
      const data = await startGroupCall(activeGroup.id);
      if (data.jitsiUrl) {
        setCallUrl(data.jitsiUrl);
      } else {
        alert("Video calls are not available right now. Please try again later.");
      }
    } catch {
      alert("Failed to start video call. Please try again later.");
    }
  };

  const handleLeaveGroup = async (groupId: number) => {
    try {
      await leaveHangoutGroup(groupId);
      closeChat();
    } catch {
      // silent
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    try {
      await deleteHangoutGroup(groupId);
      closeChat();
    } catch {
      // silent
    }
  };

  // ─── Chat View ────────────────────────────────────────────
  if (view === "chat" && activeGroup) {
    return (
      <div className="flex flex-col" style={{ height: "calc(100vh - 5rem)" }}>
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <button onClick={closeChat} className="text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{activeGroup.name}</h2>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              {activeGroup.memberCount} members
            </p>
          </div>
          {/* Video call button */}
          <button
            onClick={handleStartCall}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))" }}
          >
            <svg className="w-5 h-5" style={{ color: "#E69138" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          {/* Group menu */}
          {!activeGroup.isMain && (
            <button
              onClick={() => {
                if (activeGroup.creatorId === user?.dbId) {
                  handleDeleteGroup(activeGroup.id);
                } else {
                  handleLeaveGroup(activeGroup.id);
                }
              }}
              className="text-xs px-2 py-1 rounded"
              style={{ color: "#FF453A" }}
            >
              {activeGroup.creatorId === user?.dbId ? "Delete" : "Leave"}
            </button>
          )}
        </div>

        {/* Active call banner */}
        {callUrl && (
          <div className="glass-card-sm mx-4 mt-2 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse dot-gradient" />
                <span className="text-xs font-medium text-white">Video Call Active</span>
              </div>
              <button
                onClick={() => setCallUrl(null)}
                className="text-xs" style={{ color: "#FF453A" }}
              >
                Close
              </button>
            </div>
            <div className="aspect-video rounded-lg overflow-hidden">
              <iframe
                src={callUrl}
                className="w-full h-full border-0"
                allow="camera; microphone; display-capture; autoplay"
                title="Video Call"
              />
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messagesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/10" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 bg-white/10 rounded w-24" />
                    <div className="h-3 bg-white/10 rounded w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-white font-medium text-sm">No messages yet</p>
              <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
                Be the first to say something!
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.user_id === user?.dbId;
              return (
                <div key={msg.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                  {msg.photo_url ? (
                    <img src={msg.photo_url} className="w-8 h-8 rounded-full object-cover flex-shrink-0" alt="" />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: isMe ? "rgba(230, 145, 56, 0.2)" : "rgba(212, 0, 122, 0.2)",
                        color: isMe ? "#E69138" : "#D4007A",
                      }}
                    >
                      {(msg.first_name || msg.username || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div className={`max-w-[75%] ${isMe ? "text-right" : ""}`}>
                    <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "justify-end" : ""}`}>
                      <span className="text-xs font-medium text-white">
                        {msg.first_name || msg.username || "User"}
                      </span>
                      <span className="text-[10px]" style={{ color: "#8E8E93" }}>
                        {timeAgo(msg.created_at)}
                      </span>
                    </div>
                    <div
                      className="rounded-2xl px-3 py-2 text-sm text-white"
                      style={{
                        background: isMe
                          ? "linear-gradient(135deg, #D4007A, #E69138)"
                          : "rgba(255,255,255,0.08)",
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="px-4 py-3 border-t border-white/5">
          <div className="flex gap-2">
            <input
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Type a message..."
              className="flex-1 bg-white/5 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
              maxLength={2000}
            />
            <button
              onClick={handleSend}
              disabled={!msgInput.trim() || sending}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Group List View ──────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Hangouts</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            Group chats + video calls
          </p>
        </div>
        {isPrime && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-gradient px-3 py-1.5 rounded-lg text-white text-xs font-semibold"
          >
            + New Group
          </button>
        )}
      </div>

      {/* Create group form */}
      {showCreate && (
        <div className="glass-card-sm p-4 mb-4 animate-fade-in-up">
          <h3 className="text-sm font-semibold text-white mb-3">Create Subgroup</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Group name..."
            className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none mb-2"
            maxLength={100}
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)..."
            className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none mb-3 resize-none"
            rows={2}
            maxLength={500}
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 py-2 rounded-lg text-sm text-white/60 border border-white/10"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="flex-1 btn-gradient py-2 rounded-lg text-sm text-white font-semibold disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass-card-sm p-3 mb-4 border-l-4" style={{ borderLeftColor: "#FF453A" }}>
          <p className="text-sm text-white/80">{error}</p>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-48" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-16 h-16 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-white font-medium mb-1">No groups yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Log in to join the community
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => openChat(group)}
              className="w-full glass-card-sm p-4 text-left hover:border-white/20 transition-colors"
            >
              <div className="flex gap-3">
                {/* Group avatar */}
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
                  style={{
                    background: group.isMain
                      ? "linear-gradient(135deg, #D4007A, #E69138)"
                      : "rgba(212, 0, 122, 0.2)",
                    color: group.isMain ? "#fff" : "#D4007A",
                  }}
                >
                  {group.isMain ? "P" : group.name[0]?.toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-sm truncate">
                      {group.name}
                    </span>
                    {group.isMain && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                        MAIN
                      </span>
                    )}
                    {group.hasActiveCall && (
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full animate-pulse dot-gradient" />
                        <span className="text-[10px] text-gradient">LIVE</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs" style={{ color: "#8E8E93" }}>
                      {group.memberCount} members
                    </span>
                    {group.lastMessage && (
                      <span className="text-xs truncate max-w-[180px]" style={{ color: "#8E8E93" }}>
                        &middot; {group.lastMessage}
                      </span>
                    )}
                  </div>
                </div>

                <svg className="w-4 h-4 flex-shrink-0 self-center" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* PRIME upsell */}
      {!isPrime && (
        <div className="mt-6 glass-card-sm p-4 text-center">
          <p className="text-sm text-white font-medium mb-1">Want to create your own group?</p>
          <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
            Upgrade to PRIME to create subgroups with video calls
          </p>
          <button onClick={() => navigate("/subscribe")} className="btn-gradient px-6 py-2 rounded-lg text-white text-sm font-semibold">
            Upgrade to PRIME
          </button>
        </div>
      )}
    </div>
  );
}
