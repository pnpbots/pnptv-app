import React, { useState, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Button, Card, Input } from "@pnptv/ui-kit";
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

const STEPS = [
  "Choose Type",
  "Basic Info",
  "Legal Info",
  "Agreement",
  "Schedule Call",
  "Confirmation",
];

const CAL_EMBED_URL = "https://booking.pnptv.app/santino/model-interview?embed=true";
const CAL_LINK_URL = "https://booking.pnptv.app/santino/model-interview";

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {STEPS.map((label, i) => {
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
          style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
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
  const statusColors: Record<string, string> = {
    pending: "text-yellow-400",
    approved: "text-green-400",
    rejected: "text-red-400",
    withdrawn: "text-pnp-textSecondary",
  };

  const statusLabels: Record<string, string> = {
    pending: "Under Review",
    approved: "Approved",
    rejected: "Not Approved",
    withdrawn: "Withdrawn",
  };

  return (
    <div className="max-w-lg mx-auto">
      <Card className="text-center">
        <h2 className="text-xl font-bold text-pnp-textPrimary mb-4">
          Your Application
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">Stage Name</span>
            <span className="text-pnp-textPrimary font-medium">{app.stage_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">Type</span>
            <span className="text-pnp-textPrimary">
              {app.application_type === "both"
                ? "Live + Content Creator"
                : app.application_type === "live"
                  ? "Live Performer"
                  : "Content Creator"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">Status</span>
            <span className={`font-semibold ${statusColors[app.status] || ""}`}>
              {statusLabels[app.status] || app.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-pnp-textSecondary">Submitted</span>
            <span className="text-pnp-textPrimary">
              {new Date(app.created_at).toLocaleDateString()}
            </span>
          </div>
          {app.call_scheduled && (
            <div className="flex justify-between">
              <span className="text-pnp-textSecondary">Call Scheduled</span>
              <span className="text-green-400">Yes</span>
            </div>
          )}
        </div>
        {app.status === "pending" && (
          <p className="mt-4 text-xs text-pnp-textSecondary">
            Your application is being reviewed. We'll reach out via Telegram once a decision is made.
          </p>
        )}
        {app.status === "approved" && (
          <p className="mt-4 text-xs text-green-400">
            Congratulations! You've been approved. Check your Telegram for next steps.
          </p>
        )}
      </Card>
    </div>
  );
}

export default function Apply() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingApp, setExistingApp] = useState<ModelApplication | null>(null);
  const [appId, setAppId] = useState<string | null>(null);

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
      setError("Stage name is required");
      return;
    }
    if (data.profilePhotoFile) {
      setSubmitting(true);
      try {
        const res = await uploadApplicationProfilePhoto(data.profilePhotoFile);
        update({ profilePhotoUrl: res.photoUrl, profilePhotoFile: null });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to upload photo");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    }
    goNext();
  }

  // Step 3: upload ID documents on continue
  async function handleStep3Continue() {
    if (!data.legalFullName.trim()) { setError("Legal full name is required"); return; }
    if (!data.dateOfBirth) { setError("Date of birth is required"); return; }
    if (!data.country.trim()) { setError("Country is required"); return; }
    if (!data.cityState.trim()) { setError("City/State is required"); return; }

    // Validate age
    const dob = new Date(data.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 18) { setError("You must be at least 18 years old"); return; }

    if (!data.idFrontFile && !data.idFrontUrl) { setError("ID front photo is required"); return; }
    if (!data.idBackFile && !data.idBackUrl) { setError("ID back photo is required"); return; }

    if (data.idFrontFile && data.idBackFile) {
      setSubmitting(true);
      try {
        const res = await uploadApplicationIdDocuments(data.idFrontFile, data.idBackFile);
        update({ idFrontUrl: res.idFrontUrl, idBackUrl: res.idBackUrl, idFrontFile: null, idBackFile: null });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to upload ID documents");
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
      setError("You must agree to the creator terms");
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
      setError(err instanceof Error ? err.message : "Failed to submit application");
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
          Become a Model
        </h1>
        <StatusCard app={existingApp} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Helmet>
        <title>Become a Creator — PNPtv!</title>
        <meta name="description" content="Apply to become a live performer or content creator on PNPtv. Stream live, upload exclusive content, and earn." />
      </Helmet>
      <h1 className="text-2xl font-bold text-pnp-textPrimary mb-2">
        Become a Model
      </h1>
      <p className="text-sm text-pnp-textSecondary mb-6">
        Apply to become a Live Performer or Content Creator on PNPtv.
      </p>

      <ProgressBar step={step} />

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-pnp-error/10 border border-pnp-error/30 text-pnp-error text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Choose Type */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            What would you like to do?
          </h2>
          <div className="grid gap-3">
            {([
              { value: "live" as AppType, title: "Live Performer", desc: "Stream live shows and interact with viewers in real-time" },
              { value: "content_creator" as AppType, title: "Content Creator", desc: "Upload and sell exclusive photos, videos, and other content" },
              { value: "both" as AppType, title: "Both", desc: "Stream live AND create exclusive content" },
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
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Basic Info */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            Your Stage Identity
          </h2>
          <Input
            label="Stage Name *"
            placeholder="Your performer name"
            value={data.stageName}
            onChange={(e) => update({ stageName: e.target.value })}
          />
          <div className="space-y-1">
            <label className="block text-sm text-pnp-textSecondary">Bio</label>
            <textarea
              className="w-full rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2 text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent focus:border-transparent transition-colors min-h-[80px] resize-y"
              placeholder="Tell us about yourself..."
              value={data.bio}
              onChange={(e) => update({ bio: e.target.value })}
            />
          </div>
          <Input
            label="Instagram"
            placeholder="@yourhandle"
            value={data.instagramHandle}
            onChange={(e) => update({ instagramHandle: e.target.value })}
          />
          <Input
            label="X (Twitter)"
            placeholder="@yourhandle"
            value={data.twitterHandle}
            onChange={(e) => update({ twitterHandle: e.target.value })}
          />
          <Input
            label="OnlyFans URL"
            placeholder="https://onlyfans.com/..."
            value={data.onlyfansUrl}
            onChange={(e) => update({ onlyfansUrl: e.target.value })}
          />
          <div>
            <label className="block text-sm text-pnp-textSecondary mb-1">Profile Photo</label>
            <FileUploadBox
              label="Tap to upload a profile photo"
              file={data.profilePhotoFile}
              previewUrl={data.profilePhotoUrl}
              onSelect={(f) => update({ profilePhotoFile: f })}
            />
          </div>
          <div className="flex justify-between pt-4">
            <Button variant="secondary" onClick={goBack}>
              Back
            </Button>
            <Button onClick={handleStep2Continue} loading={submitting}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Legal Info (2257 Compliance) */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            Legal Information
          </h2>
          <p className="text-xs text-pnp-textSecondary">
            Required for 18 U.S.C. 2257 compliance. Your personal information is encrypted and kept confidential.
          </p>
          <Input
            label="Full Legal Name *"
            placeholder="As it appears on your government ID"
            value={data.legalFullName}
            onChange={(e) => update({ legalFullName: e.target.value })}
          />
          <Input
            label="Date of Birth *"
            type="date"
            value={data.dateOfBirth}
            onChange={(e) => update({ dateOfBirth: e.target.value })}
          />
          <Input
            label="Country *"
            placeholder="Country of residence"
            value={data.country}
            onChange={(e) => update({ country: e.target.value })}
          />
          <Input
            label="City / State *"
            placeholder="City, State/Province"
            value={data.cityState}
            onChange={(e) => update({ cityState: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-pnp-textSecondary mb-1">ID Front *</label>
              <FileUploadBox
                label="Front of ID"
                file={data.idFrontFile}
                previewUrl={data.idFrontUrl}
                onSelect={(f) => update({ idFrontFile: f })}
              />
            </div>
            <div>
              <label className="block text-sm text-pnp-textSecondary mb-1">ID Back *</label>
              <FileUploadBox
                label="Back of ID"
                file={data.idBackFile}
                previewUrl={data.idBackUrl}
                onSelect={(f) => update({ idBackFile: f })}
              />
            </div>
          </div>
          <div className="flex justify-between pt-4">
            <Button variant="secondary" onClick={goBack}>
              Back
            </Button>
            <Button onClick={handleStep3Continue} loading={submitting}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Agreement */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            Creator Terms & Agreement
          </h2>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-pnp-background border border-pnp-border p-4 text-xs text-pnp-textSecondary space-y-3 leading-relaxed">
            <p className="font-semibold text-pnp-textPrimary text-sm">PNPtv Creator Agreement v1.0</p>

            <p><strong>1. Revenue Split.</strong> Creators receive 70% of net revenue generated from their content and live streams. PNPtv retains 30% as a platform fee. Payouts are processed monthly for balances exceeding $50 USD.</p>

            <p><strong>2. Content Ownership.</strong> You retain all ownership rights to your content. By uploading, you grant PNPtv a non-exclusive, worldwide license to host, display, and distribute your content on the platform.</p>

            <p><strong>3. Content Policy.</strong> All content must comply with applicable laws. Prohibited content includes: content involving minors, non-consensual acts, bestiality, or any illegal activity. PNPtv reserves the right to remove content at its sole discretion.</p>

            <p><strong>4. 18 U.S.C. 2257 Compliance.</strong> You certify that you are at least 18 years of age and that all persons depicted in your content are at least 18 years of age. You agree to maintain records as required by federal law.</p>

            <p><strong>5. Tax Responsibility.</strong> You are responsible for reporting and paying all taxes on income earned through PNPtv. PNPtv may issue 1099 forms (US) or equivalent documentation as required by law.</p>

            <p><strong>6. Termination.</strong> Either party may terminate this agreement at any time. Upon termination, your content will be removed within 30 days and any outstanding balance will be paid out.</p>

            <p><strong>7. Governing Law.</strong> This agreement is governed by the laws of the State of California, USA.</p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={data.termsAgreed}
              onChange={(e) => update({ termsAgreed: e.target.checked })}
              className="mt-1 w-4 h-4 rounded border-pnp-border text-pnp-accent focus:ring-pnp-accent bg-pnp-surface"
            />
            <span className="text-sm text-pnp-textPrimary">
              I have read and agree to the PNPtv Creator Agreement. I confirm I am at least 18 years old and all information provided is accurate.
            </span>
          </label>
          <div className="flex justify-between pt-4">
            <Button variant="secondary" onClick={goBack}>
              Back
            </Button>
            <Button
              onClick={handleSubmit}
              loading={submitting}
              disabled={!data.termsAgreed}
            >
              Submit Application
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Schedule Call */}
      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-pnp-textPrimary">
            Schedule Your Onboarding Call
          </h2>
          <p className="text-sm text-pnp-textSecondary">
            Book a short video call with Santino to complete your onboarding. This helps us verify your identity and walk you through the platform.
          </p>
          <div className="rounded-xl border border-pnp-border overflow-hidden bg-white">
            <iframe
              src={CAL_EMBED_URL}
              className="w-full border-0"
              style={{ minHeight: "600px" }}
              title="Schedule onboarding call"
            />
          </div>
          <p className="text-xs text-pnp-textSecondary text-center">
            Calendar not loading?{" "}
            <a
              href={CAL_LINK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-pnp-accent hover:underline"
            >
              Open in a new tab
            </a>
          </p>
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={goNext}>
              Skip for now
            </Button>
            <Button onClick={handleMarkScheduled} loading={submitting}>
              I Scheduled My Call
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
            Application Submitted!
          </h2>
          <p className="text-sm text-pnp-textSecondary max-w-md mx-auto">
            Thank you for applying to become a creator on PNPtv. Our team will review your application and reach out to you via Telegram within 1-3 business days.
          </p>
          <div className="bg-pnp-surface rounded-lg p-4 text-left max-w-sm mx-auto space-y-2 text-sm">
            <p className="font-semibold text-pnp-textPrimary">What happens next?</p>
            <ol className="list-decimal list-inside space-y-1 text-pnp-textSecondary">
              <li>Our team reviews your application</li>
              <li>We verify your identity documents</li>
              <li>You'll get a Telegram notification with the result</li>
              <li>If approved, your creator dashboard unlocks</li>
            </ol>
          </div>
          <div className="pt-4">
            <Button onClick={() => navigate("/")}>
              Back to Home
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
