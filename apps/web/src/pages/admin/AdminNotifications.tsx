import React, { useState } from "react";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { sendAdminNotification } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type TargetType = "all" | "tier" | "users";

type Channel = "push" | "bot" | "email";

interface NotifForm {
  title: string;
  body: string;
  url: string;
  targetType: TargetType;
  tier: string;
  userIdsRaw: string;
}

const EMPTY_FORM: NotifForm = {
  title: "",
  body: "",
  url: "",
  targetType: "all",
  tier: "member",
  userIdsRaw: "",
};

const ALL_CHANNELS: Channel[] = ["push", "bot", "email"];

const TITLE_MAX = 100;
const BODY_MAX = 500;

const BellIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
    />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
  </svg>
);

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface";

const CHANNEL_ICONS: Record<Channel, React.ReactNode> = {
  push: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  bot: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  ),
  email: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
};

export default function AdminNotifications() {
  const t = useI18n();
  const n = t.notifications;

  const [form, setForm] = useState<NotifForm>(EMPTY_FORM);
  const [channels, setChannels] = useState<Set<Channel>>(new Set(ALL_CHANNELS));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    sent?: number;
    botDmSent?: number;
    emailSent?: number;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = <K extends keyof NotifForm>(key: K, value: NotifForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
    setResult(null);
  };

  const toggleChannel = (ch: Channel) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) {
        next.delete(ch);
      } else {
        next.add(ch);
      }
      return next;
    });
    setFormError(null);
    setResult(null);
  };

  const validate = (): boolean => {
    if (!form.title.trim()) {
      setFormError(n.titleRequired);
      return false;
    }
    if (!form.body.trim()) {
      setFormError(n.bodyRequired);
      return false;
    }
    if (form.targetType === "users") {
      const ids = form.userIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        setFormError(n.atLeastOneUser);
        return false;
      }
    }
    if (channels.size === 0) {
      setFormError(n.atLeastOneChannel);
      return false;
    }
    return true;
  };

  const handleSend = async () => {
    setSending(true);
    setFormError(null);
    try {
      const userIds =
        form.targetType === "users"
          ? form.userIdsRaw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

      const res = await sendAdminNotification({
        title: form.title.trim(),
        body: form.body.trim(),
        url: form.url.trim() || undefined,
        targetType: form.targetType,
        tier: form.targetType === "tier" ? form.tier : undefined,
        userIds,
        channels: Array.from(channels),
      });

      setResult({
        success: res.success,
        message: res.message,
        sent: res.sent,
        botDmSent: res.botDmSent,
        emailSent: res.emailSent,
      });
      if (res.success) {
        setForm(EMPTY_FORM);
        setChannels(new Set(ALL_CHANNELS));
      }
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : n.failedMessage,
      });
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  const handlePreSend = () => {
    if (validate()) {
      setConfirmOpen(true);
    }
  };

  const targetLabel = (): string => {
    if (form.targetType === "all") return "all users";
    if (form.targetType === "tier") return `all ${form.tier} tier users`;
    const count = form.userIdsRaw.split(",").filter((s) => s.trim()).length;
    return `${count} specific user(s)`;
  };

  const channelSummary = (): string => {
    const labels: Record<Channel, string> = {
      push: n.channelPush,
      bot: n.channelBot,
      email: n.channelEmail,
    };
    return ALL_CHANNELS.filter((ch) => channels.has(ch))
      .map((ch) => labels[ch])
      .join(", ") || "—";
  };

  const confirmMessage = (): string => {
    const chLabels: Record<Channel, string> = {
      push: n.channelPush,
      bot: n.channelBot,
      email: n.channelEmail,
    };
    const chList = ALL_CHANNELS.filter((ch) => channels.has(ch))
      .map((ch) => chLabels[ch])
      .join(", ");
    return `You are about to send "${form.title}" to ${targetLabel()} via: ${chList}. Are you sure?`;
  };

  const resultSummary = (): string => {
    if (!result?.success) return "";
    const parts: string[] = [];
    if (channels.has("push") && result.sent !== undefined) {
      parts.push(`Push: ${result.sent}`);
    }
    if (channels.has("bot") && result.botDmSent !== undefined) {
      parts.push(`Bot DM: ${result.botDmSent}`);
    }
    if (channels.has("email") && result.emailSent !== undefined) {
      parts.push(`Email: ${result.emailSent}`);
    }
    return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
  };

  return (
    <div className="page-container space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">{n.adminTitle}</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">{n.adminSubtitle}</p>
      </div>

      {result && (
        <div
          role="alert"
          className={`px-4 py-3 rounded-lg border text-sm flex items-center justify-between gap-2 ${
            result.success
              ? "bg-green-500/10 border-green-500/20 text-green-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}
        >
          <span>
            {result.message}
            {result.success && resultSummary()}
          </span>
          <button
            onClick={() => setResult(null)}
            className={`ml-2 hover:opacity-70 transition-opacity min-w-[44px] min-h-[44px] flex items-center justify-center rounded ${focusRing}`}
          >
            {n.dismiss}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compose Form */}
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            {n.compose}
          </h2>

          {formError && (
            <div
              role="alert"
              className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400"
            >
              {formError}
            </div>
          )}

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="notif-title"
                className="block text-xs text-pnp-textSecondary"
              >
                {n.labelTitle} *
              </label>
              <span className="text-xs text-pnp-textSecondary">
                {form.title.length}/{TITLE_MAX}
              </span>
            </div>
            <input
              id="notif-title"
              type="text"
              value={form.title}
              onChange={(e) => handleChange("title", e.target.value)}
              maxLength={TITLE_MAX}
              placeholder={n.titlePlaceholder}
              className={`w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent ${focusRing}`}
            />
          </div>

          {/* Body */}
          <div>
            <label
              htmlFor="notif-body"
              className="block text-xs text-pnp-textSecondary mb-1"
            >
              {n.labelBody} *
            </label>
            <textarea
              id="notif-body"
              value={form.body}
              onChange={(e) => handleChange("body", e.target.value)}
              rows={3}
              maxLength={BODY_MAX}
              placeholder={n.bodyPlaceholder}
              className={`w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent resize-none ${focusRing}`}
            />
            <p className="text-xs text-pnp-textSecondary mt-1 text-right">
              {form.body.length}/{BODY_MAX}
            </p>
          </div>

          {/* URL */}
          <div>
            <label
              htmlFor="notif-url"
              className="block text-xs text-pnp-textSecondary mb-1"
            >
              {n.labelUrl}
            </label>
            <input
              id="notif-url"
              type="url"
              value={form.url}
              onChange={(e) => handleChange("url", e.target.value)}
              placeholder={n.urlPlaceholder}
              className={`w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent ${focusRing}`}
            />
          </div>

          {/* Target */}
          <div>
            <label
              htmlFor="notif-type"
              className="block text-xs text-pnp-textSecondary mb-1"
            >
              {n.labelTarget} *
            </label>
            <select
              id="notif-type"
              value={form.targetType}
              onChange={(e) => handleChange("targetType", e.target.value as TargetType)}
              className={`w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent ${focusRing}`}
            >
              <option value="all">{n.targetAll}</option>
              <option value="tier">{n.targetTier}</option>
              <option value="users">{n.targetUsers}</option>
            </select>
          </div>

          {/* Tier selector */}
          {form.targetType === "tier" && (
            <div>
              <label
                htmlFor="notif-tier"
                className="block text-xs text-pnp-textSecondary mb-1"
              >
                {n.labelTier}
              </label>
              <select
                id="notif-tier"
                value={form.tier}
                onChange={(e) => handleChange("tier", e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent ${focusRing}`}
              >
                <option value="free">free</option>
                <option value="member">member</option>
                <option value="PRIME">PRIME</option>
              </select>
            </div>
          )}

          {/* User IDs */}
          {form.targetType === "users" && (
            <div>
              <label
                htmlFor="notif-user-ids"
                className="block text-xs text-pnp-textSecondary mb-1"
              >
                {n.labelUserIds}
              </label>
              <textarea
                id="notif-user-ids"
                value={form.userIdsRaw}
                onChange={(e) => handleChange("userIdsRaw", e.target.value)}
                rows={3}
                placeholder={n.userIdsPlaceholder}
                className={`w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent resize-none font-mono ${focusRing}`}
              />
              {form.userIdsRaw.trim() && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.userIdsRaw
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pnp-accent/15 text-pnp-accent text-xs font-mono"
                      >
                        {id}
                        <button
                          type="button"
                          aria-label={`${n.removeUser} ${id}`}
                          onClick={() => {
                            const ids = form.userIdsRaw
                              .split(",")
                              .map((s) => s.trim())
                              .filter((s) => s && s !== id);
                            handleChange("userIdsRaw", ids.join(", "));
                          }}
                          className={`hover:text-red-400 transition-colors rounded ${focusRing}`}
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </span>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Channel Selection */}
          <div>
            <p className="block text-xs text-pnp-textSecondary mb-2">{n.channelsLabel}</p>
            <div className="flex flex-col gap-2">
              {ALL_CHANNELS.map((ch) => {
                const checked = channels.has(ch);
                const labels: Record<Channel, string> = {
                  push: n.channelPush,
                  bot: n.channelBot,
                  email: n.channelEmail,
                };
                return (
                  <label
                    key={ch}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors select-none ${
                      checked
                        ? "border-pnp-accent/40 bg-pnp-accent/8"
                        : "border-pnp-border bg-pnp-background hover:border-pnp-accent/30"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                        checked
                          ? "bg-pnp-accent border-pnp-accent text-white"
                          : "border-pnp-border bg-pnp-surface text-transparent"
                      }`}
                    >
                      <CheckIcon />
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleChannel(ch)}
                    />
                    <span className="flex items-center gap-2 text-sm text-pnp-textPrimary">
                      <span className={checked ? "text-pnp-accent" : "text-pnp-textSecondary"}>
                        {CHANNEL_ICONS[ch]}
                      </span>
                      {labels[ch]}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handlePreSend}
              disabled={!form.title.trim() || !form.body.trim() || channels.size === 0}
              className={`px-5 py-2.5 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-2 active:scale-[0.98] ${focusRing}`}
            >
              <BellIcon />
              {sending ? n.sending : n.sendNotification}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            {n.preview}
          </h2>
          <div className="rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden">
            {/* Mock notification bar */}
            <div className="bg-pnp-background/60 px-4 py-2 border-b border-pnp-border">
              <span className="text-xs text-pnp-textSecondary">{n.previewLabel}</span>
            </div>
            <div className="p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-pnp-accent/20">
                <BellIcon />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-pnp-textPrimary">
                  {form.title || n.labelTitle}
                </p>
                <p className="text-sm text-pnp-textSecondary mt-0.5 line-clamp-3">
                  {form.body || n.bodyPlaceholder}
                </p>
                {form.url && (
                  <p className="text-xs text-pnp-accent mt-1 truncate">{form.url}</p>
                )}
              </div>
            </div>
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span>
                  {n.sendingTo}{" "}
                  <span className="font-medium text-pnp-textPrimary">{targetLabel()}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-pnp-border bg-pnp-surface p-4">
            <h3 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
              {n.summary}
            </h3>
            <dl className="space-y-2">
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">{n.notifTarget}</dt>
                <dd className="text-pnp-textPrimary font-medium capitalize">
                  {form.targetType === "tier" ? `${form.tier} tier` : form.targetType}
                </dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">{n.channelsLabel}</dt>
                <dd className="text-pnp-textPrimary text-right max-w-[55%]">{channelSummary()}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">{n.notifTitleLength}</dt>
                <dd className="text-pnp-textPrimary">{form.title.length} chars</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">{n.notifBodyLength}</dt>
                <dd className="text-pnp-textPrimary">{form.body.length} chars</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">{n.notifUrl}</dt>
                <dd className="text-pnp-textPrimary">{form.url ? "Yes" : "None"}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={n.confirmSendTitle}
        message={confirmMessage()}
        confirmLabel={n.sendNow}
        variant="default"
        onConfirm={handleSend}
        onCancel={() => setConfirmOpen(false)}
        loading={sending}
      />
    </div>
  );
}
