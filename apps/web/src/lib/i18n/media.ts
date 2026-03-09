const strings = {
  en: {
    // Page meta
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Exclusive PRIME video collection. Watch premium content from top PNPtv creators.",

    // Header
    headerTitle: "PRIME",
    headerSubtitle: "Exclusive video collection",
    videosCount: (n: number) => `${n} videos`,

    // Upsell hero — member variant
    memberBadge: "You're a Member — one step away!",
    upgradeTitle: "Upgrade to PRIME",
    upgradeSubtitle: "Your Member plan doesn't include the video library. Upgrade now and get everything.",
    upgradeCta: "Upgrade to PRIME →",

    // Upsell hero — free variant
    unlockTitle: "Unlock Full Access",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} exclusive videos` : "Exclusive videos"}, live streams, and raw content — all locked behind PRIME.`,
    trialCta: "Start PRIME Trial — $14.99/wk →",
    pricingHint: "Monthly from $24.99 · Lifetime available",

    // Benefits list
    benefitLibrary: "Unlimited access to the full video library",
    benefitHd: "HD streams & raw creator content",
    benefitLive: "Private live rooms & call access",
    benefitCommunity: "Priority community features",
    benefitMemberBonus: "Everything in your current Member plan",
    benefitCancel: "Cancel anytime, no questions asked",

    // Sticky bottom banner
    videosLocked: (n: number) => `${n} videos locked`,
    upgradeToWatch: "Upgrade to PRIME to watch",
    trialFromHint: "Trial from $14.99 · Cancel anytime",
    upgradeBannerCta: "Upgrade",
    getPrimeCta: "Get PRIME",

    // Category filter
    allSeries: "All",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    // Video card
    playingBadge: "PLAYING",
    episodePrefix: "Ep",

    // Active player
    closePlayer: "Close player",

    // States
    loadingError: "Video service is temporarily unavailable. Please try again later.",
    noVideos: "No videos yet",
    noVideosHint: "New content is added regularly. Check back soon!",
  },
  es: {
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Colección exclusiva de videos PRIME. Mira contenido premium de los mejores creadores de PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Colección exclusiva de videos",
    videosCount: (n: number) => `${n} videos`,

    memberBadge: "Eres Member — ¡a un paso!",
    upgradeTitle: "Mejora a PRIME",
    upgradeSubtitle: "Tu plan Member no incluye la videoteca. Mejora ahora y obtén todo.",
    upgradeCta: "Mejora a PRIME →",

    unlockTitle: "Acceso Completo",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} videos exclusivos` : "Videos exclusivos"}, transmisiones en vivo y contenido sin filtro — todo detrás de PRIME.`,
    trialCta: "Prueba PRIME — $14.99/sem →",
    pricingHint: "Mensual desde $24.99 · Disponible de por vida",

    benefitLibrary: "Acceso ilimitado a toda la videoteca",
    benefitHd: "Streams en HD y contenido crudo de creadores",
    benefitLive: "Salas privadas en vivo y acceso a llamadas",
    benefitCommunity: "Funciones de comunidad prioritarias",
    benefitMemberBonus: "Todo lo de tu plan Member actual",
    benefitCancel: "Cancela cuando quieras, sin preguntas",

    videosLocked: (n: number) => `${n} videos bloqueados`,
    upgradeToWatch: "Mejora a PRIME para ver",
    trialFromHint: "Prueba desde $14.99 · Cancela cuando quieras",
    upgradeBannerCta: "Mejorar",
    getPrimeCta: "Obtener PRIME",

    allSeries: "Todos",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "REPRODUCIENDO",
    episodePrefix: "Ep",

    closePlayer: "Cerrar reproductor",

    loadingError: "El servicio de video no está disponible temporalmente. Intenta de nuevo más tarde.",
    noVideos: "Sin videos aún",
    noVideosHint: "Se agrega contenido nuevo regularmente. ¡Vuelve pronto!",
  },
  pt: {
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Coleção exclusiva de vídeos PRIME. Assista conteúdo premium dos melhores criadores da PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Coleção exclusiva de vídeos",
    videosCount: (n: number) => `${n} vídeos`,

    memberBadge: "Você é Member — a um passo!",
    upgradeTitle: "Fazer upgrade para PRIME",
    upgradeSubtitle: "Seu plano Member não inclui a videoteca. Faça upgrade agora e tenha tudo.",
    upgradeCta: "Upgrade para PRIME →",

    unlockTitle: "Acesso Completo",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} vídeos exclusivos` : "Vídeos exclusivos"}, transmissões ao vivo e conteúdo sem filtro — tudo bloqueado pelo PRIME.`,
    trialCta: "Experimentar PRIME — $14.99/sem →",
    pricingHint: "Mensal a partir de $24.99 · Plano vitalício disponível",

    benefitLibrary: "Acesso ilimitado à videoteca completa",
    benefitHd: "Streams em HD e conteúdo bruto dos criadores",
    benefitLive: "Salas privadas ao vivo e acesso a chamadas",
    benefitCommunity: "Recursos prioritários de comunidade",
    benefitMemberBonus: "Tudo do seu plano Member atual",
    benefitCancel: "Cancele a qualquer momento, sem perguntas",

    videosLocked: (n: number) => `${n} vídeos bloqueados`,
    upgradeToWatch: "Faça upgrade para PRIME para assistir",
    trialFromHint: "Trial a partir de $14.99 · Cancele a qualquer momento",
    upgradeBannerCta: "Upgrade",
    getPrimeCta: "Obter PRIME",

    allSeries: "Todos",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "REPRODUZINDO",
    episodePrefix: "Ep",

    closePlayer: "Fechar player",

    loadingError: "O serviço de vídeo está temporariamente indisponível. Tente novamente mais tarde.",
    noVideos: "Sem vídeos ainda",
    noVideosHint: "Novo conteúdo é adicionado regularmente. Volte em breve!",
  },
  zh: {
    pageTitle: "PRIME 媒体 — PNPtv!",
    pageDescription: "PNPtv 顶级创作者的独家 PRIME 视频合集，畅享高级内容。",

    headerTitle: "PRIME",
    headerSubtitle: "独家视频合集",
    videosCount: (n: number) => `${n} 个视频`,

    memberBadge: "您是 Member 会员 — 只差一步！",
    upgradeTitle: "升级至 PRIME",
    upgradeSubtitle: "您的 Member 计划不包含视频库。立即升级，获取所有内容。",
    upgradeCta: "升级至 PRIME →",

    unlockTitle: "解锁完整访问权限",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} 个独家视频` : "独家视频"}、直播以及原始内容 — 全部需要 PRIME 解锁。`,
    trialCta: "开始 PRIME 试用 — $14.99/周 →",
    pricingHint: "月付从 $24.99 起 · 支持终身订阅",

    benefitLibrary: "无限访问完整视频库",
    benefitHd: "高清直播流及创作者原始内容",
    benefitLive: "私人直播间和通话访问权限",
    benefitCommunity: "优先社区功能",
    benefitMemberBonus: "包含您当前 Member 计划的所有权益",
    benefitCancel: "随时取消，无需说明原因",

    videosLocked: (n: number) => `${n} 个视频已锁定`,
    upgradeToWatch: "升级至 PRIME 即可观看",
    trialFromHint: "试用从 $14.99 起 · 随时取消",
    upgradeBannerCta: "升级",
    getPrimeCta: "获取 PRIME",

    allSeries: "全部",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "直播秀",

    playingBadge: "播放中",
    episodePrefix: "第",

    closePlayer: "关闭播放器",

    loadingError: "视频服务暂时不可用，请稍后再试。",
    noVideos: "暂无视频",
    noVideosHint: "新内容定期更新，请稍后回来查看！",
  },
  zhTW: {
    pageTitle: "PRIME 媒體 — PNPtv!",
    pageDescription: "PNPtv 頂尖創作者的獨家 PRIME 影片合集，盡享高級內容。",

    headerTitle: "PRIME",
    headerSubtitle: "獨家影片合集",
    videosCount: (n: number) => `${n} 支影片`,

    memberBadge: "您是 Member 會員 — 只差一步！",
    upgradeTitle: "升級至 PRIME",
    upgradeSubtitle: "您的 Member 方案不含影片庫。立即升級，享有全部內容。",
    upgradeCta: "升級至 PRIME →",

    unlockTitle: "解鎖完整存取權限",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} 支獨家影片` : "獨家影片"}、直播及原始內容 — 全部需要 PRIME 解鎖。`,
    trialCta: "開始 PRIME 試用 — $14.99/週 →",
    pricingHint: "月付從 $24.99 起 · 支援終身訂閱",

    benefitLibrary: "無限存取完整影片庫",
    benefitHd: "高畫質直播及創作者原始內容",
    benefitLive: "私人直播間與通話存取",
    benefitCommunity: "優先社群功能",
    benefitMemberBonus: "包含您目前 Member 方案的所有權益",
    benefitCancel: "隨時取消，無需說明原因",

    videosLocked: (n: number) => `${n} 支影片已鎖定`,
    upgradeToWatch: "升級至 PRIME 即可觀看",
    trialFromHint: "試用從 $14.99 起 · 隨時取消",
    upgradeBannerCta: "升級",
    getPrimeCta: "取得 PRIME",

    allSeries: "全部",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "直播秀",

    playingBadge: "播放中",
    episodePrefix: "第",

    closePlayer: "關閉播放器",

    loadingError: "影片服務暫時無法使用，請稍後再試。",
    noVideos: "暫無影片",
    noVideosHint: "新內容定期更新，請稍後回來查看！",
  },
  fr: {
    pageTitle: "PRIME Médias — PNPtv!",
    pageDescription: "Collection exclusive de vidéos PRIME. Regardez du contenu premium des meilleurs créateurs PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Collection exclusive de vidéos",
    videosCount: (n: number) => `${n} vidéos`,

    memberBadge: "Vous êtes Member — plus qu'un pas !",
    upgradeTitle: "Passer à PRIME",
    upgradeSubtitle: "Votre plan Member n'inclut pas la vidéothèque. Passez à PRIME et accédez à tout.",
    upgradeCta: "Passer à PRIME →",

    unlockTitle: "Accès Complet",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} vidéos exclusives` : "Vidéos exclusives"}, streams en direct et contenu brut — tout verrouillé derrière PRIME.`,
    trialCta: "Essayer PRIME — 14,99 $/sem →",
    pricingHint: "Mensuel dès 24,99 $ · Abonnement à vie disponible",

    benefitLibrary: "Accès illimité à toute la vidéothèque",
    benefitHd: "Streams HD et contenu brut des créateurs",
    benefitLive: "Salons privés en direct et accès aux appels",
    benefitCommunity: "Fonctionnalités communautaires prioritaires",
    benefitMemberBonus: "Tout ce que comprend votre plan Member actuel",
    benefitCancel: "Annulez à tout moment, sans questions",

    videosLocked: (n: number) => `${n} vidéos verrouillées`,
    upgradeToWatch: "Passez à PRIME pour regarder",
    trialFromHint: "Essai dès 14,99 $ · Annulation à tout moment",
    upgradeBannerCta: "Mettre à niveau",
    getPrimeCta: "Obtenir PRIME",

    allSeries: "Tout",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "EN LECTURE",
    episodePrefix: "Ép",

    closePlayer: "Fermer le lecteur",

    loadingError: "Le service vidéo est temporairement indisponible. Veuillez réessayer plus tard.",
    noVideos: "Aucune vidéo pour l'instant",
    noVideosHint: "Du nouveau contenu est ajouté régulièrement. Revenez bientôt !",
  },
  de: {
    pageTitle: "PRIME Medien — PNPtv!",
    pageDescription: "Exklusive PRIME-Videosammlung. Schau Premium-Inhalte der besten PNPtv-Creator.",

    headerTitle: "PRIME",
    headerSubtitle: "Exklusive Videosammlung",
    videosCount: (n: number) => `${n} Videos`,

    memberBadge: "Du bist Member — nur noch ein Schritt!",
    upgradeTitle: "Upgrade auf PRIME",
    upgradeSubtitle: "Dein Member-Plan enthält keine Videobibliothek. Upgrade jetzt und erhalte alles.",
    upgradeCta: "Upgrade auf PRIME →",

    unlockTitle: "Vollständigen Zugang freischalten",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} exklusive Videos` : "Exklusive Videos"}, Livestreams und unzensierte Inhalte — alles hinter PRIME gesperrt.`,
    trialCta: "PRIME testen — 14,99 $/Woche →",
    pricingHint: "Monatlich ab 24,99 $ · Lifetime-Abo verfügbar",

    benefitLibrary: "Unbegrenzter Zugang zur vollständigen Videobibliothek",
    benefitHd: "HD-Streams & rohe Creator-Inhalte",
    benefitLive: "Private Live-Räume & Anrufzugang",
    benefitCommunity: "Priorisierte Community-Funktionen",
    benefitMemberBonus: "Alles aus deinem aktuellen Member-Plan",
    benefitCancel: "Jederzeit kündigen, keine Fragen",

    videosLocked: (n: number) => `${n} Videos gesperrt`,
    upgradeToWatch: "Upgrade auf PRIME zum Ansehen",
    trialFromHint: "Probe ab 14,99 $ · Jederzeit kündigen",
    upgradeBannerCta: "Upgrade",
    getPrimeCta: "PRIME holen",

    allSeries: "Alle",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "WIRD ABGESPIELT",
    episodePrefix: "Folge",

    closePlayer: "Player schließen",

    loadingError: "Der Videodienst ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.",
    noVideos: "Noch keine Videos",
    noVideosHint: "Neue Inhalte werden regelmäßig hinzugefügt. Schau bald wieder vorbei!",
  },
  th: {
    pageTitle: "PRIME มีเดีย — PNPtv!",
    pageDescription: "คอลเลกชันวิดีโอ PRIME สุดพิเศษ ชมคอนเทนต์พรีเมียมจากครีเอเตอร์ชั้นนำของ PNPtv",

    headerTitle: "PRIME",
    headerSubtitle: "คอลเลกชันวิดีโอสุดพิเศษ",
    videosCount: (n: number) => `${n} วิดีโอ`,

    memberBadge: "คุณเป็น Member แล้ว — อีกแค่ก้าวเดียว!",
    upgradeTitle: "อัปเกรดเป็น PRIME",
    upgradeSubtitle: "แผน Member ของคุณไม่รวมคลังวิดีโอ อัปเกรดตอนนี้และรับสิทธิ์ทุกอย่าง",
    upgradeCta: "อัปเกรดเป็น PRIME →",

    unlockTitle: "ปลดล็อกการเข้าถึงแบบเต็ม",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `วิดีโอสุดพิเศษ ${count} รายการ` : "วิดีโอสุดพิเศษ"} ไลฟ์สตรีม และเนื้อหาดิบ — ทั้งหมดต้องใช้ PRIME`,
    trialCta: "ทดลอง PRIME — $14.99/สัปดาห์ →",
    pricingHint: "รายเดือนเริ่มต้น $24.99 · มีแบบตลอดชีพ",

    benefitLibrary: "เข้าถึงคลังวิดีโอทั้งหมดไม่จำกัด",
    benefitHd: "สตรีม HD และเนื้อหาดิบจากครีเอเตอร์",
    benefitLive: "ห้องไลฟ์ส่วนตัวและการเข้าถึงการโทร",
    benefitCommunity: "ฟีเจอร์คอมมูนิตี้แบบพิเศษ",
    benefitMemberBonus: "ทุกอย่างในแผน Member ปัจจุบันของคุณ",
    benefitCancel: "ยกเลิกเมื่อไหร่ก็ได้ ไม่มีคำถาม",

    videosLocked: (n: number) => `${n} วิดีโอถูกล็อก`,
    upgradeToWatch: "อัปเกรดเป็น PRIME เพื่อดู",
    trialFromHint: "ทดลองใช้ตั้งแต่ $14.99 · ยกเลิกเมื่อไหร่ก็ได้",
    upgradeBannerCta: "อัปเกรด",
    getPrimeCta: "รับ PRIME",

    allSeries: "ทั้งหมด",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "กำลังเล่น",
    episodePrefix: "ตอน",

    closePlayer: "ปิดเครื่องเล่น",

    loadingError: "บริการวิดีโอไม่พร้อมใช้งานชั่วคราว โปรดลองอีกครั้งในภายหลัง",
    noVideos: "ยังไม่มีวิดีโอ",
    noVideosHint: "มีการเพิ่มเนื้อหาใหม่เป็นประจำ กลับมาดูเร็ว ๆ นี้!",
  },
  it: {
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Collezione esclusiva di video PRIME. Guarda contenuti premium dei migliori creator di PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Collezione esclusiva di video",
    videosCount: (n: number) => `${n} video`,

    memberBadge: "Sei Member — manca un solo passo!",
    upgradeTitle: "Passa a PRIME",
    upgradeSubtitle: "Il tuo piano Member non include la videoteca. Fai l'upgrade ora e accedi a tutto.",
    upgradeCta: "Passa a PRIME →",

    unlockTitle: "Accesso Completo",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} video esclusivi` : "Video esclusivi"}, live stream e contenuti raw — tutto bloccato da PRIME.`,
    trialCta: "Prova PRIME — $14,99/sett →",
    pricingHint: "Mensile da $24,99 · Disponibile a vita",

    benefitLibrary: "Accesso illimitato all'intera videoteca",
    benefitHd: "Stream HD e contenuti raw dei creator",
    benefitLive: "Stanze private in live e accesso alle chiamate",
    benefitCommunity: "Funzionalità community in primo piano",
    benefitMemberBonus: "Tutto del tuo piano Member attuale",
    benefitCancel: "Cancella quando vuoi, senza domande",

    videosLocked: (n: number) => `${n} video bloccati`,
    upgradeToWatch: "Passa a PRIME per guardare",
    trialFromHint: "Trial da $14,99 · Cancella quando vuoi",
    upgradeBannerCta: "Upgrade",
    getPrimeCta: "Ottieni PRIME",

    allSeries: "Tutti",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "IN RIPRODUZIONE",
    episodePrefix: "Ep",

    closePlayer: "Chiudi player",

    loadingError: "Il servizio video è temporaneamente non disponibile. Riprova più tardi.",
    noVideos: "Nessun video ancora",
    noVideosHint: "Nuovi contenuti vengono aggiunti regolarmente. Torna presto!",
  },
  tr: {
    pageTitle: "PRIME Medya — PNPtv!",
    pageDescription: "Özel PRIME video koleksiyonu. PNPtv'nin en iyi içerik üreticilerinden premium içerikler izleyin.",

    headerTitle: "PRIME",
    headerSubtitle: "Özel video koleksiyonu",
    videosCount: (n: number) => `${n} video`,

    memberBadge: "Member'sınız — sadece bir adım kaldı!",
    upgradeTitle: "PRIME'a Yükselt",
    upgradeSubtitle: "Member planınız video kütüphanesini içermiyor. Şimdi yükseltin ve her şeye erişin.",
    upgradeCta: "PRIME'a Yükselt →",

    unlockTitle: "Tam Erişimi Aç",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} özel video` : "Özel videolar"}, canlı yayınlar ve ham içerikler — tümü PRIME ile kilitli.`,
    trialCta: "PRIME'ı Dene — $14,99/hafta →",
    pricingHint: "Aylık $24,99'dan başlıyor · Ömür boyu seçeneği mevcut",

    benefitLibrary: "Tüm video kütüphanesine sınırsız erişim",
    benefitHd: "HD yayınlar ve ham içerik üretici içerikleri",
    benefitLive: "Özel canlı odalar ve arama erişimi",
    benefitCommunity: "Öncelikli topluluk özellikleri",
    benefitMemberBonus: "Mevcut Member planınızdaki her şey",
    benefitCancel: "İstediğiniz zaman iptal edin, soru sorulmaz",

    videosLocked: (n: number) => `${n} video kilitli`,
    upgradeToWatch: "İzlemek için PRIME'a yükseltin",
    trialFromHint: "Deneme $14,99'dan · İstediğiniz zaman iptal",
    upgradeBannerCta: "Yükselt",
    getPrimeCta: "PRIME Al",

    allSeries: "Tümü",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "OYNATILIYOR",
    episodePrefix: "Bl",

    closePlayer: "Oynatıcıyı kapat",

    loadingError: "Video hizmeti geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.",
    noVideos: "Henüz video yok",
    noVideosHint: "Düzenli olarak yeni içerik ekleniyor. Yakında tekrar kontrol edin!",
  },
  ru: {
    pageTitle: "PRIME Медиа — PNPtv!",
    pageDescription: "Эксклюзивная коллекция видео PRIME. Смотрите премиум-контент от лучших создателей PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Эксклюзивная коллекция видео",
    videosCount: (n: number) => `${n} видео`,

    memberBadge: "Вы Member — остался один шаг!",
    upgradeTitle: "Перейти на PRIME",
    upgradeSubtitle: "Ваш план Member не включает видеотеку. Перейдите на PRIME сейчас и получите всё.",
    upgradeCta: "Перейти на PRIME →",

    unlockTitle: "Открыть полный доступ",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} эксклюзивных видео` : "Эксклюзивные видео"}, прямые трансляции и контент без ограничений — всё за PRIME.`,
    trialCta: "Попробовать PRIME — $14,99/нед →",
    pricingHint: "Ежемесячно от $24,99 · Пожизненная подписка доступна",

    benefitLibrary: "Неограниченный доступ ко всей видеотеке",
    benefitHd: "HD-трансляции и сырой контент создателей",
    benefitLive: "Приватные прямые эфиры и доступ к звонкам",
    benefitCommunity: "Приоритетные функции сообщества",
    benefitMemberBonus: "Всё из вашего текущего плана Member",
    benefitCancel: "Отмена в любое время, без вопросов",

    videosLocked: (n: number) => `${n} видео заблокировано`,
    upgradeToWatch: "Перейдите на PRIME для просмотра",
    trialFromHint: "Пробный период от $14,99 · Отмена в любое время",
    upgradeBannerCta: "Улучшить",
    getPrimeCta: "Получить PRIME",

    allSeries: "Все",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "ВОСПРОИЗВОДИТСЯ",
    episodePrefix: "Эп",

    closePlayer: "Закрыть плеер",

    loadingError: "Видеосервис временно недоступен. Пожалуйста, повторите попытку позже.",
    noVideos: "Видео пока нет",
    noVideosHint: "Новый контент добавляется регулярно. Заходите скоро!",
  },
  nl: {
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Exclusieve PRIME-videocollectie. Bekijk premiuminhoud van de beste PNPtv-creators.",

    headerTitle: "PRIME",
    headerSubtitle: "Exclusieve videocollectie",
    videosCount: (n: number) => `${n} video's`,

    memberBadge: "Je bent Member — nog één stap!",
    upgradeTitle: "Upgraden naar PRIME",
    upgradeSubtitle: "Je Member-abonnement bevat de videobibliotheek niet. Upgrade nu en krijg alles.",
    upgradeCta: "Upgraden naar PRIME →",

    unlockTitle: "Volledige toegang ontgrendelen",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} exclusieve video's` : "Exclusieve video's"}, livestreams en onbewerkte inhoud — alles achter PRIME vergrendeld.`,
    trialCta: "PRIME proberen — $14,99/week →",
    pricingHint: "Maandelijks vanaf $24,99 · Levenslang beschikbaar",

    benefitLibrary: "Onbeperkte toegang tot de volledige videobibliotheek",
    benefitHd: "HD-streams en onbewerkte creatorsinhoud",
    benefitLive: "Privé-liveruimtes & beloegang",
    benefitCommunity: "Prioritaire communityfuncties",
    benefitMemberBonus: "Alles uit je huidige Member-abonnement",
    benefitCancel: "Op elk moment opzeggen, zonder vragen",

    videosLocked: (n: number) => `${n} video's vergrendeld`,
    upgradeToWatch: "Upgrade naar PRIME om te kijken",
    trialFromHint: "Proef vanaf $14,99 · Op elk moment opzeggen",
    upgradeBannerCta: "Upgraden",
    getPrimeCta: "PRIME halen",

    allSeries: "Alle",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "WORDT AFGESPEELD",
    episodePrefix: "Afl",

    closePlayer: "Speler sluiten",

    loadingError: "De videoservice is tijdelijk niet beschikbaar. Probeer het later opnieuw.",
    noVideos: "Nog geen video's",
    noVideosHint: "Er wordt regelmatig nieuwe inhoud toegevoegd. Kom snel terug!",
  },
  vi: {
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Bộ sưu tập video PRIME độc quyền. Xem nội dung cao cấp từ những creator hàng đầu của PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Bộ sưu tập video độc quyền",
    videosCount: (n: number) => `${n} video`,

    memberBadge: "Bạn là Member — chỉ còn một bước nữa!",
    upgradeTitle: "Nâng cấp lên PRIME",
    upgradeSubtitle: "Gói Member của bạn không bao gồm thư viện video. Nâng cấp ngay và nhận tất cả.",
    upgradeCta: "Nâng cấp lên PRIME →",

    unlockTitle: "Mở khóa toàn bộ quyền truy cập",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} video độc quyền` : "Video độc quyền"}, phát trực tiếp và nội dung thô — tất cả bị khóa sau PRIME.`,
    trialCta: "Dùng thử PRIME — $14.99/tuần →",
    pricingHint: "Hàng tháng từ $24.99 · Có sẵn gói trọn đời",

    benefitLibrary: "Truy cập không giới hạn toàn bộ thư viện video",
    benefitHd: "Luồng HD & nội dung thô từ creator",
    benefitLive: "Phòng trực tiếp riêng tư & quyền truy cập cuộc gọi",
    benefitCommunity: "Tính năng cộng đồng ưu tiên",
    benefitMemberBonus: "Tất cả quyền lợi trong gói Member hiện tại của bạn",
    benefitCancel: "Hủy bất cứ lúc nào, không cần giải thích",

    videosLocked: (n: number) => `${n} video bị khóa`,
    upgradeToWatch: "Nâng cấp lên PRIME để xem",
    trialFromHint: "Dùng thử từ $14.99 · Hủy bất cứ lúc nào",
    upgradeBannerCta: "Nâng cấp",
    getPrimeCta: "Lấy PRIME",

    allSeries: "Tất cả",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "ĐANG PHÁT",
    episodePrefix: "Tập",

    closePlayer: "Đóng trình phát",

    loadingError: "Dịch vụ video tạm thời không khả dụng. Vui lòng thử lại sau.",
    noVideos: "Chưa có video",
    noVideosHint: "Nội dung mới được thêm thường xuyên. Quay lại sớm nhé!",
  },
  ja: {
    pageTitle: "PRIME メディア — PNPtv!",
    pageDescription: "PNPtvトップクリエイターによる独占PRIMEビデオコレクション。プレミアムコンテンツをお楽しみください。",

    headerTitle: "PRIME",
    headerSubtitle: "独占ビデオコレクション",
    videosCount: (n: number) => `${n} 本`,

    memberBadge: "Memberです — あと一歩！",
    upgradeTitle: "PRIMEにアップグレード",
    upgradeSubtitle: "MemberプランにはビデオライブラリーFが含まれていません。今すぐアップグレードしてすべてにアクセスしましょう。",
    upgradeCta: "PRIMEにアップグレード →",

    unlockTitle: "フルアクセスを解放",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `独占動画 ${count} 本` : "独占動画"}、ライブストリーム、未編集コンテンツ — すべてPRIMEが必要です。`,
    trialCta: "PRIMEを試す — $14.99/週 →",
    pricingHint: "月額$24.99から · 生涯プランあり",

    benefitLibrary: "全ビデオライブラリーへ無制限アクセス",
    benefitHd: "HDストリームとクリエイターの生コンテンツ",
    benefitLive: "プライベートライブルームと通話アクセス",
    benefitCommunity: "コミュニティ機能への優先アクセス",
    benefitMemberBonus: "現在のMemberプランのすべての特典",
    benefitCancel: "いつでもキャンセル可能、理由不要",

    videosLocked: (n: number) => `${n} 本のビデオがロック中`,
    upgradeToWatch: "視聴するにはPRIMEにアップグレード",
    trialFromHint: "トライアル$14.99から · いつでもキャンセル",
    upgradeBannerCta: "アップグレード",
    getPrimeCta: "PRIMEを取得",

    allSeries: "すべて",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "再生中",
    episodePrefix: "第",

    closePlayer: "プレイヤーを閉じる",

    loadingError: "ビデオサービスは一時的に利用できません。後でもう一度お試しください。",
    noVideos: "動画はまだありません",
    noVideosHint: "新しいコンテンツが定期的に追加されます。またすぐ確認してください！",
  },
  id: {
    pageTitle: "PRIME Media — PNPtv!",
    pageDescription: "Koleksi video PRIME eksklusif. Tonton konten premium dari kreator terbaik PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "Koleksi video eksklusif",
    videosCount: (n: number) => `${n} video`,

    memberBadge: "Anda adalah Member — tinggal selangkah lagi!",
    upgradeTitle: "Upgrade ke PRIME",
    upgradeSubtitle: "Paket Member Anda tidak menyertakan perpustakaan video. Upgrade sekarang dan dapatkan segalanya.",
    upgradeCta: "Upgrade ke PRIME →",

    unlockTitle: "Buka Akses Penuh",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} video eksklusif` : "Video eksklusif"}, siaran langsung, dan konten mentah — semua terkunci di balik PRIME.`,
    trialCta: "Coba PRIME — $14.99/minggu →",
    pricingHint: "Bulanan mulai $24.99 · Tersedia seumur hidup",

    benefitLibrary: "Akses tak terbatas ke seluruh perpustakaan video",
    benefitHd: "Stream HD & konten mentah dari kreator",
    benefitLive: "Ruang live pribadi & akses panggilan",
    benefitCommunity: "Fitur komunitas prioritas",
    benefitMemberBonus: "Semua yang ada di paket Member Anda saat ini",
    benefitCancel: "Batalkan kapan saja, tanpa pertanyaan",

    videosLocked: (n: number) => `${n} video dikunci`,
    upgradeToWatch: "Upgrade ke PRIME untuk menonton",
    trialFromHint: "Uji coba mulai $14.99 · Batalkan kapan saja",
    upgradeBannerCta: "Upgrade",
    getPrimeCta: "Dapatkan PRIME",

    allSeries: "Semua",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "DIPUTAR",
    episodePrefix: "Ep",

    closePlayer: "Tutup pemutar",

    loadingError: "Layanan video sementara tidak tersedia. Silakan coba lagi nanti.",
    noVideos: "Belum ada video",
    noVideosHint: "Konten baru ditambahkan secara rutin. Kembali lagi segera!",
  },
  ar: {
    pageTitle: "PRIME ميديا — PNPtv!",
    pageDescription: "مجموعة فيديو PRIME حصرية. شاهد محتوى مميزاً من أفضل منشئي المحتوى في PNPtv.",

    headerTitle: "PRIME",
    headerSubtitle: "مجموعة فيديو حصرية",
    videosCount: (n: number) => `${n} فيديو`,

    memberBadge: "أنت عضو Member — خطوة واحدة فقط!",
    upgradeTitle: "الترقية إلى PRIME",
    upgradeSubtitle: "خطتك Member لا تتضمن مكتبة الفيديو. قم بالترقية الآن واحصل على كل شيء.",
    upgradeCta: "الترقية إلى PRIME →",

    unlockTitle: "فتح الوصول الكامل",
    unlockSubtitle: (count: number) =>
      `${count > 0 ? `${count} فيديو حصري` : "فيديوهات حصرية"} وبث مباشر ومحتوى خام — كل ذلك مقفل خلف PRIME.`,
    trialCta: "جرّب PRIME — $14.99/أسبوع →",
    pricingHint: "شهرياً من $24.99 · الاشتراك مدى الحياة متاح",

    benefitLibrary: "وصول غير محدود إلى مكتبة الفيديو الكاملة",
    benefitHd: "بث بجودة HD ومحتوى خام من المنشئين",
    benefitLive: "غرف بث مباشر خاصة وإمكانية الاتصال",
    benefitCommunity: "ميزات مجتمعية ذات أولوية",
    benefitMemberBonus: "كل شيء في خطة Member الحالية",
    benefitCancel: "الإلغاء في أي وقت دون أسئلة",

    videosLocked: (n: number) => `${n} فيديو مقفل`,
    upgradeToWatch: "قم بالترقية إلى PRIME للمشاهدة",
    trialFromHint: "تجربة من $14.99 · الإلغاء في أي وقت",
    upgradeBannerCta: "ترقية",
    getPrimeCta: "احصل على PRIME",

    allSeries: "الكل",
    categoryClouding: "Clouding",
    categorySlamming: "Slamming",
    categoryLiveShow: "Live Show",

    playingBadge: "قيد التشغيل",
    episodePrefix: "حلقة",

    closePlayer: "إغلاق المشغل",

    loadingError: "خدمة الفيديو غير متاحة مؤقتاً. يرجى المحاولة مرة أخرى لاحقاً.",
    noVideos: "لا توجد فيديوهات بعد",
    noVideosHint: "يتم إضافة محتوى جديد بانتظام. تفقد مجدداً قريباً!",
  },
} as const;

export type MediaStrings = typeof strings.en;
export { strings as media };
