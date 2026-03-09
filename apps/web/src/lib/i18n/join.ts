const strings = {
  en: {
    // <title> / meta
    pageTitle: "Join PNPtv! \u2014 The Queer PNP Community",
    metaDescription: "Join PNPtv! \u2014 the private queer community for party & play. Connect, explore exclusive content, and find your people. Free to join.",
    ogDescription: "4,000+ members. Private hangouts. Exclusive content. Join free or go PRIME.",

    // Sticky nav
    openApp: "Open App",
    signIn: "Sign In",
    joinNow: "Join Now",

    // Hero badge
    heroBadge: "The private queer PNP community",

    // Hero headline (two parts split around the gradient span)
    heroHeadlinePart1: "Your people are",
    heroHeadlinePart2: "already here.",

    // Hero body
    heroBody: "PNPtv! is the private digital space for the queer party & play community. Connect, explore, and belong \u2014 on your terms.",

    // Hero stats template (rendered dynamically — individual tokens)
    heroStatsMembersTemplate: "{count}+ members",
    heroStatsJoinedTemplate: "{count}+ joined this month",

    // Hero CTAs
    getPrimeCta: "Get PRIME \u2014 $24.99/mo",
    joinFreeCta: "Join Free",
    noCreditCard: "No credit card required to join free. Cancel anytime.",

    // What is PNPtv! section
    whatIsPnptvLabel: "What is PNPtv!?",
    whatIsCards: [
      {
        title: "Private & Safe",
        desc: "A verified community \u2014 no randos. Every member goes through Telegram-based entry so the space stays real.",
      },
      {
        title: "Exclusive Content",
        desc: "Live shows, videos, and creator content you won\u2019t find anywhere else. Made by the community, for the community.",
      },
      {
        title: "Your People",
        desc: "Connect in private hangout rooms, discover nearby members, and DM freely. No algorithms, no judgment.",
      },
    ] as const,

    // Tier comparison table
    comparePlansLabel: "Compare plans",

    // Comparison column headers
    colFree: "Free",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mo",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mo",

    // Comparison rows (12 rows)
    comparisonRows: [
      "Social feed",
      "Home feed posts",
      "Telegram bot access",
      "Create a profile",
      "Browse member profiles",
      "Private hangout rooms",
      "Nearby users discovery",
      "DMs with any member",
      "Exclusive video library",
      "Creator-only content",
      "Live stream access",
      "Priority support",
    ] as const,

    // Choose your plan section
    choosePlanLabel: "Choose your plan",

    // Free plan card
    freePlanName: "Free",
    freePlanPrice: "$0",
    freePlanPeriod: "forever",
    freePlanFeatures: [
      "Create your profile",
      "Browse the social feed",
      "Telegram bot access",
      "Basic community access",
    ] as const,
    freePlanCta: "Join Free",

    // Member plan card
    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mo",
    memberPlanPeriod: "billed monthly",
    memberPlanFeatures: [
      "Everything in Free",
      "Private hangout rooms",
      "Browse all member profiles",
      "Nearby users discovery",
      "Unlimited DMs",
    ] as const,
    memberPlanCta: "Get Member",

    // PRIME plan card
    primePlanName: "PRIME",
    primePlanBestValue: "BEST VALUE",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mo",
    primePlanPeriod: "billed monthly \u00b7 cancel anytime",
    primePlanFeatures: [
      "Everything in Member",
      "Exclusive video library",
      "Creator-only content",
      "Live stream access",
      "Priority support",
      "VIP community status",
    ] as const,
    primePlanCta: "Get PRIME",

    // Longer plans teaser
    longerPlansTitle: "Save more with longer plans",
    longerPlansDesc: "Crystal PRIME (6mo) \u00b7 Diamond PRIME (1yr) \u00b7 Lifetime PRIME",
    longerPlansSeeAll: "See all",

    // Featured creators section
    meetCreatorsLabel: "Meet the creators",

    // Stats section
    stats: [
      { stat: "4,400+", label: "Members worldwide" },
      { stat: "1,200+", label: "Joined this month" },
      { stat: "100%", label: "Private & verified" },
    ] as const,

    // Bottom CTA section
    bottomCtaHeadlinePart1: "Ready to",
    bottomCtaHeadlinePart2: "find your people?",
    bottomCtaBody: "Start free. Upgrade whenever you want. Cancel anytime.",

    // Footer
    footerAdults: "For adults 18+ only",
    footerTerms: "Terms of Service",
    footerPrivacy: "Privacy Policy",
    footerSupport: "Support",
  },

  es: {
    pageTitle: "Unirte a PNPtv! \u2014 La Comunidad Queer PNP",
    metaDescription: "Únete a PNPtv! \u2014 la comunidad queer privada de party & play. Conéctate, explora contenido exclusivo y encuentra a tu gente. Gratis.",
    ogDescription: "4,000+ miembros. Hangouts privados. Contenido exclusivo. Únete gratis o hazte PRIME.",

    openApp: "Abrir App",
    signIn: "Iniciar sesión",
    joinNow: "Únete Ahora",

    heroBadge: "La comunidad queer privada de PNP",

    heroHeadlinePart1: "Tu gente ya",
    heroHeadlinePart2: "está aquí.",

    heroBody: "PNPtv! es el espacio digital privado para la comunidad queer de party & play. Conéctate, explora y pertenece \u2014 a tu manera.",

    heroStatsMembersTemplate: "{count}+ miembros",
    heroStatsJoinedTemplate: "{count}+ se unieron este mes",

    getPrimeCta: "Hazte PRIME \u2014 $24.99/mes",
    joinFreeCta: "Unirse Gratis",
    noCreditCard: "No se requiere tarjeta de crédito para unirse gratis. Cancela cuando quieras.",

    whatIsPnptvLabel: "\u00bfQué es PNPtv!?",
    whatIsCards: [
      {
        title: "Privado y Seguro",
        desc: "Una comunidad verificada \u2014 sin desconocidos. Cada miembro entra a través de Telegram para que el espacio sea real.",
      },
      {
        title: "Contenido Exclusivo",
        desc: "Shows en vivo, videos y contenido de creadores que no encontrarás en otro lugar. Hecho por la comunidad, para la comunidad.",
      },
      {
        title: "Tu Gente",
        desc: "Conéctate en salas privadas, descubre miembros cercanos y escribe DMs libremente. Sin algoritmos, sin prejuicios.",
      },
    ] as const,

    comparePlansLabel: "Comparar planes",

    colFree: "Gratis",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mes",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mes",

    comparisonRows: [
      "Feed social",
      "Posts en el feed principal",
      "Acceso al bot de Telegram",
      "Crear un perfil",
      "Ver perfiles de miembros",
      "Salas privadas de hangout",
      "Descubrir usuarios cercanos",
      "DMs con cualquier miembro",
      "Biblioteca de videos exclusivos",
      "Contenido solo para creadores",
      "Acceso a streams en vivo",
      "Soporte prioritario",
    ] as const,

    choosePlanLabel: "Elige tu plan",

    freePlanName: "Gratis",
    freePlanPrice: "$0",
    freePlanPeriod: "para siempre",
    freePlanFeatures: [
      "Crea tu perfil",
      "Explora el feed social",
      "Acceso al bot de Telegram",
      "Acceso básico a la comunidad",
    ] as const,
    freePlanCta: "Unirse Gratis",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mes",
    memberPlanPeriod: "facturado mensualmente",
    memberPlanFeatures: [
      "Todo lo del plan Gratis",
      "Salas privadas de hangout",
      "Ver todos los perfiles de miembros",
      "Descubrir usuarios cercanos",
      "DMs ilimitados",
    ] as const,
    memberPlanCta: "Hazte Member",

    primePlanName: "PRIME",
    primePlanBestValue: "MEJOR VALOR",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mes",
    primePlanPeriod: "facturado mensualmente \u00b7 cancela cuando quieras",
    primePlanFeatures: [
      "Todo lo del plan Member",
      "Biblioteca de videos exclusivos",
      "Contenido solo para creadores",
      "Acceso a streams en vivo",
      "Soporte prioritario",
      "Estatus VIP en la comunidad",
    ] as const,
    primePlanCta: "Hazte PRIME",

    longerPlansTitle: "Ahorra más con planes más largos",
    longerPlansDesc: "Crystal PRIME (6 meses) \u00b7 Diamond PRIME (1 año) \u00b7 PRIME de por Vida",
    longerPlansSeeAll: "Ver todos",

    meetCreatorsLabel: "Conoce a los creadores",

    stats: [
      { stat: "4,400+", label: "Miembros en el mundo" },
      { stat: "1,200+", label: "Se unieron este mes" },
      { stat: "100%", label: "Privado y verificado" },
    ] as const,

    bottomCtaHeadlinePart1: "Listo para",
    bottomCtaHeadlinePart2: "encontrar a tu gente?",
    bottomCtaBody: "Empieza gratis. Mejora cuando quieras. Cancela cuando quieras.",

    footerAdults: "Solo para mayores de 18 años",
    footerTerms: "Términos de Servicio",
    footerPrivacy: "Política de Privacidad",
    footerSupport: "Soporte",
  },

  pt: {
    pageTitle: "Junte-se ao PNPtv! \u2014 A Comunidade Queer PNP",
    metaDescription: "Junte-se ao PNPtv! \u2014 a comunidade queer privada de party & play. Conecte-se, explore conteúdo exclusivo e encontre sua turma. Grátis.",
    ogDescription: "4.000+ membros. Hangouts privados. Conteúdo exclusivo. Entre grátis ou seja PRIME.",

    openApp: "Abrir App",
    signIn: "Entrar",
    joinNow: "Entrar Agora",

    heroBadge: "A comunidade queer privada de PNP",

    heroHeadlinePart1: "Sua turma já",
    heroHeadlinePart2: "está aqui.",

    heroBody: "PNPtv! é o espaço digital privado para a comunidade queer de party & play. Conecte-se, explore e pertença \u2014 do seu jeito.",

    heroStatsMembersTemplate: "{count}+ membros",
    heroStatsJoinedTemplate: "{count}+ entraram este mês",

    getPrimeCta: "Seja PRIME \u2014 $24.99/mês",
    joinFreeCta: "Entrar Grátis",
    noCreditCard: "Não é necessário cartão de crédito para entrar grátis. Cancele quando quiser.",

    whatIsPnptvLabel: "O que é PNPtv!?",
    whatIsCards: [
      {
        title: "Privado e Seguro",
        desc: "Uma comunidade verificada \u2014 sem estranhos. Cada membro entra via Telegram para manter o espaço autêntico.",
      },
      {
        title: "Conteúdo Exclusivo",
        desc: "Shows ao vivo, vídeos e conteúdo de criadores que você não encontrará em outro lugar. Feito pela comunidade, para a comunidade.",
      },
      {
        title: "Sua Turma",
        desc: "Conecte-se em salas privadas, descubra membros próximos e envie DMs livremente. Sem algoritmos, sem julgamentos.",
      },
    ] as const,

    comparePlansLabel: "Comparar planos",

    colFree: "Grátis",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mês",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mês",

    comparisonRows: [
      "Feed social",
      "Posts no feed principal",
      "Acesso ao bot do Telegram",
      "Criar um perfil",
      "Ver perfis de membros",
      "Salas privadas de hangout",
      "Descobrir usuários próximos",
      "DMs com qualquer membro",
      "Biblioteca de vídeos exclusivos",
      "Conteúdo apenas para criadores",
      "Acesso a streams ao vivo",
      "Suporte prioritário",
    ] as const,

    choosePlanLabel: "Escolha seu plano",

    freePlanName: "Grátis",
    freePlanPrice: "$0",
    freePlanPeriod: "para sempre",
    freePlanFeatures: [
      "Crie seu perfil",
      "Explore o feed social",
      "Acesso ao bot do Telegram",
      "Acesso básico à comunidade",
    ] as const,
    freePlanCta: "Entrar Grátis",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mês",
    memberPlanPeriod: "cobrado mensalmente",
    memberPlanFeatures: [
      "Tudo do plano Grátis",
      "Salas privadas de hangout",
      "Ver todos os perfis de membros",
      "Descobrir usuários próximos",
      "DMs ilimitados",
    ] as const,
    memberPlanCta: "Ser Member",

    primePlanName: "PRIME",
    primePlanBestValue: "MELHOR CUSTO-BENEFÍCIO",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mês",
    primePlanPeriod: "cobrado mensalmente \u00b7 cancele quando quiser",
    primePlanFeatures: [
      "Tudo do plano Member",
      "Biblioteca de vídeos exclusivos",
      "Conteúdo apenas para criadores",
      "Acesso a streams ao vivo",
      "Suporte prioritário",
      "Status VIP na comunidade",
    ] as const,
    primePlanCta: "Ser PRIME",

    longerPlansTitle: "Economize mais com planos mais longos",
    longerPlansDesc: "Crystal PRIME (6 meses) \u00b7 Diamond PRIME (1 ano) \u00b7 PRIME Vitalício",
    longerPlansSeeAll: "Ver todos",

    meetCreatorsLabel: "Conheça os criadores",

    stats: [
      { stat: "4.400+", label: "Membros no mundo" },
      { stat: "1.200+", label: "Entraram este mês" },
      { stat: "100%", label: "Privado e verificado" },
    ] as const,

    bottomCtaHeadlinePart1: "Pronto para",
    bottomCtaHeadlinePart2: "encontrar sua turma?",
    bottomCtaBody: "Comece grátis. Faça upgrade quando quiser. Cancele quando quiser.",

    footerAdults: "Apenas para maiores de 18 anos",
    footerTerms: "Termos de Serviço",
    footerPrivacy: "Política de Privacidade",
    footerSupport: "Suporte",
  },

  zh: {
    pageTitle: "加入 PNPtv! \u2014 酷儿 PNP 社区",
    metaDescription: "加入 PNPtv! \u2014 专属酷儿 party & play 私人社区。连接、探索独家内容，找到属于你的圈子。免费加入。",
    ogDescription: "4,000+ 会员。私密 Hangouts。独家内容。免费加入或成为 PRIME。",

    openApp: "打开应用",
    signIn: "登录",
    joinNow: "立即加入",

    heroBadge: "酷儿 PNP 私人社区",

    heroHeadlinePart1: "你的圈子早已",
    heroHeadlinePart2: "在这里。",

    heroBody: "PNPtv! 是酷儿 party & play 社区的私人数字空间。随时连接、探索、归属 \u2014 按你的方式。",

    heroStatsMembersTemplate: "{count}+ 位会员",
    heroStatsJoinedTemplate: "本月新增 {count}+ 位",

    getPrimeCta: "成为 PRIME \u2014 $24.99/月",
    joinFreeCta: "免费加入",
    noCreditCard: "免费加入无需信用卡。随时取消。",

    whatIsPnptvLabel: "PNPtv! 是什么？",
    whatIsCards: [
      {
        title: "私密安全",
        desc: "经过验证的社区 \u2014 无陌生人。每位成员通过 Telegram 验证入场，保证空间的真实性。",
      },
      {
        title: "独家内容",
        desc: "直播秀、视频和创作者内容，你在其他地方找不到。由社区创作，为社区服务。",
      },
      {
        title: "你的圈子",
        desc: "在私密 Hangout 房间互动，发现附近的成员，自由发送私信。无算法，无偏见。",
      },
    ] as const,

    comparePlansLabel: "比较方案",

    colFree: "免费",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/月",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/月",

    comparisonRows: [
      "社交动态",
      "主页帖子",
      "Telegram 机器人访问",
      "创建个人资料",
      "浏览会员资料",
      "私密 Hangout 房间",
      "附近用户发现",
      "与任意会员私信",
      "独家视频库",
      "创作者专属内容",
      "直播访问",
      "优先支持",
    ] as const,

    choosePlanLabel: "选择你的方案",

    freePlanName: "免费",
    freePlanPrice: "$0",
    freePlanPeriod: "永久",
    freePlanFeatures: [
      "创建个人资料",
      "浏览社交动态",
      "Telegram 机器人访问",
      "基础社区访问",
    ] as const,
    freePlanCta: "免费加入",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/月",
    memberPlanPeriod: "按月计费",
    memberPlanFeatures: [
      "包含免费版全部权益",
      "私密 Hangout 房间",
      "浏览所有会员资料",
      "附近用户发现",
      "无限私信",
    ] as const,
    memberPlanCta: "成为 Member",

    primePlanName: "PRIME",
    primePlanBestValue: "最超值",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/月",
    primePlanPeriod: "按月计费 \u00b7 随时取消",
    primePlanFeatures: [
      "包含 Member 版全部权益",
      "独家视频库",
      "创作者专属内容",
      "直播访问",
      "优先支持",
      "VIP 社区身份",
    ] as const,
    primePlanCta: "成为 PRIME",

    longerPlansTitle: "选择长期方案更省钱",
    longerPlansDesc: "Crystal PRIME（6个月）\u00b7 Diamond PRIME（1年）\u00b7 终身 PRIME",
    longerPlansSeeAll: "查看全部",

    meetCreatorsLabel: "认识创作者",

    stats: [
      { stat: "4,400+", label: "全球会员" },
      { stat: "1,200+", label: "本月加入" },
      { stat: "100%", label: "私密且经验证" },
    ] as const,

    bottomCtaHeadlinePart1: "准备好",
    bottomCtaHeadlinePart2: "找到你的圈子了吗？",
    bottomCtaBody: "免费开始。随时升级。随时取消。",

    footerAdults: "仅限 18 岁以上成年人",
    footerTerms: "服务条款",
    footerPrivacy: "隐私政策",
    footerSupport: "支持",
  },

  zhTW: {
    pageTitle: "加入 PNPtv! \u2014 酷兒 PNP 社群",
    metaDescription: "加入 PNPtv! \u2014 專屬酷兒 party & play 私人社群。連結、探索獨家內容，找到屬於你的圈子。免費加入。",
    ogDescription: "4,000+ 會員。私密 Hangouts。獨家內容。免費加入或成為 PRIME。",

    openApp: "開啟應用程式",
    signIn: "登入",
    joinNow: "立即加入",

    heroBadge: "酷兒 PNP 私人社群",

    heroHeadlinePart1: "你的圈子早已",
    heroHeadlinePart2: "在這裡。",

    heroBody: "PNPtv! 是酷兒 party & play 社群的私人數位空間。隨時連結、探索、歸屬 \u2014 按你的方式。",

    heroStatsMembersTemplate: "{count}+ 位會員",
    heroStatsJoinedTemplate: "本月新增 {count}+ 位",

    getPrimeCta: "成為 PRIME \u2014 $24.99/月",
    joinFreeCta: "免費加入",
    noCreditCard: "免費加入無需信用卡。隨時取消。",

    whatIsPnptvLabel: "PNPtv! 是什麼？",
    whatIsCards: [
      {
        title: "私密安全",
        desc: "經過驗證的社群 \u2014 無陌生人。每位會員透過 Telegram 驗證入場，保障空間的真實性。",
      },
      {
        title: "獨家內容",
        desc: "直播秀、影片和創作者內容，你在其他地方找不到。由社群創作，為社群服務。",
      },
      {
        title: "你的圈子",
        desc: "在私密 Hangout 房間互動，發現附近的會員，自由傳送私訊。無演算法，無偏見。",
      },
    ] as const,

    comparePlansLabel: "比較方案",

    colFree: "免費",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/月",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/月",

    comparisonRows: [
      "社交動態",
      "首頁貼文",
      "Telegram 機器人存取",
      "建立個人資料",
      "瀏覽會員資料",
      "私密 Hangout 房間",
      "附近用戶探索",
      "與任意會員私訊",
      "獨家影片庫",
      "創作者專屬內容",
      "直播存取",
      "優先支援",
    ] as const,

    choosePlanLabel: "選擇你的方案",

    freePlanName: "免費",
    freePlanPrice: "$0",
    freePlanPeriod: "永久",
    freePlanFeatures: [
      "建立個人資料",
      "瀏覽社交動態",
      "Telegram 機器人存取",
      "基本社群存取",
    ] as const,
    freePlanCta: "免費加入",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/月",
    memberPlanPeriod: "按月計費",
    memberPlanFeatures: [
      "包含免費版所有權益",
      "私密 Hangout 房間",
      "瀏覽所有會員資料",
      "附近用戶探索",
      "無限私訊",
    ] as const,
    memberPlanCta: "成為 Member",

    primePlanName: "PRIME",
    primePlanBestValue: "最超值",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/月",
    primePlanPeriod: "按月計費 \u00b7 隨時取消",
    primePlanFeatures: [
      "包含 Member 版所有權益",
      "獨家影片庫",
      "創作者專屬內容",
      "直播存取",
      "優先支援",
      "VIP 社群身份",
    ] as const,
    primePlanCta: "成為 PRIME",

    longerPlansTitle: "選擇長期方案更省錢",
    longerPlansDesc: "Crystal PRIME（6個月）\u00b7 Diamond PRIME（1年）\u00b7 終身 PRIME",
    longerPlansSeeAll: "查看全部",

    meetCreatorsLabel: "認識創作者",

    stats: [
      { stat: "4,400+", label: "全球會員" },
      { stat: "1,200+", label: "本月加入" },
      { stat: "100%", label: "私密且經驗證" },
    ] as const,

    bottomCtaHeadlinePart1: "準備好",
    bottomCtaHeadlinePart2: "找到你的圈子了嗎？",
    bottomCtaBody: "免費開始。隨時升級。隨時取消。",

    footerAdults: "僅限 18 歲以上成年人",
    footerTerms: "服務條款",
    footerPrivacy: "隱私政策",
    footerSupport: "支援",
  },

  fr: {
    pageTitle: "Rejoindre PNPtv! \u2014 La Communauté Queer PNP",
    metaDescription: "Rejoignez PNPtv! \u2014 la communauté queer privée de party & play. Connectez-vous, explorez du contenu exclusif et trouvez votre tribu. Gratuit.",
    ogDescription: "4 000+ membres. Hangouts privés. Contenu exclusif. Rejoignez gratuitement ou devenez PRIME.",

    openApp: "Ouvrir l'App",
    signIn: "Se connecter",
    joinNow: "Rejoindre",

    heroBadge: "La communauté queer privée PNP",

    heroHeadlinePart1: "Votre tribu est",
    heroHeadlinePart2: "déjà ici.",

    heroBody: "PNPtv! est l'espace numérique privé pour la communauté queer de party & play. Connectez-vous, explorez et appartenez \u2014 à votre façon.",

    heroStatsMembersTemplate: "{count}+ membres",
    heroStatsJoinedTemplate: "{count}+ ont rejoint ce mois-ci",

    getPrimeCta: "Devenir PRIME \u2014 $24.99/mois",
    joinFreeCta: "Rejoindre Gratuitement",
    noCreditCard: "Aucune carte de crédit requise pour rejoindre gratuitement. Annulez à tout moment.",

    whatIsPnptvLabel: "Qu'est-ce que PNPtv! ?",
    whatIsCards: [
      {
        title: "Privé et Sécurisé",
        desc: "Une communauté vérifiée \u2014 sans inconnus. Chaque membre passe par Telegram pour que l'espace reste authentique.",
      },
      {
        title: "Contenu Exclusif",
        desc: "Shows en direct, vidéos et contenu de créateurs introuvables ailleurs. Fait par la communauté, pour la communauté.",
      },
      {
        title: "Votre Tribu",
        desc: "Connectez-vous dans des salons privés, découvrez les membres proches et envoyez des DMs librement. Sans algorithmes, sans jugement.",
      },
    ] as const,

    comparePlansLabel: "Comparer les plans",

    colFree: "Gratuit",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mois",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mois",

    comparisonRows: [
      "Fil social",
      "Posts sur le fil principal",
      "Accès au bot Telegram",
      "Créer un profil",
      "Parcourir les profils membres",
      "Salons hangout privés",
      "Découverte des membres proches",
      "DMs avec n'importe quel membre",
      "Bibliothèque vidéo exclusive",
      "Contenu réservé aux créateurs",
      "Accès aux streams en direct",
      "Support prioritaire",
    ] as const,

    choosePlanLabel: "Choisissez votre plan",

    freePlanName: "Gratuit",
    freePlanPrice: "$0",
    freePlanPeriod: "pour toujours",
    freePlanFeatures: [
      "Créez votre profil",
      "Parcourez le fil social",
      "Accès au bot Telegram",
      "Accès basique à la communauté",
    ] as const,
    freePlanCta: "Rejoindre Gratuitement",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mois",
    memberPlanPeriod: "facturé mensuellement",
    memberPlanFeatures: [
      "Tout du plan Gratuit",
      "Salons hangout privés",
      "Voir tous les profils membres",
      "Découverte des membres proches",
      "DMs illimités",
    ] as const,
    memberPlanCta: "Devenir Member",

    primePlanName: "PRIME",
    primePlanBestValue: "MEILLEURE VALEUR",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mois",
    primePlanPeriod: "facturé mensuellement \u00b7 annulez à tout moment",
    primePlanFeatures: [
      "Tout du plan Member",
      "Bibliothèque vidéo exclusive",
      "Contenu réservé aux créateurs",
      "Accès aux streams en direct",
      "Support prioritaire",
      "Statut VIP dans la communauté",
    ] as const,
    primePlanCta: "Devenir PRIME",

    longerPlansTitle: "Économisez plus avec des plans plus longs",
    longerPlansDesc: "Crystal PRIME (6 mois) \u00b7 Diamond PRIME (1 an) \u00b7 PRIME à Vie",
    longerPlansSeeAll: "Voir tout",

    meetCreatorsLabel: "Rencontrez les créateurs",

    stats: [
      { stat: "4 400+", label: "Membres dans le monde" },
      { stat: "1 200+", label: "Ont rejoint ce mois" },
      { stat: "100%", label: "Privé et vérifié" },
    ] as const,

    bottomCtaHeadlinePart1: "Prêt à",
    bottomCtaHeadlinePart2: "trouver votre tribu ?",
    bottomCtaBody: "Commencez gratuitement. Mettez à niveau quand vous voulez. Annulez à tout moment.",

    footerAdults: "Pour adultes de 18 ans et plus uniquement",
    footerTerms: "Conditions d'utilisation",
    footerPrivacy: "Politique de Confidentialité",
    footerSupport: "Support",
  },

  de: {
    pageTitle: "PNPtv! beitreten \u2014 Die Queere PNP-Community",
    metaDescription: "Tritt PNPtv! bei \u2014 der privaten queeren Community für Party & Play. Vernetze dich, entdecke exklusive Inhalte und finde deine Leute. Kostenlos.",
    ogDescription: "4.000+ Mitglieder. Private Hangouts. Exklusive Inhalte. Kostenlos beitreten oder PRIME werden.",

    openApp: "App öffnen",
    signIn: "Anmelden",
    joinNow: "Jetzt beitreten",

    heroBadge: "Die private queere PNP-Community",

    heroHeadlinePart1: "Deine Leute sind",
    heroHeadlinePart2: "schon hier.",

    heroBody: "PNPtv! ist der private digitale Raum für die queere Party & Play-Community. Vernetze dich, entdecke und gehöre dazu \u2014 nach deinen Regeln.",

    heroStatsMembersTemplate: "{count}+ Mitglieder",
    heroStatsJoinedTemplate: "{count}+ beigetreten diesen Monat",

    getPrimeCta: "PRIME werden \u2014 $24.99/Monat",
    joinFreeCta: "Kostenlos beitreten",
    noCreditCard: "Keine Kreditkarte für den kostenlosen Beitritt erforderlich. Jederzeit kündigen.",

    whatIsPnptvLabel: "Was ist PNPtv!?",
    whatIsCards: [
      {
        title: "Privat & Sicher",
        desc: "Eine verifizierte Community \u2014 keine Fremden. Jedes Mitglied tritt über Telegram bei, damit der Raum authentisch bleibt.",
      },
      {
        title: "Exklusive Inhalte",
        desc: "Live-Shows, Videos und Creator-Inhalte, die du nirgendwo sonst findest. Von der Community, für die Community.",
      },
      {
        title: "Deine Leute",
        desc: "Verbinde dich in privaten Hangout-Räumen, entdecke Mitglieder in der Nähe und schreibe frei DMs. Keine Algorithmen, kein Urteil.",
      },
    ] as const,

    comparePlansLabel: "Pläne vergleichen",

    colFree: "Kostenlos",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/Monat",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/Monat",

    comparisonRows: [
      "Social Feed",
      "Beiträge im Haupt-Feed",
      "Telegram-Bot-Zugang",
      "Profil erstellen",
      "Mitgliederprofile ansehen",
      "Private Hangout-Räume",
      "Nutzer in der Nähe entdecken",
      "DMs mit jedem Mitglied",
      "Exklusive Videothek",
      "Creator-exklusive Inhalte",
      "Zugang zu Livestreams",
      "Prioritätssupport",
    ] as const,

    choosePlanLabel: "Wähle deinen Plan",

    freePlanName: "Kostenlos",
    freePlanPrice: "$0",
    freePlanPeriod: "für immer",
    freePlanFeatures: [
      "Erstelle dein Profil",
      "Social Feed entdecken",
      "Telegram-Bot-Zugang",
      "Basis-Community-Zugang",
    ] as const,
    freePlanCta: "Kostenlos beitreten",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/Monat",
    memberPlanPeriod: "monatlich abgerechnet",
    memberPlanFeatures: [
      "Alles aus dem kostenlosen Plan",
      "Private Hangout-Räume",
      "Alle Mitgliederprofile ansehen",
      "Nutzer in der Nähe entdecken",
      "Unbegrenzte DMs",
    ] as const,
    memberPlanCta: "Member werden",

    primePlanName: "PRIME",
    primePlanBestValue: "BESTES ANGEBOT",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/Monat",
    primePlanPeriod: "monatlich abgerechnet \u00b7 jederzeit kündigen",
    primePlanFeatures: [
      "Alles aus dem Member-Plan",
      "Exklusive Videothek",
      "Creator-exklusive Inhalte",
      "Zugang zu Livestreams",
      "Prioritätssupport",
      "VIP-Community-Status",
    ] as const,
    primePlanCta: "PRIME werden",

    longerPlansTitle: "Spare mehr mit längeren Plänen",
    longerPlansDesc: "Crystal PRIME (6 Monate) \u00b7 Diamond PRIME (1 Jahr) \u00b7 Lifetime PRIME",
    longerPlansSeeAll: "Alle anzeigen",

    meetCreatorsLabel: "Lerne die Creator kennen",

    stats: [
      { stat: "4.400+", label: "Mitglieder weltweit" },
      { stat: "1.200+", label: "Diesen Monat beigetreten" },
      { stat: "100%", label: "Privat & verifiziert" },
    ] as const,

    bottomCtaHeadlinePart1: "Bereit,",
    bottomCtaHeadlinePart2: "deine Leute zu finden?",
    bottomCtaBody: "Kostenlos starten. Jederzeit upgraden. Jederzeit kündigen.",

    footerAdults: "Nur für Erwachsene ab 18 Jahren",
    footerTerms: "Nutzungsbedingungen",
    footerPrivacy: "Datenschutzrichtlinie",
    footerSupport: "Support",
  },

  th: {
    pageTitle: "เข้าร่วม PNPtv! \u2014 ชุมชน Queer PNP",
    metaDescription: "เข้าร่วม PNPtv! \u2014 ชุมชน queer ส่วนตัวสำหรับ party & play เชื่อมต่อ สำรวจเนื้อหาพิเศษ และค้นพบคนของคุณ เข้าร่วมฟรี",
    ogDescription: "สมาชิกกว่า 4,000 คน Hangouts ส่วนตัว เนื้อหาพิเศษ เข้าร่วมฟรีหรืออัปเกรดเป็น PRIME",

    openApp: "เปิดแอป",
    signIn: "เข้าสู่ระบบ",
    joinNow: "เข้าร่วมเลย",

    heroBadge: "ชุมชน queer PNP ส่วนตัว",

    heroHeadlinePart1: "คนของคุณ",
    heroHeadlinePart2: "อยู่ที่นี่แล้ว",

    heroBody: "PNPtv! คือพื้นที่ดิจิทัลส่วนตัวสำหรับชุมชน queer party & play เชื่อมต่อ สำรวจ และเป็นส่วนหนึ่ง \u2014 ตามแบบของคุณ",

    heroStatsMembersTemplate: "สมาชิก {count}+ คน",
    heroStatsJoinedTemplate: "เข้าร่วมเดือนนี้ {count}+ คน",

    getPrimeCta: "เป็น PRIME \u2014 $24.99/เดือน",
    joinFreeCta: "เข้าร่วมฟรี",
    noCreditCard: "ไม่ต้องใช้บัตรเครดิตสำหรับการเข้าร่วมฟรี ยกเลิกได้ทุกเมื่อ",

    whatIsPnptvLabel: "PNPtv! คืออะไร?",
    whatIsCards: [
      {
        title: "ส่วนตัวและปลอดภัย",
        desc: "ชุมชนที่ผ่านการตรวจสอบ \u2014 ไม่มีคนแปลกหน้า ทุกคนเข้าร่วมผ่าน Telegram เพื่อให้พื้นที่นี้เป็นของจริง",
      },
      {
        title: "เนื้อหาพิเศษ",
        desc: "ไลฟ์โชว์ วิดีโอ และเนื้อหาจากครีเอเตอร์ที่หาไม่ได้จากที่อื่น สร้างโดยชุมชน เพื่อชุมชน",
      },
      {
        title: "คนของคุณ",
        desc: "เชื่อมต่อในห้อง Hangout ส่วนตัว ค้นหาสมาชิกใกล้เคียง และส่ง DM ได้อิสระ ไม่มีอัลกอริทึม ไม่มีการตัดสิน",
      },
    ] as const,

    comparePlansLabel: "เปรียบเทียบแผน",

    colFree: "ฟรี",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/เดือน",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/เดือน",

    comparisonRows: [
      "ฟีดสังคม",
      "โพสต์ในฟีดหลัก",
      "เข้าถึง Telegram bot",
      "สร้างโปรไฟล์",
      "ดูโปรไฟล์สมาชิก",
      "ห้อง Hangout ส่วนตัว",
      "ค้นหาผู้ใช้ใกล้เคียง",
      "DM กับสมาชิกทุกคน",
      "ห้องสมุดวิดีโอพิเศษ",
      "เนื้อหาเฉพาะครีเอเตอร์",
      "เข้าชมไลฟ์สตรีม",
      "ซัพพอร์ตพิเศษ",
    ] as const,

    choosePlanLabel: "เลือกแผนของคุณ",

    freePlanName: "ฟรี",
    freePlanPrice: "$0",
    freePlanPeriod: "ตลอดไป",
    freePlanFeatures: [
      "สร้างโปรไฟล์ของคุณ",
      "สำรวจฟีดสังคม",
      "เข้าถึง Telegram bot",
      "เข้าถึงชุมชนขั้นพื้นฐาน",
    ] as const,
    freePlanCta: "เข้าร่วมฟรี",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/เดือน",
    memberPlanPeriod: "เรียกเก็บรายเดือน",
    memberPlanFeatures: [
      "ทุกอย่างในแผนฟรี",
      "ห้อง Hangout ส่วนตัว",
      "ดูโปรไฟล์สมาชิกทั้งหมด",
      "ค้นหาผู้ใช้ใกล้เคียง",
      "DM ไม่จำกัด",
    ] as const,
    memberPlanCta: "เป็น Member",

    primePlanName: "PRIME",
    primePlanBestValue: "คุ้มที่สุด",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/เดือน",
    primePlanPeriod: "เรียกเก็บรายเดือน \u00b7 ยกเลิกได้ทุกเมื่อ",
    primePlanFeatures: [
      "ทุกอย่างในแผน Member",
      "ห้องสมุดวิดีโอพิเศษ",
      "เนื้อหาเฉพาะครีเอเตอร์",
      "เข้าชมไลฟ์สตรีม",
      "ซัพพอร์ตพิเศษ",
      "สถานะ VIP ในชุมชน",
    ] as const,
    primePlanCta: "เป็น PRIME",

    longerPlansTitle: "ประหยัดมากขึ้นด้วยแผนระยะยาว",
    longerPlansDesc: "Crystal PRIME (6 เดือน) \u00b7 Diamond PRIME (1 ปี) \u00b7 PRIME ตลอดชีพ",
    longerPlansSeeAll: "ดูทั้งหมด",

    meetCreatorsLabel: "พบกับครีเอเตอร์",

    stats: [
      { stat: "4,400+", label: "สมาชิกทั่วโลก" },
      { stat: "1,200+", label: "เข้าร่วมเดือนนี้" },
      { stat: "100%", label: "ส่วนตัวและผ่านการตรวจสอบ" },
    ] as const,

    bottomCtaHeadlinePart1: "พร้อมที่จะ",
    bottomCtaHeadlinePart2: "ค้นหาคนของคุณแล้วหรือยัง?",
    bottomCtaBody: "เริ่มฟรี อัปเกรดเมื่อใดก็ได้ ยกเลิกได้ทุกเมื่อ",

    footerAdults: "สำหรับผู้ที่มีอายุ 18 ปีขึ้นไปเท่านั้น",
    footerTerms: "เงื่อนไขการให้บริการ",
    footerPrivacy: "นโยบายความเป็นส่วนตัว",
    footerSupport: "ช่วยเหลือ",
  },

  it: {
    pageTitle: "Unisciti a PNPtv! \u2014 La Community Queer PNP",
    metaDescription: "Unisciti a PNPtv! \u2014 la community queer privata per party & play. Connettiti, esplora contenuti esclusivi e trova la tua gente. Gratis.",
    ogDescription: "4.000+ membri. Hangout privati. Contenuti esclusivi. Unisciti gratis o diventa PRIME.",

    openApp: "Apri App",
    signIn: "Accedi",
    joinNow: "Iscriviti Ora",

    heroBadge: "La community queer privata PNP",

    heroHeadlinePart1: "La tua gente è",
    heroHeadlinePart2: "già qui.",

    heroBody: "PNPtv! è lo spazio digitale privato per la community queer di party & play. Connettiti, esplora e appartieni \u2014 a modo tuo.",

    heroStatsMembersTemplate: "{count}+ membri",
    heroStatsJoinedTemplate: "{count}+ iscritti questo mese",

    getPrimeCta: "Diventa PRIME \u2014 $24.99/mese",
    joinFreeCta: "Unisciti Gratis",
    noCreditCard: "Nessuna carta di credito richiesta per iscriversi gratis. Cancella in qualsiasi momento.",

    whatIsPnptvLabel: "Cos'è PNPtv!?",
    whatIsCards: [
      {
        title: "Privato e Sicuro",
        desc: "Una community verificata \u2014 niente estranei. Ogni membro accede tramite Telegram per mantenere lo spazio autentico.",
      },
      {
        title: "Contenuti Esclusivi",
        desc: "Show in diretta, video e contenuti di creator che non troverai da nessun'altra parte. Fatto dalla community, per la community.",
      },
      {
        title: "La Tua Gente",
        desc: "Connettiti in stanze hangout private, scopri i membri vicino a te e scrivi DM liberamente. Niente algoritmi, niente giudizi.",
      },
    ] as const,

    comparePlansLabel: "Confronta i piani",

    colFree: "Gratuito",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mese",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mese",

    comparisonRows: [
      "Feed social",
      "Post nel feed principale",
      "Accesso al bot Telegram",
      "Crea un profilo",
      "Sfoglia i profili dei membri",
      "Stanze hangout private",
      "Scoperta utenti nelle vicinanze",
      "DM con qualsiasi membro",
      "Libreria video esclusiva",
      "Contenuti solo per creator",
      "Accesso ai live stream",
      "Supporto prioritario",
    ] as const,

    choosePlanLabel: "Scegli il tuo piano",

    freePlanName: "Gratuito",
    freePlanPrice: "$0",
    freePlanPeriod: "per sempre",
    freePlanFeatures: [
      "Crea il tuo profilo",
      "Sfoglia il feed social",
      "Accesso al bot Telegram",
      "Accesso base alla community",
    ] as const,
    freePlanCta: "Unisciti Gratis",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mese",
    memberPlanPeriod: "fatturato mensilmente",
    memberPlanFeatures: [
      "Tutto del piano Gratuito",
      "Stanze hangout private",
      "Vedi tutti i profili dei membri",
      "Scoperta utenti nelle vicinanze",
      "DM illimitati",
    ] as const,
    memberPlanCta: "Diventa Member",

    primePlanName: "PRIME",
    primePlanBestValue: "MIGLIOR VALORE",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mese",
    primePlanPeriod: "fatturato mensilmente \u00b7 cancella in qualsiasi momento",
    primePlanFeatures: [
      "Tutto del piano Member",
      "Libreria video esclusiva",
      "Contenuti solo per creator",
      "Accesso ai live stream",
      "Supporto prioritario",
      "Status VIP nella community",
    ] as const,
    primePlanCta: "Diventa PRIME",

    longerPlansTitle: "Risparmia di più con piani più lunghi",
    longerPlansDesc: "Crystal PRIME (6 mesi) \u00b7 Diamond PRIME (1 anno) \u00b7 PRIME a Vita",
    longerPlansSeeAll: "Vedi tutti",

    meetCreatorsLabel: "Incontra i creator",

    stats: [
      { stat: "4.400+", label: "Membri nel mondo" },
      { stat: "1.200+", label: "Iscritti questo mese" },
      { stat: "100%", label: "Privato e verificato" },
    ] as const,

    bottomCtaHeadlinePart1: "Pronto a",
    bottomCtaHeadlinePart2: "trovare la tua gente?",
    bottomCtaBody: "Inizia gratis. Fai upgrade quando vuoi. Cancella in qualsiasi momento.",

    footerAdults: "Solo per adulti dai 18 anni in su",
    footerTerms: "Termini di Servizio",
    footerPrivacy: "Informativa sulla Privacy",
    footerSupport: "Supporto",
  },

  tr: {
    pageTitle: "PNPtv!'e Katıl \u2014 Queer PNP Topluluğu",
    metaDescription: "PNPtv!'e katıl \u2014 party & play için özel queer topluluğu. Bağlan, özel içerikleri keşfet ve insanlarını bul. Ücretsiz katıl.",
    ogDescription: "4.000+ üye. Özel hangoutlar. Özel içerikler. Ücretsiz katıl veya PRIME ol.",

    openApp: "Uygulamayı Aç",
    signIn: "Giriş Yap",
    joinNow: "Şimdi Katıl",

    heroBadge: "Özel queer PNP topluluğu",

    heroHeadlinePart1: "İnsanların",
    heroHeadlinePart2: "zaten burada.",

    heroBody: "PNPtv!, queer party & play topluluğu için özel bir dijital alan. Bağlan, keşfet ve ait ol \u2014 kendi şartlarınla.",

    heroStatsMembersTemplate: "{count}+ üye",
    heroStatsJoinedTemplate: "Bu ay {count}+ katıldı",

    getPrimeCta: "PRIME Ol \u2014 $24.99/ay",
    joinFreeCta: "Ücretsiz Katıl",
    noCreditCard: "Ücretsiz katılmak için kredi kartı gerekmez. İstediğin zaman iptal et.",

    whatIsPnptvLabel: "PNPtv! nedir?",
    whatIsCards: [
      {
        title: "Özel ve Güvenli",
        desc: "Doğrulanmış bir topluluk \u2014 yabancı yok. Her üye Telegram üzerinden giriş yaparak alanın gerçek kalmasını sağlar.",
      },
      {
        title: "Özel İçerik",
        desc: "Başka hiçbir yerde bulamayacağın canlı şovlar, videolar ve yaratıcı içerikler. Topluluk tarafından, topluluk için.",
      },
      {
        title: "İnsanların",
        desc: "Özel hangout odalarında bağlan, yakındaki üyeleri keşfet ve özgürce DM gönder. Algoritma yok, yargılama yok.",
      },
    ] as const,

    comparePlansLabel: "Planları karşılaştır",

    colFree: "Ücretsiz",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/ay",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/ay",

    comparisonRows: [
      "Sosyal akış",
      "Ana akışta gönderiler",
      "Telegram bot erişimi",
      "Profil oluştur",
      "Üye profillerine göz at",
      "Özel hangout odaları",
      "Yakındaki kullanıcıları keşfet",
      "Herhangi bir üyeyle DM",
      "Özel video kütüphanesi",
      "Yalnızca yaratıcıya özel içerik",
      "Canlı yayın erişimi",
      "Öncelikli destek",
    ] as const,

    choosePlanLabel: "Planını seç",

    freePlanName: "Ücretsiz",
    freePlanPrice: "$0",
    freePlanPeriod: "sonsuza kadar",
    freePlanFeatures: [
      "Profilini oluştur",
      "Sosyal akışı keşfet",
      "Telegram bot erişimi",
      "Temel topluluk erişimi",
    ] as const,
    freePlanCta: "Ücretsiz Katıl",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/ay",
    memberPlanPeriod: "aylık faturalandırılır",
    memberPlanFeatures: [
      "Ücretsiz plandaki her şey",
      "Özel hangout odaları",
      "Tüm üye profillerine göz at",
      "Yakındaki kullanıcıları keşfet",
      "Sınırsız DM",
    ] as const,
    memberPlanCta: "Member Ol",

    primePlanName: "PRIME",
    primePlanBestValue: "EN İYİ DEĞER",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/ay",
    primePlanPeriod: "aylık faturalandırılır \u00b7 istediğin zaman iptal et",
    primePlanFeatures: [
      "Member planındaki her şey",
      "Özel video kütüphanesi",
      "Yalnızca yaratıcıya özel içerik",
      "Canlı yayın erişimi",
      "Öncelikli destek",
      "VIP topluluk statüsü",
    ] as const,
    primePlanCta: "PRIME Ol",

    longerPlansTitle: "Daha uzun planlarla daha fazla tasarruf et",
    longerPlansDesc: "Crystal PRIME (6 ay) \u00b7 Diamond PRIME (1 yıl) \u00b7 Ömür Boyu PRIME",
    longerPlansSeeAll: "Tümünü gör",

    meetCreatorsLabel: "Yaratıcılarla tanış",

    stats: [
      { stat: "4.400+", label: "Dünya genelinde üye" },
      { stat: "1.200+", label: "Bu ay katıldı" },
      { stat: "100%", label: "Özel ve doğrulanmış" },
    ] as const,

    bottomCtaHeadlinePart1: "İnsanlarını",
    bottomCtaHeadlinePart2: "bulmaya hazır mısın?",
    bottomCtaBody: "Ücretsiz başla. İstediğinde yükselt. İstediğinde iptal et.",

    footerAdults: "Yalnızca 18 yaş ve üzeri yetişkinler için",
    footerTerms: "Hizmet Şartları",
    footerPrivacy: "Gizlilik Politikası",
    footerSupport: "Destek",
  },

  ru: {
    pageTitle: "Присоединиться к PNPtv! \u2014 Квир-сообщество PNP",
    metaDescription: "Присоединяйтесь к PNPtv! \u2014 приватному квир-сообществу для party & play. Общайтесь, исследуйте эксклюзивный контент и находите своих. Бесплатно.",
    ogDescription: "4 000+ участников. Приватные hangout'ы. Эксклюзивный контент. Вступайте бесплатно или становитесь PRIME.",

    openApp: "Открыть приложение",
    signIn: "Войти",
    joinNow: "Вступить",

    heroBadge: "Приватное квир-сообщество PNP",

    heroHeadlinePart1: "Твои люди уже",
    heroHeadlinePart2: "здесь.",

    heroBody: "PNPtv! — приватное цифровое пространство для квир-сообщества party & play. Общайся, исследуй и будь собой \u2014 на своих условиях.",

    heroStatsMembersTemplate: "{count}+ участников",
    heroStatsJoinedTemplate: "{count}+ вступили в этом месяце",

    getPrimeCta: "Стать PRIME \u2014 $24.99/мес",
    joinFreeCta: "Вступить бесплатно",
    noCreditCard: "Для бесплатного входа карта не нужна. Отмените в любой момент.",

    whatIsPnptvLabel: "Что такое PNPtv!?",
    whatIsCards: [
      {
        title: "Приватно и безопасно",
        desc: "Верифицированное сообщество \u2014 никаких случайных людей. Каждый участник проходит проверку через Telegram.",
      },
      {
        title: "Эксклюзивный контент",
        desc: "Живые шоу, видео и контент от авторов, которого не найти нигде больше. Сделано сообществом, для сообщества.",
      },
      {
        title: "Твои люди",
        desc: "Общайся в приватных hangout-комнатах, находи участников рядом и пиши DM без ограничений. Без алгоритмов, без осуждения.",
      },
    ] as const,

    comparePlansLabel: "Сравнить планы",

    colFree: "Бесплатно",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/мес",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/мес",

    comparisonRows: [
      "Социальная лента",
      "Публикации в главной ленте",
      "Доступ к боту Telegram",
      "Создание профиля",
      "Просмотр профилей участников",
      "Приватные hangout-комнаты",
      "Поиск участников рядом",
      "DM с любым участником",
      "Эксклюзивная видеотека",
      "Контент только для авторов",
      "Доступ к прямым трансляциям",
      "Приоритетная поддержка",
    ] as const,

    choosePlanLabel: "Выбери свой план",

    freePlanName: "Бесплатно",
    freePlanPrice: "$0",
    freePlanPeriod: "навсегда",
    freePlanFeatures: [
      "Создай свой профиль",
      "Изучи социальную ленту",
      "Доступ к боту Telegram",
      "Базовый доступ к сообществу",
    ] as const,
    freePlanCta: "Вступить бесплатно",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/мес",
    memberPlanPeriod: "оплата ежемесячно",
    memberPlanFeatures: [
      "Всё из бесплатного плана",
      "Приватные hangout-комнаты",
      "Просмотр всех профилей",
      "Поиск участников рядом",
      "Безлимитные DM",
    ] as const,
    memberPlanCta: "Стать Member",

    primePlanName: "PRIME",
    primePlanBestValue: "ЛУЧШАЯ ЦЕНА",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/мес",
    primePlanPeriod: "оплата ежемесячно \u00b7 отмена в любой момент",
    primePlanFeatures: [
      "Всё из плана Member",
      "Эксклюзивная видеотека",
      "Контент только для авторов",
      "Доступ к прямым трансляциям",
      "Приоритетная поддержка",
      "VIP-статус в сообществе",
    ] as const,
    primePlanCta: "Стать PRIME",

    longerPlansTitle: "Экономь больше с долгосрочными планами",
    longerPlansDesc: "Crystal PRIME (6 мес) \u00b7 Diamond PRIME (1 год) \u00b7 Пожизненный PRIME",
    longerPlansSeeAll: "Смотреть все",

    meetCreatorsLabel: "Познакомься с авторами",

    stats: [
      { stat: "4 400+", label: "Участников по всему миру" },
      { stat: "1 200+", label: "Вступили в этом месяце" },
      { stat: "100%", label: "Приватно и верифицировано" },
    ] as const,

    bottomCtaHeadlinePart1: "Готов",
    bottomCtaHeadlinePart2: "найти своих людей?",
    bottomCtaBody: "Начни бесплатно. Обновляй когда угодно. Отменяй в любой момент.",

    footerAdults: "Только для совершеннолетних от 18 лет",
    footerTerms: "Условия использования",
    footerPrivacy: "Политика конфиденциальности",
    footerSupport: "Поддержка",
  },

  nl: {
    pageTitle: "Word lid van PNPtv! \u2014 De Queer PNP-Community",
    metaDescription: "Word lid van PNPtv! \u2014 de privé queer community voor party & play. Verbind, verken exclusieve content en vind je mensen. Gratis.",
    ogDescription: "4.000+ leden. Privé hangouts. Exclusieve content. Word gratis lid of ga PRIME.",

    openApp: "App openen",
    signIn: "Inloggen",
    joinNow: "Nu Lid Worden",

    heroBadge: "De privé queer PNP-community",

    heroHeadlinePart1: "Jouw mensen zijn",
    heroHeadlinePart2: "er al.",

    heroBody: "PNPtv! is de privé digitale ruimte voor de queer party & play-community. Verbind, verken en hoor erbij \u2014 op jouw manier.",

    heroStatsMembersTemplate: "{count}+ leden",
    heroStatsJoinedTemplate: "{count}+ deze maand toegetreden",

    getPrimeCta: "Word PRIME \u2014 $24.99/mnd",
    joinFreeCta: "Gratis Lid Worden",
    noCreditCard: "Geen creditcard nodig om gratis lid te worden. Op elk moment opzegbaar.",

    whatIsPnptvLabel: "Wat is PNPtv!?",
    whatIsCards: [
      {
        title: "Privé en Veilig",
        desc: "Een geverifieerde community \u2014 geen vreemden. Elk lid treedt toe via Telegram zodat de ruimte echt blijft.",
      },
      {
        title: "Exclusieve Content",
        desc: "Live shows, video's en creatorcontent die je nergens anders vindt. Gemaakt door de community, voor de community.",
      },
      {
        title: "Jouw Mensen",
        desc: "Verbind in privé hangoutkamers, ontdek leden in de buurt en stuur vrij DM's. Geen algoritmen, geen oordelen.",
      },
    ] as const,

    comparePlansLabel: "Plannen vergelijken",

    colFree: "Gratis",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/mnd",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/mnd",

    comparisonRows: [
      "Sociale feed",
      "Posts in de hoofdfeed",
      "Telegram-bot toegang",
      "Maak een profiel",
      "Bekijk ledenprofielen",
      "Privé hangoutkamers",
      "Ontdek gebruikers in de buurt",
      "DM's met elk lid",
      "Exclusieve videobibliotheek",
      "Alleen-creator content",
      "Toegang tot livestreams",
      "Prioriteitsondersteuning",
    ] as const,

    choosePlanLabel: "Kies je plan",

    freePlanName: "Gratis",
    freePlanPrice: "$0",
    freePlanPeriod: "voor altijd",
    freePlanFeatures: [
      "Maak je profiel aan",
      "Verken de sociale feed",
      "Telegram-bot toegang",
      "Basis communitytogang",
    ] as const,
    freePlanCta: "Gratis Lid Worden",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/mnd",
    memberPlanPeriod: "maandelijks gefactureerd",
    memberPlanFeatures: [
      "Alles uit het gratis plan",
      "Privé hangoutkamers",
      "Alle ledenprofielen bekijken",
      "Gebruikers in de buurt ontdekken",
      "Onbeperkte DM's",
    ] as const,
    memberPlanCta: "Word Member",

    primePlanName: "PRIME",
    primePlanBestValue: "BESTE WAARDE",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/mnd",
    primePlanPeriod: "maandelijks gefactureerd \u00b7 op elk moment opzegbaar",
    primePlanFeatures: [
      "Alles uit het Member-plan",
      "Exclusieve videobibliotheek",
      "Alleen-creator content",
      "Toegang tot livestreams",
      "Prioriteitsondersteuning",
      "VIP-communitystatus",
    ] as const,
    primePlanCta: "Word PRIME",

    longerPlansTitle: "Bespaar meer met langere plannen",
    longerPlansDesc: "Crystal PRIME (6 mnd) \u00b7 Diamond PRIME (1 jaar) \u00b7 Lifetime PRIME",
    longerPlansSeeAll: "Alles bekijken",

    meetCreatorsLabel: "Maak kennis met de creators",

    stats: [
      { stat: "4.400+", label: "Leden wereldwijd" },
      { stat: "1.200+", label: "Deze maand toegetreden" },
      { stat: "100%", label: "Privé en geverifieerd" },
    ] as const,

    bottomCtaHeadlinePart1: "Klaar om",
    bottomCtaHeadlinePart2: "je mensen te vinden?",
    bottomCtaBody: "Begin gratis. Upgrade wanneer je wilt. Zeg op elk moment op.",

    footerAdults: "Alleen voor volwassenen van 18 jaar en ouder",
    footerTerms: "Servicevoorwaarden",
    footerPrivacy: "Privacybeleid",
    footerSupport: "Ondersteuning",
  },

  vi: {
    pageTitle: "Tham gia PNPtv! \u2014 Cộng đồng Queer PNP",
    metaDescription: "Tham gia PNPtv! \u2014 cộng đồng queer riêng tư dành cho party & play. Kết nối, khám phá nội dung độc quyền và tìm thấy những người như bạn. Miễn phí.",
    ogDescription: "Hơn 4.000 thành viên. Hangouts riêng tư. Nội dung độc quyền. Tham gia miễn phí hoặc nâng cấp PRIME.",

    openApp: "Mở App",
    signIn: "Đăng Nhập",
    joinNow: "Tham Gia Ngay",

    heroBadge: "Cộng đồng queer PNP riêng tư",

    heroHeadlinePart1: "Những người của bạn",
    heroHeadlinePart2: "đã ở đây rồi.",

    heroBody: "PNPtv! là không gian số riêng tư dành cho cộng đồng queer party & play. Kết nối, khám phá và thuộc về nơi này \u2014 theo cách của bạn.",

    heroStatsMembersTemplate: "{count}+ thành viên",
    heroStatsJoinedTemplate: "{count}+ đã tham gia tháng này",

    getPrimeCta: "Trở thành PRIME \u2014 $24.99/tháng",
    joinFreeCta: "Tham Gia Miễn Phí",
    noCreditCard: "Không cần thẻ tín dụng để tham gia miễn phí. Hủy bất cứ lúc nào.",

    whatIsPnptvLabel: "PNPtv! là gì?",
    whatIsCards: [
      {
        title: "Riêng tư và An toàn",
        desc: "Cộng đồng được xác minh \u2014 không có người lạ. Mỗi thành viên tham gia qua Telegram để không gian luôn thực sự.",
      },
      {
        title: "Nội dung Độc quyền",
        desc: "Show trực tiếp, video và nội dung từ nhà sáng tạo mà bạn không tìm thấy ở đâu khác. Được tạo bởi cộng đồng, cho cộng đồng.",
      },
      {
        title: "Người của Bạn",
        desc: "Kết nối trong các phòng hangout riêng tư, khám phá thành viên gần bạn và nhắn tin DM tự do. Không thuật toán, không phán xét.",
      },
    ] as const,

    comparePlansLabel: "So sánh các gói",

    colFree: "Miễn phí",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/tháng",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/tháng",

    comparisonRows: [
      "Bảng tin xã hội",
      "Bài đăng trên bảng tin chính",
      "Truy cập Telegram bot",
      "Tạo hồ sơ",
      "Xem hồ sơ thành viên",
      "Phòng hangout riêng tư",
      "Khám phá người dùng lân cận",
      "Nhắn tin DM với bất kỳ thành viên",
      "Thư viện video độc quyền",
      "Nội dung dành riêng cho nhà sáng tạo",
      "Truy cập livestream",
      "Hỗ trợ ưu tiên",
    ] as const,

    choosePlanLabel: "Chọn gói của bạn",

    freePlanName: "Miễn phí",
    freePlanPrice: "$0",
    freePlanPeriod: "mãi mãi",
    freePlanFeatures: [
      "Tạo hồ sơ của bạn",
      "Khám phá bảng tin xã hội",
      "Truy cập Telegram bot",
      "Truy cập cộng đồng cơ bản",
    ] as const,
    freePlanCta: "Tham Gia Miễn Phí",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/tháng",
    memberPlanPeriod: "thanh toán hàng tháng",
    memberPlanFeatures: [
      "Tất cả từ gói Miễn phí",
      "Phòng hangout riêng tư",
      "Xem tất cả hồ sơ thành viên",
      "Khám phá người dùng lân cận",
      "Nhắn tin DM không giới hạn",
    ] as const,
    memberPlanCta: "Trở thành Member",

    primePlanName: "PRIME",
    primePlanBestValue: "GIÁ TRỊ NHẤT",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/tháng",
    primePlanPeriod: "thanh toán hàng tháng \u00b7 hủy bất cứ lúc nào",
    primePlanFeatures: [
      "Tất cả từ gói Member",
      "Thư viện video độc quyền",
      "Nội dung dành riêng cho nhà sáng tạo",
      "Truy cập livestream",
      "Hỗ trợ ưu tiên",
      "Trạng thái VIP trong cộng đồng",
    ] as const,
    primePlanCta: "Trở thành PRIME",

    longerPlansTitle: "Tiết kiệm hơn với gói dài hạn",
    longerPlansDesc: "Crystal PRIME (6 tháng) \u00b7 Diamond PRIME (1 năm) \u00b7 PRIME trọn đời",
    longerPlansSeeAll: "Xem tất cả",

    meetCreatorsLabel: "Gặp gỡ các nhà sáng tạo",

    stats: [
      { stat: "4.400+", label: "Thành viên toàn cầu" },
      { stat: "1.200+", label: "Tham gia tháng này" },
      { stat: "100%", label: "Riêng tư và đã xác minh" },
    ] as const,

    bottomCtaHeadlinePart1: "Sẵn sàng",
    bottomCtaHeadlinePart2: "tìm thấy người của bạn chưa?",
    bottomCtaBody: "Bắt đầu miễn phí. Nâng cấp bất cứ khi nào bạn muốn. Hủy bất cứ lúc nào.",

    footerAdults: "Chỉ dành cho người trưởng thành từ 18 tuổi trở lên",
    footerTerms: "Điều khoản Dịch vụ",
    footerPrivacy: "Chính sách Bảo mật",
    footerSupport: "Hỗ trợ",
  },

  ja: {
    pageTitle: "PNPtv! に参加する \u2014 クィア PNP コミュニティ",
    metaDescription: "PNPtv! に参加しよう \u2014 party & play のためのプライベートなクィアコミュニティ。つながり、限定コンテンツを楽しみ、仲間を見つけよう。無料。",
    ogDescription: "4,000人以上のメンバー。プライベートなハングアウト。限定コンテンツ。無料で参加、またはPRIMEにアップグレード。",

    openApp: "アプリを開く",
    signIn: "ログイン",
    joinNow: "今すぐ参加",

    heroBadge: "プライベートなクィア PNP コミュニティ",

    heroHeadlinePart1: "あなたの仲間は",
    heroHeadlinePart2: "もうここにいる。",

    heroBody: "PNPtv! は、クィア party & play コミュニティのためのプライベートなデジタルスペースです。つながり、探索し、自分らしくいよう \u2014 あなたのやり方で。",

    heroStatsMembersTemplate: "{count}人以上のメンバー",
    heroStatsJoinedTemplate: "今月{count}人以上が参加",

    getPrimeCta: "PRIME になる \u2014 $24.99/月",
    joinFreeCta: "無料で参加",
    noCreditCard: "無料参加にクレジットカード不要。いつでもキャンセル可能。",

    whatIsPnptvLabel: "PNPtv! とは？",
    whatIsCards: [
      {
        title: "プライベートで安全",
        desc: "認証済みコミュニティ \u2014 見知らぬ人はいません。すべてのメンバーがTelegramを通じて参加し、スペースの真正性を保ちます。",
      },
      {
        title: "限定コンテンツ",
        desc: "ライブショー、動画、クリエイターコンテンツ \u2014 他では見つからないもの。コミュニティにより、コミュニティのために。",
      },
      {
        title: "あなたの仲間",
        desc: "プライベートなハングアウトルームでつながり、近くのメンバーを見つけ、自由にDMを送ろう。アルゴリズムなし、偏見なし。",
      },
    ] as const,

    comparePlansLabel: "プランを比較",

    colFree: "無料",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/月",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/月",

    comparisonRows: [
      "ソーシャルフィード",
      "ホームフィードの投稿",
      "Telegram ボットアクセス",
      "プロフィール作成",
      "メンバープロフィール閲覧",
      "プライベートハングアウトルーム",
      "近くのユーザー検索",
      "任意のメンバーへのDM",
      "限定動画ライブラリ",
      "クリエイター限定コンテンツ",
      "ライブストリームアクセス",
      "優先サポート",
    ] as const,

    choosePlanLabel: "プランを選択",

    freePlanName: "無料",
    freePlanPrice: "$0",
    freePlanPeriod: "永久",
    freePlanFeatures: [
      "プロフィールを作成",
      "ソーシャルフィードを探索",
      "Telegram ボットアクセス",
      "基本コミュニティアクセス",
    ] as const,
    freePlanCta: "無料で参加",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/月",
    memberPlanPeriod: "月額課金",
    memberPlanFeatures: [
      "無料プランのすべてを含む",
      "プライベートハングアウトルーム",
      "すべてのメンバープロフィールを閲覧",
      "近くのユーザー検索",
      "DM無制限",
    ] as const,
    memberPlanCta: "Member になる",

    primePlanName: "PRIME",
    primePlanBestValue: "最もお得",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/月",
    primePlanPeriod: "月額課金 \u00b7 いつでもキャンセル可能",
    primePlanFeatures: [
      "Member プランのすべてを含む",
      "限定動画ライブラリ",
      "クリエイター限定コンテンツ",
      "ライブストリームアクセス",
      "優先サポート",
      "VIPコミュニティステータス",
    ] as const,
    primePlanCta: "PRIME になる",

    longerPlansTitle: "長期プランでさらにお得に",
    longerPlansDesc: "Crystal PRIME（6ヶ月）\u00b7 Diamond PRIME（1年）\u00b7 生涯PRIME",
    longerPlansSeeAll: "すべて見る",

    meetCreatorsLabel: "クリエイターと出会おう",

    stats: [
      { stat: "4,400人+", label: "世界中のメンバー" },
      { stat: "1,200人+", label: "今月参加" },
      { stat: "100%", label: "プライベートで認証済み" },
    ] as const,

    bottomCtaHeadlinePart1: "あなたの仲間を",
    bottomCtaHeadlinePart2: "見つける準備はできた？",
    bottomCtaBody: "無料で始めよう。いつでもアップグレード。いつでもキャンセル。",

    footerAdults: "18歳以上の方のみ",
    footerTerms: "利用規約",
    footerPrivacy: "プライバシーポリシー",
    footerSupport: "サポート",
  },

  id: {
    pageTitle: "Bergabung dengan PNPtv! \u2014 Komunitas Queer PNP",
    metaDescription: "Bergabunglah dengan PNPtv! \u2014 komunitas queer privat untuk party & play. Terhubung, jelajahi konten eksklusif, dan temukan orang-orangmu. Gratis.",
    ogDescription: "4.000+ anggota. Hangout privat. Konten eksklusif. Bergabung gratis atau jadilah PRIME.",

    openApp: "Buka App",
    signIn: "Masuk",
    joinNow: "Bergabung Sekarang",

    heroBadge: "Komunitas queer PNP privat",

    heroHeadlinePart1: "Orang-orangmu sudah",
    heroHeadlinePart2: "ada di sini.",

    heroBody: "PNPtv! adalah ruang digital privat untuk komunitas queer party & play. Terhubung, jelajahi, dan menjadi bagian \u2014 dengan caramu sendiri.",

    heroStatsMembersTemplate: "{count}+ anggota",
    heroStatsJoinedTemplate: "{count}+ bergabung bulan ini",

    getPrimeCta: "Jadi PRIME \u2014 $24.99/bln",
    joinFreeCta: "Bergabung Gratis",
    noCreditCard: "Tidak perlu kartu kredit untuk bergabung gratis. Batalkan kapan saja.",

    whatIsPnptvLabel: "Apa itu PNPtv!?",
    whatIsCards: [
      {
        title: "Privat & Aman",
        desc: "Komunitas terverifikasi \u2014 tanpa orang asing. Setiap anggota masuk melalui Telegram agar ruang ini tetap nyata.",
      },
      {
        title: "Konten Eksklusif",
        desc: "Live show, video, dan konten kreator yang tidak akan kamu temukan di tempat lain. Dibuat oleh komunitas, untuk komunitas.",
      },
      {
        title: "Orang-orangmu",
        desc: "Terhubung di ruang hangout privat, temukan anggota terdekat, dan kirim DM bebas. Tanpa algoritma, tanpa penilaian.",
      },
    ] as const,

    comparePlansLabel: "Bandingkan paket",

    colFree: "Gratis",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/bln",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/bln",

    comparisonRows: [
      "Feed sosial",
      "Postingan di feed utama",
      "Akses Telegram bot",
      "Buat profil",
      "Telusuri profil anggota",
      "Ruang hangout privat",
      "Temukan pengguna terdekat",
      "DM dengan anggota mana saja",
      "Perpustakaan video eksklusif",
      "Konten khusus kreator",
      "Akses live stream",
      "Dukungan prioritas",
    ] as const,

    choosePlanLabel: "Pilih paketmu",

    freePlanName: "Gratis",
    freePlanPrice: "$0",
    freePlanPeriod: "selamanya",
    freePlanFeatures: [
      "Buat profilmu",
      "Telusuri feed sosial",
      "Akses Telegram bot",
      "Akses komunitas dasar",
    ] as const,
    freePlanCta: "Bergabung Gratis",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/bln",
    memberPlanPeriod: "ditagih bulanan",
    memberPlanFeatures: [
      "Semua dari paket Gratis",
      "Ruang hangout privat",
      "Lihat semua profil anggota",
      "Temukan pengguna terdekat",
      "DM tanpa batas",
    ] as const,
    memberPlanCta: "Jadi Member",

    primePlanName: "PRIME",
    primePlanBestValue: "NILAI TERBAIK",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/bln",
    primePlanPeriod: "ditagih bulanan \u00b7 batalkan kapan saja",
    primePlanFeatures: [
      "Semua dari paket Member",
      "Perpustakaan video eksklusif",
      "Konten khusus kreator",
      "Akses live stream",
      "Dukungan prioritas",
      "Status VIP di komunitas",
    ] as const,
    primePlanCta: "Jadi PRIME",

    longerPlansTitle: "Hemat lebih banyak dengan paket lebih panjang",
    longerPlansDesc: "Crystal PRIME (6 bln) \u00b7 Diamond PRIME (1 thn) \u00b7 PRIME Seumur Hidup",
    longerPlansSeeAll: "Lihat semua",

    meetCreatorsLabel: "Kenali para kreator",

    stats: [
      { stat: "4.400+", label: "Anggota di seluruh dunia" },
      { stat: "1.200+", label: "Bergabung bulan ini" },
      { stat: "100%", label: "Privat & terverifikasi" },
    ] as const,

    bottomCtaHeadlinePart1: "Siap untuk",
    bottomCtaHeadlinePart2: "menemukan orang-orangmu?",
    bottomCtaBody: "Mulai gratis. Upgrade kapan saja. Batalkan kapan saja.",

    footerAdults: "Hanya untuk dewasa 18 tahun ke atas",
    footerTerms: "Ketentuan Layanan",
    footerPrivacy: "Kebijakan Privasi",
    footerSupport: "Dukungan",
  },

  ar: {
    pageTitle: "انضم إلى PNPtv! \u2014 مجتمع Queer PNP",
    metaDescription: "انضم إلى PNPtv! \u2014 المجتمع الخاص للـ queer من محبي party & play. تواصل، استكشف محتوى حصرياً، وابحث عن ناسك. مجاناً.",
    ogDescription: "أكثر من 4,000 عضو. Hangouts خاصة. محتوى حصري. انضم مجاناً أو كن PRIME.",

    openApp: "فتح التطبيق",
    signIn: "تسجيل الدخول",
    joinNow: "انضم الآن",

    heroBadge: "المجتمع الخاص للـ queer PNP",

    heroHeadlinePart1: "ناسك موجودون",
    heroHeadlinePart2: "هنا بالفعل.",

    heroBody: "PNPtv! هو المساحة الرقمية الخاصة لمجتمع queer لـ party & play. تواصل واستكشف وانتمِ \u2014 بشروطك أنت.",

    heroStatsMembersTemplate: "أكثر من {count} عضو",
    heroStatsJoinedTemplate: "انضم {count}+ هذا الشهر",

    getPrimeCta: "احصل على PRIME \u2014 $24.99/شهر",
    joinFreeCta: "انضم مجاناً",
    noCreditCard: "لا حاجة لبطاقة ائتمان للانضمام مجاناً. يمكنك الإلغاء في أي وقت.",

    whatIsPnptvLabel: "ما هو PNPtv!؟",
    whatIsCards: [
      {
        title: "خاص وآمن",
        desc: "مجتمع موثّق \u2014 لا غرباء. كل عضو يدخل عبر Telegram لتبقى المساحة حقيقية.",
      },
      {
        title: "محتوى حصري",
        desc: "عروض مباشرة ومقاطع فيديو ومحتوى من المبدعين لن تجده في أي مكان آخر. صُنع من المجتمع وللمجتمع.",
      },
      {
        title: "ناسك",
        desc: "تواصل في غرف hangout خاصة، اكتشف الأعضاء القريبين منك، وأرسل رسائل مباشرة بحرية. بلا خوارزميات ولا أحكام.",
      },
    ] as const,

    comparePlansLabel: "مقارنة الخطط",

    colFree: "مجاني",
    colFreePrice: "$0",
    colMember: "Member",
    colMemberPrice: "$9.99",
    colMemberPriceSuffix: "/شهر",
    colPrime: "PRIME",
    colPrimePrice: "$24.99",
    colPrimePriceSuffix: "/شهر",

    comparisonRows: [
      "التغذية الاجتماعية",
      "منشورات التغذية الرئيسية",
      "الوصول إلى Telegram bot",
      "إنشاء ملف شخصي",
      "تصفح ملفات الأعضاء",
      "غرف hangout خاصة",
      "اكتشاف المستخدمين القريبين",
      "رسائل مباشرة مع أي عضو",
      "مكتبة فيديو حصرية",
      "محتوى المبدعين فقط",
      "الوصول إلى البث المباشر",
      "دعم ذو أولوية",
    ] as const,

    choosePlanLabel: "اختر خطتك",

    freePlanName: "مجاني",
    freePlanPrice: "$0",
    freePlanPeriod: "إلى الأبد",
    freePlanFeatures: [
      "أنشئ ملفك الشخصي",
      "تصفح التغذية الاجتماعية",
      "الوصول إلى Telegram bot",
      "الوصول الأساسي للمجتمع",
    ] as const,
    freePlanCta: "انضم مجاناً",

    memberPlanName: "Member",
    memberPlanPrice: "$9.99",
    memberPlanPriceSuffix: "/شهر",
    memberPlanPeriod: "يُحسب شهرياً",
    memberPlanFeatures: [
      "كل ما في الخطة المجانية",
      "غرف hangout خاصة",
      "عرض جميع ملفات الأعضاء",
      "اكتشاف المستخدمين القريبين",
      "رسائل مباشرة غير محدودة",
    ] as const,
    memberPlanCta: "احصل على Member",

    primePlanName: "PRIME",
    primePlanBestValue: "أفضل قيمة",
    primePlanPrice: "$24.99",
    primePlanPriceSuffix: "/شهر",
    primePlanPeriod: "يُحسب شهرياً \u00b7 ألغِ في أي وقت",
    primePlanFeatures: [
      "كل ما في خطة Member",
      "مكتبة فيديو حصرية",
      "محتوى المبدعين فقط",
      "الوصول إلى البث المباشر",
      "دعم ذو أولوية",
      "مكانة VIP في المجتمع",
    ] as const,
    primePlanCta: "احصل على PRIME",

    longerPlansTitle: "وفّر أكثر مع الخطط الطويلة",
    longerPlansDesc: "Crystal PRIME (6 أشهر) \u00b7 Diamond PRIME (سنة) \u00b7 PRIME مدى الحياة",
    longerPlansSeeAll: "عرض الكل",

    meetCreatorsLabel: "تعرّف على المبدعين",

    stats: [
      { stat: "+4,400", label: "عضو حول العالم" },
      { stat: "+1,200", label: "انضموا هذا الشهر" },
      { stat: "100%", label: "خاص وموثّق" },
    ] as const,

    bottomCtaHeadlinePart1: "مستعد",
    bottomCtaHeadlinePart2: "لإيجاد ناسك؟",
    bottomCtaBody: "ابدأ مجاناً. ارقَّ في أي وقت. ألغِ في أي وقت.",

    footerAdults: "للبالغين من عمر 18 فأكثر فقط",
    footerTerms: "شروط الخدمة",
    footerPrivacy: "سياسة الخصوصية",
    footerSupport: "الدعم",
  },
} as const;

export type JoinStrings = typeof strings.en;
export { strings as join };
