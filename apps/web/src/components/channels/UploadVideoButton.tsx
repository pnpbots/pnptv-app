/**
 * UploadVideoButton — entry-point pill that opens the UploadVideoModal.
 * Render only when the viewer can manage the channel (creator or collaborator).
 *
 * The parent decides ownership; this component is a dumb shell that opens
 * the modal on tap. Place anywhere — channel detail header, Creator Studio
 * dashboard, etc.
 */

import React, { useState } from "react";
import { UploadVideoModal } from "./UploadVideoModal";
import type { ChannelVideo } from "@/lib/api";

interface Props {
  channelId: number;
  channelName: string;
  channelSlug: string;
  accessType: "free" | "subscription" | "prime" | "paid";
  pricePerMonth: number | null;
  creatorUsername: string | null;
  /** Optional: receive the published ChannelVideo for parent-side state refresh. */
  onPublished?: (video: ChannelVideo) => void;
  /** Style preset. "pill" (default), "compact" (icon-only), "fab" (floating). */
  variant?: "pill" | "compact" | "fab";
}

export function UploadVideoButton({
  channelId, channelName, channelSlug, accessType, pricePerMonth, creatorUsername,
  onPublished, variant = "pill",
}: Props) {
  const [open, setOpen] = useState(false);

  const Icon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Upload video"
        className={
          variant === "fab"
            ? "fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
            : variant === "compact"
              ? "w-9 h-9 rounded-full flex items-center justify-center"
              : "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-white"
        }
        style={{
          background: "linear-gradient(90deg,#ff3377,#ff9933)",
          boxShadow: variant === "fab" ? "0 12px 28px rgba(255,51,119,0.40)" : undefined,
          color: "#fff",
        }}
      >
        {Icon}
        {variant === "pill" && <span>Add video</span>}
      </button>
      {open && (
        <UploadVideoModal
          channelId={channelId}
          channelName={channelName}
          channelSlug={channelSlug}
          accessType={accessType}
          pricePerMonth={pricePerMonth}
          creatorUsername={creatorUsername}
          onClose={() => setOpen(false)}
          onPublished={onPublished}
        />
      )}
    </>
  );
}
