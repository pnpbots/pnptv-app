import React, { useState, useEffect, useCallback, useRef } from "react";
import { Badge, Skeleton } from "@pnptv/ui-kit";
import { StatCard } from "@/components/admin/StatCard";
import { TIER_BADGE_VARIANTS, AvatarInitial } from "@/components/admin/shared";
import {
  getAdminSupportStats,
  getAdminSupportTickets,
  getAdminTicketMessages,
  sendAdminTicketReply,
  updateAdminTicket,
  getAdminPlans,
  adminAssignUserPlan,
  adminGrantUserEntitlement,
  uploadSupportAttachment,
  type SupportStats,
  type AdminSupportTicket,
  type SupportMessage,
  type SupportAttachment,
  type AdminPlan,
} from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  payment: "💳 Payment",
  account: "👤 Account",
  bug: "🐛 Bug",
  feature: "🚀 Feature",
  technical: "🛠 Technical",
  general: "📋 General",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/15 border-red-500/30",
  high: "text-orange-400 bg-orange-500/15 border-orange-500/30",
  medium: "text-yellow-400 bg-yellow-500/15 border-yellow-500/30",
  low: "text-pnp-textSecondary bg-pnp-surface border-pnp-border",
};

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-400",
  low: "bg-pnp-textSecondary",
};

const STATUS_COLORS: Record<string, string> = {
  open: "text-green-400 bg-green-500/15 border-green-500/30",
  resolved: "text-blue-400 bg-blue-500/15 border-blue-500/30",
  closed: "text-pnp-textSecondary bg-pnp-surface border-pnp-border",
};

// ── SVG Icons ─────────────────────────────────────────────────────────────────

const TicketIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const StarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);

const AlertIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const SendIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const ChevronDown = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

// ── Sub-components ─────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.low}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[priority] ?? PRIORITY_DOT.low}`} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? STATUS_COLORS.closed}`}>
      {status}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-pnp-surface border border-pnp-border text-pnp-textSecondary">
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

// ── Stats Skeletons ────────────────────────────────────────────────────────────

function StatsBarSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl bg-pnp-surface border border-pnp-border p-4 animate-pulse">
          <div className="h-3 w-24 rounded bg-pnp-border mb-3" />
          <div className="h-8 w-16 rounded bg-pnp-border mb-2" />
          <div className="h-3 w-32 rounded bg-pnp-border" />
        </div>
      ))}
    </div>
  );
}

function TicketCardSkeleton() {
  return (
    <div className="p-4 border-b border-pnp-border animate-pulse">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-full bg-pnp-border flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="h-3 w-32 rounded bg-pnp-border mb-2" />
          <div className="h-3 w-full rounded bg-pnp-border mb-2" />
          <div className="flex gap-2">
            <div className="h-4 w-16 rounded-full bg-pnp-border" />
            <div className="h-4 w-14 rounded-full bg-pnp-border" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
          <div className={`max-w-xs rounded-xl p-3 animate-pulse ${i % 2 === 0 ? "bg-pnp-surface" : "bg-pnp-accent/20"}`}>
            <div className="h-3 w-48 rounded bg-pnp-border mb-2" />
            <div className="h-3 w-32 rounded bg-pnp-border" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Filter Bar ─────────────────────────────────────────────────────────────────

interface Filters {
  status: string;
  priority: string;
  category: string;
  search: string;
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="p-3 border-b border-pnp-border flex flex-col gap-2">
      <div className="flex gap-2">
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
          className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary text-xs px-2 py-1.5 focus:outline-none focus:border-pnp-accent"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={filters.priority}
          onChange={(e) => onChange({ ...filters, priority: e.target.value })}
          className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary text-xs px-2 py-1.5 focus:outline-none focus:border-pnp-accent"
        >
          <option value="">All Priority</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value })}
          className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary text-xs px-2 py-1.5 focus:outline-none focus:border-pnp-accent"
        >
          <option value="">All Categories</option>
          <option value="payment">💳 Payment</option>
          <option value="account">👤 Account</option>
          <option value="bug">🐛 Bug</option>
          <option value="feature">🚀 Feature</option>
          <option value="technical">🛠 Technical</option>
          <option value="general">📋 General</option>
        </select>
      </div>
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-pnp-textSecondary"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search tickets..."
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary text-xs placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent"
        />
      </div>
    </div>
  );
}

// ── Ticket Card ────────────────────────────────────────────────────────────────

function TicketCard({
  ticket,
  selected,
  onClick,
}: {
  ticket: AdminSupportTicket;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 border-b border-pnp-border transition-colors hover:bg-pnp-surface/60 ${
        selected ? "bg-pnp-accent/10 border-l-2 border-l-pnp-accent" : ""
      }`}
    >
      <div className="flex gap-3">
        <AvatarInitial name={ticket.username || ticket.firstName || "?"} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-medium text-pnp-textPrimary truncate">
                {ticket.firstName || ticket.username || `User ${ticket.userId}`}
              </span>
              <Badge variant={TIER_BADGE_VARIANTS[ticket.tier] ?? "default"}>{ticket.tier}</Badge>
            </div>
            <span className="text-xs text-pnp-textSecondary whitespace-nowrap flex-shrink-0">
              {formatTimeAgo(ticket.lastMessageAt)}
            </span>
          </div>
          <p className="text-xs text-pnp-textSecondary line-clamp-2 mb-2">
            {ticket.lastMessage || "No messages yet"}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryBadge category={ticket.category} />
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
            {ticket.unreadCount > 0 && (
              <span className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-pnp-accent text-white text-xs font-bold">
                {ticket.unreadCount > 9 ? "9+" : ticket.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: SupportMessage }) {
  const isAgent = message.senderRole === "agent" || message.senderRole === "admin";
  const attachments = message.attachments ?? [];
  return (
    <div className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-sm lg:max-w-md ${isAgent ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {!isAgent && (
          <span className="text-xs text-pnp-textSecondary px-1">{message.senderName || "User"}</span>
        )}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
            isAgent
              ? "bg-pnp-accent text-white rounded-br-sm"
              : "bg-pnp-surface border border-pnp-border text-pnp-textPrimary rounded-bl-sm"
          }`}
        >
          {message.content}
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((att, i) =>
                att.type.startsWith("image/") ? (
                  <img
                    key={i}
                    src={att.url}
                    alt={att.name}
                    className="max-w-[180px] max-h-[120px] rounded-lg object-cover cursor-pointer"
                    onClick={() => window.open(att.url, "_blank")}
                  />
                ) : (
                  <a
                    key={i}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/10 text-xs hover:bg-black/30 transition-colors"
                  >
                    <span>📄</span>
                    <span className="truncate max-w-[140px]">{att.name}</span>
                  </a>
                )
              )}
            </div>
          )}
        </div>
        <span className={`text-xs text-pnp-textSecondary px-1 ${isAgent ? "text-right" : ""}`}>
          {formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ── Grant Access Panel ────────────────────────────────────────────────────────

const ADDON_OPTIONS = [
  { value: "prime", label: "PRIME" },
  { value: "pnp-member", label: "PNP Member" },
  { value: "channel-access", label: "Channel Access" },
  { value: "hangout-access", label: "Hangout Access" },
];

// ── Ticket Detail Panel ────────────────────────────────────────────────────────

interface TicketDetailProps {
  ticket: AdminSupportTicket;
  onUpdate: (updated: Partial<AdminSupportTicket>) => void;
}

function TicketDetail({ ticket, onUpdate }: TicketDetailProps) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Grant Access state
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantTab, setGrantTab] = useState<"plan" | "addon">("plan");
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [grantPlanId, setGrantPlanId] = useState("");
  const [grantAddOnId, setGrantAddOnId] = useState("prime");
  const [grantDays, setGrantDays] = useState(30);
  const [grantLifetime, setGrantLifetime] = useState(false);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantResult, setGrantResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Attachment state
  const [replyAttachments, setReplyAttachments] = useState<SupportAttachment[]>([]);
  const [attachUploading, setAttachUploading] = useState(false);
  const replyFileRef = useRef<HTMLInputElement>(null);

  // Load plans when ticket changes
  useEffect(() => {
    if (!ticket) return;
    setGrantOpen(false);
    setGrantResult(null);
    getAdminPlans().then((r) => {
      const active = r.plans.filter((p) => p.active);
      setPlans(active);
      if (active.length > 0) setGrantPlanId(String(active[0].id));
    }).catch(() => {});
  }, [ticket.userId]);

  const loadMessages = useCallback(async () => {
    try {
      const res = await getAdminTicketMessages(String(ticket.userId));
      setMessages(res.messages);
      setMessagesError(null);
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setMessagesLoading(false);
    }
  }, [ticket.userId]);

  useEffect(() => {
    setMessagesLoading(true);
    setMessages([]);
    setMessagesError(null);
    setReply("");
    setReplyAttachments([]);
    loadMessages();
    pollRef.current = setInterval(loadMessages, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const content = reply.trim();
    if (!content || sending) return;
    setSending(true);
    const attachmentsSnapshot = replyAttachments.slice();
    try {
      await sendAdminTicketReply(
        String(ticket.userId),
        content,
        attachmentsSnapshot.length > 0 ? attachmentsSnapshot : undefined
      );
      setReply("");
      setReplyAttachments([]);
      await loadMessages();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }, [reply, sending, ticket.userId, loadMessages, replyAttachments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setAttachUploading(true);
    try {
      const uploaded = await uploadSupportAttachment(files);
      setReplyAttachments((prev) => [...prev, ...uploaded]);
    } catch {
      // silently ignore upload errors — user can retry by re-selecting
    } finally {
      setAttachUploading(false);
      // reset so the same file can be re-selected if needed
      e.target.value = "";
    }
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setReplyAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      setActionLoading(true);
      setActionError(null);
      try {
        await updateAdminTicket(String(ticket.userId), { status: newStatus });
        onUpdate({ status: newStatus });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to update ticket");
      } finally {
        setActionLoading(false);
      }
    },
    [ticket.userId, onUpdate]
  );

  const handlePriorityChange = useCallback(
    async (newPriority: string) => {
      setActionLoading(true);
      setActionError(null);
      try {
        await updateAdminTicket(String(ticket.userId), { priority: newPriority });
        onUpdate({ priority: newPriority });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to update ticket");
      } finally {
        setActionLoading(false);
      }
    },
    [ticket.userId, onUpdate]
  );

  const handleCategoryChange = useCallback(
    async (newCategory: string) => {
      setActionLoading(true);
      setActionError(null);
      try {
        await updateAdminTicket(String(ticket.userId), { category: newCategory });
        onUpdate({ category: newCategory });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to update ticket");
      } finally {
        setActionLoading(false);
      }
    },
    [ticket.userId, onUpdate]
  );

  const handleGrantPlan = useCallback(async () => {
    if (!grantPlanId || grantLoading) return;
    setGrantLoading(true);
    setGrantResult(null);
    try {
      const res = await adminAssignUserPlan(String(ticket.userId), grantPlanId);
      if (res.success) {
        const planName = res.plan?.displayName ?? plans.find((p) => String(p.id) === grantPlanId)?.display_name ?? grantPlanId;
        setGrantResult({ ok: true, msg: `Granted ${planName}` });
        // Auto-send confirmation reply in thread
        sendAdminTicketReply(String(ticket.userId), `Access granted: ${planName}`).then(loadMessages).catch(() => {});
      } else {
        setGrantResult({ ok: false, msg: res.error ?? "Failed to assign plan" });
      }
    } catch (err) {
      setGrantResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to assign plan" });
    } finally {
      setGrantLoading(false);
    }
  }, [grantPlanId, grantLoading, ticket.userId, plans, loadMessages]);

  const handleGrantAddon = useCallback(async () => {
    if (grantLoading) return;
    setGrantLoading(true);
    setGrantResult(null);
    try {
      const res = await adminGrantUserEntitlement(String(ticket.userId), grantAddOnId, {
        durationDays: grantLifetime ? undefined : grantDays,
        isLifetime: grantLifetime,
        reason: "admin_support",
      });
      if (res.success) {
        const suffix = grantLifetime ? " (lifetime)" : ` — ${grantDays}d`;
        setGrantResult({ ok: true, msg: `Entitlement granted: ${grantAddOnId}${suffix}` });
        sendAdminTicketReply(
          String(ticket.userId),
          `Entitlement granted: ${grantAddOnId}${suffix}`
        ).then(loadMessages).catch(() => {});
      } else {
        setGrantResult({ ok: false, msg: res.error ?? "Failed to grant entitlement" });
      }
    } catch (err) {
      setGrantResult({ ok: false, msg: err instanceof Error ? err.message : "Failed to grant entitlement" });
    } finally {
      setGrantLoading(false);
    }
  }, [grantLoading, ticket.userId, grantAddOnId, grantLifetime, grantDays, loadMessages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-pnp-border flex-shrink-0">
        <div className="flex items-start gap-3 mb-3">
          <AvatarInitial name={ticket.username || ticket.firstName || "?"} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-pnp-textPrimary">
                {ticket.firstName || ticket.username || `User ${ticket.userId}`}
              </span>
              {ticket.username && (
                <span className="text-xs text-pnp-textSecondary">@{ticket.username}</span>
              )}
              <Badge variant={TIER_BADGE_VARIANTS[ticket.tier] ?? "default"}>{ticket.tier}</Badge>
            </div>
            <div className="text-xs text-pnp-textSecondary mt-0.5">
              {ticket.plan && <span className="mr-2">Plan: {ticket.plan}</span>}
              {ticket.language && <span>Lang: {ticket.language.toUpperCase()}</span>}
            </div>
          </div>
          {actionLoading && (
            <div className="w-4 h-4 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
        </div>

        {/* Editable meta fields */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-pnp-textSecondary">Status:</span>
            <div className="relative inline-flex items-center gap-1">
              <select
                value={ticket.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={actionLoading}
                className={`appearance-none pl-2 pr-6 py-0.5 rounded-full text-xs font-medium border cursor-pointer focus:outline-none disabled:opacity-50 ${STATUS_COLORS[ticket.status] ?? STATUS_COLORS.closed}`}
              >
                <option value="open">open</option>
                <option value="resolved">resolved</option>
                <option value="closed">closed</option>
              </select>
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2"><ChevronDown /></span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-pnp-textSecondary">Priority:</span>
            <div className="relative inline-flex items-center gap-1">
              <select
                value={ticket.priority}
                onChange={(e) => handlePriorityChange(e.target.value)}
                disabled={actionLoading}
                className={`appearance-none pl-2 pr-6 py-0.5 rounded-full text-xs font-medium border cursor-pointer focus:outline-none disabled:opacity-50 ${PRIORITY_COLORS[ticket.priority] ?? PRIORITY_COLORS.low}`}
              >
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2"><ChevronDown /></span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-pnp-textSecondary">Category:</span>
            <div className="relative inline-flex items-center">
              <select
                value={ticket.category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                disabled={actionLoading}
                className="appearance-none pl-2 pr-6 py-0.5 rounded-full text-xs font-medium border border-pnp-border bg-pnp-surface text-pnp-textSecondary cursor-pointer focus:outline-none disabled:opacity-50"
              >
                <option value="payment">💳 Payment</option>
                <option value="account">👤 Account</option>
                <option value="bug">🐛 Bug</option>
                <option value="feature">🚀 Feature</option>
                <option value="technical">🛠 Technical</option>
                <option value="general">📋 General</option>
              </select>
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2"><ChevronDown /></span>
            </div>
          </div>
        </div>

        {/* Quick action buttons */}
        <div className="flex flex-wrap gap-2">
          {ticket.status !== "resolved" && (
            <button
              onClick={() => handleStatusChange("resolved")}
              disabled={actionLoading}
              className="px-3 py-1 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
            >
              Mark Resolved
            </button>
          )}
          {ticket.status !== "closed" && (
            <button
              onClick={() => handleStatusChange("closed")}
              disabled={actionLoading}
              className="px-3 py-1 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textSecondary text-xs font-medium hover:border-pnp-accent hover:text-pnp-accent transition-colors disabled:opacity-50"
            >
              Mark Closed
            </button>
          )}
          {ticket.status !== "open" && (
            <button
              onClick={() => handleStatusChange("open")}
              disabled={actionLoading}
              className="px-3 py-1 rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/30 transition-colors disabled:opacity-50"
            >
              Reopen
            </button>
          )}
          {ticket.priority !== "critical" && (
            <button
              onClick={() => handlePriorityChange("critical")}
              disabled={actionLoading}
              className="px-3 py-1 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              Escalate
            </button>
          )}
          {/* Grant Access toggle */}
          <button
            onClick={() => { setGrantOpen((v) => !v); setGrantResult(null); }}
            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
              grantOpen
                ? "bg-yellow-500/20 border-yellow-500/30 text-yellow-300"
                : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-yellow-500/50 hover:text-yellow-300"
            }`}
          >
            ⚡ Grant Access
          </button>
        </div>

        {actionError && (
          <p className="text-xs text-pnp-error mt-2">{actionError}</p>
        )}

        {/* Grant Access panel */}
        {grantOpen && (
          <div className="mt-3 rounded-xl bg-pnp-surface border border-white/10 p-3 text-sm">
            {/* Tab switcher */}
            <div className="flex gap-1 mb-3 p-1 rounded-lg bg-pnp-background border border-pnp-border w-fit">
              <button
                onClick={() => setGrantTab("plan")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  grantTab === "plan"
                    ? "bg-pnp-accent text-white"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary"
                }`}
              >
                Plan
              </button>
              <button
                onClick={() => setGrantTab("addon")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  grantTab === "addon"
                    ? "bg-pnp-accent text-white"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary"
                }`}
              >
                Add-on
              </button>
            </div>

            {grantTab === "plan" && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={grantPlanId}
                  onChange={(e) => setGrantPlanId(e.target.value)}
                  disabled={grantLoading || plans.length === 0}
                  className="flex-1 min-w-[160px] rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary text-xs px-2 py-1.5 focus:outline-none focus:border-pnp-accent disabled:opacity-50"
                >
                  {plans.length === 0 ? (
                    <option value="">Loading plans...</option>
                  ) : (
                    plans.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.display_name} ({p.tier})
                      </option>
                    ))
                  )}
                </select>
                <button
                  onClick={handleGrantPlan}
                  disabled={grantLoading || !grantPlanId || plans.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-pnp-accent text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {grantLoading ? (
                    <div className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                  ) : null}
                  Assign Plan
                </button>
              </div>
            )}

            {grantTab === "addon" && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={grantAddOnId}
                    onChange={(e) => setGrantAddOnId(e.target.value)}
                    disabled={grantLoading}
                    className="rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary text-xs px-2 py-1.5 focus:outline-none focus:border-pnp-accent disabled:opacity-50"
                  >
                    {ADDON_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={grantDays}
                      onChange={(e) => setGrantDays(Math.max(1, Math.min(3650, Number(e.target.value))))}
                      disabled={grantLoading || grantLifetime}
                      className="w-20 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary text-xs px-2 py-1.5 text-center focus:outline-none focus:border-pnp-accent disabled:opacity-40"
                    />
                    <span className="text-xs text-pnp-textSecondary">days</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={grantLifetime}
                        onChange={(e) => setGrantLifetime(e.target.checked)}
                        disabled={grantLoading}
                        className="accent-pnp-accent"
                      />
                      <span className="text-xs text-pnp-textSecondary">Lifetime</span>
                    </label>
                  </div>
                  <button
                    onClick={handleGrantAddon}
                    disabled={grantLoading}
                    className="px-3 py-1.5 rounded-lg bg-pnp-accent text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {grantLoading ? (
                      <div className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    ) : null}
                    Grant
                  </button>
                </div>
              </div>
            )}

            {/* Grant result feedback */}
            {grantResult && (
              <p className={`mt-2 text-xs font-medium ${grantResult.ok ? "text-green-400" : "text-pnp-error"}`}>
                {grantResult.ok ? "✅" : "❌"} {grantResult.msg}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Messages thread */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {messagesLoading ? (
          <MessagesSkeleton />
        ) : messagesError ? (
          <div className="p-6 text-center">
            <p className="text-sm text-pnp-error mb-2">{messagesError}</p>
            <button onClick={loadMessages} className="text-xs text-pnp-accent hover:underline">
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-pnp-textSecondary">No messages yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {messages.map((msg, idx) => {
              const showDate =
                idx === 0 ||
                formatDate(msg.createdAt) !== formatDate(messages[idx - 1].createdAt);
              return (
                <React.Fragment key={msg.id}>
                  {showDate && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-pnp-border" />
                      <span className="text-xs text-pnp-textSecondary px-2 whitespace-nowrap">
                        {formatDate(msg.createdAt)}
                      </span>
                      <div className="flex-1 h-px bg-pnp-border" />
                    </div>
                  )}
                  <MessageBubble message={msg} />
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Reply input */}
      <div className="p-4 border-t border-pnp-border flex-shrink-0">
        {/* Attachment preview strip */}
        {replyAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {replyAttachments.map((att, i) =>
              att.type.startsWith("image/") ? (
                <div key={i} className="relative flex-shrink-0">
                  <img
                    src={att.url}
                    alt={att.name}
                    className="w-12 h-12 rounded-lg object-cover border border-pnp-border"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    aria-label={`Remove ${att.name}`}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-pnp-background border border-pnp-border text-pnp-textSecondary flex items-center justify-center text-xs leading-none hover:text-pnp-error transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div key={i} className="relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-pnp-surface border border-pnp-border text-xs text-pnp-textSecondary max-w-[180px]">
                  <span>📄</span>
                  <span className="truncate">{att.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    aria-label={`Remove ${att.name}`}
                    className="ml-1 flex-shrink-0 text-pnp-textSecondary hover:text-pnp-error transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <div className="flex gap-2 items-end">
          {/* Hidden file input */}
          <input
            ref={replyFileRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={handleFileChange}
          />
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a reply... (Ctrl+Enter to send)"
            rows={3}
            className="flex-1 rounded-xl bg-pnp-surface border border-pnp-border text-pnp-textPrimary px-3 py-2.5 placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent resize-none" style={{ fontSize: "16px" }}
          />
          {/* Paperclip button */}
          <button
            type="button"
            onClick={() => replyFileRef.current?.click()}
            disabled={attachUploading}
            aria-label="Attach files"
            title="Attach files"
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-pnp-surface border border-pnp-border text-pnp-textSecondary flex items-center justify-center hover:border-pnp-accent hover:text-pnp-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {attachUploading ? (
              <div className="w-4 h-4 border-2 border-pnp-textSecondary/50 border-t-pnp-textSecondary rounded-full animate-spin" />
            ) : (
              <span className="text-base leading-none">📎</span>
            )}
          </button>
          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={sending || (!reply.trim() && replyAttachments.length === 0)}
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-pnp-accent flex items-center justify-center text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
            ) : (
              <SendIcon />
            )}
          </button>
        </div>
        <p className="text-xs text-pnp-textSecondary mt-1.5">Ctrl+Enter to send</p>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function NoTicketSelected() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-pnp-surface border border-pnp-border flex items-center justify-center mb-4 text-pnp-textSecondary">
        <TicketIcon />
      </div>
      <p className="text-sm font-medium text-pnp-textPrimary mb-1">No ticket selected</p>
      <p className="text-xs text-pnp-textSecondary">Click a ticket from the list to view the conversation.</p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { open: 0, resolved: 1, closed: 2 };

function sortTickets(tickets: AdminSupportTicket[]): AdminSupportTicket[] {
  return [...tickets].sort((a, b) => {
    const pDiff = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    const sDiff = (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2);
    if (sDiff !== 0) return sDiff;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });
}

export default function SupportDashboard() {
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    status: "",
    priority: "",
    category: "",
    search: "",
  });

  const [selectedTicket, setSelectedTicket] = useState<AdminSupportTicket | null>(null);
  const [showDetailMobile, setShowDetailMobile] = useState(false);

  // ── Load stats ──

  const loadStats = useCallback(async () => {
    try {
      const res = await getAdminSupportStats();
      setStats(res.stats);
      setStatsError(null);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // ── Load tickets ──

  const buildParams = useCallback(
    (p: number): Record<string, string> => {
      const params: Record<string, string> = { page: String(p), limit: "25" };
      if (filters.status) params.status = filters.status;
      if (filters.priority) params.priority = filters.priority;
      if (filters.category) params.category = filters.category;
      if (filters.search) params.search = filters.search;
      return params;
    },
    [filters]
  );

  const loadTickets = useCallback(
    async (p: number, append: boolean) => {
      if (!append) setTicketsLoading(true);
      else setLoadingMore(true);
      try {
        const res = await getAdminSupportTickets(buildParams(p));
        const sorted = sortTickets(res.tickets);
        setTickets((prev) => (append ? [...prev, ...sorted] : sorted));
        setHasMore(res.hasMore ?? false);
        setTicketsError(null);
      } catch (err) {
        setTicketsError(err instanceof Error ? err.message : "Failed to load tickets");
      } finally {
        setTicketsLoading(false);
        setLoadingMore(false);
      }
    },
    [buildParams]
  );

  useEffect(() => {
    setPage(1);
    setSelectedTicket(null);
    loadTickets(1, false);
  }, [filters, loadTickets]);

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadTickets(nextPage, true);
  }, [page, loadTickets]);

  const handleTicketSelect = useCallback((ticket: AdminSupportTicket) => {
    setSelectedTicket(ticket);
    setShowDetailMobile(true);
  }, []);

  const handleTicketUpdate = useCallback((patch: Partial<AdminSupportTicket>) => {
    setSelectedTicket((prev) => {
      if (!prev) return prev;
      setTickets((tickets) =>
        tickets.map((t) =>
          t.userId === prev.userId ? { ...t, ...patch } : t
        )
      );
      return { ...prev, ...patch };
    });
  }, []);

  const handleBackMobile = useCallback(() => {
    setShowDetailMobile(false);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-pnp-background">
      {/* Page header */}
      <div className="px-4 pt-4 pb-3 border-b border-pnp-border flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-bold text-pnp-textPrimary">Support Dashboard</h1>
          <button
            onClick={() => { loadStats(); loadTickets(1, false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textSecondary text-xs hover:border-pnp-accent hover:text-pnp-accent transition-colors"
          >
            <RefreshIcon />
            Refresh
          </button>
        </div>
        <p className="text-xs text-pnp-textSecondary">Customer service management</p>
      </div>

      {/* Stats bar */}
      <div className="px-4 py-4 flex-shrink-0">
        {statsLoading ? (
          <StatsBarSkeleton />
        ) : statsError ? (
          <div className="rounded-xl bg-pnp-surface border border-pnp-border p-4 text-center">
            <p className="text-sm text-pnp-error">{statsError}</p>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Open Tickets"
              value={stats.openTickets}
              icon={<TicketIcon />}
              variant={stats.openTickets > 20 ? "danger" : stats.openTickets > 10 ? "warning" : "success"}
              subtitle={`${stats.awaitingFirstResponse} awaiting first response`}
            />
            <StatCard
              label="Avg Response Time"
              value={`${stats.avgResponseTimeHours.toFixed(1)}h`}
              icon={<ClockIcon />}
              variant={stats.avgResponseTimeHours > 24 ? "danger" : stats.avgResponseTimeHours > 8 ? "warning" : "success"}
            />
            <StatCard
              label="CSAT Score"
              value={`${stats.csatScore.toFixed(1)} / 5`}
              icon={<StarIcon />}
              variant={stats.csatScore < 3 ? "danger" : stats.csatScore < 4 ? "warning" : "success"}
              subtitle={`${stats.totalRatings} ratings`}
            />
            <StatCard
              label="SLA Breaches"
              value={stats.slaBreaches}
              icon={<AlertIcon />}
              variant={stats.slaBreaches > 0 ? "danger" : "success"}
            />
          </div>
        ) : null}
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Ticket list panel */}
        <div
          className={`
            flex flex-col border-r border-pnp-border
            w-full md:w-2/5 flex-shrink-0
            ${showDetailMobile ? "hidden md:flex" : "flex"}
          `}
        >
          <FilterBar filters={filters} onChange={setFilters} />

          <div className="flex-1 overflow-y-auto min-h-0">
            {ticketsLoading ? (
              <>
                <TicketCardSkeleton />
                <TicketCardSkeleton />
                <TicketCardSkeleton />
                <TicketCardSkeleton />
              </>
            ) : ticketsError ? (
              <div className="p-6 text-center">
                <p className="text-sm text-pnp-error mb-2">{ticketsError}</p>
                <button onClick={() => loadTickets(1, false)} className="text-xs text-pnp-accent hover:underline">
                  Retry
                </button>
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-pnp-textSecondary">No tickets found.</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Try adjusting your filters.</p>
              </div>
            ) : (
              <>
                {tickets.map((ticket) => (
                  <TicketCard
                    key={ticket.userId}
                    ticket={ticket}
                    selected={selectedTicket?.userId === ticket.userId}
                    onClick={() => handleTicketSelect(ticket)}
                  />
                ))}
                {hasMore && (
                  <div className="p-4 text-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="px-4 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textSecondary text-xs hover:border-pnp-accent hover:text-pnp-accent transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? "Loading..." : "Load more"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-4 py-2 border-t border-pnp-border">
            <span className="text-xs text-pnp-textSecondary">
              {tickets.length} ticket{tickets.length !== 1 ? "s" : ""} shown
            </span>
          </div>
        </div>

        {/* Detail panel */}
        <div
          className={`
            flex-1 flex flex-col min-h-0 min-w-0
            ${showDetailMobile ? "flex" : "hidden md:flex"}
          `}
        >
          {/* Mobile back button */}
          <div className="md:hidden px-4 py-2 border-b border-pnp-border flex-shrink-0">
            <button
              onClick={handleBackMobile}
              className="flex items-center gap-1.5 text-xs text-pnp-accent"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to tickets
            </button>
          </div>

          {selectedTicket ? (
            <TicketDetail
              key={selectedTicket.userId}
              ticket={selectedTicket}
              onUpdate={handleTicketUpdate}
            />
          ) : (
            <NoTicketSelected />
          )}
        </div>
      </div>
    </div>
  );
}
