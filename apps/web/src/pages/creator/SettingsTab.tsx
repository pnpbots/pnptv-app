import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  getCreatorWallet,
  saveCreatorWallet,
  saveStreamRules,
  listCreatorMedia,
  addCreatorMedia,
  updateCreatorMedia,
  deleteCreatorMedia,
  reorderCreatorMedia,
  type CreatorDashboard as DashboardData,
  type CreatorMediaItem,
} from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

const TIERS: { key: "ice" | "crystal" | "diamond"; label: string; price: number; emoji: string }[] = [
  { key: "ice", label: "Ice", price: 5, emoji: "❄" },
  { key: "crystal", label: "Crystal", price: 10, emoji: "🔮" },
  { key: "diamond", label: "Diamond", price: 15, emoji: "💎" },
];

const FIAT_PROVIDERS: { key: string; label: string }[] = [
  { key: "venmo", label: "Venmo" },
  { key: "cashapp", label: "CashApp" },
  { key: "zelle", label: "Zelle" },
  { key: "paypal", label: "PayPal" },
  { key: "wise", label: "Wise" },
  { key: "revolut", label: "Revolut" },
];

interface SettingsTabProps {
  dashboard: DashboardData & { success: boolean };
  t: CreatorStrings;
}

const DASH_ADDRESS_RE = /^[X7][1-9A-HJ-NP-Za-km-z]{33}$/;

export function SettingsTab({ dashboard, t }: SettingsTabProps) {
  const { user: authUser } = useAuth();
  // Payout method state — USDC retired; Dash is the only crypto option.
  const [payoutMethod, setPayoutMethod] = useState<"dash" | "meru" | "fiat">("dash");
  const [dashAddress, setDashAddress] = useState<string>("");
  const [meruAccount, setMeruAccount] = useState<string>("");
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletSaving, setWalletSaving] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSuccess, setWalletSuccess] = useState<string | null>(null);

  // Fiat payout state
  const [fiatProvider, setFiatProvider] = useState<string>("");
  const [fiatAccount, setFiatAccount] = useState<string>("");

  // ── Album / media state ──────────────────────────────────────────────────────
  const [albumItems, setAlbumItems] = useState<CreatorMediaItem[]>([]);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [albumError, setAlbumError] = useState<string | null>(null);
  const [albumSuccess, setAlbumSuccess] = useState<string | null>(null);

  // Add-form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState<"photo" | "video">("photo");
  const [addUrl, setAddUrl] = useState("");
  const [addThumbUrl, setAddThumbUrl] = useState("");
  const [addCaption, setAddCaption] = useState("");
  const [addPremium, setAddPremium] = useState(false);
  const [addSaving, setAddSaving] = useState(false);

  const loadAlbum = useCallback(async () => {
    const userId = authUser?.id ? String(authUser.id) : null;
    if (!userId) { setAlbumLoading(false); return; }
    setAlbumLoading(true);
    try {
      const res = await listCreatorMedia(userId);
      setAlbumItems(res.items || []);
    } catch {
      // non-fatal
    } finally {
      setAlbumLoading(false);
    }
  }, [authUser?.id]);

  useEffect(() => { loadAlbum(); }, [loadAlbum]);

  const handleAddMedia = async () => {
    setAlbumError(null);
    setAlbumSuccess(null);
    if (!addUrl.trim()) { setAlbumError("URL is required."); return; }
    setAddSaving(true);
    try {
      await addCreatorMedia({
        type: addType,
        url: addUrl.trim(),
        thumbUrl: addThumbUrl.trim() || null,
        caption: addCaption.trim() || null,
        isPremium: addPremium,
      });
      setAlbumSuccess("Media added.");
      setAddUrl(""); setAddThumbUrl(""); setAddCaption(""); setAddPremium(false);
      setShowAddForm(false);
      await loadAlbum();
    } catch (err) {
      setAlbumError(err instanceof Error ? err.message : "Failed to add media.");
    } finally {
      setAddSaving(false);
    }
  };

  const handleTogglePremium = async (item: CreatorMediaItem) => {
    try {
      await updateCreatorMedia(item.id, { isPremium: !item.isPremium });
      setAlbumItems((prev) => prev.map((m) => m.id === item.id ? { ...m, isPremium: !m.isPremium } : m));
    } catch (err) {
      setAlbumError(err instanceof Error ? err.message : "Failed to update.");
    }
  };

  const handleDeleteMedia = async (id: string) => {
    try {
      await deleteCreatorMedia(id);
      setAlbumItems((prev) => prev.filter((m) => m.id !== id));
      setAlbumSuccess("Deleted.");
    } catch (err) {
      setAlbumError(err instanceof Error ? err.message : "Failed to delete.");
    }
  };

  const handleMoveItem = async (index: number, direction: -1 | 1) => {
    const newItems = [...albumItems];
    const target = index + direction;
    if (target < 0 || target >= newItems.length) return;
    [newItems[index], newItems[target]] = [newItems[target], newItems[index]];
    const reordered = newItems.map((m, i) => ({ ...m, sortOrder: i }));
    setAlbumItems(reordered);
    try {
      await reorderCreatorMedia(reordered.map((m) => ({ id: m.id, sort_order: m.sortOrder ?? 0 })));
    } catch {
      // revert on failure
      await loadAlbum();
    }
  };

  // Stream rules state
  const STREAM_RULES_MAX = 2000;
  const [streamRules, setStreamRules] = useState<string>(
    dashboard.streamRules ?? ""
  );
  const [streamRulesSaving, setStreamRulesSaving] = useState(false);
  const [streamRulesError, setStreamRulesError] = useState<string | null>(null);
  const [streamRulesSuccess, setStreamRulesSuccess] = useState<string | null>(null);

  const handleSaveStreamRules = async () => {
    setStreamRulesError(null);
    setStreamRulesSuccess(null);
    if (streamRules.length > STREAM_RULES_MAX) {
      setStreamRulesError(`Rules must be at most ${STREAM_RULES_MAX} characters.`);
      return;
    }
    setStreamRulesSaving(true);
    try {
      const res = await saveStreamRules(streamRules);
      if (res.success) {
        setStreamRulesSuccess("Stream rules saved.");
        setStreamRules(res.rules ?? "");
      } else {
        setStreamRulesError((res as { error?: string }).error || "Failed to save stream rules.");
      }
    } catch (err) {
      setStreamRulesError(err instanceof Error ? err.message : "Failed to save stream rules.");
    } finally {
      setStreamRulesSaving(false);
    }
  };

  // Load wallet data
  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res = await getCreatorWallet();
      if (res.success) {
        // Normalize legacy 'crypto' / 'meru' (when no dash address present) to 'dash'
        const method = res.payoutMethod === 'fiat' ? 'fiat'
          : res.payoutMethod === 'meru' ? 'meru'
          : 'dash';
        setPayoutMethod(method);
        setDashAddress(res.dashAddress || "");
        setMeruAccount(res.meruAccount || "");
        setFiatProvider(res.fiatPayoutMethod || "");
        setFiatAccount(res.fiatPayoutAccount || "");
      }
    } catch {
      // Non-critical
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const handleSaveWallet = async () => {
    setWalletError(null);
    setWalletSuccess(null);

    if (payoutMethod === "dash") {
      const trimmed = dashAddress.trim();
      if (!DASH_ADDRESS_RE.test(trimmed)) {
        setWalletError("Invalid Dash address. Mainnet addresses start with X (or 7) and are 34 characters long.");
        return;
      }
      setWalletSaving(true);
      try {
        const res = await saveCreatorWallet({ payoutMethod: "dash", dashAddress: trimmed });
        if (res.success) {
          setWalletSuccess("Dash payout address saved. You'll receive a claim link by email when your next payout is ready.");
          setDashAddress(trimmed);
        } else {
          setWalletError((res as { error?: string }).error || "Failed to save Dash address.");
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : "Failed to save Dash address.");
      } finally {
        setWalletSaving(false);
      }
    } else if (payoutMethod === "fiat") {
      if (!fiatProvider) {
        setWalletError(t.errorFiatProviderEmpty || "Select a payout provider.");
        return;
      }
      if (!fiatAccount.trim()) {
        setWalletError(t.errorFiatAccountEmpty || "Enter your account handle or email.");
        return;
      }
      setWalletSaving(true);
      try {
        const res = await saveCreatorWallet({
          payoutMethod: "fiat",
          fiatProvider,
          fiatAccount: fiatAccount.trim(),
        });
        if (res.success) {
          setWalletSuccess(t.walletSavedFiat || "Fiat payout info saved successfully.");
        } else {
          setWalletError((res as { error?: string }).error || "Failed to save fiat payout info.");
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : "Failed to save fiat payout info.");
      } finally {
        setWalletSaving(false);
      }
    } else {
      const meru = meruAccount.trim();
      if (!meru) {
        setWalletError(t.errorMeruEmpty);
        return;
      }
      setWalletSaving(true);
      try {
        const res = await saveCreatorWallet({ payoutMethod: "meru", meruAccount: meru });
        if (res.success) {
          setWalletSuccess(t.walletSavedMeru);
          setMeruAccount(meru);
        } else {
          setWalletError((res as { error?: string }).error || t.errorSaveMeru);
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : t.errorSaveMeru);
      } finally {
        setWalletSaving(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Payout Method Card */}
      <div className="glass-card-sm p-5">
        <p className="text-sm font-semibold text-white mb-1">{t.payoutMethodTitle}</p>
        <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>{t.payoutMethodDesc}</p>

        {/* Method selector — Dash is the only crypto option; USDC retired */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {([
            { key: "dash" as const, label: "Dash",                       icon: "🥷" },
            { key: "fiat" as const, label: t.payoutFiatLabel || "Fiat",  icon: "💵" },
            { key: "meru" as const, label: t.payoutMeruLabel,            icon: "📱" },
          ]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                setPayoutMethod(opt.key);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              disabled={walletLoading}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{
                background: payoutMethod === opt.key
                  ? "linear-gradient(135deg, #D4007A, #E69138)"
                  : "rgba(255,255,255,0.05)",
                color: payoutMethod === opt.key ? "#fff" : "#8E8E93",
                border: payoutMethod === opt.key
                  ? "1px solid transparent"
                  : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span className="block text-base mb-0.5">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>

        {walletLoading ? (
          <div className="h-10 bg-white/5 rounded-lg animate-pulse mb-3" />
        ) : payoutMethod === "dash" ? (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>
              Enter your Dash wallet address. When a payout is ready you'll get an email with a one-tap claim link — BTCPay sends Dash on-chain to this address. USD balance is converted to Dash at claim time using the live exchange rate.
            </p>
            <input
              type="text"
              value={dashAddress}
              onChange={(e) => {
                setDashAddress(e.target.value);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              placeholder="Xa1bc2d3... (34 chars, starts with X or 7)"
              spellCheck={false}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        ) : payoutMethod === "meru" ? (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>{t.meruInputHint}</p>
            <input
              type="text"
              value={meruAccount}
              onChange={(e) => {
                setMeruAccount(e.target.value);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              placeholder={t.meruPlaceholder}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        ) : payoutMethod === "fiat" ? (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>{t.fiatInputHint || "Select your preferred payout provider and enter your account."}</p>
            <select
              value={fiatProvider}
              onChange={(e) => {
                setFiatProvider(e.target.value);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors mb-2"
            >
              <option value="" className="bg-[#1a1a2e]">— Select provider —</option>
              {FIAT_PROVIDERS.map((p) => (
                <option key={p.key} value={p.key} className="bg-[#1a1a2e]">{p.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={fiatAccount}
              onChange={(e) => {
                setFiatAccount(e.target.value);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              placeholder={t.fiatAccountPlaceholder || "username, email, or phone"}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        ) : null}

        {walletSuccess && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
            {walletSuccess}
          </div>
        )}
        {walletError && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
            {walletError}
          </div>
        )}

        <button
          onClick={handleSaveWallet}
          disabled={walletSaving || walletLoading || (
            payoutMethod === "dash" ? !dashAddress.trim() :
            payoutMethod === "fiat" ? (!fiatProvider || !fiatAccount.trim()) :
                                      !meruAccount.trim()
          )}
          className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
        >
          {walletSaving ? t.savingWallet : t.savePayoutInfo}
        </button>

        <p className="mt-4 text-xs leading-relaxed" style={{ color: "#8E8E93" }}>{t.payoutScheduleNote}</p>
      </div>

      {/* Tier milestone info — read-only */}
      {dashboard.creatorType !== "full_time" && (
        <div className="glass-card-sm p-5">
          <p className="text-sm font-semibold text-white mb-1">{t.creatorTierTitle}</p>
          <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>{t.creatorTierDesc}</p>
          <div className="flex gap-2">
            {TIERS.map((tier) => {
              const isCurrent = dashboard.creatorType === tier.key;
              const tierOrder = { ice: 0, crystal: 1, diamond: 2 };
              const currentOrder = tierOrder[dashboard.creatorType as keyof typeof tierOrder] ?? -1;
              const isUnlocked = tierOrder[tier.key] <= currentOrder;
              return (
                <div
                  key={tier.key}
                  className="flex-1 py-2.5 rounded-lg text-xs font-semibold text-center"
                  style={{
                    background: isCurrent
                      ? "linear-gradient(135deg, #D4007A, #E69138)"
                      : isUnlocked
                      ? "rgba(212,0,122,0.15)"
                      : "rgba(255,255,255,0.04)",
                    color: isCurrent ? "#fff" : isUnlocked ? "#D4007A" : "#8E8E93",
                    border: isCurrent
                      ? "1px solid transparent"
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {tier.emoji} {tier.label}
                  {isCurrent && <span className="block text-xs font-normal mt-0.5 opacity-80">{t.tierCurrent}</span>}
                  {!isCurrent && !isUnlocked && <span className="block text-xs font-normal mt-0.5 opacity-60">{t.tierLocked}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stream Rules Card */}
      <div className="glass-card-sm p-5">
        <p className="text-sm font-semibold text-white mb-1">My Stream Rules</p>
        <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
          These rules appear in the "House Rules" section viewers see before joining your stream. Plain text only.
        </p>
        <div className="relative">
          <textarea
            value={streamRules}
            onChange={(e) => {
              setStreamRules(e.target.value);
              setStreamRulesError(null);
              setStreamRulesSuccess(null);
            }}
            placeholder={"e.g. No screenshots. Respect my boundaries. Tip before making requests."}
            rows={6}
            maxLength={STREAM_RULES_MAX}
            className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors resize-none leading-relaxed"
          />
          <span
            className="absolute bottom-2 right-3 text-xs select-none"
            style={{ color: streamRules.length > STREAM_RULES_MAX * 0.9 ? "#E69138" : "#8E8E93" }}
          >
            {streamRules.length} / {STREAM_RULES_MAX}
          </span>
        </div>

        {streamRulesSuccess && (
          <div className="mt-2 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
            {streamRulesSuccess}
          </div>
        )}
        {streamRulesError && (
          <div className="mt-2 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
            {streamRulesError}
          </div>
        )}

        <button
          onClick={handleSaveStreamRules}
          disabled={streamRulesSaving || streamRules.length > STREAM_RULES_MAX}
          className="mt-3 text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
        >
          {streamRulesSaving ? "Saving..." : "Save Rules"}
        </button>
      </div>

      {/* ── My Album ── */}
      <div className="glass-card-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-white">My Album</p>
          <button
            onClick={() => { setShowAddForm((v) => !v); setAlbumError(null); setAlbumSuccess(null); }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}
          >
            {showAddForm ? "Cancel" : "+ Add media"}
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
          Photos and videos shown on your performer card and album grid. Premium items are blurred for non-subscribers.
        </p>

        {/* Add form */}
        {showAddForm && (
          <div className="mb-4 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex gap-2 mb-3">
              {(["photo", "video"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setAddType(t)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: addType === t ? "linear-gradient(135deg,#D4007A,#E69138)" : "rgba(255,255,255,0.05)",
                    color: addType === t ? "#fff" : "#8E8E93",
                    border: addType === t ? "1px solid transparent" : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {t === "photo" ? "Photo" : "Video"}
                </button>
              ))}
            </div>
            <input
              type="url"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="Media URL (https://...)"
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 mb-2"
            />
            <input
              type="url"
              value={addThumbUrl}
              onChange={(e) => setAddThumbUrl(e.target.value)}
              placeholder="Thumbnail URL (optional)"
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 mb-2"
            />
            <input
              type="text"
              value={addCaption}
              onChange={(e) => setAddCaption(e.target.value)}
              placeholder="Caption (optional)"
              maxLength={160}
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 mb-3"
            />
            <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addPremium}
                onChange={(e) => setAddPremium(e.target.checked)}
                className="w-4 h-4 rounded accent-pink-600"
              />
              <span className="text-xs text-white/80">Premium (subscribers only)</span>
            </label>
            <button
              onClick={handleAddMedia}
              disabled={addSaving || !addUrl.trim()}
              className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff" }}
            >
              {addSaving ? "Adding..." : "Add"}
            </button>
          </div>
        )}

        {albumSuccess && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
            {albumSuccess}
          </div>
        )}
        {albumError && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
            {albumError}
          </div>
        )}

        {albumLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />)}
          </div>
        ) : albumItems.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: "#8E8E93" }}>No media yet. Add photos or videos above.</p>
        ) : (
          <div className="space-y-2">
            {albumItems.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2.5 rounded-lg"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-white/5">
                  {(item.thumbUrl || item.url) ? (
                    item.type === "video" ? (
                      <video src={(item.thumbUrl || item.url) as string} className="w-full h-full object-cover" muted playsInline preload="none" />
                    ) : (
                      <img src={(item.thumbUrl || item.url) as string} alt="" className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">?</div>
                  )}
                </div>
                {/* Meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">
                    {item.type === "video" ? "Video" : "Photo"}
                    {item.caption ? ` — ${item.caption}` : ""}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: item.isPremium ? "#E69138" : "#8E8E93" }}>
                    {item.isPremium ? "Premium" : "Free"}
                  </p>
                </div>
                {/* Controls */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleMoveItem(idx, -1)}
                    disabled={idx === 0}
                    className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white/70 disabled:opacity-20 transition-colors"
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => handleMoveItem(idx, 1)}
                    disabled={idx === albumItems.length - 1}
                    className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white/70 disabled:opacity-20 transition-colors"
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => handleTogglePremium(item)}
                    className="px-2 py-1 rounded text-[10px] font-semibold transition-colors"
                    style={
                      item.isPremium
                        ? { background: "rgba(230,145,56,0.15)", color: "#E69138" }
                        : { background: "rgba(255,255,255,0.06)", color: "#8E8E93" }
                    }
                  >
                    {item.isPremium ? "Free" : "Lock"}
                  </button>
                  <button
                    onClick={() => handleDeleteMedia(item.id)}
                    className="w-6 h-6 rounded flex items-center justify-center text-red-400/60 hover:text-red-400 transition-colors"
                    aria-label="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
