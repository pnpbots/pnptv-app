
const liveHandlers = require('./live');
const supportHandlers = require('./support');
const playerHandlers = require('./player');
const membersAreaHandlers = require('./membersArea');
const menuHandlers = require('./menu');

/**
 * Register all media handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerMediaHandlers = (bot) => {
  liveHandlers(bot);
  supportHandlers(bot);
  playerHandlers(bot);
  membersAreaHandlers(bot);
  menuHandlers(bot);
};

module.exports = registerMediaHandlers;
