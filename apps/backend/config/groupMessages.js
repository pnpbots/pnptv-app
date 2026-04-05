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

const getHangoutChatRedirectMessage = ({ username, lang, hangoutId = null, hangoutName = null }) => {
  const language = normalizeLang(lang);
  const appUrl = process.env.WEB_DOMAIN
    ? process.env.WEB_DOMAIN.replace(/\/$/, '')
    : 'https://app.pnptv.app';

  const hangoutUrl = hangoutId
    ? `${appUrl}/chat?group=${hangoutId}`
    : `${appUrl}/?view=hangouts`;

  const groupLabel = hangoutName ? ` *${hangoutName}*` : '';

  if (language === 'es') {
    return {
      text: `📱 @${username} este grupo está conectado al Hangout${groupLabel} de la app PNPtv.\n\nPor favor usa la app para chatear — los mensajes del grupo no se ven ahí.`,
      buttonText: hangoutName ? `💬 Abrir ${hangoutName}` : '💬 Abrir Hangout',
      buttonUrl: hangoutUrl,
    };
  }

  return {
    text: `📱 @${username} this group is connected to the${groupLabel} Hangout in the PNPtv app.\n\nPlease use the app to chat — group messages don't appear there.`,
    buttonText: hangoutName ? `💬 Open ${hangoutName}` : '💬 Open Hangout',
    buttonUrl: hangoutUrl,
  };
};

const getHangoutCommandRedirectMessage = ({ lang, hangoutId = null, hangoutName = null }) => {
  const language = normalizeLang(lang);
  const appUrl = process.env.WEB_DOMAIN
    ? process.env.WEB_DOMAIN.replace(/\/$/, '')
    : 'https://app.pnptv.app';

  const hangoutUrl = hangoutId
    ? `${appUrl}/chat?group=${hangoutId}`
    : `${appUrl}/?view=hangouts`;

  const groupLabel = hangoutName ? ` *${hangoutName}*` : '';

  if (language === 'es') {
    return {
      text: `📱 Este grupo está conectado al Hangout${groupLabel} de la app PNPtv. Los comandos del bot no están disponibles aquí.\n\nUsa la app para todas las funciones.`,
      buttonText: hangoutName ? `💬 Abrir ${hangoutName}` : '💬 Abrir Hangout',
      buttonUrl: hangoutUrl,
    };
  }

  return {
    text: `📱 This group is connected to the${groupLabel} Hangout in the PNPtv app. Bot commands are not available here.\n\nUse the app for all features.`,
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
