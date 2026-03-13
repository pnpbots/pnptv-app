import React from "react";

export interface StreamOverlayConfig {
  is_active?: boolean;
  logo_url?: string | null;
  logo_position?: string;
  logo_size?: number;
  logo_opacity?: number;
  banner_text?: string | null;
  banner_image_url?: string | null;
  banner_position?: string;
  banner_bg_color?: string;
  banner_text_color?: string;
  banner_style?: string;
}

interface StreamOverlayLayerProps {
  overlay: StreamOverlayConfig | null;
}

function positionClasses(position: string): React.CSSProperties {
  switch (position) {
    case "top-left":
      return { top: 12, left: 12 };
    case "top-right":
      return { top: 12, right: 12 };
    case "bottom-left":
      return { bottom: 12, left: 12 };
    case "bottom-right":
    default:
      return { bottom: 12, right: 12 };
  }
}

export function StreamOverlayLayer({ overlay }: StreamOverlayLayerProps) {
  if (!overlay) return null;

  const {
    logo_url,
    logo_position = "top-left",
    logo_size = 80,
    logo_opacity = 0.8,
    banner_text,
    banner_image_url,
    banner_position = "bottom",
    banner_bg_color = "#000000",
    banner_text_color = "#ffffff",
    banner_style = "static",
  } = overlay;

  const hasLogo = !!logo_url;
  const hasBannerImage = !!banner_image_url;
  const hasBannerText = !!banner_text?.trim();
  const hasBanner = hasBannerImage || hasBannerText;

  if (!hasLogo && !hasBanner) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Scrolling banner keyframes — injected inline only when needed */}
      {hasBanner && banner_style === "scroll" && (
        <style>{`
          @keyframes pnptv-banner-scroll {
            0%   { transform: translateX(100%); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      )}

      {/* Logo */}
      {hasLogo && (
        <img
          src={logo_url!}
          alt=""
          style={{
            position: "absolute",
            width: logo_size,
            height: logo_size,
            objectFit: "contain",
            opacity: logo_opacity,
            ...positionClasses(logo_position),
          }}
        />
      )}

      {/* Image banner (takes priority over text banner) */}
      {hasBannerImage && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            ...(banner_position === "top" ? { top: 0 } : { bottom: 0 }),
            display: "flex",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <img
            src={banner_image_url!}
            alt=""
            style={{
              width: "100%",
              maxHeight: 80,
              objectFit: "contain",
            }}
          />
        </div>
      )}

      {/* Text banner (only when no image banner) */}
      {!hasBannerImage && hasBannerText && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            ...(banner_position === "top" ? { top: 0 } : { bottom: 0 }),
            backgroundColor: banner_bg_color,
            color: banner_text_color,
            padding: "6px 12px",
            overflow: "hidden",
          }}
        >
          <span
            style={
              banner_style === "scroll"
                ? {
                    display: "inline-block",
                    whiteSpace: "nowrap",
                    animation: `pnptv-banner-scroll ${Math.max(10, banner_text!.length * 0.15)}s linear infinite`,
                  }
                : {
                    display: "block",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                  }
            }
          >
            {banner_text}
          </span>
        </div>
      )}
    </div>
  );
}
