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

// ── WebRTC Streaming (JaaS) ──────────────────────────────────────────────────

export interface WebRTCStreamConfig {
  token: string;
  meetingUrl: string;
  roomName: string;
  channelRef: string;
  error?: string;
}

export function getWebRTCStreamerConfig(): Promise<{ success: boolean } & WebRTCStreamConfig> {
  return request("/api/webapp/live/webrtc/config");
}

export function endWebRTCStream(): Promise<{ success: boolean }> {
  return request("/api/webapp/live/webrtc/end", { method: "POST" });
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
