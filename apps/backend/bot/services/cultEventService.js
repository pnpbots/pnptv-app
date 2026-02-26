const CultEventModel = require('../../models/cultEventModel');
const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

const EVENT_TYPES = {
  PRIME: 'prime_trial',
  SANTINO: 'santino_hangout',
  LEX: 'lex_hangout',
  GALA: 'meth_gala',
};

const getMonthKey = (date = new Date()) => date.toISOString().slice(0, 7);

const getSecondSaturday = (year, month) => {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstSaturdayOffset = (6 - firstDay.getUTCDay() + 7) % 7;
  const firstSaturday = new Date(Date.UTC(year, month, 1 + firstSaturdayOffset));
  return new Date(Date.UTC(year, month, firstSaturday.getUTCDate() + 7));
};

const getLastSaturday = (year, month) => {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const offset = (lastDay.getUTCDay() + 1) % 7;
  return new Date(Date.UTC(year, month, lastDay.getUTCDate() - offset));
};

const getEventAt = (eventType, date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  if (eventType === EVENT_TYPES.SANTINO || eventType === EVENT_TYPES.LEX) {
    const secondSaturday = getSecondSaturday(year, month);
    const hour = eventType === EVENT_TYPES.LEX ? 20 : 22;
    return new Date(Date.UTC(year, month, secondSaturday.getUTCDate(), hour, 0, 0));
  }

  const lastSaturday = getLastSaturday(year, month);
  return new Date(Date.UTC(year, month, lastSaturday.getUTCDate(), 20, 0, 0));
};

const formatDate = (date, lang) => {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', options);
};

class CultEventService {
  static EVENT_TYPES = EVENT_TYPES;

  static async register({ userId, eventType, monthKey = getMonthKey(), eventAt = null }) {
    const eventDate = eventAt || getEventAt(eventType);
    return CultEventModel.register({
      userId,
      eventType,
      monthKey,
      eventAt: eventDate,
    });
  }

  static async sendReminder(bot, registration, reminderLabel) {
    try {
      const user = await UserModel.getById(registration.user_id);
      const lang = user?.language || 'en';
      const eventDate = new Date(registration.event_at);
      const formattedDate = formatDate(eventDate, lang);
      const time = `${eventDate.getUTCHours().toString().padStart(2, '0')}:00 UTC`;

      const eventName = {
        [EVENT_TYPES.SANTINO]: lang === 'es' ? 'Hangout con Santino' : "Santino's Hangout",
        [EVENT_TYPES.LEX]: lang === 'es' ? 'Hangout con Lex' : "Lex's Hangout",
        [EVENT_TYPES.GALA]: lang === 'es' ? 'The Meth Gala' : 'The Meth Gala',
        [EVENT_TYPES.PRIME]: lang === 'es' ? 'Activación PRIME' : 'PRIME Activation',
      }[registration.event_type] || (lang === 'es' ? 'Evento' : 'Event');

      const message = lang === 'es'
        ? `⏰ Recordatorio ${reminderLabel}\n\n🎉 ${eventName}\n📅 ${formattedDate}\n🕗 ${time}\n\nSi ya no puedes asistir, avísanos con tiempo.`
        : `⏰ ${reminderLabel} reminder\n\n🎉 ${eventName}\n📅 ${formattedDate}\n🕗 ${time}\n\nIf you can’t attend, please let us know.`;

      await bot.telegram.sendMessage(registration.user_id, message);
    } catch (error) {
      logger.error('Error sending cult event reminder:', error);
    }
  }

  static async processReminders(bot) {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const registrations = await CultEventModel.getUpcomingRegistrations(now, windowEnd);
    const labels = {
      es: { week: '7 días', threeDays: '3 días', day: 'hoy' },
      en: { week: '7-day', threeDays: '3-day', day: 'today' },
    };

    for (const registration of registrations) {
      if (registration.event_type === EVENT_TYPES.PRIME) {
        continue;
      }

      const eventAt = new Date(registration.event_at);
      const diffMs = eventAt.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      const user = await UserModel.getById(registration.user_id);
      const lang = user?.language || 'en';
      const labelSet = labels[lang === 'es' ? 'es' : 'en'];

      if (diffHours <= 168 && diffHours > 144 && !registration.reminder_7d_sent) {
        await this.sendReminder(bot, registration, labelSet.week);
        await CultEventModel.markReminderSent(registration.id, 'reminder_7d_sent');
      } else if (diffHours <= 72 && diffHours > 48 && !registration.reminder_3d_sent) {
        await this.sendReminder(bot, registration, labelSet.threeDays);
        await CultEventModel.markReminderSent(registration.id, 'reminder_3d_sent');
      } else if (diffHours <= 24 && diffHours > 0 && !registration.reminder_day_sent) {
        await this.sendReminder(bot, registration, labelSet.day);
        await CultEventModel.markReminderSent(registration.id, 'reminder_day_sent');
      }
    }
  }
}

module.exports = CultEventService;
