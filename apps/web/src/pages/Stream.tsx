import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { useLiveSocket } from "@/hooks/useLiveSocket";
import { useI18n } from "@/lib/i18n";
import { LivePlayer } from "@/components/LivePlayer";
import { JitsiMeetComponent } from "@/components/hangouts";
import { LiveRulesModal } from "@/components/LiveRulesModal";
import { BuyTokensModal } from "@/components/BuyTokensModal";
import { connectSocket } from "@/lib/socket";
import { QRCodeSVG } from "qrcode.react";
import {
  getLiveStreams,
  getAllPerformers,
  getWebRTCStreams,
  getWebRTCStreamStatus,
  getWebRTCViewerToken,
  streamHeartbeat,
  sendTip,
  TIP_AMOUNTS,
  getStreamOverlayPublic,
  getLiveRulesStatus,
  acknowledgeLiveRules,
  assertPaymentUrl,
  getDashPaymentDetails,
  type LiveStream,
  type LiveStreamWithHost,
  type RecentTip,
  type StreamOverlay,
  getRecentTips,
  getWalletBalance,
} from "@/lib/api";

function extractChannelRef(streamId: string): string | null {
  // streamId is now the channel ref directly (e.g. "pnptv-santino")
  // or could be a legacy full process ID (e.g. "restreamer-ui:ingest:pnptv-santino")
  const match = streamId.match(/restreamer-ui:ingest:([\w-]+)/);
  return match ? match[1] : streamId;
}

export default function Stream() {
  const { streamId } = useParams<{ streamId: string }>();
  const navigate = useNavigate();
  const t = useI18n();
  const { isAuthenticated, login, user } = useAuth();

  const [stream, setStream] = useState<LiveStream | null>(null);
  const [useWebRTC, setUseWebRTC] = useState(false);
  const [jaasUrl, setJaasUrl] = useState<string | null>(null);
  const [jaasError, setJaasError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<StreamOverlay | null>(null);

  // Live rules gate — only enforced for authenticated users
  const [rulesAcknowledged, setRulesAcknowledged] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(true);

  // Chat & tips
  const [chatInput, setChatInput] = useState("");
  const [tipPaymentTab, setTipPaymentTab] = useState<"tokens" | "daimo" | "dash">("tokens");
  const [tipping, setTipping] = useState(false);
  const [tipSubmitting, setTipSubmitting] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState<string | null>(null);
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);

  // Dash tip payment state
  const [dashTip, setDashTip] = useState<{
    invoiceId: string;
    checkoutUrl: string;
    destination?: string;
    amount?: string;
    invoiceAmount?: number;
    loading: boolean;
    createdAt: number;
  } | null>(null);
  const [dashTipCopied, setDashTipCopied] = useState(false);
  const [dashTipSecondsLeft, setDashTipSecondsLeft] = useState(900);
  const [dashTipSuccess, setDashTipSuccess] = useState(false);
  const dashTipPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dashTipCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [streamError, setStreamError] = useState(false);

  // Dash token wallet
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);

  // ── Raid state ──────────────────────────────────────────────────────────────
  const [raidCountdown, setRaidCountdown] = useState<number | null>(null);
  const [showRaidPicker, setShowRaidPicker] = useState(false);
  const [raidTargetStreams, setRaidTargetStreams] = useState<LiveStreamWithHost[]>([]);
  const [raidPickerLoading, setRaidPickerLoading] = useState(false);
  const [raidError, setRaidError] = useState<string | null>(null);
  const raidCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Host mode state ────────────────────────────────────────────────────────
  const [hostedChannelRef, setHostedChannelRef] = useState<string | null>(null);
  const [hostedStream, setHostedStream] = useState<LiveStreamWithHost | null>(null);
  const [showHostPicker, setShowHostPicker] = useState(false);
  const [hostPickerLoading, setHostPickerLoading] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);

  const {
    messages: chatMessages,
    viewerCount: socketViewerCount,
    isConnected: chatConnected,
    reconnecting: chatReconnecting,
    sendMessage,
    latestTip,
    walletBalance: socketBalance,
    socketError,
    raidEvent,
    dismissRaid,
    emitRaid,
  } = useLiveSocket(streamId || null);

  // Load initial balance
  useEffect(() => {
    if (isAuthenticated) {
      getWalletBalance().then((data) => {
        setTokenBalance(data.balance);
      }).catch(() => {});
    }
  }, [isAuthenticated]);

  // Sync socket-pushed balance
  useEffect(() => {
    if (socketBalance !== null) setTokenBalance(socketBalance);
  }, [socketBalance]);

  // Viewer count: prefer the real-time socket value; fall back to a polled
  // value from the streams API when the socket is not connected.
  const [polledViewerCount, setPolledViewerCount] = useState(0);
  const viewerCount = chatConnected ? socketViewerCount : polledViewerCount;

  // Share button state
  const [shareCopied, setShareCopied] = useState(false);

  // Load stream info. Checks WebRTC (JaaS) streams first, then falls back
  // to Restreamer HLS streams and performer lookup.
  const loadStream = useCallback(() => {
    if (!streamId) return Promise.resolve();
    const channelRef = extractChannelRef(streamId);
    console.log("[Stream] Looking for:", streamId, "channelRef:", channelRef);

    return Promise.all([
      getWebRTCStreams().catch(() => ({ streams: [] })),
      getLiveStreams().catch(() => ({ streams: [] })),
      getAllPerformers().catch(() => ({ performers: [] })),
    ])
      .then(async ([webrtcData, hlsData, perfData]) => {
        const webrtcStreams = webrtcData.streams || [];
        const hlsStreams = hlsData.streams || [];
        const performers = perfData.performers || [];

        console.log("[Stream] WebRTC streams:", webrtcStreams.length, "HLS streams:", hlsStreams.length, "Performers:", performers.length);

        // 1. Check WebRTC (JaaS) streams — preferred
        const webrtcMatch = webrtcStreams.find(
          (s: any) => s.channelRef === streamId || s.channelRef === channelRef || s.id === streamId
        );
        if (webrtcMatch && webrtcMatch.isLive) {
          console.log("[Stream] Matched WebRTC stream:", webrtcMatch.channelRef);
          setStream({
            id: webrtcMatch.channelRef || webrtcMatch.id,
            name: webrtcMatch.name,
            description: webrtcMatch.description || "",
            hlsUrl: "", // Not used for WebRTC
            isLive: true,
          });
          setUseWebRTC(true);
          setError(null);
          setStreamError(false);
          return;
        }

        // 2. Direct match in Restreamer HLS streams
        const hlsMatch = hlsStreams.find((s: any) => s.id === streamId || s.id === channelRef);
        if (hlsMatch && hlsMatch.isLive) {
          console.log("[Stream] Matched HLS stream:", hlsMatch.id);
          setStream(hlsMatch);
          setUseWebRTC(false);
          setError(null);
          setStreamError(false);
          return;
        }

        // 3. Match by performer (isLive + hlsUrl from backend)
        const performer = performers.find(
          (p: any) =>
            p.id === streamId ||
            (p.userId && String(p.userId) === streamId) ||
            (p.slug && p.slug === streamId)
        );
        if (performer && performer.isLive && performer.hlsUrl) {
          console.log("[Stream] Matched performer:", performer.id);
          setStream({
            id: performer.id,
            name: performer.displayName,
            description: performer.bio || "",
            hlsUrl: performer.hlsUrl,
            isLive: true,
          });
          setUseWebRTC(false);
          setError(null);
          setStreamError(false);
          return;
        }

        // 4. Fuzzy match in HLS streams
        const fuzzyMatch = hlsStreams.find(
          (s: any) => s.id.includes(streamId) || (channelRef && s.id.includes(channelRef))
        );
        if (fuzzyMatch) {
          console.log("[Stream] Fuzzy-matched HLS stream:", fuzzyMatch.id);
          setStream(fuzzyMatch);
          setUseWebRTC(false);
          setError(null);
          setStreamError(false);
          return;
        }

        // 5. Check performer info to build an "offline" placeholder — the channel exists
        // but nobody is streaming right now. This prevents "stream not found" when a valid
        // creator navigates to their own stream URL before going live.
        const offlinePerformer = performer || performers.find(
          (p: any) =>
            (p.live_channel && p.live_channel === channelRef) ||
            (p.live_channel && p.live_channel === streamId)
        );
        if (offlinePerformer) {
          console.log("[Stream] Performer found but offline:", offlinePerformer.id);
          setStream({
            id: channelRef || streamId,
            name: offlinePerformer.displayName || offlinePerformer.name || channelRef || streamId,
            description: offlinePerformer.bio || "",
            hlsUrl: "",
            isLive: false,
          });
          setUseWebRTC(false);
          setError(null);
          setStreamError(false);
          return;
        }

        // 6. Last resort: call the WebRTC status endpoint directly for the specific channel.
        // If the channel exists in JaaS (room was created even with 0 participants), show
        // it as "offline" rather than "not found". This handles the streamer's own page view
        // before they go live.
        if (channelRef) {
          try {
            const status = await getWebRTCStreamStatus(channelRef);
            console.log("[Stream] Direct channel status for", channelRef, ":", status);
            // Even if isLive=false, we know the channel ref is valid — show an offline page
            // instead of a hard "not found" error so the streamer can still see their page.
            setStream({
              id: channelRef,
              name: channelRef.replace(/^pnptv-/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
              description: "",
              hlsUrl: "",
              isLive: status.isLive || false,
            });
            setUseWebRTC(status.isLive || false);
            setError(null);
            setStreamError(false);
            return;
          } catch {
            console.log("[Stream] Channel status check failed for", channelRef, "- treating as not found");
          }
        }

        console.log("[Stream] No stream found for:", streamId);
        setError(t.live.streamNotFound);
        setStreamError(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load stream");
        setStreamError(true);
      });
  }, [streamId]);

  useEffect(() => {
    setLoading(true);
    loadStream().finally(() => setLoading(false));
    const interval = setInterval(loadStream, 30000);
    return () => clearInterval(interval);
  }, [loadStream]);

  // Fetch JaaS meeting URL when the stream is WebRTC-based
  useEffect(() => {
    if (!useWebRTC || !stream) {
      setJaasUrl(null);
      setJaasError(null);
      return;
    }
    const channelRef = extractChannelRef(stream.id) || stream.id;
    setJaasUrl(null);
    setJaasError(null);
    getWebRTCViewerToken(channelRef)
      .then((data) => {
        if (data.meetingUrl) {
          setJaasUrl(data.meetingUrl);
        } else if (data.token) {
          // Legacy wsUrl path — not expected after migration but guard against it
          setJaasError("Stream requires a viewer token but no meeting URL was returned.");
        } else {
          setJaasError(data.error as string | undefined ?? "Unable to connect to stream.");
        }
      })
      .catch((err: any) => {
        setJaasError(err?.message || "Failed to load stream connection.");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useWebRTC, stream?.id]);

  // Heartbeat for token deduction while watching a WebRTC stream
  useEffect(() => {
    if (!useWebRTC || !stream || !jaasUrl) return;
    const channelRef = extractChannelRef(stream.id) || stream.id;
    const interval = setInterval(async () => {
      try {
        const res = await streamHeartbeat(channelRef);
        if (res.success && typeof res.newBalance === "number" && res.newBalance >= 0) {
          setTokenBalance(res.newBalance);
        }
      } catch (err: any) {
        if (err?.status === 402 || err?.response?.status === 402) {
          setShowTopUp(true);
          setJaasUrl(null);
          setJaasError("Insufficient tokens to continue watching.");
        }
      }
    }, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useWebRTC, stream?.id, jaasUrl]);

  // Fallback poll: refresh viewer count from the streams endpoint every 30s
  // when Socket.IO is disconnected so the displayed count does not freeze.
  useEffect(() => {
    if (chatConnected || !streamId) return;
    const poll = () => {
      getLiveStreams()
        .then((data) => {
          const found = (data.streams || []).find((s) => s.id === streamId);
          if (found && typeof found.viewerCount === "number") {
            setPolledViewerCount(found.viewerCount);
          }
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [chatConnected, streamId]);

  // Fetch overlay config for this channel and subscribe to real-time updates
  useEffect(() => {
    if (!streamId) return;
    const channelRef = extractChannelRef(streamId);
    if (!channelRef) return;

    // Initial fetch
    getStreamOverlayPublic(channelRef)
      .then((res) => {
        if (res.overlay?.is_active) setOverlay(res.overlay);
      })
      .catch(() => {
        // Overlay is optional — silently ignore fetch failures
      });

    // Real-time updates via socket
    const socket = connectSocket();
    const handler = (data: StreamOverlay) => {
      if (data.channel_ref === channelRef) {
        setOverlay(data.is_active ? data : null);
      }
    };
    socket.on("overlay:updated", handler);
    return () => {
      socket.off("overlay:updated", handler);
    };
  }, [streamId]);

  // Live rules acknowledgment check — only for authenticated users
  useEffect(() => {
    if (!isAuthenticated) {
      // Unauthenticated users can watch; they'll be prompted to log in when they try to interact
      setRulesLoading(false);
      setRulesAcknowledged(true);
      return;
    }
    setRulesLoading(true);
    getLiveRulesStatus()
      .then((data) => {
        if (data.success) {
          setRulesAcknowledged(data.acknowledged);
        } else {
          // On unexpected API error, fail open so the user isn't permanently blocked
          setRulesAcknowledged(true);
        }
      })
      .catch(() => {
        // Network failure — fail open
        setRulesAcknowledged(true);
      })
      .finally(() => {
        setRulesLoading(false);
      });
  }, [isAuthenticated]);

  const handleAcknowledgeRules = useCallback(async () => {
    try {
      await acknowledgeLiveRules();
    } catch {
      // Persist locally even if the network call fails — the user has seen the rules
      console.warn("[LiveRules] Failed to persist acknowledgment — session may have expired");
    }
    setRulesAcknowledged(true);
  }, []);

  // ── Raid: drive countdown and auto-navigate when a raid event arrives ────────
  useEffect(() => {
    if (!raidEvent) {
      if (raidCountdownRef.current) {
        clearInterval(raidCountdownRef.current);
        raidCountdownRef.current = null;
      }
      setRaidCountdown(null);
      return;
    }
    setRaidCountdown(5);
    if (raidCountdownRef.current) clearInterval(raidCountdownRef.current);
    raidCountdownRef.current = setInterval(() => {
      setRaidCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (raidCountdownRef.current) {
            clearInterval(raidCountdownRef.current);
            raidCountdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (raidCountdownRef.current) {
        clearInterval(raidCountdownRef.current);
        raidCountdownRef.current = null;
      }
    };
  }, [raidEvent]);

  // Auto-navigate when countdown reaches 0
  useEffect(() => {
    if (raidCountdown !== 0 || !raidEvent) return;
    navigate(`/stream/${encodeURIComponent(raidEvent.targetChannelRef)}`);
    dismissRaid();
  }, [raidCountdown, raidEvent, navigate, dismissRaid]);

  // Whether the current user is a creator/admin (controls raid + host UI visibility)
  const isStreamOwner = !!(user && ['model', 'creator', 'admin', 'superadmin'].includes(user.role));

  // ── Host mode: load current hosted channel on mount (creator only) ─────────
  useEffect(() => {
    if (!isStreamOwner) return;
    getHostedChannel()
      .then((data) => {
        if (data.success) setHostedChannelRef(data.hosting);
      })
      .catch(() => {});
  }, [isStreamOwner]);

  // ── Host mode: resolve hosted stream info when hostedChannelRef changes ─────
  useEffect(() => {
    if (!hostedChannelRef) {
      setHostedStream(null);
      return;
    }
    getWebAppLiveStreams()
      .then((data) => {
        const target = (data.streams || []).find((s: LiveStreamWithHost) => s.id === hostedChannelRef);
        if (target) {
          setHostedStream(target);
        } else {
          const publicBase = (import.meta.env.VITE_RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
          setHostedStream({
            id: hostedChannelRef,
            name: hostedChannelRef.replace(/^pnptv-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            description: '',
            hlsUrl: `${publicBase}/memfs/${hostedChannelRef}.m3u8`,
            isLive: false,
          });
        }
      })
      .catch(() => {});
  }, [hostedChannelRef]);

  const handleOpenRaidPicker = useCallback(async () => {
    setShowRaidPicker(true);
    setRaidPickerLoading(true);
    setRaidError(null);
    try {
      const data = await getWebAppLiveStreams();
      const currentRef = streamId ? extractChannelRef(streamId) : null;
      const others = (data.streams || []).filter(
        (s: LiveStreamWithHost) => s.isLive && s.id !== streamId && s.id !== currentRef
      );
      setRaidTargetStreams(others);
    } catch {
      setRaidError('Failed to load live streams');
    } finally {
      setRaidPickerLoading(false);
    }
  }, [streamId]);

  const handleRaid = useCallback(
    async (targetRef: string) => {
      setShowRaidPicker(false);
      setRaidError(null);
      try {
        const result = await initiateRaid(targetRef);
        if (!result.success) {
          setRaidError(result.error || 'Raid failed');
        }
        // Also emit via socket for instant delivery
        if (streamId) emitRaid(streamId, targetRef);
      } catch (err) {
        setRaidError(err instanceof Error ? err.message : 'Raid failed');
      }
    },
    [streamId, emitRaid]
  );

  const handleOpenHostPicker = useCallback(async () => {
    setShowHostPicker(true);
    setHostPickerLoading(true);
    setHostError(null);
    try {
      const data = await getWebAppLiveStreams();
      const currentRef = streamId ? extractChannelRef(streamId) : null;
      setRaidTargetStreams((data.streams || []).filter(
        (s: LiveStreamWithHost) => s.id !== streamId && s.id !== currentRef
      ));
    } catch {
      setHostError('Failed to load streams');
    } finally {
      setHostPickerLoading(false);
    }
  }, [streamId]);

  const handleSetHost = useCallback(
    async (targetRef: string | null) => {
      setShowHostPicker(false);
      setHostError(null);
      try {
        const result = await setHostedChannel(targetRef);
        if (result.success) {
          setHostedChannelRef(result.hosting);
        } else {
          setHostError(result.error || 'Failed to set hosted channel');
        }
      } catch (err) {
        setHostError(err instanceof Error ? err.message : 'Failed to set hosted channel');
      }
    },
    []
  );

  // Load recent tips
  const loadTips = useCallback(() => {
    getRecentTips()
      .then((data) => setRecentTips((data.tips || []).slice(0, 5)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTips();
    const interval = setInterval(loadTips, 15000);
    return () => clearInterval(interval);
  }, [loadTips]);

  // Socket tip → recent tips
  useEffect(() => {
    if (!latestTip) return;
    const mapped: RecentTip = {
      id: latestTip.id,
      amount: latestTip.amount,
      user_username: latestTip.username,
      model_name: latestTip.performerName,
      created_at: latestTip.createdAt,
      payment_status: "completed",
    };
    setRecentTips((prev) => [mapped, ...prev.filter((t) => t.id !== mapped.id)].slice(0, 5));
  }, [latestTip]);

  // Countdown timer for Dash tip invoice (15-minute expiry)
  useEffect(() => {
    if (!dashTip) {
      if (dashTipCountdownRef.current) {
        clearInterval(dashTipCountdownRef.current);
        dashTipCountdownRef.current = null;
      }
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - dashTip.createdAt) / 1000);
      const remaining = Math.max(0, 900 - elapsed);
      setDashTipSecondsLeft(remaining);
      if (remaining === 0) {
        if (dashTipCountdownRef.current) {
          clearInterval(dashTipCountdownRef.current);
          dashTipCountdownRef.current = null;
        }
        if (dashTipPollRef.current) { clearInterval(dashTipPollRef.current); dashTipPollRef.current = null; }
      }
    };
    tick();
    dashTipCountdownRef.current = setInterval(tick, 1000);
    return () => {
      if (dashTipCountdownRef.current) {
        clearInterval(dashTipCountdownRef.current);
        dashTipCountdownRef.current = null;
      }
    };
  }, [dashTip]);

  const handleTip = async (amount: number) => {
    if (!isAuthenticated) { login(); return; }

    if (tipPaymentTab === "daimo") {
      // For Daimo/USDC tips, create a payment server-side and navigate to the
      // dedicated checkout page in the same tab.  This avoids popup blockers
      // and gives the user the full Daimo embedded modal UX.
      setTipping(true);
      setTipSubmitting(true);
      setTipError(null);
      setTipSuccess(null);
      try {
        const result = await sendTip(streamId || "", amount, undefined, "daimo");
        if (result.paymentUrl) {
          // Open checkout in new tab so user stays on the live stream
          window.open(new URL(assertPaymentUrl(result.paymentUrl)).pathname, "_blank", "noopener,noreferrer");
        } else {
          // Backend returned success but no URL — treat as immediate success
          // (e.g. the tip was credited via a pre-funded balance).
          setTipSuccess(t.live.tipSuccess);
          setTimeout(() => setTipSuccess(null), 3000);
        }
      } catch (err) {
        setTipError(err instanceof Error ? err.message : t.live.tipFailed);
      } finally {
        setTipping(false);
        setTipSubmitting(false);
      }
      return;
    }

    // Dash tip — create BTCPay invoice, show in-app QR
    if (tipPaymentTab === "dash") {
      setTipping(true);
      setTipSubmitting(true);
      setTipError(null);
      setTipSuccess(null);
      try {
        const result = await sendTip(streamId || "", amount, undefined, "dash");
        if (result.invoiceId) {
          setDashTip({ invoiceId: result.invoiceId, checkoutUrl: result.checkoutUrl || "", loading: true, invoiceAmount: amount, createdAt: Date.now() });
          setDashTipSecondsLeft(900);
          // Fetch payment details
          getDashPaymentDetails(result.invoiceId)
            .then((d) => {
              if (d.success) {
                setDashTip((prev) => prev ? { ...prev, destination: d.destination, amount: d.amount, loading: false } : prev);
              } else {
                setDashTip((prev) => prev ? { ...prev, loading: false } : prev);
              }
            })
            .catch(() => {
              setDashTip((prev) => prev ? { ...prev, loading: false } : prev);
            });
          // Poll for payment confirmation
          dashTipPollRef.current = setInterval(async () => {
            try {
              const details = await getDashPaymentDetails(result.invoiceId!);
              if (details.status === "Settled" || details.status === "Complete") {
                if (dashTipPollRef.current) { clearInterval(dashTipPollRef.current); dashTipPollRef.current = null; }
                setDashTipSuccess(true);
                setTimeout(() => {
                  setDashTip(null);
                  setDashTipSuccess(false);
                  setTipSuccess(t.live.tipSuccess);
                  setTimeout(() => setTipSuccess(null), 3000);
                }, 1500);
              }
            } catch { /* ignore */ }
          }, 5000);
        }
      } catch (err) {
        setTipError(err instanceof Error ? err.message : t.live.tipFailed);
      } finally {
        setTipping(false);
        setTipSubmitting(false);
      }
      return;
    }

    // Token tip — fire directly.
    setTipping(true);
    setTipSubmitting(true);
    setTipError(null);
    setTipSuccess(null);
    try {
      await sendTip(streamId || "", amount, undefined, "tokens");
      setTipSuccess(t.live.tipSuccess);
      setTimeout(() => setTipSuccess(null), 3000);
    } catch (err) {
      setTipError(err instanceof Error ? err.message : t.live.tipFailed);
    } finally {
      setTipping(false);
      setTipSubmitting(false);
    }
  };

  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const chatContainerRef = React.useRef<HTMLDivElement>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const videoContainerRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Chat collapsed by default on mobile (improvement #6)
  const [isChatCollapsed, setIsChatCollapsed] = useState(
    () => window.innerWidth < 768
  );

  const isNearBottom = () => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (isNearBottom()) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
  }, [chatMessages]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setHasNewMessages(false);
  };

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    const title = stream?.name ? `${stream.name} — PNPtv Live` : "PNPtv Live";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch {
        // User cancelled or share failed — do nothing
      }
      return;
    }
    // Clipboard fallback for desktop
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard unavailable — silently ignore
    }
  }, [stream?.name]);

  const handleFullscreen = useCallback(() => {
    const el = videoContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Sync isFullscreen state with external fullscreenchange events
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  if (loading || rulesLoading) {
    return (
      <div className="page-container">
        <Skeleton className="w-full rounded-xl" style={{ aspectRatio: "16/9" }} />
        <Skeleton className="h-10 mt-3 rounded-lg" />
        <Skeleton className="h-40 mt-3 rounded-xl" />
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="page-container text-center py-20">
        <p className="text-pnp-textSecondary mb-4">{error || t.live.streamNotFound}</p>
        <button onClick={() => navigate("/live")} className="text-sm text-pnp-accent hover:underline">
          {t.live.backToLive}
        </button>
      </div>
    );
  }

  return (
    <div className="page-container space-y-3">
      <Helmet>
        <title>{stream.name} — PNPtv Live</title>
        <meta name="description" content={stream.description || `Watch ${stream.name} live on PNPtv`} />
      </Helmet>

      {/* Rules acknowledgment gate — shown to authenticated users who have not yet agreed */}
      {!rulesAcknowledged && (
        <LiveRulesModal onAcknowledge={handleAcknowledgeRules} />
      )}

      {/* ── Raid notification overlay ─────────────────────────────────────────
           Shown to all viewers when the streamer initiates a raid.
           Counts down 5s then auto-redirects; viewer can dismiss to stay. */}
      {raidEvent && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          role="alertdialog"
          aria-live="assertive"
          aria-label="Raid in progress"
        >
          <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-pnp-surface border border-pnp-border shadow-2xl overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-pnp-accent via-purple-500 to-pink-500 animate-pulse" />
            <div className="px-6 py-8 flex flex-col items-center gap-4 text-center">
              <div className="text-4xl" aria-hidden="true">🎉</div>
              <div>
                <p className="text-base font-bold text-pnp-textPrimary">Raiding!</p>
                <p className="text-sm text-pnp-textSecondary mt-1">
                  Redirecting to{" "}
                  <span className="text-pnp-accent font-semibold">{raidEvent.targetName}</span>
                </p>
              </div>
              <div className="relative flex items-center justify-center w-16 h-16">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-pnp-border" />
                  <circle
                    cx="32" cy="32" r="28"
                    fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                    className="text-pnp-accent transition-all duration-1000"
                    strokeDasharray={`${2 * Math.PI * 28}`}
                    strokeDashoffset={`${2 * Math.PI * 28 * (1 - (raidCountdown ?? 5) / 5)}`}
                  />
                </svg>
                <span className="text-2xl font-bold text-pnp-textPrimary tabular-nums">
                  {raidCountdown ?? 5}
                </span>
              </div>
              <button
                onClick={dismissRaid}
                className="px-5 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-xs font-semibold text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 transition-colors active:scale-95"
              >
                Stay here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back link + share */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/live")} className="text-xs text-pnp-textSecondary hover:text-pnp-accent transition-colors">
          {String.fromCharCode(8592)} {t.live.backToLive}
        </button>
        <div className="flex items-center gap-1.5">
          {/* Clipboard copy confirmation toast */}
          {shareCopied && (
            <span
              className="text-[10px] text-pnp-textSecondary bg-pnp-surface border border-pnp-border px-2 py-0.5 rounded-full"
              aria-live="polite"
            >
              Copied!
            </span>
          )}
          <button
            onClick={handleShare}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/40 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
            aria-label="Share stream"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
          {/* Raid button — only visible to the stream owner while live */}
          {isStreamOwner && stream.isLive && (
            <div className="relative">
              <button
                onClick={handleOpenRaidPicker}
                className="flex items-center gap-1 h-8 px-2.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-400 hover:bg-purple-500/30 transition-colors active:scale-95 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                aria-label="Raid another stream"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
                Raid
              </button>
              {showRaidPicker && (
                <div className="absolute right-0 top-10 z-50 w-56 rounded-xl bg-pnp-surface border border-pnp-border shadow-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-pnp-border flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-pnp-textPrimary">Raid a live stream</span>
                    <button onClick={() => setShowRaidPicker(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary text-xs" aria-label="Close">✕</button>
                  </div>
                  {raidPickerLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <span className="w-5 h-5 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : raidTargetStreams.length === 0 ? (
                    <p className="text-[11px] text-pnp-textSecondary text-center py-5 px-3">No other streams are live right now.</p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto divide-y divide-pnp-border">
                      {raidTargetStreams.map((s) => (
                        <li key={s.id}>
                          <button onClick={() => handleRaid(s.id)} className="w-full text-left px-3 py-2.5 hover:bg-pnp-surfaceHover transition-colors group">
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                              <span className="text-xs font-medium text-pnp-textPrimary group-hover:text-pnp-accent truncate">{s.name}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Video Player */}
      <div ref={videoContainerRef} className="relative -mx-4 sm:-mx-6">
        {useWebRTC ? (
          jaasError ? (
            <div className="relative aspect-video overflow-hidden rounded-xl bg-pnp-surface border border-pnp-border flex items-center justify-center">
              <div className="text-center px-6">
                <p className="text-pnp-error font-bold mb-2">Unable to Connect</p>
                <p className="text-sm text-pnp-textSecondary mb-4">{jaasError}</p>
                <button
                  onClick={() => {
                    setJaasError(null);
                    setJaasUrl(null);
                    setUseWebRTC(false);
                    setLoading(true);
                    loadStream().finally(() => setLoading(false));
                  }}
                  className="px-5 py-2.5 rounded-lg text-xs font-semibold text-white btn-gradient"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : jaasUrl ? (
            <JitsiMeetComponent
              meetingUrl={jaasUrl}
              roomName={stream.name}
              onCallEnd={() => {
                setJaasUrl(null);
                setUseWebRTC(false);
              }}
              className="w-full aspect-video"
            />
          ) : (
            <div className="relative aspect-video overflow-hidden rounded-xl bg-pnp-surface border border-pnp-border flex items-center justify-center">
              <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )
        ) : (
          <LivePlayer src={stream.hlsUrl} title={stream.name} overlay={overlay} />
        )}
        {streamError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30 rounded-xl">
            <div className="text-center">
              <p className="text-white text-sm font-medium mb-3">Stream failed to load</p>
              <button
                onClick={() => {
                  setStreamError(false);
                  setLoading(true);
                  loadStream().finally(() => setLoading(false));
                }}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold text-white btn-gradient"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Mobile fullscreen toggle button (improvement #6) */}
        <button
          onClick={handleFullscreen}
          className="sm:hidden absolute bottom-14 right-3 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 transition-colors active:scale-95"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25M9 15H4.5M9 15v4.5M9 15l-5.25 5.25" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          )}
        </button>
        {/* Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-10">
          <div className="flex items-center gap-2 flex-wrap">
            {stream.isLive && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-semibold text-white">LIVE</span>
              </span>
            )}
            {viewerCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-white/70">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                </svg>
                {viewerCount} watching
              </span>
            )}
            <span className="text-sm text-white font-medium">{stream.name}</span>
          </div>
          {stream.description && (
            <p className="text-xs text-white/60 mt-1">{stream.description}</p>
          )}
          {stream.tags && stream.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {stream.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded-full text-[9px] font-medium text-white/70 border border-white/20"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Host mode banner — shown when offline but hosting another channel ── */}
      {!stream.isLive && hostedStream && (
        <div className="rounded-xl border border-pnp-accent/30 bg-pnp-accent/5 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-pnp-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-pnp-textPrimary">
                Hosting <span className="text-pnp-accent">{hostedStream.name}</span>
              </p>
              {!hostedStream.isLive && (
                <p className="text-[10px] text-pnp-textSecondary">Hosted stream is currently offline</p>
              )}
            </div>
          </div>
          <button
            onClick={() => navigate(`/stream/${encodeURIComponent(hostedStream.id)}`)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg btn-gradient text-white text-[10px] font-semibold active:scale-95"
          >
            Watch
          </button>
        </div>
      )}

      {/* ── Offline streamer controls — Host mode selector ─────────────────── */}
      {isStreamOwner && stream && !stream.isLive && (
        <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-3 space-y-3">
          <p className="text-[11px] font-semibold text-pnp-textPrimary">Streamer Controls</p>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-pnp-textPrimary">Host Mode</p>
              <p className="text-[10px] text-pnp-textSecondary">
                {hostedChannelRef
                  ? `Hosting: ${hostedStream?.name || hostedChannelRef}`
                  : 'Show another stream while offline'}
              </p>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              {hostedChannelRef && (
                <button
                  onClick={() => handleSetHost(null)}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border border-pnp-border text-pnp-textSecondary hover:text-red-400 hover:border-red-400/40 transition-colors active:scale-95"
                >
                  Clear
                </button>
              )}
              <div className="relative">
                <button
                  onClick={handleOpenHostPicker}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-pnp-accent/20 border border-pnp-accent/40 text-pnp-accent hover:bg-pnp-accent/30 transition-colors active:scale-95"
                >
                  {hostedChannelRef ? 'Change' : 'Set Host'}
                </button>
                {showHostPicker && (
                  <div className="absolute right-0 top-9 z-50 w-56 rounded-xl bg-pnp-surface border border-pnp-border shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-pnp-border flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-pnp-textPrimary">Select stream to host</span>
                      <button onClick={() => setShowHostPicker(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary text-xs" aria-label="Close">✕</button>
                    </div>
                    {hostPickerLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <span className="w-5 h-5 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : raidTargetStreams.length === 0 ? (
                      <p className="text-[11px] text-pnp-textSecondary text-center py-5 px-3">No other streams available.</p>
                    ) : (
                      <ul className="max-h-48 overflow-y-auto divide-y divide-pnp-border">
                        {raidTargetStreams.map((s) => (
                          <li key={s.id}>
                            <button onClick={() => handleSetHost(s.id)} className="w-full text-left px-3 py-2.5 hover:bg-pnp-surfaceHover transition-colors group">
                              <div className="flex items-center gap-2">
                                {s.isLive && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                                <span className="text-xs font-medium text-pnp-textPrimary group-hover:text-pnp-accent truncate">{s.name}</span>
                                {s.isLive && <span className="ml-auto flex-shrink-0 text-[9px] font-bold text-red-400">LIVE</span>}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {(raidError || hostError) && (
            <p className="text-[10px] text-red-400">{raidError || hostError}</p>
          )}
        </div>
      )}

      {/* Reconnecting indicator — shown when socket drops and is attempting to reconnect */}
      {chatReconnecting && !chatConnected && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border" aria-live="polite">
          <span className="w-3 h-3 border border-pnp-textSecondary border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-[10px] text-pnp-textSecondary">Reconnecting to live chat...</span>
        </div>
      )}

      {/* Wallet Balance — Improvement #1 */}
      {isAuthenticated && (
        <div className="flex items-center justify-between px-1 py-1">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#008CE7" }}>
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-white">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.5 14.5h-3v-2h3c.828 0 1.5-.672 1.5-1.5S14.328 11 13.5 11H10V9h3.5c1.933 0 3.5 1.567 3.5 3.5S15.433 16 13.5 16.5z"/>
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-pnp-textPrimary">
              {tokenBalance === null ? "—" : `${tokenBalance} ${t.live.tokens}`}
            </span>
          </div>
          <button
            onClick={() => setShowTopUp(true)}
            className="text-[10px] font-bold text-pnp-accent hover:underline px-2 py-1"
          >
            + Top up
          </button>
        </div>
      )}

      {/* Tip bar */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5 flex-1 overflow-x-auto">
          {TIP_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => handleTip(amount)}
              disabled={tipping}
              className="min-h-[44px] px-3 py-1.5 rounded-lg font-semibold text-xs transition-all text-white active:scale-95 disabled:opacity-50 btn-gradient whitespace-nowrap flex items-center gap-1.5"
            >
              {tipSubmitting && (
                <span className="w-3 h-3 border border-white/60 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              )}
              {tipPaymentTab === "tokens" ? `${amount}T` : `$${amount}`}
            </button>
          ))}
        </div>
        {isAuthenticated && (
          <div className="flex flex-shrink-0 gap-0.5">
            <button
              onClick={() => setTipPaymentTab("tokens")}
              className={`px-2 py-1.5 rounded-l-lg text-[10px] font-medium border transition-colors ${tipPaymentTab === "tokens" ? "bg-pnp-accent/20 border-pnp-accent/40 text-pnp-accent" : "bg-pnp-surface border-pnp-border text-pnp-textSecondary"}`}
            >
              T
            </button>
            <button
              onClick={() => setTipPaymentTab("daimo")}
              className={`px-2 py-1.5 text-[10px] font-medium border-y transition-colors ${tipPaymentTab === "daimo" ? "bg-pnp-accent/20 border-y-pnp-accent/40 text-pnp-accent" : "bg-pnp-surface border-y-pnp-border text-pnp-textSecondary"}`}
            >
              $
            </button>
            <button
              onClick={() => setTipPaymentTab("dash")}
              className={`px-2 py-1.5 rounded-r-lg text-[10px] font-medium border transition-colors ${tipPaymentTab === "dash" ? "bg-[#008DE4]/20 border-[#008DE4]/40 text-[#008DE4]" : "bg-pnp-surface border-pnp-border text-pnp-textSecondary"}`}
            >
              D
            </button>
          </div>
        )}
      </div>
      {tipError && <p className="text-[10px] text-pnp-error">{tipError}</p>}
      {tipSuccess && <p className="text-[10px] text-gradient">{tipSuccess}</p>}

      {/* Dash tip payment widget */}
      {dashTip && (
        <div className="rounded-xl border border-[#008DE4]/40 bg-[#008DE4]/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#008DE4] animate-pulse" />
              <span className="text-[11px] font-medium text-pnp-textPrimary">
                Dash tip — ${dashTip.invoiceAmount}
              </span>
            </div>
            {!dashTipSuccess && (
            <button
              onClick={() => {
                setDashTip(null);
                setDashTipCopied(false);
                setDashTipSecondsLeft(900);
                if (dashTipPollRef.current) { clearInterval(dashTipPollRef.current); dashTipPollRef.current = null; }
              }}
              className="text-[10px] text-pnp-textSecondary hover:text-pnp-textPrimary"
            >
              Cancel
            </button>
            )}
          </div>

          {dashTipSuccess ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-green-400">Tip sent!</p>
            </div>
          ) : dashTipSecondsLeft === 0 ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <p className="text-[11px] font-medium text-red-400">Invoice expired</p>
              <button
                onClick={() => { setDashTip(null); setDashTipCopied(false); setDashTipSecondsLeft(900); }}
                className="px-3 py-1 rounded-lg bg-[#008DE4] text-white text-[10px] font-semibold hover:bg-[#0070b8] transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : dashTip.loading ? (
            <div className="flex items-center justify-center py-4">
              <svg className="animate-spin h-5 w-5 text-[#008DE4]" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : dashTip.destination && dashTip.amount ? (
            <div className="flex flex-col items-center gap-2">
              <div className="bg-white p-2 rounded-lg">
                <QRCodeSVG
                  value={`dash:${dashTip.destination}?amount=${dashTip.amount}`}
                  size={120}
                  level="M"
                />
              </div>
              <p className="text-sm font-bold text-white">{dashTip.amount} DASH</p>

              {/* Compact countdown */}
              <p className={`text-[10px] font-mono tabular-nums ${
                dashTipSecondsLeft <= 60
                  ? "text-red-400"
                  : dashTipSecondsLeft <= 300
                  ? "text-orange-400"
                  : "text-pnp-textSecondary"
              }`}>
                {String(Math.floor(dashTipSecondsLeft / 60)).padStart(2, "0")}:{String(dashTipSecondsLeft % 60).padStart(2, "0")} remaining
              </p>

              <div
                className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <code className="flex-1 text-[9px] text-white/70 break-all font-mono">{dashTip.destination}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(dashTip.destination!).catch(() => {});
                    setDashTipCopied(true);
                    setTimeout(() => setDashTipCopied(false), 2000);
                  }}
                  className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: dashTipCopied ? "#34C759" : "#008DE4" }}
                >
                  {dashTipCopied ? "Copied!" : "Copy"}
                </button>
              </div>
              <a
                href={dashTip.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] hover:underline"
                style={{ color: "#008DE4" }}
              >
                Open in BTCPay
              </a>
            </div>
          ) : (
            <a
              href={dashTip.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center py-2 rounded-lg bg-[#008DE4] text-white text-xs font-semibold"
            >
              Open Dash Checkout
            </a>
          )}
        </div>
      )}

      {/* Recent tips */}
      {recentTips.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {recentTips.map((tip) => (
            <div key={tip.id} className="flex-shrink-0 px-2.5 py-1 rounded-full bg-pnp-surface border border-pnp-border text-[10px]">
              <span className="text-gradient font-medium">${tip.amount}</span>
              <span className="text-pnp-textSecondary mx-1">by</span>
              <span className="text-pnp-textPrimary">@{tip.user_username}</span>
              <span className="text-pnp-textSecondary/50 ml-1">{formatTimeAgo(tip.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Live Chat — collapsible on mobile (improvement #6) */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-pnp-textPrimary">{t.live.liveChatTitle}</h3>
            <span className={`flex items-center gap-1 text-[10px] ${chatConnected ? "text-pnp-textSecondary" : "text-pnp-textSecondary/50"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${chatConnected ? "bg-green-500" : "bg-pnp-textSecondary/30"}`} />
              {chatConnected ? t.live.chatConnected : t.live.chatConnecting}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {socketError && <span className="text-[10px] text-pnp-error">{socketError}</span>}
            {/* Collapse toggle — always visible on mobile, available on desktop too */}
            <button
              onClick={() => setIsChatCollapsed((v) => !v)}
              className="p-1 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
              aria-label={isChatCollapsed ? "Expand chat" : "Collapse chat"}
            >
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${isChatCollapsed ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {!isChatCollapsed && (
          <>
            <div className="relative">
              {hasNewMessages && (
                <button
                  onClick={scrollToBottom}
                  className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-pnp-accent text-white text-[10px] font-semibold shadow-lg"
                >
                  New messages
                </button>
              )}
              <div ref={chatContainerRef} className="h-48 overflow-y-auto space-y-1 mb-2 pr-1" style={{ scrollbarWidth: "thin" }}>
                {chatMessages.length === 0 ? (
                  <p className="text-[10px] text-pnp-textSecondary text-center py-4">
                    {chatConnected ? t.live.beFirstToChat : t.live.connectingToChat}
                  </p>
                ) : (
                  // FE-M4: render at most the latest 50 messages to avoid
                  // long DOM lists degrading scroll performance on mobile.
                  chatMessages.slice(-50).map((msg) => (
                    <div key={msg.id} className="text-xs">
                      <span className="font-medium text-gradient">@{msg.username}</span>
                      <span className="text-pnp-textSecondary mx-1">·</span>
                      <span className="text-pnp-textPrimary">{msg.content}</span>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            {isAuthenticated ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && chatInput.trim()) {
                      sendMessage(chatInput.trim());
                      setChatInput("");
                    }
                  }}
                  maxLength={500}
                  className="flex-1 rounded-lg bg-pnp-surface border border-pnp-border px-3 py-1.5 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent"
                />
                <button
                  onClick={() => {
                    if (chatInput.trim()) {
                      sendMessage(chatInput.trim());
                      setChatInput("");
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg btn-gradient text-white text-xs font-medium"
                >
                  Send
                </button>
              </div>
            ) : (
              <button onClick={login} className="text-xs text-pnp-accent hover:underline">
                {t.live.logInToChat}
              </button>
            )}
          </>
        )}
      </Card>

      <BuyTokensModal
        isOpen={showTopUp}
        onClose={() => setShowTopUp(false)}
        onSuccess={(newBalance) => setTokenBalance(newBalance)}
      />
    </div>
  );
}
