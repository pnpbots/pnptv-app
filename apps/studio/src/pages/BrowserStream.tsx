import React, { useState, useEffect, useRef, lazy } from "react";
import { useNavigate } from "react-router-dom";
import { useStreamer } from "@/hooks/useStreamer";
import type { FilterSettingsState } from "@/hooks/useStreamer";
import { getCreatorEligibility, type CreatorEligibility } from "@/lib/api";
import { StudioCanvas } from "@/components/studio/StudioCanvas";
import { StudioToolbar } from "@/components/studio/StudioToolbar";
import { StudioStatusBar } from "@/components/studio/StudioStatusBar";
import { StudioHealthPanel } from "@/components/studio/StudioHealthPanel";
import { StudioTabBar } from "@/components/studio/StudioTabBar";
import type { ActiveTab } from "@/components/studio/StudioTabBar";
import { StudioSettingsPanel } from "@/components/studio/StudioSettingsPanel";
import { StudioChatPanel } from "@/components/studio/StudioChatPanel";
import { PreStreamSetup } from "@/components/studio/PreStreamSetup";
import {
  TabPanel,
  ConfirmStopDialog,
  ArrowLeft,
  Radio,
  StopCircle,
  AlertTriangleIcon,
} from "@/components/studio/shared";

// ─── Lazy-loaded heavy panels ─────────────────────────────────────────────────

const SceneManager = lazy(
  () => import("@/components/streaming/SceneManager")
);
const AudioMixer = lazy(
  () => import("@/components/streaming/AudioMixer")
);
const VideoFilters = lazy(
  () => import("@/components/streaming/VideoFilters")
);

// ─── Top-bar Go Live / Stop button ────────────────────────────────────────────
// Hoisted out of BrowserStream so React doesn't unmount/remount it every
// render (BrowserStream re-renders every second via durationSec).
function GoLiveButton({
  isLive,
  isConnecting,
  onClick,
}: {
  isLive: boolean;
  isConnecting: boolean;
  onClick: () => void;
}) {
  if (isLive) {
    return (
      <button
        onClick={onClick}
        className="
          flex items-center gap-1.5 px-3 py-2 rounded-xl
          text-xs font-bold text-white
          transition-all duration-150 active:scale-[0.97]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500
        "
        style={{ background: "linear-gradient(135deg, #b91c1c, #dc2626)" }}
        aria-label="Stop stream"
      >
        <StopCircle className="w-3.5 h-3.5" aria-hidden="true" />
        Stop
      </button>
    );
  }
  if (isConnecting) {
    return (
      <button
        disabled
        className="
          flex items-center gap-1.5 px-3 py-2 rounded-xl
          text-xs font-bold text-white opacity-70 cursor-wait
        "
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
      >
        <span
          className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"
          aria-hidden="true"
        />
        Connecting…
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="
        flex items-center gap-1.5 px-3 py-2 rounded-xl
        text-xs font-bold text-white
        transition-all duration-150 active:scale-[0.97]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
      "
      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
      aria-label="Go live"
    >
      <Radio className="w-3.5 h-3.5" aria-hidden="true" />
      Go Live
    </button>
  );
}

// ─── BrowserStream ────────────────────────────────────────────────────────────

export default function BrowserStream() {
  const navigate = useNavigate();

  // ── Eligibility gate ──────────────────────────────────────────────────────
  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
  // Distinguish "checked and not eligible" from "could not check at all" — the
  // latter must not silently grant studio access. Fall-open behaviour previously
  // here let any creator with a network blip skip the canGoLive gate.
  const [eligibilityError, setEligibilityError] = useState(false);

  useEffect(() => {
    getCreatorEligibility()
      .then((data) => { setEligibility(data); setEligibilityError(false); })
      .catch(() => { setEligibility(null); setEligibilityError(true); })
      .finally(() => setEligibilityLoading(false));
  }, []);

  // ── Warn before closing the tab while live ───────────────────────────────
  // Most browsers no longer respect custom messages, but setting returnValue
  // still triggers the native "leave this site?" prompt.
  const isLiveForUnload = useRef(false);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isLiveForUnload.current) return;
      e.preventDefault();
      e.returnValue = "You are currently broadcasting. End the stream before closing this tab.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── activeTab lives here — purely a UI concern ────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("scenes");

  // ── Single useStreamer call — all state lives here ────────────────────────
  const streamer = useStreamer();

  const {
    // Channel
    channel,
    channelLoading,
    channelError,
    setChannelError,
    retryChannel,
    retryCamera,

    // Reducer state
    state,
    dispatch,

    // Session earnings
    sessionEarnings,

    // Filter settings
    filterSettings,
    setFilterSettings,

    // Modal / error UI state
    showStopConfirm,
    setShowStopConfirm,
    streamError,
    setStreamError,

    // Stream metrics
    durationSec,
    recordingBlob,
    bitrateSamples,
    localRecordEnabled,
    setLocalRecordEnabled,

    // Unused RTMP-key UI state (managed inside StudioSettingsPanel)
    availableCameras,
    cameraIndex,

    // Network
    networkQuality,

    // Stream title
    streamTitle,
    setStreamTitle,
    streamDesc,
    setStreamDesc,
    category,
    setCategory,
    thumbnail,
    setThumbnail,

    // Stream profile / auto-chat
    streamProfile,
    setStreamProfile,
    autoMessages,
    profileSaving,
    profileError,
    autoActive,

    // Refs
    videoRef,
    sceneStreamRef,
    rawStreamRef,

    // Derived
    health,
    isDesktopLayout,

    // Action handlers
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    brb,
    snapshot,
    flipCamera,
    downloadRecording,
    handleGoLiveClick,
    stopStream,

    // Media pipeline callbacks
    handleSceneStream,
    handleFilteredOutput,
    handleMixedAudioOutput,

    // Profile actions
    saveProfile,
    toggleAutoMessages,
  } = streamer;

  const {
    isLive,
    isConnecting,
    isMuted,
    isCameraOff,
    isScreenSharing,
    isRecording,
    viewerCount,
    stats,
    selectedPreset,
    orientation,
    autoReconnect,
    lowLatency,
    hardwareAccel,
    fps,
  } = state;

  // Keep the beforeunload ref in sync with the live flag.
  useEffect(() => { isLiveForUnload.current = isLive; }, [isLive]);

  // The raw camera stream for mic input — AudioMixer needs the actual microphone
  // audio tracks from getUserMedia. sceneStreamRef holds the canvas-capture output
  // which has NO audio tracks (canvas.captureStream is video-only), so passing it
  // here resulted in viewers hearing silence.
  const micStream = rawStreamRef.current;

  // streamId for chat — use the channel ref as the stream room identifier
  const streamId = channel?.ref ?? null;

  // ── Confirm stop dialog handlers ──────────────────────────────────────────
  function handleConfirmStop() {
    setShowStopConfirm(false);
    stopStream();
  }

  function handleCancelStop() {
    setShowStopConfirm(false);
  }


  // ── Eligibility fetch failure — fail closed so a bad network doesn't grant access ──
  if (!eligibilityLoading && eligibilityError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background p-6">
        <div className="max-w-sm w-full space-y-5 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
            style={{ background: "rgba(255,214,10,0.12)", border: "1px solid rgba(255,214,10,0.3)" }}>
            <svg className="w-8 h-8" style={{ color: "#FFD60A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99l-6.93-12a2 2 0 00-3.48 0l-6.93 12A2 2 0 005.07 19z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Could not verify eligibility</h1>
            <p className="text-sm mt-1" style={{ color: "var(--pnp-text-secondary)" }}>
              We couldn't reach the server to check whether you can go live. Check your connection and try again.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="block w-full px-6 py-3 rounded-xl text-sm font-bold text-white btn-gradient"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Eligibility locked screen ─────────────────────────────────────────────
  if (!eligibilityLoading && eligibility && !eligibility.canGoLive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background p-6">
        <div className="max-w-sm w-full space-y-5 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
            style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(123,97,255,0.2))", border: "1px solid rgba(212,0,122,0.3)" }}>
            <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Studio Locked</h1>
            <p className="text-sm mt-1" style={{ color: "var(--pnp-text-secondary)" }}>
              Complete your creator setup to start streaming.
            </p>
          </div>
          {(() => {
            // Prefer the new coded issueDetails when the backend ships them; fall
            // back to the legacy string array for older API responses.
            const details = eligibility.issueDetails && eligibility.issueDetails.length > 0
              ? eligibility.issueDetails
              : eligibility.issues.map((message) => ({ code: "no_channel" as const, message }));
            if (details.length === 0) return null;
            return (
              <div className="text-left rounded-xl p-4 space-y-3"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {details.map((issue, i) => (
                  <div key={i} className="space-y-2">
                    <p className="text-xs flex items-start gap-2" style={{ color: "var(--pnp-text-secondary)" }}>
                      <span style={{ color: "#FFD60A" }} className="flex-shrink-0 mt-0.5">•</span>
                      <span>{issue.message}</span>
                    </p>
                    {issue.code === "no_channel" ? (
                      <button
                        onClick={() => window.location.reload()}
                        className="ml-4 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                        style={{ background: "rgba(212,0,122,0.2)", border: "1px solid rgba(212,0,122,0.4)" }}
                      >
                        Retry
                      </button>
                    ) : issue.actionUrl ? (
                      <a
                        href={issue.actionUrl}
                        className="ml-4 inline-block px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                        style={{ background: "rgba(212,0,122,0.2)", border: "1px solid rgba(212,0,122,0.4)" }}
                      >
                        {issue.actionLabel ?? "Resolve"}
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })()}
          <a
            href="https://pnptv.app/creators/live"
            className="block text-xs"
            style={{ color: "var(--pnp-text-secondary)" }}
          >
            ← Back to Creator Dashboard
          </a>
        </div>
      </div>
    );
  }

  // ── Full render ───────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0E0E0E" }}
    >
      {/* ── Top bar (always visible) ──────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-3 py-2.5 border-b border-pnp-border flex-shrink-0"
        style={{ background: "rgba(14,14,14,0.95)", backdropFilter: "blur(8px)" }}
      >
        {/* Back button */}
        <button
          onClick={() => navigate("/")}
          className="
            flex items-center justify-center w-9 h-9 rounded-xl
            border border-pnp-border text-pnp-textSecondary
            hover:text-pnp-textPrimary hover:border-pnp-accent/40
            transition-colors duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
          "
          aria-label="Go back"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        </button>

        {/* Title + live badge */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-pnp-textPrimary">Studio</span>
          {isLive && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white"
              style={{ background: "rgba(239,68,68,0.9)" }}
              aria-label="Stream is live"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
              LIVE
            </span>
          )}
          {channelLoading && (
            <span className="text-[10px] text-pnp-textSecondary">Loading…</span>
          )}
        </div>

        {/* Go Live / Stop button */}
        <GoLiveButton isLive={isLive} isConnecting={isConnecting} onClick={handleGoLiveClick} />
      </header>

      {/* ── PRE-STREAM SETUP (shown when not live and not connecting) ───────── */}
      {!isLive && !isConnecting && (
        <PreStreamSetup
          videoRef={videoRef}
          streamTitle={streamTitle}
          setStreamTitle={setStreamTitle}
          streamDesc={streamDesc}
          setStreamDesc={setStreamDesc}
          category={category}
          setCategory={setCategory}
          thumbnail={thumbnail}
          setThumbnail={setThumbnail}
          onStartStream={handleGoLiveClick}
          isConnecting={isConnecting}
          channel={channel}
          streamError={streamError}
          onRetryCamera={retryCamera}
        />
      )}

      {/* ── MOBILE LAYOUT (hidden at lg:) — only shown when live/connecting ── */}
      {(isLive || isConnecting) && <div className="flex flex-col flex-1 min-h-0 lg:hidden overflow-hidden">
        {/* Preview canvas — 16:9 */}
        <StudioCanvas
          videoRef={videoRef}
          isLive={isLive}
          isConnecting={isConnecting}
          isCameraOff={isCameraOff}
          isRecording={isRecording}
          viewerCount={viewerCount}
          durationSec={durationSec}
          orientation={orientation}
          streamTitle={streamTitle}
          category={category}
          networkQuality={networkQuality}
          setStreamTitle={setStreamTitle}
          onGoLive={handleGoLiveClick}
        />

        {/* Mobile stats bar */}
        <StudioStatusBar
          isLive={isLive}
          stats={stats}
          viewerCount={viewerCount}
          durationSec={durationSec}
          networkQuality={networkQuality}
          health={health}
        />

        {/* Quick-action toolbar */}
        <StudioToolbar
          isLive={isLive}
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          isScreenSharing={isScreenSharing}
          canFlipCamera={availableCameras.length > 1}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onScreenShare={toggleScreenShare}
          onBrb={brb}
          onSnapshot={snapshot}
          onFlipCamera={flipCamera}
        />

        {/* Tab bar */}
        <StudioTabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Scrollable active panel */}
        <div
          className="flex-1 overflow-y-auto min-h-0"
          style={{ scrollbarWidth: "thin" }}
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === "scenes" && (
            <TabPanel label="Scene Manager">
              <SceneManager
                videoDevices={availableCameras}
                onCanvasStream={handleSceneStream}
                micStream={micStream}
                isLive={isLive}
                compact={true}
                sharedCameraStream={rawStreamRef.current}
              />
            </TabPanel>
          )}
          {activeTab === "audio" && (
            <TabPanel label="Audio Mixer">
              <AudioMixer
                micStream={micStream}
                onMixedOutput={handleMixedAudioOutput}
                isLive={isLive}
                compact={true}
              />
            </TabPanel>
          )}
          {activeTab === "filters" && (
            <TabPanel label="Video Filters">
              <VideoFilters
                inputStream={sceneStreamRef.current}
                onFilteredOutput={handleFilteredOutput}
                isLive={isLive}
                width={selectedPreset.width}
                height={selectedPreset.height}
                fps={fps}
                compact={true}
                initialSettings={filterSettings}
                onSettingsChange={(s: FilterSettingsState) => setFilterSettings(s)}
              />
            </TabPanel>
          )}
          {activeTab === "settings" && (
            <StudioSettingsPanel
              selectedPreset={selectedPreset}
              onPresetChange={(p) => dispatch({ type: "SET_PRESET", payload: p })}
              fps={fps}
              onFpsChange={(f) => dispatch({ type: "SET_FPS", payload: f as 24 | 30 | 60 })}
              isLive={isLive}
              autoReconnect={autoReconnect}
              onToggleAutoReconnect={() => dispatch({ type: "TOGGLE_AUTO_RECONNECT" })}
              lowLatency={lowLatency}
              onToggleLowLatency={() => dispatch({ type: "TOGGLE_LOW_LATENCY" })}
              hardwareAccel={hardwareAccel}
              onToggleHardwareAccel={() => dispatch({ type: "TOGGLE_HW_ACCEL" })}
              localRecordEnabled={localRecordEnabled}
              onToggleLocalRecord={() => setLocalRecordEnabled((v) => !v)}
              recordingBlob={recordingBlob}
              onDownloadRecording={downloadRecording}
              channel={channel}
              streamProfile={streamProfile}
              onStreamProfileChange={setStreamProfile}
              autoMessages={autoMessages}
              autoActive={autoActive}
              onSaveProfile={saveProfile}
              onToggleAutoMessages={toggleAutoMessages}
              profileSaving={profileSaving}
              profileError={profileError}
            />
          )}
          {activeTab === "chat" && (
            <div className="p-3 flex-1 min-h-0">
              <StudioChatPanel
                streamId={streamId}
                isLive={isLive}
                className="h-full min-h-[400px]"
              />
            </div>
          )}
        </div>
      </div>}

      {/* ── DESKTOP LAYOUT (hidden below lg:) — only shown when live/connecting */}
      {(isLive || isConnecting) && <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden">

        {/* Left column — scene + audio */}
        <aside
          className="w-[220px] flex-shrink-0 border-r border-pnp-border flex flex-col overflow-y-auto"
          style={{ background: "rgba(14,14,14,0.9)", scrollbarWidth: "thin" }}
          aria-label="Scene and audio controls"
        >
          <TabPanel label="Scene Manager">
            <SceneManager
              videoDevices={availableCameras}
              onCanvasStream={handleSceneStream}
              micStream={micStream}
              isLive={isLive}
              compact={true}
              sharedCameraStream={rawStreamRef.current}
            />
          </TabPanel>

          <div className="border-t border-pnp-border" aria-hidden="true" />

          <TabPanel label="Audio Mixer">
            <AudioMixer
              micStream={micStream}
              onMixedOutput={handleMixedAudioOutput}
              isLive={isLive}
              compact={true}
            />
          </TabPanel>
        </aside>

        {/* Center column — canvas + toolbar + health */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Canvas fills remaining vertical space */}
          <div className="flex-1 min-h-0 relative">
            <StudioCanvas
              videoRef={videoRef}
              isLive={isLive}
              isConnecting={isConnecting}
              isCameraOff={isCameraOff}
              isRecording={isRecording}
              viewerCount={viewerCount}
              durationSec={durationSec}
              orientation="landscape"
              streamTitle={streamTitle}
              category={category}
              networkQuality={networkQuality}
              setStreamTitle={setStreamTitle}
              onGoLive={handleGoLiveClick}
            />
          </div>

          {/* Toolbar below canvas */}
          <StudioToolbar
            isLive={isLive}
            isMuted={isMuted}
            isCameraOff={isCameraOff}
            isScreenSharing={isScreenSharing}
            canFlipCamera={availableCameras.length > 1}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            onScreenShare={toggleScreenShare}
            onBrb={brb}
            onSnapshot={snapshot}
            onFlipCamera={flipCamera}
          />

          {/* Health panel below toolbar */}
          <div className="flex-shrink-0 p-3 border-t border-pnp-border">
            <StudioHealthPanel
              isLive={isLive}
              stats={stats}
              health={health}
              bitrateSamples={bitrateSamples}
              selectedPreset={selectedPreset}
              durationSec={durationSec}
              viewerCount={viewerCount}
              sessionEarnings={sessionEarnings}
              channel={channel}
            />
          </div>
        </main>

        {/* Right column — chat + settings + filters */}
        <aside
          className="w-[280px] flex-shrink-0 border-l border-pnp-border flex flex-col overflow-hidden"
          style={{ background: "rgba(14,14,14,0.9)" }}
          aria-label="Chat and settings"
        >
          {/* Chat fills available space */}
          <div className="flex-1 min-h-0 p-3">
            <StudioChatPanel
              streamId={streamId}
              isLive={isLive}
              className="h-full"
            />
          </div>

          <div className="border-t border-pnp-border flex-shrink-0" aria-hidden="true" />

          {/* Settings — capped height, scrollable */}
          <div
            className="flex-shrink-0 overflow-y-auto"
            style={{ maxHeight: "40%", scrollbarWidth: "thin" }}
          >
            <StudioSettingsPanel
              selectedPreset={selectedPreset}
              onPresetChange={(p) => dispatch({ type: "SET_PRESET", payload: p })}
              fps={fps}
              onFpsChange={(f) => dispatch({ type: "SET_FPS", payload: f as 24 | 30 | 60 })}
              isLive={isLive}
              autoReconnect={autoReconnect}
              onToggleAutoReconnect={() => dispatch({ type: "TOGGLE_AUTO_RECONNECT" })}
              lowLatency={lowLatency}
              onToggleLowLatency={() => dispatch({ type: "TOGGLE_LOW_LATENCY" })}
              hardwareAccel={hardwareAccel}
              onToggleHardwareAccel={() => dispatch({ type: "TOGGLE_HW_ACCEL" })}
              localRecordEnabled={localRecordEnabled}
              onToggleLocalRecord={() => setLocalRecordEnabled((v) => !v)}
              recordingBlob={recordingBlob}
              onDownloadRecording={downloadRecording}
              channel={channel}
              streamProfile={streamProfile}
              onStreamProfileChange={setStreamProfile}
              autoMessages={autoMessages}
              autoActive={autoActive}
              onSaveProfile={saveProfile}
              onToggleAutoMessages={toggleAutoMessages}
              profileSaving={profileSaving}
              profileError={profileError}
            />
          </div>

          <div className="border-t border-pnp-border flex-shrink-0" aria-hidden="true" />

          {/* Video filters — compact */}
          <div
            className="flex-shrink-0 overflow-y-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            <TabPanel label="Video Filters">
              <VideoFilters
                inputStream={sceneStreamRef.current}
                onFilteredOutput={handleFilteredOutput}
                isLive={isLive}
                width={selectedPreset.width}
                height={selectedPreset.height}
                fps={fps}
                compact={true}
                initialSettings={filterSettings}
                onSettingsChange={(s: FilterSettingsState) => setFilterSettings(s)}
              />
            </TabPanel>
          </div>
        </aside>
      </div>}

      {/* ── Error banner (conditionally shown) ──────────────────────────────── */}
      {(streamError || channelError) && (
        <div
          className="
            flex items-center gap-2 px-4 py-2.5 flex-shrink-0
            border-t border-pnp-error/30
          "
          style={{ background: "rgba(255,69,58,0.10)" }}
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangleIcon
            className="w-4 h-4 flex-shrink-0"
            style={{ color: "#FF453A" }}
            aria-hidden="true"
          />
          <p className="text-xs text-pnp-error flex-1 min-w-0 truncate">
            {streamError ?? channelError}
          </p>
          {channelError && !streamError && (
            <button
              onClick={() => { void retryChannel(); }}
              className="
                text-pnp-textPrimary hover:text-white
                text-xs font-semibold flex-shrink-0
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded px-2 py-0.5
              "
              style={{ background: "rgba(255,255,255,0.06)" }}
              aria-label="Retry channel setup"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => {
              if (streamError) setStreamError(null);
              if (channelError) setChannelError(null);
            }}
            className="
              text-pnp-textSecondary hover:text-pnp-textPrimary
              text-xs font-medium flex-shrink-0
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded px-1
            "
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Confirm stop dialog ──────────────────────────────────────────────── */}
      {showStopConfirm && (
        <ConfirmStopDialog
          onConfirm={handleConfirmStop}
          onCancel={handleCancelStop}
        />
      )}
    </div>
  );
}
