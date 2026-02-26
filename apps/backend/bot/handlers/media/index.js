
const jitsiHandlers = require('./jitsi');
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
  console.log('>>> MEDIA HANDLERS: Starting registration');

  jitsiHandlers(bot);
  liveHandlers(bot);
  supportHandlers(bot);
  playerHandlers(bot);
  membersAreaHandlers(bot);
  console.log('>>> MEDIA HANDLERS: About to register menu handlers');
  menuHandlers(bot);
  console.log('>>> MEDIA HANDLERS: Menu handlers registered');
  console.log('>>> MEDIA HANDLERS: All registered');
};

module.exports = registerMediaHandlers;
