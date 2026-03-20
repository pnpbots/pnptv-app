export interface LiveStream {
  id: string;
  name: string;
  description: string;
  hlsUrl: string;
  isLive: boolean;
  /** Viewer count from Redis — included in GET /api/proxy/live/streams responses */
  viewerCount?: number;
  title?: string;
  performerName?: string;
}

export interface WebRTCStreamConfig {
  token: string;
  wsUrl: string;
  roomName: string;
  channelRef: string;
}

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

export interface StreamOverlay {
  id: string;
  channel_ref: string;
  logo_url: string | null;
  logo_position: string;
  logo_size: number;
  logo_opacity: number;
  banner_text: string | null;
  banner_position: string;
  banner_bg_color: string;
  banner_text_color: string;
  banner_style: string;
  banner_image_url: string | null;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface OverlayAsset {
  id: string;
  type: "logo" | "banner";
  name: string;
  category: string | null;
  sort_order: number;
  image_url: string | null;
  image_filename: string | null;
  image_mime: string | null;
}

export interface UploadedOverlayAsset {
  success: boolean;
  url: string;
  name: string;
  type: "logo" | "banner";
  filename: string;
}

export interface LocalOverlayAsset {
  name: string;
  url: string;
  size: number;
  modified: string;
  type: "logo" | "banner";
}
