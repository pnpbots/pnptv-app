const strings = {
  en: {
    // Brand
    brandName: "PNPtv!",

    // Loading state
    loadingPaymentDetails: "Loading payment details...",

    // Email
    emailLabel: "Email",
    emailDesc: "We'll send your login credentials and membership info",
    emailPlaceholder: "you@example.com",
    invalidEmail: "Please enter a valid email address",

    // Ready state — plan summary
    payWithWallet: "Choose how you'd like to pay",
    paymentRef: "Ref:",
    howItWorks: "How it works",
    step1: "Select your payment method below (Apple Pay, card, or wallet)",
    step2: "Confirm the payment in your app or wallet",
    step3: "Your membership activates instantly",

    // Success state
    paymentConfirmedTitle: "Payment Confirmed!",
    paymentConfirmedBody: "Your subscription has been activated. Check Telegram for your access credentials.",
    goToPnptv: "Go to PNPtv!",

    // Error state
    unableToProcess: "Unable to Process",
    closeBtn: "Close",
    tryAgainBtn: "Go Back & Try Again",

    // Footer
    secureCheckout: "Secure crypto checkout",
    poweredBy: "powered by Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    // Confirming state
    confirmingTitle: "Confirming Payment\u2026",
    confirmingBody: "Your transaction was submitted. We are waiting for on-chain confirmation before crediting your account. This usually takes a few seconds \u2014 please keep this page open.",

    // Error messages
    errorNoPaymentId: "No payment ID found.",
    errorPaymentNotFound: "Payment not found or already processed.",
    errorNotCrypto: "This payment is not a crypto payment.",
    errorSessionNotReady: "Payment session expired. Please go back and try again.",
    errorCouldNotLoad: "Could not load payment details. Check your connection.",
    confirmationTimeout: "Your transaction was submitted but is taking longer than expected. You will receive a Telegram notification once confirmed.",
  },
  es: {
    brandName: "PNPtv!",

    emailLabel: "Correo electrónico",
    emailDesc: "Enviaremos tus credenciales de acceso e información de membresía",
    emailPlaceholder: "tu@ejemplo.com",
    invalidEmail: "Por favor ingresa un correo electrónico válido",

    loadingPaymentDetails: "Cargando detalles del pago...",

    payWithWallet: "Elige cómo quieres pagar",
    paymentRef: "Ref:",
    howItWorks: "Cómo funciona",
    step1: "Selecciona tu método de pago abajo (Apple Pay, tarjeta o billetera)",
    step2: "Confirma el pago en tu app o billetera",
    step3: "Tu membresía se activa al instante",

    paymentConfirmedTitle: "¡Pago Confirmado!",
    paymentConfirmedBody: "Tu suscripción ha sido activada. Revisa Telegram para tus credenciales de acceso.",
    goToPnptv: "Ir a PNPtv!",

    unableToProcess: "No se pudo Procesar",
    closeBtn: "Cerrar",
    tryAgainBtn: "Volver e Intentar de Nuevo",

    secureCheckout: "Pago cripto seguro",
    poweredBy: "impulsado por Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Confirmando Pago\u2026",
    confirmingBody: "Tu transacci\u00f3n fue enviada. Estamos esperando la confirmaci\u00f3n en la cadena antes de acreditar tu cuenta. Esto suele tardar unos segundos \u2014 por favor mant\u00e9n esta p\u00e1gina abierta.",
    errorNoPaymentId: "No se encontr\u00f3 un ID de pago.",
    errorPaymentNotFound: "Pago no encontrado o ya procesado.",
    errorNotCrypto: "Este pago no es un pago cripto.",
    errorSessionNotReady: "La sesi\u00f3n de pago expir\u00f3. Por favor regresa e intenta de nuevo.",
    errorCouldNotLoad: "No se pudieron cargar los detalles del pago. Verifica tu conexi\u00f3n.",
    confirmationTimeout: "Tu transacci\u00f3n fue enviada pero est\u00e1 tardando m\u00e1s de lo esperado. Recibir\u00e1s una notificaci\u00f3n en Telegram una vez confirmada.",
  },

  pt: {
    brandName: "PNPtv!",

    emailLabel: "E-mail",
    emailDesc: "Enviaremos suas credenciais de acesso e informações de assinatura",
    emailPlaceholder: "voce@exemplo.com",
    invalidEmail: "Por favor, insira um endereço de e-mail válido",

    loadingPaymentDetails: "Carregando detalhes do pagamento...",

    payWithWallet: "Escolha como quer pagar",
    paymentRef: "Ref:",
    howItWorks: "Como funciona",
    step1: "Selecione seu método de pagamento abaixo (Apple Pay, cartão ou carteira)",
    step2: "Confirme o pagamento no seu app ou carteira",
    step3: "Sua assinatura é ativada instantaneamente",

    paymentConfirmedTitle: "Pagamento Confirmado!",
    paymentConfirmedBody: "Sua assinatura foi ativada. Verifique o Telegram para suas credenciais de acesso.",
    goToPnptv: "Ir para PNPtv!",

    unableToProcess: "Não Foi Possível Processar",
    closeBtn: "Fechar",
    tryAgainBtn: "Voltar e Tentar Novamente",

    secureCheckout: "Checkout cripto seguro",
    poweredBy: "powered by Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Confirmando Pagamento\u2026",
    confirmingBody: "Sua transa\u00e7\u00e3o foi enviada. Estamos aguardando a confirma\u00e7\u00e3o on-chain antes de creditar sua conta. Isso geralmente leva alguns segundos \u2014 por favor mant\u00e9nha esta p\u00e1gina aberta.",
    errorNoPaymentId: "Nenhum ID de pagamento encontrado.",
    errorPaymentNotFound: "Pagamento n\u00e3o encontrado ou j\u00e1 processado.",
    errorNotCrypto: "Este pagamento n\u00e3o \u00e9 um pagamento cripto.",
    errorSessionNotReady: "Sess\u00e3o de pagamento expirada. Volte e tente novamente.",
    errorCouldNotLoad: "N\u00e3o foi poss\u00edvel carregar os detalhes do pagamento. Verifique sua conex\u00e3o.",
    confirmationTimeout: "Sua transa\u00e7\u00e3o foi enviada, mas est\u00e1 demorando mais que o esperado. Voc\u00ea receber\u00e1 uma notifica\u00e7\u00e3o no Telegram quando for confirmada.",
  },

  zh: {
    brandName: "PNPtv!",

    emailLabel: "电子邮件",
    emailDesc: "我们将发送您的登录凭证和会员信息",
    emailPlaceholder: "you@example.com",
    invalidEmail: "请输入有效的电子邮件地址",

    loadingPaymentDetails: "正在加载支付详情...",

    payWithWallet: "选择您的支付方式",
    paymentRef: "参考：",
    howItWorks: "如何操作",
    step1: "在下方选择支付方式（Apple Pay、银行卡或钱包）",
    step2: "在您的应用或钱包中确认付款",
    step3: "您的会员资格即时激活",

    paymentConfirmedTitle: "支付已确认！",
    paymentConfirmedBody: "您的订阅已激活。请查看 Telegram 获取访问凭证。",
    goToPnptv: "前往 PNPtv!",

    unableToProcess: "无法处理",
    closeBtn: "关闭",
    tryAgainBtn: "返回重试",

    secureCheckout: "安全加密结账",
    poweredBy: "由 Daimo Pay 提供支持",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "正在确认付款\u2026",
    confirmingBody: "您的交易已提交。我们正在等待链上确认，然后才会为您的账户充值。通常只需几秒钟\u2014\u2014请保持本页面打开。",
    errorNoPaymentId: "未找到支付 ID。",
    errorPaymentNotFound: "未找到支付或已处理。",
    errorNotCrypto: "该支付不是加密支付。",
    errorSessionNotReady: "支付会话已过期。请返回重试。",
    errorCouldNotLoad: "无法加载支付详情，请检查您的网络连接。",
    confirmationTimeout: "您的交易已提交，但确认时间超出预期。一旦确认，您将收到 Telegram 通知。",
  },

  zhTW: {
    brandName: "PNPtv!",

    emailLabel: "電子郵件",
    emailDesc: "我們將發送您的登入憑證和會員資訊",
    emailPlaceholder: "you@example.com",
    invalidEmail: "請輸入有效的電子郵件地址",

    loadingPaymentDetails: "正在載入付款詳情...",

    payWithWallet: "選擇您的付款方式",
    paymentRef: "參考：",
    howItWorks: "如何操作",
    step1: "在下方選擇付款方式（Apple Pay、銀行卡或錢包）",
    step2: "在您的應用或錢包中確認付款",
    step3: "您的會員資格即時啟用",

    paymentConfirmedTitle: "付款已確認！",
    paymentConfirmedBody: "您的訂閱已啟用。請查看 Telegram 獲取存取憑證。",
    goToPnptv: "前往 PNPtv!",

    unableToProcess: "無法處理",
    closeBtn: "關閉",
    tryAgainBtn: "返回重試",

    secureCheckout: "安全加密結帳",
    poweredBy: "由 Daimo Pay 提供支援",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "正在確認付款\u2026",
    confirmingBody: "您的交易已提交。我們正在等待鏈上確認，然後才會為您的帳戶充值。通常只需幾秒鐘\u2014\u2014請保持本頁面開啟。",
    errorNoPaymentId: "找不到付款 ID。",
    errorPaymentNotFound: "找不到付款或已處理完畢。",
    errorNotCrypto: "此付款不是加密付款。",
    errorSessionNotReady: "付款會話已過期。請返回重試。",
    errorCouldNotLoad: "無法載入付款詳情，請檢查您的網路連線。",
    confirmationTimeout: "您的交易已提交，但確認時間超出預期。一旦確認，您將收到 Telegram 通知。",
  },

  fr: {
    brandName: "PNPtv!",

    emailLabel: "E-mail",
    emailDesc: "Nous enverrons vos identifiants de connexion et informations d'abonnement",
    emailPlaceholder: "vous@exemple.com",
    invalidEmail: "Veuillez entrer une adresse e-mail valide",

    loadingPaymentDetails: "Chargement des détails du paiement...",

    payWithWallet: "Choisissez comment payer",
    paymentRef: "Réf :",
    howItWorks: "Comment ça marche",
    step1: "Sélectionnez votre mode de paiement ci-dessous (Apple Pay, carte ou portefeuille)",
    step2: "Confirmez le paiement dans votre application ou portefeuille",
    step3: "Votre abonnement s'active instantanément",

    paymentConfirmedTitle: "Paiement Confirmé !",
    paymentConfirmedBody: "Votre abonnement a été activé. Consultez Telegram pour vos identifiants d'accès.",
    goToPnptv: "Aller sur PNPtv!",

    unableToProcess: "Impossible de Traiter",
    closeBtn: "Fermer",
    tryAgainBtn: "Revenir et Réessayer",

    secureCheckout: "Paiement crypto sécurisé",
    poweredBy: "propulsé par Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Confirmation du paiement\u2026",
    confirmingBody: "Votre transaction a \u00e9t\u00e9 soumise. Nous attendons la confirmation on-chain avant de cr\u00e9diter votre compte. Cela prend g\u00e9n\u00e9ralement quelques secondes \u2014 veuillez garder cette page ouverte.",
    errorNoPaymentId: "Aucun identifiant de paiement trouv\u00e9.",
    errorPaymentNotFound: "Paiement introuvable ou d\u00e9j\u00e0 trait\u00e9.",
    errorNotCrypto: "Ce paiement n'est pas un paiement crypto.",
    errorSessionNotReady: "La session de paiement a expir\u00e9. Veuillez revenir et r\u00e9essayer.",
    errorCouldNotLoad: "Impossible de charger les d\u00e9tails du paiement. V\u00e9rifiez votre connexion.",
    confirmationTimeout: "Votre transaction a \u00e9t\u00e9 soumise mais la confirmation prend plus de temps que pr\u00e9vu. Vous recevrez une notification Telegram une fois confirm\u00e9e.",
  },

  de: {
    brandName: "PNPtv!",

    emailLabel: "E-Mail",
    emailDesc: "Wir senden dir deine Zugangsdaten und Mitgliedschaftsinformationen",
    emailPlaceholder: "du@beispiel.de",
    invalidEmail: "Bitte gib eine gültige E-Mail-Adresse ein",

    loadingPaymentDetails: "Zahlungsdetails werden geladen...",

    payWithWallet: "Wähle deine Zahlungsmethode",
    paymentRef: "Ref:",
    howItWorks: "So funktioniert es",
    step1: "Wähle unten deine Zahlungsmethode (Apple Pay, Karte oder Wallet)",
    step2: "Bestätige die Zahlung in deiner App oder Wallet",
    step3: "Dein Abo wird sofort aktiviert",

    paymentConfirmedTitle: "Zahlung bestätigt!",
    paymentConfirmedBody: "Dein Abonnement wurde aktiviert. Prüfe Telegram für deine Zugangsdaten.",
    goToPnptv: "Zu PNPtv!",

    unableToProcess: "Verarbeitung nicht möglich",
    closeBtn: "Schließen",
    tryAgainBtn: "Zurück & Erneut Versuchen",

    secureCheckout: "Sicherer Krypto-Checkout",
    poweredBy: "betrieben von Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Zahlung wird best\u00e4tigt\u2026",
    confirmingBody: "Deine Transaktion wurde eingereicht. Wir warten auf die On-Chain-Best\u00e4tigung, bevor wir dein Konto gutschreiben. Das dauert normalerweise nur wenige Sekunden \u2014 bitte lass diese Seite ge\u00f6ffnet.",
    errorNoPaymentId: "Keine Zahlungs-ID gefunden.",
    errorPaymentNotFound: "Zahlung nicht gefunden oder bereits verarbeitet.",
    errorNotCrypto: "Diese Zahlung ist keine Krypto-Zahlung.",
    errorSessionNotReady: "Zahlungssitzung abgelaufen. Bitte gehe zur\u00fcck und versuche es erneut.",
    errorCouldNotLoad: "Zahlungsdetails konnten nicht geladen werden. \u00dcberpr\u00fcfe deine Verbindung.",
    confirmationTimeout: "Deine Transaktion wurde eingereicht, die Best\u00e4tigung dauert jedoch l\u00e4nger als erwartet. Du erh\u00e4ltst eine Telegram-Benachrichtigung, sobald sie best\u00e4tigt ist.",
  },

  th: {
    brandName: "PNPtv!",

    emailLabel: "อีเมล",
    emailDesc: "เราจะส่งข้อมูลการเข้าสู่ระบบและข้อมูลสมาชิกให้คุณ",
    emailPlaceholder: "you@example.com",
    invalidEmail: "กรุณากรอกอีเมลที่ถูกต้อง",

    loadingPaymentDetails: "กำลังโหลดรายละเอียดการชำระเงิน...",

    payWithWallet: "เลือกวิธีการชำระเงินของคุณ",
    paymentRef: "อ้างอิง:",
    howItWorks: "วิธีการทำงาน",
    step1: "เลือกวิธีการชำระเงินด้านล่าง (Apple Pay, บัตร หรือกระเป๋าเงิน)",
    step2: "ยืนยันการชำระเงินในแอปหรือกระเป๋าเงินของคุณ",
    step3: "สมาชิกของคุณจะเปิดใช้งานทันที",

    paymentConfirmedTitle: "ยืนยันการชำระเงินแล้ว!",
    paymentConfirmedBody: "สมาชิกของคุณถูกเปิดใช้งานแล้ว ตรวจสอบ Telegram เพื่อรับข้อมูลการเข้าถึง",
    goToPnptv: "ไปที่ PNPtv!",

    unableToProcess: "ไม่สามารถดำเนินการได้",
    closeBtn: "ปิด",
    tryAgainBtn: "กลับไป & ลองอีกครั้ง",

    secureCheckout: "ชำระเงินคริปโตอย่างปลอดภัย",
    poweredBy: "ขับเคลื่อนโดย Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "กำลังยืนยันการชำระเงิน\u2026",
    confirmingBody: "ธุรกรรมของคุณถูกส่งแล้ว เรากำลังรอการยืนยันบนเชนก่อนเครดิตบัญชีของคุณ โดยปกติใช้เวลาเพียงไม่กี่วินาที \u2014 กรุณาอย่าปิดหน้านี้",
    errorNoPaymentId: "ไม่พบ ID การชำระเงิน",
    errorPaymentNotFound: "ไม่พบการชำระเงินหรือดำเนินการไปแล้ว",
    errorNotCrypto: "การชำระเงินนี้ไม่ใช่การชำระเงินคริปโต",
    errorSessionNotReady: "เซสชันการชำระเงินหมดอายุ กรุณากลับไปแล้วลองอีกครั้ง",
    errorCouldNotLoad: "ไม่สามารถโหลดรายละเอียดการชำระเงินได้ กรุณาตรวจสอบการเชื่อมต่อ",
    confirmationTimeout: "ธุรกรรมของคุณถูกส่งแล้ว แต่การยืนยันใช้เวลานานกว่าที่คาดไว้ คุณจะได้รับการแจ้งเตือนทาง Telegram เมื่อยืนยันแล้ว",
  },

  it: {
    brandName: "PNPtv!",

    emailLabel: "E-mail",
    emailDesc: "Invieremo le tue credenziali di accesso e le informazioni sull'abbonamento",
    emailPlaceholder: "tu@esempio.com",
    invalidEmail: "Inserisci un indirizzo e-mail valido",

    loadingPaymentDetails: "Caricamento dettagli di pagamento...",

    payWithWallet: "Scegli come vuoi pagare",
    paymentRef: "Rif:",
    howItWorks: "Come funziona",
    step1: "Seleziona il tuo metodo di pagamento qui sotto (Apple Pay, carta o wallet)",
    step2: "Conferma il pagamento nella tua app o wallet",
    step3: "Il tuo abbonamento si attiva istantaneamente",

    paymentConfirmedTitle: "Pagamento Confermato!",
    paymentConfirmedBody: "Il tuo abbonamento è stato attivato. Controlla Telegram per le tue credenziali di accesso.",
    goToPnptv: "Vai su PNPtv!",

    unableToProcess: "Impossibile Elaborare",
    closeBtn: "Chiudi",
    tryAgainBtn: "Torna Indietro e Riprova",

    secureCheckout: "Checkout crypto sicuro",
    poweredBy: "powered by Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Conferma del pagamento\u2026",
    confirmingBody: "La tua transazione \u00e8 stata inviata. Stiamo aspettando la conferma on-chain prima di accreditare il tuo account. Di solito bastano pochi secondi \u2014 tieni questa pagina aperta.",
    errorNoPaymentId: "Nessun ID di pagamento trovato.",
    errorPaymentNotFound: "Pagamento non trovato o gi\u00e0 elaborato.",
    errorNotCrypto: "Questo pagamento non \u00e8 un pagamento crypto.",
    errorSessionNotReady: "Sessione di pagamento scaduta. Torna indietro e riprova.",
    errorCouldNotLoad: "Impossibile caricare i dettagli del pagamento. Controlla la tua connessione.",
    confirmationTimeout: "La tua transazione \u00e8 stata inviata ma la conferma sta richiedendo pi\u00f9 del previsto. Riceverai una notifica Telegram una volta confermata.",
  },

  tr: {
    brandName: "PNPtv!",

    emailLabel: "E-posta",
    emailDesc: "Giriş bilgilerini ve üyelik bilgilerini göndereceğiz",
    emailPlaceholder: "sen@ornek.com",
    invalidEmail: "Lütfen geçerli bir e-posta adresi gir",

    loadingPaymentDetails: "Ödeme detayları yükleniyor...",

    payWithWallet: "Nasıl ödeme yapmak istediğini seç",
    paymentRef: "Ref:",
    howItWorks: "Nasıl çalışır",
    step1: "Aşağıdan ödeme yöntemini seç (Apple Pay, kart veya cüzdan)",
    step2: "Uygulamanda veya cüzdanında ödemeyi onayla",
    step3: "Üyeliğin anında aktifleşir",

    paymentConfirmedTitle: "Ödeme Onaylandı!",
    paymentConfirmedBody: "Aboneliğin aktif edildi. Erişim bilgilerin için Telegram'ı kontrol et.",
    goToPnptv: "PNPtv!'e Git",

    unableToProcess: "İşlem Yapılamadı",
    closeBtn: "Kapat",
    tryAgainBtn: "Geri Dön & Tekrar Dene",

    secureCheckout: "Güvenli kripto ödeme",
    poweredBy: "Daimo Pay ile desteklenmektedir",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "\u00d6deme do\u011frulan\u0131yor\u2026",
    confirmingBody: "\u0130\u015fleminiz g\u00f6nderildi. Hesab\u0131n\u0131za kredi eklemeden \u00f6nce zincir \u00fczerinde onay bekliyoruz. Bu genellikle birka\u00e7 saniye s\u00fcrer \u2014 l\u00fctfen bu sayfay\u0131 a\u00e7\u0131k tutun.",
    errorNoPaymentId: "\u00d6deme ID'si bulunamad\u0131.",
    errorPaymentNotFound: "\u00d6deme bulunamad\u0131 veya zaten i\u015flendi.",
    errorNotCrypto: "Bu \u00f6deme bir kripto \u00f6deme de\u011fil.",
    errorSessionNotReady: "\u00d6deme oturumu s\u00fcresi doldu. L\u00fctfen geri d\u00f6n ve tekrar dene.",
    errorCouldNotLoad: "\u00d6deme detaylar\u0131 y\u00fcklenemedi. Ba\u011flant\u0131n\u0131 kontrol et.",
    confirmationTimeout: "\u0130\u015fleminiz g\u00f6nderildi ancak onay beklenenden uzun s\u00fcr\u00fcyor. Onaylan\u0131nca Telegram bildirimi alacaks\u0131n.",
  },

  ru: {
    brandName: "PNPtv!",

    emailLabel: "Электронная почта",
    emailDesc: "Мы отправим ваши данные для входа и информацию о подписке",
    emailPlaceholder: "you@example.com",
    invalidEmail: "Пожалуйста, введите действительный адрес электронной почты",

    loadingPaymentDetails: "Загрузка деталей платежа...",

    payWithWallet: "Выберите способ оплаты",
    paymentRef: "Реф:",
    howItWorks: "Как это работает",
    step1: "Выберите способ оплаты ниже (Apple Pay, карта или кошелёк)",
    step2: "Подтвердите оплату в приложении или кошельке",
    step3: "Ваша подписка активируется мгновенно",

    paymentConfirmedTitle: "Платёж подтверждён!",
    paymentConfirmedBody: "Ваша подписка активирована. Проверьте Telegram для получения данных доступа.",
    goToPnptv: "Перейти на PNPtv!",

    unableToProcess: "Невозможно обработать",
    closeBtn: "Закрыть",
    tryAgainBtn: "Назад и Попробовать Снова",

    secureCheckout: "Безопасная крипто-оплата",
    poweredBy: "на платформе Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u043f\u043b\u0430\u0442\u0435\u0436\u0430\u2026",
    confirmingBody: "\u0412\u0430\u0448 \u043f\u043b\u0430\u0442\u0451\u0436 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d. \u041c\u044b \u043e\u0436\u0438\u0434\u0430\u0435\u043c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0432 \u0431\u043b\u043e\u043a\u0447\u0435\u0439\u043d\u0435, \u043f\u0440\u0435\u0436\u0434\u0435 \u0447\u0435\u043c \u0437\u0430\u0447\u0438\u0441\u043b\u0438\u0442\u044c \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u043d\u0430 \u0432\u0430\u0448 \u0441\u0447\u0451\u0442. \u041e\u0431\u044b\u0447\u043d\u043e \u044d\u0442\u043e \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u0441\u0435\u043a\u0443\u043d\u0434 \u2014 \u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430, \u043d\u0435 \u0437\u0430\u043a\u0440\u044b\u0432\u0430\u0439\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443.",
    errorNoPaymentId: "\u0418\u0434\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0442\u043e\u0440 \u043f\u043b\u0430\u0442\u0435\u0436\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d.",
    errorPaymentNotFound: "\u041f\u043b\u0430\u0442\u0451\u0436 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0438\u043b\u0438 \u0443\u0436\u0435 \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d.",
    errorNotCrypto: "\u042d\u0442\u043e\u0442 \u043f\u043b\u0430\u0442\u0451\u0436 \u043d\u0435 \u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u043a\u0440\u0438\u043f\u0442\u043e\u043f\u043b\u0430\u0442\u0435\u0436\u043e\u043c.",
    errorSessionNotReady: "\u0421\u0435\u0441\u0441\u0438\u044f \u043e\u043f\u043b\u0430\u0442\u044b \u0438\u0441\u0442\u0435\u043a\u043b\u0430. \u0412\u0435\u0440\u043d\u0438\u0442\u0435\u0441\u044c \u043d\u0430\u0437\u0430\u0434 \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.",
    errorCouldNotLoad: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0434\u0435\u0442\u0430\u043b\u0438 \u043f\u043b\u0430\u0442\u0435\u0436\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435.",
    confirmationTimeout: "\u0412\u0430\u0448 \u043f\u043b\u0430\u0442\u0451\u0436 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d, \u043d\u043e \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442 \u0431\u043e\u043b\u044c\u0448\u0435 \u043e\u0436\u0438\u0434\u0430\u0435\u043c\u043e\u0433\u043e. \u0412\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435 \u0432 Telegram \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f.",
  },

  nl: {
    brandName: "PNPtv!",

    emailLabel: "E-mail",
    emailDesc: "We sturen je inloggegevens en lidmaatschapsinformatie",
    emailPlaceholder: "jij@voorbeeld.nl",
    invalidEmail: "Voer een geldig e-mailadres in",

    loadingPaymentDetails: "Betalingsgegevens laden...",

    payWithWallet: "Kies hoe je wilt betalen",
    paymentRef: "Ref:",
    howItWorks: "Hoe het werkt",
    step1: "Selecteer je betaalmethode hieronder (Apple Pay, kaart of wallet)",
    step2: "Bevestig de betaling in je app of wallet",
    step3: "Je abonnement wordt direct geactiveerd",

    paymentConfirmedTitle: "Betaling Bevestigd!",
    paymentConfirmedBody: "Je abonnement is geactiveerd. Controleer Telegram voor je toegangsgegevens.",
    goToPnptv: "Naar PNPtv!",

    unableToProcess: "Kan Niet Verwerken",
    closeBtn: "Sluiten",
    tryAgainBtn: "Terug & Opnieuw Proberen",

    secureCheckout: "Veilige crypto-checkout",
    poweredBy: "aangedreven door Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Betaling bevestigen\u2026",
    confirmingBody: "Je transactie is ingediend. We wachten op bevestiging op de blockchain voordat we je account crediteren. Dit duurt normaal gesproken slechts een paar seconden \u2014 houd deze pagina open.",
    errorNoPaymentId: "Geen betalings-ID gevonden.",
    errorPaymentNotFound: "Betaling niet gevonden of al verwerkt.",
    errorNotCrypto: "Deze betaling is geen crypto-betaling.",
    errorSessionNotReady: "Betaalsessie verlopen. Ga terug en probeer het opnieuw.",
    errorCouldNotLoad: "Betalingsgegevens konden niet worden geladen. Controleer je verbinding.",
    confirmationTimeout: "Je transactie is ingediend maar de bevestiging duurt langer dan verwacht. Je ontvangt een Telegram-melding zodra deze bevestigd is.",
  },

  vi: {
    brandName: "PNPtv!",

    emailLabel: "Email",
    emailDesc: "Chúng tôi sẽ gửi thông tin đăng nhập và thông tin thành viên của bạn",
    emailPlaceholder: "ban@vidu.com",
    invalidEmail: "Vui lòng nhập địa chỉ email hợp lệ",

    loadingPaymentDetails: "Đang tải chi tiết thanh toán...",

    payWithWallet: "Chọn cách bạn muốn thanh toán",
    paymentRef: "Mã tham chiếu:",
    howItWorks: "Cách thức hoạt động",
    step1: "Chọn phương thức thanh toán bên dưới (Apple Pay, thẻ hoặc ví)",
    step2: "Xác nhận thanh toán trong ứng dụng hoặc ví của bạn",
    step3: "Thành viên của bạn được kích hoạt ngay lập tức",

    paymentConfirmedTitle: "Thanh Toán Đã Xác Nhận!",
    paymentConfirmedBody: "Đăng ký của bạn đã được kích hoạt. Kiểm tra Telegram để lấy thông tin đăng nhập.",
    goToPnptv: "Đến PNPtv!",

    unableToProcess: "Không Thể Xử Lý",
    closeBtn: "Đóng",
    tryAgainBtn: "Quay Lại & Thử Lại",

    secureCheckout: "Thanh toán crypto an toàn",
    poweredBy: "powered by Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Đang x\u00e1c nh\u1eadn thanh to\u00e1n\u2026",
    confirmingBody: "Giao d\u1ecbch c\u1ee7a b\u1ea1n \u0111\u00e3 \u0111\u01b0\u1ee3c g\u1eedi. Ch\u00fang t\u00f4i \u0111ang ch\u1edd x\u00e1c nh\u1eadn on-chain tr\u01b0\u1edbc khi ghi c\u00f3 t\u00e0i kho\u1ea3n c\u1ee7a b\u1ea1n. Qu\u00e1 tr\u00ecnh n\u00e0y th\u01b0\u1eddng ch\u1ec9 m\u1ea5t v\u00e0i gi\u00e2y \u2014 vui l\u00f2ng gi\u1eef trang n\u00e0y m\u1edf.",
    errorNoPaymentId: "Kh\u00f4ng t\u00ecm th\u1ea5y ID thanh to\u00e1n.",
    errorPaymentNotFound: "Kh\u00f4ng t\u00ecm th\u1ea5y thanh to\u00e1n ho\u1eb7c \u0111\u00e3 \u0111\u01b0\u1ee3c x\u1eed l\u00fd.",
    errorNotCrypto: "Thanh to\u00e1n n\u00e0y kh\u00f4ng ph\u1ea3i l\u00e0 thanh to\u00e1n crypto.",
    errorSessionNotReady: "Phi\u00ean thanh to\u00e1n \u0111\u00e3 h\u1ebft h\u1ea1n. Vui l\u00f2ng quay l\u1ea1i v\u00e0 th\u1eed l\u1ea1i.",
    errorCouldNotLoad: "Kh\u00f4ng th\u1ec3 t\u1ea3i chi ti\u1ebft thanh to\u00e1n. Ki\u1ec3m tra k\u1ebft n\u1ed1i c\u1ee7a b\u1ea1n.",
    confirmationTimeout: "Giao d\u1ecbch c\u1ee7a b\u1ea1n \u0111\u00e3 \u0111\u01b0\u1ee3c g\u1eedi nh\u01b0ng x\u00e1c nh\u1eadn m\u1ea5t nhi\u1ec1u th\u1eddi gian h\u01a1n d\u1ef1 ki\u1ebfn. B\u1ea1n s\u1ebd nh\u1eadn \u0111\u01b0\u1ee3c th\u00f4ng b\u00e1o Telegram khi \u0111\u01b0\u1ee3c x\u00e1c nh\u1eadn.",
  },

  ja: {
    brandName: "PNPtv!",

    emailLabel: "メールアドレス",
    emailDesc: "ログイン情報と会員情報をお送りします",
    emailPlaceholder: "you@example.com",
    invalidEmail: "有効なメールアドレスを入力してください",

    loadingPaymentDetails: "支払い詳細を読み込み中...",

    payWithWallet: "お支払い方法を選択",
    paymentRef: "参照：",
    howItWorks: "ご利用方法",
    step1: "下からお支払い方法を選択（Apple Pay、カード、またはウォレット）",
    step2: "アプリまたはウォレットで支払いを確認",
    step3: "メンバーシップが即座に有効になります",

    paymentConfirmedTitle: "支払い確認済み！",
    paymentConfirmedBody: "サブスクリプションが有効になりました。アクセス情報については Telegram をご確認ください。",
    goToPnptv: "PNPtv! へ",

    unableToProcess: "処理できません",
    closeBtn: "閉じる",
    tryAgainBtn: "戻ってやり直す",

    secureCheckout: "安全なクリプト決済",
    poweredBy: "Daimo Pay 提供",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "\u652f\u6255\u3044\u3092\u78ba\u8a8d\u4e2d\u2026",
    confirmingBody: "\u53d6\u5f15\u304c\u9001\u4fe1\u3055\u308c\u307e\u3057\u305f\u3002\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u30af\u30ec\u30b8\u30c3\u30c8\u3059\u308b\u524d\u306b\u3001\u30aa\u30f3\u30c1\u30a7\u30fc\u30f3\u306e\u78ba\u8a8d\u3092\u5f85\u3063\u3066\u3044\u307e\u3059\u3002\u901a\u5e38\u306f\u6570\u79d2\u3067\u5b8c\u4e86\u3057\u307e\u3059\u2014\u3053\u306e\u30da\u30fc\u30b8\u3092\u958b\u3044\u305f\u307e\u307e\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
    errorNoPaymentId: "\u652f\u6255\u3044 ID \u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002",
    errorPaymentNotFound: "\u652f\u6255\u3044\u304c\u898b\u3064\u304b\u3089\u306a\u3044\u304b\u3001\u3059\u3067\u306b\u51e6\u7406\u3055\u308c\u3066\u3044\u307e\u3059\u3002",
    errorNotCrypto: "\u3053\u306e\u652f\u6255\u3044\u306f\u30af\u30ea\u30d7\u30c8\u652f\u6255\u3044\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002",
    errorSessionNotReady: "\u652f\u6255\u3044\u30bb\u30c3\u30b7\u30e7\u30f3\u304c\u671f\u9650\u5207\u308c\u3067\u3059\u3002\u623b\u3063\u3066\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002",
    errorCouldNotLoad: "\u652f\u6255\u3044\u8a73\u7d30\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u63a5\u7d9a\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
    confirmationTimeout: "\u53d6\u5f15\u306f\u9001\u4fe1\u3055\u308c\u307e\u3057\u305f\u304c\u3001\u78ba\u8a8d\u306b\u4e88\u60f3\u4ee5\u4e0a\u306e\u6642\u9593\u304c\u304b\u304b\u3063\u3066\u3044\u307e\u3059\u3002\u78ba\u8a8d\u5f8c\u306b Telegram \u901a\u77e5\u304c\u5c4a\u304d\u307e\u3059\u3002",
  },

  id: {
    brandName: "PNPtv!",

    emailLabel: "Email",
    emailDesc: "Kami akan mengirim kredensial login dan informasi keanggotaan Anda",
    emailPlaceholder: "anda@contoh.com",
    invalidEmail: "Masukkan alamat email yang valid",

    loadingPaymentDetails: "Memuat detail pembayaran...",

    payWithWallet: "Pilih cara pembayaran Anda",
    paymentRef: "Ref:",
    howItWorks: "Cara kerjanya",
    step1: "Pilih metode pembayaran di bawah (Apple Pay, kartu, atau dompet)",
    step2: "Konfirmasi pembayaran di aplikasi atau dompet Anda",
    step3: "Keanggotaan Anda langsung aktif",

    paymentConfirmedTitle: "Pembayaran Dikonfirmasi!",
    paymentConfirmedBody: "Langganan Anda telah diaktifkan. Cek Telegram untuk kredensial akses Anda.",
    goToPnptv: "Ke PNPtv!",

    unableToProcess: "Tidak Dapat Memproses",
    closeBtn: "Tutup",
    tryAgainBtn: "Kembali & Coba Lagi",

    secureCheckout: "Checkout kripto aman",
    poweredBy: "didukung oleh Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "Mengonfirmasi Pembayaran\u2026",
    confirmingBody: "Transaksi Anda telah dikirimkan. Kami menunggu konfirmasi on-chain sebelum mengkredit akun Anda. Biasanya hanya membutuhkan beberapa detik \u2014 harap tetap buka halaman ini.",
    errorNoPaymentId: "ID pembayaran tidak ditemukan.",
    errorPaymentNotFound: "Pembayaran tidak ditemukan atau sudah diproses.",
    errorNotCrypto: "Pembayaran ini bukan pembayaran kripto.",
    errorSessionNotReady: "Sesi pembayaran telah berakhir. Kembali dan coba lagi.",
    errorCouldNotLoad: "Tidak dapat memuat detail pembayaran. Periksa koneksi Anda.",
    confirmationTimeout: "Transaksi Anda telah dikirimkan tetapi konfirmasi membutuhkan waktu lebih lama dari yang diperkirakan. Anda akan menerima notifikasi Telegram setelah dikonfirmasi.",
  },

  ar: {
    brandName: "PNPtv!",

    emailLabel: "البريد الإلكتروني",
    emailDesc: "سنرسل بيانات تسجيل الدخول ومعلومات العضوية الخاصة بك",
    emailPlaceholder: "you@example.com",
    invalidEmail: "يرجى إدخال عنوان بريد إلكتروني صالح",

    loadingPaymentDetails: "جارٍ تحميل تفاصيل الدفع...",

    payWithWallet: "اختر طريقة الدفع",
    paymentRef: "المرجع:",
    howItWorks: "كيف يعمل",
    step1: "اختر طريقة الدفع أدناه (Apple Pay، بطاقة، أو محفظة)",
    step2: "أكّد الدفع في تطبيقك أو محفظتك",
    step3: "عضويتك تُفعّل فوراً",

    paymentConfirmedTitle: "تم تأكيد الدفع!",
    paymentConfirmedBody: "تم تفعيل اشتراكك. تحقق من Telegram للحصول على بيانات الوصول.",
    goToPnptv: "الذهاب إلى PNPtv!",

    unableToProcess: "تعذّر المعالجة",
    closeBtn: "إغلاق",
    tryAgainBtn: "العودة والمحاولة مجدداً",

    secureCheckout: "دفع تشفيري آمن",
    poweredBy: "مدعوم من Daimo Pay",
    copyright: "PNPtv! \u00a9 2026",

    confirmingTitle: "\u062c\u0627\u0631\u0650 \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062f\u0641\u0639\u2026",
    confirmingBody: "\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0645\u0639\u0627\u0645\u0644\u062a\u0643. \u0646\u0646\u062a\u0638\u0631 \u0627\u0644\u062a\u0623\u0643\u064a\u062f \u0639\u0644\u0649 \u0627\u0644\u0633\u0644\u0633\u0644\u0629 \u0642\u0628\u0644 \u0625\u0636\u0627\u0641\u0629 \u0631\u0635\u064a\u062f \u062d\u0633\u0627\u0628\u0643. \u0639\u0627\u062f\u0629\u064b \u0644\u0627 \u064a\u0633\u062a\u063a\u0631\u0642 \u0630\u0644\u0643 \u0633\u0648\u0649 \u062b\u0648\u0627\u0646 \u2014 \u064a\u0631\u062c\u0649 \u0625\u0628\u0642\u0627\u0621 \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062d\u0629 \u0645\u0641\u062a\u0648\u062d\u0629.",
    errorNoPaymentId: "\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u062f\u0641\u0639.",
    errorPaymentNotFound: "\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u062f\u0641\u0639 \u0623\u0648 \u062a\u0645\u062a \u0645\u0639\u0627\u0644\u062c\u062a\u0647 \u0628\u0627\u0644\u0641\u0639\u0644.",
    errorNotCrypto: "\u0647\u0630\u0627 \u0627\u0644\u062f\u0641\u0639 \u0644\u064a\u0633 \u062f\u0641\u0639\u0627\u064b \u0628\u0627\u0644\u062a\u0634\u0641\u064a\u0631.",
    errorSessionNotReady: "\u0627\u0646\u062a\u0647\u062a \u062c\u0644\u0633\u0629 \u0627\u0644\u062f\u0641\u0639. \u064a\u0631\u062c\u0649 \u0627\u0644\u0639\u0648\u062f\u0629 \u0648\u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    errorCouldNotLoad: "\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u062f\u0641\u0639. \u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u062a\u0635\u0627\u0644\u0643.",
    confirmationTimeout: "\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0645\u0639\u0627\u0645\u0644\u062a\u0643 \u0644\u0643\u0646 \u0627\u0644\u062a\u0623\u0643\u064a\u062f \u064a\u0633\u062a\u063a\u0631\u0642 \u0648\u0642\u062a\u0627\u064b \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u062a\u0648\u0642\u0639. \u0633\u062a\u0635\u0644\u0643 \u0625\u0634\u0639\u0627\u0631 Telegram \u0628\u0639\u062f \u0627\u0644\u062a\u0623\u0643\u064a\u062f.",
  },
} as const;

export type CheckoutStrings = typeof strings.en;
export { strings as checkout };
