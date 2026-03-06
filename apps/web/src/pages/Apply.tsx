import React, { useState, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Button, Card, Input } from "@pnptv/ui-kit";
import { useI18n } from "@/lib/i18n";
import {
  getApplicationStatus,
  uploadApplicationProfilePhoto,
  uploadApplicationIdDocuments,
  submitModelApplication,
  markCallScheduled,
  type ModelApplication,
  type ModelApplicationPayload,
} from "@/lib/api";

type AppType = "live" | "content_creator" | "both";

interface WizardData {
  applicationType: AppType | "";
  stageName: string;
  bio: string;
  instagramHandle: string;
  twitterHandle: string;
  onlyfansUrl: string;
  profilePhotoUrl: string;
  profilePhotoFile: File | null;
  legalFullName: string;
  dateOfBirth: string;
  country: string;
  cityState: string;
  idFrontUrl: string;
  idBackUrl: string;
  idFrontFile: File | null;
  idBackFile: File | null;
  termsAgreed: boolean;
}

const INITIAL_DATA: WizardData = {
  applicationType: "",
  stageName: "",
  bio: "",
  instagramHandle: "",
  twitterHandle: "",
  onlyfansUrl: "",
  profilePhotoUrl: "",
  profilePhotoFile: null,
  legalFullName: "",
  dateOfBirth: "",
  country: "",
  cityState: "",
  idFrontUrl: "",
  idBackUrl: "",
  idFrontFile: null,
  idBackFile: null,
  termsAgreed: false,
};

const CAL_EMBED_URL = "https://booking.pnptv.app/santino/model-interview?embed=true";
const CAL_LINK_URL = "https://booking.pnptv.app/santino/model-interview";

function ProgressBar({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {labels.map((label, i) => {
          const stepNum = i + 1;
          const isActive = stepNum === step;
          const isDone = stepNum < step;
          return (
            <div key={label} className="flex flex-col items-center flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  isDone
                    ? "bg-pnp-accent border-pnp-accent text-white"
                    : isActive
                      ? "border-pnp-accent text-pnp-accent bg-pnp-surface"
                      : "border-pnp-border text-pnp-textSecondary bg-pnp-surface"
                }`}
              >
                {isDone ? "\u2713" : stepNum}
              </div>
              <span
                className={`text-[10px] mt-1 text-center hidden sm:block ${
                  isActive ? "text-pnp-accent font-semibold" : "text-pnp-textSecondary"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="h-1 bg-pnp-border rounded-full overflow-hidden">
        <div
          className="h-full bg-pnp-accent rounded-full transition-all duration-300"
          style={{ width: `${((step - 1) / (labels.length - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

function FileUploadBox({
  label,
  file,
  previewUrl,
  onSelect,
  accept = "image/*",
}: {
  label: string;
  file: File | null;
  previewUrl?: string;
  onSelect: (f: File) => void;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : previewUrl || null;

  return (
    <div
      className="border-2 border-dashed border-pnp-border rounded-lg p-4 text-center cursor-pointer hover:border-pnp-accent/50 transition-colors"
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
        }}
      />
      {preview ? (
        <img
          src={preview}
          alt={label}
          className="w-full max-h-48 object-contain rounded-lg mx-auto mb-2"
        />
      ) : (
        <div className="py-6">
          <svg className="w-10 h-10 mx-auto text-pnp-textSecondary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16v-8m0 0l-3 3m3-3l3 3M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
          <p className="text-sm text-pnp-textSecondary">{label}</p>
        </div>
      )}
      {file && (
        <p className="text-xs text-pnp-textSecondary truncate">{file.name}</p>
      )}
    </div>
  );
}

// Existing application status card
function StatusCard({ app }: { app: ModelApplication }) {
  const { apply: t } = useI18n();

  const statusColors: Record<string, string> = {
    pending: "text-yellow-400",
    approved: "text-green-400",
    rejected: "text-red-400",
    withdrawn: "text-pnp-textSecondary",
  };

  const statusLabels: Record<string, string> = {
    pending: t.statusPending,
    approved: t.statusApproved,
    rejected: t.statusRejected,
    withdrawn: t.statusWithdrawn,
  };

  return (
    <div className="max-w-lg mx-auto">
      <Card className="text-center">
        <h2 className="text-xl font-bold text-pnp-textPrimary mb-4">
          {t.existingApplicationTitle}
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">{t.stageNameFieldLabel}</span>
            <span className="text-pnp-textPrimary font-medium">{app.stage_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">{t.typeLabel}</span>
            <span className="text-pnp-textPrimary">
              {app.application_type === "both"
                ? t.typeLabelBoth
                : app.application_type === "live"
                  ? t.typeLabelLive
                  : t.typeLabelContent}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">{t.statusLabel}</span>
            <span className={`font-semibold ${statusColors[app.status] || ""}`}>
              {statusLabels[app.status] || app.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">{t.submittedLabel}</span>
            <span className="text-pnp-textPrimary">
              {new Date(app.created_at).toLocaleDateString()}
            </span>
          </div>
          {app.call_scheduled && (
            <div className="flex justify-between">
              <span className="text-pnp-textSecondary">{t.callScheduledLabel}</span>
              <span className="text-green-400">{t.callScheduledYes}</span>
            </div>
          )}
        </div>
        {app.status === "pending" && (
          <p className="mt-4 text-xs text-pnp-textSecondary">
            {t.pendingNote}
          </p>
        )}
        {app.status === "approved" && (
          <p className="mt-4 text-xs text-green-400">
            {t.approvedNote}
          </p>
        )}
      </Card>
    </div>
  );
}

export default function Apply() {
  const navigate = useNavigate();
  const { apply: t } = useI18n();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingApp, setExistingApp] = useState<ModelApplication | null>(null);
  const [appId, setAppId] = useState<string | null>(null);

  const STEPS = [
    t.stepChooseType,
    t.stepBasicInfo,
    t.stepLegalInfo,
    t.stepAgreement,
    t.stepScheduleCall,
    t.stepConfirmation,
  ];

  // Check for existing application on mount
  useEffect(() => {
    getApplicationStatus()
      .then((res) => {
        if (res.hasApplication && res.application) {
          setExistingApp(res.application);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (fields: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...fields }));
    setError(null);
  };

  const goNext = () => setStep((s) => Math.min(s + 1, 6));
  const goBack = () => {
    setStep((s) => Math.max(s - 1, 1));
    setError(null);
  };

  // Step 2: upload profile photo on continue
  async function handleStep2Continue() {
    if (!data.stageName.trim()) {
      setError(t.errorStageName);
      return;
    }
    if (data.profilePhotoFile) {
      setSubmitting(true);
      try {
        const res = await uploadApplicationProfilePhoto(data.profilePhotoFile);
        update({ profilePhotoUrl: res.photoUrl, profilePhotoFile: null });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t.errorPhotoUpload);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    }
    goNext();
  }

  // Step 3: upload ID documents on continue
  async function handleStep3Continue() {
    if (!data.legalFullName.trim()) { setError(t.errorLegalName); return; }
    if (!data.dateOfBirth) { setError(t.errorDob); return; }
    if (!data.country.trim()) { setError(t.errorCountry); return; }
    if (!data.cityState.trim()) { setError(t.errorCityState); return; }

    // Validate age
    const dob = new Date(data.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 18) { setError(t.errorAge); return; }

    if (!data.idFrontFile && !data.idFrontUrl) { setError(t.errorIdFront); return; }
    if (!data.idBackFile && !data.idBackUrl) { setError(t.errorIdBack); return; }

    if (data.idFrontFile && data.idBackFile) {
      setSubmitting(true);
      try {
        const res = await uploadApplicationIdDocuments(data.idFrontFile, data.idBackFile);
        update({ idFrontUrl: res.idFrontUrl, idBackUrl: res.idBackUrl, idFrontFile: null, idBackFile: null });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t.errorIdUpload);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    }
    goNext();
  }

  // Step 4: submit application
  async function handleSubmit() {
    if (!data.termsAgreed) {
      setError(t.errorTerms);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: ModelApplicationPayload = {
        applicationType: data.applicationType as AppType,
        stageName: data.stageName,
        bio: data.bio || undefined,
        instagramHandle: data.instagramHandle || undefined,
        twitterHandle: data.twitterHandle || undefined,
        onlyfansUrl: data.onlyfansUrl || undefined,
        profilePhotoUrl: data.profilePhotoUrl || undefined,
        legalFullName: data.legalFullName,
        dateOfBirth: data.dateOfBirth,
        country: data.country,
        cityState: data.cityState,
        idFrontUrl: data.idFrontUrl,
        idBackUrl: data.idBackUrl,
        termsAgreed: true,
      };
      const res = await submitModelApplication(payload);
      setAppId(res.application.id);
      goNext();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.errorSubmit);
    } finally {
      setSubmitting(false);
    }
  }

  // Step 5: mark call scheduled
  async function handleMarkScheduled() {
    setSubmitting(true);
    try {
      await markCallScheduled(appId || undefined);
      goNext();
    } catch {
      // Still allow proceeding
      goNext();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-pnp-surface rounded w-1/3" />
          <div className="h-2 bg-pnp-surface rounded" />
          <div className="h-40 bg-pnp-surface rounded-xl" />
        </div>
      </div>
    );
  }

  if (existingApp) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-6">
          {t.pageHeading}
        </h1>
        <StatusCard app={existingApp} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Helmet>
      <h1 className="text-2xl font-bold text-pnp-textPrimary mb-2">
        {t.pageHeading}
      </h1>
      <p className="text-sm text-pnp-textSecondary mb-6">
        {t.pageSubtitle}
      </p>

      <ProgressBar step={step} labels={STEPS} />

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-pnp-error/10 border border-pnp-error/30 text-pnp-error text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Choose Type */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            {t.step1Heading}
          </h2>
          <div className="grid gap-3">
            {([
              { value: "live" as AppType, title: t.typeLiveTitle, desc: t.typeLiveDesc },
              { value: "content_creator" as AppType, title: t.typeCreatorTitle, desc: t.typeCreatorDesc },
              { value: "both" as AppType, title: t.typeBothTitle, desc: t.typeBothDesc },
            ]).map((opt) => (
              <Card
                key={opt.value}
                hover
                onClick={() => update({ applicationType: opt.value })}
                className={`${data.applicationType === opt.value ? "!border-pnp-accent bg-pnp-accent/5" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      data.applicationType === opt.value
                        ? "border-pnp-accent"
                        : "border-pnp-border"
                    }`}
                  >
                    {data.applicationType === opt.value && (
                      <div className="w-2.5 h-2.5 rounded-full bg-pnp-accent" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-pnp-textPrimary">{opt.title}</p>
                    <p className="text-xs text-pnp-textSecondary">{opt.desc}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="flex justify-end pt-4">
            <Button
              onClick={goNext}
              disabled={!data.applicationType}
            >
              {t.continueBtn}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Basic Info */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            {t.step2Heading}
          </h2>
          <Input
            label={t.stageNameLabel}
            placeholder={t.stageNamePlaceholder}
            value={data.stageName}
            onChange={(e) => update({ stageName: e.target.value })}
          />
          <div className="space-y-1">
            <label className="block text-sm text-pnp-textSecondary">{t.bioLabel}</label>
            <textarea
              className="w-full rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2 text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent focus:border-transparent transition-colors min-h-[80px] resize-y"
              placeholder={t.bioPLaceholder}
              value={data.bio}
              onChange={(e) => update({ bio: e.target.value })}
            />
          </div>
          <Input
            label={t.instagramLabel}
            placeholder={t.handlePlaceholder}
            value={data.instagramHandle}
            onChange={(e) => update({ instagramHandle: e.target.value })}
          />
          <Input
            label={t.twitterLabel}
            placeholder={t.handlePlaceholder}
            value={data.twitterHandle}
            onChange={(e) => update({ twitterHandle: e.target.value })}
          />
          <Input
            label={t.onlyfansLabel}
            placeholder={t.onlyfansPlaceholder}
            value={data.onlyfansUrl}
            onChange={(e) => update({ onlyfansUrl: e.target.value })}
          />
          <div>
            <label className="block text-sm text-pnp-textSecondary mb-1">{t.profilePhotoLabel}</label>
            <FileUploadBox
              label={t.profilePhotoUploadLabel}
              file={data.profilePhotoFile}
              previewUrl={data.profilePhotoUrl}
              onSelect={(f) => update({ profilePhotoFile: f })}
            />
          </div>
          <div className="flex justify-between pt-4">
            <Button variant="secondary" onClick={goBack}>
              {t.backBtn}
            </Button>
            <Button onClick={handleStep2Continue} loading={submitting}>
              {t.continueBtn}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Legal Info (2257 Compliance) */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            {t.step3Heading}
          </h2>
          <p className="text-xs text-pnp-textSecondary">
            {t.legalDisclaimer}
          </p>
          <Input
            label={t.legalNameLabel}
            placeholder={t.legalNamePlaceholder}
            value={data.legalFullName}
            onChange={(e) => update({ legalFullName: e.target.value })}
          />
          <Input
            label={t.dobLabel}
            type="date"
            value={data.dateOfBirth}
            onChange={(e) => update({ dateOfBirth: e.target.value })}
          />
          <Input
            label={t.countryLabel}
            placeholder={t.countryPlaceholder}
            value={data.country}
            onChange={(e) => update({ country: e.target.value })}
          />
          <Input
            label={t.cityStateLabel}
            placeholder={t.cityStatePlaceholder}
            value={data.cityState}
            onChange={(e) => update({ cityState: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-pnp-textSecondary mb-1">{t.idFrontLabel}</label>
              <FileUploadBox
                label={t.idFrontUploadLabel}
                file={data.idFrontFile}
                previewUrl={data.idFrontUrl}
                onSelect={(f) => update({ idFrontFile: f })}
              />
            </div>
            <div>
              <label className="block text-sm text-pnp-textSecondary mb-1">{t.idBackLabel}</label>
              <FileUploadBox
                label={t.idBackUploadLabel}
                file={data.idBackFile}
                previewUrl={data.idBackUrl}
                onSelect={(f) => update({ idBackFile: f })}
              />
            </div>
          </div>
          <div className="flex justify-between pt-4">
            <Button variant="secondary" onClick={goBack}>
              {t.backBtn}
            </Button>
            <Button onClick={handleStep3Continue} loading={submitting}>
              {t.continueBtn}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Agreement */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            {t.step4Heading}
          </h2>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-pnp-background border border-pnp-border p-4 text-xs text-pnp-textSecondary space-y-3 leading-relaxed">
            <p className="font-semibold text-pnp-textPrimary text-sm">{t.agreementTitle}</p>

            <p><strong>{t.agreementSection1Title}</strong> {t.agreementSection1}</p>

            <p><strong>{t.agreementSection2Title}</strong> {t.agreementSection2}</p>

            <p><strong>{t.agreementSection3Title}</strong> {t.agreementSection3}</p>

            <p><strong>{t.agreementSection4Title}</strong> {t.agreementSection4}</p>

            <p><strong>{t.agreementSection5Title}</strong> {t.agreementSection5}</p>

            <p><strong>{t.agreementSection6Title}</strong> {t.agreementSection6}</p>

            <p><strong>{t.agreementSection7Title}</strong> {t.agreementSection7}</p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.termsAgreed}
              onChange={(e) => update({ termsAgreed: e.target.checked })}
              className="mt-1 w-4 h-4 rounded border-pnp-border text-pnp-accent focus:ring-pnp-accent bg-pnp-surface"
            />
            <span className="text-sm text-pnp-textPrimary">
              {t.termsCheckboxLabel}
            </span>
          </label>
          <div className="flex justify-between pt-4">
            <Button variant="secondary" onClick={goBack}>
              {t.backBtn}
            </Button>
            <Button
              onClick={handleSubmit}
              loading={submitting}
              disabled={!data.termsAgreed}
            >
              {t.submitApplicationBtn}
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Schedule Call */}
      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            {t.step5Heading}
          </h2>
          <p className="text-sm text-pnp-textSecondary">
            {t.step5Subtitle}
          </p>
          <div className="rounded-xl border border-pnp-border overflow-hidden bg-white">
            <iframe
              src={CAL_EMBED_URL}
              className="w-full border-0"
              style={{ minHeight: "600px" }}
              title={t.calendarIframeTitle}
            />
          </div>
          <p className="text-xs text-pnp-textSecondary text-center">
            {t.calendarNotLoading}{" "}
            <a
              href={CAL_LINK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-pnp-accent hover:underline"
            >
              {t.openInNewTab}
            </a>
          </p>
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={goNext}>
              {t.skipForNow}
            </Button>
            <Button onClick={handleMarkScheduled} loading={submitting}>
              {t.scheduledCallBtn}
            </Button>
          </div>
        </div>
      )}

      {/* Step 6: Confirmation */}
      {step === 6 && (
        <div className="text-center space-y-4 py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-pnp-textPrimary">
            {t.applicationSubmittedTitle}
          </h2>
          <p className="text-sm text-pnp-textSecondary max-w-md mx-auto">
            {t.applicationSubmittedBody}
          </p>
          <div className="bg-pnp-surface rounded-lg p-4 text-left max-w-sm mx-auto space-y-2 text-sm">
            <p className="font-semibold text-pnp-textPrimary">{t.whatsNextTitle}</p>
            <ol className="list-decimal list-inside space-y-1 text-pnp-textSecondary">
              <li>{t.whatsNextStep1}</li>
              <li>{t.whatsNextStep2}</li>
              <li>{t.whatsNextStep3}</li>
              <li>{t.whatsNextStep4}</li>
            </ol>
          </div>
          <div className="pt-4">
            <Button onClick={() => navigate("/")}>
              {t.backToHome}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
