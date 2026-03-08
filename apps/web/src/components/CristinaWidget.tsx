import React, { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getSocket } from "@/lib/socket";
import {
  getSupportSuggestions,
  sendSupportMessage,
  clearSupportHistory,
  createSupportTicket,
  getSupportTicket,
  getTicketMessages,
  addTicketMessage,
  type SupportTicket,
  type TicketMessage,
  type TicketCategory,
} from "@/lib/api";

interface SupportSuggestion {
  id: string;
  label: string;
  icon: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

type WidgetView = "helpCenter" | "chat" | "tutorial" | "ticketForm" | "ticketView";

interface CristinaWidgetProps {
  mode?: "widget" | "page";
}

interface TutorialStep {
  title: string;
  description: string;
  action?: string;
}

interface TutorialTopic {
  id: string;
  emoji: string;
  steps: TutorialStep[];
}

const TUTORIAL_TOPICS: TutorialTopic[] = [
  {
    id: "getting-started",
    emoji: "🚀",
    steps: [
      { title: "Welcome to PNPtv!", description: "PNPtv is your queer PNP community app. You can browse the social feed, watch live streams, join Hangouts video rooms, find people nearby, and unlock exclusive content with PRIME." },
      { title: "Complete Your Profile", description: "Go to your Profile (bottom nav → person icon). Tap the camera icon to upload a photo, add your bio, set your location, and fill in your interests. A complete profile gets more attention!", action: "Go to Profile" },
      { title: "Verify Your Age", description: "Some content requires age verification. In Profile → Settings, you can complete age verification using your date of birth. This is required to access creator content.", action: "Go to Settings" },
      { title: "Accept Community Terms", description: "Read and accept the community guidelines in Profile → Settings → Terms & Conditions. This unlocks full access to the platform.", action: "Go to Settings" },
    ],
  },
  {
    id: "social-feed",
    emoji: "📝",
    steps: [
      { title: "Browse the Social Feed", description: "Tap 'Social' in the bottom navigation to see posts from the community. Scroll through to discover what's being shared." },
      { title: "Like & Comment on Posts", description: "Tap the heart icon to like a post. Tap the comment bubble to expand replies and write your own. Your engagement helps creators know you appreciate their content." },
      { title: "Create a Post", description: "Tap the compose area at the top of the Social feed (or Home). Write your text, attach a photo or video, and tap Send. You can also post exclusively for PRIME members if you're a creator." },
      { title: "Translate Posts", description: "Tap the globe/translate icon on any post to translate it to your language automatically. Tap again to show the original." },
      { title: "Share Posts", description: "Tap the share icon to share a post link. You'll be asked to accept the Content Sharing Disclaimer once — after that, sharing is instant." },
    ],
  },
  {
    id: "live-streams",
    emoji: "📺",
    steps: [
      { title: "Find Live Streams", description: "Tap 'Live' in the bottom navigation to see all active streams. Look for the red LIVE badge on performer cards." },
      { title: "Watch a Stream", description: "Tap any live card to open the stream player. You can chat in the live chat on the right side while watching." },
      { title: "Go Live (Browser)", description: "In the Live page, tap 'Go Live'. Choose 'Stream from this device' to broadcast using your camera and microphone directly from the app.", action: "Go to Live" },
      { title: "Go Live (OBS/RTMP)", description: "Prefer OBS or a streaming app? In the Go Live modal, your RTMP URL and Stream Key are shown. Enter these into OBS → Settings → Stream to broadcast.", action: "Go to Live" },
    ],
  },
  {
    id: "nearby",
    emoji: "📍",
    steps: [
      { title: "Enable Location", description: "Go to Nearby (bottom nav → map pin icon). Allow location access when prompted. Your exact location is never stored — only a general area." },
      { title: "Discover Nearby People", description: "Browse members in your area on the map and list view. You can filter by activity and distance radius." },
      { title: "Connect with Someone", description: "Tap a profile card to view their profile. If they're a PRIME member or you are, you can send them a direct message.", action: "Go to Nearby" },
      { title: "Privacy Controls", description: "In Profile → Settings, you can hide your location, set your visibility, or disable Nearby entirely at any time." },
    ],
  },
  {
    id: "hangouts",
    emoji: "🎥",
    steps: [
      { title: "What are Hangouts?", description: "Hangouts are live video rooms where community members can join, see each other on camera, and chat in real time. Think of them like casual video lounges." },
      { title: "Join a Hangout", description: "Go to Hangouts (bottom nav). Tap any active room card to join. You'll be asked to enable your camera and microphone.", action: "Go to Hangouts" },
      { title: "Create a Room", description: "Tap the '+' or 'Create Room' button in Hangouts to open your own room. Give it a name, set it public or invite-only, and start your session." },
      { title: "Manage Your Room", description: "As a room host, you can mute participants, remove disruptive users, and close the room at any time using the host controls panel." },
    ],
  },
  {
    id: "prime",
    emoji: "👑",
    steps: [
      { title: "What is PRIME?", description: "PRIME is the premium membership tier on PNPtv. PRIME members unlock direct messaging, exclusive creator content, priority in Nearby, HD streaming, and more." },
      { title: "Subscribe to PRIME", description: "Go to Subscribe (bottom nav → star icon or the upgrade banner). Choose a plan and complete payment. Your PRIME status activates instantly.", action: "Go to Subscribe" },
      { title: "PRIME Plans", description: "There are multiple PRIME plans: monthly, quarterly, and yearly. Yearly plans offer the best value. Check the Subscribe page for current pricing." },
      { title: "Check Your Status", description: "In Profile → Settings → Membership, you can see your current tier, plan expiry, and manage your subscription at any time.", action: "Go to Profile" },
    ],
  },
  {
    id: "creator",
    emoji: "🎭",
    steps: [
      { title: "What is a Creator?", description: "Creators are verified members who can post exclusive content, receive subscriber payments, go live as performers, and appear in the Featured section." },
      { title: "Apply to Be a Creator", description: "Go to Profile → Settings → Creator Program and submit your application. Include your bio, content type, and links. Our team reviews applications within 48 hours.", action: "Go to Profile" },
      { title: "Post Exclusive Content", description: "Once approved, when creating a post you'll have an option to mark it as 'Exclusive — PRIME subscribers only'. This content is paywalled for non-subscribers." },
      { title: "Get Your Subscribers", description: "Your creator profile appears on the Performers section of the Live page. Promote your PNPtv profile on your socials to bring in new subscribers." },
      { title: "Go Live as a Creator", description: "Creators with an assigned Restreamer channel can broadcast live. Go to your Profile and tap 'Go Live' — your stream appears on the Live page instantly.", action: "Go to Live" },
    ],
  },
];

export function CristinaWidget({ mode = "widget" }: CristinaWidgetProps) {
  const { user } = useAuth();
  const location = useLocation();
  const { support: t } = useI18n();
  const [isOpen, setIsOpen] = useState(mode === "page");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SupportSuggestion[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ticket state
  const [view, setView] = useState<WidgetView>("helpCenter");
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<TicketCategory | null>(null);
  const [ticketDescription, setTicketDescription] = useState("");
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [hasUnreadReply, setHasUnreadReply] = useState(false);

  // Tutorial state
  const [selectedTutorial, setSelectedTutorial] = useState<string | null>(null);
  const [tutorialStep, setTutorialStep] = useState(0);

  // Refs that mirror isOpen/view so socket listeners can read current values
  // without being re-registered every time these state values change.
  const isOpenRef = useRef(isOpen);
  const viewRef = useRef(view);

  // Compute derived values before hooks that depend on them.
  const isOnboarded = !!(user?.ageVerified && user?.termsAccepted);
  const lang = user?.language === "es" ? "es" : "en";

  // Gate ticket creation behind 3 user messages
  const MIN_TURNS_FOR_TICKET = 3;
  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const canCreateTicket = userMessageCount >= MIN_TURNS_FOR_TICKET;
  const hasOpenTicket = !!(ticket && ticket.status !== "closed");

  // In widget mode, suppress the FAB and panel on routes that have their own
  // fixed bottom input bars (Hangouts chat, Direct Messages conversation) to
  // prevent the widget from overlapping the send button.
  const SUPPRESSED_PATHS = ["/chat", "/messages"];
  const isSuppressedRoute =
    mode === "widget" &&
    SUPPRESSED_PATHS.some((p) => location.pathname.startsWith(p));

  // All hooks are declared unconditionally before any early returns (Rules of Hooks).

  // Keep refs in sync with state so socket listeners avoid stale closures
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { viewRef.current = view; }, [view]);

  // Load suggestions on first open
  useEffect(() => {
    if (!isOnboarded || isSuppressedRoute) return;
    if (isOpen && suggestions.length === 0) {
      getSupportSuggestions(lang)
        .then((res) => {
          if (res.success) setSuggestions(res.suggestions);
        })
        .catch(() => {});
    }
  }, [isOpen, lang, isOnboarded, isSuppressedRoute]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, ticketMessages, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Check for existing open ticket when widget opens
  useEffect(() => {
    if (isOpen) {
      getSupportTicket()
        .then((data) => {
          if (data.success && data.ticket && data.ticket.status !== "closed") {
            setTicket(data.ticket);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Poll for ticket messages when in ticket view
  useEffect(() => {
    if (view !== "ticketView" || !ticket) return;

    // Initial fetch
    getTicketMessages()
      .then((data) => {
        if (data.success) setTicketMessages(data.messages);
      })
      .catch(() => {});

    const interval = setInterval(() => {
      setTicketMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        const since = lastMsg?.created_at;
        getTicketMessages(since)
          .then((data) => {
            if (data.success && data.messages.length > 0) {
              setTicketMessages((current) => {
                const existingIds = new Set(current.map((m) => m.id));
                const newMsgs = data.messages.filter(
                  (m) => !existingIds.has(m.id)
                );
                return newMsgs.length > 0 ? [...current, ...newMsgs] : current;
              });
            }
          })
          .catch(() => {});
        return prev;
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [view, ticket]);

  // Real-time Socket.IO listeners for support events.
  // Registered once per onboarded session; refs are used to read current
  // isOpen/view values without re-registering listeners on every state change.
  useEffect(() => {
    if (!isOnboarded) return;

    const socket = getSocket();

    const onNewMessage = (data: {
      id: number;
      sender_type: string;
      sender_name: string;
      content: string;
      created_at: string;
    }) => {
      setTicketMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        return [...prev, data as TicketMessage];
      });
      // Use refs to avoid stale closure over isOpen/view
      if (!isOpenRef.current || viewRef.current !== "ticketView") {
        setHasUnreadReply(true);
      }
    };

    const onStatusChange = (data: { status: string; updatedAt: string }) => {
      setTicket((prev) =>
        prev ? { ...prev, status: data.status as SupportTicket["status"] } : prev
      );
    };

    socket.on("support:newMessage", onNewMessage);
    socket.on("support:statusChange", onStatusChange);

    return () => {
      socket.off("support:newMessage", onNewMessage);
      socket.off("support:statusChange", onStatusChange);
    };
  }, [isOnboarded]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      try {
        const res = await sendSupportMessage(text.trim(), lang);
        if (res.success && res.response) {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              content: res.response,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            content: t.chatError,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, lang, t.chatError]
  );

  const handleNewConversation = useCallback(async () => {
    try {
      await clearSupportHistory();
    } catch {}
    setMessages([]);
    setView("helpCenter");
    setSelectedTutorial(null);
    setTutorialStep(0);
  }, []);

  const handleCreateTicket = async () => {
    if (!selectedCategory || ticketDescription.trim().length < 10) return;
    setIsSubmittingTicket(true);
    try {
      const data = await createSupportTicket(
        selectedCategory,
        ticketDescription.trim()
      );
      if (data.success) {
        setTicket(data.ticket);
        setView("ticketView");
        setSelectedCategory(null);
        setTicketDescription("");
      }
    } catch {
      // No-op: ticket creation failure is silent; user can retry
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  const handleSendTicketMessage = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setInput("");

    // Optimistic update
    const optimisticMsg: TicketMessage = {
      id: Date.now(),
      sender_type: "user",
      sender_name: "You",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setTicketMessages((prev) => [...prev, optimisticMsg]);

    try {
      await addTicketMessage(msg);
    } catch {
      // Remove optimistic message on failure
      setTicketMessages((prev) =>
        prev.filter((m) => m.id !== optimisticMsg.id)
      );
    }
  };

  // Early exits — after ALL hooks have been declared.
  if (!isOnboarded) return null;
  if (isSuppressedRoute) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (view === "ticketView") {
      handleSendTicketMessage();
    } else {
      sendMessage(input);
    }
  };

  // Category definitions — labels come from i18n
  const TICKET_CATEGORIES: { key: TicketCategory; emoji: string; label: string }[] = [
    { key: "payment", emoji: "💳", label: t.categoryPayment },
    { key: "account", emoji: "👤", label: t.categoryAccount },
    { key: "bug", emoji: "🐛", label: t.categoryBug },
    { key: "feature", emoji: "🚀", label: t.categoryFeature },
    { key: "technical", emoji: "🛠", label: t.categoryTechnical },
    { key: "general", emoji: "📋", label: t.categoryGeneral },
  ];

  // Helper: map topic id to translated name
  const getTopicName = (topicId: string): string => {
    const map: Record<string, string> = {
      "getting-started": t.tutTopicGettingStarted,
      "social-feed": t.tutTopicSocialFeed,
      "live-streams": t.tutTopicLiveStreams,
      "nearby": t.tutTopicNearby,
      "hangouts": t.tutTopicHangouts,
      "prime": t.tutTopicPrime,
      "creator": t.tutTopicCreator,
    };
    return map[topicId] ?? topicId;
  };

  // FAB button (widget mode only)
  if (mode === "widget" && !isOpen) {
    return (
      <div className="fixed bottom-20 right-3 z-[38] flex flex-col items-end gap-2 sm:bottom-24 sm:right-4 safe-area-bottom">
        <button
          onClick={() => { setIsOpen(true); setHasUnreadReply(false); }}
          className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-lg flex items-center justify-center text-xl sm:text-2xl transition-transform hover:scale-110 active:scale-95"
          style={{
            background: "linear-gradient(135deg, #5BC8F5, #00D4E8)",
          }}
          aria-label={t.openWidgetAriaLabel}
        >
          {/* Pulse ring */}
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              background: "linear-gradient(135deg, #5BC8F5, #00D4E8)",
              opacity: 0.3,
              animationDuration: "2.5s",
            }}
          />
          {/* Glow halo */}
          <span
            className="absolute -inset-1 rounded-full"
            style={{
              background: "linear-gradient(135deg, #5BC8F5, #00D4E8)",
              opacity: 0.25,
              filter: "blur(8px)",
            }}
          />
          <span className="relative">🧜‍♀️</span>
          {/* Unread reply notification dot */}
          {hasUnreadReply && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500" />
            </span>
          )}
        </button>
      </div>
    );
  }

  const chatPanel = (
    <div
      className={
        mode === "page"
          ? "flex flex-col h-[calc(100dvh-12rem)] max-h-[800px] glass-card-sm rounded-2xl overflow-hidden"
          : "fixed z-[42] flex flex-col overflow-hidden shadow-2xl " +
            "inset-0 w-full h-full " +
            "sm:inset-auto sm:bottom-24 sm:right-4 sm:w-[400px] sm:h-[600px] sm:rounded-2xl"
      }
      style={{
        background: "rgba(20, 20, 30, 0.98)",
        ...(mode === "page" ? { border: "1px solid rgba(255,255,255,0.08)" } : {}),
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-pnp-border flex-shrink-0"
        style={{ background: "rgba(30, 30, 45, 0.95)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🧜‍♀️</span>
          <div>
            <h3 className="text-sm font-semibold text-pnp-textPrimary">{t.widgetName}</h3>
            <p className="text-[10px] text-pnp-textSecondary">
              {t.widgetSubtitle}
            </p>
            <span
              className="inline-block mt-0.5 px-1.5 py-0 text-[9px] font-bold rounded-full uppercase tracking-wider"
              style={{ background: "rgba(91,200,245,0.2)", color: "#5BC8F5", border: "1px solid rgba(91,200,245,0.35)" }}
            >
              {t.helpTag}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Ticket icon button — only visible after 3 turns or if user has an open ticket */}
          {(canCreateTicket || hasOpenTicket) && (
            <button
              onClick={() => { ticket ? setView("ticketView") : setView("ticketForm"); setHasUnreadReply(false); }}
              className="relative p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title={t.supportTicketTitle}
            >
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {hasOpenTicket && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-400 rounded-full" />
              )}
            </button>
          )}

          <button
            onClick={handleNewConversation}
            className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
            title={t.newConversationTitle}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {mode === "widget" && (
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* HELP CENTER VIEW                                                     */}
      {/* ------------------------------------------------------------------ */}
      {view === "helpCenter" && (
        <div className="flex-1 overflow-y-auto p-4">
          {/* Open ticket banner */}
          {ticket && ticket.status !== "closed" && (
            <div
              onClick={() => { setView("ticketView"); setHasUnreadReply(false); }}
              className="mb-4 px-3 py-2 bg-cyan-900/40 border border-cyan-500/30 rounded-lg cursor-pointer hover:bg-cyan-900/60 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-300">📋 {t.openTicketBanner}</span>
                <span className="text-xs text-cyan-400 font-medium">{t.viewTicketLink}</span>
              </div>
            </div>
          )}

          {/* Greeting */}
          <div className="text-center mb-5 mt-2">
            <span className="text-4xl block mb-2">🧜‍♀️</span>
            <h4 className="text-sm font-semibold text-white mb-1">{t.helpCenterTitle}</h4>
            <p className="text-xs" style={{ color: "#8E8E93" }}>{t.helpCenterSubtitle}</p>
          </div>

          {/* 2x2 category grid */}
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            {/* Membership */}
            <button
              onClick={() => {
                setView("chat");
                sendMessage(lang === "es"
                  ? "¿Cuál es mi estado de membresía actual? Cuéntame sobre los planes PRIME disponibles y qué está incluido."
                  : "What is my current membership status? Tell me about the available PRIME plans and what's included.");
              }}
              className="flex flex-col items-start p-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: "rgba(91,200,245,0.08)", border: "1px solid rgba(91,200,245,0.2)" }}
            >
              <span className="text-xl mb-1.5">💳</span>
              <p className="text-xs font-semibold text-white leading-tight">{t.catMembership}</p>
              <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "#8E8E93" }}>{t.catMembershipDesc}</p>
            </button>

            {/* How to Use */}
            <button
              onClick={() => {
                setView("tutorial");
                setSelectedTutorial(null);
                setTutorialStep(0);
              }}
              className="flex flex-col items-start p-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: "rgba(91,200,245,0.08)", border: "1px solid rgba(91,200,245,0.2)" }}
            >
              <span className="text-xl mb-1.5">📱</span>
              <p className="text-xs font-semibold text-white leading-tight">{t.catHowToUse}</p>
              <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "#8E8E93" }}>{t.catHowToUseDesc}</p>
            </button>

            {/* Being a Creator */}
            <button
              onClick={() => {
                setView("chat");
                sendMessage(lang === "es"
                  ? "¿Cómo me convierto en creador en PNPtv? ¿Cuáles son los requisitos y beneficios?"
                  : "How do I become a creator on PNPtv? What are the requirements and benefits?");
              }}
              className="flex flex-col items-start p-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.2)" }}
            >
              <span className="text-xl mb-1.5">🎭</span>
              <p className="text-xs font-semibold text-white leading-tight">{t.catCreator}</p>
              <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "#8E8E93" }}>{t.catCreatorDesc}</p>
            </button>

            {/* Wellness & Community */}
            <button
              onClick={() => {
                setView("chat");
                sendMessage(lang === "es"
                  ? "Cuéntame sobre las pautas de la comunidad PNPtv y qué recursos de bienestar y apoyo comunitario están disponibles."
                  : "Tell me about the PNPtv community guidelines and what wellness resources and community support are available.");
              }}
              className="flex flex-col items-start p-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }}
            >
              <span className="text-xl mb-1.5">💚</span>
              <p className="text-xs font-semibold text-white leading-tight">{t.catWellness}</p>
              <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "#8E8E93" }}>{t.catWellnessDesc}</p>
            </button>
          </div>

          {/* Chat with Cristina CTA */}
          <button
            onClick={() => setView("chat")}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }}
          >
            {t.helpCenterChatBtn}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* TUTORIAL VIEW                                                        */}
      {/* ------------------------------------------------------------------ */}
      {view === "tutorial" && (
        <div className="flex-1 overflow-y-auto p-4">
          {/* Back button + title */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => {
                if (selectedTutorial) {
                  setSelectedTutorial(null);
                  setTutorialStep(0);
                } else {
                  setView("helpCenter");
                }
              }}
              className="text-gray-400 hover:text-white transition-colors text-xs font-medium"
            >
              {t.tutorialBack}
            </button>
            <h3 className="text-white font-semibold text-sm">{t.tutorialTitle}</h3>
          </div>

          {selectedTutorial === null ? (
            /* Topic list */
            <div className="space-y-2">
              {TUTORIAL_TOPICS.map((topic) => {
                const topicName = getTopicName(topic.id);
                return (
                  <button
                    key={topic.id}
                    onClick={() => { setSelectedTutorial(topic.id); setTutorialStep(0); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:bg-white/10 active:scale-[0.98]"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <span className="text-2xl flex-shrink-0">{topic.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{topicName}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>{topic.steps.length} steps</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Step view */
            (() => {
              const topic = TUTORIAL_TOPICS.find((tp) => tp.id === selectedTutorial);
              if (!topic) return null;
              const step = topic.steps[tutorialStep];
              const isLast = tutorialStep === topic.steps.length - 1;
              const topicName = getTopicName(topic.id);
              return (
                <div className="flex flex-col h-full">
                  {/* Topic header */}
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-2xl">{topic.emoji}</span>
                    <div>
                      <p className="text-xs font-semibold text-white">{topicName}</p>
                      <p className="text-[10px]" style={{ color: "#8E8E93" }}>{t.tutorialStepOf} {tutorialStep + 1} {t.tutorialOf} {topic.steps.length}</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1 rounded-full mb-4" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div
                      className="h-1 rounded-full transition-all"
                      style={{ width: `${((tutorialStep + 1) / topic.steps.length) * 100}%`, background: "linear-gradient(90deg, #5BC8F5, #00D4E8)" }}
                    />
                  </div>

                  {/* Step dots */}
                  <div className="flex gap-1.5 mb-4 justify-center">
                    {topic.steps.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setTutorialStep(i)}
                        className="w-2 h-2 rounded-full transition-all"
                        style={{ background: i === tutorialStep ? "#5BC8F5" : "rgba(255,255,255,0.2)" }}
                      />
                    ))}
                  </div>

                  {/* Step content card */}
                  <div className="rounded-xl p-4 mb-4 flex-1" style={{ background: "rgba(91,200,245,0.06)", border: "1px solid rgba(91,200,245,0.15)" }}>
                    <h4 className="text-sm font-bold text-white mb-2">{step.title}</h4>
                    <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>{step.description}</p>
                    {step.action && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs font-medium" style={{ color: "#5BC8F5" }}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {step.action}
                      </div>
                    )}
                  </div>

                  {/* Navigation */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTutorialStep((s) => Math.max(0, s - 1))}
                      disabled={tutorialStep === 0}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/20 text-white/70 hover:border-white/40 transition-colors disabled:opacity-30"
                    >
                      {t.tutorialPrev}
                    </button>
                    {isLast ? (
                      <button
                        onClick={() => { setSelectedTutorial(null); setTutorialStep(0); }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                        style={{ background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }}
                      >
                        {t.tutorialDone}
                      </button>
                    ) : (
                      <button
                        onClick={() => setTutorialStep((s) => Math.min(topic.steps.length - 1, s + 1))}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                        style={{ background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }}
                      >
                        {t.tutorialNext}
                      </button>
                    )}
                  </div>

                  {/* Ask Cristina */}
                  <button
                    onClick={() => {
                      setView("chat");
                      sendMessage(`${lang === "es" ? "Tengo una pregunta sobre" : "I have a question about"}: ${topicName} — ${step.title}`);
                    }}
                    className="mt-2 w-full py-2 rounded-xl text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
                    style={{ background: "rgba(91,200,245,0.06)", border: "1px solid rgba(91,200,245,0.15)" }}
                  >
                    {t.tutorialAskCristina}
                  </button>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* TICKET FORM VIEW                                                     */}
      {/* ------------------------------------------------------------------ */}
      {view === "ticketForm" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Back + title */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setView("chat")}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h3 className="text-white font-semibold text-sm">
              {t.createTicketTitle}
            </h3>
          </div>

          {/* Category selection */}
          <div>
            <p className="text-xs text-gray-400 mb-2">
              {t.selectCategoryLabel}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TICKET_CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    selectedCategory === cat.key
                      ? "bg-cyan-500/30 border border-cyan-400 text-cyan-200"
                      : "bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10"
                  }`}
                >
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-xs text-gray-400 mb-2">
              {t.describeIssueLabel}
            </p>
            <textarea
              value={ticketDescription}
              onChange={(e) =>
                setTicketDescription(e.target.value.slice(0, 2000))
              }
              placeholder={t.descriptionPlaceholder}
              className="w-full h-32 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-cyan-500/50"
            />
            <p className="text-xs text-gray-500 mt-1 text-right">
              {ticketDescription.length}/2000
            </p>
          </div>

          {/* Submit */}
          <button
            onClick={handleCreateTicket}
            disabled={
              !selectedCategory ||
              ticketDescription.trim().length < 10 ||
              isSubmittingTicket
            }
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors bg-gradient-to-r from-cyan-500 to-teal-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:from-cyan-400 hover:to-teal-400"
          >
            {isSubmittingTicket ? t.submittingTicket : t.submitTicketBtn}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* TICKET VIEW                                                          */}
      {/* ------------------------------------------------------------------ */}
      {view === "ticketView" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Back + title + status badge */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setView("chat")}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h3 className="text-white font-semibold text-sm">
              {t.supportTicketViewTitle}
            </h3>
            <span
              className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                ticket?.status === "open"
                  ? "bg-green-500/20 text-green-400"
                  : ticket?.status === "resolved"
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-gray-500/20 text-gray-400"
              }`}
            >
              {ticket?.status ?? "open"}
            </span>
          </div>

          {/* Ticket info card */}
          {ticket && (
            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="capitalize">{ticket.category ?? "general"}</span>
                <span>•</span>
                <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                {ticket.first_response_at && (
                  <>
                    <span>•</span>
                    <span className="text-green-400">
                      {t.ticketReplied}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          {ticketMessages.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-8">
              {t.waitingForSupport}
            </div>
          ) : (
            ticketMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.sender_type === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    msg.sender_type === "user"
                      ? "bg-cyan-600/30 text-cyan-100 rounded-br-md"
                      : "bg-white/10 text-gray-200 rounded-bl-md"
                  }`}
                >
                  {msg.sender_type === "agent" && (
                    <p className="text-xs text-cyan-400 font-medium mb-1">
                      💬 {msg.sender_name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* CHAT VIEW (AI)                                                       */}
      {/* ------------------------------------------------------------------ */}
      {view === "chat" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Open ticket banner */}
          {ticket && ticket.status !== "closed" && (
            <div
              onClick={() => { setView("ticketView"); setHasUnreadReply(false); }}
              className="mx-0 mt-0 px-3 py-2 bg-cyan-900/40 border border-cyan-500/30 rounded-lg cursor-pointer hover:bg-cyan-900/60 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-300">
                  📋 {t.openTicketBanner}
                </span>
                <span className="text-xs text-cyan-400 font-medium">
                  {t.viewTicketLink}
                </span>
              </div>
            </div>
          )}

          {messages.length === 0 && !isLoading && (
            <div className="animate-fade-in-up">
              {/* Back to Help Center link */}
              <button
                onClick={() => setView("helpCenter")}
                className="text-xs mb-4"
                style={{ color: "#5BC8F5" }}
              >
                ← Back to Help Center
              </button>

              {/* Welcome message */}
              <div className="text-center mb-6 mt-4">
                <span className="text-4xl block mb-2">🧜‍♀️</span>
                <h4 className="text-sm font-semibold text-pnp-textPrimary mb-1">
                  {t.welcomeGreeting}
                </h4>
                <p className="text-xs text-pnp-textSecondary">
                  {t.welcomeSubtitle}
                </p>
              </div>
              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-2 justify-center">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => sendMessage(s.label)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: "rgba(0, 212, 232, 0.15)",
                      border: "1px solid rgba(0, 212, 232, 0.3)",
                      color: "rgba(255, 255, 255, 0.9)",
                    }}
                  >
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              } animate-fade-in-up`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user" ? "text-white" : "text-pnp-textPrimary"
                }`}
                style={
                  msg.role === "user"
                    ? { background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }
                    : { background: "rgba(255, 255, 255, 0.06)" }
                }
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* "Still need help?" banner — shown after 3 user messages, no open ticket */}
          {canCreateTicket && !hasOpenTicket && !isLoading && (
            <div className="animate-fade-in-up">
              <button
                onClick={() => setView("ticketForm")}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors hover:bg-white/10"
                style={{
                  background: "rgba(0, 212, 232, 0.08)",
                  border: "1px solid rgba(0, 212, 232, 0.2)",
                }}
              >
                <svg
                  className="w-3.5 h-3.5 text-cyan-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span className="text-cyan-300">
                  {t.stillNeedHelp}
                </span>
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex justify-start animate-fade-in-up">
              <div
                className="px-4 py-3 rounded-2xl flex items-center gap-1"
                style={{ background: "rgba(255, 255, 255, 0.06)" }}
              >
                <span
                  className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-pnp-textSecondary animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input area — hidden in ticketForm, helpCenter, and tutorial views */}
      {view !== "ticketForm" && view !== "helpCenter" && view !== "tutorial" && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 p-3 pb-safe border-t border-pnp-border flex-shrink-0"
          style={{
            background: "rgba(30, 30, 45, 0.95)",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              view === "ticketView"
                ? t.inputPlaceholderTicket
                : t.inputPlaceholderChat
            }
            maxLength={1000}
            disabled={isLoading}
            className="flex-1 bg-white/5 border border-pnp-border rounded-xl px-3 py-2 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-cyan-400/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2 rounded-xl transition-all disabled:opacity-30"
            style={{
              background:
                input.trim() && !isLoading
                  ? "linear-gradient(135deg, #5BC8F5, #00D4E8)"
                  : "rgba(255,255,255,0.05)",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m22 2-7 20-4-9-9-4z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </form>
      )}
    </div>
  );

  // Widget mode: show backdrop on mobile
  if (mode === "widget") {
    return (
      <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-[41] sm:hidden"
          onClick={() => setIsOpen(false)}
        />
        {chatPanel}
      </>
    );
  }

  return chatPanel;
}

export default CristinaWidget;
