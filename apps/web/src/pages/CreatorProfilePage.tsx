/**
 * CreatorProfilePage — public-facing creator profile at /creator/:username
 *
 * A shareable "mini hub" landing page that creators post on their social bios.
 * Shows profile, CTA strip, social links, availability, call packages,
 * recent posts, exclusive content grid, and a share/QR section.
 * Does NOT require authentication to view (public page), but subscribe action
 * requires login.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  Lock,
  CheckCircle2,
  Play,
  X,
  AlertTriangle,
  Users,
  BadgeCheck,
  PhoneCall,
  Star,
  RefreshCw,
  Heart,
  Calendar,
  Share2,
  Copy,
  Check,
  Clock,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  getPublicCreatorProfile,
  subscribeToCreator,
  unsubscribeFromCreator,
  prepareUsdcSubscription,
  prepareEfipayCheckout,
  getCreatorSubscriptionStatus,
  ApiError,
  type CreatorPublicProfile,
  type PublicCreatorMediaItem,
  type PublicCallPackage,
  type CreatorRecentPost,
  type CreatorNextAvailability,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatar } from "@/components/UserAvatar";
import { BookCallModal } from "@/components/creators/BookCallModal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(usd);
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

function formatTimeRange(start: string, end: string): string {
  function fmt(t: string): string {
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, "0")} ${period}`;
  }
  return `${fmt(start)} – ${fmt(end)}`;
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function availabilityDayLabel(avail: CreatorNextAvailability): string {
  if (avail.days_from_now === 0) return "Hoy";
  if (avail.days_from_now === 1) return "Mañana";
  return DAY_NAMES[avail.day_of_week] ?? "";
}

type CreatorTier = "creator" | "crystal" | "ice" | "diamond" | "full_time";

// ─── Tier Badge ───────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: CreatorTier }) {
  if (tier === "crystal") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
        style={{ background: "rgba(6,182,212,0.18)", color: "#22D3EE" }}
      >
        Crystal
      </span>
    );
  }
  if (tier === "ice") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
        style={{ background: "rgba(59,130,246,0.18)", color: "#60A5FA" }}
      >
        ICE
      </span>
    );
  }
  if (tier === "diamond") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
        style={{ background: "rgba(139,92,246,0.18)", color: "#A78BFA" }}
      >
        Diamond
      </span>
    );
  }
  if (tier === "full_time") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
        style={{ background: "rgba(230,145,56,0.18)", color: "#FCD34D" }}
      >
        Featured
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
      style={{ background: "rgba(34,197,94,0.18)", color: "#4ADE80" }}
    >
      Creator
    </span>
  );
}

// ─── Social link icons (inline SVG, no icon library) ─────────────────────────

interface SocialIconProps {
  platform: string;
  size?: number;
}

function SocialIcon({ platform, size = 16 }: SocialIconProps) {
  const s = size;
  switch (platform) {
    case "twitter":
    case "x":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "telegram":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      );
    default:
      return null;
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "X",
  x: "X",
  telegram: "Telegram",
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="min-h-dvh" style={{ background: "var(--pnp-background)" }}>
      <div className="max-w-lg mx-auto px-4 pt-8 pb-24 space-y-5">
        {/* Header skeleton */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-24 h-24 rounded-full animate-pulse" style={{ background: "var(--pnp-surface)" }} />
          <div className="h-6 w-36 rounded-lg animate-pulse" style={{ background: "var(--pnp-surface)" }} />
          <div className="h-4 w-24 rounded-lg animate-pulse" style={{ background: "var(--pnp-surface)" }} />
          <div className="h-3 w-48 rounded-lg animate-pulse" style={{ background: "var(--pnp-surface)" }} />
        </div>
        {/* CTA strip skeleton */}
        <div className="flex gap-2">
          <div className="flex-1 h-12 rounded-2xl animate-pulse" style={{ background: "var(--pnp-surface)" }} />
          <div className="w-32 h-12 rounded-2xl animate-pulse" style={{ background: "var(--pnp-surface)" }} />
        </div>
        {/* Grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-xl animate-pulse"
              style={{ background: "var(--pnp-surface)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps {
  item: PublicCreatorMediaItem;
  onClose: () => void;
}

function Lightbox({ item, onClose }: LightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      <button
        className="absolute top-4 right-4 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
        onClick={onClose}
        aria-label="Close media viewer"
      >
        <X size={18} />
      </button>

      <div
        className="max-w-[90vw] max-h-[90dvh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {item.media_type === "video" ? (
          <video
            src={item.url!}
            controls
            autoPlay
            className="max-w-full max-h-[90dvh] rounded-xl"
            style={{ background: "#000" }}
          />
        ) : (
          <img
            src={item.url!}
            alt={item.caption ?? "Creator media"}
            className="max-w-full max-h-[90dvh] rounded-xl object-contain"
          />
        )}
      </div>

      {item.caption && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center px-4">
          <p className="text-sm text-white/80 text-center max-w-md bg-black/60 px-3 py-1.5 rounded-lg">
            {item.caption}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Media item tile ──────────────────────────────────────────────────────────

interface MediaTileProps {
  item: PublicCreatorMediaItem;
  isSubscribed: boolean;
  onOpenLightbox: (item: PublicCreatorMediaItem) => void;
  onSubscribeCta: () => void;
}

function MediaTile({
  item,
  isSubscribed,
  onOpenLightbox,
  onSubscribeCta,
}: MediaTileProps) {
  const isLocked = item.is_premium && item.url === null;
  const isUnlocked = item.is_premium && item.url !== null;
  const thumbSrc = item.thumb_url ?? item.url;

  function handleClick() {
    if (isLocked) {
      onSubscribeCta();
      return;
    }
    onOpenLightbox(item);
  }

  return (
    <button
      className="relative aspect-square rounded-xl overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      style={{ background: "var(--pnp-surface)" }}
      onClick={handleClick}
      aria-label={
        isLocked
          ? "Contenido premium bloqueado — suscríbete para desbloquear"
          : item.caption
          ? item.caption
          : item.media_type === "video"
          ? "Reproducir video"
          : "Ver foto"
      }
    >
      {thumbSrc && (
        <img
          src={thumbSrc}
          alt={item.caption ?? ""}
          loading="lazy"
          className={[
            "w-full h-full object-cover transition-transform duration-200",
            !isLocked ? "group-hover:scale-105" : "blur-sm scale-105",
          ].join(" ")}
        />
      )}

      {isLocked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 backdrop-blur-[2px]">
          <Lock size={20} className="text-white/80" aria-hidden="true" />
          <span className="text-[10px] font-medium text-white/70 text-center px-2 leading-tight">
            Suscríbete para ver
          </span>
        </div>
      )}

      {!isLocked && item.media_type === "video" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-black/80 transition-colors">
            <Play size={16} className="text-white ml-0.5" aria-hidden="true" />
          </div>
        </div>
      )}

      {isUnlocked && (
        <div className="absolute top-1.5 left-1.5">
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider text-white uppercase"
            style={{ background: "var(--pnp-accent)" }}
          >
            Exclusivo
          </span>
        </div>
      )}
    </button>
  );
}

// ─── Subscribe panel ──────────────────────────────────────────────────────────

interface SubscribePanelProps {
  creatorId: string;
  priceUsd: number;
  onSuccess: () => void;
}

function SubscribePanel({ creatorId, priceUsd, onSuccess }: SubscribePanelProps) {
  const [loading, setLoading] = useState<"crypto" | "efipay" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);
  const [efipayEmail, setEfipayEmail] = useState("");
  const inFlight = useRef(false);

  async function handleCrypto() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading("crypto");
    setError(null);
    try {
      const result = await prepareUsdcSubscription("creator_monthly", undefined, creatorId);
      if (!result.invoiceUrl) throw new Error("No payment URL received");
      setPaymentUrl(result.invoiceUrl);
      window.open(result.invoiceUrl, "_blank", "noopener,noreferrer,width=800,height=700");
      setPaymentPending(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Algo salió mal. Por favor intenta de nuevo.");
    } finally {
      setLoading(null);
      inFlight.current = false;
    }
  }

  async function handleEfipay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading("efipay");
    setError(null);
    try {
      const result = await prepareEfipayCheckout("creator_membership", creatorId, efipayEmail.trim() || undefined);
      if (!result.checkout_url) throw new Error("No payment URL received");
      setPaymentUrl(result.checkout_url);
      window.open(result.checkout_url, "_blank", "noopener,noreferrer,width=900,height=700");
      setPaymentPending(true);
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      const friendlyErrors: Record<string, string> = {
        no_email_on_account: "Tu cuenta no tiene email. Agrégalo en Configuración para pagar con tarjeta.",
        creator_locked: "Este creador no está aceptando suscripciones por el momento.",
        creator_paused: "Este creador pausó sus suscripciones temporalmente.",
        checkout_unavailable: "El servicio de pago no está disponible. Intenta más tarde.",
        creator_not_found: "Creador no encontrado.",
      };
      setError(friendlyErrors[code] ?? (code || "Algo salió mal. Por favor intenta de nuevo."));
    } finally {
      setLoading(null);
      inFlight.current = false;
    }
  }

  if (paymentPending) {
    return (
      <div
        className="rounded-2xl p-4 mt-1 border border-white/10 text-center space-y-3"
        style={{ background: "var(--pnp-surface)" }}
      >
        <p className="text-sm text-pnp-textPrimary font-medium">
          Pago abierto en nueva pestaña
        </p>
        <p className="text-xs text-pnp-textSecondary">
          Completa tu pago y vuelve aquí para verificar tu suscripción.
        </p>
        {paymentUrl && (
          <a
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-pnp-accent underline decoration-dotted"
          >
            Volver a abrir página de pago
          </a>
        )}
        <button
          disabled={loading === "verify"}
          onClick={async () => {
            setLoading("verify");
            setError(null);
            try {
              const status = await getCreatorSubscriptionStatus(creatorId);
              if (status.subscribed) {
                onSuccess();
              } else {
                setError("Tu pago aún no se ha confirmado. Espera un momento y vuelve a intentarlo.");
              }
            } catch {
              setError("No se pudo verificar. Intenta de nuevo.");
            } finally {
              setLoading(null);
            }
          }}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: "var(--pnp-accent)" }}
        >
          <RefreshCw size={14} aria-hidden="true" className={loading === "verify" ? "animate-spin" : ""} />
          {loading === "verify" ? "Verificando…" : "Verificar suscripción"}
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-4 mt-1 border border-white/10 space-y-3"
      style={{ background: "var(--pnp-surface)" }}
    >
      <p className="text-sm text-pnp-textSecondary text-center">
        Desbloquea todo el contenido exclusivo por{" "}
        <span className="text-pnp-textPrimary font-semibold">
          {formatPrice(priceUsd)}/mes
        </span>
      </p>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleCrypto}
        disabled={loading !== null}
        className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
        style={{ background: "var(--pnp-accent)" }}
      >
        {loading === "crypto" ? "Procesando…" : `Pagar con Crypto · ${formatPrice(priceUsd)}/mes`}
      </button>

      <div className="space-y-2">
        <input
          type="email"
          value={efipayEmail}
          onChange={(e) => setEfipayEmail(e.target.value)}
          placeholder="Email para recibo (requerido para pago con tarjeta)"
          maxLength={254}
          className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
          style={{
            background: "var(--pnp-surface-raised, #2a2a3a)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "var(--pnp-text-primary, #EBEBF5)",
          }}
        />
        <button
          onClick={handleEfipay}
          disabled={loading !== null || !efipayEmail.trim()}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] border border-white/20 text-pnp-textPrimary"
          style={{ background: "var(--pnp-surface-raised, #2a2a3a)" }}
        >
          {loading === "efipay" ? "Procesando…" : `Pagar con Tarjeta / PSE · ${formatPrice(priceUsd)}/mes`}
        </button>
      </div>

      <p className="text-[10px] text-pnp-textSecondary text-center">
        Cancela cuando quieras. El contenido se desbloquea inmediatamente.
      </p>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
      {children}
    </h2>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CreatorProfilePage() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const [data, setData] = useState<CreatorPublicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSubscribePanel, setShowSubscribePanel] = useState(false);
  const [showVideoConfirm, setShowVideoConfirm] = useState(false);
  const [unsubscribeLoading, setUnsubscribeLoading] = useState(false);

  const [lightboxItem, setLightboxItem] = useState<PublicCreatorMediaItem | null>(null);
  const [showBookCall, setShowBookCall] = useState(false);

  // Share / QR state
  const [copied, setCopied] = useState(false);

  const subscribePanelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!username) return;
    setIsLoading(true);
    setLoadError(null);
    setIsNotFound(false);
    try {
      const result = await getPublicCreatorProfile(username);
      setData(result);
      setIsSubscribed(result.isSubscribed);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setIsNotFound(true);
      } else {
        setLoadError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar este perfil de creador."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  function handleSubscribeCta() {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    // Only show the video count warning when the creator has very few published videos
    if ((data?.creator.videoCount ?? 3) < 3) {
      setShowVideoConfirm(true);
    } else {
      confirmSubscribe();
    }
  }

  function confirmSubscribe() {
    setShowVideoConfirm(false);
    setShowSubscribePanel(true);
    setTimeout(() => {
      subscribePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function handleSubscribeSuccess() {
    setIsSubscribed(true);
    setShowSubscribePanel(false);
    load();
  }

  async function handleUnsubscribe() {
    if (!data) return;
    setUnsubscribeLoading(true);
    try {
      await unsubscribeFromCreator(data.creator.id);
      setIsSubscribed(false);
      load();
    } catch {
      // silent — subscription status unchanged
    } finally {
      setUnsubscribeLoading(false);
    }
  }

  async function handleCopyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  async function handleNativeShare(url: string, creatorName: string) {
    try {
      await navigator.share({
        title: `${creatorName} en PNPtv!`,
        text: `Mira el perfil de ${creatorName} en PNPtv!`,
        url,
      });
    } catch {
      // user cancelled or API unavailable
    }
  }

  // ── Loading ──
  if (isLoading) return <PageSkeleton />;

  // ── Not found ──
  if (isNotFound) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6"
        style={{ background: "var(--pnp-background)" }}
      >
        <Helmet>
          <title>Creador no encontrado · PNPtv!</title>
        </Helmet>
        <AlertTriangle size={40} className="text-pnp-textSecondary" aria-hidden="true" />
        <h1 className="text-lg font-bold text-pnp-textPrimary">Creador no encontrado</h1>
        <p className="text-sm text-pnp-textSecondary text-center">
          Este perfil no existe o fue eliminado.
        </p>
        <button
          onClick={() => navigate("/")}
          className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 min-h-[44px]"
          style={{ background: "var(--pnp-accent)" }}
        >
          Ir al inicio
        </button>
      </div>
    );
  }

  // ── Network error ──
  if (loadError || !data) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6"
        style={{ background: "var(--pnp-background)" }}
      >
        <Helmet>
          <title>Error · PNPtv!</title>
        </Helmet>
        <AlertTriangle size={40} className="text-pnp-textSecondary" aria-hidden="true" />
        <h1 className="text-lg font-bold text-pnp-textPrimary">Algo salió mal</h1>
        <p className="text-sm text-pnp-textSecondary text-center">
          {loadError ?? "No se pudo cargar este perfil de creador."}
        </p>
        <button
          onClick={load}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 min-h-[44px]"
          style={{ background: "var(--pnp-accent)" }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Intentar de nuevo
        </button>
      </div>
    );
  }

  const { creator, media, callPackages, recentPosts, socialLinks, nextAvailability } = data;
  const activePackages = callPackages.filter((p) => p.is_active);
  const hasCallPackages = activePackages.length > 0;
  const cheapestPackage = hasCallPackages
    ? activePackages.reduce((a, b) => (a.price_usd < b.price_usd ? a : b))
    : null;

  const ALLOWED_SOCIAL = new Set(["x", "twitter", "telegram"]);
  const filteredSocialLinks = socialLinks
    ? Object.fromEntries(Object.entries(socialLinks).filter(([k]) => ALLOWED_SOCIAL.has(k)))
    : {};
  const hasSocialLinks = Object.keys(filteredSocialLinks).length > 0;
  const hasRecentPosts = recentPosts && recentPosts.length > 0;

  const allExclusive = media.every((m) => m.is_premium);
  const contentSectionTitle = allExclusive ? "Contenido Exclusivo" : "Contenido";

  const profileUrl = `https://pnptv.app/creator/${creator.username}`;
  const isOwnProfile = !!user && (
    String(user.dbId || user.id) === String(creator.id)
  );

  // Map creator_type to BookCallModal's expected CreatorType
  const mappedCreatorType = (
    creator.creator_type === "creator" ? "full_time" : creator.creator_type
  ) as import("@/components/creators/CreatorCard").CreatorType;

  const bookCallCreator = {
    id: creator.id,
    username: creator.username,
    photo_url: creator.photo_url,
    creator_type: mappedCreatorType,
    creator_price_usd: creator.creator_price_usd,
    bio: creator.bio,
  };

  return (
    <>
      <Helmet>
        <title>
          {creator.first_name} (@{creator.username}) · PNPtv!
        </title>
        <meta
          name="description"
          content={
            creator.bio
              ? creator.bio.slice(0, 155)
              : `Mira el perfil de ${creator.first_name} en PNPtv!`
          }
        />
        <meta property="og:title" content={`${creator.first_name} · PNPtv!`} />
        <meta property="og:description" content={creator.bio?.slice(0, 155) ?? `Contenido exclusivo de ${creator.first_name} en PNPtv!`} />
        {creator.photo_url && <meta property="og:image" content={creator.photo_url} />}
        <meta property="og:url" content={profileUrl} />
      </Helmet>

      <div className="min-h-dvh" style={{ background: "var(--pnp-background)" }}>
        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

          {/* ── 1. HEADER CARD ──────────────────────────────────────────────── */}
          <section
            className="rounded-2xl p-5 flex flex-col items-center text-center gap-3"
            style={{ background: "var(--pnp-surface)" }}
            aria-label="Perfil del creador"
          >
            {/* Avatar */}
            <div className="relative">
              <UserAvatar
                userId={creator.id}
                photoUrl={creator.photo_url}
                displayName={creator.first_name}
                size="xl"
                linkToProfile={false}
                showOnline={true}
              />
            </div>

            {/* Name + verified */}
            <div className="space-y-1 min-w-0 w-full">
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <h1 className="text-2xl font-bold text-pnp-textPrimary leading-tight">
                  {creator.first_name}
                </h1>
                {creator.creator_verified && (
                  <BadgeCheck
                    size={20}
                    className="text-pnp-accent shrink-0"
                    aria-label="Creador verificado"
                  />
                )}
              </div>

              <p className="text-sm text-pnp-textSecondary">@{creator.username}</p>

              <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                <TierBadge tier={creator.creator_type} />
                <span className="flex items-center gap-1 text-xs text-pnp-textSecondary">
                  <Users size={11} aria-hidden="true" />
                  {(creator.creator_subscriber_count ?? 0).toLocaleString()}{" "}
                  {(creator.creator_subscriber_count ?? 0) === 1 ? "suscriptor" : "suscriptores"}
                </span>
              </div>
            </div>

            {/* Bio */}
            {creator.bio && (
              <p className="text-sm text-pnp-textSecondary leading-relaxed line-clamp-3 max-w-xs">
                {creator.bio}
              </p>
            )}
          </section>

          {/* ── 2. HERO CTA STRIP ───────────────────────────────────────────── */}
          <div ref={subscribePanelRef} className="space-y-2">
            {creator.creator_subscription_paused ? (
              /* Paused state */
              <div className="flex flex-col gap-2">
                <div
                  className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-white/10 text-sm font-medium text-pnp-textSecondary min-h-[52px]"
                  style={{ background: "var(--pnp-surface)" }}
                >
                  Suscripciones pausadas
                </div>
                {hasCallPackages && (
                  <button
                    onClick={() => setShowBookCall(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-white/15 text-sm font-semibold text-pnp-textPrimary transition-all hover:bg-white/8 active:scale-[0.98] min-h-[52px]"
                    style={{ background: "var(--pnp-surface)" }}
                  >
                    <PhoneCall size={16} aria-hidden="true" />
                    {cheapestPackage
                      ? `Llamada desde ${formatPrice(cheapestPackage.price_usd)}`
                      : "Reservar llamada"}
                  </button>
                )}
              </div>
            ) : isSubscribed ? (
              /* Subscribed state */
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold text-green-400 bg-green-500/15 border border-green-500/25">
                    <CheckCircle2 size={14} aria-hidden="true" />
                    Suscrito
                  </span>
                  <button
                    onClick={handleUnsubscribe}
                    disabled={unsubscribeLoading}
                    className="text-xs text-pnp-textSecondary underline decoration-dotted hover:text-pnp-textPrimary transition-colors disabled:opacity-50 min-h-[44px] px-1"
                  >
                    {unsubscribeLoading ? "Cancelando…" : "Gestionar"}
                  </button>
                </div>
                {hasCallPackages && (
                  <button
                    onClick={() => setShowBookCall(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-white/15 text-sm font-semibold text-pnp-textPrimary transition-all hover:bg-white/8 active:scale-[0.98] min-h-[52px]"
                    style={{ background: "var(--pnp-surface)" }}
                  >
                    <PhoneCall size={16} aria-hidden="true" />
                    {cheapestPackage
                      ? `Llamada desde ${formatPrice(cheapestPackage.price_usd)}`
                      : "Reservar llamada"}
                  </button>
                )}
              </div>
            ) : (
              /* Default CTA: subscribe + book */
              <div className="flex gap-2">
                <button
                  onClick={handleSubscribeCta}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-base font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] min-h-[52px]"
                  style={{ background: "var(--pnp-accent)" }}
                >
                  <Star size={16} aria-hidden="true" />
                  Suscribirse · {formatPrice(creator.creator_price_usd)}/mes
                </button>

                {hasCallPackages && (
                  <button
                    onClick={() => setShowBookCall(true)}
                    className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border border-white/15 text-sm font-semibold text-pnp-textPrimary transition-all hover:bg-white/8 active:scale-[0.98] min-h-[52px] shrink-0"
                    style={{ background: "var(--pnp-surface)" }}
                    aria-label="Reservar llamada"
                  >
                    <PhoneCall size={16} aria-hidden="true" />
                    <span className="hidden sm:inline">
                      {cheapestPackage
                        ? `Desde ${formatPrice(cheapestPackage.price_usd)}`
                        : "Llamada"}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Subscribe panel renders inline below buttons */}
            {showSubscribePanel && !isSubscribed && (
              <SubscribePanel
                creatorId={creator.id}
                priceUsd={creator.creator_price_usd}
                onSuccess={handleSubscribeSuccess}
              />
            )}
          </div>

          {/* ── 3. SOCIAL LINKS ROW ─────────────────────────────────────────── */}
          {hasSocialLinks && (
            <div
              className="flex gap-2 overflow-x-auto no-scrollbar py-1"
              role="list"
              aria-label="Redes sociales"
            >
              {Object.entries(filteredSocialLinks).map(([platform, url]) => (
                <a
                  key={platform}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="listitem"
                  aria-label={`${PLATFORM_LABELS[platform] ?? platform} del creador`}
                  className="flex-none flex items-center gap-2 bg-gray-800 rounded-full px-3 py-1.5 text-sm text-white hover:bg-gray-700 transition-colors active:scale-[0.97] min-h-[36px]"
                >
                  <SocialIcon platform={platform} size={16} />
                  <span className="whitespace-nowrap">
                    {PLATFORM_LABELS[platform] ?? platform}
                  </span>
                </a>
              ))}
            </div>
          )}

          {/* ── 4. NEXT AVAILABILITY CARD ───────────────────────────────────── */}
          {nextAvailability && hasCallPackages && (
            <div
              className="flex items-start gap-3 rounded-2xl p-4 border border-gray-700"
              style={{ background: "var(--pnp-surface)" }}
              aria-label="Próxima disponibilidad"
            >
              <Calendar size={18} className="text-pnp-textSecondary mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-pnp-textPrimary">
                  Disponible para llamadas
                </p>
                <p className="text-sm text-pnp-textSecondary mt-0.5">
                  {availabilityDayLabel(nextAvailability)} ·{" "}
                  {formatTimeRange(nextAvailability.start_time, nextAvailability.end_time)}
                </p>
                <p className="text-xs text-pnp-textSecondary mt-0.5 flex items-center gap-1">
                  <Clock size={11} aria-hidden="true" />
                  Zona horaria: {nextAvailability.timezone}
                </p>
              </div>
            </div>
          )}

          {/* ── 5. CALL PACKAGES ────────────────────────────────────────────── */}
          {hasCallPackages && (
            <section aria-label="Paquetes de llamadas privadas">
              <SectionHeading>Llamadas Privadas</SectionHeading>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                {activePackages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="flex-none flex flex-col gap-2 rounded-2xl p-4 min-w-[140px]"
                    style={{ background: "var(--pnp-surface)" }}
                  >
                    <p className="text-sm font-semibold text-pnp-textPrimary">
                      {pkg.label || `${pkg.duration_minutes} min`}
                    </p>
                    <p className="text-lg font-bold text-pnp-textPrimary">
                      {formatPrice(pkg.price_usd)}
                    </p>
                    <button
                      onClick={() => setShowBookCall(true)}
                      className="flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-[0.97] min-h-[36px]"
                      style={{ background: "var(--pnp-accent)" }}
                    >
                      Reservar
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── 6. RECENT POSTS ─────────────────────────────────────────────── */}
          {hasRecentPosts && (
            <section aria-label="Publicaciones recientes">
              <SectionHeading>Publicaciones</SectionHeading>
              <div className="space-y-3">
                {recentPosts.slice(0, 3).map((post) => (
                  <RecentPostCard
                    key={post.id}
                    post={post}
                    creator={creator}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── 7. EXCLUSIVE CONTENT GRID ───────────────────────────────────── */}
          {media.length > 0 && (
            <section aria-label={contentSectionTitle}>
              <SectionHeading>{contentSectionTitle}</SectionHeading>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {media.map((item) => (
                  <MediaTile
                    key={item.id}
                    item={item}
                    isSubscribed={isSubscribed}
                    onOpenLightbox={setLightboxItem}
                    onSubscribeCta={handleSubscribeCta}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── 8. SHARE & QR SECTION ───────────────────────────────────────── */}
          <section
            className="rounded-2xl p-5 flex flex-col items-center gap-4 border border-white/8"
            style={{ background: "var(--pnp-surface)" }}
            aria-label="Compartir perfil"
          >
            <p className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
              {isOwnProfile ? "Comparte tu perfil" : "Comparte este perfil"}
            </p>

            {/* QR code */}
            <div className="bg-white rounded-2xl p-3 shadow-lg">
              <QRCodeSVG
                value={profileUrl}
                size={160}
                bgColor="transparent"
                fgColor="#111111"
                level="M"
              />
            </div>

            <p className="text-xs text-pnp-textSecondary font-mono select-all">
              {profileUrl}
            </p>

            <div className="flex items-center gap-2 w-full max-w-xs">
              <button
                onClick={() => handleCopyLink(profileUrl)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/15 text-sm font-medium text-pnp-textPrimary transition-all hover:bg-white/8 active:scale-[0.97] min-h-[44px]"
                style={{ background: "var(--pnp-surface)" }}
                aria-label="Copiar enlace del perfil"
              >
                {copied ? (
                  <>
                    <Check size={15} className="text-green-400" aria-hidden="true" />
                    <span className="text-green-400">¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy size={15} aria-hidden="true" />
                    Copiar enlace
                  </>
                )}
              </button>

              {typeof navigator !== "undefined" && "share" in navigator && (
                <button
                  onClick={() => handleNativeShare(profileUrl, creator.first_name)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 text-sm font-medium text-pnp-textPrimary transition-all hover:bg-white/8 active:scale-[0.97] min-h-[44px]"
                  style={{ background: "var(--pnp-surface)" }}
                  aria-label="Compartir perfil"
                >
                  <Share2 size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          </section>

          {/* Bottom spacer for mobile nav bar */}
          <div className="h-4" aria-hidden="true" />
        </div>
      </div>

      {/* ── Lightbox ──────────────────────────────────────────────────────────── */}
      {lightboxItem && (
        <Lightbox
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
        />
      )}

      {/* ── Book a Call modal ──────────────────────────────────────────────────── */}
      {showBookCall && (
        <BookCallModal
          creator={bookCallCreator}
          isOnline={false}
          open={showBookCall}
          onClose={() => setShowBookCall(false)}
        />
      )}

      {/* ── Video count confirmation modal ─────────────────────────────────────── */}
      {showVideoConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowVideoConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vcm-title"
            aria-describedby="vcm-desc"
            className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{ background: "var(--pnp-surface-raised, #1e1e2e)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center space-y-1">
              <p className="text-2xl" aria-hidden="true">🎬</p>
              <h3 id="vcm-title" className="text-base font-bold text-pnp-textPrimary">
                {creator.first_name} has{" "}
                <span style={{ color: "var(--pnp-accent)" }}>
                  {creator.videoCount ?? 0} video{(creator.videoCount ?? 0) !== 1 ? "s" : ""}
                </span>{" "}
                available
              </h3>
              <p id="vcm-desc" className="text-sm text-pnp-textSecondary">
                Would you still like to subscribe?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowVideoConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/15 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmSubscribe}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #8B5CF6, #D946EF)" }}
              >
                Subscribe
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Recent Post Card (extracted to avoid >150-line render block) ─────────────

interface RecentPostCardProps {
  post: CreatorRecentPost;
  creator: CreatorPublicProfile["creator"];
}

function RecentPostCard({ post, creator }: RecentPostCardProps) {
  return (
    <article
      className="rounded-2xl p-4 space-y-3"
      style={{ background: "var(--pnp-surface)" }}
    >
      {/* Author row */}
      <div className="flex items-center gap-2.5">
        {creator.photo_url ? (
          <img
            src={creator.photo_url}
            alt={creator.first_name}
            className="w-8 h-8 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold text-white"
            style={{ background: "var(--pnp-accent)" }}
            aria-hidden="true"
          >
            {creator.first_name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-pnp-textPrimary leading-none">
            {creator.first_name}
          </p>
          <p className="text-xs text-pnp-textSecondary mt-0.5">
            {relativeTime(post.created_at)}
          </p>
        </div>
      </div>

      {/* Content */}
      {post.content && (
        <p className="text-sm text-pnp-textPrimary leading-relaxed line-clamp-3 break-words">
          {post.content}
        </p>
      )}

      {/* Media */}
      {post.media_url && (
        <div className="aspect-video rounded-xl overflow-hidden">
          {post.media_type === "video" ? (
            <video
              src={post.media_url}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={post.media_url}
              alt="Post media"
              loading="lazy"
              className="w-full h-full object-cover"
            />
          )}
        </div>
      )}

      {/* Likes */}
      <div className="flex items-center gap-1.5 text-xs text-pnp-textSecondary">
        <Heart size={13} aria-hidden="true" />
        <span>{post.likes_count.toLocaleString()}</span>
      </div>
    </article>
  );
}
