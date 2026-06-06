import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RadioPanel, EqualizerBars } from "@/components/RadioWidget";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";
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
  verifyPaymentWithCristina,
  activateMeruCode,
  logUse,
  type SupportTicket,
  type TicketMessage,
  type TicketCategory,
  type PaymentVerificationResult,
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

type WidgetView = "helpCenter" | "chat" | "tutorial" | "ticketForm" | "ticketView" | "paymentVerify" | "meruActivate";
type CristinaTab = "ai" | "vj";

interface CristinaWidgetProps {
  mode?: "widget" | "page";
  compact?: boolean;
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
      { title: "Welcome to PNPtv!", description: "PNPtv is your queer PNP community app. Browse the social feed, watch live streams, join Hangouts video rooms, find people nearby, send DMs, buy tokens, and unlock exclusive content with PRIME." },
      { title: "Complete Your Profile", description: "Tap the person icon in the bottom nav to open your Profile. Tap the camera icon on your avatar to upload a photo. Then fill in your first name, bio, interests, and location. Profiles with photos and bios get much more engagement!", action: "Go to Profile" },
      { title: "Add Your Social Links", description: "In your Profile, scroll to the social links section. You can add your X (Twitter), Instagram, TikTok, and YouTube handles. These appear on your profile card and help others find you.", action: "Go to Profile" },
      { title: "Verify Your Age", description: "Go to Profile → Settings (gear icon). Enter your date of birth to verify you're 18+. Age verification is required to view creator content and access certain features.", action: "Go to Settings" },
      { title: "Accept Community Terms", description: "In Profile → Settings, read and accept the Terms & Conditions. This is required to unlock full access to the platform including posting, messaging, and engaging with content.", action: "Go to Settings" },
    ],
  },
  {
    id: "social-feed",
    emoji: "📝",
    steps: [
      { title: "Browse the Feed", description: "Tap 'Social' in the bottom navigation. You'll see three tabs: 'For You' (algorithm picks), 'Following' (posts from people you follow), and 'Explore' (trending posts). Scroll to discover content." },
      { title: "Like a Post", description: "Tap the heart icon below any post to like it. The heart turns pink and the like count updates instantly. Tap again to unlike. Creators can see who liked their posts." },
      { title: "Comment & Reply", description: "Tap the comment bubble icon to expand the replies section below a post. You'll see existing replies and a text input to write your own. Type your reply (up to 500 characters) and tap Send." },
      { title: "Create a Text Post", description: "At the top of the Social feed (or Home page), tap the compose area. Type your message and tap the Send button. Your post appears instantly in the community feed." },
      { title: "Post Photos & Videos", description: "When composing a post, tap the camera/image icon to attach media. You can upload photos (JPG, PNG, WebP) or videos (MP4, WebM). Posts can include both text and media." },
      { title: "Post Exclusive Content", description: "If you're an approved creator, you'll see a toggle to mark a post as 'Exclusive — PRIME subscribers only'. Non-PRIME users will see a locked placeholder instead of your content." },
      { title: "Translate Posts", description: "Tap the globe icon (translate) on any post to automatically translate it to your language. The icon turns teal when translation is active. Tap 'Show original' to revert." },
      { title: "Share a Post", description: "Tap the share icon on a post. The first time, you'll see the Content Sharing Disclaimer — accept it once (this is permanent and cannot be undone). After that, sharing opens your device's share sheet or copies the link." },
      { title: "Delete Your Post", description: "On your own posts, you'll see a delete (trash) icon. Tap it and confirm to permanently remove the post. Admins can also remove posts that violate community guidelines." },
    ],
  },
  {
    id: "live-streams",
    emoji: "📺",
    steps: [
      { title: "Find Live Streams", description: "Tap 'Live' in the bottom navigation. The page shows performer cards — look for the red 'LIVE' badge to find who's currently streaming. Cards show the performer's name, photo, and online status." },
      { title: "Watch a Stream", description: "Tap any performer card with a LIVE badge. The stream player opens with the video feed. Below or beside the player you'll find the live chat where you can interact with the streamer and other viewers." },
      { title: "Go Live from Browser", description: "Tap the 'Go Live' button on the Live page. In the modal, choose 'Stream from this device'. This opens the built-in Streamer Dashboard — an OBS-like interface right in your browser.", action: "Go to Live" },
      { title: "Streamer Dashboard: Camera & Preview", description: "In the Streamer Dashboard, your camera preview appears in the center. You can select which camera to use from the dropdown. The preview shows exactly what viewers will see." },
      { title: "Streamer Dashboard: Audio Controls", description: "The Audio Mixer panel lets you control your microphone level. You can see the volume meter in real time. Use the mute button to quickly mute/unmute your mic during the stream." },
      { title: "Streamer Dashboard: Quality Settings", description: "Choose a quality preset (720p, 1080p, etc.) that matches your internet speed. Higher quality needs more bandwidth. You can also adjust FPS (frames per second) — 30fps is standard, 60fps is smoother." },
      { title: "Streamer Dashboard: Going Live", description: "When everything looks good, tap 'Start Streaming'. Your stream begins broadcasting to the Live page. The dashboard shows your stream status, duration, and lets you stop at any time." },
      { title: "Go Live with OBS/RTMP", description: "In the Go Live modal, you'll see your RTMP URL and Stream Key. In OBS: go to Settings → Stream → select 'Custom', paste the RTMP URL and Stream Key. Click 'Start Streaming' in OBS.", action: "Go to Live" },
      { title: "Go Live from Profile", description: "You can also start streaming from your Profile page. If you have an assigned channel, you'll see a 'Go Live' button. Tap it to open the same streaming options.", action: "Go to Profile" },
    ],
  },
  {
    id: "nearby",
    emoji: "📍",
    steps: [
      { title: "Open Connect", description: "Tap the map pin icon in the bottom navigation to open Connect. The first time, your browser will ask permission to access your location — tap 'Allow'. Your exact coordinates are never stored, only a general area." },
      { title: "Map & List Views", description: "PNP Connect has two views: Map (shows pins on a map where users are) and List (shows profile cards sorted by distance). Switch between them using the toggle at the top." },
      { title: "Adjust Your Radius", description: "Use the distance radius filter to control how far you want to search. You can set it from a few kilometers to a wider range. Only users within your selected radius will appear." },
      { title: "View a Profile", description: "Tap any user card or map pin to view their profile. You'll see their photo, bio, interests, and distance from you. From there you can follow them or send a DM.", action: "Go to Connect" },
      { title: "Privacy: Hide Your Location", description: "Go to Profile → Settings. You can toggle 'Show location' off to hide yourself from Connect entirely. Other users won't see you on the map or list. You can re-enable it anytime." },
      { title: "Privacy: Control Visibility", description: "In Profile → Settings, you can control what others see: show/hide your bio, date of birth, interests, and online status. You can also toggle 'Allow messages' to block DMs from strangers." },
    ],
  },
  {
    id: "hangouts",
    emoji: "🎥",
    steps: [
      { title: "What are Hangouts?", description: "Hangouts are group chats and community spaces. Video calls in Hangouts happen through Telegram — join the group's Telegram chat and start a video call natively in the app." },
      { title: "Join a Hangout Room", description: "Go to Hangouts from the bottom navigation. You'll see a list of community rooms. Tap a room card to join the chat. Video calls are started via Telegram.", action: "Go to Hangouts" },
      { title: "Video Calls via Telegram", description: "When someone starts a video call in a hangout, you'll see a notification. Open Telegram and join the call there. Telegram's native video calls support camera, microphone, and screen sharing." },
      { title: "Mute Your Microphone", description: "Inside a Hangout, look for the microphone icon in the video controls bar. Tap it to mute — a line appears through the mic icon. Tap again to unmute. Muting is useful when there's background noise or you're just listening." },
      { title: "Turn Off Your Camera", description: "Tap the camera icon in the controls bar to toggle your camera on/off. When your camera is off, others see your avatar/name instead of your video feed. Useful for saving bandwidth or privacy." },
      { title: "Fullscreen & Picture-in-Picture", description: "Tap the fullscreen icon to expand the video room to fill your screen. Press Escape to exit fullscreen. You can also use Picture-in-Picture (PiP) mode to shrink the video to a small floating window while you use other parts of the app." },
      { title: "Create Your Own Room", description: "Tap the '+' or 'Create Room' button. Give your room a name, choose whether it's public (anyone can join) or invite-only. PRIME members can host rooms — hosts have extra controls for managing participants." },
      { title: "Host Controls", description: "As a room host, you have special powers: mute individual participants, remove disruptive users, and close the room entirely when you're done. These controls appear in the participant list." },
    ],
  },
  {
    id: "prime",
    emoji: "👑",
    steps: [
      { title: "What PRIME Unlocks", description: "PRIME is the premium tier. It unlocks: exclusive creator content, priority in Connect, HD live streaming, Hangout hosting, and VIP support." },
      { title: "Choose Your Plan", description: "Go to the Subscribe page. Available plans: PRIME Week Pass ($15.00, 7 days), Monthly ($25.00, 30 days), Crystal ($49.99, 6 months), Diamond ($99.99, 1 year — best value), and Lifetime ($249.99, pay once, forever).", action: "Go to Subscribe" },
      { title: "Pay with Credit/Debit Card", description: "On the Subscribe page, select your plan and tap 'Pay with Card'. This uses ePayco and supports Visa, Mastercard, and other major cards. You can pay in USD or COP (Colombian pesos). Follow the secure checkout form." },
      { title: "Pay with Dash (Crypto)", description: "Select your plan and tap 'Pay with Dash'. The in-app widget shows a QR code, the exact Dash amount, and the destination address. Open your Dash wallet, scan the code, and send the amount. The system polls for confirmation and activates your PRIME automatically — usually within a few minutes." },
      { title: "Use an Activation Code", description: "Have a Meru activation code? On the Subscribe page, enter it in the activation code field. If you forgot your code, you must provide a bank statement screenshot showing the amount, date, and exact hour of payment via support ticket." },
      { title: "Check Your Membership Status", description: "Go to Profile → Settings → Membership section. You'll see your current tier (FREE, Member, or PRIME), your plan name, expiry date, and subscription status. This refreshes automatically from the database.", action: "Go to Profile" },
      { title: "FREE vs PRIME Comparison", description: "FREE: Social Feed, public Hangouts, basic Connect, unlimited DMs, Cristina AI support. PRIME adds: exclusive content, private Hangouts hosting, HD streaming, priority Connect, VIP support." },
    ],
  },
  {
    id: "creator",
    emoji: "🎭",
    steps: [
      { title: "What is a Creator?", description: "Creators are verified members who can post exclusive PRIME-only content, go live as performers, appear in the Featured section, receive subscriber payments, and build an audience on PNPtv." },
      { title: "Apply to Be a Creator", description: "Go to Profile → Settings → Creator Program. Fill in your application: bio, the type of content you plan to create, and any relevant links (social media, portfolio). Submit and wait — applications are reviewed within 48 hours.", action: "Go to Profile" },
      { title: "Creator Profile Setup", description: "Once approved, your profile gets a verified badge. Make sure your profile photo, bio, and social links are complete — this is what potential subscribers see when deciding to follow you." },
      { title: "Post Exclusive Content", description: "When creating a post, toggle the 'Exclusive' switch. This marks it as PRIME-only. Non-subscribers see a locked card with your name and a 'Subscribe to unlock' prompt instead of your content." },
      { title: "Go Live as a Performer", description: "Approved creators with an assigned Restreamer channel can broadcast live. Go to your Profile and tap 'Go Live'. Choose browser streaming or RTMP/OBS. Your stream appears on the Live page for all users to see.", action: "Go to Live" },
      { title: "Grow Your Audience", description: "Your creator profile appears in the Featured Performers section on the Live page and Home. Share your PNPtv profile link on your other social platforms (X, Instagram, etc.) to bring followers to PNPtv." },
      { title: "Subscriber Revenue", description: "When users subscribe to your creator profile, you earn revenue. Manage your creator wallet in Profile → Creator settings. You can view your subscriber count, earnings, and withdrawal options." },
    ],
  },
  {
    id: "payments",
    emoji: "💳",
    steps: [
      { title: "Payment Methods Overview", description: "PNPtv accepts three payment methods: ePayco (credit/debit cards), Dash via BTCPay (private crypto), and Meru activation codes. Choose whichever is most convenient for you." },
      { title: "Step 1: Choose Your Plan", description: "Go to the Subscribe page from the bottom nav or the upgrade banner on Home. Browse available plans — each shows the price, duration, and what's included. Tap a plan card to select it.", action: "Go to Subscribe" },
      { title: "Credit/Debit Card via ePayco", description: "After selecting a plan, tap 'Pay with Card'. The ePayco secure checkout opens. Enter your card number, expiry date, CVV, and name. Supports Visa, Mastercard, Amex. Payments can be in USD or COP (auto-detected by your region)." },
      { title: "ePayco: Completing Payment", description: "After entering your card details, tap 'Pay'. You may need to complete 3D Secure verification (a popup from your bank). Once approved, your PRIME status activates automatically and you're redirected back to PNPtv." },
      { title: "Anonymous Crypto via Dash/BTCPay", description: "Tap 'Pay with Dash'. A BTCPay invoice is generated with a QR code, the exact Dash amount, and the destination address. Open your Dash wallet, scan the code, and send the amount. The system polls for confirmation. Good for maximum privacy — no personal info required." },
      { title: "Dash: Payment Confirmation", description: "After sending Dash, the app polls BTCPay for confirmation. Once confirmed (usually 2–5 minutes thanks to InstantSend), your PRIME activates automatically. You'll see a confirmation screen." },
      { title: "Activation Codes (Meru)", description: "If you have a Meru code (from email, promotions, or referrals), go to Subscribe and enter it in the activation code field. Tap 'Activate'. If you forgot your code, you must provide a bank statement screenshot showing the amount, date, and hour of payment via support ticket to recover it." },
      { title: "Payment Issues?", description: "If your payment fails: check your card has sufficient funds, ensure 3D Secure popup wasn't blocked, or try a different payment method. For crypto, make sure you sent the exact amount to the correct address. Contact Cristina AI or email support@pnptv.app for help." },
    ],
  },
  {
    id: "tokens",
    emoji: "🪙",
    steps: [
      { title: "What are PNP Tokens?", description: "PNP Tokens are the in-app currency. You can use tokens to tip creators, make in-app purchases, and unlock special features. Tokens are separate from your PRIME subscription." },
      { title: "Buy Tokens", description: "Go to the Token Checkout page. You'll see available token packages at different price points. Select a package to proceed to payment.", action: "Go to Token Checkout" },
      { title: "Pay for Tokens", description: "Token purchases support ePayco (credit/debit cards) and Dash via BTCPay (private crypto). Select your preferred method and complete the payment flow." },
      { title: "Check Your Balance", description: "Your token balance is shown in your wallet. You can access it from your Profile or the token section. The balance updates in real time after purchases." },
      { title: "View Purchase History", description: "Your token transaction history shows all purchases and spending. Each entry includes the amount, date, and type of transaction." },
    ],
  },
  {
    id: "dms",
    emoji: "✉️",
    steps: [
      { title: "What are DMs?", description: "Direct Messages let you have private one-on-one conversations with other users. You can send text messages plus photos and videos (up to 50MB per file)." },
      { title: "Open Your Messages", description: "Tap the Messages icon in the navigation to see your message threads. Each thread shows the other person's name, avatar, last message preview, and timestamp." },
      { title: "Start a Conversation", description: "To message someone new, visit their profile and tap the message/DM button. This creates a new thread. Note: FREE users can send up to 3 DMs per day. PRIME users have unlimited messaging." },
      { title: "Send Text Messages", description: "Type your message in the input field at the bottom (up to 1000 characters). Press Enter or tap Send. Messages appear instantly — the other person gets a notification." },
      { title: "Send Photos & Videos", description: "Tap the attachment icon (camera/clip) in the message input area. Choose a photo (JPG, PNG, WebP, GIF, HEIC) or video (MP4, WebM) up to 50MB. A preview appears before sending. Tap the images to view them in a full-screen lightbox." },
      { title: "FREE DM Limits", description: "FREE users can send up to 3 DMs per day. After reaching the limit, you'll see a message saying the limit is reached. Upgrade to PRIME for unlimited messaging, or wait until the next day." },
      { title: "Block Messages", description: "Don't want messages from strangers? Go to Profile → Settings and toggle 'Allow messages' off. This prevents anyone you don't follow from sending you DMs." },
    ],
  },
  {
    id: "profile",
    emoji: "👤",
    steps: [
      { title: "Access Your Profile", description: "Tap the person icon in the bottom navigation. Your profile page shows your avatar, name, bio, posts, followers, and following count. This is what others see when they visit your profile." },
      { title: "Upload Your Photo", description: "Tap the camera icon on your avatar circle. Choose a photo from your device. The image is cropped to a circle automatically. A good profile photo makes you more recognizable in the community." },
      { title: "Edit Your Bio & Info", description: "Tap the 'Edit Profile' button. Fill in your first name, last name, bio (tell others about yourself), and interests. These fields help others know who you are." },
      { title: "Set Your Location", description: "In Edit Profile, you can set your location text (city/region you want to display) and your actual city/country. Your location helps the Nearby feature connect you with people in your area." },
      { title: "Add Social Links", description: "Add your handles for X (Twitter), Instagram, TikTok, and YouTube. These appear as clickable links on your profile card so others can find you on other platforms." },
      { title: "Privacy: Show/Hide Fields", description: "In Profile → Settings, you can toggle visibility for each field: show/hide date of birth, location, bio, interests, and online status. Hidden fields are not visible to other users." },
      { title: "Privacy: Message Controls", description: "Toggle 'Allow messages' to control who can DM you. When off, only users you follow can message you. When on, any user can start a conversation." },
      { title: "Privacy: Online Status", description: "Toggle 'Show online status' to hide when you're active on the platform. When hidden, other users won't see a green dot next to your name." },
      { title: "View Your Posts", description: "Your profile page shows all your posts in a timeline. You can see likes, comments, and engagement on each post. You can delete any of your own posts from here." },
      { title: "Followers & Following", description: "See who follows you and who you follow. Tap the followers/following count to see the full list. You can follow/unfollow people from their profiles." },
    ],
  },
  {
    id: "referrals",
    emoji: "🎁",
    steps: [
      { title: "What is the Referral Program?", description: "Earn free PRIME days by inviting friends to PNPtv! When someone joins using your referral link, both of you benefit. It's the easiest way to get PRIME without paying." },
      { title: "Find Your Referral Link", description: "Go to your Profile page. In the stats or settings section, you'll find your unique referral link and a 'Copy' button. Each user has a unique code that tracks referrals.", action: "Go to Profile" },
      { title: "Share Your Link", description: "Copy your referral link and share it anywhere — on social media, in messages, or with friends directly. When someone signs up using your link, the system tracks it automatically." },
      { title: "Earn Rewards", description: "When a referred friend joins PNPtv, you earn free PRIME days added to your subscription. The more friends you invite, the more free PRIME time you accumulate." },
      { title: "Track Your Referrals", description: "On your Profile, you can see your referral stats: how many people you've referred, how many signed up, and how many free PRIME days you've earned." },
    ],
  },
];

// ── Contextual suggestions per page ──────────────────────────────────────────
interface ContextChip { icon: string; en: string; es: string }
interface PageContext { titleEn: string; titleEs: string; chips: ContextChip[] }

const PAGE_CONTEXT: { match: (p: string) => boolean; ctx: PageContext }[] = [
  {
    match: (p) => p.startsWith("/chat") || p === "/",
    ctx: {
      titleEn: "Hangouts & Video Rooms",
      titleEs: "Hangouts y Salas de Video",
      chips: [
        { icon: "📹", en: "How do I join a Hangout video call?", es: "¿Cómo me uno a una videollamada de Hangout?" },
        { icon: "🔒", en: "How do private Hangout rooms work?", es: "¿Cómo funcionan las salas privadas de Hangout?" },
        { icon: "👥", en: "How do I create my own Hangout group?", es: "¿Cómo creo mi propio grupo de Hangout?" },
        { icon: "🎙️", en: "Can I share my screen in a Hangout?", es: "¿Puedo compartir pantalla en un Hangout?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/live"),
    ctx: {
      titleEn: "Live Streams",
      titleEs: "Transmisiones en Vivo",
      chips: [
        { icon: "📺", en: "How do I watch a live stream?", es: "¿Cómo veo una transmisión en vivo?" },
        { icon: "🎬", en: "How do I start streaming on PNPtv?", es: "¿Cómo empiezo a transmitir en PNPtv?" },
        { icon: "💎", en: "How do tips work during a live stream?", es: "¿Cómo funcionan las propinas durante un stream?" },
        { icon: "📅", en: "How do I book a streaming time slot?", es: "¿Cómo reservo un horario para transmitir?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/social"),
    ctx: {
      titleEn: "Social Feed",
      titleEs: "Feed Social",
      chips: [
        { icon: "📝", en: "How do I create a post?", es: "¿Cómo creo una publicación?" },
        { icon: "🔐", en: "How do exclusive/PRIME-only posts work?", es: "¿Cómo funcionan las publicaciones exclusivas PRIME?" },
        { icon: "🌐", en: "Can I cross-post to X?", es: "¿Puedo publicar en X a la vez?" },
        { icon: "💬", en: "How do comments and replies work?", es: "¿Cómo funcionan los comentarios y respuestas?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/nearby") || p.startsWith("/explore"),
    ctx: {
      titleEn: "PNP Connect & Explore",
      titleEs: "PNP Connect y Explorar",
      chips: [
        { icon: "📍", en: "How does the Nearby feature work?", es: "¿Cómo funciona la función Cercanos?" },
        { icon: "🗺️", en: "How do I share my location?", es: "¿Cómo comparto mi ubicación?" },
        { icon: "🏳️‍🌈", en: "What are Places and how do I find them?", es: "¿Qué son los Lugares y cómo los encuentro?" },
        { icon: "👁️", en: "Who can see my location?", es: "¿Quién puede ver mi ubicación?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/dm"),
    ctx: {
      titleEn: "Direct Messages",
      titleEs: "Mensajes Directos",
      chips: [
        { icon: "✉️", en: "How do I send a DM?", es: "¿Cómo envío un mensaje directo?" },
        { icon: "🚫", en: "How do I block someone from messaging me?", es: "¿Cómo bloqueo a alguien para que no me escriba?" },
        { icon: "📷", en: "Can I send photos or media in DMs?", es: "¿Puedo enviar fotos o media en DMs?" },
        { icon: "🔔", en: "How do DM notifications work?", es: "¿Cómo funcionan las notificaciones de DMs?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/profile") || p === "/settings",
    ctx: {
      titleEn: "Profile & Settings",
      titleEs: "Perfil y Configuración",
      chips: [
        { icon: "📸", en: "How do I change my profile photo?", es: "¿Cómo cambio mi foto de perfil?" },
        { icon: "🔗", en: "How do I add my social media links?", es: "¿Cómo agrego mis redes sociales?" },
        { icon: "🔒", en: "How do privacy settings work?", es: "¿Cómo funcionan los ajustes de privacidad?" },
        { icon: "✅", en: "How do I verify my age?", es: "¿Cómo verifico mi edad?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/subscribe"),
    ctx: {
      titleEn: "Subscription & Plans",
      titleEs: "Suscripción y Planes",
      chips: [
        { icon: "💳", en: "What are the PRIME plan options?", es: "¿Cuáles son las opciones del plan PRIME?" },
        { icon: "🪙", en: "How do PNP tokens work?", es: "¿Cómo funcionan los tokens PNP?" },
        { icon: "💰", en: "What payment methods are accepted?", es: "¿Qué métodos de pago se aceptan?" },
        { icon: "🔄", en: "How do I cancel or change my plan?", es: "¿Cómo cancelo o cambio mi plan?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/channels"),
    ctx: {
      titleEn: "Media & Content",
      titleEs: "Media y Contenido",
      chips: [
        { icon: "🎵", en: "How does the radio/music player work?", es: "¿Cómo funciona el reproductor de música/radio?" },
        { icon: "📻", en: "How do I request a song?", es: "¿Cómo pido una canción?" },
        { icon: "📺", en: "What content is available on Channels?", es: "¿Qué contenido hay en Canales?" },
      ],
    },
  },
  {
    match: (p) => p.startsWith("/creators") || p.startsWith("/apply") || p.startsWith("/become"),
    ctx: {
      titleEn: "Creator Tools",
      titleEs: "Herramientas de Creador",
      chips: [
        { icon: "🎭", en: "How do I become a creator on PNPtv?", es: "¿Cómo me convierto en creador en PNPtv?" },
        { icon: "💵", en: "How do creator earnings and payouts work?", es: "¿Cómo funcionan las ganancias y pagos de creadores?" },
        { icon: "📊", en: "Where can I see my analytics?", es: "¿Dónde puedo ver mis estadísticas?" },
        { icon: "🎥", en: "How do I schedule a live stream?", es: "¿Cómo programo una transmisión en vivo?" },
      ],
    },
  },
];

function getPageContext(pathname: string): PageContext | null {
  for (const entry of PAGE_CONTEXT) {
    if (entry.match(pathname)) return entry.ctx;
  }
  return null;
}

export function CristinaWidget({ mode = "widget", compact = false }: CristinaWidgetProps) {
  const { user, isAdmin, refreshUser } = useAuth();
  const { support: t } = useI18n();
  const { isPlaying: musicIsPlaying } = useMusicPlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(mode === "page");

  // Self-Care satellite FAB — sits below Cristina, expands into a 3-button
  // radial fan: auto-log slam, auto-log smoke, jump to /self-care. The
  // satellite is always rendered when the parent FAB is rendered (i.e. when
  // the widget is in widget mode and not currently open). Expansion state and
  // toast confirmation are local to this widget.
  const [selfCareFanOpen, setSelfCareFanOpen] = useState(false);
  const [selfCareToast, setSelfCareToast] = useState<{ kind: "slam" | "smoke"; count: number; until: number } | null>(null);
  const selfCareBusyRef = useRef<"slam" | "smoke" | null>(null);
  const handleSelfCareLog = useCallback(async (kind: "slam" | "smoke") => {
    if (selfCareBusyRef.current) return;
    selfCareBusyRef.current = kind;
    setSelfCareFanOpen(false);
    try {
      const res = await logUse(kind);
      const count = res[kind]?.today ?? 1;
      setSelfCareToast({ kind, count, until: Date.now() + 2500 });
    } catch {
      // Silent — failures here would be jarring. The Settings card surfaces
      // load/save problems; this FAB is fire-and-forget on purpose.
    } finally {
      selfCareBusyRef.current = null;
    }
  }, []);
  // Auto-clear toast after its lifetime.
  useEffect(() => {
    if (!selfCareToast) return;
    const remaining = selfCareToast.until - Date.now();
    const t = window.setTimeout(() => setSelfCareToast(null), Math.max(0, remaining));
    return () => window.clearTimeout(t);
  }, [selfCareToast]);
  // Close the fan when clicking outside it.
  useEffect(() => {
    if (!selfCareFanOpen) return;
    const onDocClick = () => setSelfCareFanOpen(false);
    // Defer one tick so the open-click doesn't immediately close.
    const t = window.setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [selfCareFanOpen]);
  const [activeTab, setActiveTab] = useState<CristinaTab>("ai");

  // FAB auto-cycles through tab colors when closed
  const FAB_COLORS = [
    "linear-gradient(135deg, #8B5CF6, #D946EF)",  // purple (VJ)
    "linear-gradient(135deg, #5BC8F5, #00D4E8)",  // cyan (AI)
  ] as const;
  const [fabColorIdx, setFabColorIdx] = useState(0);
  useEffect(() => {
    if (isOpen) return;
    // Skip animation cycling if user prefers reduced motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setFabColorIdx((i) => (i + 1) % 2), 3000);
    return () => clearInterval(timer);
  }, [isOpen]);
  const fabGradient = FAB_COLORS[fabColorIdx];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SupportSuggestion[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ticket state
  // Land users directly in chat. The previous "helpCenter" hub was removed
  // because it duplicated chat (every tile just sent a canned prompt) and
  // mixed concerns (radio shortcuts, payment activation, AI chat). Chat is
  // now the single primary surface; secondary tools live in a slim toolbar.
  const [view, setView] = useState<WidgetView>("chat");
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<TicketCategory | null>(null);
  const [ticketDescription, setTicketDescription] = useState("");
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [hasUnreadReply, setHasUnreadReply] = useState(false);

  // Payment verification state (admin-only)
  const [pvUserId, setPvUserId] = useState("");
  const [pvProvider, setPvProvider] = useState("epayco");
  const [pvReference, setPvReference] = useState("");
  const [pvAmount, setPvAmount] = useState("");
  const [pvPlanId, setPvPlanId] = useState("");
  const [pvNotes, setPvNotes] = useState("");
  const [pvLoading, setPvLoading] = useState(false);
  const [pvResult, setPvResult] = useState<PaymentVerificationResult | null>(null);
  const [pvActivated, setPvActivated] = useState<{ success: boolean; granted?: number; error?: string } | null>(null);

  // Meru code activation state (available to all users)
  const [meruCode, setMeruCode] = useState("");
  const [meruEmail, setMeruEmail] = useState("");
  const [meruSubmitting, setMeruSubmitting] = useState(false);
  const [meruError, setMeruError] = useState<string | null>(null);
  const [meruSuccess, setMeruSuccess] = useState(false);

  // Removed 2026-04-25: handleRadioModeSelect / loadingMode / modeCacheRef.
  // Radio shortcuts (Take Off / Flying / Landing) didn't belong in the
  // support widget — users have a dedicated Radio feature in /media. The
  // VJ tab still retains its own controls if it ever gets re-opened from
  // an external entry point.

  const handleMeruActivate = useCallback(async () => {
    const trimmedCode = meruCode.trim();
    const trimmedEmail = meruEmail.trim();
    if (!trimmedCode || meruSubmitting) return;
    const langEs = user?.language === "es";
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) || trimmedEmail.length > 254) {
      setMeruError(langEs ? "Por favor ingresa un correo electrónico válido" : "Please enter a valid email address");
      return;
    }
    setMeruSubmitting(true);
    setMeruError(null);
    try {
      const result = await activateMeruCode(trimmedCode, trimmedEmail);
      if (result.success) {
        setMeruSuccess(true);
        await refreshUser();
        // Auto-return to help center after celebration.
        setTimeout(() => {
          setMeruSuccess(false);
          setMeruCode("");
          setMeruEmail("");
          setView("chat");
        }, 3200);
      } else {
        setMeruError(result.error || (langEs ? "Error en la activación" : "Activation failed"));
      }
    } catch (err: unknown) {
      const fallback = langEs ? "Error al activar" : "Activation error";
      setMeruError(err instanceof Error ? err.message : fallback);
    } finally {
      setMeruSubmitting(false);
    }
  }, [meruCode, meruEmail, meruSubmitting, user?.language, refreshUser]);

  // FAB corner: tl/tr/bl/br — draggable to any corner
  type Corner = "tl" | "tr" | "bl" | "br";
  const [fabCorner, setFabCorner] = useState<Corner>(() => {
    try { return (localStorage.getItem("cristina_fab_corner") as Corner) || "tr"; } catch { return "tr"; }
  });
  const fabRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; dragging: boolean; moved: boolean }>({ startX: 0, startY: 0, dragging: false, moved: false });

  const handleFabPointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, dragging: true, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleFabPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) dragState.current.moved = true;
    if (!dragState.current.moved || !fabRef.current) return;
    fabRef.current.style.transition = "none";
    fabRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  }, []);

  const handleFabPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return;
    const wasDragged = dragState.current.moved;
    dragState.current.dragging = false;
    if (!wasDragged) return;
    e.preventDefault();
    e.stopPropagation();
    if (fabRef.current) { fabRef.current.style.transition = ""; fabRef.current.style.transform = ""; }
    const isLeft = e.clientX < window.innerWidth / 2;
    const isTop = e.clientY < window.innerHeight / 2;
    const newCorner: Corner = isTop ? (isLeft ? "tl" : "tr") : (isLeft ? "bl" : "br");
    setFabCorner(newCorner);
    try { localStorage.setItem("cristina_fab_corner", newCorner); } catch {}
  }, []);

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

  // Contextual suggestions based on current page
  const pageCtx = useMemo(() => getPageContext(location.pathname), [location.pathname]);
  const contextChips = useMemo(() => {
    if (!pageCtx) return [];
    return pageCtx.chips.map((c, i) => ({
      id: `ctx-${i}`,
      label: lang === "es" ? c.es : c.en,
      icon: c.icon,
    }));
  }, [pageCtx, lang]);

  // Gate ticket creation behind 3 user messages
  const MIN_TURNS_FOR_TICKET = 3;
  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const canCreateTicket = userMessageCount >= MIN_TURNS_FOR_TICKET;
  const hasOpenTicket = !!(ticket && ticket.status !== "closed");

  // All hooks are declared unconditionally before any early returns (Rules of Hooks).

  // Keep refs in sync with state so socket listeners avoid stale closures
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { viewRef.current = view; }, [view]);

  // Escape key closes the widget (unless focus is inside the chat input)
  useEffect(() => {
    if (!isOpen || mode !== "widget") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (inputRef.current && document.activeElement === inputRef.current) return;
      setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, mode]);

  // Load suggestions on first open
  useEffect(() => {
    if (!isOnboarded) return;
    if (isOpen && suggestions.length === 0) {
      getSupportSuggestions(lang)
        .then((res) => {
          if (res.success) setSuggestions(res.suggestions);
        })
        .catch(() => {});
    }
  }, [isOpen, lang, isOnboarded]);

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
    setView("chat");
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
      "payments": t.tutTopicPayments,
      "tokens": t.tutTopicTokens,
      "dms": t.tutTopicDms,
      "profile": t.tutTopicProfile,
      "referrals": t.tutTopicReferrals,
    };
    return map[topicId] ?? topicId;
  };

  // Compact FAB (widget strip mode)
  if (compact && !isOpen) {
    return (
      <button
        onClick={() => { setIsOpen(true); setHasUnreadReply(false); }}
        className="relative w-9 h-9 rounded-full shadow-lg flex items-center justify-center text-sm transition-all active:scale-90"
        style={{ background: fabGradient }}
        aria-label={t.openWidgetAriaLabel}
      >
        <span role="img" aria-label="Cristina AI" className="w-full h-full flex items-center justify-center text-lg">🧜‍♀️</span>
        {hasUnreadReply && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-black" />
        )}
        {musicIsPlaying && !hasUnreadReply && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-1 ring-black animate-pulse" />
        )}
      </button>
    );
  }

  // FAB button (widget mode only)
  if (mode === "widget" && !isOpen) {
    const isTopCorner = fabCorner.startsWith("t");
    const isLeftCorner = fabCorner.endsWith("l");
    const fabPosStyle = {
      [isTopCorner ? "top" : "bottom"]: "5rem",
      [isLeftCorner ? "left" : "right"]: "0.75rem",
      touchAction: "none" as const,
    };
    return (
      <div
        ref={fabRef}
        className={`fixed z-[38] flex flex-col ${isLeftCorner ? "items-start" : "items-end"} gap-2`}
        style={fabPosStyle}
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={handleFabPointerUp}
      >
        <button
          onClick={() => { if (!dragState.current.moved) { setIsOpen(true); setHasUnreadReply(false); } }}
          className="relative w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-all hover:scale-110 active:scale-95"
          style={{ background: fabGradient }}
          aria-label={t.openWidgetAriaLabel}
        >
          {/* Pulse ring */}
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: fabGradient, opacity: 0.3, animationDuration: "2.5s" }}
          />
          {/* Glow halo */}
          <span
            className="absolute -inset-1 rounded-full"
            style={{ background: fabGradient, opacity: 0.25, filter: "blur(8px)" }}
          />
          <span role="img" aria-label="Cristina AI" className="w-full h-full flex items-center justify-center text-lg relative">🧜‍♀️</span>
          {/* Unread reply notification dot */}
          {hasUnreadReply && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500" />
            </span>
          )}
          {/* Music playing indicator */}
          {musicIsPlaying && !hasUnreadReply && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 ring-2 ring-[rgba(20,20,30,0.98)] animate-pulse" />
          )}
        </button>

        {/* Self-Care satellite FAB — always visible below Cristina. Tap to fan
            out three quick actions: log slam, log smoke, open Self-Care
            Center. Stays out of the way (smaller, calmer color) so it never
            competes with Cristina's primary FAB visually. */}
        <SelfCareSatellite
          isLeftCorner={isLeftCorner}
          fanOpen={selfCareFanOpen}
          toast={selfCareToast}
          onToggle={() => {
            if (dragState.current.moved) return;
            setSelfCareFanOpen((v) => !v);
          }}
          onLog={handleSelfCareLog}
          onOpenCenter={() => {
            setSelfCareFanOpen(false);
            navigate("/self-care");
          }}
        />
      </div>
    );
  }

  const chatPanel = (
    <div
      className={
        mode === "page"
          ? "flex flex-col h-[calc(100dvh-12rem)] max-h-[800px] glass-card-sm rounded-2xl overflow-hidden"
          : "relative w-full max-w-[380px] flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-white/10"
      }
      style={{
        background: "rgba(20, 20, 30, 0.98)",
        ...(mode === "page" ? { border: "1px solid rgba(255,255,255,0.08)" } : { maxHeight: "85vh" }),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-pnp-border flex-shrink-0"
        style={{ background: "rgba(30, 30, 45, 0.95)" }}
      >
        <div className="flex items-center gap-2">
          <span role="img" aria-label="Cristina AI" className="text-base">🧜‍♀️</span>
          <div>
            <h3 className="text-sm font-semibold text-pnp-textPrimary">{t.widgetName}</h3>
            <p className="text-[10px] text-pnp-textSecondary">
              {activeTab === "vj" ? "PNP Radio" : pageCtx ? (lang === "es" ? pageCtx.titleEs : pageCtx.titleEn) : t.widgetSubtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Ticket icon — AI tab only, visible after 3 turns or if user has an open ticket */}
          {activeTab === "ai" && (canCreateTicket || hasOpenTicket) && (
            <button
              onClick={() => { ticket ? setView("ticketView") : setView("ticketForm"); setHasUnreadReply(false); }}
              className="relative p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title={t.supportTicketTitle}
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {hasOpenTicket && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-400 rounded-full" />
              )}
            </button>
          )}

          {activeTab === "ai" && (
            <button
              onClick={handleNewConversation}
              className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
              title={t.newConversationTitle}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
          {mode === "widget" && (
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Widget tabs"
        className="flex border-b flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(25,25,38,0.95)" }}
        onKeyDown={(e) => {
          const tabs: CristinaTab[] = ["ai", "vj"];
          const idx = tabs.indexOf(activeTab);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setActiveTab(tabs[(idx + 1) % tabs.length]);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length]);
          }
        }}
      >
        <button
          id="tab-ai"
          role="tab"
          aria-selected={activeTab === "ai"}
          aria-controls="tabpanel-ai"
          tabIndex={activeTab === "ai" ? 0 : -1}
          onClick={() => setActiveTab("ai")}
          className={`flex-1 py-2 text-[11px] font-semibold text-center transition-colors ${activeTab === "ai" ? "text-cyan-400" : "text-gray-500 hover:text-gray-300"}`}
          style={activeTab === "ai" ? { borderBottom: "2px solid #5BC8F5" } : { borderBottom: "2px solid transparent" }}
        >
          <span className="inline-block mr-1 text-xs">🧜‍♀️</span> AI Chat
        </button>
        <button
          id="tab-vj"
          role="tab"
          aria-selected={activeTab === "vj"}
          aria-controls="tabpanel-vj"
          tabIndex={activeTab === "vj" ? 0 : -1}
          onClick={() => setActiveTab("vj")}
          className={`flex-1 py-2 text-[11px] font-semibold text-center transition-colors ${activeTab === "vj" ? "text-purple-400" : "text-gray-500 hover:text-gray-300"}`}
          style={activeTab === "vj" ? { borderBottom: "2px solid #8B5CF6" } : { borderBottom: "2px solid transparent" }}
        >
          {musicIsPlaying ? <><EqualizerBars color="#8B5CF6" size="sm" /> Radio</> : "🛫 Radio"}
        </button>
      </div>

      {/* ── VJ Tab (Radio Panel) ──────────────────────────────────────── */}
      <div id="tabpanel-vj" role="tabpanel" aria-labelledby="tab-vj" style={{ display: activeTab === "vj" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {/* Return to support strip */}
        <div className="bg-pnp-bg/90 border-b border-white/5 py-1.5 px-3 flex items-center justify-between">
          <button
            onClick={() => setActiveTab("ai")}
            className="text-[10px] font-bold text-cyan-400 flex items-center gap-1 hover:text-cyan-300 transition-colors uppercase tracking-wider"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Return to Support
          </button>
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-tighter">VJ Player Mode</span>
        </div>
        <RadioPanel onClose={() => setIsOpen(false)} />
      </div>

      {/* ── AI Chat Tab ───────────────────────────────────────────────── */}
      <div id="tabpanel-ai" role="tabpanel" aria-labelledby="tab-ai" style={{ display: activeTab === "ai" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>

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
                  setView("chat");
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
                      <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{topic.steps.length} {t.tutTopicSteps}</p>
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
                      <p className="text-[10px]" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.tutorialStepOf} {tutorialStep + 1} {t.tutorialOf} {topic.steps.length}</p>
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
      {/* PAYMENT VERIFICATION VIEW (admin-only)                               */}
      {/* ------------------------------------------------------------------ */}
      {view === "paymentVerify" && isAdmin && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Back + title */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setView("chat")}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="text-white font-semibold text-sm">
              {lang === "es" ? "Verificar Pago con Cristina AI" : "Verify Payment with Cristina AI"}
            </h3>
          </div>

          {/* Form */}
          {!pvResult && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{lang === "es" ? "ID de Usuario" : "User ID"}</label>
                <input
                  value={pvUserId}
                  onChange={(e) => setPvUserId(e.target.value)}
                  placeholder={lang === "es" ? "Ej: 1234567890" : "e.g. 1234567890"}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{lang === "es" ? "Proveedor" : "Provider"}</label>
                <select
                  value={pvProvider}
                  onChange={(e) => setPvProvider(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="epayco">ePayco (Card)</option>
                  <option value="btcpay">BTCPay (Dash)</option>
                  <option value="visa">Visa Cybersource</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{lang === "es" ? "Referencia / ID Transaccion" : "Reference / Transaction ID"}</label>
                <input
                  value={pvReference}
                  onChange={(e) => setPvReference(e.target.value)}
                  placeholder={lang === "es" ? "Ej: ref_payco o tx hash" : "e.g. ref_payco or tx hash"}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{lang === "es" ? "Monto (USD)" : "Amount (USD)"}</label>
                  <input
                    value={pvAmount}
                    onChange={(e) => setPvAmount(e.target.value)}
                    placeholder="24.99"
                    type="number"
                    step="0.01"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{lang === "es" ? "ID del Plan" : "Plan ID"}</label>
                  <input
                    value={pvPlanId}
                    onChange={(e) => setPvPlanId(e.target.value)}
                    placeholder="e.g. monthly-pass"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{lang === "es" ? "Notas adicionales (opcional)" : "Additional notes (optional)"}</label>
                <textarea
                  value={pvNotes}
                  onChange={(e) => setPvNotes(e.target.value.slice(0, 500))}
                  placeholder={lang === "es" ? "Contexto extra, screenshot info, etc." : "Extra context, screenshot info, etc."}
                  rows={2}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <button
                onClick={async () => {
                  if (!pvUserId || !pvReference || !pvAmount || !pvPlanId) return;
                  setPvLoading(true);
                  setPvResult(null);
                  setPvActivated(null);
                  try {
                    const res = await verifyPaymentWithCristina({
                      userId: pvUserId,
                      provider: pvProvider,
                      reference: pvReference,
                      amount: parseFloat(pvAmount),
                      planId: pvPlanId,
                      notes: pvNotes || undefined,
                    });
                    if (res.success && res.analysis) {
                      setPvResult(res.analysis);
                    }
                  } catch {
                    setPvResult({
                      valid: false,
                      confidence: "low",
                      reason: lang === "es" ? "Error al comunicarse con el servidor" : "Failed to communicate with server",
                      recommendation: "manual_review",
                      warnings: [],
                    });
                  } finally {
                    setPvLoading(false);
                  }
                }}
                disabled={pvLoading || !pvUserId || !pvReference || !pvAmount || !pvPlanId}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #D4007A, #FF6B35)" }}
              >
                {pvLoading
                  ? (lang === "es" ? "Analizando con Grok AI..." : "Analyzing with Grok AI...")
                  : (lang === "es" ? "Verificar Pago" : "Verify Payment")}
              </button>
            </div>
          )}

          {/* Result */}
          {pvResult && (
            <div className="space-y-3 animate-fade-in-up">
              {/* Verdict card */}
              <div
                className="rounded-xl p-4 border"
                style={{
                  background: pvResult.valid
                    ? "rgba(52,199,89,0.08)"
                    : "rgba(255,69,58,0.08)",
                  borderColor: pvResult.valid
                    ? "rgba(52,199,89,0.3)"
                    : "rgba(255,69,58,0.3)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{pvResult.valid ? "\u2705" : "\u274C"}</span>
                  <div>
                    <p className="text-sm font-bold text-white">
                      {pvResult.valid
                        ? (lang === "es" ? "Pago Valido" : "Payment Valid")
                        : (lang === "es" ? "Pago No Valido" : "Payment Not Valid")}
                    </p>
                    <p className="text-xs text-gray-400">
                      {lang === "es" ? "Confianza" : "Confidence"}: <span className={`font-semibold ${pvResult.confidence === "high" ? "text-green-400" : pvResult.confidence === "medium" ? "text-yellow-400" : "text-red-400"}`}>{pvResult.confidence.toUpperCase()}</span>
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{pvResult.reason}</p>
                {pvResult.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {pvResult.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-yellow-400">
                        {"\u26A0\uFE0F"} {w}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                      pvResult.recommendation === "activate"
                        ? "bg-green-500/20 text-green-400"
                        : pvResult.recommendation === "reject"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }`}
                  >
                    {pvResult.recommendation === "activate"
                      ? (lang === "es" ? "ACTIVAR" : "ACTIVATE")
                      : pvResult.recommendation === "reject"
                      ? (lang === "es" ? "RECHAZAR" : "REJECT")
                      : (lang === "es" ? "REVISION MANUAL" : "MANUAL REVIEW")}
                  </span>
                </div>
              </div>

              {/* Activation result */}
              {pvActivated && (
                <div
                  className="rounded-xl p-3 border"
                  style={{
                    background: pvActivated.success ? "rgba(52,199,89,0.1)" : "rgba(255,69,58,0.1)",
                    borderColor: pvActivated.success ? "rgba(52,199,89,0.3)" : "rgba(255,69,58,0.3)",
                  }}
                >
                  {pvActivated.success ? (
                    <p className="text-sm text-green-400 font-semibold">
                      {"\u2705"} {lang === "es"
                        ? `Membresia activada! ${pvActivated.granted || 0} entitlements otorgados.`
                        : `Membership activated! ${pvActivated.granted || 0} entitlements granted.`}
                    </p>
                  ) : (
                    <p className="text-sm text-red-400 font-semibold">
                      {"\u274C"} {lang === "es" ? "Error al activar" : "Activation failed"}: {pvActivated.error || "Unknown error"}
                    </p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                {pvResult.valid && !pvActivated && (
                  <button
                    onClick={async () => {
                      setPvLoading(true);
                      try {
                        const res = await verifyPaymentWithCristina({
                          userId: pvUserId,
                          provider: pvProvider,
                          reference: pvReference,
                          amount: parseFloat(pvAmount),
                          planId: pvPlanId,
                          notes: pvNotes || undefined,
                          activate: true,
                        });
                        if (res.activation) {
                          setPvActivated(res.activation);
                        }
                      } catch {
                        setPvActivated({ success: false, error: "Network error" });
                      } finally {
                        setPvLoading(false);
                      }
                    }}
                    disabled={pvLoading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg, #34C759, #30D158)" }}
                  >
                    {pvLoading
                      ? (lang === "es" ? "Activando..." : "Activating...")
                      : (lang === "es" ? "Activar Membresia" : "Activate Membership")}
                  </button>
                )}
                <button
                  onClick={() => {
                    setPvResult(null);
                    setPvActivated(null);
                    setPvUserId("");
                    setPvProvider("epayco");
                    setPvReference("");
                    setPvAmount("");
                    setPvPlanId("");
                    setPvNotes("");
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/20 text-white/70 hover:border-white/40 transition-colors"
                >
                  {lang === "es" ? "Nueva Verificacion" : "New Verification"}
                </button>
              </div>
            </div>
          )}
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
              {/* Warm greeting — single block, no ‘back’ link, no header */}
              <div className="text-center mb-6 mt-2">
                <span role="img" aria-label="Cristina AI" className="block text-5xl mx-auto mb-2">🧜‍♀️</span>
                <h4 className="text-sm font-semibold text-pnp-textPrimary mb-1">
                  {t.welcomeGreeting}
                </h4>
                <p className="text-xs text-pnp-textSecondary">
                  {t.welcomeSubtitle}
                </p>
              </div>
              {/* Suggestion chips — contextual first, then up to 4 - context generic */}
              {(() => {
                const contextual = contextChips.slice(0, 2);
                const remaining = Math.max(0, 4 - contextual.length);
                const generic = suggestions.slice(0, remaining);
                const all = [...contextual.map((c) => ({ ...c, kind: "context" as const })),
                             ...generic.map((g) => ({ ...g, kind: "general" as const }))];
                if (all.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-2 justify-center">
                    {all.map((s) => (
                      <button
                        key={`${s.kind}-${s.id}`}
                        onClick={() => sendMessage(s.label)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 active:scale-95"
                        style={{
                          background: s.kind === "context" ? "rgba(123, 97, 255, 0.15)" : "rgba(0, 212, 232, 0.15)",
                          border: s.kind === "context" ? "1px solid rgba(123, 97, 255, 0.3)" : "1px solid rgba(0, 212, 232, 0.3)",
                          color: "rgba(255, 255, 255, 0.9)",
                        }}
                      >
                        {s.icon} {s.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
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

      {/* ------------------------------------------------------------------ */}
      {/* MERU ACTIVATION VIEW                                                 */}
      {/* ------------------------------------------------------------------ */}
      {view === "meruActivate" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => { setMeruError(null); setView("chat"); }}
              className="text-gray-400 hover:text-white transition-colors text-xs font-medium"
              disabled={meruSubmitting}
            >
              {lang === "es" ? "← Atrás" : "← Back"}
            </button>
            <h3 className="text-white font-semibold text-sm flex items-center gap-1.5">
              <span>🎟️</span>
              <span>{lang === "es" ? "Activar Código Meru" : "Activate Meru Code"}</span>
            </h3>
          </div>

          {meruSuccess ? (
            /* Success celebration */
            <div
              className="rounded-xl p-5 text-center"
              style={{ background: "linear-gradient(135deg, rgba(255,180,84,0.15), rgba(255,107,53,0.15))", border: "1px solid rgba(255,180,84,0.35)" }}
            >
              <div className="text-4xl mb-2">🎉</div>
              <p className="text-sm font-bold text-white mb-1">
                {lang === "es" ? "¡Membresía Lifetime activada!" : "Lifetime membership activated!"}
              </p>
              <p className="text-xs" style={{ color: "#D1D1D6" }}>
                {lang === "es"
                  ? "Tu cuenta ahora tiene acceso Lifetime + 60 días de PRIME. Refrescando…"
                  : "Your account now has Lifetime + 60 days of PRIME. Refreshing…"}
              </p>
            </div>
          ) : (
            <>
              {/* Explainer */}
              <div
                className="mb-4 rounded-xl p-3"
                style={{ background: "rgba(255,180,84,0.06)", border: "1px solid rgba(255,180,84,0.2)" }}
              >
                <p className="text-xs leading-relaxed" style={{ color: "#D1D1D6" }}>
                  {lang === "es"
                    ? "Canjea tu código Meru para activar tu membresía Lifetime más 60 días de PRIME como bonificación."
                    : "Redeem your Meru code to activate Lifetime membership plus 60 days of PRIME as a bonus."}
                </p>
              </div>

              {/* Email */}
              <label className="text-xs font-medium text-white/90 mb-1.5 block">
                {lang === "es" ? "Correo electrónico" : "Email"}
              </label>
              <input
                type="email"
                autoComplete="email"
                value={meruEmail}
                onChange={(e) => { setMeruEmail(e.target.value); setMeruError(null); }}
                placeholder={lang === "es" ? "tu@ejemplo.com" : "you@example.com"}
                disabled={meruSubmitting}
                className="w-full rounded-xl px-4 py-2.5 mb-3 bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-[#FFB454] transition-colors disabled:opacity-50"
                style={{ fontSize: "16px" }}
              />

              {/* Code */}
              <label className="text-xs font-medium text-white/90 mb-1.5 block">
                {lang === "es" ? "Código Meru" : "Meru Code"}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={meruCode}
                  onChange={(e) => { setMeruCode(e.target.value); setMeruError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleMeruActivate(); }}
                  placeholder={lang === "es" ? "Ingresa tu código Meru" : "Enter your Meru code"}
                  disabled={meruSubmitting}
                  className="flex-1 rounded-xl px-4 py-2.5 bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-[#FFB454] transition-colors disabled:opacity-50"
                  style={{ fontSize: "16px" }}
                />
                <button
                  onClick={handleMeruActivate}
                  disabled={!meruCode.trim() || !meruEmail.trim() || meruSubmitting}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap transition-all active:scale-[0.97]"
                  style={{ background: "linear-gradient(135deg, #FFB454, #FF6B35)" }}
                >
                  {meruSubmitting ? (lang === "es" ? "Verificando…" : "Verifying…") : (lang === "es" ? "Activar" : "Activate")}
                </button>
              </div>

              {meruSubmitting && (
                <p className="mt-3 text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {lang === "es"
                    ? "Verificando el pago con Meru… esto puede tardar unos segundos."
                    : "Verifying payment with Meru… this may take a few seconds."}
                </p>
              )}
              {meruError && (
                <p className="mt-3 text-xs text-red-400">{meruError}</p>
              )}

              {/* Recovery link */}
              <div className="mt-6 pt-4 border-t border-white/5">
                <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider font-semibold">
                  {lang === "es" ? "¿Problemas con tu código?" : "Having issues with your code?"}
                </p>
                <button
                  onClick={() => {
                    setView("ticketForm");
                    setSelectedCategory("payment");
                    setTicketDescription(lang === "es" 
                      ? "Hola, olvidé anotar mi código Meru. Adjunto el screenshot de mi movimiento bancario donde se ve monto, fecha y hora exacta del pago.\n\n[POR FAVOR ADJUNTA TU SCREENSHOT EN EL SIGUIENTE MENSAJE]"
                      : "Hi, I forgot to write down my Meru code. I'm attaching the screenshot of my bank transaction showing amount, date, and exact hour of payment.\n\n[PLEASE ATTACH YOUR SCREENSHOT IN THE NEXT MESSAGE]");
                  }}
                  className="w-full py-2 px-3 rounded-lg text-xs font-medium text-[#FFB454] border border-[#FFB454]/20 hover:bg-[#FFB454]/5 transition-colors text-left flex items-center justify-between"
                >
                  <span>{lang === "es" ? "🔑 Recuperar mi código Meru" : "🔑 Recover my Meru code"}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <p className="mt-2 text-[10px] text-gray-500 leading-tight">
                  {lang === "es"
                    ? "Si olvidaste tu código, es OBLIGATORIO enviar un screenshot del pago para recuperarlo. No se acepta otro tipo de soporte."
                    : "If you forgot your code, it is MANDATORY to send a payment screenshot to recover it. No other support is accepted."}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Secondary toolbar — Tutorials, Activate Meru, Admin verify.
          Tucked above the input so they're discoverable without dominating
          the chat. Only shown in chat view. */}
      {view === "chat" && (
        <div
          className="flex items-center justify-center gap-1 px-3 py-1.5 border-t flex-shrink-0"
          style={{
            background: "rgba(30, 30, 45, 0.95)",
            borderColor: "rgba(255,255,255,0.06)",
          }}
        >
          <button
            type="button"
            onClick={() => { setSelectedTutorial(null); setTutorialStep(0); setView("tutorial"); }}
            aria-label={lang === "es" ? "Tutoriales" : "Tutorials"}
            title={lang === "es" ? "Tutoriales" : "Tutorials"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-[0.95]"
            style={{ background: "rgba(91,200,245,0.10)", border: "1px solid rgba(91,200,245,0.25)", color: "#5BC8F5" }}
          >
            <span>📚</span>
            <span className="hidden sm:inline">{lang === "es" ? "Tutoriales" : "Tutorials"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMeruError(null);
              setMeruSuccess(false);
              setMeruEmail(user?.email || "");
              setView("meruActivate");
            }}
            aria-label={lang === "es" ? "Activar código Meru" : "Activate Meru code"}
            title={lang === "es" ? "Activar código Meru" : "Activate Meru code"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-[0.95]"
            style={{ background: "rgba(255,180,84,0.10)", border: "1px solid rgba(255,180,84,0.25)", color: "#FFB454" }}
          >
            <span>🎟️</span>
            <span className="hidden sm:inline">{lang === "es" ? "Activar" : "Activate"}</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setPvResult(null); setPvActivated(null); setView("paymentVerify"); }}
              aria-label={lang === "es" ? "Verificar pago (Admin)" : "Verify payment (Admin)"}
              title={lang === "es" ? "Verificar pago (Admin)" : "Verify payment (Admin)"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-[0.95]"
              style={{ background: "rgba(123,97,255,0.10)", border: "1px solid rgba(123,97,255,0.25)", color: "#7B61FF" }}
            >
              <span>⚙️</span>
              <span className="hidden sm:inline">Admin</span>
            </button>
          )}
        </div>
      )}

      {/* Input area — hidden in ticketForm, tutorial, paymentVerify, and meruActivate views */}
      {view !== "ticketForm" && view !== "tutorial" && view !== "paymentVerify" && view !== "meruActivate" && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 p-3 pb-safe border-t border-pnp-border flex-shrink-0"
          style={{
            background: "rgba(30, 30, 45, 0.95)",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <div className="flex-1 relative">
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
              maxLength={2000}
              disabled={isLoading}
              className="w-full bg-white/5 border border-pnp-border rounded-xl px-3 py-2 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:border-cyan-400/50 disabled:opacity-50"
              aria-describedby={input.length >= 1600 ? "chat-char-count" : undefined}
            />
            {input.length >= 1600 && (
              <span
                id="chat-char-count"
                className={`absolute right-2 bottom-2 text-[10px] font-medium ${input.length >= 1900 ? "text-red-400" : "text-yellow-400"}`}
                aria-live="polite"
              >
                {2000 - input.length}
              </span>
            )}
          </div>
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
      </div>{/* end AI Chat Tab wrapper */}
    </div>
  );

  // Widget mode: show backdrop on mobile
  if (mode === "widget") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={() => setIsOpen(false)}
      >
        <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
        {chatPanel}
      </div>
    );
  }

  return chatPanel;
}

export default CristinaWidget;

// ── Self-Care Satellite FAB ──────────────────────────────────────────────────
//
// Always-visible mini circle below Cristina. Tap to expand into three radial
// action buttons:
//  · Slam     — auto-logs one event (no confirmation; one-tap by design)
//  · Smoke    — auto-logs one event
//  · Center   — navigates to /self-care
//
// Lives in this file (no new file) because it's only used inside Cristina's
// FAB stack and never reused elsewhere. Respects prefers-reduced-motion.

interface SelfCareSatelliteProps {
  isLeftCorner: boolean;
  fanOpen: boolean;
  toast: { kind: "slam" | "smoke"; until: number } | null;
  onToggle: () => void;
  onLog: (kind: "slam" | "smoke") => void;
  onOpenCenter: () => void;
}

function SelfCareSatellite({
  isLeftCorner,
  fanOpen,
  toast,
  onToggle,
  onLog,
  onOpenCenter,
}: SelfCareSatelliteProps) {
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Three actions arranged in a vertical column above the satellite when
  // open. Vertical (not radial) keeps everything inside the corner safe-area
  // on mobile and avoids overlap with Cristina above.
  const actions = [
    { key: "slam" as const, icon: "💉", label: "Slam", color: "#A78BFA", onClick: () => onLog("slam") },
    { key: "smoke" as const, icon: "💨", label: "Smoke", color: "#FBBF24", onClick: () => onLog("smoke") },
    { key: "center" as const, icon: "🧭", label: "Self-Care Center", color: "#5ED1C4", onClick: onOpenCenter },
  ];

  return (
    <div
      className={`relative flex flex-col ${isLeftCorner ? "items-start" : "items-end"} gap-2`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Toast confirmation — appears briefly after a successful auto-log */}
      {toast && (
        <div
          className={`absolute ${isLeftCorner ? "left-12" : "right-12"} -top-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shadow-lg`}
          style={{
            background: "rgba(20,20,30,0.95)",
            border: "1px solid rgba(94,209,196,0.35)",
            color: "#5ED1C4",
            animation: reducedMotion ? undefined : "fadeInUp 180ms ease-out",
          }}
          role="status"
          aria-live="polite"
        >
          {toast.kind === "slam" ? "💉" : "💨"} {toast.count} {toast.kind === "slam" ? "slam" : "smoke"}{toast.count !== 1 ? "s" : ""} today
        </div>
      )}

      {/* Action fan — three vertically stacked buttons. Animated in/out. */}
      {fanOpen && (
        <div className={`flex flex-col gap-1.5 ${isLeftCorner ? "items-start" : "items-end"}`}>
          {actions.map((a, i) => (
            <button
              key={a.key}
              onClick={a.onClick}
              className={`flex items-center gap-2 rounded-full pl-2 pr-3 py-1.5 shadow-lg transition-transform active:scale-95 ${isLeftCorner ? "flex-row" : "flex-row-reverse"}`}
              style={{
                background: "rgba(20,20,30,0.95)",
                border: `1px solid ${a.color}80`,
                color: a.color,
                animation: reducedMotion
                  ? undefined
                  : `selfCareFanIn 200ms ease-out ${i * 40}ms backwards`,
              }}
              aria-label={a.label}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-base"
                style={{ background: `${a.color}25`, border: `1px solid ${a.color}50` }}
              >
                {a.icon}
              </span>
              <span className="text-xs font-semibold">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Satellite circle — always visible. Smaller than Cristina (36 vs 48). */}
      <button
        onClick={onToggle}
        className="relative w-9 h-9 rounded-full shadow-lg flex items-center justify-center transition-all active:scale-90"
        style={{
          background: fanOpen
            ? "linear-gradient(135deg, #5ED1C4, #4FB3A8)"
            : "rgba(20,20,30,0.92)",
          border: "1px solid rgba(94,209,196,0.55)",
          transform: fanOpen ? "rotate(45deg)" : "none",
          transitionProperty: "transform, background",
          transitionDuration: reducedMotion ? "0ms" : "200ms",
        }}
        aria-label={fanOpen ? "Close Self-Care actions" : "Open Self-Care actions"}
        aria-expanded={fanOpen}
      >
        <span
          className="text-base"
          style={{
            transform: fanOpen ? "rotate(-45deg)" : "none",
            transitionProperty: "transform",
            transitionDuration: reducedMotion ? "0ms" : "200ms",
          }}
        >
          {fanOpen ? "✕" : "🧘"}
        </span>
      </button>

      {/* Animation keyframes */}
      <style>{`
        @keyframes selfCareFanIn {
          from { opacity: 0; transform: translateY(8px) scale(0.92); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
