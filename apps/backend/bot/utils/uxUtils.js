/**
 * UX Utilities
 * User experience enhancements for broadcast and share post functionality
 */

const { Markup } = require('telegraf');

/**
 * Create a progress bar for multi-step processes
 * @param {Number} currentStep - Current step number
 * @param {Number} totalSteps - Total number of steps
 * @param {Number} width - Width of progress bar (default: 10)
 * @returns {String} Progress bar string
 */
function createProgressBar(currentStep, totalSteps, width = 10) {
  const filled = Math.round((currentStep / totalSteps) * width);
  const empty = width - filled;
  return '▰'.repeat(filled) + '▱'.repeat(empty);
}

/**
 * Generate step indicator for multi-step processes
 * @param {Number} currentStep - Current step number
 * @param {Number} totalSteps - Total number of steps
 * @param {String} stepDescription - Description of current step
 * @param {String} lang - Language code (en/es)
 * @returns {String} Formatted step indicator
 */
function generateStepIndicator(currentStep, totalSteps, stepDescription, lang = 'en') {
  const progressBar = createProgressBar(currentStep, totalSteps);
  const progressPercent = Math.round((currentStep / totalSteps) * 100);
  
  const stepLabel = lang === 'es' ? 'Paso' : 'Step';
  const progressLabel = lang === 'es' ? 'Progreso' : 'Progress';
  
  return `*${stepLabel} ${currentStep}/${totalSteps}: ${stepDescription}*\n\n` +
    `*${progressLabel}:* [${progressBar}] ${progressPercent}%\n\n`;
}

/**
 * Create a back button for navigation
 * @param {String} action - Callback action
 * @param {String} lang - Language code
 * @returns {Array} Button row for inline keyboard
 */
function createBackButton(action, lang = 'en') {
  const text = lang === 'es' ? '⬅️ Volver' : '⬅️ Back';
  return [Markup.button.callback(text, action)];
}

/**
 * Create a cancel button
 * @param {String} lang - Language code
 * @returns {Array} Button row for inline keyboard
 */
function createCancelButton(lang = 'en') {
  const text = lang === 'es' ? '❌ Cancelar' : '❌ Cancel';
  return [Markup.button.callback(text, 'admin_cancel')];
}

/**
 * Create a continue button
 * @param {String} action - Callback action
 * @param {String} lang - Language code
 * @returns {Array} Button row for inline keyboard
 */
function createContinueButton(action, lang = 'en') {
  const text = lang === 'es' ? '➡️ Continuar' : '➡️ Continue';
  return [Markup.button.callback(text, action)];
}

/**
 * Create a confirm button
 * @param {String} action - Callback action
 * @param {String} lang - Language code
 * @returns {Array} Button row for inline keyboard
 */
function createConfirmButton(action, lang = 'en') {
  const text = lang === 'es' ? '✅ Confirmar' : '✅ Confirm';
  return [Markup.button.callback(text, action)];
}

/**
 * Create a skip button
 * @param {String} action - Callback action
 * @param {String} lang - Language code
 * @returns {Array} Button row for inline keyboard
 */
function createSkipButton(action, lang = 'en') {
  const text = lang === 'es' ? '⏭️ Saltar' : '⏭️ Skip';
  return [Markup.button.callback(text, action)];
}

/**
 * Generate error message with helpful context
 * @param {String} errorType - Type of error
 * @param {String} details - Error details
 * @param {String} lang - Language code
 * @returns {String} Formatted error message
 */
function generateErrorMessage(errorType, details, lang = 'en') {
  const messages = {
    validation: lang === 'es' ? '❌ *Error de validación*' : '❌ *Validation Error*'
    ,
    network: lang === 'es' ? '⚠️ *Error de red*' : '⚠️ *Network Error*'
    ,
    timeout: lang === 'es' ? '⏳ *Tiempo agotado*' : '⏳ *Timeout*'
    ,
    permission: lang === 'es' ? '🔒 *Sin permiso*' : '🔒 *No Permission*'
    ,
    generic: lang === 'es' ? '❌ *Error*' : '❌ *Error*'
  };
  
  const header = messages[errorType] || messages.generic;
  const helpText = lang === 'es' ? '\n*Ayuda:*' : '\n*Help:*';
  
  return `${header}\n\n${details}${helpText}`;
}

/**
 * Generate success message
 * @param {String} action - Action that succeeded
 * @param {String} details - Additional details
 * @param {String} lang - Language code
 * @returns {String} Formatted success message
 */
function generateSuccessMessage(action, details, lang = 'en') {
  const actionText = lang === 'es' ? '✅ *Éxito*' : '✅ *Success*';
  return `${actionText}\n\n${action}: ${details}`;
}

/**
 * Create button toggle indicator
 * @param {Boolean} isSelected - Whether button is selected
 * @param {String} baseText - Button text
 * @param {String} lang - Language code
 * @returns {String} Button text with toggle indicator
 */
function createButtonToggleText(isSelected, baseText, lang = 'en') {
  const prefix = isSelected 
    ? (lang === 'es' ? '✅ ' : '✅ ')
    : (lang === 'es' ? '➕ ' : '➕ ');
  return `${prefix}${baseText}`;
}

/**
 * Generate info message with tips
 * @param {String} message - Main message
 * @param {Array<String>} tips - Array of tips
 * @param {String} lang - Language code
 * @returns {String} Formatted info message
 */
function generateInfoMessage(message, tips, lang = 'en') {
  const tipLabel = lang === 'es' ? '*Consejos:*' : '*Tips:*';
  const tipItems = tips.map((tip, index) => `  ${index + 1}. ${tip}`).join('\n');
  
  return `📋 *${message}*\n\n${tipLabel}\n${tipItems}`;
}

/**
 * Create numbered option buttons
 * @param {Array<String>} options - Array of option texts
 * @param {String} prefix - Action prefix
 * @param {Number} perRow - Buttons per row
 * @param {String} lang - Language code
 * @returns {Array} Array of button rows
 */
function createNumberedOptions(options, prefix, perRow = 3, lang = 'en') {
  const buttons = [];
  
  options.forEach((option, index) => {
    const rowIndex = Math.floor(index / perRow);
    if (!buttons[rowIndex]) {
      buttons[rowIndex] = [];
    }
    
    const emoji = getNumberEmoji(index + 1, lang);
    buttons[rowIndex].push(
      Markup.button.callback(`${emoji} ${option}`, `${prefix}_${index + 1}`)
    );
  });
  
  return buttons;
}

/**
 * Get emoji for numbered options
 * @param {Number} number - Option number
 * @param {String} lang - Language code
 * @returns {String} Emoji representation
 */
function getNumberEmoji(number, lang = 'en') {
  const emojis = [
    '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣',
    '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'
  ];
  
  if (number <= 10) {
    return emojis[number - 1] || '🔢';
  }
  
  return number.toString();
}

/**
 * Create destination selection buttons with toggle indicators
 * @param {Array<Object>} destinations - Array of destination objects
 * @param {Array<String>} selectedIds - Array of selected destination IDs
 * @param {String} actionPrefix - Action prefix
 * @param {String} lang - Language code
 * @returns {Array} Array of button rows
 */
function createDestinationButtons(destinations, selectedIds, actionPrefix, lang = 'en') {
  const buttons = [];
  const selectedSet = new Set(selectedIds);
  
  destinations.forEach(dest => {
    const isSelected = selectedSet.has(dest.telegram_id || dest.group_id);
    const prefix = isSelected ? '✅' : '⬜';
    const text = `${prefix} ${dest.icon || ''} ${dest.destination_name || dest.name}`;
    
    buttons.push([
      Markup.button.callback(text, `${actionPrefix}_${dest.telegram_id || dest.group_id}`)
    ]);
  });
  
  return buttons;
}

/**
 * Generate summary of selected options
 * @param {Array} selectedItems - Array of selected items
 * @param {String} itemType - Type of items (destinations, buttons, etc.)
 * @param {String} lang - Language code
 * @returns {String} Formatted summary
 */
function generateSelectionSummary(selectedItems, itemType, lang = 'en') {
  const count = selectedItems.length;
  const typeLabel = itemType === 'destinations'
    ? (lang === 'es' ? 'Destinos' : 'Destinations')
    : (lang === 'es' ? 'Elementos' : 'Items');
  
  if (count === 0) {
    return lang === 'es' 
      ? `*${typeLabel} seleccionados:* 0`
      : `*Selected ${typeLabel}:* 0`;
  }
  
  const summary = lang === 'es'
    ? `*${typeLabel} seleccionados:* ${count}\n`
    : `*Selected ${typeLabel}:* ${count}\n`;
  
  if (count <= 5) {
    const itemsList = selectedItems.slice(0, 5).map(item => `• ${item.name || item.text}`).join('\n');
    return summary + itemsList;
  }
  
  return summary;
}

/**
 * Create standard navigation buttons (back, cancel, continue)
 * @param {Object} config - Configuration object
 * @param {String} config.backAction - Back action
 * @param {String} config.continueAction - Continue action
 * @param {String} config.lang - Language code
 * @returns {Array} Array of button rows
 */
function createStandardNavigation(config) {
  const { backAction, continueAction, lang = 'en' } = config;
  const buttons = [];
  
  if (backAction) {
    buttons.push(createBackButton(backAction, lang));
  }
  
  buttons.push(createCancelButton(lang));
  
  if (continueAction) {
    buttons.push(createContinueButton(continueAction, lang));
  }
  
  return buttons;
}

/**
 * Format time remaining for scheduled operations
 * @param {Date} scheduledTime - Scheduled time
 * @param {String} lang - Language code
 * @returns {String} Formatted time remaining
 */
function formatTimeRemaining(scheduledTime, lang = 'en') {
  const now = new Date();
  const diff = scheduledTime - now;
  
  if (diff <= 0) {
    return lang === 'es' ? '⏰ *Ahora*' : '⏰ *Now*';
  }
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return lang === 'es'
      ? `⏰ *En ${hours}h ${minutes}m*`
      : `⏰ *In ${hours}h ${minutes}m*`;
  }
  
  return lang === 'es'
    ? `⏰ *En ${minutes} minutos*`
    : `⏰ *In ${minutes} minutes*`;
}

module.exports = {
  createProgressBar,
  generateStepIndicator,
  createBackButton,
  createCancelButton,
  createContinueButton,
  createConfirmButton,
  createSkipButton,
  generateErrorMessage,
  generateSuccessMessage,
  createButtonToggleText,
  generateInfoMessage,
  createNumberedOptions,
  getNumberEmoji,
  createDestinationButtons,
  generateSelectionSummary,
  createStandardNavigation,
  formatTimeRemaining
};
