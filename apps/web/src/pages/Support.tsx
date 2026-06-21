import React, { useState, useRef, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { CristinaWidget } from "@/components/CristinaWidget";
import {
  createSupportTicket,
  getSupportTicket,
  getTicketMessages,
  addTicketMessage,
  uploadSupportAttachment,
  type SupportTicket,
  type TicketMessage,
  type TicketCategory,
  type SupportAttachment,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { connectSocket } from "@/lib/socket";

function getDeviceContext() {
  const loc = window.location;
  return [
    `URL: ${loc.pathname}${loc.search}`,
    `UA: ${navigator.userAgent}`,
    `Screen: ${screen.width}x${screen.height} (${window.devicePixelRatio}x)`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
    `Lang: ${navigator.language}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
}

const CATEGORIES: { value: TicketCategory; label: string; icon: string }[] = [
  { value: "payment", label: "Payment", icon: "\u{1F4B3}" },
  { value: "account", label: "Account", icon: "\u{1F464}" },
  { value: "bug", label: "Bug Report", icon: "\u{1F41B}" },
  { value: "technical", label: "Technical", icon: "\u{1F527}" },
  { value: "feature", label: "Feature Request", icon: "\u{1F4A1}" },
  { value: "general", label: "General", icon: "\u{1F4AC}" },
];

export function Support() {
  const { support: t } = useI18n();
  const { isAuthenticated, user } = useAuth();
  const [tab, setTab] = useState<"cristina" | "ticket" | "feedback">("cristina");

  // Bug report modal
  const [showBugModal, setShowBugModal] = useState(false);
  const [bugText, setBugText] = useState("");
  const [bugSending, setBugSending] = useState(false);
  const [bugSent, setBugSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showBugModal && textareaRef.current) textareaRef.current.focus();
  }, [showBugModal]);

  const handleSubmitBug = async () => {
    if (!bugText.trim() || bugText.trim().length < 10) return;
    setBugSending(true);
    try {
      const desc = `${bugText.trim()}\n\n--- Device Info ---\n${getDeviceContext()}`;
      await createSupportTicket("bug", desc);
      setBugSent(true);
      setTimeout(() => { setShowBugModal(false); setBugText(""); setBugSent(false); }, 2000);
    } catch { /* silent */ }
    finally { setBugSending(false); }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Helmet>

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-1">{t.pageHeading}</h1>
        <p className="text-sm text-pnp-textSecondary">{t.pageSubtitle}</p>
      </div>

      {/* Quick Bug Report Card */}
      {isAuthenticated && (
        <button onClick={() => setShowBugModal(true)} className="w-full mb-4 p-4 rounded-xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]" style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))", border: "1px solid rgba(239,68,68,0.2)" }}>
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: "rgba(239,68,68,0.15)" }}>
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75z" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-400">{t.reportBugCard}</p>
              <p className="text-xs text-pnp-textSecondary mt-0.5 line-clamp-2">{t.reportBugCardDesc}</p>
            </div>
            <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </div>
        </button>
      )}

      {/* Tab bar */}
      {isAuthenticated && (
        <div className="flex gap-1 mb-4 p-1 rounded-xl bg-white/5">
          <button onClick={() => setTab("cristina")} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === "cristina" ? "text-white" : "text-pnp-textSecondary hover:text-white/70"}`} style={tab === "cristina" ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}>
            Ask Cristina
          </button>
          <button onClick={() => setTab("ticket")} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === "ticket" ? "text-white" : "text-pnp-textSecondary hover:text-white/70"}`} style={tab === "ticket" ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}>
            Support Ticket
          </button>
          <button onClick={() => setTab("feedback")} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === "feedback" ? "text-white" : "text-pnp-textSecondary hover:text-white/70"}`} style={tab === "feedback" ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}>
            Feedback
          </button>
        </div>
      )}

      {/* Tab content */}
      {tab === "cristina" ? (
        <CristinaWidget mode="page" />
      ) : tab === "feedback" ? (
        <iframe
          src={import.meta.env.VITE_FIDER_URL || "https://feedback.pnptv.app"}
          className="w-full rounded-xl border border-white/10"
          style={{ height: "calc(100dvh - 14rem)", minHeight: "400px" }}
          title="Community Feedback"
          loading="lazy"
        />
      ) : isAuthenticated ? (
        <TicketChat userId={user?.dbId || ""} />
      ) : null}

      {/* Bug Report Modal */}
      {showBugModal && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center" onClick={() => !bugSending && setShowBugModal(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full sm:max-w-md mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-pnp-textPrimary flex items-center gap-2">
                <span className="text-red-400"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75z" /></svg></span>
                {t.reportBugTitle}
              </h2>
              <button onClick={() => !bugSending && setShowBugModal(false)} className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            {bugSent ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center"><svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>
                <p className="text-sm text-green-400 font-medium text-center">{t.reportBugSuccess}</p>
              </div>
            ) : (
              <>
                <textarea ref={textareaRef} value={bugText} onChange={(e) => setBugText(e.target.value)} placeholder={t.reportBugPlaceholder} maxLength={2000} rows={5} style={{ fontSize: "16px" }} className="w-full rounded-xl p-3 bg-pnp-dark text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 border border-white/10 focus:border-red-400/50 focus:outline-none resize-none" />
                <div className="flex items-center justify-between mt-2 mb-4">
                  <p className="text-[10px] text-pnp-textSecondary">{t.reportBugDeviceInfo}</p>
                  <p className="text-[10px] text-pnp-textSecondary">{bugText.length}/2000</p>
                </div>
                <button onClick={handleSubmitBug} disabled={bugSending || bugText.trim().length < 10} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40" style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>
                  {bugSending ? t.reportBugSending : t.reportBugSubmit}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Telegram-Style Ticket Chat ──────────────────────────────────────────────

function TicketChat({ userId }: { userId: string }) {
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pending attachments for next message
  const [pendingAttachments, setPendingAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Create ticket form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCategory, setNewCategory] = useState<TicketCategory>("general");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Load ticket + messages
  const loadTicket = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSupportTicket();
      if (res.ticket) {
        setTicket(res.ticket);
        const msgRes = await getTicketMessages();
        setMessages(msgRes.messages || []);
      } else {
        setTicket(null);
        setMessages([]);
      }
    } catch { setError("Failed to load support ticket"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages.length]);

  // Socket.IO real-time
  useEffect(() => {
    const socket = connectSocket();

    const onNewMessage = (data: TicketMessage) => {
      setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data]);
    };
    const onStatusChange = (data: { status: string }) => {
      setTicket((prev) => prev ? { ...prev, status: data.status } : prev);
    };

    socket.on("support:newMessage", onNewMessage);
    socket.on("support:statusChange", onStatusChange);
    return () => {
      socket.off("support:newMessage", onNewMessage);
      socket.off("support:statusChange", onStatusChange);
    };
  }, []);

  // File pick handler
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await uploadSupportAttachment(files);
      setPendingAttachments((prev) => [...prev, ...uploaded]);
    } catch { /* user can retry */ }
    finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Send message
  const handleSend = async () => {
    if ((!messageInput.trim() && pendingAttachments.length === 0) || sending) return;
    const attachSnap = pendingAttachments.slice();
    setSending(true);
    try {
      await addTicketMessage(messageInput.trim() || "📎 Attachment", attachSnap.length > 0 ? attachSnap : undefined);
      // Optimistically add
      setMessages((prev) => [...prev, {
        id: Date.now(),
        sender_type: "user",
        sender_name: "You",
        content: messageInput.trim() || "📎 Attachment",
        attachments: attachSnap,
        created_at: new Date().toISOString(),
      }]);
      setMessageInput("");
      setPendingAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally { setSending(false); }
  };

  // Create ticket
  const handleCreate = async () => {
    if (!newDescription.trim() || newDescription.trim().length < 10 || creating) return;
    setCreating(true);
    try {
      const res = await createSupportTicket(newCategory, newDescription.trim());
      if (res.ticket) {
        setTicket(res.ticket);
        setShowCreateForm(false);
        setNewDescription("");
        // Reload messages
        const msgRes = await getTicketMessages();
        setMessages(msgRes.messages || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally { setCreating(false); }
  };

  // Status badge
  const statusColor = ticket?.status === "open" ? "#30D158" : ticket?.status === "resolved" ? "#5AC8FA" : "#8E8E93";
  const statusLabel = ticket?.status ? ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1) : "";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-white/20 border-t-pnp-accent rounded-full animate-spin" />
      </div>
    );
  }

  // No open ticket — show create form
  if (!ticket) {
    return (
      <div className="space-y-4">
        {!showCreateForm ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">{"\u{1F4AC}"}</p>
            <p className="text-white font-medium mb-1">No open support ticket</p>
            <p className="text-sm text-pnp-textSecondary mb-4">Create a ticket to get help from our team</p>
            <button onClick={() => setShowCreateForm(true)} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
              Create Ticket
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">New Support Ticket</h3>
            {/* Category selector */}
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => (
                <button key={cat.value} onClick={() => setNewCategory(cat.value)} className={`p-3 rounded-xl text-center transition-all ${newCategory === cat.value ? "border-pnp-accent/50 bg-pnp-accent/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`} style={{ border: `1px solid ${newCategory === cat.value ? "rgba(94,209,196,0.5)" : "rgba(255,255,255,0.1)"}` }}>
                  <span className="text-lg">{cat.icon}</span>
                  <p className="text-[10px] text-pnp-textSecondary mt-1">{cat.label}</p>
                </button>
              ))}
            </div>
            {/* Description */}
            <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Describe your issue in detail (min 10 characters)..." rows={4} maxLength={2000} style={{ fontSize: "16px" }} className="w-full rounded-xl p-3 bg-white/5 text-white placeholder-pnp-textSecondary border border-white/10 focus:border-pnp-accent/50 focus:outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setShowCreateForm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-pnp-textSecondary bg-white/5 hover:bg-white/10">Cancel</button>
              <button onClick={handleCreate} disabled={creating || newDescription.trim().length < 10} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {creating ? "Creating..." : "Submit Ticket"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Active ticket — Telegram-style chat
  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 22rem)" }}>
      {/* Ticket header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div>
          <h3 className="text-sm font-semibold text-white">Support Ticket</h3>
          <p className="text-[10px] text-pnp-textSecondary">{ticket.category} &middot; created {new Date(ticket.created_at).toLocaleDateString()}</p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${statusColor}20`, color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-pnp-textSecondary">Waiting for a response...</p>
          </div>
        ) : (
          <>
            {(() => {
              let lastDateStr = "";
              return messages.map((msg, idx) => {
                const isMe = msg.sender_type === "user";
                const prev = idx > 0 ? messages[idx - 1] : null;
                const next = idx < messages.length - 1 ? messages[idx + 1] : null;
                const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                const sameAsPrev = prev && prev.sender_type === msg.sender_type &&
                  (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 60000;
                const sameAsNext = next && next.sender_type === msg.sender_type &&
                  (new Date(next.created_at).getTime() - new Date(msg.created_at).getTime()) < 60000;
                const isLastInGroup = !sameAsNext;

                // Date separator
                const msgDate = new Date(msg.created_at);
                const dateStr = msgDate.toDateString();
                let dateSeparator = null;
                if (dateStr !== lastDateStr) {
                  lastDateStr = dateStr;
                  const today = new Date().toDateString();
                  const yesterday = new Date(Date.now() - 86400000).toDateString();
                  const label = dateStr === today ? "Today" : dateStr === yesterday ? "Yesterday" : msgDate.toLocaleDateString([], { month: "long", day: "numeric" });
                  dateSeparator = <div key={`date-${dateStr}`} className="flex justify-center py-2"><span className="text-[11px] text-pnp-textSecondary bg-white/5 px-3 py-0.5 rounded-full">{label}</span></div>;
                }

                return (
                  <React.Fragment key={msg.id}>
                    {dateSeparator}
                    <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${!sameAsPrev ? "mt-2" : "mt-0.5"}`}>
                      {/* Agent avatar */}
                      {!isMe && isLastInGroup && (
                        <div className="w-7 flex-shrink-0 self-end">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: "rgba(94,209,196,0.2)", color: "#5ED1C4" }}>
                            {msg.sender_name === "Cristina AI" ? "🧜‍♀️" : "S"}
                          </div>
                        </div>
                      )}
                      {!isMe && !isLastInGroup && <div className="w-7 flex-shrink-0" />}

                      <div className={`max-w-[75%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                        {/* Agent name */}
                        {!isMe && !sameAsPrev && (
                          <span className="text-[10px] text-pnp-accent ml-1 mb-0.5">{msg.sender_name}</span>
                        )}

                        <div
                          className={`relative px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                            isMe
                              ? `text-white ${isLastInGroup ? "rounded-2xl rounded-br-sm" : "rounded-2xl"}`
                              : `bg-white/10 text-white ${isLastInGroup ? "rounded-2xl rounded-bl-sm" : "rounded-2xl"}`
                          }`}
                          style={isMe ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
                        >
                          {/* SVG tail */}
                          {isLastInGroup && (
                            <svg className={`absolute bottom-0 w-2 h-3 ${isMe ? "-right-1.5" : "-left-1.5"}`} viewBox="0 0 8 12" fill={isMe ? "#E69138" : "rgba(255,255,255,0.1)"}>
                              {isMe ? <path d="M0 0 C0 0 0 12 8 12 C3 12 0 8 0 0Z" /> : <path d="M8 0 C8 0 8 12 0 12 C5 12 8 8 8 0Z" />}
                            </svg>
                          )}

                          <p>{msg.content}</p>
                          {(msg.attachments ?? []).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(msg.attachments ?? []).map((att, ai) =>
                                att.type?.startsWith("image/") ? (
                                  <img
                                    key={ai}
                                    src={att.url}
                                    alt={att.name}
                                    className="max-w-[160px] max-h-[120px] rounded-lg object-cover cursor-pointer"
                                    onClick={() => window.open(att.url, "_blank")}
                                  />
                                ) : (
                                  <a
                                    key={ai}
                                    href={att.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-black/20 border border-white/10 text-xs hover:bg-black/30 transition-colors"
                                  >
                                    <span>📄</span>
                                    <span className="truncate max-w-[120px]">{att.name}</span>
                                  </a>
                                )
                              )}
                            </div>
                          )}
                          <p className={`text-[10px] mt-0.5 ${isMe ? "text-white/60" : "text-pnp-textSecondary"}`}>{timeStr}</p>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input bar */}
      {ticket.status === "open" && (
        <div className="border-t border-pnp-border px-3 py-2" style={{ background: "var(--pnp-surface, #1C1C1E)" }}>
          {/* Pending attachment preview */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {pendingAttachments.map((att, i) =>
                att.type?.startsWith("image/") ? (
                  <div key={i} className="relative flex-shrink-0">
                    <img src={att.url} alt={att.name} className="w-12 h-12 rounded-lg object-cover border border-white/10" />
                    <button
                      type="button"
                      onClick={() => setPendingAttachments((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 text-white text-[9px] flex items-center justify-center"
                    >✕</button>
                  </div>
                ) : (
                  <div key={i} className="relative flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-white max-w-[140px]">
                    <span>📄</span><span className="truncate">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingAttachments((p) => p.filter((_, idx) => idx !== i))}
                      className="ml-1 flex-shrink-0 text-white/50 hover:text-white"
                    >✕</button>
                  </div>
                )
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={handleFilePick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Attach files"
              className="flex-shrink-0 p-2 rounded-full text-pnp-textSecondary hover:text-white transition-colors disabled:opacity-40"
            >
              {uploading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
              )}
            </button>
            <textarea value={messageInput} onChange={(e) => setMessageInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Type a message..." className="flex-1 bg-white/5 text-white placeholder-pnp-textSecondary rounded-2xl px-4 py-2.5 resize-none outline-none focus:ring-1 focus:ring-pnp-accent/50 max-h-24" rows={1} style={{ minHeight: "40px", fontSize: "16px" }} />
            <button type="button" onClick={handleSend} disabled={sending || (!messageInput.trim() && pendingAttachments.length === 0)} className="p-2 rounded-full text-white active:scale-90 transition-all flex-shrink-0 disabled:opacity-30" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }} aria-label="Send">
              {sending ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Resolved/Closed banner */}
      {ticket.status !== "open" && (
        <div className="px-4 py-3 border-t border-white/5 text-center">
          <p className="text-sm text-pnp-textSecondary">This ticket is <span className="font-semibold" style={{ color: statusColor }}>{statusLabel}</span></p>
        </div>
      )}
    </div>
  );
}

export default Support;
