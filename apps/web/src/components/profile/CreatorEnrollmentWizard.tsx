import React, { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { submitCreatorEnrollment } from "@/lib/api";
import { SignaturePad } from "@/components/SignaturePad";

// ── Tier constants (shared with MonetizeContentCard) ──────────────────────────

export const CREATOR_TIERS = [
  { id: "ice" as const, label: "Ice", price: 5, color: "#5ED1C4", gradient: "linear-gradient(135deg, #5ED1C4, #00D4E8)", emoji: "❄️" },
  { id: "crystal" as const, label: "Crystal", price: 10, color: "#D4007A", gradient: "linear-gradient(135deg, #D4007A, #E69138)", emoji: "🔮" },
  { id: "diamond" as const, label: "Diamond", price: 15, color: "#FFB454", gradient: "linear-gradient(135deg, #FFB454, #FF8C00)", emoji: "💎" },
] as const;

export type TierId = typeof CREATOR_TIERS[number]["id"];

export const TIER_CONFIG = {
  ice:     { color: "#5ED1C4", gradient: "linear-gradient(135deg, #5ED1C4, #00D4E8)",  rgb: "94,209,196",  name: "Ice Profile",     emoji: "❄️", price: 5 },
  crystal: { color: "#D4007A", gradient: "linear-gradient(135deg, #D4007A, #E69138)",  rgb: "212,0,122",   name: "Crystal Profile", emoji: "🔮", price: 10 },
  diamond: { color: "#FFB454", gradient: "linear-gradient(135deg, #FFB454, #FF8C00)",  rgb: "255,180,84",  name: "Diamond Profile", emoji: "💎", price: 15 },
} as const;

// ── Tier auto-upgrade thresholds ─────────────────────────────────────────────

export const TIER_UPGRADE_THRESHOLDS: Record<TierId, { nextTier: TierId | null; subscribersNeeded: number | null }> = {
  ice:     { nextTier: "crystal", subscribersNeeded: 10 },
  crystal: { nextTier: "diamond", subscribersNeeded: 25 },
  diamond: { nextTier: null,      subscribersNeeded: null },
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CreatorEnrollmentWizardProps {
  tier?: TierId;
  onClose: () => void;
  onSubmitted: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Creator Guidelines content ────────────────────────────────────────────────

const PROFILE_SCHEDULE = [
  { day: "Pre-launch", action: "Upload 5 exclusive videos (5–8 min each) before enabling your fee. This is your content wall — no wall, no charge." },
  { day: "Mon + Thu", action: "Drop 1 exclusive video each day (5–8 min). Raw, solo, spontaneous. Minimal editing." },
  { day: "Tue / Wed / Fri", action: "1 free teaser post per day — a still, a 30-sec clip, or a voice note. This is your marketing." },
  { day: "Weekend", action: "Optional: 1 bonus exclusive or a poll asking fans what they want to see next." },
  { day: "Monthly goal", action: "8–10 exclusive videos + 12–15 free teasers. Subscribers renew every 30 days — give them a reason to stay." },
];

const CHANNEL_SCHEDULE = [
  { day: "Pre-launch", action: "Upload 3 full-length videos (20+ min each) before publishing the channel. Subscribers need to see value on day one." },
  { day: "Every 7 days", action: "1 full-length video (20–40 min). Multiple creators, planned scene, clear concept. Quality over quantity." },
  { day: "Every 3–4 days", action: "1 supplementary clip (5–10 min): behind-the-scenes, casting call, community teaser." },
  { day: "Monthly collab", action: "At least 1 video per month featuring a creator from a different area. Cross-pollination grows both audiences." },
  { day: "Monthly goal", action: "4 full-length videos + 6–8 supplementary clips. Channels live or die by consistency." },
];

const PROFILE_GUIDE = (
  <div className="space-y-3 text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">What is a Creator Profile?</p>
      <p>Your profile is <em>you</em> — a persona, not a concept. Fans follow you for who you are, not a theme. This is the right format if you shoot spontaneously, perform solo, and don't want to coordinate with other creators.</p>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Video Format</p>
      <ul className="list-disc list-inside space-y-1 mt-1">
        <li><strong className="text-white">Length:</strong> 5–8 minutes per video. Long enough to be satisfying, short enough to shoot in one take.</li>
        <li><strong className="text-white">Style:</strong> Raw and amateur. Phone camera is fine. Natural lighting, no script. The less produced it looks, the more authentic it feels.</li>
        <li><strong className="text-white">Content:</strong> Solo performer is the core format — just you. Keep it focused, keep it real.</li>
        <li><strong className="text-white">Editing:</strong> Minimal. Trim dead air at the start and end. No music, no cuts unless necessary. The rawness is the product.</li>
        <li><strong className="text-white">File format:</strong> MP4, max 500 MB per video. Portrait or landscape both work.</li>
      </ul>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Recommended Posting Schedule</p>
      <div className="space-y-2 mt-1">
        {PROFILE_SCHEDULE.map((row, i) => (
          <div key={i} className="flex gap-2">
            <span className="font-semibold flex-shrink-0" style={{ color: "#D4007A", minWidth: 80 }}>{row.day}</span>
            <span>{row.action}</span>
          </div>
        ))}
      </div>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Monetization Strategy</p>
      <ol className="list-decimal list-inside space-y-1 mt-1">
        <li>Upload 5 exclusive videos <em>before</em> turning on your fee. Your wall must have content before you charge.</li>
        <li>Enable your membership fee in Settings → "Accept new memberships."</li>
        <li>Keep free teasers flowing daily — this is how new fans find you and decide to subscribe.</li>
        <li>Never delete old exclusive videos. Subscribers pay for access to your full archive.</li>
      </ol>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Privacy & Visibility</p>
      <p>PNPtv! is a closed community. Your content is visible only to registered members — not indexable by Google, not shareable to outside platforms. You can build a real following inside the community while remaining completely invisible to the outside world. Use a stage name. You control what is free and what is exclusive.</p>
    </div>
  </div>
);

const CHANNEL_GUIDE = (
  <div className="space-y-3 text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">What is a Channel?</p>
      <p>A channel is built around a <em>concept</em>, not a person. Examples: <strong className="text-white">PNP Cruising Spots</strong>, <strong className="text-white">PNP Trans Scenes</strong>, <strong className="text-white">Bareback Latino</strong>, <strong className="text-white">Bear Den</strong>. Multiple creators contribute. The concept is the brand — creators come and go, the channel endures.</p>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Video Format</p>
      <ul className="list-disc list-inside space-y-1 mt-1">
        <li><strong className="text-white">Length:</strong> 20 minutes minimum. 30–40 min is the ideal sweet spot. Longer is fine if the content warrants it.</li>
        <li><strong className="text-white">Style:</strong> More produced than profiles. Multiple angles, basic editing, scene structure (build-up, main event, outro). A tripod and external mic make a real difference.</li>
        <li><strong className="text-white">Creators per scene:</strong> 2 or more. Channels are about chemistry and ensemble — solo content belongs on profiles, not channels.</li>
        <li><strong className="text-white">Editing:</strong> Cut dead time, add a simple title card, sync audio if you're using an external mic. Color correction is a bonus, not required.</li>
        <li><strong className="text-white">File format:</strong> MP4, max 2 GB per video. Landscape (16:9) strongly recommended.</li>
      </ul>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Collaboration Policy</p>
      <p>Creators in the same city or region are <strong className="text-white">strongly encouraged</strong> to create joint channels. A channel with 3 active creators posting weekly outperforms a solo creator channel every time. Add collaborators in Creator Studio → Channels → Edit → Collaborators. All collaborators can upload; channel ownership stays with the creator who created it.</p>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Recommended Posting Schedule</p>
      <div className="space-y-2 mt-1">
        {CHANNEL_SCHEDULE.map((row, i) => (
          <div key={i} className="flex gap-2">
            <span className="font-semibold flex-shrink-0" style={{ color: "#E69138", minWidth: 100 }}>{row.day}</span>
            <span>{row.action}</span>
          </div>
        ))}
      </div>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Linking Your Channel to a Hangout</p>
      <p>Every channel can be linked to a Hangout — a private group chat exclusive to your channel subscribers. This is your most powerful tool for building loyalty.</p>
      <ol className="list-decimal list-inside space-y-1 mt-1">
        <li>Create or open your Hangout in the Hangouts section.</li>
        <li>In Hangout Settings, select "Link to Channel" and choose your channel.</li>
        <li>From this point, everyone who subscribes to the channel automatically gets access to the Hangout.</li>
        <li>Use the Hangout to announce new videos, take requests, do Q&A, share unedited clips, and talk directly with your most loyal fans.</li>
      </ol>
      <p className="mt-1">The Hangout is not just chat — it is the direct communication line between your channel and your paying audience. Creators who use it consistently retain subscribers at a significantly higher rate.</p>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Sharing Posts from Your Feed to a Hangout</p>
      <p>When you create a post in your feed (a teaser clip, a photo set, an announcement), you can simultaneously send it to your linked Hangout. In the Post Composer, select your channel in the "Post to" dropdown, then also toggle "Share to Hangout." The post appears in the community feed AND drops directly into the Hangout as a message — your subscribers see it in both places.</p>
      <p className="mt-1">This is how one piece of content does double duty: it markets to the broader community and rewards your paying fans with first access, all in one tap.</p>
    </div>
    <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="font-semibold text-white">Visibility Strategy — Famous Inside, Invisible Outside</p>
      <p>PNPtv! is a sealed community. No content is indexed externally. Here is how to maximize your reach <em>within</em> the platform:</p>
      <ul className="list-disc list-inside space-y-1 mt-1">
        <li><strong className="text-white">Post free teasers to the feed</strong> — every free post is visible to all members and drives subscriptions.</li>
        <li><strong className="text-white">Use your Hangout actively</strong> — the algorithm surfaces channels whose Hangouts have recent activity.</li>
        <li><strong className="text-white">Cross-post to the community feed</strong> when you drop a new channel video — use the feed post as the trailer, the channel video as the full content.</li>
        <li><strong className="text-white">Collaborate with creators in other cities</strong> — when they share the collab video on their profile, their audience discovers your channel.</li>
        <li><strong className="text-white">React and engage</strong> — comment on other creators' posts. Visibility on PNPtv! is earned through participation, not paid promotion.</li>
      </ul>
      <p className="mt-1">The goal: become a name that every member of the community knows, while the outside world has no idea you exist.</p>
    </div>
  </div>
);

export default function CreatorEnrollmentWizard({
  tier: initialTier,
  onClose,
  onSubmitted,
}: CreatorEnrollmentWizardProps) {
  const i18n = useI18n();
  const pr = i18n.profile;

  // Step 0 is the tier-selection step. If a tier is pre-selected by the caller,
  // we skip straight to step 1 (guidelines). Otherwise the wizard opens on step 0.
  const [selectedTier, setSelectedTier] = useState<TierId>(initialTier ?? "ice");
  const t = TIER_CONFIG[selectedTier];
  const [step, setStep] = useState<number>(initialTier ? 1 : 0);
  // Steps: 0=tier pick, 1=guidelines, 2=terms, 3=payment, 4=identity, 5=signature, 6=review
  const TOTAL_STEPS = 7; // 0 through 6 — tier step is always step 0, shown as "Step 1 of 7"

  // Step 1 state (guidelines)
  const [guideTab, setGuideTab] = useState<"profile" | "channel">("profile");
  const [guidelinesRead, setGuidelinesRead] = useState(false);

  // Step 2 state (terms)
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [commitmentAccepted, setCommitmentAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Step 3 state (payment)
  // Dash via BTCPay is the canonical crypto payout path post-Daimo retirement
  // (2026-04-21). Meru is the fiat off-ramp. usdc/usdt remain UI options for
  // creators who already set them up before the migration; new creators are
  // nudged to Dash by ordering it first.
  const [paymentMethod, setPaymentMethod] = useState<"dash" | "meru" | "usdc" | "usdt">("dash");
  const [paymentAddress, setPaymentAddress] = useState("");
  const [paymentNetwork, setPaymentNetwork] = useState("dash");

  // Step 4 state (ID + 2257 fields + signature)
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [idLegalName, setIdLegalName] = useState("");
  const [idDob, setIdDob] = useState("");
  const [idType, setIdType] = useState("");
  const [signatureData, setSignatureData] = useState("");

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setSubmitError('Only JPEG, PNG, or WebP images are accepted for ID.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setSubmitError('ID photo must be under 10 MB.');
      return;
    }
    setSubmitError(null);
    setIdFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setIdPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!idFile) { setSubmitError(pr.idDocumentRequired); return; }
    if (!idLegalName.trim()) { setSubmitError(pr.legalNameRequired); return; }
    if (!idDob) { setSubmitError(pr.dobRequired); return; }
    if (!idType) { setSubmitError(pr.idTypeRequired); return; }
    if (!signatureData) { setSubmitError(pr.signatureRequired); return; }
    if (!paymentAddress.trim()) { setSubmitError(pr.paymentAddressRequired); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitCreatorEnrollment({
        tier: selectedTier,
        paymentMethod,
        paymentAddress,
        paymentNetwork,
        signatureData,
        idDocument: idFile,
        legalName: idLegalName.trim(),
        dateOfBirth: idDob,
        idType,
      });
      onSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : pr.submissionFailed);
    } finally {
      setSubmitting(false);
    }
  };

  // step 0 = tier select (always can proceed once a tier is visually picked)
  const canProceedStep0 = true; // selectedTier always has a value
  const canProceedStep1 = guidelinesRead;
  const canProceedStep2 = termsAccepted && commitmentAccepted && privacyAccepted;
  const paymentMinLength = paymentMethod === 'meru' ? 7 : 26;
  const canProceedStep3 = paymentAddress.trim().length >= paymentMinLength;
  const canProceedStep4 = !!idFile && idLegalName.trim().length >= 1 && idDob.length > 0 && idType.length > 0;
  const canProceedStep5 = !!signatureData;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl flex flex-col"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: `1px solid rgba(${t.rgb},0.25)`, maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{t.emoji}</span>
            <div>
              <p className="text-sm font-semibold text-white">{t.name} {pr.enrollment}</p>
              <p className="text-xs" style={{ color: t.color }}>{pr.stepOf} {step + 1} {pr.of} {TOTAL_STEPS}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%`, background: t.gradient }}
            />
          </div>
        </div>

        {/* Body — scrollable (touch-action:none on step 5 prevents Android Chrome scroll container from swallowing canvas pointer events) */}
        <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-4" style={step === 5 ? { touchAction: "none" } : undefined}>

          {/* Step 0: Tier Selection */}
          {step === 0 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">Choose Your Creator Tier</p>
              <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                Your tier sets your monthly subscription price. You can upgrade automatically as your subscriber count grows — no action needed.
              </p>

              <div className="space-y-3">
                {CREATOR_TIERS.map((tier) => {
                  const cfg = TIER_CONFIG[tier.id];
                  const upgradeInfo = TIER_UPGRADE_THRESHOLDS[tier.id];
                  const isSelected = selectedTier === tier.id;
                  return (
                    <button
                      key={tier.id}
                      onClick={() => setSelectedTier(tier.id)}
                      className="w-full rounded-xl p-4 text-left transition-all"
                      style={isSelected
                        ? { background: `rgba(${cfg.rgb},0.12)`, border: `2px solid rgba(${cfg.rgb},0.5)` }
                        : { background: "rgba(255,255,255,0.04)", border: "2px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                          style={{ background: cfg.gradient }}
                        >
                          {cfg.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-white">{cfg.name}</p>
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: `rgba(${cfg.rgb},0.15)`, color: cfg.color }}
                            >
                              ${tier.price}/mo
                            </span>
                          </div>
                          <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                            {upgradeInfo.nextTier
                              ? `Auto-upgrades to ${TIER_CONFIG[upgradeInfo.nextTier].name} at ${upgradeInfo.subscribersNeeded} subscribers`
                              : "Top tier — maximum earning potential"}
                          </p>
                        </div>
                        <div
                          className="w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
                          style={isSelected
                            ? { borderColor: cfg.color, background: cfg.gradient }
                            : { borderColor: "rgba(255,255,255,0.2)", background: "transparent" }
                          }
                        >
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div
                className="rounded-xl p-3 text-xs leading-relaxed"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--pnp-text-secondary, #8E8E93)" }}
              >
                <strong className="text-white">Not sure which to pick?</strong> Start with Ice ($5/mo) — the easiest entry point for new subscribers. You will automatically move to Crystal at 10 subscribers and Diamond at 25 subscribers without losing any existing memberships.
              </div>

              <div
                className="rounded-xl p-3 text-xs leading-relaxed"
                style={{ background: `rgba(${t.rgb},0.06)`, border: `1px solid rgba(${t.rgb},0.2)`, color: "var(--pnp-text-secondary, #8E8E93)" }}
              >
                <strong style={{ color: t.color }}>Your earnings at {t.name}:</strong>{" "}
                You keep 70% of ${CREATOR_TIERS.find(x => x.id === selectedTier)?.price ?? 5}/mo per subscriber — ${((CREATOR_TIERS.find(x => x.id === selectedTier)?.price ?? 5) * 0.7).toFixed(2)}/subscriber/month.
              </div>
            </>
          )}

          {/* Step 1: Creator Guidelines (mandatory read) */}
          {step === 1 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">PNPtv! Creator Guidelines</p>
              <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                Read both sections before continuing. These guidelines apply from your first day as a creator.
              </p>

              {/* Profile / Channel tab toggle */}
              <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                {(["profile", "channel"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setGuideTab(tab)}
                    className="flex-1 py-2 text-xs font-semibold transition-colors"
                    style={guideTab === tab
                      ? { background: t.gradient, color: "#fff" }
                      : { background: "rgba(255,255,255,0.03)", color: "var(--pnp-text-secondary, #8E8E93)" }
                    }
                  >
                    {tab === "profile" ? "Profile Guidelines" : "Channel Guidelines"}
                  </button>
                ))}
              </div>

              {guideTab === "profile" ? PROFILE_GUIDE : CHANNEL_GUIDE}

              <label className="flex items-start gap-3 cursor-pointer pt-2">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: guidelinesRead ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setGuidelinesRead((v) => !v)}
                >
                  {guidelinesRead && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: guidelinesRead ? "#fff" : "#8E8E93" }}>
                  I have read and understood the <strong>PNPtv! Profile Guidelines</strong> and the <strong>PNPtv! Channel Guidelines</strong>.
                </span>
              </label>
            </>
          )}

          {/* Step 2: Terms & Commitment */}
          {step === 2 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.termsAndConditions}</p>

              <div className="space-y-3 text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white">{pr.programTerms}</p>
                  <p>{pr.programTermsBody}</p>
                  <p>{pr.programTermsBody2}</p>
                  <p>{pr.programTermsBody3}</p>
                </div>

                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white">{pr.contentRequirements}</p>
                  <p>{pr.contentReqBody}</p>
                  <ul className="list-disc list-inside space-y-0.5 mt-1">
                    <li>{pr.contentReqItem1}</li>
                    <li>{pr.contentReqItem2}</li>
                    <li>{pr.contentReqItem3}</li>
                    <li>{pr.contentReqItem4}</li>
                  </ul>
                  <p className="mt-1">{pr.contentReqDisclaimer}</p>
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: termsAccepted ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setTermsAccepted((v) => !v)}
                >
                  {termsAccepted && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: termsAccepted ? "#fff" : "#8E8E93" }}>
                  {pr.agreeToTerms} <strong>{pr.creatorProgramTerms}</strong> {pr.and} <strong>{pr.payoutTerms}</strong>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: commitmentAccepted ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setCommitmentAccepted((v) => !v)}
                >
                  {commitmentAccepted && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: commitmentAccepted ? "#fff" : "#8E8E93" }}>
                  {pr.understandCommitment} <strong>{pr.contentRequirementsLabel}</strong>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: privacyAccepted ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setPrivacyAccepted((v) => !v)}
                >
                  {privacyAccepted && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: privacyAccepted ? "#fff" : "#8E8E93" }}>
                  {pr.agreeToPrivacyPolicy}{" "}
                  <a href="https://pnptv.app/privacy" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: t.color }}>
                    {pr.privacyPolicyLabel}
                  </a>
                </span>
              </label>
            </>
          )}

          {/* Step 3: Payment Setup */}
          {step === 3 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.paymentSetup}</p>

              <div className="rounded-xl p-3 text-xs space-y-1.5" style={{ background: `rgba(${t.rgb},0.08)`, border: `1px solid rgba(${t.rgb},0.2)` }}>
                <p className="font-semibold text-white">{pr.payoutTermsTitle}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.youReceive70}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.payoutsEveryTuesday}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.minimumPayout}</p>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.selectPaymentMethod}</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: "dash" as const, label: "Dash", icon: "💎" },
                    { id: "meru" as const, label: pr.meruApp, icon: "💳" },
                    { id: "usdc" as const, label: "USDC", icon: "🔵" },
                    { id: "usdt" as const, label: "USDT", icon: "🟢" },
                  ]).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        if (m.id === paymentMethod) return;
                        // Only wipe the address when switching FROM a format that
                        // can't possibly match the new one (crypto ↔ meru). Within
                        // the crypto family the user might be correcting a typo.
                        const switchingFamily =
                          (paymentMethod === "meru") !== (m.id === "meru");
                        if (switchingFamily) setPaymentAddress("");
                        setPaymentMethod(m.id);
                        if (m.id === "dash") setPaymentNetwork("dash");
                        else if (m.id === "usdt") setPaymentNetwork("tron");
                        else if (m.id === "usdc") setPaymentNetwork("base");
                        else setPaymentNetwork("");
                      }}
                      className="py-3 rounded-xl text-center transition-all"
                      style={paymentMethod === m.id
                        ? { background: `rgba(${t.rgb},0.15)`, border: `2px solid rgba(${t.rgb},0.5)` }
                        : { background: "rgba(255,255,255,0.04)", border: "2px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      <p className="text-lg mb-0.5">{m.icon}</p>
                      <p className="text-xs font-semibold" style={{ color: paymentMethod === m.id ? t.color : "var(--pnp-text-secondary, #8E8E93)" }}>{m.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {(paymentMethod === "usdc" || paymentMethod === "usdt") && (
                <div>
                  <p className="text-xs font-medium mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.network}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(paymentMethod === "usdc"
                      ? [{ id: "base", label: "Base" }, { id: "ethereum", label: "Ethereum" }]
                      : [{ id: "tron", label: "Tron (TRC-20)" }, { id: "ethereum", label: "Ethereum (ERC-20)" }]
                    ).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setPaymentNetwork(n.id)}
                        className="py-2 rounded-lg text-xs font-medium transition-colors border"
                        style={paymentNetwork === n.id
                          ? { background: `rgba(${t.rgb},0.12)`, color: t.color, borderColor: `rgba(${t.rgb},0.3)` }
                          : { background: "rgba(255,255,255,0.04)", color: "var(--pnp-text-secondary, #8E8E93)", borderColor: "rgba(255,255,255,0.08)" }
                        }
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {paymentMethod === "meru" ? pr.meruAccountOrPhone : pr.walletAddress}
                </label>
                <input
                  type="text"
                  value={paymentAddress}
                  onChange={(e) => setPaymentAddress(e.target.value)}
                  placeholder={paymentMethod === "meru" ? pr.meruPlaceholder : pr.walletPlaceholder}
                  className="w-full rounded-lg px-3 py-2.5 text-white outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
                  autoComplete="off"
                />
                <div className="flex justify-between items-center mt-1.5 text-[10px]" style={{ color: canProceedStep3 ? "#5ED1C4" : "var(--pnp-text-secondary, #8E8E93)" }}>
                  <span>
                    {canProceedStep3
                      ? (i18n.lang === 'es' ? "✓ Listo para continuar" : "✓ Ready to continue")
                      : (i18n.lang === 'es'
                          ? `Mínimo ${paymentMinLength} caracteres`
                          : `Minimum ${paymentMinLength} characters required`)}
                  </span>
                  <span>{paymentAddress.trim().length}/{paymentMinLength}</span>
                </div>
              </div>
            </>
          )}

          {/* Step 4: Identity Verification */}
          {step === 4 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.identityVerification}</p>

              <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-semibold text-white mb-1">{pr.whyWeNeedThis}</p>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.idVerificationExplanation}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.idLegalFullName} <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={idLegalName}
                  onChange={(e) => setIdLegalName(e.target.value)}
                  placeholder="e.g. John Michael Smith"
                  className="w-full rounded-lg px-3 py-2.5 text-white outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
                  autoComplete="name"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {pr.idDateOfBirth} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={idDob}
                    onChange={(e) => setIdDob(e.target.value)}
                    max={new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().split("T")[0]}
                    className="w-full rounded-lg px-3 py-2.5 text-white outline-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px", colorScheme: "dark" }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {pr.idTypeLabel} <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={idType}
                    onChange={(e) => setIdType(e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-white outline-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
                  >
                    <option value="" disabled>{pr.idTypePlaceholder}</option>
                    <option value="passport">Passport</option>
                    <option value="drivers_license">Driver's License</option>
                    <option value="national_id">National ID</option>
                    <option value="state_id">State / Province ID</option>
                    <option value="other">Other Gov. ID</option>
                  </select>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.governmentIdFront} <span className="text-red-400">*</span>
                </p>
                {idPreview ? (
                  <div className="relative">
                    <img
                      src={idPreview}
                      alt="ID preview"
                      className="w-full rounded-xl object-cover"
                      style={{ maxHeight: 140, border: `1px solid rgba(${t.rgb},0.3)` }}
                    />
                    <button
                      onClick={() => { setIdFile(null); setIdPreview(null); }}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                      style={{ background: "rgba(0,0,0,0.6)" }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center gap-2 rounded-xl py-6 cursor-pointer transition-colors"
                    style={{ border: `1px dashed rgba(${t.rgb},0.35)`, background: `rgba(${t.rgb},0.04)` }}
                  >
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: t.color }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" />
                    </svg>
                    <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{pr.tapToUploadId}</p>
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleIdUpload} />
                  </label>
                )}
              </div>

            </>
          )}

          {/* Step 5: Digital Signature */}
          {step === 5 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">
                {pr.digitalSignature}
              </p>

              <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {i18n.lang === 'es'
                    ? 'Tu firma confirma que has leído y aceptas los Términos del Programa de Creadores y que toda la información proporcionada en esta solicitud es veraz y precisa.'
                    : 'Your signature confirms that you have read and agree to the Creator Program Terms and that all information provided in this application is truthful and accurate.'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {pr.digitalSignature} <span className="text-red-400">*</span>
                </p>
                <SignaturePad
                  onSave={setSignatureData}
                  width={320}
                  height={180}
                />
              </div>
            </>
          )}

          {/* Step 6: Review & Submit */}
          {step === 6 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.reviewAndSubmit}</p>

              <div className="space-y-2 text-xs">
                <div className="rounded-xl p-3" style={{ background: `rgba(${t.rgb},0.08)`, border: `1px solid rgba(${t.rgb},0.2)` }}>
                  <p className="font-semibold text-white mb-2">{t.emoji} {t.name}</p>
                  <div className="space-y-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    <div className="flex justify-between">
                      <span>{pr.subscriptionPrice}</span>
                      <span className="text-white font-medium">${t.price}/mo</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{pr.yourEarnings}</span>
                      <span className="text-white font-medium">70% · ~${(t.price * 0.7).toFixed(2)}/subscriber</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{pr.payoutDay}</span>
                      <span className="text-white font-medium">{pr.payoutDayValue}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white mb-2">{pr.paymentDetails}</p>
                  <div className="space-y-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    <div className="flex justify-between">
                      <span>{pr.method}</span>
                      <span className="text-white font-medium capitalize">{paymentMethod}</span>
                    </div>
                    {paymentNetwork && paymentMethod !== "meru" && (
                      <div className="flex justify-between">
                        <span>{pr.network}</span>
                        <span className="text-white font-medium capitalize">{paymentNetwork}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>{pr.address}</span>
                      <span className="text-white font-medium truncate ml-4" style={{ maxWidth: 160 }}>{paymentAddress}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{pr.idVerificationProvided}</p>
                    <span className="text-xs" style={{ color: "#4ADE80" }}>{pr.idProvided}</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {pr.idCapturedNote}
                  </p>
                </div>
              </div>

              <p className="text-xs text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                {pr.reviewNote}
              </p>

              {submitError && (
                <p className="text-xs text-center" style={{ color: "#FF453A" }}>{submitError}</p>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 pb-5 pt-3 flex-shrink-0 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {/* TOTAL_STEPS is 7 (steps 0–6); final submit happens at step 6 */}
          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 0 && !canProceedStep0) ||
                (step === 1 && !canProceedStep1) ||
                (step === 2 && !canProceedStep2) ||
                (step === 3 && !canProceedStep3) ||
                (step === 4 && !canProceedStep4) ||
                (step === 5 && !canProceedStep5)
              }
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: t.gradient }}
            >
              {step === 0 ? `Continue with ${t.name} ($${CREATOR_TIERS.find(x => x.id === selectedTier)?.price ?? 5}/mo)` : pr.continue}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ background: t.gradient }}
            >
              {submitting ? pr.submitting : pr.submitEnrollment}
            </button>
          )}
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="w-full py-2 text-xs text-center"
              style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
            >
              {pr.backStep}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
