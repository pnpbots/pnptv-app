/**
 * Enhanced Broadcast Utilities
 * Advanced utilities for broadcast and share post functionality
 * 
 * Features:
 * - Social sharing buttons and integration
 * - Engagement tracking buttons
 * - Advanced button management
 * - Content formatting and optimization
 * - Analytics and reporting utilities
 */

const { Markup } = require('telegraf');
const broadcastUtils = require('./broadcastUtils');

/**
 * Get social sharing button options
 * @returns {Array} Array of social sharing button configuration objects
 */
function getSocialSharingButtons() {
  return [
    { key: 'twitter', text: '🐦 Share on Twitter', type: 'url', target: 'https://twitter.com/intent/tweet?text={text}&url={url}' },
    { key: 'facebook', text: '📘 Share on Facebook', type: 'url', target: 'https://www.facebook.com/sharer/sharer.php?u={url}&quote={text}' },
    { key: 'telegram', text: '📤 Share on Telegram', type: 'url', target: 'https://t.me/share/url?url={url}&text={text}' },
    { key: 'whatsapp', text: '💬 Share on WhatsApp', type: 'url', target: 'https://wa.me/?text={text} {url}' },
    { key: 'copy', text: '📋 Copy Link', type: 'callback', data: 'copy_post_link' },
  ];
}

/**
 * Get engagement buttons for posts
 * @returns {Array} Array of engagement button configuration objects
 */
function getEngagementButtons() {
  return [
    { key: 'like', text: '❤️ Like', type: 'callback', data: 'engage_like' },
    { key: 'share', text: '🔗 Share', type: 'callback', data: 'engage_share' },
    { key: 'comment', text: '💬 Comment', type: 'callback', data: 'engage_comment' },
    { key: 'save', text: '🔖 Save', type: 'callback', data: 'engage_save' },
  ];
}

/**
 * Build social sharing keyboard with dynamic URLs
 * @param {string} postId - Post ID
 * @param {string} text - Post text
 * @returns {Object} Telegram inline keyboard
 */
function buildSocialSharingKeyboard(postId, text) {
  const webAppUrl = process.env.WEB_APP_URL || 'https://pnptv.app';
  const shareUrl = `${webAppUrl}/share/${postId}`;
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(shareUrl);

  const buttons = getSocialSharingButtons().map(button => {
    if (button.type === 'url') {
      return Markup.button.url(
        button.text,
        button.target
          .replace('{url}', encodedUrl)
          .replace('{text}', encodedText)
      );
    } else {
      return Markup.button.callback(button.text, button.data);
    }
  });

  // Split into rows of 2 buttons each
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  return Markup.inlineKeyboard(rows);
}

/**
 * Build engagement keyboard for posts
 * @returns {Object} Telegram inline keyboard
 */
function buildEngagementKeyboard() {
  const buttons = getEngagementButtons().map(button => 
    Markup.button.callback(button.text, button.data)
  );

  // Split into rows of 2 buttons each
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  return Markup.inlineKeyboard(rows);
}

/**
 * Build combined keyboard with both social sharing and engagement buttons
 * @param {string} postId - Post ID
 * @param {string} text - Post text
 * @returns {Object} Telegram inline keyboard
 */
function buildCombinedKeyboard(postId, text) {
  const sharingKeyboard = buildSocialSharingKeyboard(postId, text);
  const engagementKeyboard = buildEngagementKeyboard();

  // Combine the keyboards
  return Markup.inlineKeyboard([
    ...sharingKeyboard.inline_keyboard,
    [Markup.button.callback('❤️ Like', 'engage_like'), Markup.button.callback('💬 Comment', 'engage_comment')],
    [Markup.button.callback('🔗 Share', 'engage_share'), Markup.button.callback('🔖 Save', 'engage_save')],
  ]);
}

/**
 * Format post for optimal sharing
 * @param {Object} post - Post data
 * @param {string} platform - Target platform
 * @returns {Object} Formatted post data
 */
function formatPostForPlatform(post, platform) {
  const formats = {
    twitter: {
      maxLength: 280,
      hashtags: ['#PNPtv', '#Community', '#Social'],
      mention: '@PNPtvOfficial'
    },
    facebook: {
      maxLength: 63206,
      hashtags: ['#PNPtv', '#Community', '#Social'],
      mention: '@PNPtvOfficial'
    },
    telegram: {
      maxLength: 4096,
      hashtags: ['#PNPtv', '#Community', '#Social'],
      mention: '@PNPtvOfficial'
    },
    whatsapp: {
      maxLength: 4096,
      hashtags: [],
      mention: ''
    }
  };

  const format = formats[platform] || formats.telegram;
  const text = post.messageEn || post.messageEs || '';

  // Truncate if needed
  let formattedText = text.substring(0, format.maxLength);
  
  // Add hashtags and mention
  if (format.hashtags.length > 0) {
    formattedText += `\n\n${format.hashtags.join(' ')}`;
  }
  if (format.mention) {
    formattedText += ` ${format.mention}`;
  }

  return {
    ...post,
    formattedText,
    platform
  };
}

/**
 * Generate shareable link for a post
 * @param {string} postId - Post ID
 * @returns {string} Shareable URL
 */
function generateShareableLink(postId) {
  const webAppUrl = process.env.WEB_APP_URL || 'https://pnptv.app';
  return `${webAppUrl}/share/${postId}`;
}

/**
 * Create analytics summary for a post
 * @param {Object} analytics - Analytics data
 * @param {string} lang - Language code
 * @returns {string} Formatted analytics text
 */
function formatAnalyticsSummary(analytics, lang = 'en') {
  const isSpanish = lang === 'es';

  const header = isSpanish ? '📊 *Resumen de Engagement*' : '📊 *Engagement Summary*';
  const likes = isSpanish ? '❤️ Me gusta' : '❤️ Likes';
  const shares = isSpanish ? '🔗 Compartidos' : '🔗 Shares';
  const views = isSpanish ? '👀 Vistas' : '👀 Views';
  const comments = isSpanish ? '💬 Comentarios' : '💬 Comments';
  const users = isSpanish ? '👥 Usuarios únicos' : '👥 Unique Users';

  return `${header}

` +
    `${likes}: ${analytics.likes || 0}
` +
    `${shares}: ${analytics.shares || 0}
` +
    `${views}: ${analytics.views || 0}
` +
    `${comments}: ${analytics.comments || 0}
` +
    `${users}: ${analytics.unique_users || 0}`;
}

/**
 * Create A/B test summary
 * @param {Object} test - A/B test data
 * @param {string} lang - Language code
 * @returns {string} Formatted A/B test summary
 */
function formatABTestSummary(test, lang = 'en') {
  const isSpanish = lang === 'es';

  const header = isSpanish ? '🧪 *Resultado de Prueba A/B*' : '🧪 *A/B Test Result*';
  const winner = isSpanish ? '🏆 Ganador' : '🏆 Winner';
  const improvement = isSpanish ? '📈 Mejora' : '📈 Improvement';
  const engagementsA = isSpanish ? 'Engagement Variante A' : 'Variant A Engagements';
  const engagementsB = isSpanish ? 'Engagement Variante B' : 'Variant B Engagements';

  return `${header}

` +
    `${winner}: Variante ${test.winner}
` +
    `${improvement}: ${test.improvement_percent}%
` +
    `${engagementsA}: ${test.variant_a_engagements || 0}
` +
    `${engagementsB}: ${test.variant_b_engagements || 0}`;
}

/**
 * Build post preview with engagement buttons
 * @param {Object} post - Post data
 * @param {Object} analytics - Analytics data
 * @param {string} lang - Language code
 * @returns {Object} Preview message configuration
 */
function buildPostPreview(post, analytics, lang = 'en') {
  const text = post.messageEn || post.messageEs || '';
  const caption = `📢 ${text}`;

  const engagementText = analytics 
    ? `\n\n${formatAnalyticsSummary(analytics, lang)}`
    : '';

  const fullCaption = caption + engagementText;

  return {
    caption: fullCaption,
    parse_mode: 'Markdown',
    reply_markup: buildEngagementKeyboard()
  };
}

/**
 * Create content optimization suggestions
 * @param {Object} content - Content to analyze
 * @returns {Array} Array of optimization suggestions
 */
function suggestContentOptimizations(content) {
  const suggestions = [];
  const text = content.messageEn || content.messageEs || '';

  // Check length
  if (text.length > 1000) {
    suggestions.push({
      type: 'length',
      message: 'Consider shortening the post for better engagement',
      severity: 'medium'
    });
  }

  // Check for emojis
  const emojiCount = (text.match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu) || []).length;
  if (emojiCount < 2) {
    suggestions.push({
      type: 'emoji',
      message: 'Add more emojis to increase visual appeal',
      severity: 'low'
    });
  } else if (emojiCount > 10) {
    suggestions.push({
      type: 'emoji',
      message: 'Reduce emoji count for better readability',
      severity: 'low'
    });
  }

  // Check for call-to-action
  const hasCTA = text.toLowerCase().includes('click') || 
                text.toLowerCase().includes('visit') ||
                text.toLowerCase().includes('join') ||
                text.toLowerCase().includes('check out');

  if (!hasCTA) {
    suggestions.push({
      type: 'cta',
      message: 'Add a clear call-to-action to improve engagement',
      severity: 'high'
    });
  }

  return suggestions;
}

/**
 * Format optimization suggestions for display
 * @param {Array} suggestions - Optimization suggestions
 * @param {string} lang - Language code
 * @returns {string} Formatted suggestions text
 */
function formatOptimizationSuggestions(suggestions, lang = 'en') {
  const isSpanish = lang === 'es';

  const header = isSpanish ? '🎯 *Sugerencias de Optimización*' : '🎯 *Optimization Suggestions*';
  const severityLabels = {
    high: isSpanish ? '🔴 Alta' : '🔴 High',
    medium: isSpanish ? '🟡 Media' : '🟡 Medium',
    low: isSpanish ? '🟢 Baja' : '🟢 Low'
  };

  if (suggestions.length === 0) {
    return isSpanish ? '✅ ¡El contenido está bien optimizado!' : '✅ Content is well optimized!';
  }

  const suggestionItems = suggestions.map(s => 
    `• ${severityLabels[s.severity]}: ${s.message}`
  ).join('\n');

  return `${header}\n\n${suggestionItems}`;
}

/**
 * Enhanced version of standard button options with social sharing
 * @param {string} [language='en'] - Language code ('en' or 'es')
 * @returns {Array} Enhanced button options
 */
function getEnhancedButtonOptions(language = 'en') {
  const standardButtons = broadcastUtils.getStandardButtonOptions(language);
  const socialButtons = getSocialSharingButtons();
  
  return [...standardButtons, ...socialButtons];
}

module.exports = {
  getSocialSharingButtons,
  getEngagementButtons,
  buildSocialSharingKeyboard,
  buildEngagementKeyboard,
  buildCombinedKeyboard,
  formatPostForPlatform,
  generateShareableLink,
  formatAnalyticsSummary,
  formatABTestSummary,
  buildPostPreview,
  suggestContentOptimizations,
  formatOptimizationSuggestions,
  getEnhancedButtonOptions
};