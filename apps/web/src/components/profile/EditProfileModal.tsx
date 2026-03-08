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

  const dobMax = new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().split("T")[0];

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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">{p.firstName}</label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={p.firstNamePlaceholder}
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">{p.lastName}</label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
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
            className="w-full rounded-lg border border-pnp-border bg-pnp-bg text-pnp-textPrimary text-sm p-3 resize-none outline-none focus:border-pnp-accent"
            rows={3}
          />
          <span className="text-xs text-pnp-textSecondary float-right">{bio.length}/160</span>
        </div>
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">{p.locationDisplay}</label>
          <Input
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
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
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
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

        {/* City / Country */}
        <div>
          <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
            {p.locationCityCountry}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder={p.cityPlaceholder}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={100}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary/40 focus:outline-none focus:border-pnp-accent"
            />
            <input
              type="text"
              placeholder={p.countryPlaceholder}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              maxLength={100}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary/40 focus:outline-none focus:border-pnp-accent"
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

        {error && <p className="text-xs text-red-400">{error}</p>}
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
