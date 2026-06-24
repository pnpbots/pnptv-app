export interface TokenPackage {
  id: string;
  tokens: number;
  usd: number;
  label: string;
}

export interface TokenPurchase {
  id: number;
  tokens_credited: number;
  usd_amount: number;
  dash_amount: number | null;
  btcpay_invoice_id: string;
  status: string;
  created_at: string;
  settled_at: string | null;
}

export interface TokenCheckoutData {
  success: boolean;
  provider: "btcpay" | "nowpayments";
  tokens: number;
  usd: number;
  status: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  display_name?: string;
  sku: string;
  price: number;
  currency: string;
  duration_days: number;
  duration?: number;
  features?: string[];
  priceUSD: number;
  priceCOP: number;
  exchangeRate?: number;
  active: boolean;
  tier?: string;
}

export interface RecentTip {
  id: number;
  amount: number;
  user_username: string;
  model_name: string;
  created_at: string;
  payment_status: string;
}

export const TIP_AMOUNTS = [5, 10, 20, 50, 100] as const;
