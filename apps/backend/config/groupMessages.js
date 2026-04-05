const DEFAULT_BOT_USERNAME = process.env.BOT_USERNAME || 'pnplatinotv_bot';

const autoModerationReasons = {
  muted: 'You are currently muted',
  forwarded: 'Forwarded messages are not allowed in this group',
  spam: 'Spam detected (duplicate messages)',
  flood: 'Too many messages too quickly',
  links: 'Links are not allowed in this group',
  profanity: 'Inappropriate language detected',
};

const normalizeLang = (lang) => (lang && lang.startsWith('es') ? 'es' : 'en');

const getGroupRedirectNotification = ({ username, commandName }) =>
  `${username}, I sent you a private message about ${commandName}!`;

const getRequirePrivateChatPrompt = ({ username, botUsername = DEFAULT_BOT_USERNAME }) =>
  `${username}, please start a private chat with me first by clicking here: https://t.me/${botUsername}`;

const getPersonalInfoRedirect = (lang) => {
  const language = normalizeLang(lang);
  const CRISTINA_EMOJI = '🧜‍♀️';

  if (language === 'es') {
    return `${CRISTINA_EMOJI} Esta pregunta contiene información personal. Por favor, contáctame en privado para proteger tu privacidad.`;
  }

  return `${CRISTINA_EMOJI} This question contains personal information. Please contact me privately to protect your privacy.`;
};

const getCallbackRedirectText = (lang) => {
  const language = normalizeLang(lang);
  return language === 'es'
    ? 'Por favor usa el bot en privado para esta funcion'
    : 'Please use the bot in private for this feature';
};

const getGroupMenuTitle = (lang) => {
  const language = normalizeLang(lang);
  return language === 'es'
    ? 'PNPtv - Selecciona una opcion:'
    : 'PNPtv - Choose an option:';
};

const getHangoutChatRedirectMessage = ({ username, lang, hangoutId = null, hangoutName = null, rules = null }) => {
  const language = normalizeLang(lang);
  const appUrl = process.env.WEB_DOMAIN
    ? process.env.WEB_DOMAIN.replace(/\/$/, '')
    : 'https://app.pnptv.app';

  const hangoutUrl = hangoutId
    ? `${appUrl}/chat/${hangoutId}`
    : `${appUrl}/?view=hangouts`;

  const rulesBlockEn = rules ? `📋 *Group rules:*\n${rules}\n\n` : '';
  const rulesBlockEs = rules ? `📋 *Reglas del grupo:*\n${rules}\n\n` : '';

  if (language === 'es') {
    return {
      text: `🧜‍♀️ *Cristina AI agent dice:*\n\n¡Hola @${username}! Este grupo está conectado al Hangout *${hangoutName || 'PNPtv'}* en la app PNPtv — tu rincón privado de la comunidad queer PNP.\n\n💬 *¿Qué es un Hangout?*\nUn espacio privado en PNPtv con chat en vivo, feed de medios, videollamadas y tu propio ambiente. Este grupo de Telegram es un puente — los mensajes aquí se reflejan en la app en tiempo real.\n\n📱 *El chat completo, las reacciones y las llamadas viven en la app.* Abre tu Hangout allí para la experiencia completa.\n\n🔑 *¿Tienes membresía y tu propio grupo de Telegram?* Puedes crear tu propio Hangout en la app PNPtv y vincularlo — tu comunidad obtiene un espacio privado con reglas personalizadas, feed y videollamadas.\n\n✨ *Ventajas de PNPtv:* Feeds privados · Videollamadas · Contenido de creadores · Miembros cercanos · Soporte IA\n\n${rulesBlockEs}`,
      buttonText: hangoutName ? `💬 Abrir ${hangoutName}` : '💬 Abrir Hangout',
      buttonUrl: hangoutUrl,
    };
  }

  return {
    text: `🧜‍♀️ *Cristina AI agent says:*\n\nHey @${username}! This group is linked to the *${hangoutName || 'PNPtv'}* Hangout inside the PNPtv app — your private corner of the queer PNP community.\n\n💬 *What's a Hangout?*\nA private space in PNPtv with live chat, a media feed, video calls, and your own community vibe. This Telegram group is a bridge to it — messages here are mirrored to the app in real time.\n\n📱 *Chat, reactions, calls and the full feed live in the app.* Open your Hangout there for the complete experience.\n\n🔑 *Have a membership + your own Telegram group?* You can create your own Hangout in the PNPtv app and link it — your community gets a private space with custom rules, a media feed, and video calls.\n\n✨ *PNPtv advantages:* Private feeds · Video calls · Creator content · Nearby members · AI support\n\n${rulesBlockEn}`,
    buttonText: hangoutName ? `💬 Open ${hangoutName}` : '💬 Open Hangout',
    buttonUrl: hangoutUrl,
  };
};

const getHangoutCommandRedirectMessage = ({ lang, hangoutId = null, hangoutName = null, rules = null }) => {
  const language = normalizeLang(lang);
  const appUrl = process.env.WEB_DOMAIN
    ? process.env.WEB_DOMAIN.replace(/\/$/, '')
    : 'https://app.pnptv.app';

  const hangoutUrl = hangoutId
    ? `${appUrl}/chat/${hangoutId}`
    : `${appUrl}/?view=hangouts`;

  const rulesBlockEn = rules ? `📋 *Group rules:*\n${rules}\n\n` : '';
  const rulesBlockEs = rules ? `📋 *Reglas del grupo:*\n${rules}\n\n` : '';

  if (language === 'es') {
    return {
      text: `🧜‍♀️ *Cristina AI agent dice:*\n\nLos comandos del bot no están disponibles en este grupo de Telegram — todo vive en el espacio *${hangoutName || 'PNPtv'}* dentro de la app PNPtv.\n\nUsa la app para chat, medios, videollamadas y todas las funciones del bot.\n\n${rulesBlockEs}`,
      buttonText: hangoutName ? `💬 Abrir ${hangoutName}` : '💬 Abrir Hangout',
      buttonUrl: hangoutUrl,
    };
  }

  return {
    text: `🧜‍♀️ *Cristina AI agent says:*\n\nBot commands aren't available in this Hangout's Telegram group — everything lives in the *${hangoutName || 'PNPtv'}* space inside the PNPtv app.\n\nUse the app for chat, media, video calls, and all bot features.\n\n${rulesBlockEn}`,
    buttonText: hangoutName ? `💬 Open ${hangoutName}` : '💬 Open Hangout',
    buttonUrl: hangoutUrl,
  };
};

const getCristinaRedirectMessage = ({
  username,
  lang,
  botUsername = DEFAULT_BOT_USERNAME,
  deepLink = 'home',
}) => {
  const language = normalizeLang(lang);
  const pmLink = `https://t.me/${botUsername}?start=${deepLink}`;
  const CRISTINA_EMOJI = '🧜‍♀️';

  if (language === 'es') {
    return {
      text: `${CRISTINA_EMOJI} @${username} gracias por usar nuestro bot. Por favor revisa @${botUsername} para mas informacion.\n\nRecuerda enviar "Ey Cristina" si tienes alguna pregunta.`,
      buttonText: 'Abrir Bot',
      buttonUrl: pmLink,
    };
  }

  return {
    text: `${CRISTINA_EMOJI} @${username} thank you for using our bot. Please check @${botUsername} for more info.\n\nRemember to send "Hey Cristina" if you have a question.`,
    buttonText: 'Open Bot',
    buttonUrl: pmLink,
  };
};

module.exports = {
  autoModerationReasons,
  getGroupRedirectNotification,
  getRequirePrivateChatPrompt,
  getPersonalInfoRedirect,
  getCallbackRedirectText,
  getGroupMenuTitle,
  getCristinaRedirectMessage,
  getHangoutChatRedirectMessage,
  getHangoutCommandRedirectMessage,
};
