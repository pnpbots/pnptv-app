const { Markup } = require('telegraf');
const logger = require('../../utils/logger');
const config = require('../../config/config');
const MessageRateLimiter = require('./messageRateLimiter');

// Bot username for deep links
const BOT_USERNAME = process.env.BOT_USERNAME || 'pnplatinotv_bot';

/**
 * Tutorial Reminder Service
 * Sends proactive tutorial messages to the group (not privately) based on user subscription status:
 * - FREE/Churned users: How to subscribe and become PRIME
 * - PRIME users: How to use Nearby
 */
class TutorialReminderService {
  static bot = null;
  static GROUP_ID = config.GROUP_ID;

  /**
   * Initialize the service with bot instance
   * @param {Telegraf} bot - Bot instance
   */
  static initialize(bot) {
    this.bot = bot;
    logger.info('Tutorial reminder service initialized');
    if (!this.GROUP_ID) {
      logger.warn('GROUP_ID not configured - tutorials will not be sent');
    }
  }

  /**
   * Start sending reminders every 4 hours
   * Alternates between: health tip and tutorial
   */
  static startScheduling() {
    if (!this.bot) {
      logger.warn('Cannot start tutorial scheduling - bot not initialized');
      return;
    }
    if (!this.GROUP_ID) {
      logger.warn('Cannot start tutorial scheduling - GROUP_ID not configured');
      return;
    }

    // Track the last message type sent (0: health, 1: tutorial)
    let lastMessageType = -1;

    // Schedule to run every 4 hours (4 * 60 * 60 * 1000 milliseconds) - reduced frequency due to rate limiting
    const intervalId = setInterval(async () => {
      try {
        lastMessageType = await this.sendSingleScheduledTutorial(lastMessageType);
      } catch (error) {
        logger.error('Error in tutorial reminder scheduler:', error);
      }
    }, 4 * 60 * 60 * 1000);

    logger.info('Tutorial reminder scheduler started - alternating health/tutorial every 4 hours (rate limited to 6 messages/day)');
    return intervalId;
  }

  /**
   * Send a single scheduled message
   * Alternates between: health tip and tutorial
   * @param {number} lastType - Last message type sent (0: health, 1: tutorial)
   * @returns {number} The message type that was just sent
   */
  static async sendSingleScheduledTutorial(lastType) {
    if (!this.bot || !this.GROUP_ID) {
      logger.warn('Cannot send scheduled tutorial - service not properly initialized');
      return lastType;
    }

    try {
      // Alternate between health (0) and tutorial (1)
      const nextType = (lastType + 1) % 2;

      if (nextType === 0) {
        await this.sendHealthMessage();
        logger.info('Health tip sent to group');
      } else {
        await this.sendPrimeFeaturesTutorial();
        logger.info('Tutorial sent to group');
      }

      return nextType;
    } catch (error) {
      logger.error('Error sending scheduled message:', error);
      return lastType;
    }
  }

  /**
   * Send health tip to group
   */
  static async sendHealthMessage() {
    const tips = [
      '💧 Stay hydrated! Water is your best friend.',
      '😴 Rest when you need to. Your body knows best.',
      '🧘 Take a break, breathe deep, reset.',
      '🍎 Nourish your body - eat something good today.',
      '💙 Check in on a friend. Connection matters.'
    ];
    const tip = tips[Math.floor(Math.random() * tips.length)];

    try {
      // Atomic check and record to prevent race conditions
      const rateLimitCheck = await MessageRateLimiter.checkAndRecordMessage(6);
      if (!rateLimitCheck.canSend) {
        logger.info(`Rate limit reached - cannot send health message. Messages today: ${rateLimitCheck.messagesSentToday}/6`);
        return;
      }

      await this.bot.telegram.sendMessage(this.GROUP_ID, tip, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('Error sending health message:', error.message);
      throw error;
    }
  }

  /**
   * Send PRIME features tutorial to group
   */
  static async sendPrimeFeaturesTutorial() {
    const message = `💎 PRIME te da:
• Videos completos de Santino, Lex y latinos hot 🔥
• Nearby ilimitado
• Canal PRIME exclusivo

💰 $14.99/semana
🔥 HOT PNP LIFETIME: $100 → pnptv.app/lifetime100

📸 Comparte fotos para competir por títulos del culto diarios:
• High Legend of the Cult (más interacciones) = 3 días PRIME
• Tribute of the Cult (nuevo miembro en 3 horas)
• The Loyal Disciple (más fotos del día)
🎉 Con un badge del culto quedas invitado a la Meth Gala de fin de mes.`;

    try {
      // Atomic check and record to prevent race conditions
      const rateLimitCheck = await MessageRateLimiter.checkAndRecordMessage(6);
      if (!rateLimitCheck.canSend) {
        logger.info(`Rate limit reached - cannot send PRIME features tutorial. Messages today: ${rateLimitCheck.messagesSentToday}/6`);
        return;
      }

      await this.bot.telegram.sendMessage(this.GROUP_ID, message, {
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('Error sending PRIME features tutorial:', error.message);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FREE/CHURNED USER TUTORIALS - How to become PRIME
  // ═══════════════════════════════════════════════════════════════════════════

  static FREE_USER_TUTORIALS = {
    en: [
      {
        title: 'Unlock Full Videos',
        message: `🎬 *Unlock Full-Length Videos!*

Hey papi! Did you know PRIME members get access to *full-length exclusive videos*?

As a free member, you only see previews. Upgrade to PRIME and enjoy:

✅ Full videos from Santino, Lex & the crew
✅ New content added weekly
✅ No ads, no limits

💎 *Ready to unlock everything?*

Tap the button below to see our plans!`,
        button: { text: '💎 View PRIME Plans', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      },
      {
        title: 'Unlimited Nearby',
        message: `📍 *Want Unlimited Nearby Access?*

Free members get only *3 Nearby views per day*. Missing out on connecting with cloudy papis near you?

PRIME members enjoy:

✅ *Unlimited* Nearby searches
✅ See who's online right now
✅ Connect with members in your area
✅ Real-time location sharing

💎 *Upgrade to PRIME* and never miss a connection!`,
        button: { text: '💎 Upgrade Now', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      },

      {
        title: 'How to Subscribe',
        message: `💳 *How to Become PRIME - It's Easy!*

Ready to unlock all the cloudy fun? Here's how:

*Step 1:* Tap "View Plans" below
*Step 2:* Choose your plan (Monthly, 6-Month, or Lifetime)
*Step 3:* Pay securely via Meru or crypto
*Step 4:* Get instant PRIME access!

💰 *Plans start at just $14.99/week*

🔒 All payments are secure and private.`,
        button: { text: '💎 View Plans', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      },
      {
        title: 'Lifetime Pass',
        message: `♾️ *Get Lifetime Access - Pay Once, Enjoy Forever!*

Our *Lifetime Pass* is the best value:

💎 *$100 one-time payment*
✅ PRIME access forever
✅ All current features
✅ All future features included
✅ Never pay again!

This is perfect for our most dedicated members.

🔥 *Limited availability!*`,
        button: { text: '💎 Get Lifetime Pass', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      }
    ],
    es: [
      {
        title: 'Desbloquea Videos Completos',
        message: `🎬 *¡Desbloquea Videos Completos!*

¡Hola papi! ¿Sabías que los miembros PRIME tienen acceso a *videos exclusivos completos*?

Como miembro gratis, solo ves previews. Hazte PRIME y disfruta:

✅ Videos completos de Santino, Lex y el equipo
✅ Contenido nuevo cada semana
✅ Sin anuncios, sin límites

💎 *¿Listo para desbloquear todo?*

¡Toca el botón para ver nuestros planes!`,
        button: { text: '💎 Ver Planes PRIME', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      },
      {
        title: 'Nearby Ilimitado',
        message: `📍 *¿Quieres Acceso Ilimitado a Nearby?*

Los miembros gratis solo tienen *3 vistas de Nearby por día*. ¿Te estás perdiendo de conectar con papis cerca de ti?

Los miembros PRIME disfrutan:

✅ Búsquedas de Nearby *ilimitadas*
✅ Ve quién está en línea ahora
✅ Conecta con miembros en tu área
✅ Ubicación en tiempo real

💎 *¡Hazte PRIME* y nunca pierdas una conexión!`,
        button: { text: '💎 Actualizar Ahora', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      },

      {
        title: 'Cómo Suscribirse',
        message: `💳 *Cómo Hacerte PRIME - ¡Es Fácil!*

¿Listo para desbloquear toda la diversión? Así es como:

*Paso 1:* Toca "Ver Planes" abajo
*Paso 2:* Elige tu plan (Mensual, 6 Meses o Lifetime)
*Paso 3:* Paga de forma segura via Meru o cripto
*Paso 4:* ¡Obtén acceso PRIME instantáneo!

💰 *Los planes empiezan en solo $14.99/semana*

🔒 Todos los pagos son seguros y privados.`,
        button: { text: '💎 Ver Planes', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      },
      {
        title: 'Pase de por Vida',
        message: `♾️ *Obtén Acceso de por Vida - ¡Paga Una Vez, Disfruta Siempre!*

Nuestro *Lifetime Pass* es el mejor valor:

💎 *$100 pago único*
✅ Acceso PRIME para siempre
✅ Todas las funciones actuales
✅ Todas las funciones futuras incluidas
✅ ¡Nunca pagues de nuevo!

Esto es perfecto para nuestros miembros más dedicados.

🔥 *¡Disponibilidad limitada!*`,
        button: { text: '💎 Obtener Lifetime Pass', url: `https://t.me/${BOT_USERNAME}?start=plans` }
      }
    ]
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIME USER TUTORIALS - How to use features
  // ═══════════════════════════════════════════════════════════════════════════

  static PRIME_USER_TUTORIALS = {
    en: [
      {
        title: 'How to Use Nearby',
        message: `📍 *Tutorial: How to Use "Who is Nearby?"*

Find cloudy papis near you in seconds!

*How it works:*

1️⃣ Tap the *"Who is Nearby?"* button in the menu
2️⃣ Share your location when prompted
3️⃣ See a map with nearby members
4️⃣ Tap on profiles to connect!

💡 *Tips:*
• Enable location sharing in your profile settings
• Your exact location is never shown - only approximate
• Refresh anytime to see who's online now

🔥 *Start exploring!*`,
        button: { text: '📍 Open Nearby', url: `https://t.me/${BOT_USERNAME}?start=nearby` }
      },


      {
        title: 'Your PRIME Benefits',
        message: `💎 *Reminder: Your PRIME Benefits*

Thank you for being a PRIME member! Here's everything you have access to:

✅ *Full Videos* - Complete exclusive content
✅ *Unlimited Nearby* - Find papis anytime
✅ *PRIME Channel* - Exclusive posts
✅ *Priority Support* - We're here for you!

📱 *Quick access:*
• /menu - Open main menu
• /profile - View your profile
• /support - Get help

💜 *Thanks for being part of the community!*`,
        button: { text: '📱 Open Menu', url: `https://t.me/${BOT_USERNAME}?start=home` }
      },
      {
        title: 'Exclusive Content',
        message: `🎬 *Don't Miss Our Exclusive Content!*

As a PRIME member, you have access to our *exclusive video library*!

*What's available:*

📹 Full-length videos from Santino, Lex & crew
🔥 Behind-the-scenes content
🎭 Special performances
📺 New content added weekly!

*How to access:*
Tap *"Exclusive Content"* in the menu to browse the full library.

🍿 *What are you watching today?*`,
        button: { text: '🎬 View Content', url: `https://t.me/${BOT_USERNAME}?start=content` }
      }
    ],
    es: [
      {
        title: 'Cómo Usar Nearby',
        message: `📍 *Tutorial: Cómo Usar "¿Quién está Cerca?"*

¡Encuentra papis cerca de ti en segundos!

*Cómo funciona:*

1️⃣ Toca el botón *"¿Quién está Cerca?"* en el menú
2️⃣ Comparte tu ubicación cuando se te pida
3️⃣ Ve un mapa con miembros cercanos
4️⃣ ¡Toca los perfiles para conectar!

💡 *Consejos:*
• Activa compartir ubicación en tu perfil
• Tu ubicación exacta nunca se muestra - solo aproximada
• Actualiza en cualquier momento para ver quién está en línea

🔥 *¡Empieza a explorar!*`,
        button: { text: '📍 Abrir Nearby', url: `https://t.me/${BOT_USERNAME}?start=nearby` }
      },
      {
        title: 'Cómo Usar Hangouts',
        message: `🎥 *Tutorial: Cómo Unirte a Video Hangouts*

¡Conecta cara a cara con la comunidad!

*Cómo unirte a un Hangout:*

1️⃣ Toca *"PNPtv Video Rooms"* en el menú
2️⃣ Ve las salas disponibles y quién está dentro
3️⃣ Toca *"Unirse a Sala"* para entrar
4️⃣ Permite acceso a cámara/micrófono

💡 *Consejos:*
• Puedes unirte con la cámara apagada
• Sé respetuoso - ¡el consentimiento importa!
• Revisa el calendario para eventos especiales
• Crea tu propia sala privada en cualquier momento

🎉 *¡Únete a la fiesta!*`,
        button: { text: '🎥 Abrir Hangouts', url: `https://t.me/${BOT_USERNAME}?start=hangouts` }
      },

      {
        title: 'Tus Beneficios PRIME',
        message: `💎 *Recordatorio: Tus Beneficios PRIME*

¡Gracias por ser miembro PRIME! Aquí está todo lo que tienes acceso:

✅ *Videos Completos* - Contenido exclusivo completo
✅ *Nearby Ilimitado* - Encuentra papis cuando quieras
✅ *Canal PRIME* - Posts exclusivos
✅ *Soporte Prioritario* - ¡Estamos aquí para ti!

📱 *Acceso rápido:*
• /menu - Abrir menú principal
• /profile - Ver tu perfil
• /support - Obtener ayuda

💜 *¡Gracias por ser parte de la comunidad!*`,
        button: { text: '📱 Abrir Menú', url: `https://t.me/${BOT_USERNAME}?start=home` }
      },
      {
        title: 'Contenido Exclusivo',
        message: `🎬 *¡No Te Pierdas Nuestro Contenido Exclusivo!*

Como miembro PRIME, ¡tienes acceso a nuestra *biblioteca de videos exclusivos*!

*¿Qué está disponible?*

📹 Videos completos de Santino, Lex y el equipo
🔥 Contenido detrás de cámaras
🎭 Presentaciones especiales
📺 ¡Contenido nuevo cada semana!

*Cómo acceder:*
Toca *"Contenido Exclusivo"* en el menú para explorar toda la biblioteca.

🍿 *¿Qué vas a ver hoy?*`,
        button: { text: '🎬 Ver Contenido', url: `https://t.me/${BOT_USERNAME}?start=content` }
      }
    ]
  };

  // NOTE: getUsersByStatus was removed as dead code
  // The service now sends tutorials to the GROUP, not individual users

  /**
   * Send tutorial to the group (not privately to users)
   * @param {Object} tutorial - Tutorial object with title, message, button
   * @returns {Promise<boolean>} Success status
   */
  static async sendTutorialToGroup(tutorial) {
    try {
      if (!this.bot) {
        logger.error('Bot not initialized');
        return false;
      }

      if (!this.GROUP_ID) {
        logger.error('GROUP_ID not configured - cannot send tutorials');
        return false;
      }

      // Atomic check and record to prevent race conditions
      const rateLimitCheck = await MessageRateLimiter.checkAndRecordMessage(6);
      if (!rateLimitCheck.canSend) {
        logger.info(`Rate limit reached - cannot send tutorial. Messages today: ${rateLimitCheck.messagesSentToday}/6`);
        return false;
      }

      const keyboard = tutorial.button
        ? Markup.inlineKeyboard([
            tutorial.button.url
              ? [Markup.button.url(tutorial.button.text, tutorial.button.url)]
              : [Markup.button.callback(tutorial.button.text, tutorial.button.callback)]
          ])
        : undefined;

      await this.bot.telegram.sendMessage(this.GROUP_ID, tutorial.message, {
        parse_mode: 'Markdown',
        ...(keyboard ? keyboard : {})
      });

      logger.info(`Tutorial sent to group ${this.GROUP_ID}: ${tutorial.title}`);
      return true;
    } catch (error) {
      if (error.response?.error_code === 403) {
        logger.error(`Cannot send tutorial to group ${this.GROUP_ID}: Bot blocked in group`);
      } else if (error.response?.error_code === 400) {
        logger.error(`Cannot send tutorial to group ${this.GROUP_ID}: Group not found`);
      } else {
        logger.error(`Error sending tutorial to group ${this.GROUP_ID}:`, error.message);
      }
      return false;
    }
  }

  /**
   * Send tutorials to the group about becoming PRIME (for FREE/Churned users)
   * @param {number} maxTutorials - Maximum tutorials to send (default 1)
   * @returns {Promise<Object>} Results { sent, failed }
   */
  static async sendFreeTutorials(maxTutorials = 1) {
    try {
      logger.info('Starting FREE user tutorials...');

      if (!this.GROUP_ID) {
        logger.error('GROUP_ID not configured - cannot send tutorials');
        return { sent: 0, failed: 1 };
      }

      let sent = 0;
      let failed = 0;

      // Send tutorials to the group instead of individual users
      for (let i = 0; i < maxTutorials; i++) {
        // Alternate between English and Spanish tutorials
        const lang = i % 2 === 0 ? 'en' : 'es';
        const tutorials = this.FREE_USER_TUTORIALS[lang];

        // Pick a random tutorial
        const tutorial = tutorials[Math.floor(Math.random() * tutorials.length)];

        const success = await this.sendTutorialToGroup(tutorial);
        if (success) {
          sent++;
        } else {
          failed++;
        }

        // Rate limit protection - 200ms for hourly scheduling
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info(`FREE tutorials completed: ${sent} sent to group, ${failed} failed`);
      return { sent, failed };
    } catch (error) {
      logger.error('Error in sendFreeTutorials:', error);
      return { sent: 0, failed: 0 };
    }
  }

  /**
   * Send tutorials to the group about using features (for PRIME users)
   * @param {number} maxTutorials - Maximum tutorials to send (default 1)
   * @returns {Promise<Object>} Results { sent, failed }
   */
  static async sendPrimeTutorials(maxTutorials = 1) {
    try {
      logger.info('Starting PRIME user tutorials...');

      if (!this.GROUP_ID) {
        logger.error('GROUP_ID not configured - cannot send tutorials');
        return { sent: 0, failed: 1 };
      }

      let sent = 0;
      let failed = 0;

      // Send tutorials to the group instead of individual users
      for (let i = 0; i < maxTutorials; i++) {
        // Alternate between English and Spanish tutorials
        const lang = i % 2 === 0 ? 'en' : 'es';
        const tutorials = this.PRIME_USER_TUTORIALS[lang];

        // Pick a random tutorial
        const tutorial = tutorials[Math.floor(Math.random() * tutorials.length)];

        const success = await this.sendTutorialToGroup(tutorial);
        if (success) {
          sent++;
        } else {
          failed++;
        }

        // Rate limit protection - 200ms for hourly scheduling
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info(`PRIME tutorials completed: ${sent} sent to group, ${failed} failed`);
      return { sent, failed };
    } catch (error) {
      logger.error('Error in sendPrimeTutorials:', error);
      return { sent: 0, failed: 0 };
    }
  }

  /**
   * Run all tutorial reminders
   * @returns {Promise<Object>} Combined results
   */
  static async runAllTutorials() {
    logger.info('Running all tutorial reminders...');

    const freeResults = await this.sendFreeTutorials();
    const primeResults = await this.sendPrimeTutorials();

    const results = {
      free: freeResults,
      prime: primeResults,
      total: {
        sent: freeResults.sent + primeResults.sent,
        failed: freeResults.failed + primeResults.failed
      }
    };

    logger.info('Tutorial reminders completed', results);
    return results;
  }
}

module.exports = TutorialReminderService;
