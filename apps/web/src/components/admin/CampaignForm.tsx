import React from "react";
import { getAdminXCampaignMediaFolder, type XActiveAccount, type XAutoCampaign } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ── Constants ────────────────────────────────────────────────────────────────
export const GROK_MODES = [
  { value: "xPost", label: "X Post (3 options)" },
  { value: "broadcast", label: "Broadcast" },
  { value: "salesPost", label: "Sales Post" },
  { value: "sharePost", label: "Share Post" },
];

export const PERSONA_TYPES = [
  { value: "generic", label: "Generic PnP Brand" },
  { value: "santino", label: "🔥 SXNTINX (Dominant)" },
  { value: "lex", label: "🐷 Lex (Submissive)" },
];

export const LANGUAGES = [
  { value: "es", label: "Spanish" },
  { value: "en", label: "English" },
  { value: "bilingual", label: "Bilingual" },
];

// ── Types ────────────────────────────────────────────────────────────────────
export interface CampaignFormState {
  name: string;
  accountId: string;
  topic: string;
  grokMode: string;
  language: string;
  customPrompt: string;
  intervalMinutes: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  maxPosts: string;
  attachVideos: boolean;
  personaType: "santino" | "lex" | "generic";
}

export interface CampaignFormProps {
  form: CampaignFormState;
  setForm: React.Dispatch<React.SetStateAction<CampaignFormState>>;
  accounts: XActiveAccount[];
  mediaFolderId: string | null;
  mediaFolderCmsUrl: string | null;
  editingCampaign: XAutoCampaign | null;
  onSubmit: () => void;
  onCancel: () => void;
  loading: boolean;
  onMediaFolderLoaded?: (folderId: string, cmsUrl: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function CampaignForm({
  form,
  setForm,
  accounts,
  mediaFolderId,
  mediaFolderCmsUrl,
  editingCampaign,
  onSubmit,
  onCancel,
  loading,
  onMediaFolderLoaded,
}: CampaignFormProps) {
  const t = useI18n();

  const handleAttachVideosChange = async (checked: boolean) => {
    setForm((f) => ({ ...f, attachVideos: checked }));
    if (checked && !mediaFolderCmsUrl && onMediaFolderLoaded) {
      try {
        const res = await getAdminXCampaignMediaFolder();
        onMediaFolderLoaded(res.folderId, res.cmsUrl);
      } catch { /* ignore */ }
    }
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="mt-3 p-4 rounded-xl bg-pnp-surface border border-pnp-border space-y-3"
    >
      {editingCampaign && (
        <p className="text-xs font-semibold text-blue-400">
          {t.admin.xCampaigns.actions.edit}: {editingCampaign.name}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">
            {t.admin.xCampaigns.form.name}
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
            placeholder="Daily PNP Promo"
            required
          />
        </div>
        {!editingCampaign && (
          <div>
            <label className="text-xs text-pnp-textSecondary block mb-1">
              {t.admin.xCampaigns.form.account}
            </label>
            <select
              value={form.accountId}
              onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
              required
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  @{a.handle}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-pnp-textSecondary block mb-1">
          {t.admin.xCampaigns.form.topic}
        </label>
        <textarea
          value={form.topic}
          onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none min-h-[80px]"
          placeholder={t.admin.xCampaigns.form.topicPlaceholder}
          required
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">
            {t.admin.xCampaigns.form.grokMode}
          </label>
          <select
            value={form.grokMode}
            onChange={(e) => setForm((f) => ({ ...f, grokMode: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
          >
            {GROK_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">
            {t.admin.xCampaigns.form.language}
          </label>
          <select
            value={form.language}
            onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">Persona</label>
          <select
            value={form.personaType}
            onChange={(e) =>
              setForm((f) => ({ ...f, personaType: e.target.value as "santino" | "lex" | "generic" }))
            }
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary focus:border-pnp-accent focus:outline-none"
          >
            {PERSONA_TYPES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">
            {t.admin.xCampaigns.form.interval}
          </label>
          <input
            type="number"
            value={form.intervalMinutes}
            onChange={(e) => setForm((f) => ({ ...f, intervalMinutes: parseInt(e.target.value) || 240 }))}
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
            min={15}
          />
        </div>
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">
            {t.admin.xCampaigns.form.maxPosts}
          </label>
          <input
            type="number"
            value={form.maxPosts}
            onChange={(e) => setForm((f) => ({ ...f, maxPosts: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
            placeholder={t.admin.xCampaigns.form.maxPostsPlaceholder}
            min={1}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">
            {t.admin.xCampaigns.form.hoursStart}
          </label>
          <input
            type="time"
            value={`${String(Math.floor(form.activeHoursStart / 60)).padStart(2, "0")}:${String(form.activeHoursStart % 60).padStart(2, "0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              setForm((f) => ({ ...f, activeHoursStart: h * 60 + (m || 0) }));
            }}
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary focus:border-pnp-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-pnp-textSecondary block mb-1">
            {t.admin.xCampaigns.form.hoursEnd}
          </label>
          <input
            type="time"
            value={`${String(Math.floor(form.activeHoursEnd / 60)).padStart(2, "0")}:${String(form.activeHoursEnd % 60).padStart(2, "0")}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              setForm((f) => ({ ...f, activeHoursEnd: h * 60 + (m || 0) }));
            }}
            className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary focus:border-pnp-accent focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-pnp-textSecondary block mb-1">
          {t.admin.xCampaigns.form.customPrompt}
        </label>
        <textarea
          value={form.customPrompt}
          onChange={(e) => setForm((f) => ({ ...f, customPrompt: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none min-h-[60px]"
          placeholder={t.admin.xCampaigns.form.customPromptPlaceholder}
        />
        <div className="mt-2 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-300/90">
          <p className="font-semibold mb-1">🔥 Lifetime100 Required Format</p>
          <p className="font-mono whitespace-pre-wrap leading-relaxed text-orange-200/70">{`[EMOJI] [HOOK IN ALL CAPS] [EMOJI]
[Benefits: Lex, Santino, clouds, slams, live shows]
👉 pnptv.app/lifetime100 [emojis]`}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.attachVideos}
            onChange={(e) => handleAttachVideosChange(e.target.checked)}
            className="w-4 h-4 rounded border-pnp-border bg-pnp-background text-pnp-accent focus:ring-pnp-accent"
          />
          <span className="text-sm text-pnp-textPrimary">{t.admin.xCampaigns.form.attachVideos}</span>
        </label>
        {form.attachVideos && mediaFolderCmsUrl && (
          <a
            href={mediaFolderCmsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-pnp-accent hover:underline"
          >
            {t.admin.xCampaigns.form.uploadInCms} &rarr;
          </a>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-background border border-pnp-border text-pnp-textPrimary hover:border-pnp-accent/50 transition-colors"
        >
          {t.admin.xCampaigns.actions.cancel}
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
        >
          {loading
            ? editingCampaign
              ? t.common.saving
              : t.common.loading
            : editingCampaign
              ? t.admin.xCampaigns.actions.saveChanges
              : t.admin.xCampaigns.actions.createPaused}
        </button>
      </div>
    </form>
  );
}
