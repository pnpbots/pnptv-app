const strings = {
  en: {
    // Brand
    brandName: "PNPtv!",

    // Loading state
    loadingPaymentDetails: "Loading payment details...",

    // Ready state — plan summary
    payWithWallet: "Pay with any crypto wallet, exchange, or stablecoin",
    paymentRef: "Ref:",

    // Success state
    paymentConfirmedTitle: "Payment Confirmed!",
    paymentConfirmedBody: "Your subscription has been activated. Check Telegram for your access credentials.",
    goToPnptv: "Go to PNPtv!",

    // Error state
    unableToProcess: "Unable to Process",
    closeBtn: "Close",

    // Footer
    secureCheckout: "Secure crypto checkout",
    poweredBy: "powered by Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    // Error messages
    errorNoPaymentId: "No payment ID found.",
    errorPaymentNotFound: "Payment not found or already processed.",
    errorNotCrypto: "This payment is not a crypto payment.",
    errorSessionNotReady: "Payment session not ready. Please try again from the bot.",
    errorCouldNotLoad: "Could not load payment details. Check your connection.",
  },
  es: {
    brandName: "PNPtv!",

    loadingPaymentDetails: "Cargando detalles del pago...",

    payWithWallet: "Paga con cualquier billetera cripto, exchange o stablecoin",
    paymentRef: "Ref:",

    paymentConfirmedTitle: "¡Pago Confirmado!",
    paymentConfirmedBody: "Tu suscripción ha sido activada. Revisa Telegram para tus credenciales de acceso.",
    goToPnptv: "Ir a PNPtv!",

    unableToProcess: "No se pudo Procesar",
    closeBtn: "Cerrar",

    secureCheckout: "Pago cripto seguro",
    poweredBy: "impulsado por Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    errorNoPaymentId: "No se encontró un ID de pago.",
    errorPaymentNotFound: "Pago no encontrado o ya procesado.",
    errorNotCrypto: "Este pago no es un pago cripto.",
    errorSessionNotReady: "La sesión de pago no está lista. Intenta de nuevo desde el bot.",
    errorCouldNotLoad: "No se pudieron cargar los detalles del pago. Verifica tu conexión.",
  },
} as const;

export type CheckoutStrings = typeof strings.en;
export { strings as checkout };
