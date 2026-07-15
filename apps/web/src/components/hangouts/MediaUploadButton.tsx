import React, { useRef, useState, useEffect, useCallback } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime", "video/3gpp", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"];
const MAX_IMAGE_BYTES = 10 * 1_048_576;  // 10 MB
const MAX_VIDEO_BYTES = 50 * 1_048_576;  // 50 MB
const MAX_RECORDING_SECONDS = 60;

interface MediaUploadButtonProps {
  onFilesSelect: (files: File[], previewUrls: string[]) => void;
  onError: (error: string) => void;
  onVoiceRecord?: (blob: Blob, duration: number) => void;
  disabled: boolean;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MediaUploadButton({
  onFilesSelect,
  onError,
  onVoiceRecord,
  disabled,
}: MediaUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Voice recording state ---
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // For cancel-on-drag-away (mobile press-and-hold)
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const isMobilePressRef = useRef(false);
  const cancelledRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  function startTimer() {
    setRecordingSeconds(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
  }

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearAutoStop() {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }

  const stopRecording = useCallback((cancelled: boolean) => {
    clearTimer();
    clearAutoStop();
    cancelledRef.current = cancelled;

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      return;
    }
    recorder.stop();
    // onstop handler will do the rest
  }, []);

  async function startRecording() {
    if (disabled || isRecording) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Microphone access denied. Please allow microphone permissions.");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/ogg";

    chunksRef.current = [];
    cancelledRef.current = false;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      onError("Audio recording is not supported in this browser.");
      return;
    }
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      // Stop all tracks to release the mic
      stream.getTracks().forEach((t) => t.stop());

      if (cancelledRef.current || !onVoiceRecord) {
        chunksRef.current = [];
        setIsRecording(false);
        setRecordingSeconds(0);
        return;
      }

      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      setIsRecording(false);
      setRecordingSeconds(0);

      if (blob.size > 0 && durationSeconds > 0) {
        onVoiceRecord(blob, durationSeconds);
      }
    };

    recorder.start(100); // collect data every 100 ms for smoother chunking
    setIsRecording(true);
    startTimer();

    // Auto-stop at max duration
    autoStopRef.current = setTimeout(() => {
      stopRecording(false);
    }, MAX_RECORDING_SECONDS * 1000);
  }

  // ─── File upload handlers ────────────────────────────────────────────────

  function handleUploadClick() {
    if (disabled || isRecording) return;
    inputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    e.target.value = "";
    if (selected.length === 0) return;

    const validFiles: File[] = [];
    for (const file of selected) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (!ACCEPTED_TYPES.includes(file.type)) {
        onError("Unsupported file type. Please select JPEG, PNG, GIF, WebP, MP4, WebM, MOV, or 3GP files.");
        return;
      }
      const isAudio = file.type.startsWith("audio/");
      if (isImage && file.size > MAX_IMAGE_BYTES) {
        onError(`"${file.name}" is over 10 MB. Images must be under 10 MB.`);
        return;
      }
      if ((isVideo || isAudio) && file.size > MAX_VIDEO_BYTES) {
        onError(`"${file.name}" is over 50 MB. Files must be under 50 MB.`);
        return;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;
    const previewUrls = validFiles.map((f) => URL.createObjectURL(f));
    onFilesSelect(validFiles, previewUrls);
  }

  // ─── Mic button interaction — desktop (click-to-toggle) ─────────────────

  function handleMicClick() {
    // Only used on desktop (non-touch). On touch, pointer events handle it.
    if (isMobilePressRef.current) return;
    if (isRecording) {
      stopRecording(false);
    } else {
      startRecording();
    }
  }

  // ─── Mic button interaction — mobile (press-and-hold) ───────────────────

  function handleTouchStart(e: React.TouchEvent) {
    isMobilePressRef.current = true;
    const touch = e.touches[0];
    pressOriginRef.current = { x: touch.clientX, y: touch.clientY };
    startRecording();
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!isRecording || !pressOriginRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - pressOriginRef.current.x;
    const dy = touch.clientY - pressOriginRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 50) {
      stopRecording(true);
    }
  }

  function handleTouchEnd() {
    if (isRecording) {
      stopRecording(false);
    }
    // Reset flag after a tick so handleMicClick sees it and skips
    setTimeout(() => { isMobilePressRef.current = false; }, 0);
  }

  function handleTouchCancel() {
    stopRecording(true);
    setTimeout(() => { isMobilePressRef.current = false; }, 0);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/3gpp,audio/webm,audio/ogg,audio/mp4,audio/mpeg"
        className="hidden"
        onChange={handleChange}
        aria-hidden="true"
        tabIndex={-1}
        multiple
      />

      {/* File upload button */}
      <button
        type="button"
        onClick={handleUploadClick}
        disabled={disabled || isRecording}
        className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all disabled:opacity-40 disabled:pointer-events-none text-pnp-textSecondary hover:text-pnp-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
        aria-label="Attach image or video"
        title="Attach image or video"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
          />
        </svg>
      </button>

      {/* Voice message recording button + indicator */}
      {onVoiceRecord && (
        <div className="flex-shrink-0 flex items-center gap-1.5 select-none">
          {isRecording && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/15 border border-red-500/30">
              {/* Pulsing red dot */}
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-[11px] font-mono text-red-400 tabular-nums min-w-[2.4rem]">
                {formatElapsed(recordingSeconds)}
              </span>
              <span className="text-[10px] text-red-400/70 hidden sm:inline">
                {recordingSeconds < 55 ? "Release to send" : `${MAX_RECORDING_SECONDS - recordingSeconds}s left`}
              </span>
            </div>
          )}

          <button
            ref={micButtonRef}
            type="button"
            onClick={handleMicClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            disabled={disabled}
            className={[
              "w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent",
              "disabled:opacity-40 disabled:pointer-events-none",
              isRecording
                ? "bg-red-500 text-white scale-110 shadow-lg shadow-red-500/40 hover:bg-red-600"
                : "hover:bg-white/10 active:scale-90 text-pnp-textSecondary hover:text-pnp-textPrimary",
            ].join(" ")}
            aria-label={isRecording ? "Stop recording" : "Record voice message (hold on mobile)"}
            title={isRecording ? "Stop recording" : "Record voice message"}
          >
            {isRecording ? (
              // Stop icon when recording
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              // Microphone icon
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                />
              </svg>
            )}
          </button>
        </div>
      )}
    </>
  );
}
