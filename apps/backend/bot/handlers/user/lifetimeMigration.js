const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const { isValidEmail } = require('../../../utils/validation');
const supportRoutingService = require('../../services/supportRoutingService');

/**
 * Escape special Markdown characters in user-provided text
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for Markdown
 */
const escapeMarkdown = (text) => {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
};

/**
 * Lifetime Migration Wizard Handler
 * Allows users to request migration of their lifetime membership from old PNPtv
 * @param {Telegraf} bot - Bot instance
 */
const registerLifetimeMigrationHandlers = (bot) => {
  // Start migration wizard
  bot.action('migrate_lifetime_start', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';

      // Initialize migration session
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.lifetimeMigration = {
        step: 'email',
        email: null,
        proofReceived: false
      };
      await ctx.saveSession();

      const message = lang === 'es'
        ? `🔄 *Migrar Membresía Lifetime*

¡Bienvenido al proceso de migración!

Si compraste un *Lifetime Pass* en el viejo PNPtv, podemos transferir tu membresía a esta nueva plataforma.

📧 *Paso 1 de 2:* Por favor envía el correo electrónico que usaste para la compra original.

_Escribe tu email ahora:_`
        : `🔄 *Migrate Lifetime Membership*

Welcome to the migration process!

If you purchased a *Lifetime Pass* on the old PNPtv, we can transfer your membership to this new platform.

📧 *Step 1 of 2:* Please send the email address you used for the original purchase.

_Type your email now:_`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '❌ Cancelar' : '❌ Cancel', 'migrate_lifetime_cancel')]
        ])
      });
    } catch (error) {
      logger.error('Error starting lifetime migration:', error);
      await ctx.answerCbQuery('Error starting migration. Please try again.');
    }
  });

  // Cancel migration
  bot.action('migrate_lifetime_cancel', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';

      // Clear migration session
      if (ctx.session.temp) {
        delete ctx.session.temp.lifetimeMigration;
        await ctx.saveSession();
      }

      const message = lang === 'es'
        ? '❌ Migración cancelada. Puedes iniciarla de nuevo desde el menú principal.'
        : '❌ Migration cancelled. You can start it again from the main menu.';

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menú' : '🔙 Back to Menu', 'back_to_main')]
        ])
      });
    } catch (error) {
      logger.error('Error cancelling lifetime migration:', error);
    }
  });

  // Confirm proof received and submit request
  bot.action('migrate_lifetime_confirm', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const migration = ctx.session.temp?.lifetimeMigration;

      if (!migration || !migration.email || !migration.proofReceived) {
        await ctx.answerCbQuery(lang === 'es' ? 'Por favor completa todos los pasos primero.' : 'Please complete all steps first.');
        return;
      }

      const userId = ctx.from.id;
      const username = ctx.from.username ? `@${escapeMarkdown(ctx.from.username)}` : 'No username';
      const firstName = escapeMarkdown(ctx.from.first_name || 'Unknown');
      const safeEmail = escapeMarkdown(migration.email);

      // Send to support group using centralized method
      try {
        const user = ctx.from;
        const supportMessage = `📧 *Email:* ${safeEmail}

📸 El usuario envió comprobante de pago arriba.

⚠️ *Acción requerida:*
• Verificar que el email coincida con registros del viejo PNPtv
• Verificar el comprobante de pago
• Si es válido, activar manualmente con /activate ${userId} lifetime`;
        const supportTopic = await supportRoutingService.sendToSupportGroup(supportMessage, 'activation', user, 'text', ctx);
        logger.info('Lifetime migration request sent to support group', { userId, email: migration.email, threadId: supportTopic?.thread_id });
      } catch (err) {
        logger.error('Failed to send migration request to support group:', err);
      }      // Clear migration session
      delete ctx.session.temp.lifetimeMigration;
      await ctx.saveSession();

      // Send confirmation to user
      const confirmMessage = lang === 'es'
        ? `✅ *Solicitud Recibida*

Hemos recibido tu solicitud de migración de *Lifetime Pass*.

📧 *Email registrado:* ${safeEmail}
📸 *Comprobante:* Recibido

⏱️ *Tiempo de respuesta:* 48 a 72 horas

Nuestro equipo verificará tu compra en el viejo PNPtv y te notificará cuando tu membresía esté activa.

_Solo las membresías Lifetime serán transferidas._

Si tienes preguntas, usa /support para contactarnos.`
        : `✅ *Request Received*

We have received your *Lifetime Pass* migration request.

📧 *Registered email:* ${safeEmail}
📸 *Proof:* Received

⏱️ *Response time:* 48 to 72 hours

Our team will verify your purchase on the old PNPtv and notify you when your membership is active.

_Only Lifetime memberships will be transferred._

If you have questions, use /support to contact us.`;

      await ctx.editMessageText(confirmMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menú' : '🔙 Back to Menu', 'back_to_main')]
        ])
      });
    } catch (error) {
      logger.error('Error confirming lifetime migration:', error);
      await ctx.answerCbQuery('Error submitting request. Please try again.');
    }
  });

  // Handle text input for email (in migration flow)
  bot.on('text', async (ctx, next) => {
    const migration = ctx.session.temp?.lifetimeMigration;

    if (!migration || migration.step !== 'email') {
      return next();
    }

    const lang = ctx.session?.language || 'en';
    const rawEmail = ctx.message.text.trim().toLowerCase();

    // Validate email
    if (rawEmail.length > 254 || rawEmail.length < 5 || !isValidEmail(rawEmail)) {
      const errorMsg = lang === 'es'
        ? '❌ Email inválido. Por favor envía un email válido (ejemplo: usuario@email.com):'
        : '❌ Invalid email. Please send a valid email (example: user@email.com):';
      await ctx.reply(errorMsg);
      return;
    }

    // Save email and move to next step
    ctx.session.temp.lifetimeMigration.email = rawEmail;
    ctx.session.temp.lifetimeMigration.step = 'proof';
    await ctx.saveSession();

    // Escape underscores in email to prevent Markdown parsing issues
    const safeEmail = rawEmail.replace(/_/g, '\\_');

    const proofMessage = lang === 'es'
      ? `✅ *Email registrado:* ${safeEmail}

📸 *Paso 2 de 2:* Ahora envía una captura de pantalla o foto del comprobante de pago.

Puede ser:
• Recibo de PayPal
• Confirmación de transferencia
• Email de confirmación de compra
• Cualquier prueba del pago original

Envía la imagen ahora:`
      : `✅ *Email registered:* ${safeEmail}

📸 *Step 2 of 2:* Now send a screenshot or photo of your payment proof.

This can be:
• PayPal receipt
• Transfer confirmation
• Purchase confirmation email
• Any proof of original payment

Send the image now:`;

    await ctx.reply(proofMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(lang === 'es' ? '❌ Cancelar' : '❌ Cancel', 'migrate_lifetime_cancel')]
      ])
    });
  });

  // Handle photo input for proof
  bot.on('photo', async (ctx, next) => {
    const migration = ctx.session.temp?.lifetimeMigration;

    if (!migration || migration.step !== 'proof') {
      return next();
    }

    const lang = ctx.session?.language || 'en';
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${escapeMarkdown(ctx.from.username)}` : 'No username';
    const safeEmail = escapeMarkdown(migration.email);

    // Forward photo to support group
    const supportGroupId = process.env.SUPPORT_GROUP_ID;
    if (supportGroupId) {
      try {
        // Forward the original photo
        await ctx.forwardMessage(supportGroupId);

        // Send context message
        const contextMsg = `📸 *Comprobante de pago para migración Lifetime*

👤 User: ${username} (ID: \`${userId}\`)
📧 Email: ${safeEmail}`;

        await ctx.telegram.sendMessage(supportGroupId, contextMsg, { parse_mode: 'Markdown' });
      } catch (err) {
        logger.error('Failed to forward proof to support group:', err);
      }
    }

    // Mark proof as received
    ctx.session.temp.lifetimeMigration.proofReceived = true;
    await ctx.saveSession();

    // Ask for confirmation
    const confirmMsg = lang === 'es'
      ? `✅ *Comprobante Recibido*

📧 *Email:* ${safeEmail}
📸 *Comprobante:* Recibido

¿Todo está correcto? Presiona confirmar para enviar tu solicitud.

⚠️ *Importante:* Solo las membresías Lifetime serán transferidas.`
      : `✅ *Proof Received*

📧 *Email:* ${safeEmail}
📸 *Proof:* Received

Is everything correct? Press confirm to submit your request.

⚠️ *Important:* Only Lifetime memberships will be transferred.`;

    await ctx.reply(confirmMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(lang === 'es' ? '✅ Confirmar y Enviar' : '✅ Confirm & Submit', 'migrate_lifetime_confirm')],
        [Markup.button.callback(lang === 'es' ? '❌ Cancelar' : '❌ Cancel', 'migrate_lifetime_cancel')]
      ])
    });
  });

  // Handle document input for proof (in case they send as document)
  bot.on('document', async (ctx, next) => {
    const migration = ctx.session.temp?.lifetimeMigration;

    if (!migration || migration.step !== 'proof') {
      return next();
    }

    const lang = ctx.session?.language || 'en';
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : 'No username';

    // Forward document to support group
    const supportGroupId = process.env.SUPPORT_GROUP_ID;
    if (supportGroupId) {
      try {
        await ctx.forwardMessage(supportGroupId);

        const contextMsg = `📎 *Documento de prueba para migración Lifetime*

👤 User: ${username} (ID: \`${userId}\`)
📧 Email: ${migration.email}`;

        await ctx.telegram.sendMessage(supportGroupId, contextMsg, { parse_mode: 'Markdown' });
      } catch (err) {
        logger.error('Failed to forward document to support group:', err);
      }
    }

    // Mark proof as received
    ctx.session.temp.lifetimeMigration.proofReceived = true;
    await ctx.saveSession();

    // Ask for confirmation
    const confirmMsg = lang === 'es'
      ? `✅ *Documento Recibido*

📧 *Email:* ${migration.email}
📎 *Documento:* Recibido

¿Todo está correcto? Presiona confirmar para enviar tu solicitud.

⚠️ *Importante:* Solo las membresías Lifetime serán transferidas.`
      : `✅ *Document Received*

📧 *Email:* ${migration.email}
📎 *Document:* Received

Is everything correct? Press confirm to submit your request.

⚠️ *Important:* Only Lifetime memberships will be transferred.`;

    await ctx.reply(confirmMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(lang === 'es' ? '✅ Confirmar y Enviar' : '✅ Confirm & Submit', 'migrate_lifetime_confirm')],
        [Markup.button.callback(lang === 'es' ? '❌ Cancelar' : '❌ Cancel', 'migrate_lifetime_cancel')]
      ])
    });
  });
};

module.exports = registerLifetimeMigrationHandlers;
