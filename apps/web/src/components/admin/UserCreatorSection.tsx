import React, { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  getAdminLiveChannels,
  makeAdminUserCreator,
  revokeAdminUserCreator,
  setCreatorLock,
  type AdminUser,
  type AdminChannel,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Local SVG icons
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREATOR_TYPES = ["performer", "streamer", "creator", "dj", "host"] as const;

// ---------------------------------------------------------------------------
// UserCreatorSection (exported)
// ---------------------------------------------------------------------------

interface UserCreatorSectionProps {
  user: AdminUser;
  onUpdated: (patch: Partial<AdminUser>) => void;
}

export function UserCreatorSection({ user, onUpdated }: UserCreatorSectionProps) {
  const t = useI18n().admin;
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

  // Creator onboarding-lock toggle
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const handleToggleLock = async () => {
    if (!user.id) return;
    setLockLoading(true);
    setLockError(null);
    try {
      const next = !user.creator_locked;
      const res = await setCreatorLock(user.id, next);
      if (res.success) {
        onUpdated({ creator_locked: res.user.creator_locked });
      } else {
        setLockError("Failed to update onboarding lock");
      }
    } catch (err) {
      setLockError(err instanceof Error ? err.message : "Failed to update onboarding lock");
    } finally {
      setLockLoading(false);
    }
  };

  const loadChannels = async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await getAdminLiveChannels();
      setChannels(res.channels);
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : t.creatorSection.failedChannels);
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
      setSuccessMsg(t.creatorSection.grantAccess);
      setFormOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t.creatorSection.failedGrant);
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
      setSuccessMsg(t.creatorSection.revokeAccess);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : t.creatorSection.failedRevoke);
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
        {t.creatorSection.sectionTitle}
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
        <span className="text-xs text-pnp-textSecondary">{t.creatorSection.roleLabel}</span>
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
            <span className="text-xs text-pnp-textSecondary">{t.creatorSection.statusLabel}</span>
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
            <span className="text-xs text-pnp-textSecondary">{t.creatorSection.typeLabel}</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
              {user.creator_type}
            </span>
          </>
        )}

        {user.live_channel && (
          <>
            <span className="text-xs text-pnp-textSecondary">{t.creatorSection.channelLabel}</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono bg-pnp-surface text-pnp-textPrimary border border-pnp-border">
              {user.live_channel}
            </span>
          </>
        )}

        {user.creator_price_usd != null && (
          <>
            <span className="text-xs text-pnp-textSecondary">{t.creatorSection.priceLabel}</span>
            <span className="text-xs text-pnp-textPrimary font-medium">
              ${Number(user.creator_price_usd).toFixed(2)}/mo
            </span>
          </>
        )}

        {user.creator_status === "active" && (
          <>
            <span className="text-xs text-pnp-textSecondary">Onboarding</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                user.creator_locked
                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  : "bg-green-500/15 text-green-400 border-green-500/20"
              }`}
            >
              {user.creator_locked ? "Locked (pending onboarding)" : "Unlocked"}
            </span>
            <button
              onClick={handleToggleLock}
              disabled={lockLoading}
              className={`px-2 py-0.5 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50 ${
                user.creator_locked
                  ? "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
              }`}
              title={user.creator_locked ? "Unlock creator tools (onboarding complete)" : "Lock creator tools pending onboarding"}
            >
              {lockLoading ? "…" : user.creator_locked ? "Unlock tools" : "Lock tools"}
            </button>
            {lockError && <span className="text-xs text-red-400">{lockError}</span>}
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
            {t.creatorSection.grantAccess}
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
              {t.creatorSection.editSettings}
            </button>
          )}
          <button
            onClick={() => {
              setRevokeConfirm(true);
              setSuccessMsg(null);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors min-h-[44px]"
          >
            {t.creatorSection.revokeAccess}
          </button>
        </div>
      )}

      {/* Revoke confirm inline */}
      {revokeConfirm && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 space-y-3">
          <p className="text-sm text-red-400">
            {t.creatorSection.revokeConfirm.replace("{0}", user.username || user.id)}
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setRevokeConfirm(false)}
              disabled={revokeLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surfaceHover transition-colors min-h-[44px] disabled:opacity-50"
            >
              {t.shared.cancel}
            </button>
            <button
              onClick={handleRevoke}
              disabled={revokeLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors min-h-[44px] disabled:opacity-50"
            >
              {revokeLoading ? t.creatorSection.revoking : t.creatorSection.yesRevoke}
            </button>
          </div>
        </div>
      )}

      {/* Grant / Edit form */}
      {formOpen && (
        <div className="rounded-lg bg-pnp-surface border border-purple-500/20 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-pnp-textPrimary">
            {isCreator ? t.creatorSection.editSettings : t.creatorSection.grantAccess}
          </h3>

          {submitError && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {submitError}
            </div>
          )}

          {/* Channel selector */}
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="creator-channel">
              {t.creatorSection.liveChannel}
            </label>
            {channelsLoading ? (
              <div className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                <IconSpinner /> {t.creatorSection.loadingChannels}
              </div>
            ) : channelsError ? (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <IconAlert /> {channelsError}
                <button onClick={loadChannels} className="underline hover:no-underline ml-1">
                  {t.shared.tryAgain}
                </button>
              </div>
            ) : (
              <select
                id="creator-channel"
                value={channelRef}
                onChange={(e) => setChannelRef(e.target.value)}
                style={{ fontSize: "16px" }} className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-purple-500/50"
              >
                <option value="">{t.creatorSection.noChannel}</option>
                {availableChannels.map((ch) => (
                  <option key={ch.id} value={ch.reference}>
                    {ch.reference}{ch.rtmpName ? ` (key: ${ch.rtmpName})` : ""}{ch.isLive ? " 🔴" : ""}
                    {ch.assignedUser?.id === user.id ? " ✓ current" : ""}
                  </option>
                ))}
                {channels.length > 0 && availableChannels.length === 0 && (
                  <option disabled value="">
                    {t.creatorSection.allAssigned}
                  </option>
                )}
              </select>
            )}
          </div>

          {/* Creator type */}
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="creator-type">
              {t.creatorSection.creatorType}
            </label>
            <select
              id="creator-type"
              value={creatorType}
              onChange={(e) => setCreatorType(e.target.value)}
              style={{ fontSize: "16px" }} className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-purple-500/50"
            >
              <option value="">{t.creatorSection.selectType}</option>
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
              {t.creatorSection.subPrice}
            </label>
            <input
              id="creator-price"
              type="number"
              min="0"
              step="0.50"
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
              style={{ fontSize: "16px" }} className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary focus:outline-none focus:border-purple-500/50"
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
              {t.creatorSection.grantLifetime}
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
              {t.shared.cancel}
            </button>
            <button
              onClick={handleGrant}
              disabled={submitting}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors min-h-[44px] disabled:opacity-50"
            >
              {submitting ? t.shared.saving : isCreator ? t.shared.save : t.creatorSection.grantAccess}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
