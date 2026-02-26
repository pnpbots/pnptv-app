/**
 * Date/Time Picker Utility
 * Provides visual calendar and time selection for Telegram inline keyboards
 */

const { Markup } = require('telegraf');

// Month names in Spanish and English
const MONTHS = {
  es: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const MONTHS_FULL = {
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const WEEKDAYS = {
  es: ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
};

const QUICK_PRESET_HOURS = Array.from({ length: 24 }, (_, i) => (i + 1) * 2);

/**
 * Return quick preset hours.
 * @returns {number[]} Array of hours
 */
function getQuickPresetHours() {
  return QUICK_PRESET_HOURS.slice();
}

/**
 * Generate quick preset options for scheduling
 * @param {string} lang - Language code ('es' or 'en')
 * @param {string} prefix - Callback prefix for actions
 * @returns {Array} Array of button rows
 */
function getQuickPresets(lang = 'es', prefix = 'schedule') {
  const hours = getQuickPresetHours();

  const presets = hours.map((value) => {
    const label = lang === 'es'
      ? `⏰ En ${value} horas`
      : `⏰ In ${value} hours`;
    return { label, hours: value };
  });

  const buttons = [];

  for (let i = 0; i < presets.length; i += 2) {
    const row = [
      Markup.button.callback(presets[i].label, `${prefix}_preset_${i}`),
    ];
    if (presets[i + 1]) {
      row.push(Markup.button.callback(presets[i + 1].label, `${prefix}_preset_${i + 1}`));
    }
    buttons.push(row);
  }

  return buttons;
}

/**
 * Calculate date from preset index
 * @param {number} index - Preset index
 * @returns {Date} Calculated date
 */
function calculatePresetDate(index) {
  const now = new Date();
  const hours = getQuickPresetHours();
  const presetHours = hours[index];
  if (!presetHours) return null;

  const preset = { hours: presetHours };
  if (!preset) return null;

  const result = new Date(now);

  if (preset.hours) {
    result.setHours(result.getHours() + preset.hours);
    result.setMinutes(0, 0, 0);
  } else if (preset.tomorrow) {
    result.setDate(result.getDate() + 1);
    result.setHours(preset.hour, 0, 0, 0);
  } else if (preset.weekend) {
    const daysUntilSaturday = (6 - result.getDay() + 7) % 7 || 7;
    result.setDate(result.getDate() + daysUntilSaturday);
    result.setHours(preset.hour, 0, 0, 0);
  } else if (preset.nextWeekday !== undefined) {
    const currentDay = result.getDay();
    let daysUntil = preset.nextWeekday - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    result.setDate(result.getDate() + daysUntil);
    result.setHours(preset.hour, 0, 0, 0);
  }

  return result;
}

/**
 * Get timezone offset in ms for a given date/timezone.
 * @param {Date} date
 * @param {string} timeZone
 * @returns {number} Offset in milliseconds
 */
function getTimeZoneOffset(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUTC - date.getTime();
}

/**
 * Build a Date from timezone-local components.
 * @param {Object} params
 * @param {number} params.year
 * @param {number} params.month
 * @param {number} params.day
 * @param {number} params.hour
 * @param {number} params.minute
 * @param {string} timeZone
 * @returns {Date}
 */
function buildDateInTimeZone({ year, month, day, hour, minute }, timeZone) {
  const utcDate = new Date(Date.UTC(year, month, day, hour, minute, 0));
  const offset = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offset);
}

/**
 * Format date/time in a specific timezone.
 * @param {Date} date
 * @param {string} timeZone
 * @param {string} lang
 * @returns {{formattedDate: string, formattedTime: string}}
 */
function formatDateTimeInTimeZone(date, timeZone, lang = 'es') {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const monthIndex = Number(values.month) - 1;
  const monthName = MONTHS_FULL[lang][monthIndex];
  const formattedDate = `${Number(values.day)} ${monthName} ${values.year}`;
  const formattedTime = `${values.hour}:${values.minute}`;
  return { formattedDate, formattedTime };
}

/**
 * Generate calendar keyboard for a given month
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @param {string} lang - Language code
 * @param {string} prefix - Callback prefix
 * @returns {Array} Array of button rows
 */
function generateCalendar(year, month, lang = 'es', prefix = 'schedule') {
  const buttons = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Header with month and year
  const monthName = MONTHS_FULL[lang][month];
  buttons.push([
    Markup.button.callback('◀️', `${prefix}_month_${year}_${month - 1}`),
    Markup.button.callback(`${monthName} ${year}`, `${prefix}_ignore`),
    Markup.button.callback('▶️', `${prefix}_month_${year}_${month + 1}`),
  ]);

  // Weekday headers
  const weekdayRow = WEEKDAYS[lang].map(day =>
    Markup.button.callback(day, `${prefix}_ignore`)
  );
  buttons.push(weekdayRow);

  // Get first day of month and number of days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const numDays = lastDay.getDate();

  // Adjust for Monday start (0 = Monday, 6 = Sunday)
  let startDayOfWeek = firstDay.getDay() - 1;
  if (startDayOfWeek < 0) startDayOfWeek = 6;

  // Generate day buttons
  let currentRow = [];

  // Add empty cells for days before month starts
  for (let i = 0; i < startDayOfWeek; i++) {
    currentRow.push(Markup.button.callback(' ', `${prefix}_ignore`));
  }

  // Add day buttons
  for (let day = 1; day <= numDays; day++) {
    const date = new Date(year, month, day);
    const isPast = date < today;
    const isToday = date.getTime() === today.getTime();

    let dayLabel = day.toString();
    if (isToday) dayLabel = `[${day}]`;

    if (isPast) {
      currentRow.push(Markup.button.callback('·', `${prefix}_ignore`));
    } else {
      currentRow.push(Markup.button.callback(
        dayLabel,
        `${prefix}_date_${year}_${month}_${day}`
      ));
    }

    if (currentRow.length === 7) {
      buttons.push(currentRow);
      currentRow = [];
    }
  }

  // Add remaining empty cells
  while (currentRow.length > 0 && currentRow.length < 7) {
    currentRow.push(Markup.button.callback(' ', `${prefix}_ignore`));
  }
  if (currentRow.length > 0) {
    buttons.push(currentRow);
  }

  return buttons;
}

/**
 * Generate time selection keyboard
 * @param {string} lang - Language code
 * @param {string} prefix - Callback prefix
 * @param {string} selectedDate - Selected date string (YYYY-MM-DD)
 * @returns {Array} Array of button rows
 */
function generateTimeSlots(lang = 'es', prefix = 'schedule', selectedDate = '') {
  const buttons = [];

  // Morning times
  const morningLabel = lang === 'es' ? '🌅 Mañana' : '🌅 Morning';
  buttons.push([Markup.button.callback(morningLabel, `${prefix}_ignore`)]);
  buttons.push([
    Markup.button.callback('6:00', `${prefix}_time_${selectedDate}_06_00`),
    Markup.button.callback('7:00', `${prefix}_time_${selectedDate}_07_00`),
    Markup.button.callback('8:00', `${prefix}_time_${selectedDate}_08_00`),
    Markup.button.callback('9:00', `${prefix}_time_${selectedDate}_09_00`),
  ]);
  buttons.push([
    Markup.button.callback('10:00', `${prefix}_time_${selectedDate}_10_00`),
    Markup.button.callback('11:00', `${prefix}_time_${selectedDate}_11_00`),
  ]);

  // Afternoon times
  const afternoonLabel = lang === 'es' ? '☀️ Tarde' : '☀️ Afternoon';
  buttons.push([Markup.button.callback(afternoonLabel, `${prefix}_ignore`)]);
  buttons.push([
    Markup.button.callback('12:00', `${prefix}_time_${selectedDate}_12_00`),
    Markup.button.callback('13:00', `${prefix}_time_${selectedDate}_13_00`),
    Markup.button.callback('14:00', `${prefix}_time_${selectedDate}_14_00`),
    Markup.button.callback('15:00', `${prefix}_time_${selectedDate}_15_00`),
  ]);
  buttons.push([
    Markup.button.callback('16:00', `${prefix}_time_${selectedDate}_16_00`),
    Markup.button.callback('17:00', `${prefix}_time_${selectedDate}_17_00`),
  ]);

  // Evening times
  const eveningLabel = lang === 'es' ? '🌙 Noche' : '🌙 Evening';
  buttons.push([Markup.button.callback(eveningLabel, `${prefix}_ignore`)]);
  buttons.push([
    Markup.button.callback('18:00', `${prefix}_time_${selectedDate}_18_00`),
    Markup.button.callback('19:00', `${prefix}_time_${selectedDate}_19_00`),
    Markup.button.callback('20:00', `${prefix}_time_${selectedDate}_20_00`),
    Markup.button.callback('21:00', `${prefix}_time_${selectedDate}_21_00`),
  ]);
  buttons.push([
    Markup.button.callback('22:00', `${prefix}_time_${selectedDate}_22_00`),
    Markup.button.callback('23:00', `${prefix}_time_${selectedDate}_23_00`),
  ]);

  // Custom time option
  const customLabel = lang === 'es' ? '⌨️ Hora personalizada' : '⌨️ Custom time';
  buttons.push([Markup.button.callback(customLabel, `${prefix}_custom_time_${selectedDate}`)]);

  return buttons;
}

/**
 * Generate the initial scheduling message with quick presets and calendar option
 * @param {string} lang - Language code
 * @param {string} prefix - Callback prefix
 * @returns {Object} { text, keyboard }
 */
function getSchedulingMenu(lang = 'es', prefix = 'schedule') {
  const text = lang === 'es'
    ? `📅 *Seleccionar Fecha y Hora*\n\n` +
      `Elige una opción rápida o selecciona manualmente:\n\n` +
      `⚡ *Opciones rápidas* - Un clic para programar\n` +
      `📆 *Calendario* - Selección visual de fecha`
    : `📅 *Select Date and Time*\n\n` +
      `Choose a quick option or select manually:\n\n` +
      `⚡ *Quick options* - One click to schedule\n` +
      `📆 *Calendar* - Visual date selection`;

  const presetButtons = getQuickPresets(lang, prefix);

  const calendarButton = lang === 'es'
    ? '📆 Abrir Calendario'
    : '📆 Open Calendar';

  const cancelButton = lang === 'es' ? '❌ Cancelar' : '❌ Cancel';

  const keyboard = Markup.inlineKeyboard([
    ...presetButtons,
    [Markup.button.callback(calendarButton, `${prefix}_open_calendar`)],
    [Markup.button.callback(cancelButton, 'admin_cancel')],
  ]);

  return { text, keyboard };
}

/**
 * Generate calendar view message
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @param {string} lang - Language code
 * @param {string} prefix - Callback prefix
 * @returns {Object} { text, keyboard }
 */
function getCalendarView(year, month, lang = 'es', prefix = 'schedule') {
  // Normalize month (handle overflow/underflow)
  while (month < 0) {
    month += 12;
    year--;
  }
  while (month > 11) {
    month -= 12;
    year++;
  }

  const text = lang === 'es'
    ? `📅 *Selecciona una fecha*\n\n` +
      `Toca un día para continuar.\n` +
      `Los días pasados están deshabilitados.`
    : `📅 *Select a date*\n\n` +
      `Tap a day to continue.\n` +
      `Past days are disabled.`;

  const calendarButtons = generateCalendar(year, month, lang, prefix);
  const backButton = lang === 'es' ? '◀️ Volver' : '◀️ Back';

  const keyboard = Markup.inlineKeyboard([
    ...calendarButtons,
    [Markup.button.callback(backButton, `${prefix}_back_to_presets`)],
  ]);

  return { text, keyboard };
}

/**
 * Generate time selection view message
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @param {number} day - Day
 * @param {string} lang - Language code
 * @param {string} prefix - Callback prefix
 * @returns {Object} { text, keyboard }
 */
function getTimeSelectionView(year, month, day, lang = 'es', prefix = 'schedule') {
  const date = new Date(year, month, day);
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const monthName = MONTHS_FULL[lang][month];
  const formattedDate = `${day} ${monthName} ${year}`;

  const text = lang === 'es'
    ? `⏰ *Selecciona la hora*\n\n` +
      `📅 Fecha: *${formattedDate}*\n\n` +
      `Elige una hora o ingresa una personalizada:`
    : `⏰ *Select time*\n\n` +
      `📅 Date: *${formattedDate}*\n\n` +
      `Choose a time or enter a custom one:`;

  const timeButtons = generateTimeSlots(lang, prefix, dateStr);
  const backButton = lang === 'es' ? '◀️ Cambiar fecha' : '◀️ Change date';

  const keyboard = Markup.inlineKeyboard([
    ...timeButtons,
    [Markup.button.callback(backButton, `${prefix}_open_calendar`)],
  ]);

  return { text, keyboard };
}

/**
 * Generate confirmation view
 * @param {Date} scheduledDate - The scheduled date/time
 * @param {string} timezone - Timezone string
 * @param {string} lang - Language code
 * @param {string} prefix - Callback prefix
 * @returns {Object} { text, keyboard }
 */
function getConfirmationView(scheduledDate, timezone, lang = 'es', prefix = 'schedule') {
  const { formattedDate, formattedTime } = timezone
    ? formatDateTimeInTimeZone(scheduledDate, timezone, lang)
    : formatDateTimeInTimeZone(scheduledDate, 'UTC', lang);

  const text = lang === 'es'
    ? `✅ *Confirmar Programación*\n\n` +
      `📅 Fecha: *${formattedDate}*\n` +
      `⏰ Hora: *${formattedTime}*\n` +
      `🌍 Zona: *${timezone}*\n\n` +
      `¿Es correcto?`
    : `✅ *Confirm Schedule*\n\n` +
      `📅 Date: *${formattedDate}*\n` +
      `⏰ Time: *${formattedTime}*\n` +
      `🌍 Timezone: *${timezone}*\n\n` +
      `Is this correct?`;

  const confirmButton = lang === 'es' ? '✅ Confirmar' : '✅ Confirm';
  const changeButton = lang === 'es' ? '✏️ Cambiar hora' : '✏️ Change time';
  const changeTzButton = lang === 'es' ? '🌍 Cambiar zona' : '🌍 Change timezone';
  const cancelButton = lang === 'es' ? '❌ Cancelar' : '❌ Cancel';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(confirmButton, `${prefix}_confirm`)],
    [Markup.button.callback(changeButton, `${prefix}_back_to_presets`)],
    [Markup.button.callback(changeTzButton, `${prefix}_change_tz`)],
    [Markup.button.callback(cancelButton, 'admin_cancel')],
  ]);

  return { text, keyboard };
}

/**
 * Parse time callback data
 * @param {string} data - Callback data like "schedule_time_2025-01-15_14_30"
 * @returns {Object|null} { year, month, day, hour, minute } or null
 */
function parseTimeCallback(data) {
  const match = data.match(/time_(\d{4})-(\d{2})-(\d{2})_(\d{2})_(\d{2})/);
  if (!match) return null;

  return {
    year: parseInt(match[1]),
    month: parseInt(match[2]) - 1, // Convert to 0-indexed
    day: parseInt(match[3]),
    hour: parseInt(match[4]),
    minute: parseInt(match[5]),
  };
}

/**
 * Parse date callback data
 * @param {string} data - Callback data like "schedule_date_2025_0_15"
 * @returns {Object|null} { year, month, day } or null
 */
function parseDateCallback(data) {
  const match = data.match(/date_(\d{4})_(\d+)_(\d+)/);
  if (!match) return null;

  return {
    year: parseInt(match[1]),
    month: parseInt(match[2]),
    day: parseInt(match[3]),
  };
}

/**
 * Parse month navigation callback data
 * @param {string} data - Callback data like "schedule_month_2025_1"
 * @returns {Object|null} { year, month } or null
 */
function parseMonthCallback(data) {
  const match = data.match(/month_(\d{4})_(-?\d+)/);
  if (!match) return null;

  return {
    year: parseInt(match[1]),
    month: parseInt(match[2]),
  };
}

/**
 * Format date for display
 * @param {Date} date - Date object
 * @param {string} lang - Language code
 * @returns {string} Formatted date string
 */
function formatDate(date, lang = 'es', timeZone = null) {
  if (timeZone) {
    const { formattedDate, formattedTime } = formatDateTimeInTimeZone(date, timeZone, lang);
    return `${formattedDate} ${formattedTime}`;
  }
  const day = date.getDate();
  const month = MONTHS_FULL[lang][date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day} ${month} ${year} ${hours}:${minutes}`;
}

module.exports = {
  getQuickPresets,
  getQuickPresetHours,
  calculatePresetDate,
  buildDateInTimeZone,
  generateCalendar,
  generateTimeSlots,
  getSchedulingMenu,
  getCalendarView,
  getTimeSelectionView,
  getConfirmationView,
  parseTimeCallback,
  parseDateCallback,
  parseMonthCallback,
  formatDate,
  MONTHS,
  MONTHS_FULL,
  WEEKDAYS,
};
