import React, { useState, useEffect } from "react";
import { Button, Modal, Input } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";
import { updateProfile, updatePrivacy, type UserProfile } from "@/lib/api";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  onSaved: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditProfileModal({
  open,
  onClose,
  profile,
  onSaved,
}: EditProfileModalProps) {
  const [username, setUsername] = useState(
    profile.username && profile.username.toUpperCase() !== 'ANONYMOUS' ? profile.username : ""
  );
  const [xHandle, setXHandle] = useState(profile.xHandle || "");
  const [firstName, setFirstName] = useState(profile.firstName || "");
  const [lastName, setLastName] = useState(profile.lastName || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [locationText, setLocationText] = useState(profile.locationText || "");
  const [dob, setDob] = useState<string>(profile.dateOfBirth || "");
  const [city, setCity] = useState<string>(profile.city || "");
  const [country, setCountry] = useState<string>(profile.country || "");
  const [privacy, setPrivacy] = useState<Record<string, boolean>>({
    showDob: true,
    showLocation: true,
    showBio: true,
    showInterests: true,
    allowMessages: true,
    showOnline: true,
    ...(profile.privacy || {}),
  });
  const t = useI18n();
  const p = t.profile;
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUsername(profile.username && profile.username.toUpperCase() !== 'ANONYMOUS' ? profile.username : "");
    setXHandle(profile.xHandle || "");
    setFirstName(profile.firstName || "");
    setLastName(profile.lastName || "");
    setBio(profile.bio || "");
    setLocationText(profile.locationText || "");
    setDob(profile.dateOfBirth || "");
    setCity(profile.city || "");
    setCountry(profile.country || "");
    setPrivacy({
      showDob: true,
      showLocation: true,
      showBio: true,
      showInterests: true,
      allowMessages: true,
      showOnline: true,
      ...(profile.privacy || {}),
    });
  }, [profile]);

  const handlePrivacyToggle = async (key: string) => {
    const newVal = !privacy[key];
    const optimistic = { ...privacy, [key]: newVal };
    setPrivacy(optimistic);
    setSavingPrivacy(true);
    try {
      await updatePrivacy({ [key]: newVal });
    } catch {
      setPrivacy(privacy);
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Parameters<typeof updateProfile>[0] = { firstName, lastName, bio, locationText };
      // Only send username when the user is setting it for the first time.
      // If they already have a real (non-ANONYMOUS) username, the field is read-only
      // and resending it would trip the backend's "username cannot be changed" guard.
      const hasRealUsername = !!profile.username && profile.username.toUpperCase() !== 'ANONYMOUS';
      if (!hasRealUsername && username.trim()) payload.username = username.trim();
      payload.xHandle = xHandle.trim().replace(/^@/, "") || "";
      if (dob) payload.dateOfBirth = dob;
      if (city.trim()) payload.city = city.trim();
      if (country.trim()) payload.country = country.trim();
      await updateProfile(payload);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : p.failedToSave);
    } finally {
      setSaving(false);
    }
  };

  // Compute exactly 18 years ago using local calendar date (avoids UTC off-by-one)
  const _today = new Date();
  const dobMax = `${_today.getFullYear() - 18}-${String(_today.getMonth() + 1).padStart(2, "0")}-${String(_today.getDate()).padStart(2, "0")}`;

  return (
    <Modal open={open} onClose={onClose} title={p.editProfileTitle}>
      <div className="space-y-4">
        {/* Profile Incomplete nudge */}
        {(!profile.dateOfBirth || !profile.city) && (
          <div className="rounded-xl p-3 bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-2">
            <span className="text-yellow-400 text-lg leading-none mt-0.5" aria-hidden="true">!</span>
            <div>
              <p className="text-sm font-medium text-yellow-300">{p.completeYourProfile}</p>
              <p className="text-xs text-yellow-400/80">{p.completeProfileDesc}</p>
            </div>
          </div>
        )}

        {/* ── Username ──────────────────────────────────────────────────── */}
        {profile.username && profile.username.toUpperCase() !== 'ANONYMOUS' ? (
          /* Already has a real username — read-only */
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Username</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-pnp-textSecondary select-none">@</span>
              <input
                type="text"
                value={profile.username}
                readOnly
                className="w-full rounded-lg border border-white/10 bg-white/5 text-pnp-textSecondary text-sm pl-7 pr-3 py-2 outline-none cursor-not-allowed opacity-60"
              />
            </div>
            <p className="text-[10px] text-pnp-textSecondary/50 mt-1">Username cannot be changed once set.</p>
          </div>
        ) : (
          /* No username yet — show big warning + manual set option */
          <div className="rounded-xl border-2 border-yellow-400/50 bg-yellow-400/8 p-4 space-y-3">
            {/* Warning header */}
            <div className="flex items-start gap-2.5">
              <span className="text-2xl leading-none flex-shrink-0 mt-0.5">⚠️</span>
              <div>
                <p className="text-sm font-bold text-yellow-300">You don't have a username yet</p>
                <p className="text-xs text-yellow-200/80 mt-1 leading-relaxed">
                  {profile.hasTelegram
                    ? <>Your Telegram account is linked but <strong>no Telegram username is set</strong>. Go to your Telegram profile settings, set a username there, then re-open this modal — it will be picked up automatically.</>
                    : <>We <strong>strongly recommend linking your Telegram account</strong> to set your username automatically. Without a Telegram-linked username we <strong>cannot guarantee the correct service of all platform features</strong>, including messaging, notifications, and community access.</>
                  }
                </p>
              </div>
            </div>

            {/* How-to instructions */}
            <div
              className="rounded-lg p-3 space-y-1.5"
              style={{ background: "rgba(255,204,0,0.06)", border: "1px solid rgba(255,204,0,0.2)" }}
            >
              {profile.hasTelegram ? (
                <>
                  <p className="text-xs font-semibold text-yellow-300 uppercase tracking-wide">How to set your Telegram username</p>
                  <ol className="text-xs text-yellow-200/80 space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Open <strong>Telegram</strong> and go to <strong>Settings → Edit Profile</strong>.</li>
                    <li>Set a <strong>Username</strong> (e.g. <code className="px-1 py-0.5 rounded text-[11px] bg-black/30">@yourname</code>).</li>
                    <li>Come back here and <strong>re-open Edit Profile</strong> — your username will sync automatically.</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-yellow-300 uppercase tracking-wide">How to link Telegram</p>
                  <ol className="text-xs text-yellow-200/80 space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Make sure you have a <strong>Telegram username</strong> set in your Telegram profile settings.</li>
                    <li>Open the <strong>PNPtv! bot on Telegram</strong> and send <code className="px-1 py-0.5 rounded text-[11px] bg-black/30">/start</code>.</li>
                    <li>Follow the <strong>"Link Account"</strong> option to connect your Telegram identity to this account.</li>
                    <li>Your Telegram username will be set automatically once linked.</li>
                  </ol>
                </>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] uppercase tracking-wider text-pnp-textSecondary/50">or set manually (not recommended)</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Manual username input */}
            <div>
              <label className="block text-xs text-pnp-textSecondary mb-1">
                Username <span className="text-yellow-400/70">(can only be set once)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-pnp-textSecondary select-none">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30))}
                  placeholder="your_username"
                  maxLength={30}
                  className="w-full rounded-lg border border-yellow-400/30 bg-white/10 text-pnp-textPrimary pl-7 pr-3 py-2 outline-none focus:border-yellow-400/60 placeholder:text-white/30"
                style={{ fontSize: "16px" }}
                />
              </div>
              <p className="text-[10px] text-pnp-textSecondary/50 mt-1">Letters, numbers and underscores only · 3–30 characters · cannot be changed later</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">{p.firstName}</label>
            <Input
              value={firstName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e.target.value)}
              placeholder={p.firstNamePlaceholder}
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">{p.lastName}</label>
            <Input
              value={lastName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
              placeholder={p.lastNamePlaceholder}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">{p.bio}</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 160))}
            placeholder={p.bioPlaceholder}
            className="w-full rounded-lg border border-white/20 bg-white/10 text-pnp-textPrimary p-3 resize-none outline-none focus:border-pnp-accent placeholder:text-white/50"
            style={{ fontSize: "16px" }}
            rows={3}
          />
          <span className="text-xs text-pnp-textSecondary float-right">{bio.length}/160</span>
        </div>
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">{p.locationDisplay}</label>
          <Input
            value={locationText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocationText(e.target.value)}
            placeholder={p.locationPlaceholder}
          />
        </div>

        {/* Date of Birth */}
        <div>
          <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
            {p.dateOfBirth} <span className="text-pnp-textSecondary/50">{p.dobRequired}</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={dobMax}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
              style={{ fontSize: "16px" }}
            />
            <button
              type="button"
              onClick={() => handlePrivacyToggle("showDob")}
              disabled={savingPrivacy}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${
                privacy.showDob
                  ? "border-green-500/40 bg-green-500/10 text-green-400"
                  : "border-white/10 bg-white/5 text-pnp-textSecondary"
              }`}
              title={privacy.showDob ? "Visible to others" : "Private"}
              aria-label={privacy.showDob ? p.dobIsPublic : p.dobIsPrivate}
            >
              {privacy.showDob ? p.public : p.private}
            </button>
          </div>
          <p className="text-[10px] text-pnp-textSecondary/60 mt-1">{p.dobPrivacyNote}</p>
        </div>

        {/* Country */}
        <div>
          <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
            {p.countryLabel ?? "Country"}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder={p.countryPlaceholder}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              maxLength={100}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-pnp-textPrimary placeholder-pnp-textSecondary/40 focus:outline-none focus:border-pnp-accent"
              style={{ fontSize: "16px" }}
            />
            <button
              type="button"
              onClick={() => handlePrivacyToggle("showLocation")}
              disabled={savingPrivacy}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${
                privacy.showLocation
                  ? "border-green-500/40 bg-green-500/10 text-green-400"
                  : "border-white/10 bg-white/5 text-pnp-textSecondary"
              }`}
              title={privacy.showLocation ? "Visible to others" : "Private"}
              aria-label={privacy.showLocation ? p.locationIsPublic : p.locationIsPrivate}
            >
              {privacy.showLocation ? p.public : p.private}
            </button>
          </div>
        </div>

        {/* X / Twitter account */}
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">X (Twitter) Account</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-pnp-textSecondary select-none">@</span>
            <input
              type="text"
              value={xHandle}
              onChange={(e) => setXHandle(e.target.value.replace(/^@/, "").replace(/\s/g, "").slice(0, 50))}
              placeholder="your_x_handle"
              maxLength={50}
              className="w-full rounded-lg border border-white/20 bg-white/10 text-pnp-textPrimary pl-7 pr-3 py-2 outline-none focus:border-pnp-accent placeholder:text-white/40"
              style={{ fontSize: "16px" }}
            />
          </div>
          <p className="text-[10px] text-pnp-textSecondary/50 mt-1">Your X handle for cross-posting and profile display</p>
        </div>

        {error && (
          <div role="alert" className="rounded-xl p-3 bg-red-500/10 border border-red-500/40 flex items-start gap-2">
            <span className="text-red-400 text-lg leading-none mt-0.5" aria-hidden="true">⚠</span>
            <p className="text-sm text-red-300 leading-snug whitespace-pre-line">{error}</p>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <Button variant="danger" className="flex-1" onClick={onClose}>
            {p.cancel}
          </Button>
          <button
            onClick={handleSave}
            disabled={saving || !firstName.trim()}
            className="flex-1 btn-gradient px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
          >
            {saving ? p.saving : p.save}
          </button>
        </div>
      </div>
    </Modal>
  );
}
