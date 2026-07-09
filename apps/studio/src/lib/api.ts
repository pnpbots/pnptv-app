const API_BASE = import.meta.env.VITE_API_URL || "https://studio.pnptv.app";

function friendlyHttpError(status: number, fallback: string): string {
  if (status === 413) return "File is too large. Max 512 MB (or 3 GB for creators).";
  if (status === 401) return "Please log in again to continue.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  return fallback;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  public readonly code: string | undefined;
  public readonly status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === "NetworkError");
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  const fetchOpts: RequestInit = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, fetchOpts);

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        const errorMessage =
          typeof error.error === "string"
            ? error.error
            : typeof (error.error as { message?: string })?.message === "string"
              ? (error.error as { message: string }).message
              : typeof error.message === "string"
                ? error.message
                : friendlyHttpError(res.status, `API error ${res.status}`);
        const errorCode = typeof error.code === "string" ? error.code : undefined;
        throw new ApiError(errorMessage, res.status, errorCode);
      }

      return res.json();
    } catch (err) {
      lastError = err;
      if (!isNetworkError(err) || attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  throw lastError;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface TelegramAuthResponse {
  success: boolean;
  user?: {
    id?: string;
    pnptv_id?: string;
    pnptvId?: string;
    telegram_id: number;
    username: string;
    first_name: string;
    display_name: string;
    language: string;
    terms_accepted: boolean;
    age_verified: boolean;
    subscription_type: string;
    tier: string;
    role: string;
    photo_url?: string | null;
    creator_status?: string;
    creator_type?: string | null;
    contentDisclaimer?: boolean;
    hasSeenTutorial?: boolean;
    last_login_method?: string | null;
    city?: string | null;
    country?: string | null;
  };
  error?: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: TelegramAuthResponse["user"] & {
    atproto_did?: string | null;
    atproto_handle?: string | null;
    creator_status?: string;
    creator_type?: string | null;
  };
}

export function checkAuthStatus(): Promise<AuthStatusResponse> {
  return request("/api/auth-status");
}

export function apiLogout(): Promise<{ success: boolean }> {
  return request("/api/logout", { method: "POST" });
}

export function oidcLogout(): Promise<{ success: boolean }> {
  return request("/api/auth/oidc/logout", { method: "POST" });
}

// ── RTMP / Channel ────────────────────────────────────────────────────────────

export function getRtmpKey(): Promise<{
  success: boolean;
  rtmpUrl?: string;
  streamKey?: string;
  error?: string;
}> {
  return request("/api/webapp/live/rtmp-key");
}

export function getMyChannel(): Promise<{
  success: boolean;
  channel: { ref: string; streamKey: string; rtmpUrl: string } | null;
}> {
  return request("/api/webapp/live/my-channel");
}

export interface CreatorEligibilityIssue {
  code:
    | "creator_suspended"
    | "creator_pending_review"
    | "creator_locked"
    | "no_channel"
    | "not_2257_compliant"
    | "low_followers";
  message: string;
  actionLabel?: string;
  actionUrl?: string;
}

export interface CreatorEligibility {
  success: boolean;
  canGoLive: boolean;
  canPostExclusive: boolean;
  creatorStatus: string;
  isLocked: boolean;
  is2257Compliant: boolean;
  hasLiveChannel: boolean;
  issues: string[];
  issueDetails?: CreatorEligibilityIssue[];
}

export function getCreatorEligibility(): Promise<CreatorEligibility> {
  return request("/api/webapp/me/creator-eligibility");
}

export function provisionChannel(): Promise<{
  success: boolean;
  alreadyProvisioned?: boolean;
  rtmpUrl?: string;
  streamKey?: string;
  channelRef?: string;
  error?: string;
}> {
  return request("/api/webapp/live/provision-channel", { method: "POST" });
}

// ── Streamer Settings ─────────────────────────────────────────────────────────

export interface StreamerSettings {
  qualityPreset: string;
  fps: number;
  autoReconnect: boolean;
  lowLatency: boolean;
  hardwareAccel: boolean;
  localRecord: boolean;
  filterPreset: string;
  filterBrightness: number;
  filterContrast: number;
  filterSaturation: number;
  filterWarmth: number;
  filterSharpness: number;
  beautyMode: boolean;
  lastStreamTitle?: string | null;
  lastStreamDescription?: string | null;
}

export function getStreamerSettings(): Promise<{ success: boolean; settings: StreamerSettings }> {
  return request("/api/webapp/live/settings");
}

export function updateStreamerSettings(
  settings: Partial<StreamerSettings>
): Promise<{ success: boolean; settings: StreamerSettings }> {
  return request("/api/webapp/live/settings", {
    method: "PUT",
    body: settings,
  });
}

// ── Stream Profile + Auto-Chat ────────────────────────────────────────────────

export function getStreamProfile(): Promise<{
  success: boolean;
  profile?: {
    boundaries: string;
    turnOns: string;
    streamGoal: string;
    messages: string[];
    isActive?: boolean;
  } | null;
}> {
  return request("/api/webapp/live/stream-profile");
}

export function saveStreamProfile(data: {
  boundaries: string;
  turnOns: string;
  streamGoal: string;
}): Promise<{ success: boolean; messages: string[] }> {
  return request("/api/webapp/live/stream-profile", {
    method: "POST",
    body: data,
  });
}

export function startStreamAutoMessages(): Promise<{ success: boolean }> {
  return request("/api/webapp/live/stream-auto-start", { method: "POST" });
}

export function stopStreamAutoMessages(): Promise<{ success: boolean }> {
  return request("/api/webapp/live/stream-auto-stop", { method: "POST" });
}

// ── Stream Analytics ──────────────────────────────────────────────────────────

export interface StreamHistoryItem {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  duration: number;
  peakViewers: number;
  totalViews: number;
  likes: number;
  status: string;
}

export interface StreamHistorySummary {
  totalStreams: number;
  totalDuration: number;
  avgViewers: number;
  totalLikes: number;
}

export function getStreamHistory(): Promise<{
  success: boolean;
  streams: StreamHistoryItem[];
  summary: StreamHistorySummary;
}> {
  return request("/api/webapp/live/stream-history");
}

// ── Gap 1: Earnings history ───────────────────────────────────────────────────

export interface EarningsSession {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  earnings: number;
  viewerPeak: number;
}

export interface EarningsHistory {
  success: boolean;
  totalAllTime: number;
  totalLast30Days: number;
  recentSessions: EarningsSession[];
}

export function getEarningsHistory(): Promise<EarningsHistory> {
  return request("/api/webapp/live/earnings");
}

// ── Tip goal ──────────────────────────────────────────────────────────────────

export interface LiveGoal {
  goalAmount: number;
  goalLabel: string;
  progress: number;
  completed: boolean;
}

export function getLiveGoal(channelRef: string): Promise<{ success: boolean; goal: LiveGoal | null }> {
  return request(`/api/proxy/live/goal/${encodeURIComponent(channelRef)}`);
}

export function setLiveGoal(amount: number, label: string): Promise<{ success: boolean; goal: LiveGoal }> {
  return request('/api/webapp/live/goal', { method: 'POST', body: { amount, label } });
}

export function getAcceptingCallsStatus(creatorId: string): Promise<{ accepting: boolean; acceptingUntil?: string | null }> {
  return request(`/api/webapp/creator/${encodeURIComponent(creatorId)}/accepting-calls`);
}

export function setAcceptingCalls(accepting: boolean): Promise<{ success: boolean }> {
  return request('/api/webapp/creator/accepting-calls', { method: 'PUT', body: { accepting } });
}

// ── Gap 2: Thumbnail upload ───────────────────────────────────────────────────

export function uploadThumbnail(dataUrl: string): Promise<{ success: boolean; url: string }> {
  return request("/api/webapp/live/thumbnail", {
    method: "POST",
    body: { dataUrl },
  });
}

// ── Gap 2 (snapshots): Snapshot persistence ───────────────────────────────────

export function uploadSnapshot(
  dataUrl: string,
  sessionId?: string | null
): Promise<{ success: boolean; id: string; publicUrl: string }> {
  return request("/api/webapp/live/snapshot", {
    method: "POST",
    body: { dataUrl, sessionId: sessionId ?? undefined },
  });
}

// ── Gap 4: Local recording server upload ─────────────────────────────────────

export async function uploadRecording(
  blob: Blob,
  sessionId: string | null,
  durationSec: number
): Promise<{ success: boolean; publicUrl: string }> {
  const form = new FormData();
  // iOS Safari's MediaRecorder produces video/mp4; everyone else WebM. Match
  // the filename to the actual container so the backend doesn't misroute.
  const ext = blob.type.startsWith("video/mp4") ? "mp4" : "webm";
  form.append("file", blob, `recording.${ext}`);
  if (sessionId) form.append("sessionId", sessionId);
  form.append("durationSec", String(Math.round(durationSec)));

  const res = await fetch(`${API_BASE}/api/webapp/live/recording`, {
    method: "POST",
    credentials: "include",
    body: form,
    // No Content-Type header — browser sets multipart/form-data with boundary automatically
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof error.error === "string" ? error.error : `Upload error ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  return res.json();
}

// ── Gap 5: Scene & Mixer presets ─────────────────────────────────────────────

export interface StreamPreset {
  id: string;
  name: string;
  config: Record<string, unknown>;
  isDefault: boolean;
  updatedAt: string;
}

export interface PresetsResponse {
  success: boolean;
  presets: StreamPreset[];
}

export interface SavePresetResponse {
  success: boolean;
  preset: StreamPreset;
}

export function getScenePresets(): Promise<PresetsResponse> {
  return request("/api/webapp/live/scene-presets");
}

export function saveScenePreset(data: {
  name: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
}): Promise<SavePresetResponse> {
  return request("/api/webapp/live/scene-presets", { method: "POST", body: data });
}

export function getMixerPresets(): Promise<PresetsResponse> {
  return request("/api/webapp/live/mixer-presets");
}

export function saveMixerPreset(data: {
  name: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
}): Promise<SavePresetResponse> {
  return request("/api/webapp/live/mixer-presets", { method: "POST", body: data });
}
