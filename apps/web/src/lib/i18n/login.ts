const strings = {
  en: {
    // Brand tagline
    tagline: "The #1 queer PNP community",

    // Feature badges
    featureBadges: [
      { title: "Hot Performers", sub: "Latino & más" },
      { title: "PNP Content", sub: "Uncensored" },
      { title: "Video Rooms", sub: "Live & private" },
    ] as const,

    // Lifetime deal banner
    lifetimeDealLabel: "Lifetime Deal",
    lifetimeDealTitle: "$100 — PRIME access, forever",
    lifetimeDealSub: "One payment. No renewals. Never expires.",
    lifetimeDealCta: "Get it →",

    // Auth buttons
    signInWithPnptvId: "Sign in with PNPtv ID",
    orContinueWith: "or continue with",
    noAccountPrompt: "Don't have an account?",
    createAccount: "Create one",
    lastLoginedWith: "Last logged in with",

    // Signup-first layout
    joinHeadline: "Join PNPtv today",
    createMyAccount: "Create my account",
    freeTakes30s: "Free. Takes 30 seconds.",
    emailRequiredForSignup: "Please enter your email to continue",
    emailInvalid: "That doesn't look like a valid email",
    recommendedForBot: "Recommended if you joined via our Telegram bot",
    alreadyMember: "Already a member?",
    signInWithEmail: "Sign in with email & password",
    signInSubLabel: "(for users with a PNPtv ID — not Telegram)",
    forgotPassword: "Forgot password?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",
    loginWithTelegram: "Login with Telegram",
    waitingForTelegram: "Waiting for Telegram...",
    telegramInstructions: "Open Telegram and press Start to log in",
    loginWithX: "Login with X",
    redirectingToX: "Redirecting to X...",
    loginWithEmail: "Login with Email",

    // Telegram deep-link poll flow
    tgDeepLinkOpening: "Opening Telegram…",
    tgDeepLinkConfirm: "Confirm in Telegram",
    tgDeepLinkOpenAgain: "Open Telegram again",
    tgDeepLinkExpired: "The login link expired. Try again.",

    // Telegram Widget flow
    telegramWidgetVerifying: "Verifying with Telegram...",
    telegramWidgetError: "Telegram verification failed. Please try again.",
    telegramWidgetRetry: "Try again",
    telegramWidgetFallbackLink: "Having trouble? Try the alternative login",
    telegramWidgetBlocked: "If the Telegram button didn't appear, try the alternative login below.",
    alternativeTelegramLogin: "Alternative Telegram login",

    // Divider
    orDivider: "or",

    // Email form
    emailPlaceholder: "Email address",
    passwordPlaceholder: "Password",
    rememberMe: "Remember me",
    logIn: "Log In",
    cancel: "Cancel",

    // Registration form
    register: "Register",
    firstNamePlaceholder: "First Name",
    lastNamePlaceholder: "Last Name (optional)",
    emailPasswordFirstNameRequired: "Email, password, and first name are required",
    registrationFailed: "Registration failed. Please try again.",
    dontHaveAccount: "Don't have an account? Register here",
    alreadyHaveAccount: "Already have an account? Log In",
    registrationCompleteTitle: "Registration Complete!",
    registrationCompleteMessage: "Your account has been created. You can now log in.",

    // Email verification
    verifyEmailTitle: "Verify Your Email",
    verifyEmailInstructions: "A verification link has been sent to {email}. Please check your inbox (and spam folder) to complete your registration.",
    resendEmail: "Resend verification email",
    sendingEmail: "Sending...",
    emailSent: "Email sent!",
    resendFailed: "Failed to resend email. Please try again.",
    backToLogin: "Back to Login",

    // Inline validation / errors
    emailAndPasswordRequired: "Please enter your email and password",
    loginFailed: "Login failed",
    connectionError: "Connection error. Please try again.",
    loginFailedRetry: "Login failed. Please try again.",

    // Legal footer
    legalPrefix: "By continuing, you agree to our",
    legalTerms: "Terms",
    legalAnd: "and",
    legalPrivacyPolicy: "Privacy Policy",

    // Footer links
    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Community Guidelines",
      contentPolicy: "Content Policy",
      refunds: "Refunds",
      subscriptions: "Subscriptions",
      creatorTerms: "Creator Terms",
      dmca: "DMCA",
      safety: "Safety",
      contact: "Contact",
    },

    copyright: "\u00a9 2026 PNPtv. All rights reserved.",
  },

  es: {
    tagline: "La comunidad queer #1 de PNP",

    featureBadges: [
      { title: "Performers Hot", sub: "Latino & más" },
      { title: "Contenido PNP", sub: "Sin censura" },
      { title: "Salas de Video", sub: "En vivo y privadas" },
    ] as const,

    lifetimeDealLabel: "Oferta de por Vida",
    lifetimeDealTitle: "$100 — acceso PRIME, para siempre",
    lifetimeDealSub: "Un solo pago. Sin renovaciones. Nunca vence.",
    lifetimeDealCta: "Obtenerlo →",

    // Auth buttons
    signInWithPnptvId: "Entrar con PNPtv ID",
    orContinueWith: "o continuar con",
    noAccountPrompt: "¿No tienes cuenta?",
    createAccount: "Crear una",
    lastLoginedWith: "Último acceso con",

    // Signup-first layout
    joinHeadline: "Únete a PNPtv hoy",
    createMyAccount: "Crear mi cuenta",
    freeTakes30s: "Gratis. En 30 segundos.",
    emailRequiredForSignup: "Ingresa tu correo para continuar",
    emailInvalid: "El correo no parece válido",
    recommendedForBot: "Recomendado si te uniste por nuestro bot de Telegram",
    alreadyMember: "¿Ya eres miembro?",
    signInWithEmail: "Entrar con correo y contraseña",
    signInSubLabel: "(para usuarios con PNPtv ID — no Telegram)",
    forgotPassword: "¿Olvidaste tu contraseña?",
    forgotPasswordPrompt: "Ingresa tu correo y te enviamos un enlace para restablecerla.",
    forgotPasswordSubmit: "Enviar enlace",
    forgotPasswordSending: "Enviando…",
    forgotPasswordSent: "Si ese correo está registrado, el enlace ya va en camino. Revisa tu bandeja (y spam).",
    forgotPasswordCancel: "Cancelar",

    loginWithTelegram: "Entrar con Telegram",
    waitingForTelegram: "Esperando Telegram...",
    telegramInstructions: "Abre Telegram y presiona Iniciar para entrar",
    loginWithX: "Entrar con X",
    redirectingToX: "Redirigiendo a X...",
    loginWithEmail: "Entrar con Email",

    // Telegram deep-link poll flow
    tgDeepLinkOpening: "Abriendo Telegram…",
    tgDeepLinkConfirm: "Confirmar en Telegram",
    tgDeepLinkOpenAgain: "Abrir Telegram de nuevo",
    tgDeepLinkExpired: "El enlace de inicio expiró. Intenta de nuevo.",

    // Telegram Widget flow
    telegramWidgetVerifying: "Verificando con Telegram...",
    telegramWidgetError: "Verificación de Telegram fallida. Por favor intenta de nuevo.",
    telegramWidgetRetry: "Intentar de nuevo",
    telegramWidgetFallbackLink: "¿Problemas? Prueba el inicio de sesión alternativo",
    telegramWidgetBlocked: "Si el botón de Telegram no aparece, usa el inicio de sesión alternativo abajo.",
    alternativeTelegramLogin: "Inicio de sesión alternativo de Telegram",

    orDivider: "o",

    emailPlaceholder: "Correo electrónico",
    passwordPlaceholder: "Contraseña",
    rememberMe: "Recordarme",
    logIn: "Iniciar sesión",
    cancel: "Cancelar",

    emailAndPasswordRequired: "Ingresa tu correo y contraseña",
    loginFailed: "Error al iniciar sesión",
    connectionError: "Error de conexión. Por favor intenta de nuevo.",
    loginFailedRetry: "Error al iniciar sesión. Por favor intenta de nuevo.",

    legalPrefix: "Al continuar, aceptas nuestros",
    legalTerms: "Términos",
    legalAnd: "y la",
    legalPrivacyPolicy: "Política de Privacidad",

    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Normas de la Comunidad",
      contentPolicy: "Política de Contenido",
      refunds: "Reembolsos",
      subscriptions: "Suscripciones",
      creatorTerms: "Términos del Creador",
      dmca: "DMCA",
      safety: "Seguridad",
      contact: "Contacto",
    },

    copyright: "\u00a9 2026 PNPtv. Todos los derechos reservados.",
  },

  pt: {
    tagline: "A comunidade queer #1 de PNP",

    featureBadges: [
      { title: "Performers Quentes", sub: "Latino & mais" },
      { title: "Conteúdo PNP", sub: "Sem censura" },
      { title: "Salas de Vídeo", sub: "Ao vivo e privadas" },
    ] as const,

    lifetimeDealLabel: "Oferta Vitalícia",
    lifetimeDealTitle: "$100 — acesso PRIME, para sempre",
    lifetimeDealSub: "Um pagamento. Sem renovações. Nunca expira.",
    lifetimeDealCta: "Quero isso →",

    // Auth buttons
    signInWithPnptvId: "Entrar com PNPtv ID",
    orContinueWith: "ou continuar com",
    noAccountPrompt: "Não tem uma conta?",
    createAccount: "Criar agora",
    lastLoginedWith: "Último acesso com",

    // Signup-first layout
    joinHeadline: "Entre na PNPtv hoje",
    createMyAccount: "Criar minha conta",
    freeTakes30s: "Grátis. Em 30 segundos.",
    emailRequiredForSignup: "Digite seu e-mail para continuar",
    emailInvalid: "Esse e-mail não parece válido",
    recommendedForBot: "Recomendado se você entrou pelo bot do Telegram",
    alreadyMember: "Já é membro?",
    signInWithEmail: "Entrar com e-mail e senha",
    signInSubLabel: "(para usuários com PNPtv ID — não Telegram)",
    forgotPassword: "Esqueceu a senha?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Entrar com Telegram",
    waitingForTelegram: "Aguardando Telegram...",
    telegramInstructions: "Abra o Telegram e pressione Iniciar para entrar",
    loginWithX: "Entrar com X",
    redirectingToX: "Redirecionando para X...",
    loginWithEmail: "Entrar com Email",

    // Telegram deep-link poll flow
    tgDeepLinkOpening: "Abrindo Telegram…",
    tgDeepLinkConfirm: "Confirmar no Telegram",
    tgDeepLinkOpenAgain: "Abrir Telegram novamente",
    tgDeepLinkExpired: "O link expirou. Tente novamente.",

    telegramWidgetVerifying: "Verificando com Telegram...",
    telegramWidgetError: "Verificação do Telegram falhou. Por favor, tente novamente.",
    telegramWidgetRetry: "Tentar novamente",
    telegramWidgetFallbackLink: "Problemas? Tente o login alternativo",
    telegramWidgetBlocked: "Se o botão do Telegram não aparecer, use o login alternativo abaixo.",
    alternativeTelegramLogin: "Login alternativo do Telegram",

    orDivider: "ou",

    emailPlaceholder: "Endereço de e-mail",
    passwordPlaceholder: "Senha",
    rememberMe: "Lembrar de mim",
    logIn: "Entrar",
    cancel: "Cancelar",

    emailAndPasswordRequired: "Por favor, insira seu e-mail e senha",
    loginFailed: "Falha no login",
    connectionError: "Erro de conexão. Por favor, tente novamente.",
    loginFailedRetry: "Falha no login. Por favor, tente novamente.",

    legalPrefix: "Ao continuar, você concorda com nossos",
    legalTerms: "Termos",
    legalAnd: "e a",
    legalPrivacyPolicy: "Política de Privacidade",

    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Diretrizes da Comunidade",
      contentPolicy: "Política de Conteúdo",
      refunds: "Reembolsos",
      subscriptions: "Assinaturas",
      creatorTerms: "Termos do Criador",
      dmca: "DMCA",
      safety: "Segurança",
      contact: "Contato",
    },

    copyright: "\u00a9 2026 PNPtv. Todos os direitos reservados.",
  },

  zh: {
    tagline: "全球第一 PNP 酷儿社区",

    featureBadges: [
      { title: "热门表演者", sub: "拉丁裔及更多" },
      { title: "PNP 内容", sub: "无审查" },
      { title: "视频房间", sub: "直播和私密" },
    ] as const,

    lifetimeDealLabel: "终身优惠",
    lifetimeDealTitle: "$100 — PRIME 永久访问权",
    lifetimeDealSub: "一次付款。无需续费。永不过期。",
    lifetimeDealCta: "立即获取 →",

    // Auth buttons
    signInWithPnptvId: "使用 PNPtv ID 登录",
    orContinueWith: "或继续使用",
    noAccountPrompt: "没有账号？",
    createAccount: "立即创建",
    lastLoginedWith: "上次登录方式",

    // Signup-first layout
    joinHeadline: "今天加入 PNPtv",
    createMyAccount: "创建我的账号",
    freeTakes30s: "免费，30 秒完成",
    emailRequiredForSignup: "请输入邮箱以继续",
    emailInvalid: "该邮箱格式无效",
    recommendedForBot: "如果你通过 Telegram 机器人加入，推荐使用此方式",
    alreadyMember: "已有账号？",
    signInWithEmail: "使用邮箱和密码登录",
    signInSubLabel: "（适用于拥有 PNPtv ID 的用户——非 Telegram 用户）",
    forgotPassword: "忘记密码？",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "使用 Telegram 登录",
    waitingForTelegram: "等待 Telegram...",
    telegramInstructions: "打开 Telegram 并按开始以登录",
    loginWithX: "使用 X 登录",
    redirectingToX: "正在跳转至 X...",
    loginWithEmail: "使用邮箱登录",

    tgDeepLinkOpening: "正在打开 Telegram…",
    tgDeepLinkConfirm: "在 Telegram 中确认",
    tgDeepLinkOpenAgain: "再次打开 Telegram",
    tgDeepLinkExpired: "登录链接已过期，请重试。",

    telegramWidgetVerifying: "正在通过 Telegram 验证...",
    telegramWidgetError: "Telegram 验证失败，请重试。",
    telegramWidgetRetry: "重试",
    telegramWidgetFallbackLink: "遇到问题？尝试备用登录方式",
    telegramWidgetBlocked: "如果 Telegram 按钮未显示，请使用下方的备用登录方式。",
    alternativeTelegramLogin: "Telegram 备用登录",

    orDivider: "或",

    emailPlaceholder: "电子邮件地址",
    passwordPlaceholder: "密码",
    rememberMe: "记住我",
    logIn: "登录",
    cancel: "取消",

    emailAndPasswordRequired: "请输入您的邮箱和密码",
    loginFailed: "登录失败",
    connectionError: "连接错误，请重试。",
    loginFailedRetry: "登录失败，请重试。",

    legalPrefix: "继续即表示您同意我们的",
    legalTerms: "服务条款",
    legalAnd: "和",
    legalPrivacyPolicy: "隐私政策",

    footerLinks: {
      cookies: "Cookie 政策",
      communityGuidelines: "社区准则",
      contentPolicy: "内容政策",
      refunds: "退款政策",
      subscriptions: "订阅",
      creatorTerms: "创作者条款",
      dmca: "DMCA",
      safety: "安全",
      contact: "联系我们",
    },

    copyright: "\u00a9 2026 PNPtv. 保留所有权利。",
  },

  zhTW: {
    tagline: "全球第一 PNP 酷兒社群",

    featureBadges: [
      { title: "熱門表演者", sub: "拉丁裔及更多" },
      { title: "PNP 內容", sub: "無審查" },
      { title: "視訊房間", sub: "直播與私密" },
    ] as const,

    lifetimeDealLabel: "終身優惠",
    lifetimeDealTitle: "$100 — PRIME 永久使用權",
    lifetimeDealSub: "一次付款。無需續約。永不過期。",
    lifetimeDealCta: "立即取得 →",

    // Auth buttons
    signInWithPnptvId: "使用 PNPtv ID 登入",
    orContinueWith: "或繼續使用",
    noAccountPrompt: "沒有帳號？",
    createAccount: "立即建立",
    lastLoginedWith: "上次登入方式",

    // Signup-first layout
    joinHeadline: "立即加入 PNPtv",
    createMyAccount: "建立我的帳號",
    freeTakes30s: "免費，30 秒完成",
    emailRequiredForSignup: "請輸入電子郵件以繼續",
    emailInvalid: "該電子郵件格式無效",
    recommendedForBot: "如果您透過 Telegram 機器人加入，建議使用此方式",
    alreadyMember: "已是會員？",
    signInWithEmail: "使用電子郵件與密碼登入",
    signInSubLabel: "（適用於擁有 PNPtv ID 的使用者——非 Telegram 使用者）",
    forgotPassword: "忘記密碼？",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "使用 Telegram 登入",
    waitingForTelegram: "等待 Telegram...",
    telegramInstructions: "開啟 Telegram 並按開始以登入",
    loginWithX: "使用 X 登入",
    redirectingToX: "正在跳轉至 X...",
    loginWithEmail: "使用電子郵件登入",

    tgDeepLinkOpening: "正在開啟 Telegram…",
    tgDeepLinkConfirm: "在 Telegram 中確認",
    tgDeepLinkOpenAgain: "再次開啟 Telegram",
    tgDeepLinkExpired: "登入連結已過期，請重試。",

    telegramWidgetVerifying: "正在透過 Telegram 驗證...",
    telegramWidgetError: "Telegram 驗證失敗，請重試。",
    telegramWidgetRetry: "重試",
    telegramWidgetFallbackLink: "遇到問題？試試備用登入方式",
    telegramWidgetBlocked: "如果 Telegram 按鈕未顯示，請使用下方的備用登入方式。",
    alternativeTelegramLogin: "Telegram 備用登入",

    orDivider: "或",

    emailPlaceholder: "電子郵件地址",
    passwordPlaceholder: "密碼",
    rememberMe: "記住我",
    logIn: "登入",
    cancel: "取消",

    emailAndPasswordRequired: "請輸入您的電子郵件和密碼",
    loginFailed: "登入失敗",
    connectionError: "連線錯誤，請重試。",
    loginFailedRetry: "登入失敗，請重試。",

    legalPrefix: "繼續即表示您同意我們的",
    legalTerms: "服務條款",
    legalAnd: "和",
    legalPrivacyPolicy: "隱私政策",

    footerLinks: {
      cookies: "Cookie 政策",
      communityGuidelines: "社群準則",
      contentPolicy: "內容政策",
      refunds: "退款政策",
      subscriptions: "訂閱",
      creatorTerms: "創作者條款",
      dmca: "DMCA",
      safety: "安全",
      contact: "聯絡我們",
    },

    copyright: "\u00a9 2026 PNPtv. 版權所有。",
  },

  fr: {
    tagline: "La communauté queer PNP #1",

    featureBadges: [
      { title: "Performers Hot", sub: "Latino & plus" },
      { title: "Contenu PNP", sub: "Non censuré" },
      { title: "Salles Vidéo", sub: "Live et privées" },
    ] as const,

    lifetimeDealLabel: "Offre à Vie",
    lifetimeDealTitle: "$100 — accès PRIME à vie",
    lifetimeDealSub: "Un seul paiement. Sans renouvellement. Pour toujours.",
    lifetimeDealCta: "Je veux ça →",

    // Auth buttons
    signInWithPnptvId: "Se connecter avec PNPtv ID",
    orContinueWith: "ou continuer avec",
    noAccountPrompt: "Pas de compte ?",
    createAccount: "Créer un compte",
    lastLoginedWith: "Dernière connexion avec",

    // Signup-first layout
    joinHeadline: "Rejoignez PNPtv aujourd'hui",
    createMyAccount: "Créer mon compte",
    freeTakes30s: "Gratuit. En 30 secondes.",
    emailRequiredForSignup: "Veuillez saisir votre e-mail",
    emailInvalid: "L'e-mail ne semble pas valide",
    recommendedForBot: "Recommandé si vous avez rejoint via notre bot Telegram",
    alreadyMember: "Déjà membre ?",
    signInWithEmail: "Se connecter avec e-mail et mot de passe",
    signInSubLabel: "(pour les utilisateurs avec un PNPtv ID — pas Telegram)",
    forgotPassword: "Mot de passe oublié ?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Se connecter avec Telegram",
    waitingForTelegram: "En attente de Telegram...",
    telegramInstructions: "Ouvrez Telegram et appuyez sur Démarrer pour vous connecter",
    loginWithX: "Se connecter avec X",
    redirectingToX: "Redirection vers X...",
    loginWithEmail: "Se connecter avec l'e-mail",

    tgDeepLinkOpening: "Ouverture de Telegram…",
    tgDeepLinkConfirm: "Confirmer dans Telegram",
    tgDeepLinkOpenAgain: "Rouvrir Telegram",
    tgDeepLinkExpired: "Le lien a expiré. Réessayez.",

    telegramWidgetVerifying: "Vérification avec Telegram...",
    telegramWidgetError: "La vérification Telegram a échoué. Veuillez réessayer.",
    telegramWidgetRetry: "Réessayer",
    telegramWidgetFallbackLink: "Des problèmes ? Essayez la connexion alternative",
    telegramWidgetBlocked: "Si le bouton Telegram n'apparaît pas, utilisez la connexion alternative ci-dessous.",
    alternativeTelegramLogin: "Connexion Telegram alternative",

    orDivider: "ou",

    emailPlaceholder: "Adresse e-mail",
    passwordPlaceholder: "Mot de passe",
    rememberMe: "Se souvenir de moi",
    logIn: "Se connecter",
    cancel: "Annuler",

    emailAndPasswordRequired: "Veuillez saisir votre e-mail et mot de passe",
    loginFailed: "Échec de la connexion",
    connectionError: "Erreur de connexion. Veuillez réessayer.",
    loginFailedRetry: "Échec de la connexion. Veuillez réessayer.",

    legalPrefix: "En continuant, vous acceptez nos",
    legalTerms: "Conditions",
    legalAnd: "et notre",
    legalPrivacyPolicy: "Politique de Confidentialité",

    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Règles de la Communauté",
      contentPolicy: "Politique de Contenu",
      refunds: "Remboursements",
      subscriptions: "Abonnements",
      creatorTerms: "Conditions Créateurs",
      dmca: "DMCA",
      safety: "Sécurité",
      contact: "Contact",
    },

    copyright: "\u00a9 2026 PNPtv. Tous droits réservés.",
  },

  de: {
    tagline: "Die #1 queere PNP-Community",

    featureBadges: [
      { title: "Heiße Performer", sub: "Latino & mehr" },
      { title: "PNP-Inhalte", sub: "Unzensiert" },
      { title: "Videoräume", sub: "Live und privat" },
    ] as const,

    lifetimeDealLabel: "Lifetime-Angebot",
    lifetimeDealTitle: "$100 — PRIME-Zugang, für immer",
    lifetimeDealSub: "Einmalige Zahlung. Keine Verlängerungen. Läuft nie ab.",
    lifetimeDealCta: "Jetzt sichern →",

    // Auth buttons
    signInWithPnptvId: "Mit PNPtv ID einloggen",
    orContinueWith: "oder weiter mit",
    noAccountPrompt: "Noch kein Konto?",
    createAccount: "Konto erstellen",
    lastLoginedWith: "Zuletzt eingeloggt mit",

    // Signup-first layout
    joinHeadline: "Tritt PNPtv heute bei",
    createMyAccount: "Konto erstellen",
    freeTakes30s: "Kostenlos. In 30 Sekunden.",
    emailRequiredForSignup: "Bitte gib deine E-Mail ein",
    emailInvalid: "Die E-Mail scheint ungültig zu sein",
    recommendedForBot: "Empfohlen, wenn du über unseren Telegram-Bot beigetreten bist",
    alreadyMember: "Bereits Mitglied?",
    signInWithEmail: "Mit E-Mail und Passwort einloggen",
    signInSubLabel: "(für Nutzer mit PNPtv ID — nicht Telegram)",
    forgotPassword: "Passwort vergessen?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Mit Telegram einloggen",
    waitingForTelegram: "Warte auf Telegram...",
    telegramInstructions: "Öffne Telegram und drücke Start zum Einloggen",
    loginWithX: "Mit X einloggen",
    redirectingToX: "Weiterleitung zu X...",
    loginWithEmail: "Mit E-Mail einloggen",

    tgDeepLinkOpening: "Telegram wird geöffnet…",
    tgDeepLinkConfirm: "In Telegram bestätigen",
    tgDeepLinkOpenAgain: "Telegram erneut öffnen",
    tgDeepLinkExpired: "Der Login-Link ist abgelaufen. Nochmals versuchen.",

    telegramWidgetVerifying: "Verifizierung mit Telegram...",
    telegramWidgetError: "Telegram-Verifizierung fehlgeschlagen. Bitte versuche es erneut.",
    telegramWidgetRetry: "Erneut versuchen",
    telegramWidgetFallbackLink: "Probleme? Probiere die alternative Anmeldung",
    telegramWidgetBlocked: "Wenn die Telegram-Schaltfläche nicht erscheint, nutze die alternative Anmeldung unten.",
    alternativeTelegramLogin: "Alternative Telegram-Anmeldung",

    orDivider: "oder",

    emailPlaceholder: "E-Mail-Adresse",
    passwordPlaceholder: "Passwort",
    rememberMe: "Angemeldet bleiben",
    logIn: "Einloggen",
    cancel: "Abbrechen",

    emailAndPasswordRequired: "Bitte gib deine E-Mail und dein Passwort ein",
    loginFailed: "Anmeldung fehlgeschlagen",
    connectionError: "Verbindungsfehler. Bitte versuche es erneut.",
    loginFailedRetry: "Anmeldung fehlgeschlagen. Bitte versuche es erneut.",

    legalPrefix: "Mit dem Fortfahren stimmst du unseren",
    legalTerms: "Nutzungsbedingungen",
    legalAnd: "und der",
    legalPrivacyPolicy: "Datenschutzrichtlinie",

    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Community-Richtlinien",
      contentPolicy: "Inhaltsrichtlinie",
      refunds: "Rückerstattungen",
      subscriptions: "Abonnements",
      creatorTerms: "Creator-Bedingungen",
      dmca: "DMCA",
      safety: "Sicherheit",
      contact: "Kontakt",
    },

    copyright: "\u00a9 2026 PNPtv. Alle Rechte vorbehalten.",
  },

  th: {
    tagline: "ชุมชน PNP Queer อันดับ 1",

    featureBadges: [
      { title: "นักแสดงยอดนิยม", sub: "ละตินและอื่นๆ" },
      { title: "เนื้อหา PNP", sub: "ไม่เซ็นเซอร์" },
      { title: "ห้องวิดีโอ", sub: "สดและส่วนตัว" },
    ] as const,

    lifetimeDealLabel: "ดีลตลอดชีพ",
    lifetimeDealTitle: "$100 — สิทธิ์ PRIME ตลอดชีพ",
    lifetimeDealSub: "จ่ายครั้งเดียว ไม่ต้องต่ออายุ ไม่มีวันหมดอายุ",
    lifetimeDealCta: "รับเลย →",

    // Auth buttons
    signInWithPnptvId: "เข้าสู่ระบบด้วย PNPtv ID",
    orContinueWith: "หรือดำเนินการต่อด้วย",
    noAccountPrompt: "ยังไม่มีบัญชี?",
    createAccount: "สร้างบัญชี",
    lastLoginedWith: "เข้าสู่ระบบครั้งล่าสุดด้วย",

    // Signup-first layout
    joinHeadline: "เข้าร่วม PNPtv วันนี้",
    createMyAccount: "สร้างบัญชีของฉัน",
    freeTakes30s: "ฟรี ใช้เวลา 30 วินาที",
    emailRequiredForSignup: "กรุณากรอกอีเมลเพื่อดำเนินการต่อ",
    emailInvalid: "รูปแบบอีเมลไม่ถูกต้อง",
    recommendedForBot: "แนะนำถ้าคุณเข้าร่วมผ่านบอท Telegram ของเรา",
    alreadyMember: "เป็นสมาชิกอยู่แล้ว?",
    signInWithEmail: "เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน",
    signInSubLabel: "(สำหรับผู้ใช้ที่มี PNPtv ID — ไม่ใช่ Telegram)",
    forgotPassword: "ลืมรหัสผ่าน?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "เข้าสู่ระบบด้วย Telegram",
    waitingForTelegram: "รอ Telegram...",
    telegramInstructions: "เปิด Telegram แล้วกด Start เพื่อเข้าสู่ระบบ",
    loginWithX: "เข้าสู่ระบบด้วย X",
    redirectingToX: "กำลังไปที่ X...",
    loginWithEmail: "เข้าสู่ระบบด้วยอีเมล",

    tgDeepLinkOpening: "Opening Telegram…",
    tgDeepLinkConfirm: "Confirm in Telegram",
    tgDeepLinkOpenAgain: "Open Telegram again",
    tgDeepLinkExpired: "The login link expired. Try again.",

    telegramWidgetVerifying: "กำลังยืนยันตัวตนผ่าน Telegram...",
    telegramWidgetError: "การยืนยันตัวตนผ่าน Telegram ล้มเหลว กรุณาลองใหม่",
    telegramWidgetRetry: "ลองใหม่",
    telegramWidgetFallbackLink: "มีปัญหา? ลองวิธีเข้าสู่ระบบแบบอื่น",
    telegramWidgetBlocked: "หากปุ่ม Telegram ไม่ปรากฏ ให้ใช้วิธีเข้าสู่ระบบแบบอื่นด้านล่าง",
    alternativeTelegramLogin: "เข้าสู่ระบบ Telegram แบบอื่น",

    orDivider: "หรือ",

    emailPlaceholder: "ที่อยู่อีเมล",
    passwordPlaceholder: "รหัสผ่าน",
    rememberMe: "จดจำฉัน",
    logIn: "เข้าสู่ระบบ",
    cancel: "ยกเลิก",

    emailAndPasswordRequired: "กรุณากรอกอีเมลและรหัสผ่านของคุณ",
    loginFailed: "เข้าสู่ระบบล้มเหลว",
    connectionError: "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่",
    loginFailedRetry: "เข้าสู่ระบบล้มเหลว กรุณาลองใหม่",

    legalPrefix: "การดำเนินการต่อแสดงว่าคุณยอมรับ",
    legalTerms: "เงื่อนไขการใช้งาน",
    legalAnd: "และ",
    legalPrivacyPolicy: "นโยบายความเป็นส่วนตัว",

    footerLinks: {
      cookies: "คุกกี้",
      communityGuidelines: "แนวทางชุมชน",
      contentPolicy: "นโยบายเนื้อหา",
      refunds: "การคืนเงิน",
      subscriptions: "การสมัครสมาชิก",
      creatorTerms: "เงื่อนไขครีเอเตอร์",
      dmca: "DMCA",
      safety: "ความปลอดภัย",
      contact: "ติดต่อ",
    },

    copyright: "\u00a9 2026 PNPtv. สงวนลิขสิทธิ์ทั้งหมด",
  },

  it: {
    tagline: "La community queer PNP #1",

    featureBadges: [
      { title: "Performer Hot", sub: "Latino & altro" },
      { title: "Contenuti PNP", sub: "Non censurati" },
      { title: "Stanze Video", sub: "Live e private" },
    ] as const,

    lifetimeDealLabel: "Offerta a Vita",
    lifetimeDealTitle: "$100 — accesso PRIME per sempre",
    lifetimeDealSub: "Un solo pagamento. Nessun rinnovo. Non scade mai.",
    lifetimeDealCta: "Prendilo →",

    // Auth buttons
    signInWithPnptvId: "Accedi con PNPtv ID",
    orContinueWith: "o continua con",
    noAccountPrompt: "Non hai un account?",
    createAccount: "Creane uno",
    lastLoginedWith: "Ultimo accesso con",

    // Signup-first layout
    joinHeadline: "Unisciti a PNPtv oggi",
    createMyAccount: "Crea il mio account",
    freeTakes30s: "Gratis. In 30 secondi.",
    emailRequiredForSignup: "Inserisci la tua e-mail per continuare",
    emailInvalid: "L'e-mail non sembra valida",
    recommendedForBot: "Consigliato se ti sei iscritto tramite il nostro bot Telegram",
    alreadyMember: "Sei già membro?",
    signInWithEmail: "Accedi con e-mail e password",
    signInSubLabel: "(per utenti con PNPtv ID — non Telegram)",
    forgotPassword: "Password dimenticata?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Accedi con Telegram",
    waitingForTelegram: "In attesa di Telegram...",
    telegramInstructions: "Apri Telegram e premi Avvia per accedere",
    loginWithX: "Accedi con X",
    redirectingToX: "Reindirizzamento a X...",
    loginWithEmail: "Accedi con Email",

    tgDeepLinkOpening: "Apertura Telegram…",
    tgDeepLinkConfirm: "Conferma in Telegram",
    tgDeepLinkOpenAgain: "Riapri Telegram",
    tgDeepLinkExpired: "Il link è scaduto. Riprova.",

    telegramWidgetVerifying: "Verifica con Telegram in corso...",
    telegramWidgetError: "Verifica Telegram fallita. Per favore riprova.",
    telegramWidgetRetry: "Riprova",
    telegramWidgetFallbackLink: "Problemi? Prova il login alternativo",
    telegramWidgetBlocked: "Se il pulsante Telegram non appare, usa il login alternativo qui sotto.",
    alternativeTelegramLogin: "Login Telegram alternativo",

    orDivider: "oppure",

    emailPlaceholder: "Indirizzo e-mail",
    passwordPlaceholder: "Password",
    rememberMe: "Ricordami",
    logIn: "Accedi",
    cancel: "Annulla",

    emailAndPasswordRequired: "Inserisci la tua e-mail e la password",
    loginFailed: "Accesso fallito",
    connectionError: "Errore di connessione. Per favore riprova.",
    loginFailedRetry: "Accesso fallito. Per favore riprova.",

    legalPrefix: "Continuando, accetti i nostri",
    legalTerms: "Termini",
    legalAnd: "e la",
    legalPrivacyPolicy: "Informativa sulla Privacy",

    footerLinks: {
      cookies: "Cookie",
      communityGuidelines: "Linee Guida della Community",
      contentPolicy: "Politica dei Contenuti",
      refunds: "Rimborsi",
      subscriptions: "Abbonamenti",
      creatorTerms: "Termini Creator",
      dmca: "DMCA",
      safety: "Sicurezza",
      contact: "Contatti",
    },

    copyright: "\u00a9 2026 PNPtv. Tutti i diritti riservati.",
  },

  tr: {
    tagline: "1 numaralı queer PNP topluluğu",

    featureBadges: [
      { title: "Ateşli Performerlar", sub: "Latin ve daha fazlası" },
      { title: "PNP İçeriği", sub: "Sansürsüz" },
      { title: "Video Odaları", sub: "Canlı ve özel" },
    ] as const,

    lifetimeDealLabel: "Ömür Boyu Fırsat",
    lifetimeDealTitle: "$100 — ömür boyu PRIME erişimi",
    lifetimeDealSub: "Tek ödeme. Yenileme yok. Asla sona ermez.",
    lifetimeDealCta: "Hemen al →",

    // Auth buttons
    signInWithPnptvId: "PNPtv ID ile giriş yap",
    orContinueWith: "veya şununla devam et",
    noAccountPrompt: "Hesabın yok mu?",
    createAccount: "Oluştur",
    lastLoginedWith: "Son giriş yöntemi",

    // Signup-first layout
    joinHeadline: "Bugün PNPtv'ye katıl",
    createMyAccount: "Hesabımı oluştur",
    freeTakes30s: "Ücretsiz. 30 saniye sürer.",
    emailRequiredForSignup: "Devam etmek için e-posta gir",
    emailInvalid: "E-posta geçerli görünmüyor",
    recommendedForBot: "Telegram botumuz üzerinden katıldıysan önerilir",
    alreadyMember: "Zaten üye misin?",
    signInWithEmail: "E-posta ve şifre ile giriş yap",
    signInSubLabel: "(PNPtv ID'si olan kullanıcılar için — Telegram değil)",
    forgotPassword: "Şifreni mi unuttun?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Telegram ile giriş yap",
    waitingForTelegram: "Telegram bekleniyor...",
    telegramInstructions: "Telegram'ı aç ve giriş yapmak için Başlat'a bas",
    loginWithX: "X ile giriş yap",
    redirectingToX: "X'e yönlendiriliyor...",
    loginWithEmail: "E-posta ile giriş yap",

    tgDeepLinkOpening: "Telegram açılıyor…",
    tgDeepLinkConfirm: "Telegram'da onayla",
    tgDeepLinkOpenAgain: "Telegram'ı tekrar aç",
    tgDeepLinkExpired: "Giriş bağlantısı süresi doldu. Tekrar dene.",

    telegramWidgetVerifying: "Telegram ile doğrulanıyor...",
    telegramWidgetError: "Telegram doğrulaması başarısız oldu. Lütfen tekrar dene.",
    telegramWidgetRetry: "Tekrar dene",
    telegramWidgetFallbackLink: "Sorun mu yaşıyorsun? Alternatif girişi dene",
    telegramWidgetBlocked: "Telegram butonu görünmüyorsa, aşağıdaki alternatif girişi kullan.",
    alternativeTelegramLogin: "Alternatif Telegram girişi",

    orDivider: "veya",

    emailPlaceholder: "E-posta adresi",
    passwordPlaceholder: "Şifre",
    rememberMe: "Beni hatırla",
    logIn: "Giriş Yap",
    cancel: "İptal",

    emailAndPasswordRequired: "Lütfen e-posta ve şifreni gir",
    loginFailed: "Giriş başarısız",
    connectionError: "Bağlantı hatası. Lütfen tekrar dene.",
    loginFailedRetry: "Giriş başarısız. Lütfen tekrar dene.",

    legalPrefix: "Devam ederek",
    legalTerms: "Kullanım Koşulları'nı",
    legalAnd: "ve",
    legalPrivacyPolicy: "Gizlilik Politikası'nı",

    footerLinks: {
      cookies: "Çerezler",
      communityGuidelines: "Topluluk Kuralları",
      contentPolicy: "İçerik Politikası",
      refunds: "İadeler",
      subscriptions: "Abonelikler",
      creatorTerms: "İçerik Üretici Koşulları",
      dmca: "DMCA",
      safety: "Güvenlik",
      contact: "İletişim",
    },

    copyright: "\u00a9 2026 PNPtv. Tüm hakları saklıdır.",
  },

  ru: {
    tagline: "Квир-сообщество PNP №1",

    featureBadges: [
      { title: "Горячие Перформеры", sub: "Латино и другие" },
      { title: "PNP Контент", sub: "Без цензуры" },
      { title: "Видеокомнаты", sub: "Прямой эфир и приватные" },
    ] as const,

    lifetimeDealLabel: "Пожизненное предложение",
    lifetimeDealTitle: "$100 — доступ PRIME навсегда",
    lifetimeDealSub: "Один платёж. Без продлений. Никогда не истекает.",
    lifetimeDealCta: "Получить →",

    // Auth buttons
    signInWithPnptvId: "Войти через PNPtv ID",
    orContinueWith: "или продолжить через",
    noAccountPrompt: "Нет аккаунта?",
    createAccount: "Создать",
    lastLoginedWith: "Последний вход",

    // Signup-first layout
    joinHeadline: "Присоединяйтесь к PNPtv",
    createMyAccount: "Создать аккаунт",
    freeTakes30s: "Бесплатно. За 30 секунд.",
    emailRequiredForSignup: "Введите email для продолжения",
    emailInvalid: "Неверный формат email",
    recommendedForBot: "Рекомендуется, если вы вошли через наш Telegram-бот",
    alreadyMember: "Уже участник?",
    signInWithEmail: "Войти через email и пароль",
    signInSubLabel: "(для пользователей с PNPtv ID — не Telegram)",
    forgotPassword: "Забыли пароль?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Войти через Telegram",
    waitingForTelegram: "Ожидание Telegram...",
    telegramInstructions: "Откройте Telegram и нажмите Старт для входа",
    loginWithX: "Войти через X",
    redirectingToX: "Перенаправление в X...",
    loginWithEmail: "Войти через Email",

    tgDeepLinkOpening: "Открываем Telegram…",
    tgDeepLinkConfirm: "Подтвердите в Telegram",
    tgDeepLinkOpenAgain: "Открыть Telegram снова",
    tgDeepLinkExpired: "Ссылка для входа истекла. Попробуйте снова.",

    telegramWidgetVerifying: "Проверка через Telegram...",
    telegramWidgetError: "Верификация Telegram не удалась. Пожалуйста, попробуйте снова.",
    telegramWidgetRetry: "Попробовать снова",
    telegramWidgetFallbackLink: "Проблемы? Попробуйте альтернативный вход",
    telegramWidgetBlocked: "Если кнопка Telegram не появилась, воспользуйтесь альтернативным входом ниже.",
    alternativeTelegramLogin: "Альтернативный вход через Telegram",

    orDivider: "или",

    emailPlaceholder: "Адрес электронной почты",
    passwordPlaceholder: "Пароль",
    rememberMe: "Запомнить меня",
    logIn: "Войти",
    cancel: "Отмена",

    emailAndPasswordRequired: "Пожалуйста, введите email и пароль",
    loginFailed: "Ошибка входа",
    connectionError: "Ошибка подключения. Пожалуйста, попробуйте снова.",
    loginFailedRetry: "Ошибка входа. Пожалуйста, попробуйте снова.",

    legalPrefix: "Продолжая, вы соглашаетесь с нашими",
    legalTerms: "Условиями",
    legalAnd: "и",
    legalPrivacyPolicy: "Политикой конфиденциальности",

    footerLinks: {
      cookies: "Куки",
      communityGuidelines: "Правила сообщества",
      contentPolicy: "Политика контента",
      refunds: "Возвраты",
      subscriptions: "Подписки",
      creatorTerms: "Условия для авторов",
      dmca: "DMCA",
      safety: "Безопасность",
      contact: "Контакты",
    },

    copyright: "\u00a9 2026 PNPtv. Все права защищены.",
  },

  nl: {
    tagline: "De #1 queer PNP-community",

    featureBadges: [
      { title: "Hete Performers", sub: "Latino & meer" },
      { title: "PNP-content", sub: "Ongecensureerd" },
      { title: "Videoruimtes", sub: "Live en privé" },
    ] as const,

    lifetimeDealLabel: "Levenslange Deal",
    lifetimeDealTitle: "$100 — PRIME-toegang, voor altijd",
    lifetimeDealSub: "Eén betaling. Geen verlengingen. Verloopt nooit.",
    lifetimeDealCta: "Pak het →",

    // Auth buttons
    signInWithPnptvId: "Inloggen met PNPtv ID",
    orContinueWith: "of ga door met",
    noAccountPrompt: "Nog geen account?",
    createAccount: "Aanmaken",
    lastLoginedWith: "Laatst ingelogd met",

    // Signup-first layout
    joinHeadline: "Word vandaag lid van PNPtv",
    createMyAccount: "Account aanmaken",
    freeTakes30s: "Gratis. Duurt 30 seconden.",
    emailRequiredForSignup: "Voer je e-mail in om door te gaan",
    emailInvalid: "Dat lijkt geen geldig e-mailadres",
    recommendedForBot: "Aanbevolen als je via onze Telegram-bot kwam",
    alreadyMember: "Al lid?",
    signInWithEmail: "Inloggen met e-mail en wachtwoord",
    signInSubLabel: "(voor gebruikers met een PNPtv ID — niet Telegram)",
    forgotPassword: "Wachtwoord vergeten?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Inloggen met Telegram",
    waitingForTelegram: "Wachten op Telegram...",
    telegramInstructions: "Open Telegram en druk op Start om in te loggen",
    loginWithX: "Inloggen met X",
    redirectingToX: "Doorsturen naar X...",
    loginWithEmail: "Inloggen met e-mail",

    tgDeepLinkOpening: "Telegram wordt geopend…",
    tgDeepLinkConfirm: "Bevestig in Telegram",
    tgDeepLinkOpenAgain: "Telegram opnieuw openen",
    tgDeepLinkExpired: "De loginlink is verlopen. Probeer opnieuw.",

    telegramWidgetVerifying: "Verificatie via Telegram...",
    telegramWidgetError: "Telegram-verificatie mislukt. Probeer het opnieuw.",
    telegramWidgetRetry: "Opnieuw proberen",
    telegramWidgetFallbackLink: "Problemen? Probeer de alternatieve login",
    telegramWidgetBlocked: "Als de Telegram-knop niet verschijnt, gebruik dan de alternatieve login hieronder.",
    alternativeTelegramLogin: "Alternatieve Telegram-login",

    orDivider: "of",

    emailPlaceholder: "E-mailadres",
    passwordPlaceholder: "Wachtwoord",
    rememberMe: "Onthoud mij",
    logIn: "Inloggen",
    cancel: "Annuleren",

    emailAndPasswordRequired: "Vul je e-mail en wachtwoord in",
    loginFailed: "Inloggen mislukt",
    connectionError: "Verbindingsfout. Probeer het opnieuw.",
    loginFailedRetry: "Inloggen mislukt. Probeer het opnieuw.",

    legalPrefix: "Door verder te gaan ga je akkoord met onze",
    legalTerms: "Voorwaarden",
    legalAnd: "en het",
    legalPrivacyPolicy: "Privacybeleid",

    footerLinks: {
      cookies: "Cookies",
      communityGuidelines: "Community-richtlijnen",
      contentPolicy: "Inhoudsbeleid",
      refunds: "Terugbetalingen",
      subscriptions: "Abonnementen",
      creatorTerms: "Maker-voorwaarden",
      dmca: "DMCA",
      safety: "Veiligheid",
      contact: "Contact",
    },

    copyright: "\u00a9 2026 PNPtv. Alle rechten voorbehouden.",
  },

  vi: {
    tagline: "Cộng đồng queer PNP số 1",

    featureBadges: [
      { title: "Diễn Viên Nóng Bỏng", sub: "Latino & nhiều hơn" },
      { title: "Nội Dung PNP", sub: "Không kiểm duyệt" },
      { title: "Phòng Video", sub: "Trực tiếp và riêng tư" },
    ] as const,

    lifetimeDealLabel: "Ưu Đãi Trọn Đời",
    lifetimeDealTitle: "$100 — quyền truy cập PRIME mãi mãi",
    lifetimeDealSub: "Một lần thanh toán. Không gia hạn. Không bao giờ hết hạn.",
    lifetimeDealCta: "Lấy ngay →",

    // Auth buttons
    signInWithPnptvId: "Đăng nhập với PNPtv ID",
    orContinueWith: "hoặc tiếp tục với",
    noAccountPrompt: "Chưa có tài khoản?",
    createAccount: "Tạo ngay",
    lastLoginedWith: "Đăng nhập lần cuối với",

    // Signup-first layout
    joinHeadline: "Tham gia PNPtv hôm nay",
    createMyAccount: "Tạo tài khoản của tôi",
    freeTakes30s: "Miễn phí. Chỉ mất 30 giây.",
    emailRequiredForSignup: "Vui lòng nhập email để tiếp tục",
    emailInvalid: "Email không hợp lệ",
    recommendedForBot: "Nên chọn nếu bạn đăng ký qua bot Telegram",
    alreadyMember: "Đã là thành viên?",
    signInWithEmail: "Đăng nhập bằng email và mật khẩu",
    signInSubLabel: "(dành cho người dùng có PNPtv ID — không phải Telegram)",
    forgotPassword: "Quên mật khẩu?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Đăng nhập bằng Telegram",
    waitingForTelegram: "Đang chờ Telegram...",
    telegramInstructions: "Mở Telegram và nhấn Bắt đầu để đăng nhập",
    loginWithX: "Đăng nhập bằng X",
    redirectingToX: "Đang chuyển hướng đến X...",
    loginWithEmail: "Đăng nhập bằng Email",

    tgDeepLinkOpening: "Đang mở Telegram…",
    tgDeepLinkConfirm: "Xác nhận trong Telegram",
    tgDeepLinkOpenAgain: "Mở Telegram lại",
    tgDeepLinkExpired: "Liên kết đăng nhập đã hết hạn. Thử lại.",

    telegramWidgetVerifying: "Đang xác minh qua Telegram...",
    telegramWidgetError: "Xác minh Telegram thất bại. Vui lòng thử lại.",
    telegramWidgetRetry: "Thử lại",
    telegramWidgetFallbackLink: "Gặp sự cố? Thử phương thức đăng nhập khác",
    telegramWidgetBlocked: "Nếu nút Telegram không xuất hiện, hãy dùng phương thức đăng nhập khác bên dưới.",
    alternativeTelegramLogin: "Đăng nhập Telegram thay thế",

    orDivider: "hoặc",

    emailPlaceholder: "Địa chỉ email",
    passwordPlaceholder: "Mật khẩu",
    rememberMe: "Ghi nhớ tôi",
    logIn: "Đăng Nhập",
    cancel: "Hủy",

    emailAndPasswordRequired: "Vui lòng nhập email và mật khẩu",
    loginFailed: "Đăng nhập thất bại",
    connectionError: "Lỗi kết nối. Vui lòng thử lại.",
    loginFailedRetry: "Đăng nhập thất bại. Vui lòng thử lại.",

    legalPrefix: "Bằng cách tiếp tục, bạn đồng ý với",
    legalTerms: "Điều khoản",
    legalAnd: "và",
    legalPrivacyPolicy: "Chính sách Bảo mật",

    footerLinks: {
      cookies: "Cookie",
      communityGuidelines: "Nguyên tắc Cộng đồng",
      contentPolicy: "Chính sách Nội dung",
      refunds: "Hoàn tiền",
      subscriptions: "Đăng ký",
      creatorTerms: "Điều khoản Nhà sáng tạo",
      dmca: "DMCA",
      safety: "An toàn",
      contact: "Liên hệ",
    },

    copyright: "\u00a9 2026 PNPtv. Bảo lưu mọi quyền.",
  },

  ja: {
    tagline: "No.1 クィア PNP コミュニティ",

    featureBadges: [
      { title: "人気パフォーマー", sub: "ラテン系ほか" },
      { title: "PNP コンテンツ", sub: "無修正" },
      { title: "ビデオルーム", sub: "ライブ＆プライベート" },
    ] as const,

    lifetimeDealLabel: "生涯プラン",
    lifetimeDealTitle: "$100 — PRIME 永久アクセス",
    lifetimeDealSub: "一回払い。更新不要。永久に有効。",
    lifetimeDealCta: "今すぐ手に入れる →",

    // Auth buttons
    signInWithPnptvId: "PNPtv ID でログイン",
    orContinueWith: "または次の方法で続行",
    noAccountPrompt: "アカウントをお持ちでない？",
    createAccount: "作成する",
    lastLoginedWith: "前回のログイン方法",

    // Signup-first layout
    joinHeadline: "今すぐ PNPtv に参加",
    createMyAccount: "アカウントを作成",
    freeTakes30s: "無料。30秒で完了。",
    emailRequiredForSignup: "メールアドレスを入力してください",
    emailInvalid: "メールアドレスの形式が正しくありません",
    recommendedForBot: "Telegram ボットから参加した方におすすめ",
    alreadyMember: "すでにメンバーですか？",
    signInWithEmail: "メールとパスワードでログイン",
    signInSubLabel: "（PNPtv ID をお持ちの方 — Telegram は不可）",
    forgotPassword: "パスワードをお忘れですか？",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Telegram でログイン",
    waitingForTelegram: "Telegram を待っています...",
    telegramInstructions: "Telegram を開いてスタートを押してログイン",
    loginWithX: "X でログイン",
    redirectingToX: "X にリダイレクト中...",
    loginWithEmail: "メールでログイン",

    tgDeepLinkOpening: "Telegram を開いています…",
    tgDeepLinkConfirm: "Telegram で確認",
    tgDeepLinkOpenAgain: "Telegram をもう一度開く",
    tgDeepLinkExpired: "ログインリンクが切れました。もう一度お試しください。",

    telegramWidgetVerifying: "Telegram で認証中...",
    telegramWidgetError: "Telegram 認証に失敗しました。もう一度お試しください。",
    telegramWidgetRetry: "再試行",
    telegramWidgetFallbackLink: "問題がありますか？代替ログインをお試しください",
    telegramWidgetBlocked: "Telegram ボタンが表示されない場合は、下の代替ログインをご利用ください。",
    alternativeTelegramLogin: "Telegram 代替ログイン",

    orDivider: "または",

    emailPlaceholder: "メールアドレス",
    passwordPlaceholder: "パスワード",
    rememberMe: "ログイン状態を保持",
    logIn: "ログイン",
    cancel: "キャンセル",

    emailAndPasswordRequired: "メールアドレスとパスワードを入力してください",
    loginFailed: "ログイン失敗",
    connectionError: "接続エラーです。もう一度お試しください。",
    loginFailedRetry: "ログインに失敗しました。もう一度お試しください。",

    legalPrefix: "続行することで、以下に同意したことになります：",
    legalTerms: "利用規約",
    legalAnd: "および",
    legalPrivacyPolicy: "プライバシーポリシー",

    footerLinks: {
      cookies: "クッキー",
      communityGuidelines: "コミュニティガイドライン",
      contentPolicy: "コンテンツポリシー",
      refunds: "返金",
      subscriptions: "サブスクリプション",
      creatorTerms: "クリエイター規約",
      dmca: "DMCA",
      safety: "安全",
      contact: "お問い合わせ",
    },

    copyright: "\u00a9 2026 PNPtv. 無断複製・転載を禁じます。",
  },

  id: {
    tagline: "Komunitas queer PNP #1",

    featureBadges: [
      { title: "Performer Terpanas", sub: "Latino & lainnya" },
      { title: "Konten PNP", sub: "Tanpa sensor" },
      { title: "Ruang Video", sub: "Live dan privat" },
    ] as const,

    lifetimeDealLabel: "Penawaran Seumur Hidup",
    lifetimeDealTitle: "$100 — akses PRIME selamanya",
    lifetimeDealSub: "Satu kali bayar. Tanpa perpanjangan. Tidak pernah kedaluwarsa.",
    lifetimeDealCta: "Dapatkan →",

    // Auth buttons
    signInWithPnptvId: "Masuk dengan PNPtv ID",
    orContinueWith: "atau lanjutkan dengan",
    noAccountPrompt: "Belum punya akun?",
    createAccount: "Buat akun",
    lastLoginedWith: "Terakhir masuk dengan",

    // Signup-first layout
    joinHeadline: "Bergabung dengan PNPtv hari ini",
    createMyAccount: "Buat akun saya",
    freeTakes30s: "Gratis. Hanya 30 detik.",
    emailRequiredForSignup: "Masukkan email Anda untuk melanjutkan",
    emailInvalid: "Format email tidak valid",
    recommendedForBot: "Disarankan jika Anda bergabung lewat bot Telegram kami",
    alreadyMember: "Sudah menjadi anggota?",
    signInWithEmail: "Masuk dengan email dan kata sandi",
    signInSubLabel: "(untuk pengguna dengan PNPtv ID — bukan Telegram)",
    forgotPassword: "Lupa kata sandi?",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "Masuk dengan Telegram",
    waitingForTelegram: "Menunggu Telegram...",
    telegramInstructions: "Buka Telegram dan tekan Mulai untuk masuk",
    loginWithX: "Masuk dengan X",
    redirectingToX: "Mengalihkan ke X...",
    loginWithEmail: "Masuk dengan Email",

    tgDeepLinkOpening: "Membuka Telegram…",
    tgDeepLinkConfirm: "Konfirmasi di Telegram",
    tgDeepLinkOpenAgain: "Buka Telegram lagi",
    tgDeepLinkExpired: "Tautan login sudah kadaluarsa. Coba lagi.",

    telegramWidgetVerifying: "Memverifikasi dengan Telegram...",
    telegramWidgetError: "Verifikasi Telegram gagal. Silakan coba lagi.",
    telegramWidgetRetry: "Coba lagi",
    telegramWidgetFallbackLink: "Ada masalah? Coba login alternatif",
    telegramWidgetBlocked: "Jika tombol Telegram tidak muncul, gunakan login alternatif di bawah.",
    alternativeTelegramLogin: "Login Telegram alternatif",

    orDivider: "atau",

    emailPlaceholder: "Alamat email",
    passwordPlaceholder: "Kata sandi",
    rememberMe: "Ingat saya",
    logIn: "Masuk",
    cancel: "Batal",

    emailAndPasswordRequired: "Masukkan email dan kata sandi Anda",
    loginFailed: "Login gagal",
    connectionError: "Kesalahan koneksi. Silakan coba lagi.",
    loginFailedRetry: "Login gagal. Silakan coba lagi.",

    legalPrefix: "Dengan melanjutkan, Anda menyetujui",
    legalTerms: "Syarat",
    legalAnd: "dan",
    legalPrivacyPolicy: "Kebijakan Privasi",

    footerLinks: {
      cookies: "Cookie",
      communityGuidelines: "Panduan Komunitas",
      contentPolicy: "Kebijakan Konten",
      refunds: "Pengembalian Dana",
      subscriptions: "Langganan",
      creatorTerms: "Ketentuan Kreator",
      dmca: "DMCA",
      safety: "Keamanan",
      contact: "Kontak",
    },

    copyright: "\u00a9 2026 PNPtv. Semua hak dilindungi.",
  },

  ar: {
    tagline: "مجتمع PNP الكويري الأول عالمياً",

    featureBadges: [
      { title: "فنانون ساخنون", sub: "لاتيني وأكثر" },
      { title: "محتوى PNP", sub: "بلا رقابة" },
      { title: "غرف الفيديو", sub: "مباشر وخاص" },
    ] as const,

    lifetimeDealLabel: "عرض مدى الحياة",
    lifetimeDealTitle: "$100 — وصول PRIME للأبد",
    lifetimeDealSub: "دفعة واحدة. بلا تجديد. لا تنتهي أبداً.",
    lifetimeDealCta: "احصل عليه ←",

    // Auth buttons
    signInWithPnptvId: "الدخول عبر PNPtv ID",
    orContinueWith: "أو تابع عبر",
    noAccountPrompt: "ليس لديك حساب؟",
    createAccount: "أنشئ حساباً",
    lastLoginedWith: "آخر دخول عبر",

    // Signup-first layout
    joinHeadline: "انضم إلى PNPtv اليوم",
    createMyAccount: "إنشاء حسابي",
    freeTakes30s: "مجاني. يستغرق 30 ثانية.",
    emailRequiredForSignup: "يرجى إدخال بريدك الإلكتروني للمتابعة",
    emailInvalid: "البريد الإلكتروني غير صالح",
    recommendedForBot: "موصى به إذا انضممت عبر بوت Telegram الخاص بنا",
    alreadyMember: "عضو بالفعل؟",
    signInWithEmail: "الدخول بالبريد الإلكتروني وكلمة المرور",
    signInSubLabel: "(للمستخدمين أصحاب PNPtv ID — ليس Telegram)",
    forgotPassword: "نسيت كلمة المرور؟",
    forgotPasswordPrompt: "Enter your email and we’ll send a reset link.",
    forgotPasswordSubmit: "Send reset link",
    forgotPasswordSending: "Sending…",
    forgotPasswordSent: "If that email is on file, a reset link is on its way. Check your inbox (and spam).",
    forgotPasswordCancel: "Cancel",

    loginWithTelegram: "الدخول عبر Telegram",
    waitingForTelegram: "في انتظار Telegram...",
    telegramInstructions: "افتح Telegram واضغط ابدأ لتسجيل الدخول",
    loginWithX: "الدخول عبر X",
    redirectingToX: "جارٍ التحويل إلى X...",
    loginWithEmail: "الدخول عبر البريد الإلكتروني",

    tgDeepLinkOpening: "جارٍ فتح Telegram…",
    tgDeepLinkConfirm: "أكّد في Telegram",
    tgDeepLinkOpenAgain: "افتح Telegram مجدداً",
    tgDeepLinkExpired: "انتهت صلاحية رابط الدخول. حاول مجدداً.",

    telegramWidgetVerifying: "جارٍ التحقق عبر Telegram...",
    telegramWidgetError: "فشل التحقق عبر Telegram. يرجى المحاولة مجدداً.",
    telegramWidgetRetry: "أعد المحاولة",
    telegramWidgetFallbackLink: "هل تواجه مشكلة؟ جرّب تسجيل الدخول البديل",
    telegramWidgetBlocked: "إذا لم يظهر زر Telegram، استخدم تسجيل الدخول البديل أدناه.",
    alternativeTelegramLogin: "تسجيل دخول Telegram البديل",

    orDivider: "أو",

    emailPlaceholder: "عنوان البريد الإلكتروني",
    passwordPlaceholder: "كلمة المرور",
    rememberMe: "تذكّرني",
    logIn: "تسجيل الدخول",
    cancel: "إلغاء",

    emailAndPasswordRequired: "يرجى إدخال بريدك الإلكتروني وكلمة المرور",
    loginFailed: "فشل تسجيل الدخول",
    connectionError: "خطأ في الاتصال. يرجى المحاولة مجدداً.",
    loginFailedRetry: "فشل تسجيل الدخول. يرجى المحاولة مجدداً.",

    legalPrefix: "بالمتابعة، أنت توافق على",
    legalTerms: "الشروط والأحكام",
    legalAnd: "و",
    legalPrivacyPolicy: "سياسة الخصوصية",

    footerLinks: {
      cookies: "ملفات تعريف الارتباط",
      communityGuidelines: "إرشادات المجتمع",
      contentPolicy: "سياسة المحتوى",
      refunds: "المبالغ المستردة",
      subscriptions: "الاشتراكات",
      creatorTerms: "شروط المبدعين",
      dmca: "DMCA",
      safety: "الأمان",
      contact: "اتصل بنا",
    },

    copyright: "\u00a9 2026 PNPtv. جميع الحقوق محفوظة.",
  },
} as const;

export type LoginStrings = typeof strings.en;
export { strings as login };
