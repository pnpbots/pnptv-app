const { Markup } = require('telegraf');

const escapeMarkdown = (text) => {
  if (!text) return '';
  return text.replace(/[_*\\[\]()~`>#+=|{}.!-]/g, '\\$&');
};

const getLocationLine = (user) => {
  if (user.city && user.country) {
    return `📍 ${escapeMarkdown(user.city)}, ${escapeMarkdown(user.country)}`;
  }
  if (user.city) {
    return `📍 ${escapeMarkdown(user.city)}`;
  }
  if (user.country) {
    return `📍 ${escapeMarkdown(user.country)}`;
  }
  return '';
};

const getSocialLine = (user) => {
  const socials = [];
  if (user.twitter) socials.push(`𝕏 ${escapeMarkdown(user.twitter)}`);
  if (user.instagram) socials.push(`IG ${escapeMarkdown(user.instagram)}`);
  if (user.tiktok) socials.push(`TT ${escapeMarkdown(user.tiktok)}`);
  return socials.length > 0 ? `🔗 ${socials.join(' • ')}` : '';
};

const buildMemberProfileCard = (user) => {
  let profileText = '`👤 PROFILE CARD`\n\n';

  const displayName = escapeMarkdown(user.firstName || 'Anonymous');
  profileText += `**${displayName}**`;
  if (user.lastName) profileText += ` ${escapeMarkdown(user.lastName)}`;
  profileText += '\n';

  if (user.username) {
    profileText += `@${escapeMarkdown(user.username)}\n`;
  }

  profileText += '\n';

  if (user.bio) {
    const bioLine = user.bio.split('\n')[0];
    profileText += `💭 _"${escapeMarkdown(bioLine)}"_\n\n`;
  }

  if (user.tribe) {
    profileText += `🏳️‍🌈 **Tribe:** ${escapeMarkdown(user.tribe)}\n`;
  }
  if (user.looking_for) {
    profileText += `🔎 **Looking For:** ${escapeMarkdown(user.looking_for)}\n`;
  }

  if (user.interests && user.interests.length > 0) {
    profileText += `🎯 **Into:** ${user.interests.map(escapeMarkdown).join(', ')}\n\n`;
  }

  const locationLine = getLocationLine(user);
  if (locationLine) {
    profileText += `${locationLine}\n\n`;
  }

  const socialsLine = getSocialLine(user);
  if (socialsLine) {
    profileText += `${socialsLine}\n\n`;
  }

  profileText += '_Don\'t be shy... DM! 💬_';

  return profileText;
};

const buildMemberProfileInlineKeyboard = (user, lang = 'en') => {
  const buttons = [];
  const isSpanish = lang === 'es';

  // Always show DM button - use username if available, otherwise use tg://user deep link
  if (user.username) {
    buttons.push([Markup.button.url(isSpanish ? '💬 Enviar DM' : '💬 Send DM', `https://t.me/${user.username}`)]);
  } else if (user.id) {
    // Fallback for users without username - use Telegram deep link
    buttons.push([Markup.button.url(isSpanish ? '💬 Enviar DM' : '💬 Send DM', `tg://user?id=${user.id}`)]);
  }

  if (user.twitter) {
    buttons.push([Markup.button.url('𝕏 Twitter', `https://twitter.com/${user.twitter}`)]);
  }
  if (user.instagram) {
    buttons.push([Markup.button.url('IG Instagram', `https://instagram.com/${user.instagram}`)]);
  }
  if (user.tiktok) {
    buttons.push([Markup.button.url('TT TikTok', `https://tiktok.com/@${user.tiktok}`)]);
  }

  return buttons;
};

module.exports = {
  buildMemberProfileCard,
  buildMemberProfileInlineKeyboard,
  escapeMarkdown,
};
