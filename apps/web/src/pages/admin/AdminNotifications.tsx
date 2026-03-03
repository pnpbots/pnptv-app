import React, { useState } from "react";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { sendAdminNotification } from "@/lib/api";

type TargetType = "all" | "tier" | "users";

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

const BellIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

export default function AdminNotifications() {
  const [form, setForm] = useState<NotifForm>(EMPTY_FORM);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; sent?: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = <K extends keyof NotifForm>(key: K, value: NotifForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
    setResult(null);
  };

  const validate = (): boolean => {
    if (!form.title.trim()) {
      setFormError("Title is required");
      return false;
    }
    if (!form.body.trim()) {
      setFormError("Body is required");
      return false;
    }
    if (form.targetType === "users") {
      const ids = form.userIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        setFormError("Enter at least one user ID");
        return false;
      }
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
      });

      setResult({ success: res.success, message: res.message, sent: res.sent });
      if (res.success) {
        setForm(EMPTY_FORM);
      }
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to send notification",
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

  return (
    <div className="page-container space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">Push Notifications</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">
          Compose and send push notifications to users
        </p>
      </div>

      {result && (
        <div className={`px-4 py-3 rounded-lg border text-sm flex items-center justify-between ${
          result.success
            ? "bg-green-500/10 border-green-500/20 text-green-400"
            : "bg-red-500/10 border-red-500/20 text-red-400"
        }`}>
          <span>
            {result.message}
            {result.sent !== undefined && ` (${result.sent} sent)`}
          </span>
          <button onClick={() => setResult(null)} className="ml-2 hover:opacity-70">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compose Form */}
        <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            Compose
          </h2>

          {formError && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => handleChange("title", e.target.value)}
              maxLength={100}
              placeholder="Notification title"
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Body *</label>
            <textarea
              value={form.body}
              onChange={(e) => handleChange("body", e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Notification message body..."
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent resize-none"
            />
            <p className="text-xs text-pnp-textSecondary mt-1 text-right">{form.body.length}/500</p>
          </div>

          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">URL (optional)</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => handleChange("url", e.target.value)}
              placeholder="https://app.pnptv.app/..."
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Target Audience *</label>
            <select
              value={form.targetType}
              onChange={(e) => handleChange("targetType", e.target.value as TargetType)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            >
              <option value="all">All Users</option>
              <option value="tier">Specific Tier</option>
              <option value="users">Specific Users</option>
            </select>
          </div>

          {form.targetType === "tier" && (
            <div>
              <label className="block text-xs text-pnp-textSecondary mb-1">Tier</label>
              <select
                value={form.tier}
                onChange={(e) => handleChange("tier", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
              >
                <option value="member">member</option>
                <option value="prime">prime</option>
                <option value="creator">creator</option>
              </select>
            </div>
          )}

          {form.targetType === "users" && (
            <div>
              <label className="block text-xs text-pnp-textSecondary mb-1">
                User IDs (comma-separated)
              </label>
              <textarea
                value={form.userIdsRaw}
                onChange={(e) => handleChange("userIdsRaw", e.target.value)}
                rows={3}
                placeholder="123, 456, 789"
                className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent resize-none font-mono"
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
                          onClick={() => {
                            const ids = form.userIdsRaw
                              .split(",")
                              .map((s) => s.trim())
                              .filter((s) => s && s !== id);
                            handleChange("userIdsRaw", ids.join(", "));
                          }}
                          className="hover:text-red-400 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={handlePreSend}
              disabled={!form.title.trim() || !form.body.trim()}
              className="px-5 py-2.5 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <BellIcon />
              Send Notification
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            Preview
          </h2>
          <div className="rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden">
            {/* Mock notification bar */}
            <div className="bg-pnp-background/60 px-4 py-2 border-b border-pnp-border">
              <span className="text-xs text-pnp-textSecondary">Push Notification Preview</span>
            </div>
            <div className="p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-pnp-accent/20">
                <BellIcon />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-pnp-textPrimary">
                  {form.title || "Notification Title"}
                </p>
                <p className="text-sm text-pnp-textSecondary mt-0.5 line-clamp-3">
                  {form.body || "Your notification message will appear here."}
                </p>
                {form.url && (
                  <p className="text-xs text-pnp-accent mt-1 truncate">{form.url}</p>
                )}
              </div>
            </div>
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>
                  Sending to:{" "}
                  <span className="font-medium text-pnp-textPrimary">{targetLabel()}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-pnp-border bg-pnp-surface p-4">
            <h3 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
              Summary
            </h3>
            <dl className="space-y-2">
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">Target</dt>
                <dd className="text-pnp-textPrimary font-medium capitalize">
                  {form.targetType === "tier" ? `${form.tier} tier` : form.targetType}
                </dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">Title length</dt>
                <dd className="text-pnp-textPrimary">{form.title.length} chars</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">Body length</dt>
                <dd className="text-pnp-textPrimary">{form.body.length} chars</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-pnp-textSecondary">URL</dt>
                <dd className="text-pnp-textPrimary">{form.url ? "Yes" : "None"}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Send Push Notification"
        message={`You are about to send "${form.title}" to ${targetLabel()}. This will trigger an immediate push notification. Are you sure?`}
        confirmLabel="Send Now"
        variant="default"
        onConfirm={handleSend}
        onCancel={() => setConfirmOpen(false)}
        loading={sending}
      />
    </div>
  );
}
