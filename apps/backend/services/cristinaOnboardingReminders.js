'use strict';

const logger = require('../utils/logger');
const db = require('../config/postgres');
const { getRedis } = require('../config/redis');
const sendSystemDM = require('./sendSystemDM');

const CRISTINA_ID = 'cristina-ai';
const REDIS_PREFIX = 'cristina:onboard_remind:';
const REDIS_TTL = 60 * 60 * 24 * 60; // 60 days — don't re-send

/**
 * Onboarding reminder schedule.
 * Each entry: { day: N, key: string, en: fn(name), es: fn(name) }
 */
const REMINDERS = [
  {
    day: 0,
    key: 'welcome',
    en: (name) => [
      `Hey ${name}! Welcome to PNPtv! I'm Cristina, your guide to the community.`,
      ``,
      `Start by checking out the Social Feed — see what members are posting, drop a like, or share your first post.`,
      ``,
      `Tap the home icon to explore. I'll check in over the next few days to show you more features!`,
    ].join('\n'),
    es: (name) => [
      `Hey ${name}! Bienvenido a PNPtv! Soy Cristina, tu guia en la comunidad.`,
      ``,
      `Empieza explorando el Social Feed — mira lo que publican los miembros, da un like o comparte tu primer post.`,
      ``,
      `Toca el icono de inicio para explorar. Te escribire en los proximos dias para mostrarte mas funciones!`,
    ].join('\n'),
  },
  {
    day: 1,
    key: 'nearby',
    en: (name) => [
      `Hey ${name}! Did you know you can find guys near you?`,
      ``,
      `Open the Nearby tab to see who's around. Share your location to appear on the map and let others find you too.`,
      ``,
      `The closer they are, the easier to connect. Check it out!`,
    ].join('\n'),
    es: (name) => [
      `Hey ${name}! Sabias que puedes encontrar chicos cerca de ti?`,
      ``,
      `Abre la pestana Nearby para ver quien esta cerca. Comparte tu ubicacion para aparecer en el mapa y que otros te encuentren.`,
      ``,
      `Mientras mas cerca, mas facil conectar. Echale un vistazo!`,
    ].join('\n'),
  },
  {
    day: 2,
    key: 'hangouts',
    en: (name) => [
      `Hey ${name}! Ready for some face time?`,
      ``,
      `Hangouts are live video rooms where you can meet members in real time. Join a public room or create your own private one.`,
      ``,
      `Head to the Hangouts section and jump in. It's where the real connections happen.`,
    ].join('\n'),
    es: (name) => [
      `Hey ${name}! Listo para conectar en vivo?`,
      ``,
      `Los Hangouts son salas de video donde puedes conocer miembros en tiempo real. Unete a una sala publica o crea tu propia sala privada.`,
      ``,
      `Ve a la seccion Hangouts y entra. Ahi es donde se hacen las conexiones reales.`,
    ].join('\n'),
  },
  {
    day: 3,
    key: 'live',
    en: (name) => [
      `Hey ${name}! Have you checked out PNP Television Live yet?`,
      ``,
      `Watch live shows, exclusive streams, and private 1-on-1 sessions with performers. There's always something going on.`,
      ``,
      `Tap the Live icon to see who's streaming right now!`,
    ].join('\n'),
    es: (name) => [
      `Hey ${name}! Ya viste PNP Television Live?`,
      ``,
      `Mira shows en vivo, streams exclusivos y sesiones privadas 1-a-1 con performers. Siempre hay algo pasando.`,
      ``,
      `Toca el icono de Live para ver quien esta transmitiendo ahora!`,
    ].join('\n'),
  },
  {
    day: 4,
    key: 'plans',
    en: (name) => [
      `Hey ${name}! Want to unlock the full PNPtv experience?`,
      ``,
      `With PRIME you get unlimited hangouts, priority in Nearby, exclusive content, and more. Plans start at $9.99/month — or grab Lifetime access with a single payment.`,
      ``,
      `Check out the plans at pnptv.app/plans`,
    ].join('\n'),
    es: (name) => [
      `Hey ${name}! Quieres desbloquear toda la experiencia PNPtv?`,
      ``,
      `Con PRIME tienes hangouts ilimitados, prioridad en Nearby, contenido exclusivo y mas. Los planes empiezan en $9.99/mes — o consigue acceso Lifetime con un solo pago.`,
      ``,
      `Mira los planes en pnptv.app/plans`,
    ].join('\n'),
  },
  {
    day: 5,
    key: 'referral',
    en: (name) => [
      `Hey ${name}! Want free PRIME days?`,
      ``,
      `Share your personal invite link with friends. When they join, you BOTH get 3 days of FREE PRIME access.`,
      ``,
      `Find your referral link in your Profile settings. The more friends you invite, the more free days you earn!`,
    ].join('\n'),
    es: (name) => [
      `Hey ${name}! Quieres dias gratis de PRIME?`,
      ``,
      `Comparte tu link personal de invitacion con amigos. Cuando se unan, AMBOS reciben 3 dias de acceso PRIME GRATIS.`,
      ``,
      `Encuentra tu link de referido en los ajustes de tu Perfil. Mientras mas amigos invites, mas dias gratis ganas!`,
    ].join('\n'),
  },
  {
    day: 6,
    key: 'support',
    en: (name) => [
      `Hey ${name}! That's your first week with PNPtv!`,
      ``,
      `If you ever need help, just DM me right here — I'm Cristina, the AI assistant, and I can answer questions about the app, your account, or the community.`,
      ``,
      `You can also open a support ticket from your Profile. We're here for you. Enjoy the community!`,
    ].join('\n'),
    es: (name) => [
      `Hey ${name}! Es tu primera semana en PNPtv!`,
      ``,
      `Si necesitas ayuda, solo escribeme aqui — soy Cristina, la asistente AI, y puedo responder preguntas sobre la app, tu cuenta o la comunidad.`,
      ``,
      `Tambien puedes abrir un ticket de soporte desde tu Perfil. Estamos aqui para ti. Disfruta la comunidad!`,
    ].join('\n'),
  },
];

// Disabled — Cristina onboarding DMs removed per admin request.
class CristinaOnboardingReminders {
  static async process() { return { sent: 0, skipped: 0 }; }
}

module.exports = CristinaOnboardingReminders;
