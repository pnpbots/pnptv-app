/**
 * Internationalization (i18n) utility for PNPtv Telegram Bot
 * Supports English and Spanish
 */

const translations = {
  en: {
        groupRedirect: ({ username, command, botUsername }) =>
          `@${username} I sent you a private message about your request. Please check it out. We do this for privacy reasons and to comply with our Group's anti-spam policy.\n\n[Open in private chat with your request](https://t.me/${botUsername}?start=${command})`,
    // General
    welcome: '👋 Welcome to PNPtv!',
      welcomeScreen: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n          Welcome to PNPtv! Premium\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nThis is your control dashboard.\nFrom here, you can access all your premium features:\nopen Call Rooms, start live streams, watch full videos,\nexplore Nearby without limits, and join private events.`,
      welcomeScreenFree: `PNPtv!\n------------\n\nWelcome to PNPtv!  \nEnjoy the full experience from here.\n\nUnlock all premium features:\n• Full videos  \n• Live streams  \n• Unlimited Nearby  \n• Call Rooms  \n• Private community events\n\nTap "Subscribe to PRIME" below to get instant access.`,
    back: '🔙 Back',
    cancel: '❌ Cancel',
    next: '➡️ Next',
    confirm: '✅ Confirm',
    error: '❌ An error occurred. Please try again.',
    openingChat: 'Opening chat...', 
    userNoUsername: 'This user doesn\'t have a username. You can search for them manually.',
    errorOpeningChat: 'Could not open chat. Please try manually.',
    success: '✅ Success!',
    loading: '⏳ Loading...', 
    days: 'days',

    // Onboarding
    selectLanguage: 'Please select your language:',
    languageSelected: 'Language set to English 🇺🇸',
    ageConfirmation: 'Are you 18 years or older?',
    ageConfirmYes: 'Yes, I am 18+',
    ageConfirmNo: 'No',
    underAge: 'Sorry, you must be 18 or older to use this service.',
    termsAndPrivacy: 'Please read and accept our Terms of Service and Privacy Policy:',
    termsAccepted: 'Terms and Privacy Policy accepted ✅',
    emailPrompt: '📧 Please provide your email address:',
    emailRequiredNote: '⚠️ Email is required to complete your registration. We need your email in case the community gets deleted for reasons out of our control, so we can communicate with you and provide important updates.',
    emailReceived: 'Email saved successfully!',
    onboardingComplete: '🎉 Welcome aboard! Your profile is all set. Use /menu to get started.',

    // Main Menu
    mainMenuIntro: '🎬 Welcome to PNPtv - Your Entertainment Hub!\n\nWhat would you like to do?',
    mainMenuIntroFree: `\`🔒 UNLOCK ALL CONTENT\`

Hey {username}, you're on the FREE version.

**With PRIME you get unlimited access to:**

🎬 Full videos & exclusive shows
📍 Find papis near you (Nearby)
🎥 Live video rooms 24/7
💬 Priority chat & support

**Go PRIME now and enjoy everything!**

\`Passes starting at just $14.99 USD\``,
    subscribe: `Subscribe to PNPtv PRIME\n----------------------------------\n\nJoin the most intense PNP content platform created by and for the community.\n\nPRIME gives you full access to:\n• Full-length PNP videos with real latinos smoking and slamming  \n• Exclusive releases starring Santino (x.com/pnpmethdaddy)  \n• Live streams and Call Rooms.\n• Unlimited Nearby to explore users around you  \n• Complete music and podcast library  \n\nChoose the plan that fits you best and complete your payment.\nYour membership will be activated automatically.\n\nPayment methods available: debit/credit card, Crypto, and most popular payment apps.`,
    upgradeToPrime: '💎 Upgrade to PRIME',
    exploreFeatures: '✨ Explore Premium Features',
    specialOffers: '🔥 Special Offers',
    myProfile: '👤 My Profile',
    nearbyUsers: '🌍 Nearby Users',
    liveStreams: '🎤 Live Streams',
    playerMenu: '🎵 Media Player',
    callRooms: '🎥 Call Rooms',
    support: '🤖 Support',
    settings: '⚙️ Settings',
    // Subscription
    subscriptionHeader: '`💎 Subscribe to PNPtv! PRIME`',
    subscriptionDivider: '',
    subscriptionDescription: `Unlock the full PNPtv! experience and join the hottest Latino community smoking & slamming on Telegram.
Choose your plan and get instant access to all premium features:

🔥 Full access to all PRIME channels
🔥 PNPtv Community Group
🔥 Long-session videos + weekly new releases
🔥 Santino's full videography
🔥 Nearby feature (unlimited)
🔥 Live Streams & Video Rooms
🔥 Profile Card with photo, badges & bio

Tap a plan below to activate your membership instantly. 💜`,
    subscriptionPlans: '💎 Choose Your PRIME Plan:',
      planCrystal: '💎 Crystal Pass - $49.99/180 days',
      planCrystalDesc: 'Half a year of complete access to the PNPtv! community. Includes:\n\n• Unlimited access to all PNPtv! channels and groups\n• Full videography of Santino plus Latino chem sessions\n• Long-duration videos with weekly new releases\n• Invites to Call rooms and Live Stream PNP shows\n• Unlimited Nearby access\n• Access to community events and private sessions\n• Early access to upcoming features',
      planDiamond: '💎 Diamond Pass - $99.99/365 days',
      planDiamondDesc: 'One full year of the PNPtv! experience with all premium features included. Includes:\n\n• Unlimited access to every PNPtv! channel and group\n• Complete videography of Santino plus Latino smoking/slamming videos\n• Long-session videos and weekly exclusive releases\n• Invitations to Call rooms, private streams, and community events\n• Unlimited Nearby access\n• Ability to host and schedule your own Call sessions\n• VIP support and special member badges',
      planLifetime: '♾️ Lifetime Pass - $249.99',
      planLifetimeDesc: 'The ultimate PNPtv! pass with permanent, unlimited access. Includes:\n\n• Lifetime access to all PNPtv! channels, groups, and community features\n• Full videography of Santino plus all future videos and releases\n• Long-duration sessions with new uploads every week\n• Invitations to Call rooms, private shows, and exclusive events\n• Unlimited Nearby access\n• Ability to host and schedule Call sessions anytime\n• Permanent VIP support and lifetime member status',
    planMonthly: '🗓️ Monthly Pass - $24.99/30 days',
    planMonthlyDesc: 'Our most popular plan with full access and no limits. Includes:\n\n• Unlimited access to all PNPtv! channels and group\n• Full videography of Santino plus sexy Latinos smoking and slamming\n• Long-session videos with weekly new releases\n• Invites to Call rooms and Live Stream PNP shows\n• Unlimited Nearby access\n• Profile card with photo, badges and bio',
    planTrial: '⭐ Trial Week',

    planDetails: 'Plan Details:',
    selectPlan: 'Select Plan',
    paymentMethod: 'Choose payment method:',
    payWithEpayco: '💳 Pay with Debit/Credit Card',
    payWithDaimo: '🪙 Pay with Crypto and Payment Apps',
    paymentFooter: '\n\n🔒 *No recurring payments* • 🕶️ *Discreet billing* • ✅ *100% guaranteed membership*',
    paymentInstructions: '💳 *Payment Instructions*\n\n' 
      + 'Please tap the button below to go to the checkout page.\n' 
      + 'There you\'ll be able to review the price, plan details, and all benefits included before confirming your purchase.\n\n' 
      + 'After confirming, you will be redirected to ePayco\'s secure payment gateway, where you can pay using:\n\n' 
      + '• Debit card\n' 
      + '• Credit card\n\n' 
      + '*Please remember:*\n\n' 
      + '• The charge will appear on your bank statement as Easy Bots\n' 
      + '• You can review our Terms, Conditions, and Refund Policy at:\n' 
      + 'www.pnptv.app/terms\n\n' 
      + 'If you need help, Cristina — our AI assistant — is here to guide you.',
    payment_confirmation: '✅ **Order Summary**\n\n' 
      + '📦 Plan: {planName}\n' 
      + '💰 Price: ${price}/month\n' 
      + '⏱️ Duration: {duration} day(s)\n\n' 
      + '⚠️ **Important Notes:**\n' 
      + '• This is a ONE-TIME payment\n' 
      + '• ❌ Recurring payments are OFF\n' 
      + '• We will NOT charge your card next month\n' 
      + '• You\'ll receive a reminder before renewal\n\n' 
      + 'Click "Pay Now" to complete your purchase.',
    paymentSuccess: '✅ Payment successful! Your PRIME subscription is now active. ' 
      + 'Enjoy premium features!',
    paymentFailed: '❌ Payment failed. Please try again or contact support.',
    subscriptionActive: 'Your subscription is active until {expiry}',
    subscriptionExpired: 'Your subscription has expired. Please renew to continue enjoying PRIME features.',

    // Profile
    profileTitle: '👤 Your Profile',
    editProfile: '✏️ Edit Profile',
    editPhoto: '📸 Change Photo',
    editBio: '📝 Edit Bio',
    editLocation: '📍 Update Location',
    editInterests: '🎯 Edit Interests',
    privacySettings: '🔒 Privacy Settings',
    sendPhoto: 'Please send your new profile photo:',
    photoUpdated: 'Profile photo updated successfully!',
    sendBio: 'Please send your new bio (max 500 characters):',
    bioUpdated: 'Bio updated successfully!',
    sendLocation: 'Please share your location:',
    locationUpdated: 'Location updated successfully!',
    sendInterests: 'Please send your interests (comma-separated, max 10):',
    interestsUpdated: 'Interests updated successfully!',
    profileViews: 'Profile Views: {views}',
    memberSince: 'Member since: {date}',
    addToFavorites: '⭐ Add to Favorites',
    removeFromFavorites: '❌ Remove from Favorites',
    blockUser: '🚫 Block User',
    unblockUser: '✅ Unblock User',
    userBlocked: 'User has been blocked.',
    userUnblocked: 'User has been unblocked.',
    addedToFavorites: 'User added to your favorites!',
    removedFromFavorites: 'User removed from your favorites.',
    myFavorites: '⭐ My Favorites',
    noFavorites: 'You have no favorites yet.',
    blockedUsers: '🚫 Blocked Users',
    welcomeScreenPrime: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n          Welcome to PNPtv PRIME!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nThis is your PRIME dashboard.\nFrom here you can access all your premium features:\nopen Video Rooms, start live streams, watch full videos,\nexplore Nearby without limits, and join private events.`,
    noBlockedUsers: 'You have no blocked users.',
    shareProfile: '📤 Share Profile',
    profileShared: 'Profile card created! Tap to share it.',
    shareProfileCard: 'Share My Profile Card',
    privacyTitle: '🔒 Privacy Settings',
    showLocation: '📍 Show my location',
    showInterests: '🎯 Show my interests',
    showBio: '📝 Show my bio',
    allowMessages: '💬 Allow messages from others',
    showOnline: '🟢 Show when I\'m online',
    privacyUpdated: 'Privacy settings updated successfully!',
    viewUserProfile: 'View Profile',
    userNotFound: 'User not found.',
    cannotViewProfile: 'You cannot view this profile.',
    badges: {
      verified: '✅ Verified',
      premium: '💎 Premium',
      vip: '👑 VIP',
      moderator: '🛡️ Moderator',
      admin: '👨‍💼 Admin',
    },

    // Nearby Users
    nearbyTitle: '🌍 Find Nearby Users',
    selectRadius: 'Select search radius:',
    radius5km: '📍 5 km',
    radius10km: '📍 10 km',
    radius25km: '📍 25 km',
    noNearbyUsers: 'No users found nearby. Try expanding your search radius.',
    nearbyUsersFound: 'Found {count} users nearby:',
    viewProfile: '👁️ View Profile',
    sendMessage: '💬 Send Message',
    distance: 'Distance: {distance} km',

    // Live Streams
    liveTitle: '`🎤 Live Streams`',
    startLive: '▶️ Start Live Stream',
    viewStreams: '👁️ View Active Streams',
    myStreams: '📹 My Streams',
    enterStreamTitle: 'Enter your stream title:',
    enterStreamDescription: 'Enter stream description (optional):',
    streamPaid: 'Is this a paid stream?',
    streamPrice: 'Enter stream price (USD):',
    streamCreated: '✅ Live stream created successfully!',
    noActiveStreams: 'No active streams at the moment.',
    noStreamsYet: 'You haven\'t created any streams yet.',
    joinStream: '▶️ Join Stream',
    joinedStream: '✅ You joined the stream!',
    leftStream: '👋 You left the stream',
    streamEnded: '🛑 Stream Ended',
    streamNotFound: 'Stream not found',
    streamNotActive: 'This stream is not active',
    streamFull: 'This stream has reached maximum viewers',
    streamLiked: '❤️ Liked!',
    manageStream: 'Manage Stream',
    liveNow: 'Live Now',
    streamHostInstructions: 'Click "Start Broadcasting" to go live. Share your stream link with viewers!',
    streamInstructions: 'Click "Watch Stream" to start viewing. Enjoy!',
    paidStreamNotice: '💰 This is a paid stream',
    paymentIntegrationPending: 'Payment integration coming soon. Free access for now!',
    selectStreamCategory: '📁 Select a category for your stream:',
    browseByCategory: '📁 Browse streams by category:',
    noStreamsInCategory: 'No streams found in this category',
    streamsInCategory: 'Streams',
    streamComments: 'Stream Comments',
    noCommentsYet: 'No comments yet. Be the first to comment!',
    enterComment: 'Type your comment (max 500 characters):',
    commentAdded: 'Comment added successfully!',
    bannedFromCommenting: 'You are banned from commenting on this stream',
    commentsDisabled: 'Comments are disabled for this stream',

    // VOD (Video on Demand)
    availableVODs: 'Available Recordings',
    noVODsAvailable: 'No recordings available yet',
    watchVOD: 'Watch Recording',
    vodNotFound: 'Recording not found',

    // Share
    shareStream: 'Share Stream',
    shareLinkCopied: 'Share link ready!',
    shareInstructions: 'Share this link with your friends or post it on Telegram!',
    shareToTelegram: 'Share to Telegram',

    // Subscribe/Follow
    subscribedToStreamer: '🔔 You will be notified when this streamer goes live!',
    unsubscribedFromStreamer: '🔕 You won\'t receive notifications from this streamer anymore',

    // Media Player
    player: {
      title: 'PNP Media Player',
      description: 'Your complete music and video player',
      browseMusic: 'Music',
      browseVideo: 'Videos',
      myPlaylists: 'My Playlists',
      publicPlaylists: 'Public Playlists',
      trending: 'Trending',
      categories: 'Categories',
      search: 'Search',
      nowPlaying: 'Now Playing',
      music: 'Music',
      video: 'Videos',
      library: 'Library',
      plays: 'plays',
      likes: 'likes',
      tracks: 'tracks',
      followers: 'followers',
      noMedia: 'No media available yet.',
      noPlaylists: 'You don\'t have any playlists yet.',
      noPublicPlaylists: 'No public playlists available.',
      noTrending: 'No trending media at the moment.',
      noCategoryMedia: 'No media in this category.',
      noResults: 'No results found.',
      createPlaylist: 'Create Playlist',
      playlistCreated: 'Playlist created successfully!',
      enterPlaylistName: 'Enter a name for your playlist:',
      enterSearchQuery: 'Enter your search query:',
      searchResults: 'Search Results',
      selectCategory: 'Select a category to browse:',
      mediaNotFound: 'Media not found.',
      playlistNotFound: 'Playlist not found.',
      emptyPlaylist: 'This playlist is empty.',
      nothingPlaying: 'Nothing is playing right now.',
      playing: 'Playing',
      paused: 'Paused',
      stopped: 'Stopped',
      resumed: 'Resumed',
      controls: 'Controls',
      shuffle: 'Shuffle',
      repeat: 'Repeat',
      volume: 'Volume',
      like: 'Like',
      liked: 'Liked!',
      playPlaylist: 'Play Playlist',
      playingPlaylist: 'Playing playlist',
      noQueue: 'No queue available.',
    },

    // Call Rooms
    callTitle: '🎥 Call Rooms',
    // Hangouts (Community Rooms)
    hangouts: {
      title: 'Video Call Rooms',
      description: 'Join community rooms or create private video calls',
      mainRoomActive: 'Main Room Active',
      participants: 'participants',
      mainRoomsTitle: 'Join PNPtv! Main Rooms',
      selectRoom: 'Select a room to join:',
      roomFull: 'This room is full. Please try another room.',
      roomNotActive: 'This room is not currently active.',
      roomNotFound: 'Room not found.',
    },
    // Support
    supportTitle: '`🆘 Help Center`',
    chatWithCristina: '💬 Chat with Cristina (AI)',
    contactAdmin: '👨‍💼 Contact Admin',
    faq: '❓ FAQ',
    cristinaGreeting: 'Hi! I\'m Cristina — your AI friend and support. I\'m an Afro-Latina trans woman and a lesbian, honoring Stonewall and the women who cared for our community during the AIDS crisis. I\'m not a health professional; please seek medical help when needed. How can I help you today?',
    adminMessage: 'Please type your message for our support team:',
    messageSent: 'Your message has been sent to our support team. We\'ll get back to you soon!',

    // Settings
    settingsTitle: '`⚙️ Settings`',
    changeLanguage: '🌐 Change Language',
    notifications: '🔔 Notifications',
    privacy: '🔒 Privacy',
    about: 'ℹ️ About',
    languageChanged: 'Language changed successfully!',

    // Admin
    adminPanel: '👨‍💼 Admin Panel',
    userManagement: '👥 User Management',
    broadcast: '📢 Broadcast Message',
    planManagement: '💎 Plan Management',
    analytics: '📊 Analytics',
    searchUser: 'Enter user ID, username, name, or email to search:',
    userFound: 'User found:',
    extendSubscription: '⏰ Extend Subscription',
    deactivateUser: '🚫 Deactivate User',
    broadcastTarget: 'Select broadcast target:',
    allUsers: '👥 All Users',
    premiumOnly: '💎 Premium Only',
    freeOnly: '🆓 Free Users Only',
    enterBroadcast: 'Enter your broadcast message:',
    broadcastSent: 'Broadcast sent to {count} users!',

    // Errors
    invalidInput: 'Invalid input. Please try again.',
    unauthorized: 'You are not authorized to perform this action.',
    subscriptionRequired: 'This feature requires a PRIME subscription.',
    locationRequired: 'Please share your location first.',
    networkError: 'Network error. Please check your connection and try again.',
    serverError: 'Server error. Please try again later.',

    // Moderation
    moderation: {
      warning: 'Warning',
      user_kicked: 'User Removed',
      group_rules: 'Group Rules',
      no_warnings: 'No Warnings',
      your_warnings: 'Your Warnings',
      username_required: 'Username Required',
      reason: {
        unauthorized_link: 'Unauthorized link detected',
        spam: 'Spam message',
        flooding: 'Sending messages too fast',
        profanity: 'Inappropriate language',
        user_banned: 'User is banned',
        excessive_caps: 'Excessive capital letters',
        excessive_emojis: 'Too many emojis',
        repeated_characters: 'Repeated characters',
        excessive_punctuation: 'Excessive punctuation',
      },
    },

    // PNP Latino messages (English)
    pnpLatinoPrimeMenu: `💎 PNP LATINO PRIME

Enjoy the hottest content with Santino, Lex and other Latinos:
real videos, intense sessions and uncensored PNP vibes, only here on Telegram.

Your PRIME access includes:

📍 Nearby — Community PNP Grindr
🎥 Hangouts — Private and public video rooms
🔴 PNP Television Live — Live shows and events
🎶 Videorama — PNP playlists and podcasts

🤖 Cristina AI — 24/7 Support

💎 Content, connection and PRIME experience.`,
    pnpLatinoFreeMenu: `🆓 PNP LATINO FREE

Join the largest PNP community with Santino, Lex and other Latinos.
Access basic content and connect with the community.

Your FREE access includes:

📍 Nearby — Community PNP Grindr (basic)
🎥 Hangouts — Public video rooms
🎶 Videorama — PNP playlists and podcasts (limited selection)

🤖 Cristina AI — 24/7 Support

💎 Want more? Upgrade to PRIME for exclusive content.`,
  },
  es: {
        groupRedirect: ({ username, command, botUsername }) =>
          `@${username} Te envié un mensaje privado sobre tu solicitud. Por favor revísalo. Esto es por privacidad y para cumplir con la política anti-spam del grupo.\n\n[Abrir en chat privado con tu solicitud](https://t.me/${botUsername}?start=${command})`,
    // General
    welcome: '👋 ¡Bienvenido a PNPtv!',
    welcomeScreen: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n          ¡Bienvenido a PNPtv! Premium\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nEste es tu panel de control.\nDesde aquí puedes acceder a todas tus funciones premium:\nabrir Salas de Video, iniciar transmisiones en vivo, ver videos completos,\nexplore Nearby sin límites y unirte a eventos privados.',
    welcomeScreenFree: `PNPtv!\n------------\n\nBienvenido a PNPtv!  \nDisfruta la experiencia completa desde aquí.\n\nDesbloquea todas las funciones premium:\n• Videos completos  \n• Transmisiones en vivo  \n• Unlimited Nearby  \n• Salas de Video  \n• Eventos privados de la comunidad\n\nTap "Suscríbete a PRIME" para obtener acceso inmediato.`,
    back: '🔙 Atrás',
    cancel: '❌ Cancelar',
    next: '➡️ Siguiente',
    confirm: '✅ Confirmar',
    error: '❌ Ocurrió un error. Por favor intenta de nuevo.',
    openingChat: 'Abriendo chat...', 
    userNoUsername: 'Este usuario no tiene nombre de usuario. Puedes buscarlo manualmente.',
    errorOpeningChat: 'No se pudo abrir el chat. Por favor intenta manualmente.',
    success: '✅ ¡Éxito!',
    loading: '⏳ Cargando...', 
    days: 'días',

    // Onboarding
    selectLanguage: 'Por favor selecciona tu idioma:',
    languageSelected: 'Idioma configurado a Español 🇪🇸',
    ageConfirmation: '¿Tienes 18 años o más?',
    ageConfirmYes: 'Sí, tengo 18+',
    ageConfirmNo: 'No',
    underAge: 'Lo sentimos, debes tener 18 años o más para usar este servicio.',
    termsAndPrivacy: 'Por favor lee y acepta nuestros Términos de Servicio y Política de Privacidad:',
    termsAccepted: 'Términos y Política de Privacidad aceptados ✅',
    emailPrompt: '📧 Por favor proporciona tu dirección de correo electrónico:',
    emailRequiredNote: '⚠️ El correo electrónico es obligatorio para completar tu registro. Necesitamos tu correo en caso de que la comunidad sea eliminada por razones fuera de nuestro control, para poder comunicarnos contigo y proporcionarte actualizaciones importantes.',
    emailReceived: '¡Correo guardado exitosamente!',
    onboardingComplete: '🎉 ¡Bienvenido! Tu perfil está configurado. Usa /menu para comenzar.',

    // Main Menu
    mainMenuIntro: '🎬 Bienvenido a PNPtv - ¡Tu Centro de Entretenimiento!\n\n¿Qué te gustaría hacer?',
    mainMenuIntroFree: '`🔒 DESBLOQUEA TODO EL CONTENIDO`\n\nHola {username}, estás usando la versión FREE.\n\n**Con PRIME obtienes acceso ilimitado a:**\n\n🎬 Videos completos y shows exclusivos\n📍 Encuentra papis cerca de ti (Nearby)\n🎥 Salas de video en vivo 24/7\n💬 Chat y soporte prioritario\n\n**¡Hazte PRIME ahora y disfruta todo!**\n\n`Pases desde solo $14.99 USD`',
    subscribe: `Suscríbete a PNPtv PRIME\n----------------------------------\n\nÚnete a la plataforma de contenido PNP más intensa, creada por y para la comunidad.\n\nPRIME te da acceso total a:\n• Videos PNP completos con latinos reales fumando y slameando  \n• Estrenos exclusivos protagonizados por Santino (x.com/pnpmethdaddy)  \n• Transmisiones en vivo y Salas de Video.\n• Nearby ilimitado para explorar usuarios cerca de ti  \n• Biblioteca completa de música y podcasts  \n\nElige el plan que mejor se adapte a ti y completa tu pago.\nTu membresía se activará automáticamente.\n\nMétodos de pago disponibles: tarjeta débito/crédito, Crypto y las apps de pago más populares.`,
    upgradeToPrime: '💎 Actualizar a PRIME',
    exploreFeatures: '✨ Explorar Funciones Premium',
    specialOffers: '🔥 Ofertas Especiales',
    myProfile: '👤 Mi Perfil',
    nearbyUsers: '🌍 Usuarios Cercanos',
    liveStreams: '🎤 Transmisiones en Vivo',

    playerMenu: '🎵 Reproductor',
    callRooms: '🎥 Salas de Video',
    support: '🤖 Soporte',
    settings: '⚙️ Configuración',
    // Subscription
    subscriptionHeader: '`💎 Suscríbete a PNPtv! PRIME`',
    subscriptionDivider: '',
    subscriptionDescription: `Desbloquea la experiencia completa de PNPtv! y únete a la comunidad latina más caliente fumando & slammeando en Telegram.
Elige tu plan y obtén acceso inmediato a todas las funciones premium:

🔥 Acceso total a todos los canales PRIME
🔥 Grupo comunitario PNPtv
🔥 Videos de larga duración + estrenos semanales
🔥 Videografía completa de Santino
🔥 Nearby ilimitado
🔥 Transmisiones en vivo y Video Rooms
🔥 Tarjeta de perfil con foto, badges y bio

Toca un plan para activar tu membresía al instante. 💜`,
    subscriptionPlans: '💎 Elige tu Plan PRIME:',
      planCrystal: '💎 Pase Crystal - $49.99/180 días',
      planCrystalDesc: 'Medio año de acceso total a la comunidad PNPtv!. Incluye:\n\n• Acceso ilimitado a todos los canales y grupos de PNPtv!\n• Videografía completa de Santino y sesiones químicas latinas\n• Videos de larga duración con estrenos semanales\n• Invitaciones a salas de video y shows en vivo de PNP\n• Acceso ilimitado a Cercanos\n• Acceso a eventos comunitarios y sesiones privadas\n• Acceso anticipado a nuevas funciones',
      planDiamond: '💎 Pase Diamond - $99.99/365 días',
      planDiamondDesc: 'Un año completo de experiencia PNPtv! con todas las funciones premium incluidas. Incluye:\n\n• Acceso ilimitado a todos los canales y grupos de PNPtv!\n• Videografía completa de Santino y videos latinos de smoking/slamming\n• Videos de larga duración y estrenos exclusivos semanales\n• Invitaciones a salas de video, transmisiones privadas y eventos comunitarios\n• Acceso ilimitado a Cercanos\n• Capacidad para organizar y programar tus propias sesiones de video\n• Soporte VIP y badges especiales de miembro',
      planLifetime: '♾️ Pase Lifetime - $249.99',
      planLifetimeDesc: 'El pase definitivo de PNPtv! con acceso permanente e ilimitado. Incluye:\n\n• Acceso de por vida a todos los canales, grupos y funciones comunitarias de PNPtv!\n• Videografía completa de Santino y todos los futuros videos y estrenos\n• Sesiones de larga duración con nuevas subidas cada semana\n• Invitaciones a salas de video, shows privados y eventos exclusivos\n• Acceso ilimitado a Cercanos\n• Capacidad para organizar y programar sesiones de video en cualquier momento\n• Soporte VIP permanente y estatus de miembro de por vida',
    planMonthly: '🗓️ Pase Mensual - $24.99/30 días',
    planMonthlyDesc: 'Nuestro plan más popular con acceso total y sin límites. Incluye:\n\n• Acceso ilimitado a todos los canales y grupo de PNPtv!\n• Videografía completa de Santino y latinos sexys fumando y slameando\n• Videos largos con estrenos semanales\n• Invitaciones a salas de video y shows en vivo de PNP\n• Acceso ilimitado a Cercanos\n• Tarjeta de perfil con foto, badges y bio',
    planTrial: '⭐ Semana de Prueba',

    planDetails: 'Detalles del Plan:',
    selectPlan: 'Seleccionar Plan',
    paymentMethod: 'Elige método de pago:',
    payWithEpayco: '💳 Pagar con Tarjeta Débito/Crédito',
    payWithDaimo: '🪙 Pagar con Crypto y Apps de Pago',
    paymentFooter: '\n\n🔒 *Sin pagos recurrentes* • 🕶️ *Cobro discreto* • ✅ *Membresía 100% garantizada*',
    paymentInstructions: '💳 *Instrucciones de Pago*\n\n' 
      + 'Por favor toca el botón de abajo para ir a la página de checkout.\n' 
      + 'Ahí podrás revisar el precio, los detalles del plan y todos los beneficios incluidos antes de confirmar tu compra.\n\n' 
      + 'Después de confirmar, serás redirigido a la pasarela de pago segura de ePayco, donde puedes pagar usando:\n\n' 
      + '• Tarjeta de débito\n' 
      + '• Tarjeta de crédito\n\n' 
      + '*Por favor recuerda:*\n\n' 
      + '• El cargo aparecerá en tu estado de cuenta bancario como Easy Bots\n' 
      + '• Puedes revisar nuestros Términos, Condiciones y Política de Reembolso en:\n' 
      + 'www.pnptv.app/terms\n\n' 
      + 'Si necesitas ayuda, Cristina — nuestra asistente AI — está aquí para guiarte.',
    payment_confirmation: '✅ **Resumen de Pedido**\n\n' 
      + '📦 Plan: {planName}\n' 
      + '💰 Precio: ${price}/mes\n' 
      + '⏱️ Duración: {duration} día(s)\n\n' 
      + '⚠️ **Notas Importantes:**\n' 
      + '• Este es un pago ÚNICO\n' 
      + '• ❌ Los pagos recurrentes están APAGADOS\n' 
      + '• NO cobraremos tu tarjeta el próximo mes\n' 
      + '• Recibirás un recordatorio antes de renovar\n\n' 
      + 'Haz clic en "Pagar Ahora" para completar tu compra.',
    paymentSuccess: '✅ ¡Pago exitoso! Tu suscripción PRIME está activa. ' 
      + '¡Disfruta las funciones premium!',
    paymentFailed: '❌ Pago fallido. Por favor intenta de nuevo o contacta soporte.',
    subscriptionActive: 'Tu suscripción está activa hasta {expiry}',
    subscriptionExpired: 'Tu suscripción ha expirado. Por favor renueva para continuar disfrutando PRIME.',

    // Profile
    profileTitle: '👤 Tu Perfil',
    editProfile: '✏️ Editar Perfil',
    editPhoto: '📸 Cambiar Foto',
    editBio: '📝 Editar Bio',
    editLocation: '📍 Actualizar Ubicación',
    editInterests: '🎯 Editar Intereses',
    privacySettings: '🔒 Configuración de Privacidad',
    sendPhoto: 'Por favor envía tu nueva foto de perfil:',
    photoUpdated: '¡Foto de perfil actualizada exitosamente!',
    sendBio: 'Por favor envía tu nueva biografía (máx 500 caracteres):',
    bioUpdated: '¡Biografía actualizada exitosamente!',
    sendLocation: 'Por favor comparte tu ubicación:',
    locationUpdated: '¡Ubicación actualizada exitosamente!',
    sendInterests: 'Por favor envía tus intereses (separados por comas, máx 10):',
    interestsUpdated: '¡Intereses actualizados exitosamente!',
    profileViews: 'Visitas al Perfil: {views}',
    memberSince: 'Miembro desde: {date}',
    addToFavorites: '⭐ Agregar a Favoritos',
    removeFromFavorites: '❌ Quitar de Favoritos',
    blockUser: '🚫 Bloquear Usuario',
    unblockUser: '✅ Desbloquear Usuario',
    userBlocked: 'El usuario ha sido bloqueado.',
    userUnblocked: 'El usuario ha sido desbloqueado.',
    addedToFavorites: '¡Usuario agregado a tus favoritos!',
    removedFromFavorites: 'Usuario removido de tus favoritos.',
    myFavorites: '⭐ Mis Favoritos',
    noFavorites: 'Aún no tienes favoritos.',
    blockedUsers: '🚫 Usuarios Bloqueados',
    welcomeScreenPrime: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n          ¡Bienvenido a PNPtv PRIME!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nEste es tu panel PRIME.\nDesde aquí puedes acceder a todas tus funciones premium:\nabrir Salas de Video, iniciar transmisiones en vivo, ver videos completos,\nexplore Nearby sin límites y unirte a eventos privados.`,
    noBlockedUsers: 'No tienes usuarios bloqueados.',
    shareProfile: '📤 Compartir Perfil',
    profileShared: '¡Tarjeta de perfil creada! Toca para compartirla.',
    shareProfileCard: 'Compartir Mi Tarjeta de Perfil',
    privacyTitle: '🔒 Configuración de Privacidad',
    showLocation: '📍 Mostrar mi ubicación',
    showInterests: '🎯 Mostrar mis intereses',
    showBio: '📝 Mostrar mi biografía',
    allowMessages: '💬 Permitir mensajes de otros',
    showOnline: '🟢 Mostrar cuando estoy en línea',
    privacyUpdated: '¡Configuración de privacidad actualizada exitosamente!',
    viewUserProfile: 'Ver Perfil',
    userNotFound: 'Usuario no encontrado.',
    cannotViewProfile: 'No puedes ver este perfil.',
    badges: {
      verified: '✅ Verificado',
      premium: '💎 Premium',
      vip: '👑 VIP',
      moderator: '🛡️ Moderador',
      admin: '👨‍💼 Admin',
    },

    // Nearby Users
    nearbyTitle: '🌍 Encontrar Usuarios Cercanos',
    selectRadius: 'Selecciona radio de búsqueda:',
    radius5km: '📍 5 km',
    radius10km: '📍 10 km',
    radius25km: '📍 25 km',
    noNearbyUsers: 'No se encontraron usuarios cercanos. Intenta expandir tu radio de búsqueda.',
    nearbyUsersFound: 'Se encontraron {count} usuarios cercanos:',
    viewProfile: '👁️ Ver Perfil',
    sendMessage: '💬 Enviar Mensaje',
    distance: 'Distancia: {distance} km',

    // Live Streams
    liveTitle: '`🎤 Transmisiones en Vivo`',
    startLive: '▶️ Iniciar Transmisión',
    viewStreams: '👁️ Ver Transmisiones Activas',
    myStreams: '📹 Mis Transmisiones',
    enterStreamTitle: 'Ingresa el título de tu transmisión:',
    enterStreamDescription: 'Ingresa descripción de transmisión (opcional):',
    streamPaid: '¿Es una transmisión de pago?',
    streamPrice: 'Ingresa el precio de la transmisión (USD):',
    streamCreated: '✅ ¡Transmisión en vivo creada exitosamente!',
    noActiveStreams: 'No hay transmisiones activas en este momento.',
    noStreamsYet: 'Aún no has creado ninguna transmisión.',
    joinStream: '▶️ Unirse a Transmisión',
    joinedStream: '✅ ¡Te uniste a la transmisión!',
    leftStream: '👋 Saliste de la transmisión',
    streamEnded: '🛑 Transmisión Finalizada',
    streamNotFound: 'Transmisión no encontrada',
    streamNotActive: 'Esta transmisión no está activa',
    streamFull: 'Esta transmisión alcanzó el máximo de espectadores',
    streamLiked: '❤️ ¡Me gusta!',
    manageStream: 'Gestionar Transmisión',
    liveNow: 'En Vivo Ahora',
    streamHostInstructions: 'Haz clic en "Iniciar Transmisión" para salir en vivo. ' 
      + '¡Comparte tu enlace con los espectadores!',
    streamInstructions: 'Haz clic en "Ver Transmisión" para comenzar a ver. ¡Disfruta!',
    paidStreamNotice: '💰 Esta es una transmisión de pago',
    paymentIntegrationPending: 'Integración de pagos próximamente. ¡Acceso gratuito por ahora!',
    selectStreamCategory: '📁 Selecciona una categoría para tu transmisión:',
    browseByCategory: '📁 Explorar transmisiones por categoría:',
    noStreamsInCategory: 'No hay transmisiones en esta categoría',
    streamsInCategory: 'Transmisiones',
    streamComments: 'Comentarios de la Transmisión',
    noCommentsYet: '¡No hay comentarios aún. Sé el primero en comentar!',
    enterComment: 'Escribe tu comentario (máx 500 caracteres):',
    commentAdded: '¡Comentario agregado exitosamente!',
    bannedFromCommenting: 'Estás bloqueado de comentar en esta transmisión',
    commentsDisabled: 'Los comentarios están deshabilitados para esta transmisión',

    // VOD (Video on Demand)
    availableVODs: 'Grabaciones Disponibles',
    noVODsAvailable: 'No hay grabaciones disponibles aún',
    watchVOD: 'Ver Grabación',
    vodNotFound: 'Grabación no encontrada',

    // Share
    shareStream: 'Compartir Transmisión',
    shareLinkCopied: '¡Enlace listo para compartir!',
    shareInstructions: '¡Comparte este enlace con tus amigos o publícalo en Telegram!',
    shareToTelegram: 'Compartir en Telegram',

    // Subscribe/Follow
    subscribedToStreamer: '🔔 ¡Recibirás notificaciones cuando este streamer esté en vivo!',
    unsubscribedFromStreamer: '🔕 Ya no recibirás notificaciones de este streamer',

    // Media Player
    player: {
      title: 'Reproductor PNP',
      description: 'Tu reproductor completo de música y video',
      browseMusic: 'Música',
      browseVideo: 'Videos',
      myPlaylists: 'Mis Listas',
      publicPlaylists: 'Listas Públicas',
      trending: 'Tendencias',
      categories: 'Categorías',
      search: 'Buscar',
      nowPlaying: 'Reproduciendo',
      music: 'Música',
      video: 'Videos',
      library: 'Biblioteca',
      plays: 'reproducciones',
      likes: 'me gusta',
      tracks: 'pistas',
      followers: 'seguidores',
      noMedia: 'No hay contenido disponible aún.',
      noPlaylists: 'Aún no tienes listas de reproducción.',
      noPublicPlaylists: 'No hay listas públicas disponibles.',
      noTrending: 'No hay tendencias en este momento.',
      noCategoryMedia: 'No hay contenido en esta categoría.',
      noResults: 'No se encontraron resultados.',
      createPlaylist: 'Crear Lista',
      playlistCreated: '¡Lista creada exitosamente!',
      enterPlaylistName: 'Ingresa un nombre para tu lista:',
      enterSearchQuery: 'Ingresa tu búsqueda:',
      searchResults: 'Resultados de Búsqueda',
      selectCategory: 'Selecciona una categoría para explorar:',
      mediaNotFound: 'Contenido no encontrado.',
      playlistNotFound: 'Lista no encontrada.',
      emptyPlaylist: 'Esta lista está vacía.',
      nothingPlaying: 'No se está reproduciendo nada ahora.',
      playing: 'Reproduciendo',
      paused: 'En Pausa',
      stopped: 'Detenido',
      resumed: 'Reanudado',
      controls: 'Controles',
      shuffle: 'Aleatorio',
      repeat: 'Repetir',
      volume: 'Volumen',
      like: 'Me Gusta',
      liked: '¡Me gusta!',
      playPlaylist: 'Reproducir Lista',
      playingPlaylist: 'Reproduciendo lista',
      noQueue: 'No hay cola disponible.',
    },

    // Call Rooms
    callTitle: '🎥 Salas de Video',
    // Hangouts (Community Rooms)
    hangouts: {
      title: 'Salas de Video Llamadas',
      description: 'Únete a salas comunitarias o crea videollamadas privadas',
      mainRoomActive: 'Sala Principal Activa',
      participants: 'participantes',
      mainRoomsTitle: 'Unirse a Salas Principales PNPtv!',
      selectRoom: 'Selecciona una sala para unirte:',
      roomFull: 'Esta sala está llena. Por favor intenta otra sala.',
      roomNotActive: 'Esta sala no está activa actualmente.',
      roomNotFound: 'Sala no encontrada.',
    },
    // Support
    supportTitle: '`🆘 Centro de Ayuda`',
    chatWithCristina: '💬 Chat con Cristina (IA)',
    contactAdmin: '👨‍💼 Contactar Admin',
    faq: '❓ Preguntas Frecuentes',
    cristinaGreeting: '¡Hola! Soy Cristina — tu amiga y apoyo. Me identifico como mujer latina afro trans y lesbiana, en honor a Stonewall y a las mujeres que cuidaron de nuestra comunidad durante la crisis del sida. No soy profesional de la salud; busca ayuda médica cuando sea necesario. ¿Cómo puedo ayudarte hoy?',
    adminMessage: 'Por favor escribe tu mensaje para nuestro equipo de soporte:',
    messageSent: '¡Tu mensaje ha sido enviado a nuestro equipo de soporte! Te responderemos pronto.',

    // Settings
    settingsTitle: '`⚙️ Configuración`',
    changeLanguage: '🌐 Cambiar Idioma',
    notifications: '🔔 Notificaciones',
    privacy: '🔒 Privacidad',
    about: 'ℹ️ Acerca de',
    languageChanged: '¡Idioma cambiado exitosamente!',

    // Admin
    adminPanel: '👨‍💼 Panel de Administración',
    userManagement: '👥 Gestión de Usuarios',
    broadcast: '📢 Mensaje de Difusión',
    planManagement: '💎 Gestión de Planes',
    analytics: '📊 Analíticas',
    searchUser: 'Ingresa ID, usuario, nombre o email para buscar:',
    userFound: 'Usuario encontrado:',
    extendSubscription: '⏰ Extender Suscripción',
    deactivateUser: '🚫 Desactivar Usuario',
    broadcastTarget: 'Selecciona objetivo de difusión:',
    allUsers: '👥 Todos los Usuarios',
    premiumOnly: '💎 Solo Premium',
    freeOnly: '🆓 Solo Usuarios Gratis',
    enterBroadcast: 'Ingresa tu mensaje de difusión:',
    broadcastSent: '¡Difusión enviada a {count} usuarios!',

    // Errors
    invalidInput: 'Entrada inválida. Por favor intenta de nuevo.',
    unauthorized: 'No estás autorizado para realizar esta acción.',
    subscriptionRequired: 'Esta función requiere una suscripción PRIME.',
    locationRequired: 'Por favor comparte tu ubicación primero.',
    networkError: 'Error de red. Por favor verifica tu conexión e intenta de nuevo.',
    serverError: 'Error del servidor. Por favor intenta más tarde.',

    // Moderation
    moderation: {
      warning: 'Advertencia',
      user_kicked: 'Usuario Eliminado',
      group_rules: 'Reglas del Grupo',
      no_warnings: 'Sin Advertencias',
      your_warnings: 'Tus Advertencias',
      username_required: 'Username Requerido',
      reason: {
        unauthorized_link: 'Enlace no autorizado detectado',
        spam: 'Mensaje de spam',
        flooding: 'Enviando mensajes muy rápido',
        profanity: 'Lenguaje inapropiado',
        user_banned: 'Usuario está baneado',
        excessive_caps: 'Exceso de mayúsculas',
        excessive_emojis: 'Demasiados emojis',
        repeated_characters: 'Caracteres repetidos',
        excessive_punctuation: 'Puntuación excesiva',
      },
    },
    // PNP Latino messages
    pnpLatinoPrimeMenu: `💎 PNP LATINO PRIME

Disfruta del contenido más hot con Santino, Lex y otros latinos:
real videos, sesiones intensas y vibes PNP sin censura, solo aquí en Telegram.

Your PRIME access includes:

📍 Nearby — Community PNP Grindr
🎥 Hangouts — Private and public video rooms
🔴 PNP Television Live — Live shows and events
🎶 Videorama — PNP playlists and podcasts

🤖 Cristina AI — Soporte 24/7

💎 Content, connection and PRIME experience.`,
    pnpLatinoFreeMenu: `🆓 PNP LATINO FREE

Únete a la comunidad PNP más grande con Santino, Lex y otros latinos.
Accede a contenido básico y conecta con la comunidad.

Tu acceso FREE incluye:

📍 Nearby — Community PNP Grindr (basic)
🎥 Hangouts — Salas de video públicas
🎶 Videorama — Playlists y podcasts PNP (limited selection)

🤖 Cristina AI — Soporte 24/7

💎 ¿Quieres más? Sube a PRIME para contenido exclusivo.`,
    pnpLatinoPrimeOnboardingComplete: `🎉 ¡Bienvenido a PNP LATINO PRIME!

🔥 Tu membresía PRIME está activa y lista para usar.

💎 Disfruta de:
• Contenido exclusivo sin censura
• PNP Nearby - Conecta con la comunidad
• PNP Hangouts - Salas de video privadas
• PNP Television Live - Eventos en vivo
• PNP Videorama - Playlists completas

📱 Usa /menu para explorar todas las funciones.

🤖 ¿Necesitas ayuda? Cristina IA está disponible 24/7.

¡Bienvenido a la experiencia PRIME! 🔥`,
    pnpLatinoFreeOnboardingComplete: `🎉 ¡Bienvenido a PNP LATINO FREE!

🔥 Ahora eres parte de la comunidad PNP más grande.

🆓 Tu acceso FREE incluye:
• PNP Nearby básico - Conecta con la comunidad
• PNP Hangouts - Salas de video públicas
• PNP Videorama - Selección de playlists

💎 ¿Quieres contenido exclusivo?
• Videos completos sin censura
• Eventos en vivo PNP Television Live
• Salas de video privadas
• Todas las funciones premium

📱 Usa /subscribe para actualizar a PRIME.

🤖 ¿Preguntas? Cristina IA está aquí para ayudarte.

¡Disfruta de PNP LATINO! 🔥`,

    // Proactive and Tutorial Messages
    pnpLatinoWelcomeTutorial: `🎉 ¡Bienvenido a PNP LATINO! 🔥

📚 *Tutorial Rápido:*

1️⃣ *💬 Chat Privado:* Todos los comandos funcionan en privado
2️⃣ *📱 /menu:* Accede a todas las funciones
3️⃣ *💎 /subscribe:* Conviértete en PRIME para contenido exclusivo
4️⃣ *🤖 Cristina IA:* Tu asistente 24/7

📢 *Reglas de la Comunidad:*
• No spam (máx 3 mensajes seguidos)
• Contenido apropiado
• Respeto mutuo

🚫 *Evita ser bloqueado:* No envíes mensajes repetidos o publicidad.

💬 ¿Necesitas ayuda? Usa /support o pregunta a Cristina IA!`,

    pnpLatinoGroupRules: `📜 *Reglas del Grupo PNP LATINO*

✅ *Permitido:*
• Conversaciones relacionadas con PNP
• Preguntas sobre el bot y sus funciones
• Contenido SFW (aptos para todos)

❌ *Prohibido:*
• Spam o mensajes repetidos
• Publicidad no autorizada
• Contenido NSFW explícito
• Insultos o descalificaciones

🔒 *Consecuencias:*
• 1ra advertencia: Mensaje privado
• 2da advertencia: Silencio temporal
• 3ra advertencia: Expulsión

💡 *Consejo:* Usa el bot en privado para comandos: /menu, /subscribe, /profile`,

    pnpLatinoAntiSpamWarning: `⚠️ *Advertencia Anti-Spam*

📢 Has enviado {count} mensajes en {time} segundos.

🔥 *Reglas del grupo:*
• Máximo 3 mensajes seguidos
• Espera 10 segundos entre mensajes
• No repitas el mismo contenido

⏳ Por favor espera antes de enviar más mensajes para evitar ser silenciado.`,

    pnpLatinoSpamMuted: `🔇 *Cuenta Silenciada*

🚫 Has sido silenciado por {duration} minutos por violar las reglas anti-spam.

📚 *Lo que happened:*
• Enviaste {count} mensajes en {time} segundos
• Esto supera el límite permitido

⏰ Tu silencio expirará automáticamente.

💬 Para evitar esto en el futuro:
• No envíes mensajes repetidos
• Espera entre mensajes
• Usa el bot en privado para comandos`,

    pnpLatinoTutorialStep1: `🎬 *Tutorial PNP LATINO - Paso 1/3*

💎 *Conoce tu Nivel:*

🆓 *FREE:*
• Acceso básico a Nearby
• Hangouts públicos
• Contenido limitado

💎 *PRIME:*
• Nearby completo + filtros
• Hangouts privados
• PNP Television Live (en vivo)
• Videorama completo
• Eventos exclusivos

📱 *Cómo actualizar:* /subscribe`,

    pnpLatinoTutorialStep2: `🎥 *Tutorial PNP LATINO - Paso 2/3*

🔥 *Funciones Principales:*

📍 *Nearby:*
• Encuentra miembros cercanos
• Filtra por intereses
• Conecta en privado

🎥 *Hangouts:*
• Salas de video temáticas
• Eventos en vivo
• Chat comunitario

🎶 *Videorama:*
• Playlists exclusivas
• Podcasts PNP
• Contenido bajo demanda

💡 *Consejo:* Usa /menu para acceder rápidamente!`,

    pnpLatinoTutorialStep3: `🤖 *Tutorial PNP LATINO - Paso 3/3*

💬 *Soporte y Comunidad:*

🤖 *Cristina IA:*
• Asistente 24/7
• Responde preguntas
• Guía de uso
• Activación: /cristina_ai

👥 *Comunidad:*
• Grupo oficial: [Únete aquí](https://t.me/pnptv_community)
• Eventos semanales
• Soporte entre miembros

📢 *Recuerda:*
• Respeta las reglas
• No spam
• Disfruta del contenido

✅ *Tutorial completado!* Usa /menu para empezar.`,
  },
};

/**
 * Get translated text
 * @param {string} key - Translation key
 * @param {string} lang - Language code ('en' or 'es')
 * @param {Object} params - Parameters to replace in text
 * @returns {string} Translated text
 */
const t = (key, lang = 'en', params = {}) => {
  const language = lang || 'en';

  // Support nested keys like 'moderation.username_required'
  const getNestedValue = (obj, keyPath) => {
    return keyPath.split('.').reduce((current, k) => current?.[k], obj);
  };

  let text = getNestedValue(translations[language], key)
    || getNestedValue(translations.en, key)
    || key;

  // Replace parameters
  if (typeof text === 'string') {
    Object.keys(params).forEach((param) => {
      text = text.replace(`{${param}}`, params[param]);
    });
  }

  return text;
};

/**
 * Get all translations for a language
 * @param {string} lang - Language code
 * @returns {Object} All translations
 */
const getTranslations = (lang = 'en') => translations[lang] || translations.en;

/**
 * Check if language is supported
 * @param {string} lang - Language code
 * @returns {boolean} Support status
 */
const isLanguageSupported = (lang) => Object.prototype.hasOwnProperty.call(translations, lang);

/**
 * Get supported languages
 * @returns {Array<string>} Language codes
 */
const getSupportedLanguages = () => Object.keys(translations);

module.exports = {
  t,
  getTranslations,
  isLanguageSupported,
  getSupportedLanguages,
  translations,
};
