const strings = {
  en: {
    // <title> / meta
    pageTitle: "Welcome \u2014 PNPtv!",
    metaDescription: "Welcome to PNPtv! Explore all features: Media, Hangouts, Live, Social Feed, Nearby, and more.",

    // Hero section
    // Greeting uses the member's display name — use a template token
    welcomeGreeting: "Welcome, {name}!",
    heroBody: "Your membership is active. Here\u2019s everything you can do on PNPtv \u2014 explore each feature below to get started.",

    // Membership badges
    primeActiveBadge: "PRIME Active",
    memberActiveBadge: "Member Active",

    // Community Rules section
    communityRulesTitle: "Community Rules",
    ageRequirementLabel: "18+",
    ageRequirementText: "You must be 18 years or older to use PNPtv! By continuing to use this platform, you confirm that you are at least 18 years of age.",
    prohibitedContentTitle: "The following content is strictly prohibited:",
    prohibitedItems: [
      "Content involving minors in any context",
      "Non-consensual content or any form of coercion",
      "Harassment, threats, doxxing, or hate speech",
      "Illegal drug sales, trafficking, or solicitation",
      "Spam, scams, phishing, or impersonation",
      "Sharing private content without the owner\u2019s consent",
    ] as const,
    violationsNote:
      "Violations will result in immediate account termination and will be reported to the appropriate authorities. We actively monitor content and cooperate fully with law enforcement. By using PNPtv!, you agree to abide by these rules.",
    violationsImmediateTermination: "immediate account termination",
    violationsReportedAuthorities: "reported to the appropriate authorities",

    // Feature cards (8 cards — title + desc only; icons are emoji literals in source)
    exploreFeaturesHeading: "Explore Features",
    featureCards: [
      {
        title: "Media",
        desc: "Videos, music, and podcasts. Browse exclusive PRIME content and create your own playlists.",
      },
      {
        title: "Hangouts",
        desc: "Community video call rooms. Join public groups or create private hangouts with friends.",
      },
      {
        title: "PNP Live",
        desc: "Live streams and exclusive recordings. Watch shows in real time and send tips.",
      },
      {
        title: "Social Feed",
        desc: "Post content, like, repost, and comment. Connect with the community.",
      },
      {
        title: "PNP Connect",
        desc: "Discover members and venues near you. Enable location to see who\u2019s around.",
      },
      {
        title: "Direct Messages",
        desc: "Send private messages to any member. Share text, images, and videos.",
      },
      {
        title: "Profile",
        desc: "Customize your profile with themes, badges, and bio. Connect Bluesky or X.",
      },
      {
        title: "PRIME Channel",
        desc: "Exclusive Telegram channel with premium content and early announcements.",
      },
    ] as const,

    // Quick start checklist
    quickStartTitle: "Quick Start Checklist",
    quickStartItems: [
      "Complete your profile with a photo and bio",
      "Explore exclusive PRIME content",
      "Join a Hangout or create your own group",
      "Publish your first post on the Social Feed",
      "Join the PRIME Telegram Channel",
    ] as const,

    // CTA buttons
    explorePnptvCta: "Explore PNPtv",
    openTelegramBotCta: "Open Telegram Bot",

    // Support footer
    needHelp: "Need help?",
    contactSupport: "Contact Support",
  },

  es: {
    pageTitle: "Bienvenido \u2014 PNPtv!",
    metaDescription: "Bienvenido a PNPtv! Explora todas las funciones: Media, Hangouts, PNP Live, Feed Social, Cerca y más.",

    welcomeGreeting: "Bienvenido, {name}!",
    heroBody: "Tu membresía está activa. Aquí tienes todo lo que puedes hacer en PNPtv \u2014 explora cada función para empezar.",

    primeActiveBadge: "PRIME Activo",
    memberActiveBadge: "Member Activo",

    communityRulesTitle: "Normas de la Comunidad",
    ageRequirementLabel: "18+",
    ageRequirementText: "Debes tener 18 años o más para usar PNPtv! Al continuar usando esta plataforma, confirmas que tienes al menos 18 años.",
    prohibitedContentTitle: "El siguiente contenido está estrictamente prohibido:",
    prohibitedItems: [
      "Contenido que involucre menores en cualquier contexto",
      "Contenido no consensual o cualquier forma de coerción",
      "Acoso, amenazas, doxxing o discurso de odio",
      "Venta ilegal de drogas, tráfico o solicitud",
      "Spam, estafas, phishing o suplantación de identidad",
      "Compartir contenido privado sin el consentimiento del dueño",
    ] as const,
    violationsNote:
      "Las infracciones resultarán en la terminación inmediata de la cuenta y serán reportadas a las autoridades correspondientes. Monitoreamos el contenido activamente y cooperamos plenamente con las fuerzas del orden. Al usar PNPtv!, aceptas cumplir estas normas.",
    violationsImmediateTermination: "terminación inmediata de la cuenta",
    violationsReportedAuthorities: "reportadas a las autoridades correspondientes",

    exploreFeaturesHeading: "Explorar Funciones",
    featureCards: [
      {
        title: "Media",
        desc: "Videos, música y podcasts. Explora contenido PRIME exclusivo y crea tus propias listas de reproducción.",
      },
      {
        title: "Hangouts",
        desc: "Salas de videollamada comunitarias. Únete a grupos públicos o crea hangouts privados con amigos.",
      },
      {
        title: "PNP Live",
        desc: "Streams en vivo y grabaciones exclusivas. Mira shows en tiempo real y envía propinas.",
      },
      {
        title: "Feed Social",
        desc: "Publica contenido, dale like, república y comenta. Conéctate con la comunidad.",
      },
      {
        title: "Cerca",
        desc: "Descubre miembros y lugares cerca de ti. Activa la ubicación para ver quién está alrededor.",
      },
      {
        title: "Mensajes Directos",
        desc: "Envía mensajes privados a cualquier miembro. Comparte texto, imágenes y videos.",
      },
      {
        title: "Perfil",
        desc: "Personaliza tu perfil con temas, badges y bio. Conecta Bluesky o X.",
      },
      {
        title: "Canal PRIME",
        desc: "Canal exclusivo de Telegram con contenido premium y anuncios anticipados.",
      },
    ] as const,

    quickStartTitle: "Lista de Inicio Rápido",
    quickStartItems: [
      "Completa tu perfil con una foto y bio",
      "Explora el contenido PRIME exclusivo",
      "Únete a un Hangout o crea tu propio grupo",
      "Publica tu primer post en el Feed Social",
      "Únete al Canal PRIME de Telegram",
    ] as const,

    explorePnptvCta: "Explorar PNPtv",
    openTelegramBotCta: "Abrir Bot de Telegram",

    needHelp: "\u00bfNecesitas ayuda?",
    contactSupport: "Contactar Soporte",
  },

  pt: {
    pageTitle: "Bem-vindo \u2014 PNPtv!",
    metaDescription: "Bem-vindo ao PNPtv! Explore todos os recursos: Mídia, Hangouts, PNP Live, Feed Social, Perto e muito mais.",

    welcomeGreeting: "Bem-vindo, {name}!",
    heroBody: "Sua assinatura está ativa. Aqui está tudo que você pode fazer no PNPtv \u2014 explore cada recurso abaixo para começar.",

    primeActiveBadge: "PRIME Ativo",
    memberActiveBadge: "Member Ativo",

    communityRulesTitle: "Regras da Comunidade",
    ageRequirementLabel: "18+",
    ageRequirementText: "Você deve ter 18 anos ou mais para usar o PNPtv! Ao continuar usando esta plataforma, você confirma ter pelo menos 18 anos.",
    prohibitedContentTitle: "O seguinte conteúdo é estritamente proibido:",
    prohibitedItems: [
      "Conteúdo envolvendo menores em qualquer contexto",
      "Conteúdo não consensual ou qualquer forma de coerção",
      "Assédio, ameaças, doxxing ou discurso de ódio",
      "Venda ilegal de drogas, tráfico ou solicitação",
      "Spam, golpes, phishing ou falsidade ideológica",
      "Compartilhar conteúdo privado sem o consentimento do proprietário",
    ] as const,
    violationsNote:
      "As violações resultarão no encerramento imediato da conta e serão reportadas às autoridades competentes. Monitoramos o conteúdo ativamente e cooperamos plenamente com as autoridades. Ao usar o PNPtv!, você concorda em seguir estas regras.",
    violationsImmediateTermination: "encerramento imediato da conta",
    violationsReportedAuthorities: "reportadas às autoridades competentes",

    exploreFeaturesHeading: "Explorar Recursos",
    featureCards: [
      {
        title: "Mídia",
        desc: "Vídeos, música e podcasts. Explore conteúdo PRIME exclusivo e crie suas próprias playlists.",
      },
      {
        title: "Hangouts",
        desc: "Salas de videochamada comunitárias. Entre em grupos públicos ou crie hangouts privados com amigos.",
      },
      {
        title: "PNP Live",
        desc: "Streams ao vivo e gravações exclusivas. Assista shows em tempo real e envie gorjetas.",
      },
      {
        title: "Feed Social",
        desc: "Publique conteúdo, curta, reposte e comente. Conecte-se com a comunidade.",
      },
      {
        title: "Perto",
        desc: "Descubra membros e locais próximos a você. Ative a localização para ver quem está por perto.",
      },
      {
        title: "Mensagens Diretas",
        desc: "Envie mensagens privadas para qualquer membro. Compartilhe texto, imagens e vídeos.",
      },
      {
        title: "Perfil",
        desc: "Personalize seu perfil com temas, badges e bio. Conecte Bluesky ou X.",
      },
      {
        title: "Canal PRIME",
        desc: "Canal exclusivo do Telegram com conteúdo premium e anúncios antecipados.",
      },
    ] as const,

    quickStartTitle: "Checklist de Início Rápido",
    quickStartItems: [
      "Complete seu perfil com foto e bio",
      "Explore o conteúdo PRIME exclusivo",
      "Entre em um Hangout ou crie seu próprio grupo",
      "Publique seu primeiro post no Feed Social",
      "Entre no Canal PRIME do Telegram",
    ] as const,

    explorePnptvCta: "Explorar PNPtv",
    openTelegramBotCta: "Abrir Bot do Telegram",

    needHelp: "Precisa de ajuda?",
    contactSupport: "Contactar Suporte",
  },

  zh: {
    pageTitle: "欢迎 \u2014 PNPtv!",
    metaDescription: "欢迎来到 PNPtv! 探索所有功能：媒体、Hangouts、PNP 直播、社交动态、附近和更多。",

    welcomeGreeting: "欢迎，{name}！",
    heroBody: "您的会员资格已激活。以下是您在 PNPtv 上能做的一切 \u2014 探索以下每项功能即可开始。",

    primeActiveBadge: "PRIME 已激活",
    memberActiveBadge: "Member 已激活",

    communityRulesTitle: "社区规则",
    ageRequirementLabel: "18+",
    ageRequirementText: "您必须年满 18 岁才能使用 PNPtv!。继续使用本平台即表示您确认年龄至少为 18 岁。",
    prohibitedContentTitle: "以下内容被严格禁止：",
    prohibitedItems: [
      "任何涉及未成年人的内容",
      "非同意内容或任何形式的强迫",
      "骚扰、威胁、人肉搜索或仇恨言论",
      "非法毒品销售、贩运或招募",
      "垃圾信息、诈骗、网络钓鱼或冒充他人",
      "未经所有者同意分享私人内容",
    ] as const,
    violationsNote:
      "违规行为将导致账号立即终止，并将向相关当局举报。我们主动监控内容并与执法机构全力配合。使用 PNPtv! 即表示您同意遵守这些规则。",
    violationsImmediateTermination: "账号立即终止",
    violationsReportedAuthorities: "向相关当局举报",

    exploreFeaturesHeading: "探索功能",
    featureCards: [
      {
        title: "媒体",
        desc: "视频、音乐和播客。浏览独家 PRIME 内容并创建自己的播放列表。",
      },
      {
        title: "Hangouts",
        desc: "社区视频通话房间。加入公开群组或与朋友创建私密 Hangout。",
      },
      {
        title: "PNP Live",
        desc: "直播和独家录像。实时观看节目并发送打赏。",
      },
      {
        title: "社交动态",
        desc: "发布内容、点赞、转发和评论。与社区互动。",
      },
      {
        title: "附近",
        desc: "发现附近的成员和场所。开启定位查看周围有谁。",
      },
      {
        title: "私信",
        desc: "向任意成员发送私信。分享文字、图片和视频。",
      },
      {
        title: "个人资料",
        desc: "用主题、徽章和个人简介定制您的资料。连接 Bluesky 或 X。",
      },
      {
        title: "PRIME 频道",
        desc: "专属 Telegram 频道，提供高级内容和早期公告。",
      },
    ] as const,

    quickStartTitle: "快速入门清单",
    quickStartItems: [
      "添加照片和简介完善您的资料",
      "探索独家 PRIME 内容",
      "加入 Hangout 或创建自己的群组",
      "在社交动态发布第一篇帖子",
      "加入 PRIME Telegram 频道",
    ] as const,

    explorePnptvCta: "探索 PNPtv",
    openTelegramBotCta: "打开 Telegram Bot",

    needHelp: "需要帮助？",
    contactSupport: "联系支持",
  },

  zhTW: {
    pageTitle: "歡迎 \u2014 PNPtv!",
    metaDescription: "歡迎來到 PNPtv! 探索所有功能：媒體、Hangouts、PNP 直播、社交動態、附近和更多。",

    welcomeGreeting: "歡迎，{name}！",
    heroBody: "您的會員資格已啟用。以下是您在 PNPtv 上能做的一切 \u2014 探索以下每項功能即可開始。",

    primeActiveBadge: "PRIME 已啟用",
    memberActiveBadge: "Member 已啟用",

    communityRulesTitle: "社群規則",
    ageRequirementLabel: "18+",
    ageRequirementText: "您必須年滿 18 歲才能使用 PNPtv!。繼續使用本平台即表示您確認年齡至少為 18 歲。",
    prohibitedContentTitle: "以下內容被嚴格禁止：",
    prohibitedItems: [
      "任何涉及未成年人的內容",
      "非同意內容或任何形式的強迫",
      "騷擾、威脅、人肉搜索或仇恨言論",
      "非法毒品銷售、販運或招募",
      "垃圾訊息、詐騙、網路釣魚或冒充他人",
      "未經所有者同意分享私人內容",
    ] as const,
    violationsNote:
      "違規行為將導致帳號立即終止，並向相關當局舉報。我們主動監控內容並與執法機構全力配合。使用 PNPtv! 即表示您同意遵守這些規則。",
    violationsImmediateTermination: "帳號立即終止",
    violationsReportedAuthorities: "向相關當局舉報",

    exploreFeaturesHeading: "探索功能",
    featureCards: [
      {
        title: "媒體",
        desc: "影片、音樂和播客。瀏覽獨家 PRIME 內容並建立自己的播放清單。",
      },
      {
        title: "Hangouts",
        desc: "社群視訊通話房間。加入公開群組或與朋友建立私密 Hangout。",
      },
      {
        title: "PNP Live",
        desc: "直播和獨家錄影。即時觀看節目並發送小費。",
      },
      {
        title: "社交動態",
        desc: "發佈內容、按讚、轉發和留言。與社群互動。",
      },
      {
        title: "附近",
        desc: "探索附近的會員和場所。開啟定位查看周圍有誰。",
      },
      {
        title: "私訊",
        desc: "向任意會員發送私訊。分享文字、圖片和影片。",
      },
      {
        title: "個人資料",
        desc: "用主題、徽章和個人簡介自訂您的資料。連結 Bluesky 或 X。",
      },
      {
        title: "PRIME 頻道",
        desc: "專屬 Telegram 頻道，提供高級內容和早期公告。",
      },
    ] as const,

    quickStartTitle: "快速入門清單",
    quickStartItems: [
      "添加照片和簡介完善您的資料",
      "探索獨家 PRIME 內容",
      "加入 Hangout 或建立自己的群組",
      "在社交動態發佈第一篇貼文",
      "加入 PRIME Telegram 頻道",
    ] as const,

    explorePnptvCta: "探索 PNPtv",
    openTelegramBotCta: "開啟 Telegram Bot",

    needHelp: "需要協助？",
    contactSupport: "聯絡支援",
  },

  fr: {
    pageTitle: "Bienvenue \u2014 PNPtv!",
    metaDescription: "Bienvenue sur PNPtv! Explorez toutes les fonctionnalités : Médias, Hangouts, PNP Live, Fil Social, À Proximité et plus encore.",

    welcomeGreeting: "Bienvenue, {name} !",
    heroBody: "Votre adhésion est active. Voici tout ce que vous pouvez faire sur PNPtv \u2014 explorez chaque fonctionnalité ci-dessous pour commencer.",

    primeActiveBadge: "PRIME Actif",
    memberActiveBadge: "Member Actif",

    communityRulesTitle: "Règles de la Communauté",
    ageRequirementLabel: "18+",
    ageRequirementText: "Vous devez avoir 18 ans ou plus pour utiliser PNPtv!. En continuant à utiliser cette plateforme, vous confirmez avoir au moins 18 ans.",
    prohibitedContentTitle: "Le contenu suivant est strictement interdit :",
    prohibitedItems: [
      "Contenu impliquant des mineurs dans quelque contexte que ce soit",
      "Contenu non consenti ou toute forme de coercition",
      "Harcèlement, menaces, doxxing ou discours haineux",
      "Vente illégale de drogues, trafic ou sollicitation",
      "Spam, arnaques, phishing ou usurpation d'identité",
      "Partager du contenu privé sans le consentement du propriétaire",
    ] as const,
    violationsNote:
      "Les violations entraîneront la résiliation immédiate du compte et seront signalées aux autorités compétentes. Nous surveillons activement le contenu et coopérons pleinement avec les forces de l'ordre. En utilisant PNPtv!, vous acceptez de respecter ces règles.",
    violationsImmediateTermination: "résiliation immédiate du compte",
    violationsReportedAuthorities: "signalées aux autorités compétentes",

    exploreFeaturesHeading: "Explorer les Fonctionnalités",
    featureCards: [
      {
        title: "Médias",
        desc: "Vidéos, musique et podcasts. Parcourez le contenu PRIME exclusif et créez vos propres playlists.",
      },
      {
        title: "Hangouts",
        desc: "Salles d'appel vidéo communautaires. Rejoignez des groupes publics ou créez des hangouts privés avec des amis.",
      },
      {
        title: "PNP Live",
        desc: "Streams en direct et enregistrements exclusifs. Regardez des shows en temps réel et envoyez des pourboires.",
      },
      {
        title: "Fil Social",
        desc: "Publiez du contenu, likez, reposter et commentez. Connectez-vous avec la communauté.",
      },
      {
        title: "À Proximité",
        desc: "Découvrez les membres et lieux près de vous. Activez la localisation pour voir qui est autour.",
      },
      {
        title: "Messages Directs",
        desc: "Envoyez des messages privés à n'importe quel membre. Partagez texte, images et vidéos.",
      },
      {
        title: "Profil",
        desc: "Personnalisez votre profil avec des thèmes, badges et bio. Connectez Bluesky ou X.",
      },
      {
        title: "Canal PRIME",
        desc: "Canal Telegram exclusif avec du contenu premium et des annonces anticipées.",
      },
    ] as const,

    quickStartTitle: "Liste de Démarrage Rapide",
    quickStartItems: [
      "Complétez votre profil avec une photo et une bio",
      "Explorez le contenu PRIME exclusif",
      "Rejoignez un Hangout ou créez votre propre groupe",
      "Publiez votre premier post sur le Fil Social",
      "Rejoignez le Canal PRIME Telegram",
    ] as const,

    explorePnptvCta: "Explorer PNPtv",
    openTelegramBotCta: "Ouvrir le Bot Telegram",

    needHelp: "Besoin d'aide ?",
    contactSupport: "Contacter le Support",
  },

  de: {
    pageTitle: "Willkommen \u2014 PNPtv!",
    metaDescription: "Willkommen bei PNPtv! Entdecke alle Funktionen: Medien, Hangouts, PNP Live, Social Feed, Nearby und mehr.",

    welcomeGreeting: "Willkommen, {name}!",
    heroBody: "Deine Mitgliedschaft ist aktiv. Hier ist alles, was du auf PNPtv tun kannst \u2014 entdecke jede Funktion unten, um loszulegen.",

    primeActiveBadge: "PRIME Aktiv",
    memberActiveBadge: "Member Aktiv",

    communityRulesTitle: "Community-Regeln",
    ageRequirementLabel: "18+",
    ageRequirementText: "Du musst mindestens 18 Jahre alt sein, um PNPtv! zu nutzen. Indem du die Plattform weiter verwendest, bestätigst du, dass du mindestens 18 Jahre alt bist.",
    prohibitedContentTitle: "Folgende Inhalte sind streng verboten:",
    prohibitedItems: [
      "Inhalte, die Minderjährige in irgendeinem Kontext zeigen",
      "Nicht einvernehmliche Inhalte oder jede Form von Zwang",
      "Belästigung, Drohungen, Doxxing oder Hassrede",
      "Illegaler Drogenverkauf, -handel oder -werbung",
      "Spam, Betrug, Phishing oder Identitätsbetrug",
      "Privater Inhalt ohne Zustimmung des Eigentümers teilen",
    ] as const,
    violationsNote:
      "Verstöße führen zur sofortigen Kontosperrung und werden den zuständigen Behörden gemeldet. Wir überwachen Inhalte aktiv und kooperieren vollständig mit den Strafverfolgungsbehörden. Mit der Nutzung von PNPtv! stimmst du zu, diese Regeln einzuhalten.",
    violationsImmediateTermination: "sofortigen Kontosperrung",
    violationsReportedAuthorities: "den zuständigen Behörden gemeldet",

    exploreFeaturesHeading: "Funktionen entdecken",
    featureCards: [
      {
        title: "Medien",
        desc: "Videos, Musik und Podcasts. Durchstöbere exklusive PRIME-Inhalte und erstelle eigene Playlists.",
      },
      {
        title: "Hangouts",
        desc: "Community-Videoräume. Tritt öffentlichen Gruppen bei oder erstelle private Hangouts mit Freunden.",
      },
      {
        title: "PNP Live",
        desc: "Livestreams und exklusive Aufnahmen. Schau Shows in Echtzeit und sende Trinkgelder.",
      },
      {
        title: "Social Feed",
        desc: "Inhalte posten, liken, reposten und kommentieren. Verbinde dich mit der Community.",
      },
      {
        title: "In der Nähe",
        desc: "Entdecke Mitglieder und Orte in deiner Nähe. Aktiviere den Standort, um zu sehen, wer in der Nähe ist.",
      },
      {
        title: "Direktnachrichten",
        desc: "Sende private Nachrichten an jedes Mitglied. Teile Text, Bilder und Videos.",
      },
      {
        title: "Profil",
        desc: "Passe dein Profil mit Themes, Badges und Bio an. Verbinde Bluesky oder X.",
      },
      {
        title: "PRIME-Kanal",
        desc: "Exklusiver Telegram-Kanal mit Premium-Inhalten und frühzeitigen Ankündigungen.",
      },
    ] as const,

    quickStartTitle: "Schnellstart-Checkliste",
    quickStartItems: [
      "Vervollständige dein Profil mit Foto und Bio",
      "Erkunde exklusive PRIME-Inhalte",
      "Tritt einem Hangout bei oder erstelle deine eigene Gruppe",
      "Veröffentliche deinen ersten Post im Social Feed",
      "Tritt dem PRIME Telegram-Kanal bei",
    ] as const,

    explorePnptvCta: "PNPtv erkunden",
    openTelegramBotCta: "Telegram-Bot öffnen",

    needHelp: "Brauchst du Hilfe?",
    contactSupport: "Support kontaktieren",
  },

  th: {
    pageTitle: "ยินดีต้อนรับ \u2014 PNPtv!",
    metaDescription: "ยินดีต้อนรับสู่ PNPtv! สำรวจทุกฟีเจอร์: มีเดีย, Hangouts, PNP Live, ฟีดสังคม, ใกล้เคียง และอื่นๆ อีกมากมาย",

    welcomeGreeting: "ยินดีต้อนรับ, {name}!",
    heroBody: "สมาชิกของคุณใช้งานได้แล้ว นี่คือทุกสิ่งที่คุณทำได้บน PNPtv \u2014 สำรวจแต่ละฟีเจอร์ด้านล่างเพื่อเริ่มต้น",

    primeActiveBadge: "PRIME ใช้งานแล้ว",
    memberActiveBadge: "Member ใช้งานแล้ว",

    communityRulesTitle: "กฎของชุมชน",
    ageRequirementLabel: "18+",
    ageRequirementText: "คุณต้องมีอายุ 18 ปีขึ้นไปจึงจะใช้ PNPtv! ได้ การใช้แพลตฟอร์มนี้ต่อไปถือว่าคุณยืนยันว่ามีอายุอย่างน้อย 18 ปี",
    prohibitedContentTitle: "เนื้อหาต่อไปนี้ถูกห้ามอย่างเด็ดขาด:",
    prohibitedItems: [
      "เนื้อหาที่เกี่ยวข้องกับผู้เยาว์ในทุกบริบท",
      "เนื้อหาที่ไม่ได้รับความยินยอมหรือการบังคับในรูปแบบใดๆ",
      "การคุกคาม ภัยคุกคาม การเปิดเผยข้อมูลส่วนตัว หรือคำพูดที่แสดงความเกลียดชัง",
      "การขายยาเสพติดผิดกฎหมาย การค้ายา หรือการชักชวน",
      "สแปม การฉ้อโกง ฟิชชิง หรือการปลอมตัวเป็นผู้อื่น",
      "การแบ่งปันเนื้อหาส่วนตัวโดยไม่ได้รับความยินยอมจากเจ้าของ",
    ] as const,
    violationsNote:
      "การละเมิดจะส่งผลให้บัญชีถูกยุติทันทีและจะถูกรายงานต่อหน่วยงานที่เกี่ยวข้อง เราตรวจสอบเนื้อหาอย่างต่อเนื่องและให้ความร่วมมือกับเจ้าหน้าที่บังคับใช้กฎหมายอย่างเต็มที่ การใช้ PNPtv! ถือว่าคุณยินยอมปฏิบัติตามกฎเหล่านี้",
    violationsImmediateTermination: "การยุติบัญชีทันที",
    violationsReportedAuthorities: "รายงานต่อหน่วยงานที่เกี่ยวข้อง",

    exploreFeaturesHeading: "สำรวจฟีเจอร์",
    featureCards: [
      {
        title: "มีเดีย",
        desc: "วิดีโอ เพลง และพอดแคสต์ สำรวจเนื้อหา PRIME พิเศษและสร้างเพลย์ลิสต์ของคุณเอง",
      },
      {
        title: "Hangouts",
        desc: "ห้องวิดีโอคอลของชุมชน เข้าร่วมกลุ่มสาธารณะหรือสร้าง Hangout ส่วนตัวกับเพื่อน",
      },
      {
        title: "PNP Live",
        desc: "ไลฟ์สตรีมและการบันทึกพิเศษ ชมโชว์แบบเรียลไทม์และส่งทิปส์",
      },
      {
        title: "ฟีดสังคม",
        desc: "โพสต์เนื้อหา กดไลก์ รีโพสต์ และแสดงความคิดเห็น เชื่อมต่อกับชุมชน",
      },
      {
        title: "ใกล้เคียง",
        desc: "ค้นพบสมาชิกและสถานที่ใกล้คุณ เปิดตำแหน่งที่ตั้งเพื่อดูว่ามีใครอยู่รอบๆ",
      },
      {
        title: "ข้อความส่วนตัว",
        desc: "ส่งข้อความส่วนตัวถึงสมาชิกคนใดก็ได้ แชร์ข้อความ รูปภาพ และวิดีโอ",
      },
      {
        title: "โปรไฟล์",
        desc: "ปรับแต่งโปรไฟล์ด้วยธีม แบดจ์ และประวัติ เชื่อมต่อ Bluesky หรือ X",
      },
      {
        title: "ช่อง PRIME",
        desc: "ช่อง Telegram พิเศษพร้อมเนื้อหาพรีเมียมและการประกาศก่อนใคร",
      },
    ] as const,

    quickStartTitle: "รายการตรวจสอบการเริ่มต้นอย่างรวดเร็ว",
    quickStartItems: [
      "กรอกข้อมูลโปรไฟล์ด้วยรูปภาพและประวัติ",
      "สำรวจเนื้อหา PRIME พิเศษ",
      "เข้าร่วม Hangout หรือสร้างกลุ่มของคุณเอง",
      "โพสต์แรกในฟีดสังคม",
      "เข้าร่วมช่อง PRIME Telegram",
    ] as const,

    explorePnptvCta: "สำรวจ PNPtv",
    openTelegramBotCta: "เปิด Telegram Bot",

    needHelp: "ต้องการความช่วยเหลือ?",
    contactSupport: "ติดต่อฝ่ายสนับสนุน",
  },

  it: {
    pageTitle: "Benvenuto \u2014 PNPtv!",
    metaDescription: "Benvenuto su PNPtv! Esplora tutte le funzionalità: Media, Hangouts, PNP Live, Social Feed, Nelle Vicinanze e altro ancora.",

    welcomeGreeting: "Benvenuto, {name}!",
    heroBody: "La tua iscrizione è attiva. Ecco tutto ciò che puoi fare su PNPtv \u2014 esplora ogni funzione qui sotto per iniziare.",

    primeActiveBadge: "PRIME Attivo",
    memberActiveBadge: "Member Attivo",

    communityRulesTitle: "Regole della Community",
    ageRequirementLabel: "18+",
    ageRequirementText: "Devi avere almeno 18 anni per usare PNPtv!. Continuando a usare questa piattaforma, confermi di avere almeno 18 anni.",
    prohibitedContentTitle: "I seguenti contenuti sono severamente vietati:",
    prohibitedItems: [
      "Contenuti che coinvolgono minori in qualsiasi contesto",
      "Contenuti non consensuali o qualsiasi forma di coercizione",
      "Molestie, minacce, doxxing o discorsi d'odio",
      "Vendita illegale di droghe, traffico o adescamento",
      "Spam, truffe, phishing o impersonificazione",
      "Condividere contenuti privati senza il consenso del proprietario",
    ] as const,
    violationsNote:
      "Le violazioni comporteranno la chiusura immediata dell'account e saranno segnalate alle autorità competenti. Monitoriamo attivamente i contenuti e collaboriamo pienamente con le forze dell'ordine. Usando PNPtv!, accetti di rispettare queste regole.",
    violationsImmediateTermination: "chiusura immediata dell'account",
    violationsReportedAuthorities: "segnalate alle autorità competenti",

    exploreFeaturesHeading: "Esplora le Funzioni",
    featureCards: [
      {
        title: "Media",
        desc: "Video, musica e podcast. Sfoglia contenuti PRIME esclusivi e crea le tue playlist.",
      },
      {
        title: "Hangouts",
        desc: "Stanze per videochiamate community. Unisciti a gruppi pubblici o crea hangout privati con gli amici.",
      },
      {
        title: "PNP Live",
        desc: "Livestream e registrazioni esclusive. Guarda gli show in tempo reale e invia mance.",
      },
      {
        title: "Social Feed",
        desc: "Pubblica contenuti, metti like, reposta e commenta. Connettiti con la community.",
      },
      {
        title: "Nelle Vicinanze",
        desc: "Scopri membri e luoghi vicino a te. Attiva la posizione per vedere chi c'è nei dintorni.",
      },
      {
        title: "Messaggi Diretti",
        desc: "Invia messaggi privati a qualsiasi membro. Condividi testo, immagini e video.",
      },
      {
        title: "Profilo",
        desc: "Personalizza il tuo profilo con temi, badge e bio. Collega Bluesky o X.",
      },
      {
        title: "Canale PRIME",
        desc: "Canale Telegram esclusivo con contenuti premium e annunci anticipati.",
      },
    ] as const,

    quickStartTitle: "Checklist di Avvio Rapido",
    quickStartItems: [
      "Completa il tuo profilo con foto e bio",
      "Esplora i contenuti PRIME esclusivi",
      "Unisciti a un Hangout o crea il tuo gruppo",
      "Pubblica il tuo primo post sul Social Feed",
      "Unisciti al Canale PRIME Telegram",
    ] as const,

    explorePnptvCta: "Esplora PNPtv",
    openTelegramBotCta: "Apri il Bot Telegram",

    needHelp: "Hai bisogno di aiuto?",
    contactSupport: "Contatta il Supporto",
  },

  tr: {
    pageTitle: "Hoş Geldin \u2014 PNPtv!",
    metaDescription: "PNPtv!'e hoş geldin! Tüm özellikleri keşfet: Medya, Hangouts, PNP Live, Sosyal Akış, Yakınımdakiler ve daha fazlası.",

    welcomeGreeting: "Hoş Geldin, {name}!",
    heroBody: "Üyeliğin aktif. PNPtv'de yapabileceğin her şey burada \u2014 başlamak için aşağıdaki her özelliği keşfet.",

    primeActiveBadge: "PRIME Aktif",
    memberActiveBadge: "Member Aktif",

    communityRulesTitle: "Topluluk Kuralları",
    ageRequirementLabel: "18+",
    ageRequirementText: "PNPtv!'i kullanmak için 18 yaşında veya daha büyük olmalısın. Bu platformu kullanmaya devam ederek en az 18 yaşında olduğunu onaylıyorsun.",
    prohibitedContentTitle: "Aşağıdaki içerikler kesinlikle yasaktır:",
    prohibitedItems: [
      "Herhangi bir bağlamda reşit olmayanları içeren içerikler",
      "Rızasız içerikler veya herhangi bir zorlama biçimi",
      "Taciz, tehdit, kişisel bilgi ifşası veya nefret söylemi",
      "Yasadışı uyuşturucu satışı, kaçakçılığı veya temin etme",
      "Spam, dolandırıcılık, kimlik avı veya kimlik taklidi",
      "Sahibinin rızası olmadan özel içerik paylaşmak",
    ] as const,
    violationsNote:
      "İhlaller hesabın anında kapatılmasıyla sonuçlanacak ve ilgili makamlara bildirilecektir. İçerikleri aktif olarak izliyor ve kolluk kuvvetleriyle tam iş birliği yapıyoruz. PNPtv!'i kullanarak bu kurallara uymayı kabul etmiş oluyorsun.",
    violationsImmediateTermination: "hesabın anında kapatılması",
    violationsReportedAuthorities: "ilgili makamlara bildirilmesi",

    exploreFeaturesHeading: "Özellikleri Keşfet",
    featureCards: [
      {
        title: "Medya",
        desc: "Videolar, müzik ve podcast'ler. Özel PRIME içeriklerini keşfet ve kendi çalma listelerini oluştur.",
      },
      {
        title: "Hangouts",
        desc: "Topluluk video arama odaları. Herkese açık gruplara katıl veya arkadaşlarınla özel hangout'lar oluştur.",
      },
      {
        title: "PNP Live",
        desc: "Canlı yayınlar ve özel kayıtlar. Şovları gerçek zamanlı izle ve bahşiş gönder.",
      },
      {
        title: "Sosyal Akış",
        desc: "İçerik paylaş, beğen, repostla ve yorum yap. Toplulukla bağlantı kur.",
      },
      {
        title: "Yakınımdakiler",
        desc: "Yakınındaki üyeleri ve mekanları keşfet. Kim olduğunu görmek için konumu etkinleştir.",
      },
      {
        title: "Doğrudan Mesajlar",
        desc: "Herhangi bir üyeye özel mesaj gönder. Metin, fotoğraf ve video paylaş.",
      },
      {
        title: "Profil",
        desc: "Profilini tema, rozet ve biyografi ile özelleştir. Bluesky veya X'i bağla.",
      },
      {
        title: "PRIME Kanalı",
        desc: "Premium içerikler ve erken duyurular içeren özel Telegram kanalı.",
      },
    ] as const,

    quickStartTitle: "Hızlı Başlangıç Listesi",
    quickStartItems: [
      "Fotoğraf ve biyografi ile profilini tamamla",
      "Özel PRIME içeriklerini keşfet",
      "Bir Hangout'a katıl veya kendi grubunu oluştur",
      "Sosyal Akış'ta ilk gönderini yayınla",
      "PRIME Telegram Kanalına katıl",
    ] as const,

    explorePnptvCta: "PNPtv'yi Keşfet",
    openTelegramBotCta: "Telegram Botunu Aç",

    needHelp: "Yardıma mı ihtiyacın var?",
    contactSupport: "Destek ile İletişim",
  },

  ru: {
    pageTitle: "Добро пожаловать \u2014 PNPtv!",
    metaDescription: "Добро пожаловать на PNPtv! Исследуйте все функции: Медиа, Hangouts, PNP Live, Социальная лента, Рядом и многое другое.",

    welcomeGreeting: "Добро пожаловать, {name}!",
    heroBody: "Ваше членство активно. Вот всё, что вы можете делать на PNPtv \u2014 исследуйте каждую функцию ниже, чтобы начать.",

    primeActiveBadge: "PRIME Активен",
    memberActiveBadge: "Member Активен",

    communityRulesTitle: "Правила сообщества",
    ageRequirementLabel: "18+",
    ageRequirementText: "Для использования PNPtv! вам должно быть не менее 18 лет. Продолжая использовать платформу, вы подтверждаете, что вам исполнилось 18 лет.",
    prohibitedContentTitle: "Следующий контент строго запрещён:",
    prohibitedItems: [
      "Контент с участием несовершеннолетних в любом контексте",
      "Контент без согласия или любая форма принуждения",
      "Преследование, угрозы, доксинг или разжигание ненависти",
      "Незаконная продажа наркотиков, торговля ими или вербовка",
      "Спам, мошенничество, фишинг или самозванство",
      "Публикация личного контента без согласия владельца",
    ] as const,
    violationsNote:
      "Нарушения приведут к немедленному удалению аккаунта и сообщению в соответствующие органы. Мы активно отслеживаем контент и полностью сотрудничаем с правоохранительными органами. Используя PNPtv!, вы соглашаетесь соблюдать эти правила.",
    violationsImmediateTermination: "немедленному удалению аккаунта",
    violationsReportedAuthorities: "сообщению в соответствующие органы",

    exploreFeaturesHeading: "Исследуйте функции",
    featureCards: [
      {
        title: "Медиа",
        desc: "Видео, музыка и подкасты. Просматривайте эксклюзивный PRIME-контент и создавайте собственные плейлисты.",
      },
      {
        title: "Hangouts",
        desc: "Видеокомнаты для сообщества. Вступайте в публичные группы или создавайте приватные hangout'ы с друзьями.",
      },
      {
        title: "PNP Live",
        desc: "Прямые трансляции и эксклюзивные записи. Смотрите шоу в реальном времени и отправляйте чаевые.",
      },
      {
        title: "Социальная лента",
        desc: "Публикуйте контент, ставьте лайки, репостите и комментируйте. Общайтесь с сообществом.",
      },
      {
        title: "Рядом",
        desc: "Находите участников и места рядом с вами. Включите геолокацию, чтобы видеть, кто поблизости.",
      },
      {
        title: "Личные сообщения",
        desc: "Отправляйте приватные сообщения любому участнику. Делитесь текстом, фото и видео.",
      },
      {
        title: "Профиль",
        desc: "Настройте профиль с темами, значками и описанием. Подключите Bluesky или X.",
      },
      {
        title: "PRIME-канал",
        desc: "Эксклюзивный Telegram-канал с премиум-контентом и ранними анонсами.",
      },
    ] as const,

    quickStartTitle: "Чеклист быстрого старта",
    quickStartItems: [
      "Завершите профиль с фото и описанием",
      "Исследуйте эксклюзивный PRIME-контент",
      "Вступите в Hangout или создайте свою группу",
      "Опубликуйте первый пост в социальной ленте",
      "Вступите в PRIME Telegram-канал",
    ] as const,

    explorePnptvCta: "Исследовать PNPtv",
    openTelegramBotCta: "Открыть Telegram-бота",

    needHelp: "Нужна помощь?",
    contactSupport: "Связаться с поддержкой",
  },

  nl: {
    pageTitle: "Welkom \u2014 PNPtv!",
    metaDescription: "Welkom bij PNPtv! Ontdek alle functies: Media, Hangouts, PNP Live, Sociale Feed, Nearby en meer.",

    welcomeGreeting: "Welkom, {name}!",
    heroBody: "Je lidmaatschap is actief. Dit is alles wat je op PNPtv kunt doen \u2014 verken elke functie hieronder om te beginnen.",

    primeActiveBadge: "PRIME Actief",
    memberActiveBadge: "Member Actief",

    communityRulesTitle: "Community-regels",
    ageRequirementLabel: "18+",
    ageRequirementText: "Je moet 18 jaar of ouder zijn om PNPtv! te gebruiken. Door dit platform te blijven gebruiken, bevestig je dat je minimaal 18 jaar oud bent.",
    prohibitedContentTitle: "De volgende inhoud is strikt verboden:",
    prohibitedItems: [
      "Inhoud waarbij minderjarigen betrokken zijn in welk context dan ook",
      "Niet-consensuele inhoud of enige vorm van dwang",
      "Intimidatie, bedreigingen, doxxing of haatdragende uitlatingen",
      "Illegale drugsverkoop, -handel of -werving",
      "Spam, oplichting, phishing of identiteitsfraude",
      "Privé-inhoud delen zonder toestemming van de eigenaar",
    ] as const,
    violationsNote:
      "Overtredingen leiden tot onmiddellijke accountbeëindiging en worden gemeld bij de bevoegde autoriteiten. We monitoren inhoud actief en werken volledig samen met de rechtshandhaving. Door PNPtv! te gebruiken, ga je ermee akkoord je aan deze regels te houden.",
    violationsImmediateTermination: "onmiddellijke accountbeëindiging",
    violationsReportedAuthorities: "gemeld bij de bevoegde autoriteiten",

    exploreFeaturesHeading: "Functies verkennen",
    featureCards: [
      {
        title: "Media",
        desc: "Video's, muziek en podcasts. Blader door exclusieve PRIME-content en maak je eigen afspeellijsten.",
      },
      {
        title: "Hangouts",
        desc: "Community-videokamers. Sluit je aan bij publieke groepen of maak privé hangouts met vrienden.",
      },
      {
        title: "PNP Live",
        desc: "Livestreams en exclusieve opnames. Bekijk shows in real time en stuur fooi.",
      },
      {
        title: "Sociale Feed",
        desc: "Plaats inhoud, like, herpost en reageer. Verbind je met de community.",
      },
      {
        title: "PNP Connect",
        desc: "Ontdek leden en locaties bij jou in de buurt. Schakel locatie in om te zien wie er rondom is.",
      },
      {
        title: "Directe Berichten",
        desc: "Stuur privéberichten naar elk lid. Deel tekst, afbeeldingen en video's.",
      },
      {
        title: "Profiel",
        desc: "Personaliseer je profiel met thema's, badges en bio. Koppel Bluesky of X.",
      },
      {
        title: "PRIME-kanaal",
        desc: "Exclusief Telegram-kanaal met premium content en vroege aankondigingen.",
      },
    ] as const,

    quickStartTitle: "Snelstart Checklist",
    quickStartItems: [
      "Voltooi je profiel met foto en bio",
      "Verken exclusieve PRIME-content",
      "Sluit je aan bij een Hangout of maak je eigen groep",
      "Publiceer je eerste post op de Sociale Feed",
      "Sluit je aan bij het PRIME Telegram-kanaal",
    ] as const,

    explorePnptvCta: "PNPtv verkennen",
    openTelegramBotCta: "Telegram-bot openen",

    needHelp: "Heb je hulp nodig?",
    contactSupport: "Contact opnemen met Support",
  },

  vi: {
    pageTitle: "Chào mừng \u2014 PNPtv!",
    metaDescription: "Chào mừng đến với PNPtv! Khám phá tất cả tính năng: Phương tiện, Hangouts, PNP Live, Bảng tin Xã hội, Lân cận và nhiều hơn nữa.",

    welcomeGreeting: "Chào mừng, {name}!",
    heroBody: "Tư cách thành viên của bạn đang hoạt động. Đây là mọi thứ bạn có thể làm trên PNPtv \u2014 khám phá từng tính năng bên dưới để bắt đầu.",

    primeActiveBadge: "PRIME Đang hoạt động",
    memberActiveBadge: "Member Đang hoạt động",

    communityRulesTitle: "Quy tắc Cộng đồng",
    ageRequirementLabel: "18+",
    ageRequirementText: "Bạn phải từ 18 tuổi trở lên để sử dụng PNPtv!. Tiếp tục sử dụng nền tảng này đồng nghĩa bạn xác nhận mình ít nhất 18 tuổi.",
    prohibitedContentTitle: "Nội dung sau đây bị nghiêm cấm hoàn toàn:",
    prohibitedItems: [
      "Nội dung liên quan đến trẻ vị thành niên trong bất kỳ bối cảnh nào",
      "Nội dung không có sự đồng ý hoặc bất kỳ hình thức ép buộc nào",
      "Quấy rối, đe dọa, doxxing hoặc phát ngôn thù hận",
      "Buôn bán, mua bán ma túy bất hợp pháp hoặc lôi kéo",
      "Spam, lừa đảo, phishing hoặc mạo danh",
      "Chia sẻ nội dung riêng tư mà không có sự đồng ý của chủ sở hữu",
    ] as const,
    violationsNote:
      "Các vi phạm sẽ dẫn đến việc chấm dứt tài khoản ngay lập tức và sẽ được báo cáo cho các cơ quan có thẩm quyền. Chúng tôi chủ động giám sát nội dung và phối hợp đầy đủ với cơ quan thực thi pháp luật. Khi sử dụng PNPtv!, bạn đồng ý tuân thủ các quy tắc này.",
    violationsImmediateTermination: "chấm dứt tài khoản ngay lập tức",
    violationsReportedAuthorities: "được báo cáo cho các cơ quan có thẩm quyền",

    exploreFeaturesHeading: "Khám phá Tính năng",
    featureCards: [
      {
        title: "Phương tiện",
        desc: "Video, âm nhạc và podcast. Duyệt nội dung PRIME độc quyền và tạo danh sách phát của riêng bạn.",
      },
      {
        title: "Hangouts",
        desc: "Phòng gọi video cộng đồng. Tham gia nhóm công khai hoặc tạo hangout riêng tư với bạn bè.",
      },
      {
        title: "PNP Live",
        desc: "Livestream và ghi hình độc quyền. Xem show theo thời gian thực và gửi tiền thưởng.",
      },
      {
        title: "Bảng tin Xã hội",
        desc: "Đăng nội dung, thích, chia sẻ và bình luận. Kết nối với cộng đồng.",
      },
      {
        title: "Lân cận",
        desc: "Khám phá thành viên và địa điểm gần bạn. Bật vị trí để xem ai đang ở xung quanh.",
      },
      {
        title: "Tin nhắn Trực tiếp",
        desc: "Gửi tin nhắn riêng tư cho bất kỳ thành viên nào. Chia sẻ văn bản, hình ảnh và video.",
      },
      {
        title: "Hồ sơ",
        desc: "Tùy chỉnh hồ sơ với chủ đề, huy hiệu và tiểu sử. Kết nối Bluesky hoặc X.",
      },
      {
        title: "Kênh PRIME",
        desc: "Kênh Telegram độc quyền với nội dung cao cấp và thông báo sớm.",
      },
    ] as const,

    quickStartTitle: "Danh sách Kiểm tra Khởi động Nhanh",
    quickStartItems: [
      "Hoàn thiện hồ sơ với ảnh và tiểu sử",
      "Khám phá nội dung PRIME độc quyền",
      "Tham gia Hangout hoặc tạo nhóm của riêng bạn",
      "Đăng bài đầu tiên trên Bảng tin Xã hội",
      "Tham gia Kênh PRIME Telegram",
    ] as const,

    explorePnptvCta: "Khám phá PNPtv",
    openTelegramBotCta: "Mở Telegram Bot",

    needHelp: "Cần trợ giúp?",
    contactSupport: "Liên hệ Hỗ trợ",
  },

  ja: {
    pageTitle: "ようこそ \u2014 PNPtv!",
    metaDescription: "PNPtv! へようこそ。メディア、Hangouts、PNP Live、ソーシャルフィード、近くにいる人など、すべての機能を探索しよう。",

    welcomeGreeting: "ようこそ、{name}！",
    heroBody: "メンバーシップが有効になりました。PNPtv でできることをすべてご覧ください \u2014 以下の各機能を探索して始めましょう。",

    primeActiveBadge: "PRIME アクティブ",
    memberActiveBadge: "Member アクティブ",

    communityRulesTitle: "コミュニティルール",
    ageRequirementLabel: "18+",
    ageRequirementText: "PNPtv! を使用するには18歳以上である必要があります。このプラットフォームを引き続き使用することで、あなたが少なくとも18歳であることを確認したことになります。",
    prohibitedContentTitle: "以下のコンテンツは厳しく禁止されています：",
    prohibitedItems: [
      "いかなる文脈においても未成年者が関与するコンテンツ",
      "非同意のコンテンツまたはいかなる形の強制も",
      "嫌がらせ、脅迫、ドックス行為、またはヘイトスピーチ",
      "違法薬物の販売、売買、または勧誘",
      "スパム、詐欺、フィッシング、または他者への成りすまし",
      "所有者の同意なしにプライベートコンテンツを共有する行為",
    ] as const,
    violationsNote:
      "違反した場合はアカウントの即時停止につながり、適切な当局に報告されます。私たちはコンテンツを積極的に監視し、法執行機関に全面的に協力しています。PNPtv! を使用することで、これらのルールを遵守することに同意したことになります。",
    violationsImmediateTermination: "アカウントの即時停止",
    violationsReportedAuthorities: "適切な当局に報告",

    exploreFeaturesHeading: "機能を探索",
    featureCards: [
      {
        title: "メディア",
        desc: "動画、音楽、ポッドキャスト。限定 PRIME コンテンツを閲覧し、自分だけのプレイリストを作成しよう。",
      },
      {
        title: "Hangouts",
        desc: "コミュニティビデオ通話ルーム。公開グループに参加するか、友達とプライベートなハングアウトを作ろう。",
      },
      {
        title: "PNP Live",
        desc: "ライブストリームと限定録画。ショーをリアルタイムで見てチップを送ろう。",
      },
      {
        title: "ソーシャルフィード",
        desc: "コンテンツを投稿し、いいね、リポスト、コメントしよう。コミュニティと繋がろう。",
      },
      {
        title: "近くにいる人",
        desc: "近くのメンバーや場所を発見しよう。周りに誰がいるか見るには位置情報をオンに。",
      },
      {
        title: "ダイレクトメッセージ",
        desc: "任意のメンバーにプライベートメッセージを送ろう。テキスト、画像、動画を共有できる。",
      },
      {
        title: "プロフィール",
        desc: "テーマ、バッジ、プロフィール文でプロフィールをカスタマイズ。Bluesky や X と連携しよう。",
      },
      {
        title: "PRIME チャンネル",
        desc: "プレミアムコンテンツと早期告知を配信する限定 Telegram チャンネル。",
      },
    ] as const,

    quickStartTitle: "クイックスタートチェックリスト",
    quickStartItems: [
      "写真とプロフィール文を追加してプロフィールを完成させよう",
      "限定 PRIME コンテンツを探索しよう",
      "Hangout に参加するか、自分のグループを作ろう",
      "ソーシャルフィードに最初の投稿をしよう",
      "PRIME Telegram チャンネルに参加しよう",
    ] as const,

    explorePnptvCta: "PNPtv を探索",
    openTelegramBotCta: "Telegram Bot を開く",

    needHelp: "お困りですか？",
    contactSupport: "サポートに問い合わせ",
  },

  id: {
    pageTitle: "Selamat Datang \u2014 PNPtv!",
    metaDescription: "Selamat datang di PNPtv! Jelajahi semua fitur: Media, Hangouts, PNP Live, Feed Sosial, Terdekat, dan lainnya.",

    welcomeGreeting: "Selamat datang, {name}!",
    heroBody: "Keanggotaanmu aktif. Inilah semua yang bisa kamu lakukan di PNPtv \u2014 jelajahi setiap fitur di bawah untuk memulai.",

    primeActiveBadge: "PRIME Aktif",
    memberActiveBadge: "Member Aktif",

    communityRulesTitle: "Aturan Komunitas",
    ageRequirementLabel: "18+",
    ageRequirementText: "Kamu harus berusia 18 tahun atau lebih untuk menggunakan PNPtv!. Dengan terus menggunakan platform ini, kamu mengonfirmasi bahwa kamu berusia minimal 18 tahun.",
    prohibitedContentTitle: "Konten berikut ini dilarang keras:",
    prohibitedItems: [
      "Konten yang melibatkan anak di bawah umur dalam konteks apa pun",
      "Konten tanpa persetujuan atau segala bentuk paksaan",
      "Pelecehan, ancaman, doxxing, atau ujaran kebencian",
      "Penjualan narkoba ilegal, perdagangan, atau perekrutan",
      "Spam, penipuan, phishing, atau peniruan identitas",
      "Berbagi konten pribadi tanpa persetujuan pemiliknya",
    ] as const,
    violationsNote:
      "Pelanggaran akan mengakibatkan penghentian akun secara langsung dan akan dilaporkan kepada pihak berwenang. Kami secara aktif memantau konten dan bekerja sama sepenuhnya dengan penegak hukum. Dengan menggunakan PNPtv!, kamu setuju untuk mematuhi aturan ini.",
    violationsImmediateTermination: "penghentian akun secara langsung",
    violationsReportedAuthorities: "dilaporkan kepada pihak berwenang",

    exploreFeaturesHeading: "Jelajahi Fitur",
    featureCards: [
      {
        title: "Media",
        desc: "Video, musik, dan podcast. Telusuri konten PRIME eksklusif dan buat playlist sendiri.",
      },
      {
        title: "Hangouts",
        desc: "Ruang panggilan video komunitas. Bergabunglah ke grup publik atau buat hangout privat bersama teman.",
      },
      {
        title: "PNP Live",
        desc: "Live stream dan rekaman eksklusif. Tonton show secara real time dan kirim tips.",
      },
      {
        title: "Feed Sosial",
        desc: "Posting konten, sukai, repost, dan berkomentar. Terhubung dengan komunitas.",
      },
      {
        title: "Terdekat",
        desc: "Temukan anggota dan tempat di dekatmu. Aktifkan lokasi untuk melihat siapa yang ada di sekitar.",
      },
      {
        title: "Pesan Langsung",
        desc: "Kirim pesan privat ke anggota mana pun. Bagikan teks, gambar, dan video.",
      },
      {
        title: "Profil",
        desc: "Sesuaikan profilmu dengan tema, lencana, dan bio. Hubungkan Bluesky atau X.",
      },
      {
        title: "Saluran PRIME",
        desc: "Saluran Telegram eksklusif dengan konten premium dan pengumuman lebih awal.",
      },
    ] as const,

    quickStartTitle: "Daftar Periksa Mulai Cepat",
    quickStartItems: [
      "Lengkapi profilmu dengan foto dan bio",
      "Jelajahi konten PRIME eksklusif",
      "Bergabunglah ke Hangout atau buat grup sendiri",
      "Terbitkan postingan pertamamu di Feed Sosial",
      "Bergabunglah ke Saluran PRIME Telegram",
    ] as const,

    explorePnptvCta: "Jelajahi PNPtv",
    openTelegramBotCta: "Buka Telegram Bot",

    needHelp: "Butuh bantuan?",
    contactSupport: "Hubungi Dukungan",
  },

  ar: {
    pageTitle: "مرحباً \u2014 PNPtv!",
    metaDescription: "مرحباً بك في PNPtv! استكشف جميع الميزات: الوسائط، Hangouts، PNP Live، التغذية الاجتماعية، القريب مني والمزيد.",

    welcomeGreeting: "مرحباً، {name}!",
    heroBody: "عضويتك نشطة. إليك كل ما يمكنك فعله على PNPtv \u2014 استكشف كل ميزة أدناه للبدء.",

    primeActiveBadge: "PRIME نشط",
    memberActiveBadge: "Member نشط",

    communityRulesTitle: "قواعد المجتمع",
    ageRequirementLabel: "18+",
    ageRequirementText: "يجب أن تكون في عمر 18 سنة أو أكثر لاستخدام PNPtv!. بالاستمرار في استخدام هذه المنصة، تؤكد أنك في عمر 18 سنة على الأقل.",
    prohibitedContentTitle: "المحتوى التالي محظور تماماً:",
    prohibitedItems: [
      "المحتوى الذي يشمل القاصرين في أي سياق",
      "المحتوى غير المتوافق عليه أو أي شكل من أشكال الإكراه",
      "التحرش والتهديد وكشف الهوية الشخصية أو خطاب الكراهية",
      "بيع المخدرات غير المشروعة أو الاتجار بها أو التجنيد لها",
      "البريد العشوائي والاحتيال والتصيد الاحتيالي أو انتحال الشخصية",
      "مشاركة المحتوى الخاص دون موافقة صاحبه",
    ] as const,
    violationsNote:
      "ستؤدي الانتهاكات إلى إنهاء الحساب فوراً وستُبلَّغ عنها الجهات المختصة. نراقب المحتوى بشكل نشط ونتعاون بالكامل مع جهات إنفاذ القانون. باستخدام PNPtv!، تقبل الالتزام بهذه القواعد.",
    violationsImmediateTermination: "إنهاء الحساب فوراً",
    violationsReportedAuthorities: "تُبلَّغ عنها الجهات المختصة",

    exploreFeaturesHeading: "استكشاف الميزات",
    featureCards: [
      {
        title: "الوسائط",
        desc: "مقاطع الفيديو والموسيقى والبودكاست. تصفح محتوى PRIME الحصري وأنشئ قوائم التشغيل الخاصة بك.",
      },
      {
        title: "Hangouts",
        desc: "غرف مكالمات الفيديو المجتمعية. انضم إلى مجموعات عامة أو أنشئ hangouts خاصة مع الأصدقاء.",
      },
      {
        title: "PNP Live",
        desc: "بث مباشر وتسجيلات حصرية. شاهد العروض في الوقت الفعلي وأرسل الإكراميات.",
      },
      {
        title: "التغذية الاجتماعية",
        desc: "انشر المحتوى وأعجب وأعد النشر وعلّق. تواصل مع المجتمع.",
      },
      {
        title: "القريب مني",
        desc: "اكتشف الأعضاء والأماكن القريبة منك. فعّل الموقع لترى من حولك.",
      },
      {
        title: "الرسائل المباشرة",
        desc: "أرسل رسائل خاصة لأي عضو. شارك النصوص والصور ومقاطع الفيديو.",
      },
      {
        title: "الملف الشخصي",
        desc: "خصّص ملفك الشخصي بالسمات والشارات والسيرة الذاتية. اربط Bluesky أو X.",
      },
      {
        title: "قناة PRIME",
        desc: "قناة Telegram حصرية تضم محتوى متميزاً وإعلانات مبكرة.",
      },
    ] as const,

    quickStartTitle: "قائمة التحقق للبدء السريع",
    quickStartItems: [
      "أكمل ملفك الشخصي بصورة وسيرة ذاتية",
      "استكشف محتوى PRIME الحصري",
      "انضم إلى Hangout أو أنشئ مجموعتك الخاصة",
      "انشر أول منشور لك في التغذية الاجتماعية",
      "انضم إلى قناة PRIME على Telegram",
    ] as const,

    explorePnptvCta: "استكشاف PNPtv",
    openTelegramBotCta: "فتح Telegram Bot",

    needHelp: "هل تحتاج إلى مساعدة؟",
    contactSupport: "التواصل مع الدعم",
  },
} as const;

export type WelcomeStrings = typeof strings.en;
export { strings as welcome };
