/**
 * Promo Administration Handler
 * Modern UI for managing promotional offers from the admin panel
 */

const { Markup } = require('telegraf');
const PromoModel = require('../../../models/promoModel');
const PlanModel = require('../../../models/planModel');
const PermissionService = require('../../services/permissionService');
const { safeAnswerCbQuery, safeReplyOrEdit } = require('../../utils/helpers');
const logger = require('../../../utils/logger');

/**
 * Get language from context
 */
function getLanguage(ctx) {
  return ctx.session?.language || ctx.from?.language_code || 'en';
}

/**
 * Format date for display
 */
function formatDate(date, lang = 'en') {
  if (!date) return lang === 'es' ? 'Sin limite' : 'No limit';
  const d = new Date(date);
  return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Show promo management main menu
 */
async function showPromoAdminMenu(ctx, edit = true) {
  const lang = getLanguage(ctx);

  try {
    // Get active promos count
    const promos = await PromoModel.getAll(false);
    const activeCount = promos.filter(p => PromoModel.isPromoValid(p)).length;
    const totalCount = promos.length;

    const title = lang === 'es' ? 'GESTION DE PROMOS' : 'PROMO MANAGEMENT';
    const subtitle = lang === 'es'
      ? `${activeCount} promos activas de ${totalCount} totales`
      : `${activeCount} active promos of ${totalCount} total`;

    const message = `*${title}*\n\n` +
      `${subtitle}\n\n` +
      (lang === 'es'
        ? 'Gestiona ofertas promocionales con descuentos, limites de cupos y segmentacion de audiencia.'
        : 'Manage promotional offers with discounts, spot limits, and audience targeting.');

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '➕ Crear Nueva Promo' : '➕ Create New Promo',
        'promo_admin_create'
      )],
      [Markup.button.callback(
        lang === 'es' ? '📋 Ver Todas las Promos' : '📋 View All Promos',
        'promo_admin_list'
      )],
      [Markup.button.callback(
        lang === 'es' ? '📊 Estadisticas' : '📊 Statistics',
        'promo_admin_stats_overview'
      )],
      [Markup.button.callback(
        lang === 'es' ? '◀️ Volver al Admin' : '◀️ Back to Admin',
        'admin_panel'
      )],
    ];

    const options = {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    };

    if (edit && ctx.callbackQuery) {
      await ctx.editMessageText(message, options);
    } else {
      await ctx.reply(message, options);
    }
  } catch (error) {
    logger.error('Error showing promo admin menu:', error);
    await ctx.reply(lang === 'es' ? 'Error cargando menu.' : 'Error loading menu.');
  }
}

/**
 * Show list of all promos
 */
async function showPromoList(ctx) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    const promos = await PromoModel.getAll(true); // Include inactive

    if (promos.length === 0) {
      const message = lang === 'es'
        ? '*No hay promos*\n\nCrea tu primera promocion para empezar.'
        : '*No promos found*\n\nCreate your first promotion to get started.';

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(
            lang === 'es' ? '➕ Crear Promo' : '➕ Create Promo',
            'promo_admin_create'
          )],
          [Markup.button.callback(
            lang === 'es' ? '◀️ Volver' : '◀️ Back',
            'promo_admin_menu'
          )],
        ]),
      });
      return;
    }

    let message = lang === 'es' ? '*LISTA DE PROMOS*\n\n' : '*PROMO LIST*\n\n';

    const buttons = [];

    for (const promo of promos.slice(0, 8)) { // Show max 8 promos
      const pricing = await PromoModel.calculatePrice(promo);
      const isAnyPlan = PromoModel.isAnyPlanPromo(promo);
      const isValid = PromoModel.isPromoValid(promo);
      const statusIcon = promo.active ? (isValid ? '🟢' : '🟡') : '🔴';
      const spotsInfo = promo.maxSpots
        ? `${promo.currentSpotsUsed}/${promo.maxSpots}`
        : '∞';

      message += `${statusIcon} *${promo.code}*\n`;
      if (isAnyPlan) {
        message += `   ${promo.discountValue}% ${lang === 'es' ? 'en cualquier plan' : 'off any plan'}\n`;
      } else {
        message += `   $${pricing.finalPrice} (${promo.discountType === 'percentage' ? promo.discountValue + '%' : 'fijo'})\n`;
      }
      message += `   ${lang === 'es' ? 'Cupos' : 'Spots'}: ${spotsInfo} | ${promo.completedRedemptions || 0} ${lang === 'es' ? 'completadas' : 'completed'}\n\n`;

      buttons.push([
        Markup.button.callback(
          `${statusIcon} ${promo.code} - ${lang === 'es' ? 'Ver' : 'View'}`,
          `promo_admin_view_${promo.id}`
        ),
      ]);
    }

    if (promos.length > 8) {
      message += `\n_${lang === 'es' ? 'Mostrando 8 de' : 'Showing 8 of'} ${promos.length} promos_`;
    }

    message += `\n\n${lang === 'es' ? 'Leyenda' : 'Legend'}: 🟢 ${lang === 'es' ? 'Activa' : 'Active'} | 🟡 ${lang === 'es' ? 'Expirada/Llena' : 'Expired/Full'} | 🔴 ${lang === 'es' ? 'Inactiva' : 'Inactive'}`;

    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '➕ Nueva Promo' : '➕ New Promo',
        'promo_admin_create'
      ),
    ]);
    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '◀️ Volver' : '◀️ Back',
        'promo_admin_menu'
      ),
    ]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error showing promo list:', error);
    await ctx.answerCbQuery(lang === 'es' ? 'Error' : 'Error');
  }
}

/**
 * View single promo details
 */
async function showPromoDetails(ctx, promoId) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    const stats = await PromoModel.getStats(promoId);
    if (!stats) {
      await ctx.editMessageText(lang === 'es' ? 'Promo no encontrada.' : 'Promo not found.');
      return;
    }

    const pricing = await PromoModel.calculatePrice(stats);
    const isAnyPlan = PromoModel.isAnyPlanPromo(stats);
    const isValid = PromoModel.isPromoValid(stats);
    const statusIcon = stats.active ? (isValid ? '🟢' : '🟡') : '🔴';
    const statusText = stats.active
      ? (isValid
        ? (lang === 'es' ? 'Activa' : 'Active')
        : (lang === 'es' ? 'Expirada/Llena' : 'Expired/Full'))
      : (lang === 'es' ? 'Inactiva' : 'Inactive');

    const audienceLabels = {
      all: lang === 'es' ? 'Todos' : 'Everyone',
      churned: lang === 'es' ? 'Ex-Suscriptores' : 'Churned Users',
      new_users: lang === 'es' ? 'Nuevos Usuarios' : 'New Users',
      free_users: lang === 'es' ? 'Usuarios Gratis' : 'Free Users',
    };

    let message = `${statusIcon} *${stats.code}*\n`;
    message += `${stats.name}\n\n`;

    message += `*${lang === 'es' ? 'PRECIO' : 'PRICING'}*\n`;
    if (isAnyPlan) {
      message += `├ ${lang === 'es' ? 'Descuento' : 'Discount'}: ${stats.discountValue}% (${lang === 'es' ? 'cualquier plan' : 'any plan'})\n`;
    } else {
      message += `├ ${lang === 'es' ? 'Original' : 'Original'}: $${pricing.originalPrice}\n`;
      message += `├ ${lang === 'es' ? 'Descuento' : 'Discount'}: ${stats.discountType === 'percentage' ? stats.discountValue + '%' : '$' + stats.discountValue}\n`;
      message += `└ *${lang === 'es' ? 'Final' : 'Final'}: $${pricing.finalPrice}*\n`;
    }
    message += '\n';

    message += `*${lang === 'es' ? 'CONFIGURACION' : 'CONFIGURATION'}*\n`;
    message += `├ ${lang === 'es' ? 'Plan base' : 'Base plan'}: ${isAnyPlan ? (lang === 'es' ? 'Cualquier Plan' : 'Any Plan') : stats.basePlanId}\n`;
    message += `├ ${lang === 'es' ? 'Audiencia' : 'Audience'}: ${audienceLabels[stats.targetAudience] || stats.targetAudience}\n`;
    message += `├ ${lang === 'es' ? 'Cupos' : 'Spots'}: ${stats.currentSpotsUsed}${stats.maxSpots ? '/' + stats.maxSpots : ' (∞)'}\n`;
    message += `└ ${lang === 'es' ? 'Valido hasta' : 'Valid until'}: ${formatDate(stats.validUntil, lang)}\n\n`;

    message += `*${lang === 'es' ? 'ESTADISTICAS' : 'STATISTICS'}*\n`;
    message += `├ ${lang === 'es' ? 'Reclamadas' : 'Claimed'}: ${stats.stats.totalClaims}\n`;
    message += `├ ${lang === 'es' ? 'Completadas' : 'Completed'}: ${stats.stats.completed}\n`;
    message += `├ ${lang === 'es' ? 'Pendientes' : 'Pending'}: ${stats.stats.pending}\n`;
    message += `├ ${lang === 'es' ? 'Ingresos' : 'Revenue'}: $${stats.stats.totalRevenue.toFixed(2)}\n`;
    message += `└ ${lang === 'es' ? 'Descuentos dados' : 'Discounts given'}: $${stats.stats.totalDiscountGiven.toFixed(2)}\n\n`;

    message += `*${lang === 'es' ? 'ESTADO' : 'STATUS'}*: ${statusText}\n\n`;

    message += `*Link:*\n\`${PromoModel.generateDeepLink(stats.code)}\``;

    const buttons = [
      [
        Markup.button.callback(
          lang === 'es' ? '📋 Copiar Link' : '📋 Copy Link',
          `promo_admin_link_${stats.id}`
        ),
        Markup.button.callback(
          lang === 'es' ? '📤 Compartir' : '📤 Share',
          `promo_admin_share_${stats.id}`
        ),
      ],
    ];

    if (stats.active) {
      buttons.push([
        Markup.button.callback(
          lang === 'es' ? '🔴 Desactivar' : '🔴 Deactivate',
          `promo_admin_deactivate_${stats.id}`
        ),
      ]);
    } else {
      buttons.push([
        Markup.button.callback(
          lang === 'es' ? '🟢 Activar' : '🟢 Activate',
          `promo_admin_activate_${stats.id}`
        ),
      ]);
    }

    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '◀️ Volver a Lista' : '◀️ Back to List',
        'promo_admin_list'
      ),
    ]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error showing promo details:', error);
    await ctx.answerCbQuery(lang === 'es' ? 'Error' : 'Error');
  }
}

/**
 * Start create promo wizard - Step 1: Select base plan
 */
async function startCreatePromo(ctx) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    // Initialize session
    ctx.session.temp = ctx.session.temp || {};
    ctx.session.temp.promoCreate = {
      step: 'plan',
      basePlanId: null,
      discountType: null,
      discountValue: null,
      code: null,
      name: null,
      targetAudience: 'all',
      maxSpots: null,
      validUntil: null,
    };

    // Get available plans
    const plans = await PlanModel.getAll();

    let message = `*${lang === 'es' ? 'CREAR PROMO' : 'CREATE PROMO'}*\n\n`;
    message += `*${lang === 'es' ? 'Paso 1/5' : 'Step 1/5'}*: ${lang === 'es' ? 'Selecciona el plan base' : 'Select base plan'}\n\n`;
    message += lang === 'es'
      ? 'Elige el plan sobre el cual aplicar el descuento:'
      : 'Choose the plan to apply the discount to:';

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '🌐 Cualquier Plan (All Plans)' : '🌐 Any Plan (All Plans)',
        'promo_create_plan_any'
      )],
      ...plans.slice(0, 6).map(plan => [
        Markup.button.callback(
          `${plan.name} - $${plan.price}`,
          `promo_create_plan_${plan.id}`
        ),
      ]),
    ];

    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '❌ Cancelar' : '❌ Cancel',
        'promo_admin_menu'
      ),
    ]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error starting promo creation:', error);
    await ctx.answerCbQuery(lang === 'es' ? 'Error' : 'Error');
  }
}

/**
 * Step 2: Select discount type
 */
async function selectDiscountType(ctx, planId) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    ctx.session.temp.promoCreate.basePlanId = planId;
    ctx.session.temp.promoCreate.step = 'discount_type';

    const isAnyPlan = PromoModel.isAnyPlanPromo({ basePlanId: planId });
    const plan = isAnyPlan ? null : await PlanModel.getById(planId);

    let message = `*${lang === 'es' ? 'CREAR PROMO' : 'CREATE PROMO'}*\n\n`;
    message += `*${lang === 'es' ? 'Paso 2/5' : 'Step 2/5'}*: ${lang === 'es' ? 'Tipo de descuento' : 'Discount type'}\n\n`;
    message += isAnyPlan
      ? `${lang === 'es' ? 'Plan seleccionado' : 'Selected plan'}: *${lang === 'es' ? 'Cualquier Plan' : 'Any Plan'}*\n\n`
      : `${lang === 'es' ? 'Plan seleccionado' : 'Selected plan'}: *${plan.name}* ($${plan.price})\n\n`;
    message += lang === 'es'
      ? 'Como quieres aplicar el descuento?'
      : 'How do you want to apply the discount?';

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '📊 Porcentaje (ej: 25% off)' : '📊 Percentage (e.g., 25% off)',
        'promo_create_type_percentage'
      )],
    ];

    if (!isAnyPlan) {
      buttons.push([Markup.button.callback(
        lang === 'es' ? '💵 Precio Fijo (ej: $15)' : '💵 Fixed Price (e.g., $15)',
        'promo_create_type_fixed'
      )]);
    }

    buttons.push([Markup.button.callback(
      lang === 'es' ? '◀️ Atras' : '◀️ Back',
      'promo_admin_create'
    )]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error in discount type step:', error);
  }
}

/**
 * Step 3: Enter discount value
 */
async function enterDiscountValue(ctx, discountType) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    ctx.session.temp.promoCreate.discountType = discountType;
    ctx.session.temp.promoCreate.step = 'discount_value';

    const basePlanId = ctx.session.temp.promoCreate.basePlanId;
    const isAnyPlan = PromoModel.isAnyPlanPromo({ basePlanId });
    const plan = isAnyPlan ? null : await PlanModel.getById(basePlanId);

    let message = `*${lang === 'es' ? 'CREAR PROMO' : 'CREATE PROMO'}*\n\n`;
    message += `*${lang === 'es' ? 'Paso 3/5' : 'Step 3/5'}*: ${lang === 'es' ? 'Valor del descuento' : 'Discount value'}\n\n`;

    if (discountType === 'percentage') {
      message += lang === 'es'
        ? 'Selecciona el porcentaje de descuento:'
        : 'Select the discount percentage:';

      const buttons = [
        [
          Markup.button.callback('10%', 'promo_create_value_10'),
          Markup.button.callback('15%', 'promo_create_value_15'),
          Markup.button.callback('20%', 'promo_create_value_20'),
        ],
        [
          Markup.button.callback('25%', 'promo_create_value_25'),
          Markup.button.callback('30%', 'promo_create_value_30'),
          Markup.button.callback('40%', 'promo_create_value_40'),
        ],
        [
          Markup.button.callback('50%', 'promo_create_value_50'),
          Markup.button.callback('60%', 'promo_create_value_60'),
          Markup.button.callback('75%', 'promo_create_value_75'),
        ],
        [Markup.button.callback(
          lang === 'es' ? '✏️ Otro valor' : '✏️ Custom value',
          'promo_create_value_custom'
        )],
        [Markup.button.callback(
          lang === 'es' ? '◀️ Atras' : '◀️ Back',
          isAnyPlan ? 'promo_create_plan_any' : `promo_create_plan_${plan.id}`
        )],
      ];

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } else {
      if (isAnyPlan) {
        await ctx.editMessageText(
          lang === 'es'
            ? '❌ Las promos de cualquier plan solo permiten descuento por porcentaje.'
            : '❌ Any-plan promos only allow percentage discounts.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '◀️ Atras' : '◀️ Back', 'promo_admin_create')],
            ]),
          }
        );
        return;
      }

      // Fixed price - show presets based on plan price
      const price = parseFloat(plan.price);
      const presets = [
        Math.round(price * 0.5),
        Math.round(price * 0.6),
        Math.round(price * 0.7),
        Math.round(price * 0.8),
      ].filter(p => p > 0 && p < price);

      message += `${lang === 'es' ? 'Precio original' : 'Original price'}: $${plan.price}\n\n`;
      message += lang === 'es'
        ? 'Selecciona el precio final de la promo:'
        : 'Select the final promo price:';

      const buttons = [
        presets.slice(0, 4).map(p =>
          Markup.button.callback(`$${p}`, `promo_create_value_${p}`)
        ),
        [Markup.button.callback(
          lang === 'es' ? '✏️ Otro precio' : '✏️ Custom price',
          'promo_create_value_custom'
        )],
        [Markup.button.callback(lang === 'es' ? '◀️ Atras' : '◀️ Back', `promo_create_plan_${plan.id}`)],
      ];

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    }
  } catch (error) {
    logger.error('Error in discount value step:', error);
  }
}

/**
 * Step 4: Target audience selection
 */
async function selectTargetAudience(ctx, discountValue) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    if (!ctx.session.temp?.promoCreate) {
      await showPromoAdminMenu(ctx, true);
      return;
    }

    ctx.session.temp.promoCreate.discountValue = discountValue;
    ctx.session.temp.promoCreate.step = 'audience';

    // Calculate preview price
    const basePlanId = ctx.session.temp.promoCreate.basePlanId;
    const isAnyPlan = PromoModel.isAnyPlanPromo({ basePlanId });
    const { discountType } = ctx.session.temp.promoCreate;
    const plan = isAnyPlan ? null : await PlanModel.getById(basePlanId);
    const originalPrice = plan ? parseFloat(plan.price) : null;
    let finalPrice;

    if (!isAnyPlan) {
      if (discountType === 'percentage') {
        finalPrice = originalPrice - (originalPrice * discountValue / 100);
      } else {
        finalPrice = discountValue;
      }
    }

    let message = `*${lang === 'es' ? 'CREAR PROMO' : 'CREATE PROMO'}*\n\n`;
    message += `*${lang === 'es' ? 'Paso 4/5' : 'Step 4/5'}*: ${lang === 'es' ? 'Audiencia objetivo' : 'Target audience'}\n\n`;
    message += isAnyPlan
      ? `${lang === 'es' ? 'Descuento' : 'Discount'}: *${discountValue}%* (${lang === 'es' ? 'cualquier plan' : 'any plan'})\n\n`
      : `${lang === 'es' ? 'Precio' : 'Price'}: ~$${originalPrice}~ → *$${finalPrice.toFixed(2)}*\n\n`;
    message += lang === 'es'
      ? 'Quien puede acceder a esta promo?'
      : 'Who can access this promo?';

    // Back button should go to the correct discount type
    const backCallback = `promo_create_type_${discountType}`;

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '👥 Todos los usuarios' : '👥 All users',
        'promo_create_audience_all'
      )],
      [Markup.button.callback(
        lang === 'es' ? '🆓 Solo usuarios gratis (nunca pagaron)' : '🆓 Free users only (never paid)',
        'promo_create_audience_free_users'
      )],
      [Markup.button.callback(
        lang === 'es' ? '↩️ Ex-suscriptores (churned)' : '↩️ Churned users (ex-subscribers)',
        'promo_create_audience_churned'
      )],
      [Markup.button.callback(
        lang === 'es' ? '🆕 Nuevos usuarios (ultimos 7 dias)' : '🆕 New users (last 7 days)',
        'promo_create_audience_new_users'
      )],
      [Markup.button.callback(lang === 'es' ? '◀️ Atras' : '◀️ Back', backCallback)],
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error in audience step:', error);
  }
}

/**
 * Step 5: Final configuration (code, spots, expiry)
 */
async function finalConfiguration(ctx, audience) {
  const lang = getLanguage(ctx);

  try {
    await safeAnswerCbQuery(ctx);

    ctx.session.temp.promoCreate.targetAudience = audience;
    ctx.session.temp.promoCreate.step = 'final';

    // Use existing code if already set; otherwise generate a new one
    let promoCode = ctx.session.temp.promoCreate.code;
    if (!promoCode) {
      promoCode = generatePromoCode();
      ctx.session.temp.promoCreate.code = promoCode;
      ctx.session.temp.promoCreate.name = `${promoCode} Promo`;
      await ctx.saveSession();
    }

    const basePlanId = ctx.session.temp.promoCreate.basePlanId;
    const isAnyPlan = PromoModel.isAnyPlanPromo({ basePlanId });
    const plan = isAnyPlan ? null : await PlanModel.getById(basePlanId);
    const { discountType, discountValue } = ctx.session.temp.promoCreate;
    const originalPrice = plan ? parseFloat(plan.price) : null;
    let finalPrice = null;
    if (!isAnyPlan) {
      finalPrice = discountType === 'percentage'
        ? originalPrice - (originalPrice * discountValue / 100)
        : discountValue;
    }

    const audienceLabels = {
      all: lang === 'es' ? 'Todos' : 'Everyone',
      churned: lang === 'es' ? 'Ex-Suscriptores' : 'Churned',
      new_users: lang === 'es' ? 'Nuevos' : 'New Users',
      free_users: lang === 'es' ? 'Gratis' : 'Free Users',
    };

    let message = `*${lang === 'es' ? 'CREAR PROMO' : 'CREATE PROMO'}*\n\n`;
    message += `*${lang === 'es' ? 'Paso 5/5' : 'Step 5/5'}*: ${lang === 'es' ? 'Configuracion final' : 'Final configuration'}\n\n`;
    message += `*${lang === 'es' ? 'RESUMEN' : 'SUMMARY'}*\n`;
    message += `├ ${lang === 'es' ? 'Codigo' : 'Code'}: *${promoCode}*\n`;
    message += `├ Plan: ${isAnyPlan ? (lang === 'es' ? 'Cualquier Plan' : 'Any Plan') : plan.name}\n`;
    message += isAnyPlan
      ? `├ ${lang === 'es' ? 'Descuento' : 'Discount'}: *${discountValue}%* (${lang === 'es' ? 'cualquier plan' : 'any plan'})\n`
      : `├ ${lang === 'es' ? 'Precio' : 'Price'}: ~$${originalPrice}~ → *$${finalPrice.toFixed(2)}*\n`;
    message += `├ ${lang === 'es' ? 'Audiencia' : 'Audience'}: ${audienceLabels[audience]}\n`;
    message += `├ ${lang === 'es' ? 'Cupos' : 'Spots'}: ${lang === 'es' ? 'Ilimitados' : 'Unlimited'}\n`;
    message += `└ ${lang === 'es' ? 'Expira' : 'Expires'}: ${lang === 'es' ? 'Nunca' : 'Never'}\n\n`;

    message += lang === 'es'
      ? 'Configura limites opcionales o crea la promo:'
      : 'Configure optional limits or create the promo:';

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '🎫 Limitar cupos' : '🎫 Limit spots',
        'promo_create_set_spots'
      )],
      [Markup.button.callback(
        lang === 'es' ? '📅 Fecha de expiracion' : '📅 Set expiry date',
        'promo_create_set_expiry'
      )],
      [Markup.button.callback(
        lang === 'es' ? '✏️ Cambiar codigo' : '✏️ Change code',
        'promo_create_set_code'
      )],
      [Markup.button.callback(
        `✅ ${lang === 'es' ? 'Crear Promo' : 'Create Promo'}`,
        'promo_create_confirm'
      )],
      [Markup.button.callback(
        lang === 'es' ? '❌ Cancelar' : '❌ Cancel',
        'promo_admin_menu'
      )],
    ];

    await safeReplyOrEdit(ctx, message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error in final config step:', error);
  }
}

/**
 * Set spots limit
 */
async function setSpotsLimit(ctx) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    let message = `*${lang === 'es' ? 'LIMITAR CUPOS' : 'LIMIT SPOTS'}*\n\n`;
    message += lang === 'es'
      ? 'Cuantos usuarios pueden usar esta promo?'
      : 'How many users can redeem this promo?';

    const buttons = [
      [
        Markup.button.callback('10', 'promo_create_spots_10'),
        Markup.button.callback('25', 'promo_create_spots_25'),
        Markup.button.callback('50', 'promo_create_spots_50'),
      ],
      [
        Markup.button.callback('100', 'promo_create_spots_100'),
        Markup.button.callback('250', 'promo_create_spots_250'),
        Markup.button.callback('500', 'promo_create_spots_500'),
      ],
      [Markup.button.callback(
        lang === 'es' ? '∞ Sin limite' : '∞ Unlimited',
        'promo_create_spots_unlimited'
      )],
      [Markup.button.callback(lang === 'es' ? '◀️ Atras' : '◀️ Back', 'promo_create_back_final')],
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error in spots limit:', error);
  }
}

/**
 * Set expiry date
 */
async function setExpiryDate(ctx) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    let message = `*${lang === 'es' ? 'FECHA DE EXPIRACION' : 'EXPIRY DATE'}*\n\n`;
    message += lang === 'es'
      ? 'Cuando expira esta promo?'
      : 'When does this promo expire?';

    // Calculate dates
    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in14days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const buttons = [
      [Markup.button.callback(
        `7 ${lang === 'es' ? 'dias' : 'days'} (${formatDate(in7days, lang)})`,
        `promo_create_expiry_${in7days.toISOString()}`
      )],
      [Markup.button.callback(
        `14 ${lang === 'es' ? 'dias' : 'days'} (${formatDate(in14days, lang)})`,
        `promo_create_expiry_${in14days.toISOString()}`
      )],
      [Markup.button.callback(
        `30 ${lang === 'es' ? 'dias' : 'days'} (${formatDate(in30days, lang)})`,
        `promo_create_expiry_${in30days.toISOString()}`
      )],
      [Markup.button.callback(
        `${lang === 'es' ? 'Fin de mes' : 'End of month'} (${formatDate(endOfMonth, lang)})`,
        `promo_create_expiry_${endOfMonth.toISOString()}`
      )],
      [Markup.button.callback(
        lang === 'es' ? '∞ Sin expiracion' : '∞ No expiration',
        'promo_create_expiry_never'
      )],
      [Markup.button.callback(lang === 'es' ? '◀️ Atras' : '◀️ Back', 'promo_create_back_final')],
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error in expiry date:', error);
  }
}

/**
 * Confirm and create promo
 */
async function confirmCreatePromo(ctx) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    const data = ctx.session.temp.promoCreate;

    // Create the promo
    const promo = await PromoModel.create({
      code: data.code,
      name: data.name || `${data.code} Promo`,
      basePlanId: data.basePlanId,
      discountType: data.discountType === 'percentage' ? 'percentage' : 'fixed_price',
      discountValue: data.discountValue,
      targetAudience: data.targetAudience,
      maxSpots: data.maxSpots,
      validUntil: data.validUntil,
    });

    const pricing = await PromoModel.calculatePrice(promo);
    const isAnyPlan = PromoModel.isAnyPlanPromo(promo);
    const deepLink = PromoModel.generateDeepLink(promo.code);

    let message = `✅ *${lang === 'es' ? 'PROMO CREADA!' : 'PROMO CREATED!'}*\n\n`;
    message += `*${promo.code}*\n`;
    if (isAnyPlan) {
      message += `${promo.discountValue}% ${lang === 'es' ? 'en cualquier plan' : 'off any plan'}\n\n`;
    } else {
      message += `$${pricing.originalPrice} → *$${pricing.finalPrice}*\n\n`;
    }
    message += `*Link:*\n\`${deepLink}\`\n\n`;
    message += lang === 'es'
      ? 'Copia el link y compartelo en tus broadcasts!'
      : 'Copy the link and share it in your broadcasts!';

    // Clear session
    delete ctx.session.temp.promoCreate;

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '📤 Compartir en Broadcast' : '📤 Share in Broadcast',
        `promo_admin_share_${promo.id}`
      )],
      [Markup.button.callback(
        lang === 'es' ? '📋 Ver Detalles' : '📋 View Details',
        `promo_admin_view_${promo.id}`
      )],
      [Markup.button.callback(
        lang === 'es' ? '➕ Crear Otra' : '➕ Create Another',
        'promo_admin_create'
      )],
      [Markup.button.callback(
        lang === 'es' ? '◀️ Menu Promos' : '◀️ Promos Menu',
        'promo_admin_menu'
      )],
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });

    logger.info('Promo created via admin UI', {
      code: promo.code,
      createdBy: ctx.from.id,
    });
  } catch (error) {
    logger.error('Error creating promo:', error);
    await ctx.editMessageText(
      lang === 'es'
        ? `❌ Error: ${error.message}`
        : `❌ Error: ${error.message}`
    );
  }
}

/**
 * Share promo - Generate button for broadcast
 */
async function sharePromo(ctx, promoId) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    const promo = await PromoModel.getById(promoId);
    if (!promo) {
      await ctx.reply(lang === 'es' ? 'Promo no encontrada.' : 'Promo not found.');
      return;
    }

    const pricing = await PromoModel.calculatePrice(promo);
    const isAnyPlan = PromoModel.isAnyPlanPromo(promo);
    const deepLink = PromoModel.generateDeepLink(promo.code);

    let message = `*${lang === 'es' ? 'COMPARTIR PROMO' : 'SHARE PROMO'}*\n\n`;
    message += isAnyPlan
      ? `*${promo.code}* - ${promo.discountValue}% ${lang === 'es' ? 'en cualquier plan' : 'off any plan'}\n\n`
      : `*${promo.code}* - $${pricing.finalPrice}\n\n`;

    message += `*${lang === 'es' ? 'LINK PARA COPIAR' : 'LINK TO COPY'}:*\n`;
    message += `\`${deepLink}\`\n\n`;

    message += `*${lang === 'es' ? 'TEXTO SUGERIDO (ES)' : 'SUGGESTED TEXT (ES)'}:*\n`;
    message += isAnyPlan
      ? `_OFERTA ESPECIAL! Obten ${promo.discountValue}% de descuento en cualquier plan. Cupos limitados!_\n\n`
      : `_OFERTA ESPECIAL! Obten ${promo.discountType === 'percentage' ? promo.discountValue + '% de descuento' : 'precio especial de $' + pricing.finalPrice} en tu suscripcion. Cupos limitados!_\n\n`;

    message += `*${lang === 'es' ? 'TEXTO SUGERIDO (EN)' : 'SUGGESTED TEXT (EN)'}:*\n`;
    message += isAnyPlan
      ? `_SPECIAL OFFER! Get ${promo.discountValue}% off any plan. Limited spots!_\n\n`
      : `_SPECIAL OFFER! Get ${promo.discountType === 'percentage' ? promo.discountValue + '% off' : 'special price of $' + pricing.finalPrice} on your subscription. Limited spots!_\n\n`;

    message += lang === 'es'
      ? 'Usa el link en tus broadcasts con el boton "Obtener promo"'
      : 'Use the link in your broadcasts with "Get promo" button';

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '📢 Ir a Broadcast' : '📢 Go to Broadcast',
        'admin_broadcast'
      )],
      [Markup.button.callback(
        lang === 'es' ? '◀️ Volver' : '◀️ Back',
        `promo_admin_view_${promoId}`
      )],
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });

    const esText = isAnyPlan
      ? `OFERTA ESPECIAL! Obten ${promo.discountValue}% de descuento en cualquier plan. Cupos limitados!`
      : `OFERTA ESPECIAL! Obten ${promo.discountType === 'percentage' ? promo.discountValue + '% de descuento' : 'precio especial de $' + pricing.finalPrice} en tu suscripcion. Cupos limitados!`;
    const enText = isAnyPlan
      ? `SPECIAL OFFER! Get ${promo.discountValue}% off any plan. Limited spots!`
      : `SPECIAL OFFER! Get ${promo.discountType === 'percentage' ? promo.discountValue + '% off' : 'special price of $' + pricing.finalPrice} on your subscription. Limited spots!`;
    await ctx.reply(
      `${lang === 'es' ? '📋 Texto listo para copiar' : '📋 Copy-ready text'}\n\n` +
      `Link:\n` +
      `\`\`\`\n${deepLink}\n\`\`\`\n\n` +
      `ES:\n` +
      `\`\`\`\n${esText}\n\`\`\`\n\n` +
      `EN:\n` +
      `\`\`\`\n${enText}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error('Error sharing promo:', error);
  }
}

/**
 * Deactivate promo
 */
async function deactivatePromo(ctx, promoId) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    const promo = await PromoModel.deactivate(promoId);

    if (promo) {
      await ctx.editMessageText(
        lang === 'es'
          ? `✅ Promo *${promo.code}* desactivada.`
          : `✅ Promo *${promo.code}* deactivated.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(
              lang === 'es' ? '◀️ Volver' : '◀️ Back',
              'promo_admin_list'
            )],
          ]),
        }
      );

      logger.info('Promo deactivated via admin UI', {
        code: promo.code,
        deactivatedBy: ctx.from.id,
      });
    }
  } catch (error) {
    logger.error('Error deactivating promo:', error);
    await ctx.answerCbQuery(lang === 'es' ? 'Error' : 'Error');
  }
}

/**
 * Activate promo
 */
async function activatePromo(ctx, promoId) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    const promo = await PromoModel.update(promoId, { active: true, currentSpotsUsed: 0 });

    if (promo) {
      await ctx.editMessageText(
        lang === 'es'
          ? `✅ Promo *${promo.code}* activada.`
          : `✅ Promo *${promo.code}* activated.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(
              lang === 'es' ? '◀️ Volver' : '◀️ Back',
              `promo_admin_view_${promoId}`
            )],
          ]),
        }
      );
    }
  } catch (error) {
    logger.error('Error activating promo:', error);
    await ctx.answerCbQuery(lang === 'es' ? 'Error' : 'Error');
  }
}

/**
 * Show stats overview
 */
async function showStatsOverview(ctx) {
  const lang = getLanguage(ctx);

  try {
    await ctx.answerCbQuery();

    const promos = await PromoModel.getAll(true);

    let totalRevenue = 0;
    let totalDiscounts = 0;
    let totalRedemptions = 0;

    for (const promo of promos) {
      const stats = await PromoModel.getStats(promo.id);
      if (stats?.stats) {
        totalRevenue += stats.stats.totalRevenue || 0;
        totalDiscounts += stats.stats.totalDiscountGiven || 0;
        totalRedemptions += stats.stats.completed || 0;
      }
    }

    const activePromos = promos.filter(p => PromoModel.isPromoValid(p)).length;

    let message = `*${lang === 'es' ? 'ESTADISTICAS DE PROMOS' : 'PROMO STATISTICS'}*\n\n`;
    message += `*${lang === 'es' ? 'RESUMEN GENERAL' : 'OVERVIEW'}*\n`;
    message += `├ ${lang === 'es' ? 'Promos activas' : 'Active promos'}: ${activePromos}\n`;
    message += `├ ${lang === 'es' ? 'Total promos' : 'Total promos'}: ${promos.length}\n`;
    message += `├ ${lang === 'es' ? 'Redempciones completadas' : 'Completed redemptions'}: ${totalRedemptions}\n`;
    message += `├ ${lang === 'es' ? 'Ingresos totales' : 'Total revenue'}: $${totalRevenue.toFixed(2)}\n`;
    message += `└ ${lang === 'es' ? 'Descuentos otorgados' : 'Discounts given'}: $${totalDiscounts.toFixed(2)}\n`;

    const buttons = [
      [Markup.button.callback(
        lang === 'es' ? '📋 Ver Lista' : '📋 View List',
        'promo_admin_list'
      )],
      [Markup.button.callback(
        lang === 'es' ? '◀️ Volver' : '◀️ Back',
        'promo_admin_menu'
      )],
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    logger.error('Error showing stats overview:', error);
  }
}

/**
 * Generate random promo code
 */
function generatePromoCode() {
  const prefixes = ['PRIME', 'VIP', 'DEAL', 'HOT', 'SAVE', 'MEGA'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = Math.floor(Math.random() * 99) + 1;
  return `${prefix}${suffix}`;
}

/**
 * Register all promo admin handlers
 */
function registerPromoAdminHandlers(bot) {
  // Main menu
  bot.action('promo_admin_menu', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) {
      await ctx.answerCbQuery('Not authorized');
      return;
    }
    await showPromoAdminMenu(ctx);
  });

  // List promos
  bot.action('promo_admin_list', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await showPromoList(ctx);
  });

  // View promo details
  bot.action(/^promo_admin_view_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const promoId = parseInt(ctx.match[1]);
    await showPromoDetails(ctx, promoId);
  });

  // Start create promo
  bot.action('promo_admin_create', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await startCreatePromo(ctx);
  });

  // Create flow - select plan
  bot.action(/^promo_create_plan_(.+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const planId = ctx.match[1];
    await selectDiscountType(ctx, planId);
  });

  // Create flow - select discount type
  bot.action(/^promo_create_type_(percentage|fixed)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const discountType = ctx.match[1];
    await enterDiscountValue(ctx, discountType);
  });

  // Create flow - select discount value
  bot.action(/^promo_create_value_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const value = parseInt(ctx.match[1]);
    await selectTargetAudience(ctx, value);
  });

  // Create flow - select audience
  bot.action(/^promo_create_audience_(.+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const audience = ctx.match[1];
    await finalConfiguration(ctx, audience);
  });

  // Create flow - set spots
  bot.action('promo_create_set_spots', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await setSpotsLimit(ctx);
  });

  bot.action(/^promo_create_spots_(\d+|unlimited)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await ctx.answerCbQuery();

    const value = ctx.match[1];
    ctx.session.temp.promoCreate.maxSpots = value === 'unlimited' ? null : parseInt(value);

    // Go back to final config
    await finalConfiguration(ctx, ctx.session.temp.promoCreate.targetAudience);
  });

  // Create flow - set expiry
  bot.action('promo_create_set_expiry', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await setExpiryDate(ctx);
  });

  bot.action(/^promo_create_expiry_(.+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await ctx.answerCbQuery();

    const value = ctx.match[1];
    ctx.session.temp.promoCreate.validUntil = value === 'never' ? null : new Date(value);

    // Go back to final config
    await finalConfiguration(ctx, ctx.session.temp.promoCreate.targetAudience);
  });

  // Create flow - set custom code
  bot.action('promo_create_set_code', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await ctx.answerCbQuery();

    const lang = getLanguage(ctx);
    ctx.session.temp.promoCreate.step = 'custom_code';
    await ctx.saveSession();

    await ctx.editMessageText(
      `*${lang === 'es' ? 'CAMBIAR CODIGO' : 'CHANGE CODE'}*\n\n` +
      (lang === 'es'
        ? 'Escribe el nuevo codigo de la promo (solo letras y numeros, sin espacios):'
        : 'Enter the new promo code (letters and numbers only, no spaces):'),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '◀️ Cancelar' : '◀️ Cancel', 'promo_create_back_final')],
        ]),
      }
    );
  });

  // Handle custom code text input
  bot.on('text', async (ctx, next) => {
    if (ctx.chat?.type && ctx.chat.type !== 'private') {
      return next();
    }
    if (!ctx.session.temp?.promoCreate?.step || ctx.session.temp.promoCreate.step !== 'custom_code') {
      return next();
    }

    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return next();

    const lang = getLanguage(ctx);
    const code = (ctx.message.text || '').trim().toUpperCase();

    // Validate code format
    if (!/^[A-Z0-9]+$/.test(code)) {
      await ctx.reply(
        lang === 'es'
          ? '❌ Codigo invalido. Solo letras y numeros, sin espacios.'
          : '❌ Invalid code. Letters and numbers only, no spaces.'
      );
      return;
    }

    if (code.length < 3 || code.length > 20) {
      await ctx.reply(
        lang === 'es'
          ? '❌ El codigo debe tener entre 3 y 20 caracteres.'
          : '❌ Code must be between 3 and 20 characters.'
      );
      return;
    }

    // Check if code already exists
    const existingPromo = await PromoModel.getByCode(code);
    if (existingPromo) {
      await ctx.reply(
        lang === 'es'
          ? '❌ Este codigo ya existe. Elige otro.'
          : '❌ This code already exists. Choose another.'
      );
      return;
    }

    ctx.session.temp.promoCreate.code = code;
    ctx.session.temp.promoCreate.name = `${code} Promo`;
    ctx.session.temp.promoCreate.step = 'final';
    await ctx.saveSession();

    await ctx.reply(
      lang === 'es'
        ? `✅ Codigo cambiado a: *${code}*`
        : `✅ Code changed to: *${code}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(
            lang === 'es' ? '✏️ Continuar editando' : '✏️ Continue editing',
            'promo_create_back_final'
          )],
          [Markup.button.callback(
            lang === 'es' ? '🚀 Crear Promo' : '🚀 Create Promo',
            'promo_create_confirm'
          )],
        ]),
      }
    );
    await finalConfiguration(ctx, ctx.session.temp.promoCreate.targetAudience);
  });

  // Create flow - back to final
  bot.action('promo_create_back_final', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await finalConfiguration(ctx, ctx.session.temp.promoCreate.targetAudience);
  });

  // Create flow - confirm
  bot.action('promo_create_confirm', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await confirmCreatePromo(ctx);
  });

  // Share promo
  bot.action(/^promo_admin_share_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const promoId = parseInt(ctx.match[1]);
    await sharePromo(ctx, promoId);
  });

  // Link (just copy)
  bot.action(/^promo_admin_link_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const promoId = parseInt(ctx.match[1]);
    await sharePromo(ctx, promoId);
  });

  // Deactivate
  bot.action(/^promo_admin_deactivate_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const promoId = parseInt(ctx.match[1]);
    await deactivatePromo(ctx, promoId);
  });

  // Activate
  bot.action(/^promo_admin_activate_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    const promoId = parseInt(ctx.match[1]);
    await activatePromo(ctx, promoId);
  });

  // Stats overview
  bot.action('promo_admin_stats_overview', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return;
    await showStatsOverview(ctx);
  });

  logger.info('Promo admin handlers registered');
}

module.exports = {
  showPromoAdminMenu,
  registerPromoAdminHandlers,
};
