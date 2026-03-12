import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminUser,
  getAdminPlans,
  updateAdminUser,
  banAdminUser,
  getAdminUserEntitlements,
  grantAdminUserEntitlement,
  revokeAdminUserEntitlement,
  extendAdminUserEntitlement,
  getAddOns,
  getUserLabel,
  getLabelColor,
  getAdminLiveChannels,
  makeAdminUserCreator,
  revokeAdminUserCreator,
  type AdminUser,
  type AdminPlan,
  type AdminEntitlement,
  type EntitlementAuditEntry,
  type AddOn,
  type AdminChannel,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Badge variant maps
// ---------------------------------------------------------------------------

const TIER_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  PRIME: "accent",
  prime: "accent",
  member: "success",
  creator: "warning",
  free: "default",
  banned: "error",
};

const STATUS_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  active: "success",
  expired: "warning",
  cancelled: "error",
  free: "default",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avatarLetter(user: AdminUser): string {
  const name = user.first_name || user.username || user.email || "?";
  return name[0].toUpperCase();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// ---------------------------------------------------------------------------
// Inline SVGs (no external icon library)
// ---------------------------------------------------------------------------

function IconChevronLeft() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function IconChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Entitlement status pill
// ---------------------------------------------------------------------------

interface EntitlementStatusPillProps {
  entitlement: AdminEntitlement;
}

function EntitlementStatusPill({ entitlement }: EntitlementStatusPillProps) {
  if (entitlement.is_consumed) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-pnp-surface text-pnp-textSecondary border border-pnp-border">
        Consumed
      </span>
    );
  }
  if (entitlement.is_lifetime) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/20">
        Lifetime
      </span>
    );
  }
  if (entitlement.expires_at && isExpired(entitlement.expires_at)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/20">
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">
      Active
      {entitlement.expires_at && (
        <span className="opacity-80">· {formatDate(entitlement.expires_at)}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Extend inline form (shown inline below a row)
// ---------------------------------------------------------------------------

interface ExtendFormProps {
  addOnId: string;
  addOnName: string;
  userId: string;
  onDone: () => void;
  onCancel: () => void;
}

function ExtendForm({ addOnId, addOnName, userId, onDone, onCancel }: ExtendFormProps) {
  const [days, setDays] = useState<string>("30");
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const extraDays = parseInt(days, 10);
    if (isNaN(extraDays) || extraDays < 1) {
      setErr("Enter a valid number of days (minimum 1).");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await extendAdminUserEntitlement(userId, addOnId, { extraDays, reason: reason || undefined });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to extend entitlement.");
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg bg-pnp-background border border-pnp-border space-y-3">
      <p className="text-xs text-pnp-textSecondary">
        Extend <span className="text-pnp-textPrimary font-medium">{addOnName}</span> by:
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor={`extend-days-${addOnId}`}>
            Days to add
          </label>
          <input
            ref={inputRef}
            id={`extend-days-${addOnId}`}
            type="number"
            min={1}
            value={days}
            onChange={(e) => { setDays(e.target.value); setErr(null); }}
            className="w-24 px-3 py-2 rounded-lg border border-pnp-border bg-pnp-surface text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor={`extend-reason-${addOnId}`}>
            Reason (optional)
          </label>
          <input
            id={`extend-reason-${addOnId}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer request"
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-surface text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          />
        </div>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm text-pnp-textSecondary border border-pnp-border hover:bg-pnp-surfaceHover disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accentHover disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {loading && <IconSpinner />}
          Extend
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grant entitlement form
// ---------------------------------------------------------------------------

interface GrantFormProps {
  userId: string;
  availableAddOns: AddOn[];
  onGranted: () => void;
}

function GrantEntitlementForm({ userId, availableAddOns, onGranted }: GrantFormProps) {
  const [selectedAddOnId, setSelectedAddOnId] = useState<string>("");
  const [isLifetime, setIsLifetime] = useState(false);
  const [durationDays, setDurationDays] = useState<string>("30");
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleGrant = async () => {
    if (!selectedAddOnId) {
      setErr("Please select an add-on.");
      return;
    }
    const days = isLifetime ? undefined : parseInt(durationDays, 10);
    if (!isLifetime && (!days || isNaN(days) || days < 1)) {
      setErr("Enter a valid duration in days (minimum 1).");
      return;
    }
    setLoading(true);
    setErr(null);
    setSuccessMsg(null);
    try {
      await grantAdminUserEntitlement(userId, {
        addOnId: selectedAddOnId,
        durationDays: isLifetime ? undefined : days,
        isLifetime,
        reason: reason || undefined,
      });
      const addOnName = availableAddOns.find((a) => a.id === selectedAddOnId)?.name ?? selectedAddOnId;
      setSuccessMsg(`"${addOnName}" granted successfully.`);
      setSelectedAddOnId("");
      setIsLifetime(false);
      setDurationDays("30");
      setReason("");
      onGranted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to grant entitlement.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
      <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
        Grant Entitlement
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="grant-addon">
            Add-on
          </label>
          <select
            id="grant-addon"
            value={selectedAddOnId}
            onChange={(e) => { setSelectedAddOnId(e.target.value); setErr(null); setSuccessMsg(null); }}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          >
            <option value="">— Select add-on —</option>
            {availableAddOns.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="grant-reason">
            Reason (optional)
          </label>
          <input
            id="grant-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. promo, manual fix"
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer select-none min-h-[44px]">
          <input
            type="checkbox"
            checked={isLifetime}
            onChange={(e) => { setIsLifetime(e.target.checked); setErr(null); }}
            className="w-4 h-4 accent-pnp-accent"
          />
          <span className="text-sm text-pnp-textPrimary">Lifetime access</span>
        </label>

        {!isLifetime && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-pnp-textSecondary" htmlFor="grant-days">
              Duration (days)
            </label>
            <input
              id="grant-days"
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => { setDurationDays(e.target.value); setErr(null); }}
              className="w-24 px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
        )}
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
      {successMsg && <p className="text-xs text-green-400">{successMsg}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleGrant}
          disabled={loading}
          className="px-5 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accentHover disabled:opacity-50 transition-colors flex items-center gap-2 min-h-[44px]"
        >
          {loading && <IconSpinner />}
          Grant Entitlement
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log entry
// ---------------------------------------------------------------------------

interface AuditEntryProps {
  entry: EntitlementAuditEntry;
}

function AuditLogEntry({ entry }: AuditEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.details !== null && entry.details !== undefined;
  let detailsStr = "";
  if (hasDetails) {
    try {
      detailsStr = JSON.stringify(entry.details, null, 2);
    } catch {
      detailsStr = String(entry.details);
    }
  }

  return (
    <div className="py-3 border-b border-pnp-border last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-sm text-pnp-textPrimary font-medium break-words">{entry.action}</span>
          <p className="text-xs text-pnp-textSecondary mt-0.5">{formatDateTime(entry.created_at)}</p>
        </div>
        {hasDetails && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex-shrink-0 text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors flex items-center gap-1 min-h-[44px] px-1"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            <IconChevronDown open={expanded} />
            <span className="sr-only">{expanded ? "Collapse" : "Expand"}</span>
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <pre className="mt-2 p-3 rounded-lg bg-pnp-background border border-pnp-border text-xs text-pnp-textSecondary overflow-x-auto whitespace-pre-wrap break-words">
          {detailsStr}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Entitlements section
// ---------------------------------------------------------------------------

interface EntitlementsSectionProps {
  userId: string;
}

function EntitlementsSection({ userId }: EntitlementsSectionProps) {
  const [entitlements, setEntitlements] = useState<AdminEntitlement[]>([]);
  const [auditLog, setAuditLog] = useState<EntitlementAuditEntry[]>([]);
  const [availableAddOns, setAvailableAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  // Per-row extend form tracking
  const [extendingAddOnId, setExtendingAddOnId] = useState<string | null>(null);

  // Revoke confirmation
  const [revokeTarget, setRevokeTarget] = useState<AdminEntitlement | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entRes, addOnsRes] = await Promise.all([
        getAdminUserEntitlements(userId),
        getAddOns(),
      ]);
      setEntitlements(entRes.entitlements);
      setAuditLog(entRes.auditLog);
      setAvailableAddOns(addOnsRes.addOns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entitlements.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevokeLoading(true);
    try {
      await revokeAdminUserEntitlement(userId, revokeTarget.add_on_id);
      setRevokeTarget(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke entitlement.");
      setRevokeTarget(null);
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleExtendDone = async () => {
    setExtendingAddOnId(null);
    await loadData();
  };

  const handleGranted = () => {
    loadData();
  };

  // --- Loading skeleton ---
  if (loading) {
    return (
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
        <div className="h-4 w-32 bg-pnp-border rounded animate-pulse" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 bg-pnp-background rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5">
        <div className="flex items-start gap-3 text-red-400">
          <IconAlert />
          <div className="flex-1 min-w-0">
            <p className="text-sm">{error}</p>
            <button
              onClick={loadData}
              className="mt-2 flex items-center gap-1.5 text-xs hover:underline"
            >
              <IconRefresh />
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Entitlements table card */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border overflow-hidden">
        <div className="px-5 py-4 border-b border-pnp-border flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            Entitlements
          </h2>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors min-h-[44px] px-1"
            aria-label="Refresh entitlements"
          >
            <IconRefresh />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {entitlements.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-pnp-textSecondary">No entitlements found for this user.</p>
            <p className="text-xs text-pnp-textSecondary mt-1 opacity-70">Use the form below to grant one.</p>
          </div>
        ) : (
          <div className="divide-y divide-pnp-border">
            {entitlements.map((ent) => (
              <div key={ent.id} className="px-5 py-4">
                {/* Row top: name + status + actions */}
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-pnp-textPrimary break-words">
                      {ent.add_on_name}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <EntitlementStatusPill entitlement={ent} />
                      {ent.granted_by_plan && (
                        <span className="text-xs text-pnp-textSecondary">
                          Plan: <span className="text-pnp-textPrimary">{ent.granted_by_plan}</span>
                        </span>
                      )}
                      {ent.source && (
                        <span className="text-xs text-pnp-textSecondary">
                          via <span className="text-pnp-textPrimary">{ent.source}</span>
                        </span>
                      )}
                      <span className="text-xs text-pnp-textSecondary">
                        Granted {formatDate(ent.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!ent.is_consumed && !ent.is_lifetime && (
                      <button
                        onClick={() =>
                          setExtendingAddOnId(
                            extendingAddOnId === ent.add_on_id ? null : ent.add_on_id
                          )
                        }
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surfaceHover transition-colors min-h-[44px]"
                        aria-pressed={extendingAddOnId === ent.add_on_id}
                        aria-label={`Extend ${ent.add_on_name}`}
                      >
                        Extend
                      </button>
                    )}
                    <button
                      onClick={() => setRevokeTarget(ent)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors min-h-[44px]"
                      aria-label={`Revoke ${ent.add_on_name}`}
                    >
                      Revoke
                    </button>
                  </div>
                </div>

                {/* Inline extend form */}
                {extendingAddOnId === ent.add_on_id && (
                  <ExtendForm
                    addOnId={ent.add_on_id}
                    addOnName={ent.add_on_name}
                    userId={userId}
                    onDone={handleExtendDone}
                    onCancel={() => setExtendingAddOnId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grant form */}
      <GrantEntitlementForm
        userId={userId}
        availableAddOns={availableAddOns}
        onGranted={handleGranted}
      />

      {/* Audit log collapsible */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border overflow-hidden">
        <button
          onClick={() => setAuditOpen((v) => !v)}
          className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-pnp-surfaceHover transition-colors min-h-[44px]"
          aria-expanded={auditOpen}
          aria-controls="entitlement-audit-log"
        >
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider text-left">
            Entitlement Audit Log
            {auditLog.length > 0 && (
              <span className="ml-2 text-xs font-normal text-pnp-textSecondary normal-case tracking-normal">
                ({auditLog.length} {auditLog.length === 1 ? "entry" : "entries"})
              </span>
            )}
          </h2>
          <span className="text-pnp-textSecondary flex-shrink-0">
            <IconChevronDown open={auditOpen} />
          </span>
        </button>

        {auditOpen && (
          <div id="entitlement-audit-log" className="px-5 border-t border-pnp-border">
            {auditLog.length === 0 ? (
              <p className="py-8 text-center text-sm text-pnp-textSecondary">
                No audit log entries yet.
              </p>
            ) : (
              <div>
                {auditLog.map((entry) => (
                  <AuditLogEntry key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Revoke confirmation modal */}
      <ConfirmModal
        open={revokeTarget !== null}
        title="Revoke Entitlement"
        message={
          revokeTarget
            ? `Are you sure you want to revoke "${revokeTarget.add_on_name}" from this user? This cannot be undone.`
            : ""
        }
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
        loading={revokeLoading}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Creator / Live Performer section
// ---------------------------------------------------------------------------

const CREATOR_TYPES = ["performer", "streamer", "creator", "dj", "host"] as const;

interface CreatorSectionProps {
  user: AdminUser;
  onUpdated: (patch: Partial<AdminUser>) => void;
}

function CreatorSection({ user, onUpdated }: CreatorSectionProps) {
  const isCreator = user.role === "model" || user.role === "creator";

  const [formOpen, setFormOpen] = useState(false);
  const [channelRef, setChannelRef] = useState("");
  const [creatorType, setCreatorType] = useState("");
  const [priceUsd, setPriceUsd] = useState("15.00");
  const [grantMonetization, setGrantMonetization] = useState(true);

  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const loadChannels = async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await getAdminLiveChannels();
      setChannels(res.channels);
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setChannelsLoading(false);
    }
  };

  const openGrantForm = () => {
    setFormOpen(true);
    setSubmitError(null);
    setSuccessMsg(null);
    setChannelRef(user.live_channel || "");
    setCreatorType(user.creator_type || "");
    setPriceUsd(user.creator_price_usd != null ? String(user.creator_price_usd) : "15.00");
    setGrantMonetization(true);
    loadChannels();
  };

  const handleGrant = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setSuccessMsg(null);
    try {
      const payload: { channelRef?: string; creatorType?: string; priceUsd?: number; grantMonetization?: boolean } = {
        grantMonetization,
      };
      if (channelRef) payload.channelRef = channelRef;
      if (creatorType) payload.creatorType = creatorType;
      const price = parseFloat(priceUsd);
      if (!isNaN(price)) payload.priceUsd = price;

      const res = await makeAdminUserCreator(user.id, payload);
      onUpdated(res.user);
      setSuccessMsg("Creator access granted successfully.");
      setFormOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to grant creator access");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    setRevokeLoading(true);
    setRevokeError(null);
    try {
      const res = await revokeAdminUserCreator(user.id);
      onUpdated(res.user);
      setRevokeConfirm(false);
      setSuccessMsg("Creator access revoked.");
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Failed to revoke creator access");
      setRevokeConfirm(false);
    } finally {
      setRevokeLoading(false);
    }
  };

  // Channels available to assign: unassigned OR already assigned to this user
  const availableChannels = channels.filter(
    (ch) => ch.assignedUser === null || ch.assignedUser.id === user.id
  );

  return (
    <div className="rounded-xl bg-purple-500/5 border border-purple-500/20 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider">
        Creator &amp; Live Performer
      </h2>

      {successMsg && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
          {successMsg}
        </div>
      )}
      {revokeError && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {revokeError}
        </div>
      )}

      {/* Current status summary */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-xs text-pnp-textSecondary">Role:</span>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
            isCreator
              ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
              : "bg-pnp-surface text-pnp-textSecondary border-pnp-border"
          }`}
        >
          {user.role}
        </span>

        {user.creator_status && user.creator_status !== "none" && (
          <>
            <span className="text-xs text-pnp-textSecondary">Status:</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                user.creator_status === "active"
                  ? "bg-green-500/15 text-green-400 border-green-500/20"
                  : "bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
              }`}
            >
              {user.creator_status}
            </span>
          </>
        )}

        {user.creator_type && (
          <>
            <span className="text-xs text-pnp-textSecondary">Type:</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
              {user.creator_type}
            </span>
          </>
        )}

        {user.live_channel && (
          <>
            <span className="text-xs text-pnp-textSecondary">Channel:</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono bg-pnp-surface text-pnp-textPrimary border border-pnp-border">
              {user.live_channel}
            </span>
          </>
        )}

        {user.creator_price_usd != null && (
          <>
            <span className="text-xs text-pnp-textSecondary">Price:</span>
            <span className="text-xs text-pnp-textPrimary font-medium">
              ${Number(user.creator_price_usd).toFixed(2)}/mo
            </span>
          </>
        )}
      </div>

      {/* Action buttons */}
      {!isCreator && !formOpen && (
        <div className="flex justify-end">
          <button
            onClick={openGrantForm}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30 hover:bg-purple-500/25 transition-colors min-h-[44px]"
          >
            Grant Creator Access
          </button>
        </div>
      )}

      {isCreator && !revokeConfirm && (
        <div className="flex justify-end gap-3">
          {!formOpen && (
            <button
              onClick={openGrantForm}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors min-h-[44px]"
            >
              Edit Creator Settings
            </button>
          )}
          <button
            onClick={() => {
              setRevokeConfirm(true);
              setSuccessMsg(null);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors min-h-[44px]"
          >
            Revoke Creator Access
          </button>
        </div>
      )}

      {/* Revoke confirm inline */}
      {revokeConfirm && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 space-y-3">
          <p className="text-sm text-red-400">
            This will reset <strong>@{user.username || user.id}</strong> to a plain user, remove their channel assignment, and revoke the creator-subscription entitlement. Continue?
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setRevokeConfirm(false)}
              disabled={revokeLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surfaceHover transition-colors min-h-[44px] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRevoke}
              disabled={revokeLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors min-h-[44px] disabled:opacity-50"
            >
              {revokeLoading ? "Revoking..." : "Yes, Revoke"}
            </button>
          </div>
        </div>
      )}

      {/* Grant / Edit form */}
      {formOpen && (
        <div className="rounded-lg bg-pnp-surface border border-purple-500/20 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-pnp-textPrimary">
            {isCreator ? "Edit Creator Settings" : "Grant Creator Access"}
          </h3>

          {submitError && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {submitError}
            </div>
          )}

          {/* Channel selector */}
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="creator-channel">
              Live Channel (optional)
            </label>
            {channelsLoading ? (
              <div className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                <IconSpinner /> Loading channels...
              </div>
            ) : channelsError ? (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <IconAlert /> {channelsError}
                <button onClick={loadChannels} className="underline hover:no-underline ml-1">
                  Retry
                </button>
              </div>
            ) : (
              <select
                id="creator-channel"
                value={channelRef}
                onChange={(e) => setChannelRef(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-purple-500/50"
              >
                <option value="">— No channel —</option>
                {availableChannels.map((ch) => (
                  <option key={ch.id} value={ch.reference}>
                    {ch.reference}{ch.rtmpName ? ` (key: ${ch.rtmpName})` : ""}{ch.isLive ? " 🔴" : ""}
                    {ch.assignedUser?.id === user.id ? " ✓ current" : ""}
                  </option>
                ))}
                {channels.length > 0 && availableChannels.length === 0 && (
                  <option disabled value="">
                    All channels are assigned to other users
                  </option>
                )}
              </select>
            )}
          </div>

          {/* Creator type */}
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="creator-type">
              Creator Type (optional)
            </label>
            <select
              id="creator-type"
              value={creatorType}
              onChange={(e) => setCreatorType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-purple-500/50"
            >
              <option value="">— Select type —</option>
              {CREATOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Subscription price */}
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="creator-price">
              Subscription Price (USD / month)
            </label>
            <input
              id="creator-price"
              type="number"
              min="0"
              step="0.50"
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-purple-500/50"
            />
          </div>

          {/* Grant monetization entitlement */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={grantMonetization}
              onChange={(e) => setGrantMonetization(e.target.checked)}
              className="w-4 h-4 accent-purple-500"
            />
            <span className="text-sm text-pnp-textPrimary">
              Grant <span className="font-mono text-xs bg-purple-500/10 text-purple-300 px-1.5 py-0.5 rounded">creator-subscription</span> lifetime entitlement
            </span>
          </label>

          <div className="flex gap-3 justify-end pt-1">
            <button
              onClick={() => {
                setFormOpen(false);
                setSubmitError(null);
              }}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surfaceHover transition-colors min-h-[44px] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleGrant}
              disabled={submitting}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors min-h-[44px] disabled:opacity-50"
            >
              {submitting ? "Saving..." : isCreator ? "Save Changes" : "Grant Access"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit form type
// ---------------------------------------------------------------------------

interface EditForm {
  username: string;
  email: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  planExpiry: string;
  tier: string;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function UserDetail() {
  const { id: userId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<AdminUser | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [editForm, setEditForm] = useState<EditForm>({
    username: "",
    email: "",
    subscriptionStatus: "free",
    subscriptionPlan: "",
    planExpiry: "",
    tier: "free",
  });

  const [banReason, setBanReason] = useState("");
  const [banConfirmOpen, setBanConfirmOpen] = useState(false);
  const [banAction, setBanAction] = useState<"ban" | "unban">("ban");
  const [banLoading, setBanLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [userRes, plansRes] = await Promise.all([
        getAdminUser(userId),
        getAdminPlans(),
      ]);
      setUser(userRes.user);
      setPlans(plansRes.plans);
      setEditForm({
        username: userRes.user.username || "",
        email: userRes.user.email || "",
        subscriptionStatus: userRes.user.subscription_status || "free",
        subscriptionPlan: userRes.user.subscription_plan || "",
        planExpiry: (() => {
          if (!userRes.user.plan_expiry) return "";
          const d = new Date(userRes.user.plan_expiry);
          return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
        })(),
        tier: userRes.user.tier || "free",
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFormChange = (field: keyof EditForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaveLoading(true);
    setSaveSuccess(false);
    try {
      const res = await updateAdminUser(userId, {
        username: editForm.username || undefined,
        email: editForm.email || undefined,
        subscriptionStatus: editForm.subscriptionStatus || undefined,
        subscriptionPlan: editForm.subscriptionPlan || undefined,
        tier: editForm.tier || undefined,
        planExpiry: editForm.planExpiry || undefined,
      });
      setUser((prev) => (prev ? { ...prev, ...res.user } : res.user));
      setSaveSuccess(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaveLoading(false);
    }
  };

  const openBanModal = (action: "ban" | "unban") => {
    setBanAction(action);
    setBanReason("");
    setBanConfirmOpen(true);
  };

  const executeBan = async () => {
    if (!userId || !user) return;
    setBanLoading(true);
    try {
      const res = await banAdminUser(userId, banAction === "ban", banReason || undefined);
      setUser((prev) => (prev ? { ...prev, ...res.user } : res.user));
      setBanConfirmOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ban action failed");
      setBanConfirmOpen(false);
    } finally {
      setBanLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-48 bg-pnp-border rounded" />
          <div className="h-24 bg-pnp-surface rounded-xl" />
          <div className="h-64 bg-pnp-surface rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-container text-center py-16">
        <p className="text-pnp-textSecondary">{error || "User not found"}</p>
        <Link to="/admin/users" className="mt-4 inline-block text-sm text-pnp-accent hover:underline">
          Back to Users
        </Link>
      </div>
    );
  }

  const isBanned = user.tier === "banned";

  return (
    <div className="page-container space-y-6">
      {/* Back link */}
      <Link
        to="/admin/users"
        className="flex items-center gap-1.5 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors w-fit"
      >
        <IconChevronLeft />
        Back to Users
      </Link>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-300">
            Dismiss
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
          Changes saved successfully.
        </div>
      )}

      {/* User header */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 flex items-start gap-4">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          {avatarLetter(user)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-pnp-textPrimary">
              {user.first_name
                ? `${user.first_name}${user.last_name ? " " + user.last_name : ""}`
                : user.username || "Unknown"}
            </h1>
            {user.tier && (() => {
              const lbl = getUserLabel(user);
              const legacyTier = user.tier.toLowerCase();
              const showLegacy = lbl !== 'FREE' && legacyTier !== lbl.toLowerCase() && legacyTier !== 'banned';
              return (
                <>
                  <span
                    className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full border ${getLabelColor(lbl)}`}
                  >
                    {lbl}
                  </span>
                  {showLegacy && (
                    <span className="text-xs text-pnp-textSecondary">
                      (legacy: {user.tier})
                    </span>
                  )}
                  {legacyTier === 'banned' && (
                    <Badge variant="error">banned</Badge>
                  )}
                </>
              );
            })()}
            {user.subscription_status && (
              <Badge variant={STATUS_BADGE_VARIANTS[user.subscription_status] ?? "default"}>
                {user.subscription_status}
              </Badge>
            )}
          </div>
          {user.username && (
            <p className="text-sm text-pnp-textSecondary">@{user.username}</p>
          )}
          {user.email && (
            <p className="text-sm text-pnp-textSecondary">{user.email}</p>
          )}
          <p className="text-xs text-pnp-textSecondary mt-1">ID: {user.id}</p>
        </div>
      </div>

      {/* Edit Form */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
          Edit User
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-username">
              Username
            </label>
            <input
              id="edit-username"
              type="text"
              value={editForm.username}
              onChange={(e) => handleFormChange("username", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-email">
              Email
            </label>
            <input
              id="edit-email"
              type="email"
              value={editForm.email}
              onChange={(e) => handleFormChange("email", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-sub-status">
              Subscription Status
            </label>
            <select
              id="edit-sub-status"
              value={editForm.subscriptionStatus}
              onChange={(e) => handleFormChange("subscriptionStatus", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            >
              <option value="active">active</option>
              <option value="churned">churned</option>
              <option value="free">free</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-sub-plan">
              Subscription Plan
            </label>
            <select
              id="edit-sub-plan"
              value={editForm.subscriptionPlan}
              onChange={(e) => handleFormChange("subscriptionPlan", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            >
              <option value="">— None —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} ({p.tier})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-expiry">
              Plan Expiry
            </label>
            <input
              id="edit-expiry"
              type="date"
              value={editForm.planExpiry}
              onChange={(e) => handleFormChange("planExpiry", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="edit-tier">
              Tier
            </label>
            <select
              id="edit-tier"
              value={editForm.tier}
              onChange={(e) => handleFormChange("tier", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            >
              <option value="free">free</option>
              <option value="member">member</option>
              <option value="PRIME">PRIME</option>
              <option value="banned">banned</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saveLoading}
            className="px-5 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {saveLoading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Entitlements section */}
      {userId && <EntitlementsSection userId={userId} />}

      {/* Creator & Live Performer section */}
      {user && (
        <CreatorSection
          user={user}
          onUpdated={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      )}

      {/* Ban / Unban Section */}
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
          {isBanned ? "Unban User" : "Ban User"}
        </h2>
        <p className="text-xs text-pnp-textSecondary">
          {isBanned
            ? "This user is currently banned. Unbanning will restore their access."
            : "Banning a user will immediately revoke their access and set their tier to 'banned'."}
        </p>
        {!isBanned && (
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="ban-reason">
              Ban Reason (optional)
            </label>
            <textarea
              id="ban-reason"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              rows={2}
              placeholder="Reason for banning this user..."
              className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-red-500/50 resize-none"
            />
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={() => openBanModal(isBanned ? "unban" : "ban")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
              isBanned
                ? "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
            }`}
          >
            {isBanned ? "Unban User" : "Ban User"}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={banConfirmOpen}
        title={banAction === "ban" ? "Ban User" : "Unban User"}
        message={
          banAction === "ban"
            ? `Are you sure you want to ban @${user.username || user.id}? They will lose all access immediately.${banReason ? ` Reason: "${banReason}"` : ""}`
            : `Are you sure you want to unban @${user.username || user.id}? Their access will be restored.`
        }
        confirmLabel={banAction === "ban" ? "Ban User" : "Unban User"}
        variant={banAction === "ban" ? "danger" : "default"}
        onConfirm={executeBan}
        onCancel={() => setBanConfirmOpen(false)}
        loading={banLoading}
      />
    </div>
  );
}
