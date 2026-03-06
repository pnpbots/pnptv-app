const strings = {
  en: {
    // ── Page head ─────────────────────────────────────────────────────────────
    pageTitle: "Subscribe — PNPtv!",
    pageDescription: "Choose your PNPtv plan. Unlock exclusive content, PRIME video access, nearby discovery, and more.",

    // ── Header ────────────────────────────────────────────────────────────────
    chooseYourPlan: "Choose Your Plan",
    subtitle: "Unlock exclusive content and features with PNPTV PRIME",

    // ── Currency toggle ───────────────────────────────────────────────────────
    showPricesInUSD: "Show prices in USD",
    showPricesInCOP: "Show prices in COP",

    // ── Plan tier section labels ──────────────────────────────────────────────
    communityMember: "Community Member",
    communityMemberDesc: "Social features only — does not include PRIME media or exclusive content",
    prime: "PRIME",
    primeDesc: "Full access — PRIME media, Nearby Premium, hangouts, exclusive content & more",

    // ── Plan duration labels ──────────────────────────────────────────────────
    lifetime: "Lifetime",
    monthly: "Monthly",
    perMonth: "/mo",

    // ── Plan badge ────────────────────────────────────────────────────────────
    bestValue: "Best Value",

    // ── Plan features — member_monthly ────────────────────────────────────────
    featureMember1: "Hangout group rooms",
    featureMember2: "Social feed access",
    featureMember3: "Nearby users discovery",

    // ── Plan features — week_pass ─────────────────────────────────────────────
    featureWeek1: "7 days of full PRIME access",
    featureWeek2: "Exclusive PRIME content",
    featureWeek3: "Nearby Premium features",
    featureWeek4: "Community hangouts",

    // ── Plan features — three_months_pass ────────────────────────────────────
    featureThreeMonths1: "3 months of full PRIME access",
    featureThreeMonths2: "Full PRIME media library access",
    featureThreeMonths3: "Nearby Premium features",
    featureThreeMonths4: "Community hangouts",
    featureThreeMonths5: "Priority support",

    // ── Plan features — crystal_pass ──────────────────────────────────────────
    featureCrystal1: "6 months of full PRIME access",
    featureCrystal2: "Unlimited PRIME content + early releases",
    featureCrystal3: "Nearby Premium features",
    featureCrystal4: "VIP community status",
    featureCrystal5: "Priority support",

    // ── Plan features — yearly_pass ───────────────────────────────────────────
    featureYearly1: "1 year of full PRIME access",
    featureYearly2: "Unlimited PRIME content + exclusives",
    featureYearly3: "Nearby Premium features",
    featureYearly4: "VIP badge + priority support",
    featureYearly5: "Access to exclusive events",

    // ── Plan features — lifetime_pass ─────────────────────────────────────────
    featureLifetime1: "Lifetime PRIME access — pay once",
    featureLifetime2: "Everything in Yearly, forever",
    featureLifetime3: "Founder badge",
    featureLifetime4: "Priority feature requests",
    featureLifetime5: "Never pay again",

    // ── Member plan excluded features ─────────────────────────────────────────
    excludedMember1: "No PRIME media access",
    excludedMember2: "No exclusive video content",
    excludedMember3: "No Telegram PRIME channel access",
    excludedMember4: "No VIP badge or priority support",

    // ── Email section ─────────────────────────────────────────────────────────
    emailAddress: "Email address",
    emailDesc: "We'll send your login credentials and membership info",
    emailPlaceholder: "you@example.com",
    invalidEmail: "Please enter a valid email address",

    // ── Payment methods ───────────────────────────────────────────────────────
    paymentMethod: "Payment Method",
    cardPse: "Card / PSE",
    cardPseDesc: "Credit, Debit",
    usdc: "USDC",
    usdcDesc: "Coinbase, MetaMask",
    dash: "Dash",
    dashAnonymous: "Anonymous",
    dashComingSoon: "Coming soon",
    dashAnonBadge: "ANON",

    // ── Dash info panel ───────────────────────────────────────────────────────
    dashInfoText: "Pay anonymously with Dash — no credit card, no identity required. You'll get a payment address + QR code to send from any Dash wallet.",
    getDashWallet: "Get Dash Wallet ↗",
    buyOnKraken: "Buy on Kraken ↗",
    buyOnUphold: "Buy on Uphold ↗",

    // ── Dash invoice panel ────────────────────────────────────────────────────
    waitingForDashPayment: "Waiting for Dash payment —",
    dashInvoiceDesc: "Complete your payment in the BTCPay checkout page. This page will update automatically once confirmed.",
    openDashCheckout: "Open Dash Checkout",
    cancel: "Cancel",

    // ── Promo / Meru code section ─────────────────────────────────────────────
    or: "or",
    wantBestDeal: "Want the best deal?",
    lifetime100Desc: "Get our Lifetime100 promo — one single payment of $100 for lifetime PRIME access. No subscriptions, no renewals, forever yours.",
    checkoutLifetime100: "Check out the Lifetime100 deal",
    haveMeruCode: "Have a Meru code?",
    meruCodePlaceholder: "Enter your Meru code",
    activate: "Activate",
    verifying: "Verifying...",
    verifyingPayment: "Verifying payment... this may take a few seconds",
    activationFailed: "Activation failed",
    activationError: "Activation error",
    pleaseEnterValidEmailAbove: "Please enter a valid email address above",

    // ── Payment polling ───────────────────────────────────────────────────────
    waitingForPayment: "Waiting for payment...",
    completePaymentInWindow: "Complete the payment in the checkout window. This page will update automatically.",

    // ── Subscribe button ──────────────────────────────────────────────────────
    subscribeNow: "Subscribe Now",
    processingPayment: "Processing...",
    goBack: "Go Back",

    // ── Success screen ────────────────────────────────────────────────────────
    paymentConfirmed: "Payment Confirmed!",
    subscriptionNowActive: "Your subscription is now active. Check your email for your invoice and onboarding guide.",
    goToPNPtv: "Go to PNPtv!",

    // ── Error states ──────────────────────────────────────────────────────────
    noPlansAvailable: "No plans available",
    failedToLoadPlans: "Failed to load plans",
    retry: "Retry",
    paymentTimedOut: "Payment verification timed out. If you completed the payment, your subscription will activate automatically.",
    paymentNotSuccessful: "Payment was not successful. Please try again.",
    dashNotConfigured: "Dash payments are not available yet. Please use ePayco or Daimo instead.",
    dashServerUnavailable: "Payment server is temporarily unavailable. Please try again in a few minutes.",
    dashExpired: "Dash payment expired or was not received. Please try again.",
    failedToCreateDashInvoice: "Failed to create Dash invoice",
    failedToCreatePayment: "Failed to create payment",
    paymentErrorGeneric: "Payment error",
  },

  es: {
    // ── Page head ─────────────────────────────────────────────────────────────
    pageTitle: "Suscribirse — PNPtv!",
    pageDescription: "Elige tu plan de PNPtv. Desbloquea contenido exclusivo, acceso a PRIME, descubrimiento cercano y mucho más.",

    // ── Header ────────────────────────────────────────────────────────────────
    chooseYourPlan: "Elige tu plan",
    subtitle: "Desbloquea contenido exclusivo y funciones con PNPTV PRIME",

    // ── Currency toggle ───────────────────────────────────────────────────────
    showPricesInUSD: "Ver precios en USD",
    showPricesInCOP: "Ver precios en COP",

    // ── Plan tier section labels ──────────────────────────────────────────────
    communityMember: "Miembro de comunidad",
    communityMemberDesc: "Solo funciones sociales — no incluye media PRIME ni contenido exclusivo",
    prime: "PRIME",
    primeDesc: "Acceso completo — media PRIME, Nearby Premium, hangouts, contenido exclusivo y más",

    // ── Plan duration labels ──────────────────────────────────────────────────
    lifetime: "De por vida",
    monthly: "Mensual",
    perMonth: "/mes",

    // ── Plan badge ────────────────────────────────────────────────────────────
    bestValue: "Mejor precio",

    // ── Plan features — member_monthly ────────────────────────────────────────
    featureMember1: "Salas de grupo Hangout",
    featureMember2: "Acceso al feed social",
    featureMember3: "Descubrimiento de usuarios cercanos",

    // ── Plan features — week_pass ─────────────────────────────────────────────
    featureWeek1: "7 días de acceso PRIME completo",
    featureWeek2: "Contenido PRIME exclusivo",
    featureWeek3: "Funciones Nearby Premium",
    featureWeek4: "Hangouts comunitarios",

    // ── Plan features — three_months_pass ────────────────────────────────────
    featureThreeMonths1: "3 meses de acceso PRIME completo",
    featureThreeMonths2: "Acceso completo a la biblioteca de media PRIME",
    featureThreeMonths3: "Funciones Nearby Premium",
    featureThreeMonths4: "Hangouts comunitarios",
    featureThreeMonths5: "Soporte prioritario",

    // ── Plan features — crystal_pass ──────────────────────────────────────────
    featureCrystal1: "6 meses de acceso PRIME completo",
    featureCrystal2: "Contenido PRIME ilimitado + lanzamientos anticipados",
    featureCrystal3: "Funciones Nearby Premium",
    featureCrystal4: "Estatus VIP en la comunidad",
    featureCrystal5: "Soporte prioritario",

    // ── Plan features — yearly_pass ───────────────────────────────────────────
    featureYearly1: "1 año de acceso PRIME completo",
    featureYearly2: "Contenido PRIME ilimitado + exclusivos",
    featureYearly3: "Funciones Nearby Premium",
    featureYearly4: "Insignia VIP + soporte prioritario",
    featureYearly5: "Acceso a eventos exclusivos",

    // ── Plan features — lifetime_pass ─────────────────────────────────────────
    featureLifetime1: "Acceso PRIME de por vida — pago único",
    featureLifetime2: "Todo lo del plan Anual, para siempre",
    featureLifetime3: "Insignia de fundador",
    featureLifetime4: "Solicitudes de funciones prioritarias",
    featureLifetime5: "No vuelves a pagar nunca",

    // ── Member plan excluded features ─────────────────────────────────────────
    excludedMember1: "Sin acceso a media PRIME",
    excludedMember2: "Sin contenido de video exclusivo",
    excludedMember3: "Sin acceso al canal PRIME de Telegram",
    excludedMember4: "Sin insignia VIP ni soporte prioritario",

    // ── Email section ─────────────────────────────────────────────────────────
    emailAddress: "Correo electrónico",
    emailDesc: "Te enviaremos tus credenciales de acceso e información de membresía",
    emailPlaceholder: "tu@ejemplo.com",
    invalidEmail: "Por favor ingresa un correo electrónico válido",

    // ── Payment methods ───────────────────────────────────────────────────────
    paymentMethod: "Método de pago",
    cardPse: "Tarjeta / PSE",
    cardPseDesc: "Crédito, Débito",
    usdc: "USDC",
    usdcDesc: "Coinbase, MetaMask",
    dash: "Dash",
    dashAnonymous: "Anónimo",
    dashComingSoon: "Próximamente",
    dashAnonBadge: "ANON",

    // ── Dash info panel ───────────────────────────────────────────────────────
    dashInfoText: "Paga de forma anónima con Dash — sin tarjeta de crédito, sin identidad requerida. Recibirás una dirección de pago + código QR para enviar desde cualquier billetera Dash.",
    getDashWallet: "Obtener billetera Dash ↗",
    buyOnKraken: "Comprar en Kraken ↗",
    buyOnUphold: "Comprar en Uphold ↗",

    // ── Dash invoice panel ────────────────────────────────────────────────────
    waitingForDashPayment: "Esperando pago Dash —",
    dashInvoiceDesc: "Completa tu pago en la página de BTCPay. Esta página se actualizará automáticamente al confirmarse.",
    openDashCheckout: "Abrir pago Dash",
    cancel: "Cancelar",

    // ── Promo / Meru code section ─────────────────────────────────────────────
    or: "o",
    wantBestDeal: "¿Quieres la mejor oferta?",
    lifetime100Desc: "Obtén nuestra promo Lifetime100 — un solo pago de $100 por acceso PRIME de por vida. Sin suscripciones, sin renovaciones, tuyo para siempre.",
    checkoutLifetime100: "Ver la oferta Lifetime100",
    haveMeruCode: "¿Tienes un código Meru?",
    meruCodePlaceholder: "Ingresa tu código Meru",
    activate: "Activar",
    verifying: "Verificando...",
    verifyingPayment: "Verificando pago... esto puede tardar unos segundos",
    activationFailed: "Error en la activación",
    activationError: "Error al activar",
    pleaseEnterValidEmailAbove: "Por favor ingresa un correo electrónico válido arriba",

    // ── Payment polling ───────────────────────────────────────────────────────
    waitingForPayment: "Esperando pago...",
    completePaymentInWindow: "Completa el pago en la ventana de pago. Esta página se actualizará automáticamente.",

    // ── Subscribe button ──────────────────────────────────────────────────────
    subscribeNow: "Suscribirme ahora",
    processingPayment: "Procesando...",
    goBack: "Volver",

    // ── Success screen ────────────────────────────────────────────────────────
    paymentConfirmed: "¡Pago confirmado!",
    subscriptionNowActive: "Tu suscripción ya está activa. Revisa tu correo para tu factura y guía de bienvenida.",
    goToPNPtv: "Ir a PNPtv!",

    // ── Error states ──────────────────────────────────────────────────────────
    noPlansAvailable: "No hay planes disponibles",
    failedToLoadPlans: "Error al cargar los planes",
    retry: "Reintentar",
    paymentTimedOut: "Se agotó el tiempo de verificación del pago. Si completaste el pago, tu suscripción se activará automáticamente.",
    paymentNotSuccessful: "El pago no fue exitoso. Por favor, inténtalo de nuevo.",
    dashNotConfigured: "Los pagos con Dash no están disponibles aún. Por favor usa ePayco o Daimo.",
    dashServerUnavailable: "El servidor de pagos no está disponible temporalmente. Por favor, inténtalo en unos minutos.",
    dashExpired: "El pago con Dash expiró o no fue recibido. Por favor, inténtalo de nuevo.",
    failedToCreateDashInvoice: "Error al crear la factura Dash",
    failedToCreatePayment: "Error al crear el pago",
    paymentErrorGeneric: "Error en el pago",
  },
} as const;

export type SubscribeStrings = typeof strings.en;
export { strings as subscribe };
