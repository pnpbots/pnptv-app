import { useState, useEffect, useCallback, useRef } from "react";
import { 
  getUsdcSubscriptionStatus, 
  prepareUsdcSubscription 
} from "@/lib/api";
import { isTelegramContext } from "@/lib/telegram";

export interface NowPaymentsOrder {
  orderId: string;
  planName: string;
  usdAmount: number;
  invoiceUrl: string;
  createdAt: number;
  partiallyPaid?: boolean;
  confirming?: boolean;
}

interface UseNowPaymentsOptions {
  storageKey?: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  returnUrl?: string;
}

export function useNowPayments(options: UseNowPaymentsOptions = {}) {
  const {
    storageKey = "pnp_pending_usdc_order",
    onSuccess,
    onError,
    returnUrl,
  } = options;

  const [order, setOrder] = useState<NowPaymentsOrder | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paymentPopupRef = useRef<Window | null>(null);

  // Resume from storage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as NowPaymentsOrder;
        // Only resume if order is < 24h old (NOWPayments invoice TTL)
        if (parsed?.orderId && Date.now() - (parsed.createdAt || 0) < 86400000) {
          setOrder(parsed);
          setIsPolling(true);
        } else {
          sessionStorage.removeItem(storageKey);
        }
      }
    } catch (err) {
      console.error("Failed to resume NOWPayments order", err);
    }
  }, [storageKey]);

  // Polling logic
  useEffect(() => {
    if (!order || !isPolling || isSuccess) return;

    let cancelled = false;
    const maxDurationMs = 60 * 60 * 1000; // 60 min
    const startedAt = Date.now();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= maxDurationMs) {
        setIsPolling(false);
        return;
      }

      try {
        const data = await getUsdcSubscriptionStatus(order.orderId);
        if (cancelled) return;

        if (data.completed) {
          setIsPolling(false);
          setIsSuccess(true);
          paymentPopupRef.current?.close();
          paymentPopupRef.current = null;
          sessionStorage.removeItem(storageKey);
          onSuccess?.();
          return;
        }

        if (data.failed) {
          setIsPolling(false);
          sessionStorage.removeItem(storageKey);
          const errMsg = "Payment failed or expired. Please try again.";
          setError(errMsg);
          onError?.(errMsg);
          return;
        }

        let updated = false;
        const newOrder = { ...order };

        if (data.partiallyPaid && !order.partiallyPaid) {
          newOrder.partiallyPaid = true;
          updated = true;
        }

        if (data.confirming && !order.confirming) {
          newOrder.confirming = true;
          updated = true;
        }

        if (updated) {
          setOrder(newOrder);
          sessionStorage.setItem(storageKey, JSON.stringify(newOrder));
        }

        if (!cancelled) {
          timerId = setTimeout(poll, data.confirming ? 5000 : 8000);
        }
      } catch (err: any) {
        if (err.status === 401) {
          setIsPolling(false);
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, 10000);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [order, isPolling, isSuccess, storageKey, onSuccess, onError]);

  const startPayment = useCallback(async (planId: string, email?: string, creatorId?: string, isSubscription?: boolean) => {
    setError(null);
    setIsSuccess(false);
    
    try {
      const endpoint = isSubscription ? "/api/webapp/payments/usdc/subscribe" : "/api/webapp/payments/usdc/prepare";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planId, email, creatorId, ...(returnUrl ? { returnUrl } : {}) }),
      });
      const result = await res.json();
      
      if (result.success && result.orderId && result.invoiceUrl) {
        const newOrder: NowPaymentsOrder = {
          orderId: result.orderId,
          planName: result.planName || "Subscription",
          usdAmount: result.usdAmount,
          invoiceUrl: result.invoiceUrl,
          createdAt: Date.now(),
        };
        
        setOrder(newOrder);
        setIsPolling(true);
        sessionStorage.setItem(storageKey, JSON.stringify(newOrder));

        if (isTelegramContext()) {
          window.Telegram!.WebApp.openLink(result.invoiceUrl);
        } else {
          const w = window.screen.width, h = window.screen.height;
          const pw = Math.min(500, w), ph = Math.min(720, h);
          const left = Math.round((w - pw) / 2);
          const top = Math.round((h - ph) / 2);
          
          paymentPopupRef.current = window.open(
            result.invoiceUrl, 
            "nowpayments_checkout", 
            `width=${pw},height=${ph},left=${left},top=${top},resizable=yes,scrollbars=yes`
          );
          
          // Fallback if popup blocked
          if (!paymentPopupRef.current || paymentPopupRef.current.closed || typeof paymentPopupRef.current.closed === 'undefined') {
            // Popup blocked, we can't do much but the UI will show the link anyway
            console.warn("Popup blocked");
          }
        }
        return { success: true, order: newOrder };
      } else {
        const msg = result.error || "Failed to create crypto invoice.";
        setError(msg);
        onError?.(msg);
        return { success: false, error: msg };
      }
    } catch (err: any) {
      const msg = err.message || "An error occurred while preparing your payment.";
      setError(msg);
      onError?.(msg);
      return { success: false, error: msg };
    }
  }, [storageKey, onError]);

  const cancelOrder = useCallback(() => {
    setOrder(null);
    setIsPolling(false);
    setIsSuccess(false);
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  return {
    order,
    isPolling,
    isSuccess,
    error,
    startPayment,
    cancelOrder,
    setError,
  };
}
