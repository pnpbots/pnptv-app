const { Markup } = require('telegraf');
const { t } = require('../../utils/i18n');
const { isValidEmail } = require('../../utils/validation');
const logger = require('../../utils/logger');
const UserModel = require('../../models/userModel');
const sanitize = require('../../utils/sanitizer');
const BusinessNotificationService = require('../services/businessNotificationService');

/**
 * Handle language selection
 * @param {Context} ctx - Telegraf context
 */
async function handleLanguageSelection(ctx) {
  try {
    // Answer callback query immediately
    try {
      await ctx.answerCbQuery();
    } catch (err) {
      logger.warn(`Could not answer callback query: ${err.message}`);
    }

    const lang = ctx.match[1]; // Extract language from callback data (language_en or language_es)

    // Validate language
    if (!['en', 'es'].includes(lang)) {
      logger.error('Invalid language selected:', lang);
      return await ctx.reply(t('error', 'en'));
    }

    // Update session
    ctx.session.language = lang;
    ctx.session.onboardingStep = 'ageVerification';
    console.log(`[Onboarding] User ${ctx.from.id} selected language: ${lang}`);

    // Edit message to confirm language
    try {
      await ctx.editMessageText(t('languageSelected', lang), { parse_mode: 'Markdown' });
    } catch (editError) {
      if (editError.description?.includes('message is not modified') ||
          editError.description?.includes('message to edit not found')) {
        await ctx.reply(t('languageSelected', lang), { parse_mode: 'Markdown' });
      } else {
        throw editError;
      }
    }

    // Proceed to age verification
    await showAgeVerification(ctx);
  } catch (error) {
    logger.error('Error in handleLanguageSelection:', error);
    await ctx.reply(t('error', ctx.session?.language || 'en'));
  }
}

/**
 * Show age verification step
 * @param {Context} ctx - Telegraf context
 */
async function showAgeVerification(ctx) {
  const lang = ctx.session.language || 'en';

  await ctx.reply(
    t('ageVerification', lang),
    Markup.inlineKeyboard([
      [Markup.button.callback(t('confirmAge', lang), 'age_confirm_yes')],
    ])
  );
}

/**
 * Handle age confirmation
 * @param {Context} ctx - Telegraf context
 */
async function handleAgeConfirmation(ctx) {
  try {
    try {
      await ctx.answerCbQuery();
    } catch (err) {
      logger.warn(`Could not answer callback query: ${err.message}`);
    }

    const lang = ctx.session.language || 'en';
    const userId = ctx.from.id.toString();

    // Persist age verification to DB with timestamps + cache invalidation
    await UserModel.updateAgeVerification(userId, {
      verified: true,
      method: 'manual',
      expiresHours: 168, // 7 days
    });

    // Update session
    ctx.session.ageVerified = true;
    ctx.session.onboardingStep = 'terms';

    logger.info(`[Onboarding] User ${userId} confirmed age verification`);

    // Confirm and proceed to terms
    try {
      await ctx.editMessageText(t('ageVerificationSuccess', lang));
    } catch (editError) {
      if (editError.description?.includes('message is not modified') ||
          editError.description?.includes('message to edit not found')) {
        await ctx.reply(t('ageVerificationSuccess', lang));
      } else {
        throw editError;
      }
    }

    await showTerms(ctx);
  } catch (error) {
    logger.error('Error in handleAgeConfirmation:', error);
    await ctx.reply(t('error', ctx.session?.language || 'en'));
  }
}

/**
 * Show terms and conditions
 * @param {Context} ctx - Telegraf context
 */
async function showTerms(ctx) {
  const lang = ctx.session.language || 'en';
  const botUrl = process.env.BOT_URL || 'https://pnptv.app';

  await ctx.reply(
    t('terms', lang) + `\n\n📄 ${botUrl}/terms`,
    Markup.inlineKeyboard([
      [Markup.button.callback(t('accept', lang), 'accept_terms')],
      [Markup.button.callback(t('decline', lang), 'decline_terms')],
    ])
  );
}

/**
 * Handle terms acceptance
 * @param {Context} ctx - Telegraf context
 */
async function handleTermsAcceptance(ctx) {
  try {
    try {
      await ctx.answerCbQuery();
    } catch (err) {
      logger.warn(`Could not answer callback query: ${err.message}`);
    }

    const lang = ctx.session.language || 'en';

    // Update session
    ctx.session.termsAccepted = true;
    ctx.session.onboardingStep = 'privacy';

    console.log(`[Onboarding] User ${ctx.from.id} accepted terms`);

    // Confirm and proceed to privacy
    try {
      await ctx.editMessageText(t('termsAccepted', lang));
    } catch (editError) {
      if (editError.description?.includes('message is not modified') ||
          editError.description?.includes('message to edit not found')) {
        await ctx.reply(t('termsAccepted', lang));
      } else {
        throw editError;
      }
    }

    await showPrivacyPolicy(ctx);
  } catch (error) {
    logger.error('Error in handleTermsAcceptance:', error);
    await ctx.reply(t('error', ctx.session?.language || 'en'));
  }
}

/**
 * Handle terms decline
 * @param {Context} ctx - Telegraf context
 */
async function handleTermsDecline(ctx) {
  try {
    try {
      await ctx.answerCbQuery(t('termsDeclined', ctx.session?.language || 'en'), { show_alert: true });
    } catch (err) {
      logger.warn(`Could not answer callback query: ${err.message}`);
    }

    const lang = ctx.session.language || 'en';

    console.log(`[Onboarding] User ${ctx.from.id} declined terms`);

    await ctx.reply(t('termsDeclined', lang));
  } catch (error) {
    logger.error('Error in handleTermsDecline:', error);
  }
}

/**
 * Show privacy policy
 * @param {Context} ctx - Telegraf context
 */
async function showPrivacyPolicy(ctx) {
  const lang = ctx.session.language || 'en';
  const botUrl = process.env.BOT_URL || 'https://pnptv.app';

  await ctx.reply(
    t('privacy', lang) + `\n\n🔒 ${botUrl}/privacy`,
    Markup.inlineKeyboard([
      [Markup.button.callback(t('accept', lang), 'accept_privacy')],
      [Markup.button.callback(t('decline', lang), 'decline_privacy')],
    ])
  );
}

/**
 * Handle privacy policy acceptance
 * @param {Context} ctx - Telegraf context
 */
async function handlePrivacyAcceptance(ctx) {
  try {
    try {
      await ctx.answerCbQuery();
    } catch (err) {
      logger.warn(`Could not answer callback query: ${err.message}`);
    }

    const lang = ctx.session.language || 'en';

    // Update session
    ctx.session.privacyAccepted = true;
    ctx.session.onboardingStep = 'email';

    console.log(`[Onboarding] User ${ctx.from.id} accepted privacy policy`);

    // Confirm and proceed to email
    try {
      await ctx.editMessageText(t('privacyAccepted', lang));
    } catch (editError) {
      if (editError.description?.includes('message is not modified') ||
          editError.description?.includes('message to edit not found')) {
        await ctx.reply(t('privacyAccepted', lang));
      } else {
        throw editError;
      }
    }

    await showEmailPrompt(ctx);
  } catch (error) {
    logger.error('Error in handlePrivacyAcceptance:', error);
    await ctx.reply(t('error', ctx.session?.language || 'en'));
  }
}

/**
 * Handle privacy policy decline
 * @param {Context} ctx - Telegraf context
 */
async function handlePrivacyDecline(ctx) {
  try {
    try {
      await ctx.answerCbQuery(t('privacyDeclined', ctx.session?.language || 'en'), { show_alert: true });
    } catch (err) {
      logger.warn(`Could not answer callback query: ${err.message}`);
    }

    const lang = ctx.session.language || 'en';

    console.log(`[Onboarding] User ${ctx.from.id} declined privacy policy`);

    await ctx.reply(t('privacyDeclined', lang));
  } catch (error) {
    logger.error('Error in handlePrivacyDecline:', error);
  }
}

/**
 * Show email collection prompt
 * @param {Context} ctx - Telegraf context
 */
async function showEmailPrompt(ctx) {
  const lang = ctx.session.language || 'en';

  // Set awaiting email flag
  ctx.session.awaitingEmail = true;
  ctx.session.onboardingStep = 'email';

  await ctx.reply(
    t('emailPrompt', lang),
    Markup.removeKeyboard() // Remove any previous keyboard
  );

  await ctx.reply(
    t('emailRequiredNote', lang)
  );
}

/**
 * Handle email submission (called from text handler in bot registration)
 * @param {Context} ctx - Telegraf context
 */
async function handleEmailSubmission(ctx) {
  try {
    const lang = ctx.session.language || 'en';
    const email = ctx.message.text.trim().toLowerCase();
    const userId = ctx.from.id.toString();

    console.log(`[Onboarding] User ${userId} submitted email: ${email}`);

    // Validate email
    if (!isValidEmail(email)) {
      await ctx.reply(t('emailInvalid', lang));
      return;
    }

    // Save email to session
    ctx.session.email = email;
    ctx.session.awaitingEmail = false;

    const existingUser = await UserModel.getByEmail(email);
    const isDuplicate = existingUser && existingUser.id !== userId;
    ctx.session.emailDuplicate = isDuplicate;

    if (isDuplicate) {
      logger.warn('Email already exists during onboarding', {
        email,
        currentUserId: userId,
        existingUserId: existingUser.id,
      });

      // Mark existing record as onboarded to avoid loops on that account
      await UserModel.updateProfile(existingUser.id, {
        onboardingComplete: true,
        lastActive: new Date(),
      });

      // Update current user without setting email to avoid unique constraint
      await UserModel.updateProfile(userId, {
        onboardingComplete: true,
        lastActive: new Date(),
      });
    } else {
      await UserModel.updateProfile(userId, {
        email,
        emailVerified: false,
      });
    }

    await ctx.reply(t('emailConfirmed', lang));

    // Proceed to free channel invite
    await generateFreeChannelInvite(ctx);
  } catch (error) {
    logger.error('Error in handleEmailSubmission:', error);
    await ctx.reply(t('error', ctx.session?.language || 'en'));
  }
}



/**
 * Generate and send free channel invite link
 * @param {Context} ctx - Telegraf context
 */
async function generateFreeChannelInvite(ctx) {
  try {
    const lang = ctx.session.language || 'en';
    const userId = ctx.from.id.toString();

    ctx.session.onboardingStep = 'freeChannelInvite';

    // Get channel IDs from environment
    const freeChannelId = process.env.FREE_CHANNEL_ID || '-1003159260496';
    const freeGroupId = process.env.FREE_GROUP_ID || '-1003291737499';

    console.log(`[Onboarding] Generating free channel invites for user ${userId}`);

    let channelInviteUrl = null;
    let groupInviteUrl = null;

    // Try to generate channel invite link
    try {
      const channelInvite = await ctx.telegram.createChatInviteLink(freeChannelId, {
        member_limit: 1,
        name: `Free - User ${userId}`,
      });
      channelInviteUrl = channelInvite.invite_link;
      console.log(`[Onboarding] Channel invite created: ${channelInviteUrl}`);
    } catch (channelError) {
      logger.error('Failed to create channel invite link:', channelError);
      // Non-blocking - continue flow
    }

    // Try to generate group invite link
    try {
      const groupInvite = await ctx.telegram.createChatInviteLink(freeGroupId, {
        member_limit: 1,
        name: `Free - User ${userId}`,
      });
      groupInviteUrl = groupInvite.invite_link;
      console.log(`[Onboarding] Group invite created: ${groupInviteUrl}`);
    } catch (groupError) {
      logger.error('Failed to create group invite link:', groupError);
      // Non-blocking - continue flow
    }

    // Send invite links if available
    if (channelInviteUrl || groupInviteUrl) {
      let message = t('freeChannelInvite', lang) + '\n\n';
      if (channelInviteUrl) {
        message += `📺 ${t('freeChannel', lang)}: ${channelInviteUrl}\n`;
      }
      if (groupInviteUrl) {
        message += `💬 ${t('freeGroup', lang)}: ${groupInviteUrl}\n`;
      }

      await ctx.reply(message);
    } else {
      // Fallback message if invite generation failed
      logger.warn(`Failed to generate any invite links for user ${userId}`);
      await ctx.reply(t('freeChannelInviteFailed', lang));
    }

    // Complete onboarding
    await completeOnboarding(ctx);
  } catch (error) {
    logger.error('Error in generateFreeChannelInvite:', error);
    // Non-blocking - still complete onboarding
    await completeOnboarding(ctx);
  }
}

/**
 * Complete onboarding and create user profile
 * @param {Context} ctx - Telegraf context
 */
async function completeOnboarding(ctx) {
  try {
    const lang = ctx.session.language || 'en';
    const userId = ctx.from.id.toString();

    console.log(`[Onboarding] Completing onboarding for user ${userId}`);

    const now = new Date();
    const useEmail = ctx.session.emailDuplicate ? null : (ctx.session.email || null);
    const userData = {
      userId,
      username: ctx.from.username || null,
      firstName: ctx.from.first_name || null,
      lastName: ctx.from.last_name || null,
      language: ctx.session.language,
      email: useEmail,
      emailVerified: false,

      onboardingComplete: true,
      createdAt: now,
      lastActive: now,
      ageVerified: ctx.session.ageVerified || false,
      termsAccepted: ctx.session.termsAccepted || false,
      privacyAccepted: ctx.session.privacyAccepted || false,
    };
    try {
      await UserModel.createOrUpdate(userData);
    } catch (error) {
      const isDuplicateEmail =
        error?.code === '23505' ||
        (error?.message || '').toLowerCase().includes('duplicate key') ||
        (error?.message || '').toLowerCase().includes('idx_users_email');
      if (!isDuplicateEmail) {
        throw error;
      }

      logger.warn('Duplicate email during onboarding, retrying without email', {
        userId,
        email: ctx.session.email,
      });
      ctx.session.emailDuplicate = true;
      userData.email = null;
      await UserModel.createOrUpdate(userData);
    }
    console.log(`[Onboarding] User record created in PostgreSQL for user ${userId}`);

    // Business channel notification
    BusinessNotificationService.notifyNewUser({
      userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      language: ctx.session?.language,
    }).catch(() => {});

    // Auto-activate free membership if enabled
    if (process.env.AUTO_ACTIVATE_FREE_USERS === 'true') {
      console.log(`[Onboarding] Auto-activating Free membership for user ${userId}`);
      await UserModel.updateSubscription(userId, {
        status: 'free',
        planId: 'free',
        expiry: null,
      });
    }

    // Clear onboarding session data
    ctx.session.onboardingStep = null;
    ctx.session.awaitingEmail = false;
    ctx.session.onboardingComplete = true;
    ctx.session.emailDuplicate = false;

    // Send completion message
    await ctx.reply(t('profileCreated', lang));

    // Show main menu
    await showMainMenu(ctx);
  } catch (error) {
    logger.error('Error in completeOnboarding:', error);
    await ctx.reply(t('error', ctx.session?.language || 'en'));
  }
}

/**
 * Show main menu
 * @param {Context} ctx - Telegraf context
 */
async function showMainMenu(ctx) {
  const lang = ctx.session.language || 'en';
  const userId = ctx.from.id.toString();

  // Fetch user data to determine subscription status
  const user = await UserModel.getById(userId);
  const isPrimeUser = user?.subscription?.isPrime;

  // Sanitize the intro text
  const introText = sanitize.telegramMarkdown(t('mainMenuIntro', lang));

  let menuButtons;

  if (isPrimeUser) {
    // Prime User Menu (current menu)
    menuButtons = [
      [
        Markup.button.callback(sanitize.telegramMarkdown(t('subscribe', lang)), 'show_subscription_plans'),
      ],
      [
        Markup.button.callback(sanitize.telegramMarkdown(t('myProfile', lang)), 'show_profile'),
        Markup.button.callback(sanitize.telegramMarkdown(t('nearbyUsers', lang)), 'show_nearby_unified'),
      ],
      [
        Markup.button.callback(sanitize.telegramMarkdown(t('liveStreams', lang)), 'show_live'),
      ],
      [
        Markup.button.callback(sanitize.telegramMarkdown(t('support', lang)), 'show_support'),
        Markup.button.callback(sanitize.telegramMarkdown(t('settings', lang)), 'show_settings'),
      ],
    ];
  } else {
    // Free User / Sales-Oriented Menu
    menuButtons = [
      [
        Markup.button.callback(sanitize.telegramMarkdown(t('upgradeToPrime', lang)), 'show_subscription_plans'),
      ],
      [
        Markup.button.callback(sanitize.telegramMarkdown(t('exploreFeatures', lang)), 'show_premium_features'),
        Markup.button.callback(sanitize.telegramMarkdown(t('specialOffers', lang)), 'show_special_offers'),
      ],
      [
        Markup.button.callback(sanitize.telegramMarkdown(t('myProfile', lang)), 'show_profile'),
        Markup.button.callback(sanitize.telegramMarkdown(t('support', lang)), 'show_support'),
      ],
    ];
  }

  await ctx.reply(
    introText,
    Markup.inlineKeyboard(menuButtons),
    { parse_mode: 'MarkdownV2' }
  );
}

module.exports = {
  handleLanguageSelection,
  handleAgeConfirmation,
  handleTermsAcceptance,
  handleTermsDecline,
  handlePrivacyAcceptance,
  handlePrivacyDecline,
  handleEmailSubmission,
  showAgeVerification,
  showTerms,
  showPrivacyPolicy,
  showEmailPrompt,
  generateFreeChannelInvite,
  completeOnboarding,
  showMainMenu,
};
