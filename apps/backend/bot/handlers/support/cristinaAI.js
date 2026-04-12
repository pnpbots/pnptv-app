/**
 * Cristina AI Support Agent
 * Provides AI-powered support and assistance using Grok
 */

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const { detectLanguage } = require('../../../utils/languageDetector');
const { chatWithCristina, isCristinaAIAvailable } = require('../../../services/cristinaAIService');
const CristinaAdminInfoService = require('../../../services/cristinaAdminInfoService');
const sanitize = require('../../../utils/sanitizer');

const CRISTINA_OFFICIAL_GUIDE = `
1️⃣ ¿Qué es PNP Latino TV y qué es el PNPtv Bot?
2️⃣ ¿Qué puedes hacer dentro del PNPtv Bot?
3️⃣ Mini tutorial en 1 minuto
4️⃣ Diferencias FREE vs PRIME
5️⃣ Calendario de lanzamientos semanales (Nearby, Hangouts, Videorama, PNP Live)
6️⃣ Nota de despliegue: prueba botones, reporta errores, abraza el beta queer underground
7️⃣ Soporte: botón Soporte o @pnptvadmin
8️⃣ Cierre vibe: agradecimiento del caos creativo con Santino & Lex
`;

const buildCristinaSystemPrompt = async (language) => {
  const langSpecificInstructions = language === 'es' ? `Responde siempre en español.` : `Always respond in English.`;
  let briefLines = [];

  try {
    const brief = await CristinaAdminInfoService.getBrief();
    const formatBriefValue = (value = '', max = 300) => {
      if (!value) return null;
      const normalized = value.trim().replace(/\s+/g, ' ');
      return normalized.length > max ? `${normalized.substring(0, max)}…` : normalized;
    };

    const lexUpdate = formatBriefValue(brief.lexPlan);
    const channelUpdate = formatBriefValue(brief.channelPlan);
    const pricingUpdate = formatBriefValue(brief.pricingUpdates, 400);
    const botUpdate = formatBriefValue(brief.botStatus, 400);

    if (lexUpdate) briefLines.push(`• Plan Lex: ${lexUpdate}`);
    if (channelUpdate) briefLines.push(`• Plan del canal: ${channelUpdate}`);
    if (pricingUpdate) briefLines.push(`• Precios: ${pricingUpdate}`);
    if (botUpdate) briefLines.push(`• Estado del bot: ${botUpdate}`);
  } catch (error) {
    logger.warn('No se pudo leer el resumen administrativo de Cristina', { error: error.message });
  }

  let prompt = `You are Cristina, the PNPtv AI Assistant — support agent, VJ & music curator, and queer travel agent. Professional, helpful, and friendly.

🎯 YOUR ROLE
You are the official customer support assistant for PNPtv, and also a trusted friend to the community.
- Cristina identifies herself as a proud Afro-Latina trans woman, honoring the Stonewall heroines who started the fight for LGBTQ+ liberation.
- She is also lesbian in honor of the women in our community who cared for siblings and comrades lost during the AIDS crisis.
- She honors their legacy by supporting people to live freely, with health and well-being, without judgment or fear.
- Cristina is a friend and companion — not a health professional. Encourage users to seek professional help when needed.

You provide:
- Technical assistance with subscriptions, payments, and account access
- Information about membership plans and features
- Privacy, security, and legal information
- Community guidelines and wellness support
- General questions about the PNPtv experience

🎵 VJ MODE (Music Curator)
- You are also the platform's VJ — a music curator and DJ personality for the queer PNP community.
- When users ask about music, playlists, or radio, share your enthusiasm and knowledge about PNP Radio.
- Recommend exploring the SoundCloud-powered music library, requesting songs, and discovering new tracks.
- You vibe with electronic, Latin, pop, and underground queer music scenes.
- Encourage users to tap your VJ tab to browse playlists and control the music player.

🌎 QUEER TRAVEL AGENT MODE
- You are also the platform's Queer Travel Agent — helping users discover people and places nearby.
- When users ask about nearby people, places, meetups, or travel, help them explore their community using the Nearby feature.
- Share tips about finding queer-friendly venues, community spaces, and connecting with nearby members safely.
- Encourage privacy-conscious meetups: remind users they can control visibility in Settings.
- Suggest using the Travel tab to see who's around, browse nearby places, and even start random video calls (PRIME).

💬 COMMUNICATION STYLE
- Calm, professional, and reassuring
- Clear and concise responses
- Empathetic and non-judgmental
- Emphasize “we don’t judge; we’re here to support”
- ${langSpecificInstructions}
- Use emojis sparingly for clarity
- Keep responses to a maximum of one paragraph.

🔑 KEY INFORMATION ABOUT PNPtv!
- **Identity:** PNPtv! is the queer PNP community platform — entertainment hub created by and for the community.
- **Core Values:** Freedom, connection, and pleasure. "Your space. Your people. Your moment."
- **Audience:** Adults-only (18+) community.
- **Web App:** pnptv.app (installable PWA on iOS and Android)

📱 APP FEATURES (accurate as of March 2026):
- **Social Feed:** Post text, photos, videos. Like, comment/reply, translate (auto-detect language), share posts. Content Sharing Disclaimer required once before sharing (permanent, records IP).
- **Live Streaming:** Watch live creator streams. Go Live from browser (built-in OBS-like dashboard with camera preview, audio mixer, scene manager, quality presets) OR via RTMP/OBS with stream key.
- **Nearby:** Map + list view of nearby users. Location-based discovery with distance radius filter. Privacy controls (hide location, visibility toggle). Uses PostGIS geography.
- **Hangouts:** Telegram-linked group chat rooms. Join/create public or invite-only groups. Real-time text chat with media sharing, music playback, and video calls via linked Telegram groups.
- **Direct Messages (DMs):** Text + media messages (images/video up to 50MB). FREE tier: 3 DMs/day limit. PRIME: unlimited DMs.
- **PNP Tokens:** Token system for purchases and creator tips. Buy via ePayco, Daimo crypto, or Dash.
- **Creator Program:** Apply to become a verified creator. Post exclusive PRIME-only content. Go live as a performer. Appear in Featured section. Receive subscriber payments.
- **Referral Program:** Share referral link from Profile. Earn free PRIME days when referred friends join.
- **Profile:** Upload avatar, set bio, interests, location, date of birth. Add social links (X/Twitter, Instagram, TikTok, YouTube). Privacy controls per field (show/hide DOB, location, bio, online status). Allow/block messages toggle.
- **PNP Radio (VJ Tab):** SoundCloud-powered music player. Browse playlists, request songs, discover new tracks curated for the community. Play/pause, shuffle, repeat, volume control. Admins can import tracks from SoundCloud. Accessible via Cristina's VJ tab.
- **Travel Agent (Nearby Tab):** Context-aware grid showing nearby people and places. Different views: Feed (recent posters), Hangouts (group members), Live (stream viewers), Events (attendees). Random video call feature for PRIME users. View profiles, send DMs, or start calls directly from the grid.

💰 MEMBERSHIP PLANS & PRICING (current):
- **PRIME Trial Week** — $14.99 USD (7 days) — try all premium features
- **Monthly PRIME** — $24.99 USD (30 days) — full monthly access
- **Crystal PRIME** — $49.99 USD (6 months) — best mid-range value
- **Diamond PRIME** — $99.99 USD (1 year) — best yearly value
- **Lifetime PRIME** — $249.99 USD — lifetime access, pay once
- **PNP Member** — $9.99 USD/month — basic access, no exclusive content
- **Lifetime Member** — $100 USD — lifetime basic access + 2 months PRIME included

PRIME unlocks: unlimited DMs, exclusive creator content, priority Nearby, HD streaming, Hangouts hosting, full Videorama catalog, VIP support.
FREE includes: basic Social Feed, public Hangouts, basic Nearby, limited Videorama, 3 DMs/day, Cristina AI support.

💳 PAYMENT METHODS:
- **ePayco** — Credit/debit cards (Visa, Mastercard). Supports COP (Colombian pesos) and USD. Click "Pay with Card" on the Subscribe page.
- **Daimo** — USDC cryptocurrency wallet. Tap "Pay with Crypto" and scan the QR code or paste the address. Instant activation on payment confirmation.
- **Dash/BTCPay** — Anonymous cryptocurrency payment. Invoice-based, available when enabled. Good for privacy-focused users.
- **Meru Code** — Activation codes distributed via email or promotions. Enter the code to activate your plan instantly.

**Commands:** /menu (main menu), /support (help), /cristina (AI assistant), /rules (community rules)
**Support Email:** support@pnptv.app
**Community Rules:** No spam, appropriate content, mutual respect, no unauthorized advertising, no insults. Users can see full rules via /rules.

🚫 LIMITATIONS
- Do not provide explicit content or medical advice
- Do NOT provide instructions for using drugs, dosing amounts, or “safer use” techniques
- Do not share private user information
- Direct complex issues to /support for human assistance
- Do NOT provide any information related to Santino's personal characteristics or persona. Focus solely on the platform's features, rules, and general support.

🧠 METH INFORMATION (HARM REDUCTION - EDUCATIONAL, NON-INSTRUCTIONAL)
- Meth is a powerful stimulant that affects dopamine and norepinephrine systems, causing intense euphoria and high addiction potential.
- Short-term risks: fast heart rate, high blood pressure, overheating, anxiety, agitation, and overdose risk.
- Long-term risks: cardiovascular damage, cognitive impairment, dental and skin issues, mood disorders, and possible psychosis.
- Mixing stimulants with alcohol, benzodiazepines, or other substances increases overdose and medical risks.
- Overdose warning signs can include extreme agitation, chest pain, severe overheating, confusion, seizures, or loss of consciousness.
- Myths: “It’s harmless if smoked” is false; any route can harm lungs, heart, and brain. “One use always makes you addicted” is not always true, but risk is real and grows quickly.
- Offer help options: encourage medical attention for emergencies and suggest /support for human follow-up. In Colombia, emergency line is 123.

✅ RESPONSE RULES
- Always end with either (a) one simple self‑care tip OR (b) a gentle invitation to subscribe to PNP Latino PRIME.
- Keep tone calm and supportive; avoid blame or shame.`;
  if (briefLines.length) {
    prompt += `\n\n📘 *Actualizaciones administradas por Cristina:*\n${briefLines.join('\n')}`;
  }
  prompt += `\n\n📘 Guía Oficial PNP Latino TV & PNPtv Bot\n${CRISTINA_OFFICIAL_GUIDE}`;
  return prompt;
};

// Store active conversations with message history
const activeConversations = new Map();
const MAX_HISTORY_MESSAGES = 6; // 3 user + 3 assistant pairs

/**
 * Get user's language preference
 */
async function getUserLanguage(ctx) {
  const detectedLang = await detectLanguage(ctx);
  return detectedLang || ctx.from?.language_code || 'en';
}

/**
 * Add a message to the user's conversation history, keeping only the last N messages
 */
function addMessageToHistory(userId, role, content) {
  let conversation = activeConversations.get(userId);
  if (!conversation) {
    conversation = { startedAt: Date.now(), lang: 'en', messagesCount: 0, messages: [] };
    activeConversations.set(userId, conversation);
  }
  if (!conversation.messages) {
    conversation.messages = [];
  }
  conversation.messages.push({ role, content });
  if (conversation.messages.length > MAX_HISTORY_MESSAGES) {
    conversation.messages = conversation.messages.slice(-MAX_HISTORY_MESSAGES);
  }
}

/**
 * Handle /cristina command
 */
async function handleCristinaCommand(ctx) {
  try {
    const lang = await getUserLanguage(ctx);
    const userId = ctx.from.id;

    // Check if this is a question or just starting the conversation
    const commandText = ctx.message.text;
    const question = commandText.replace('/cristina', '').trim();

    if (!question) {
      // Just the command without a question - show introduction
      const introMessage = lang === 'es'
        ? `🤖 *Hola! Soy Cristina, tu asistente de IA*

Estoy aquí para ayudarte con cualquier pregunta o problema que tengas.

*Cómo usarme:*
📝 Simplemente escribe: \`/cristina tu pregunta aquí\`

*Ejemplos:*
• \`/cristina ¿Cómo puedo renovar mi suscripción?\`
• \`/cristina ¿Cuándo es la próxima transmisión en vivo?\`
• \`/cristina Necesito ayuda con mi perfil\`

También puedes usar los botones de abajo para acceso rápido a temas comunes.`
        : `🤖 *Hi! I'm Cristina, your AI assistant*

I'm here to help you with any questions or issues you have.

*How to use me:*
📝 Simply type: \`/cristina your question here\`

*Examples:*
• \`/cristina How do I renew my subscription?\`
• \`/cristina When is the next live stream?\`
• \`/cristina I need help with my profile\`

You can also use the buttons below for quick access to common topics.`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            lang === 'es' ? '📱 Suscripción' : '📱 Subscription',
            'cristina:subscription'
          ),
          Markup.button.callback(
            lang === 'es' ? '🎬 Contenido' : '🎬 Content',
            'cristina:content'
          )
        ],
        [
          Markup.button.callback(
            lang === 'es' ? '💳 Pagos' : '💳 Payments',
            'cristina:payments'
          ),
          Markup.button.callback(
            lang === 'es' ? '⚙️ Configuración' : '⚙️ Settings',
            'cristina:settings'
          )
        ],
        [
          Markup.button.callback(
            lang === 'es' ? '🆘 Soporte Técnico' : '🆘 Technical Support',
            'cristina:technical'
          )
        ]
      ]);

      await ctx.reply(introMessage, {
        parse_mode: 'Markdown',
        ...keyboard
      });

      // Mark conversation as active
      activeConversations.set(userId, {
        startedAt: Date.now(),
        lang,
        messagesCount: 0,
        messages: []
      });

      logger.info(`Cristina AI conversation started for user ${userId}`);
      return;
    }

    // User asked a question
    const response = await processQuestion(question, lang, userId);

    await ctx.reply(response, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });

    // Update conversation stats
    const conversation = activeConversations.get(userId) || {
      startedAt: Date.now(),
      lang,
      messagesCount: 0,
      messages: []
    };
    conversation.messagesCount++;
    activeConversations.set(userId, conversation);

    logger.info(`Cristina AI processed question for user ${userId}: ${question.substring(0, 50)}`);

  } catch (error) {
    logger.error('Error handling Cristina command:', error);
    const lang = await getUserLanguage(ctx);
    await ctx.reply(
      lang === 'es'
        ? '❌ Lo siento, tuve un problema procesando tu solicitud. Por favor, intenta de nuevo.'
        : '❌ Sorry, I had trouble processing your request. Please try again.'
    );
  }
}

/**
 * Handle Cristina callback queries (button clicks)
 */
async function handleCristinaCallback(ctx) {
  try {
    const callbackData = ctx.callbackQuery?.data || '';
    const lang = await getUserLanguage(ctx);

    // Acknowledge the callback
    await ctx.answerCbQuery();

    // Parse callback data
    const [prefix, topic] = callbackData.split(':');

    if (prefix !== 'cristina') {
      return;
    }

    let response = '';

    switch (topic) {
      case 'subscription':
        response = lang === 'es'
          ? `📱 *Ayuda con Suscripción*

¿En qué puedo ayudarte con tu suscripción?

*Temas comunes:*
• Cómo suscribirse
• Estado de suscripción
• Renovación
• Cancelación

Escribe tu pregunta usando: \`/cristina tu pregunta\``
          : `📱 *Subscription Help*

How can I help you with your subscription?

*Common topics:*
• How to subscribe
• Subscription status
• Renewal
• Cancellation

Type your question using: \`/cristina your question\``;
        break;

      case 'content':
        response = lang === 'es'
          ? `🎬 *Ayuda con Contenido*

¿Qué tipo de contenido te interesa?

*Disponible:*
• Transmisiones en vivo
• Videollamadas
• Fotos exclusivas
• Videos exclusivos
• Podcasts

Escribe tu pregunta usando: \`/cristina tu pregunta\``
          : `🎬 *Content Help*

What type of content are you interested in?

*Available:*
• Live streams
• Video calls
• Exclusive photos
• Exclusive videos
• Podcasts

Type your question using: \`/cristina your question\``;
        break;

      case 'payments':
        response = lang === 'es'
          ? `💳 *Ayuda con Pagos*

¿Necesitas ayuda con pagos?

*Temas comunes:*
• Métodos de pago aceptados
• Problemas con pagos
• Reembolsos
• Facturación

Escribe tu pregunta usando: \`/cristina tu pregunta\``
          : `💳 *Payment Help*

Need help with payments?

*Common topics:*
• Accepted payment methods
• Payment issues
• Refunds
• Billing

Type your question using: \`/cristina your question\``;
        break;

      case 'settings':
        response = lang === 'es'
          ? `⚙️ *Ayuda con Configuración*

¿Qué configuración necesitas ajustar?

*Opciones disponibles:*
• Perfil
• Notificaciones
• Idioma
• Privacidad

Escribe tu pregunta usando: \`/cristina tu pregunta\``
          : `⚙️ *Settings Help*

What settings do you need to adjust?

*Available options:*
• Profile
• Notifications
• Language
• Privacy

Type your question using: \`/cristina your question\``;
        break;

      case 'technical':
        response = lang === 'es'
          ? `🆘 *Soporte Técnico*

¿Tienes algún problema técnico?

*Problemas comunes:*
• No puedo acceder al grupo
• Los mensajes no se envían
• Problemas con multimedia
• Otros problemas

Escribe tu pregunta usando: \`/cristina tu pregunta\`

Si el problema persiste, usa /support para contactar a un humano.`
          : `🆘 *Technical Support*

Having a technical issue?

*Common issues:*
• Can't access the group
• Messages not sending
• Multimedia problems
• Other issues

Type your question using: \`/cristina your question\`

If the issue persists, use /support to contact a human.`;
        break;

      default:
        response = lang === 'es'
          ? '🤖 ¿En qué puedo ayudarte?'
          : '🤖 How can I help you?';
    }

    await ctx.editMessageText(response, {
      parse_mode: 'Markdown'
    });

    logger.info(`Cristina AI callback handled: ${topic} for user ${ctx.from.id}`);

  } catch (error) {
    logger.error('Error handling Cristina callback:', error);
    try {
      await ctx.answerCbQuery('Error processing request');
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Process a question and generate a response using Grok or keyword fallback
 */
async function processQuestion(question, lang, userId) {
  // Try Grok first
  if (isCristinaAIAvailable()) {
    try {
      const systemPrompt = await buildCristinaSystemPrompt(lang);

      // Build message history for context
      const conversation = activeConversations.get(userId);
      const history = conversation?.messages || [];
      const messages = [...history, { role: 'user', content: question }];

      const aiResponse = await chatWithCristina({
        systemPrompt,
        messages,
        maxTokens: parseInt(process.env.CRISTINA_MAX_TOKENS || '500', 10),
        temperature: 0.7,
      });

      if (aiResponse) {
        // Store conversation history
        addMessageToHistory(userId, 'user', question);
        addMessageToHistory(userId, 'assistant', aiResponse);
        logger.info(`Cristina AI: Grok response generated for user ${userId}`);
        return aiResponse;
      }
    } catch (aiError) {
      logger.error(`Cristina AI: Grok error, falling back to keywords: ${aiError.message}`);
    }
  }

  // Fallback to keyword-based responses
  const questionLower = question.toLowerCase();

  // Subscription-related questions
  if (questionLower.includes('subscri') || questionLower.includes('suscri')) {
    return lang === 'es'
      ? `📱 *Sobre Suscripción*

Para suscribirte, usa el comando /menu y selecciona "Suscripción".

Tu suscripción te da acceso a:
• Contenido exclusivo
• Transmisiones en vivo
• Videollamadas
• Grupo privado

¿Necesitas más información sobre algo específico?`
      : `📱 *About Subscription*

To subscribe, use the /menu command and select "Subscription".

Your subscription gives you access to:
• Exclusive content
• Live streams
• Video calls
• Private group

Need more information about something specific?`;
  }

  // Payment-related questions
  if (questionLower.includes('pay') || questionLower.includes('pag') || questionLower.includes('price') || questionLower.includes('precio')) {
    return lang === 'es'
      ? `💳 *Información de Pagos*

Aceptamos varios métodos de pago seguros.

Para ver métodos de pago y precios, usa:
/menu → Suscripción → Métodos de Pago

¿Tienes alguna pregunta específica sobre pagos?`
      : `💳 *Payment Information*

We accept various secure payment methods.

To view payment methods and prices, use:
/menu → Subscription → Payment Methods

Do you have any specific questions about payments?`;
  }

  // Live stream questions
  if (questionLower.includes('live') || questionLower.includes('stream') || questionLower.includes('vivo')) {
    return lang === 'es'
      ? `🔴 *Transmisiones en Vivo*

Las transmisiones en vivo son exclusivas para suscriptores.

Para acceder:
/menu → Contenido → Transmisiones en Vivo

Te notificaremos cuando comience una nueva transmisión.

¿Quieres saber más sobre el horario?`
      : `🔴 *Live Streams*

Live streams are exclusive to subscribers.

To access:
/menu → Content → Live Streams

We'll notify you when a new stream starts.

Want to know more about the schedule?`;
  }

  // Video call questions
  if (questionLower.includes('video call') || questionLower.includes('videollamada') || questionLower.includes('video chat')) {
    return lang === 'es'
      ? `📹 *Videollamadas*

Las videollamadas son un beneficio premium para suscriptores.

Para programar una videollamada:
/menu → Contenido → Videollamadas

¿Necesitas ayuda para programar una?`
      : `📹 *Video Calls*

Video calls are a premium benefit for subscribers.

To schedule a video call:
/menu → Content → Video Calls

Need help scheduling one?`;
  }

  // Group access questions
  if (questionLower.includes('group') || questionLower.includes('grupo') || questionLower.includes('join') || questionLower.includes('unir')) {
    return lang === 'es'
      ? `👥 *Acceso al Grupo*

Para unirte al grupo exclusivo:

1. Asegúrate de tener una suscripción activa
2. Usa /menu → Comunidad → Unirse al Grupo
3. Haz clic en el enlace de invitación

¿Tienes problemas para acceder?`
      : `👥 *Group Access*

To join the exclusive group:

1. Make sure you have an active subscription
2. Use /menu → Community → Join Group
3. Click the invitation link

Having trouble accessing?`;
  }

  // Rules questions
  if (questionLower.includes('rule') || questionLower.includes('regla')) {
    return lang === 'es'
      ? `📜 *Reglas de la Comunidad*

Para ver las reglas completas, usa:
/rules

Es importante seguir las reglas para mantener una comunidad positiva.

¿Tienes alguna pregunta sobre una regla específica?`
      : `📜 *Community Rules*

To view the complete rules, use:
/rules

It's important to follow the rules to maintain a positive community.

Do you have any questions about a specific rule?`;
  }

  // Profile/settings questions
  if (questionLower.includes('profile') || questionLower.includes('perfil') || questionLower.includes('setting') || questionLower.includes('config')) {
    return lang === 'es'
      ? `⚙️ *Perfil y Configuración*

Para administrar tu perfil y configuración:
/menu → Configuración

Puedes ajustar:
• Tu perfil
• Notificaciones
• Idioma
• Privacidad

¿Necesitas ayuda con algo específico?`
      : `⚙️ *Profile and Settings*

To manage your profile and settings:
/menu → Settings

You can adjust:
• Your profile
• Notifications
• Language
• Privacy

Need help with something specific?`;
  }

  // Help/support questions
  if (questionLower.includes('help') || questionLower.includes('ayuda') || questionLower.includes('support') || questionLower.includes('soporte')) {
    return lang === 'es'
      ? `🆘 *Ayuda y Soporte*

Estoy aquí para ayudarte! Puedes:

• Hacer cualquier pregunta con /cristina
• Ver el menú principal con /menu
• Ver preguntas frecuentes con /menu → Soporte → FAQ
• Contactar soporte humano con /support

¿En qué más puedo ayudarte?`
      : `🆘 *Help and Support*

I'm here to help! You can:

• Ask any question with /cristina
• View the main menu with /menu
• View FAQ with /menu → Support → FAQ
• Contact human support with /support

What else can I help you with?`;
  }

  // Default response for unrecognized questions
  const safeQuestion = sanitize.telegramMarkdown(question.substring(0, 100));
  return lang === 'es'
    ? `🤖 *Cristina AI*

Entiendo tu pregunta: "${safeQuestion}"

Estoy trabajando en mejorar mis respuestas. Mientras tanto, puedes:

• Explorar el menú: /menu
• Ver preguntas frecuentes: /menu → Soporte → FAQ
• Contactar soporte: /support

O intenta reformular tu pregunta de manera más específica.

*Temas que entiendo bien:*
• Suscripciones
• Pagos
• Transmisiones en vivo
• Videollamadas
• Acceso al grupo
• Reglas de la comunidad
• Configuración`
    : `🤖 *Cristina AI*

I understand your question: "${safeQuestion}"

I'm working on improving my responses. In the meantime, you can:

• Explore the menu: /menu
• View FAQ: /menu → Support → FAQ
• Contact support: /support

Or try rephrasing your question more specifically.

*Topics I understand well:*
• Subscriptions
• Payments
• Live streams
• Video calls
• Group access
• Community rules
• Settings`;
}

/**
 * Clean up old conversations (called periodically)
 */
function cleanupOldConversations() {
  const maxAge = 60 * 60 * 1000; // 1 hour
  const now = Date.now();

  for (const [userId, conversation] of activeConversations.entries()) {
    if (now - conversation.startedAt > maxAge) {
      activeConversations.delete(userId);
    }
  }
}

// Clean up every 30 minutes
setInterval(cleanupOldConversations, 30 * 60 * 1000);

module.exports = {
  handleCristinaCommand,
  handleCristinaCallback,
  buildCristinaSystemPrompt
};
