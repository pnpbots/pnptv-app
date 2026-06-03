const promotionalPlans = [
  {
    id: 'lifetime80',
    sku: 'PNP-000-P-100',
    name: 'Lifetime Prime $100 Crypto',
    display_name: 'Lifetime Prime $100',
    tier: 'PRIME',
    price: 100.0,
    currency: 'USD',
    isPromo: true,
    hidden: true,
  },
  {
    id: 'pnp_hot_monthly_pass',
    sku: 'EASYBOTS-PNP-PROMO-030',
    name: 'PNP Hot Monthly Pass',
    display_name: 'PNP Hot Monthly Pass',
    nameEs: 'Pase Mensual PNP Hot',
    tier: 'PRIME',
    price: 15.0,
    currency: 'USD',
    duration: 30,
    features: [
      '🔥 Full PRIME access for 30 days',
      '💎 Promo-only plan (hidden from public listings)',
    ],
    featuresEs: [
      '🔥 Acceso PRIME completo por 30 días',
      '💎 Plan promocional (oculto de los listados públicos)',
    ],
    paymentLink: 'https://payco.link/ddd1e09c-4499-4542-828a-327eb7f22687',
    isPromo: true,
    hidden: true,
  },
];

module.exports = promotionalPlans;
