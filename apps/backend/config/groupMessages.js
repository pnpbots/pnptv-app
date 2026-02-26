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
};
