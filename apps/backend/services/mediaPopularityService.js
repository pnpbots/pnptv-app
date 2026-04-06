/**
 * Media Popularity Service
 * Tracks most shared pictures and most liked media
 */

const { getPool } = require('../config/postgres');
const UserModel = require('../models/userModel');
const logger = require('../utils/logger');
const { getLanguage } = require('../utils/helpers');
const broadcastUtils = require('../utils/broadcastUtils');
const performanceUtils = require('../utils/performanceUtils');

class MediaPopularityService {
  /**
   * Track media share
   * @param {String} userId - User ID who shared the media
   * @param {String} mediaType - Type of media (photo/video)
   * @param {String} mediaId - Telegram file ID
   * @param {String} messageId - Telegram message ID
   */
  static async trackMediaShare(userId, mediaType, mediaId, messageId) {
    try {
      const query = `
        INSERT INTO media_shares (
          user_id, media_type, media_id, message_id, share_count, like_count, created_at
        ) VALUES (
          $1, $2, $3, $4, 1, 0, NOW()
        ) 
        ON CONFLICT (media_id) DO UPDATE SET
          share_count = media_shares.share_count + 1,
          updated_at = NOW()
        RETURNING *
      `;
      
      const result = await getPool().query(query, [userId, mediaType, mediaId, messageId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error tracking media share:', error);
      return null;
    }
  }

  /**
   * Track media like/reaction
   * @param {String} mediaId - Telegram file ID
   * @param {String} userId - User ID who liked the media
   */
  static async trackMediaLike(mediaId, userId) {
    try {
      const query = `
        UPDATE media_shares 
        SET like_count = like_count + 1, 
            last_like_at = NOW()
        WHERE media_id = $1
        RETURNING *
      `;
      
      const result = await getPool().query(query, [mediaId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error tracking media like:', error);
      return null;
    }
  }

  /**
   * Get most shared pictures of the week
   * @param {Number} limit - Number of results to return
   * @returns {Array} Array of top sharers
   */
  static async getTopPictureSharersThisWeek(limit = 5) {
    try {
      const query = `
        SELECT 
          user_id,
          COUNT(*) as picture_count,
          SUM(like_count) as total_likes
        FROM media_shares
        WHERE media_type = 'photo'
          AND created_at >= DATE_TRUNC('week', NOW())
        GROUP BY user_id
        ORDER BY picture_count DESC, total_likes DESC
        LIMIT $1
      `;
      
      const result = await getPool().query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting top picture sharers:', error);
      return [];
    }
  }

  /**
   * Get most liked picture of the day
   * @returns {Object} Most liked picture data
   */
  static async getMostLikedPictureOfTheDay() {
    try {
      const query = `
        SELECT 
          user_id,
          media_id,
          message_id,
          like_count,
          share_count
        FROM media_shares
        WHERE media_type = 'photo'
          AND created_at >= DATE_TRUNC('day', NOW())
        ORDER BY like_count DESC, share_count DESC
        LIMIT 1
      `;
      
      const result = await getPool().query(query);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting most liked picture:', error);
      return null;
    }
  }

  /**
   * Get most liked video of the day
   * @returns {Object} Most liked video data
   */
  static async getMostLikedVideoOfTheDay() {
    try {
      const query = `
        SELECT 
          user_id,
          media_id,
          message_id,
          like_count,
          share_count
        FROM media_shares
        WHERE media_type = 'video'
          AND created_at >= DATE_TRUNC('day', NOW())
        ORDER BY like_count DESC, share_count DESC
        LIMIT 1
      `;
      
      const result = await getPool().query(query);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting most liked video:', error);
      return null;
    }
  }

  /**
   * Get user's media stats
   * @param {String} userId - User ID
   * @returns {Object} User media statistics
   */
  static async getUserMediaStats(userId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_media,
          SUM(CASE WHEN media_type = 'photo' THEN 1 ELSE 0 END) as total_pictures,
          SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as total_videos,
          SUM(like_count) as total_likes,
          SUM(share_count) as total_shares
        FROM media_shares
        WHERE user_id = $1
      `;
      
      const result = await getPool().query(query, [userId]);
      return result.rows[0] || {
        total_media: 0,
        total_pictures: 0,
        total_videos: 0,
        total_likes: 0,
        total_shares: 0
      };
    } catch (error) {
      logger.error('Error getting user media stats:', error);
      return {
        total_media: 0,
        total_pictures: 0,
        total_videos: 0,
        total_likes: 0,
        total_shares: 0
      };
    }
  }

  /**
   * Get monthly top media contributor
   * @returns {Object} Top contributor data
   */
  static async getMonthlyTopMediaContributor() {
    try {
      const query = `
        SELECT 
          user_id,
          COUNT(*) as media_count,
          SUM(like_count) as total_likes
        FROM media_shares
        WHERE created_at >= DATE_TRUNC('month', NOW())
        GROUP BY user_id
        ORDER BY media_count DESC, total_likes DESC
        LIMIT 1
      `;
      
      const result = await getPool().query(query);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting monthly top contributor:', error);
      return null;
    }
  }

  /**
   * Create congratulatory message for most liked media
   * @param {Object} mediaData - Media data
   * @param {String} mediaType - Type of media (photo/video)
   * @param {String} lang - Language code
   * @returns {String} Formatted congratulatory message
   */
  static async createCongratulatoryMessage(mediaData, mediaType, lang = 'en') {
    if (!mediaData) return null;
    
    const user = await UserModel.getById(mediaData.user_id);
    if (!user) return null;
    
    const mediaTypeText = mediaType === 'photo' 
      ? (lang === 'es' ? 'foto' : 'picture')
      : (lang === 'es' ? 'video' : 'video');
    
    const username = user.username ? `@${user.username}` : user.firstName;
    const firstName = user.firstName || 'there';
    
    // Get user's chosen tribe, default to "Member" if not set
    const tribe = user.tribe || user.role || (lang === 'es' ? 'Miembro' : 'Member');
    
    // Determine reward based on achievement level
    const isDailyWinner = true;
    const dailyReward = lang === 'es' 
      ? 'un pase PRIME de 2 días'
      : 'a 2-day PRIME pass';
    
    const monthlyReward = lang === 'es' 
      ? 'una tarjeta de regalo de $50 USD'
      : 'a $50 USD gift card';
    
    // Create beautiful message with user's tribe
    const messages = {
      en: `🎉🎉🎉 CONGRATULATIONS ${username.toUpperCase()}! 🎉🎉🎉

🏆 You are the MOST POPULAR ${tribe.toUpperCase()} of the day! 🏆

Your ${mediaTypeText} in the PNP Wall of Fame has received an incredible 
💖 ${mediaData.like_count} reactions 💖 and 🔥 ${mediaData.share_count} shares 🔥!

This is AMAZING! 🎊 The community loves your content and we want to celebrate you!

🎁 YOUR REWARD: ${dailyReward}

Please contact @Santino to claim your well-deserved prize! He will set you up with your PRIME pass so you can enjoy all our premium features!

💎 Keep up the great work! If you maintain this level of engagement, you could be our MONTHLY TOP ${tribe.toUpperCase()} and win ${monthlyReward} as a token of our appreciation for your incredible support! 💎

🌟 You're making PNPtv an amazing community! Thank you for being awesome! 🌟

With love,
The PNPtv Team 💜`,
      
      es: `🎉🎉🎉 ¡FELICIDADES ${username.toUpperCase()}! 🎉🎉🎉

🏆 ¡Eres el/la ${tribe.toUpperCase()} MÁS POPULAR del día! 🏆

Tu ${mediaTypeText} en el Muro de la Fama de PNP ha recibido increíbles
💖 ${mediaData.like_count} reacciones 💖 y 🔥 ${mediaData.share_count} veces compartido 🔥!

¡Esto es INCREÍBLE! 🎊 ¡A la comunidad le encanta tu contenido y queremos celebrarte!

🎁 TU PREMIO: ${dailyReward}

Por favor contacta a @Santino para reclamar tu premio bien merecido. ¡Él te configurá con tu pase PRIME para que puedas disfrutar de todas nuestras funciones premium!

💎 ¡Sigue con el gran trabajo! Si mantienes este nivel de participación, podrías ser nuestro/a ${tribe.toUpperCase()} TOP DEL MES y ganar ${monthlyReward} como muestra de nuestro agradecimiento por tu increíble apoyo. 💎

🌟 ¡Estás haciendo de PNPtv una comunidad increíble! ¡Gracias por ser increíble! 🌟

Con cariño,
El Equipo de PNPtv 💜`
    };
    
    return messages[lang] || messages.en;
  }

  /**
   * Create top sharer congratulatory message
   * @param {Object} userData - User data with stats
   * @param {String} lang - Language code
   * @returns {String} Formatted congratulatory message
   */
  static async createTopSharerMessage(userData, lang = 'en') {
    if (!userData) return null;
    
    const user = await UserModel.getById(userData.user_id);
    if (!user) return null;
    
    const username = user.username ? `@${user.username}` : user.firstName;
    const firstName = user.firstName || 'there';
    
    // Get user's chosen tribe, default to "Member" if not set
    const tribe = user.tribe || user.role || (lang === 'es' ? 'Miembro' : 'Member');
    
    const messages = {
      en: `🎉🎉🎉 CONGRATULATIONS ${username.toUpperCase()}! 🎉🎉🎉

🏆 You are the TOP PICTURE SHARER of the week! 🏆

You've shared an amazing ${userData.picture_count} pictures this week, receiving ${userData.total_likes} likes in total! 💖

This is incredible! 🎊 Your contributions make our community vibrant and exciting!

🎁 YOUR REWARD: A 2-day PRIME pass

Please contact @Santino to claim your prize! Enjoy all our premium features!

💎 Keep up this amazing streak! If you continue sharing great content, you could be our MONTHLY TOP ${tribe.toUpperCase()} and win a $50 USD gift card! 💎

🌟 Thank you for making PNPtv awesome! 🌟

With love,
The PNPtv Team 💜`,
      
      es: `🎉🎉🎉 ¡FELICIDADES ${username.toUpperCase()}! 🎉🎉🎉

🏆 ¡Eres el MEJOR COMPARTIDOR DE FOTOS de la semana! 🏆

¡Has compartido ${userData.picture_count} fotos esta semana, recibiendo ${userData.total_likes} likes en total! 💖

¡Esto es increíble! 🎊 ¡Tus contribuciones hacen que nuestra comunidad sea vibrante y emocionante!

🎁 TU PREMIO: Un pase PRIME de 2 días

Por favor contacta a @Santino para reclamar tu premio. ¡Disfruta de todas nuestras funciones premium!

💎 ¡Mantén esta increíble racha! Si continúas compartiendo gran contenido, podrías ser nuestro ${tribe.toUpperCase()} TOP DEL MES y ganar una tarjeta de regalo de $50 USD. 💎

🌟 ¡Gracias por hacer de PNPtv algo increíble! 🌟

Con cariño,
El Equipo de PNPtv 💜`
    };
    
    return messages[lang] || messages.en;
  }

  /**
   * Create monthly top contributor message
   * @param {Object} userData - User data with stats
   * @param {String} lang - Language code
   * @returns {String} Formatted congratulatory message
   */
  static async createMonthlyTopContributorMessage(userData, lang = 'en') {
    if (!userData) return null;
    
    const user = await UserModel.getById(userData.user_id);
    if (!user) return null;
    
    const username = user.username ? `@${user.username}` : user.firstName;
    const firstName = user.firstName || 'there';
    
    // Get user's chosen tribe, default to "Member" if not set
    const tribe = user.tribe || user.role || (lang === 'es' ? 'Miembro' : 'Member');
    
    const messages = {
      en: `🎉🎉🎉 CONGRATULATIONS ${username.toUpperCase()}! 🎉🎉🎉

🏆🏆🏆 YOU ARE THE MONTHLY TOP ${tribe.toUpperCase()}! 🏆🏆🏆

WOW! 🎊 You've shared ${userData.media_count} pieces of content this month, receiving an incredible ${userData.total_likes} likes! 💖

Your dedication and amazing content have made you our STAR ${tribe.toUpperCase()}! The PNPtv community loves you!

🎁 YOUR GRAND PRIZE: A $50 USD GIFT CARD!

Please contact @Santino to claim your well-deserved reward! This is our way of saying THANK YOU for making PNPtv an amazing community!

💎 You're truly a VIP ${tribe}! Keep up the fantastic work and enjoy your premium status! 💎

🌟 We appreciate you more than words can express! Thank you for being AWESOME! 🌟

With love and gratitude,
The PNPtv Team 💜`,
      
      es: `🎉🎉🎉 ¡FELICIDADES ${username.toUpperCase()}! 🎉🎉🎉

🏆🏆🏆 ¡ERES EL/LA ${tribe.toUpperCase()} TOP DEL MES! 🏆🏆🏆

¡WOW! 🎊 ¡Has compartido ${userData.media_count} piezas de contenido este mes, recibiendo ${userData.total_likes} likes! 💖

¡Tu dedicación y contenido increíble te han convertido en nuestro/a ${tribe.toUpperCase()} ESTRELLA! ¡La comunidad de PNPtv te adora!

🎁 TU GRAN PREMIO: ¡Una tarjeta de regalo de $50 USD!

Por favor contacta a @Santino para reclamar tu recompensa bien merecida. ¡Esta es nuestra forma de decirte GRACIAS por hacer de PNPtv una comunidad increíble!

💎 ¡Eres verdaderamente un/a ${tribe} VIP! ¡Sigue con el trabajo fantástico y disfruta de tu estatus premium! 💎

🌟 ¡Te apreciamos más de lo que las palabras pueden expresar! ¡Gracias por ser INCREÍBLE! 🌟

Con amor y gratitud,
El Equipo de PNPtv 💜`
    };
    
    return messages[lang] || messages.en;
  }

  /**
   * Broadcast congratulatory message to group
   * @param {Object} ctx - Telegraf context
   * @param {String} message - Congratulatory message
   * @param {String} groupId - Group ID to send to
   */
  static async broadcastCongratulatoryMessage(ctx, message, groupId) {
    try {
      // Add fancy formatting
      const formattedMessage = `🎊🎊🎊 PNPtv CELEBRATION 🎊🎊🎊\n\n${message}`;
      
      await ctx.telegram.sendMessage(groupId, formattedMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      
      logger.info('Congratulatory message broadcasted successfully');
      return true;
    } catch (error) {
      logger.error('Error broadcasting congratulatory message:', error);
      return false;
    }
  }

  /**
   * Automated daily winner announcement
   * @param {Object} bot - Bot instance
   * @param {String} groupId - Group ID for announcements
   */
  static async announceDailyWinners(bot, groupId) {
    try {
      // Get most liked picture of the day
      const topPicture = await this.getMostLikedPictureOfTheDay();
      const topVideo = await this.getMostLikedVideoOfTheDay();
      
      // Create messages
      let pictureMessage = null;
      let videoMessage = null;
      
      if (topPicture) {
        pictureMessage = await this.createCongratulatoryMessage(topPicture, 'photo', 'en');
      }
      
      if (topVideo) {
        videoMessage = await this.createCongratulatoryMessage(topVideo, 'video', 'en');
      }
      
      // Broadcast messages
      if (pictureMessage) {
        await this.broadcastCongratulatoryMessage({ telegram: bot.telegram }, pictureMessage, groupId);
      }
      
      if (videoMessage) {
        await this.broadcastCongratulatoryMessage({ telegram: bot.telegram }, videoMessage, groupId);
      }
      
      return true;
    } catch (error) {
      logger.error('Error in daily winner announcement:', error);
      return false;
    }
  }

  /**
   * Automated weekly top sharer announcement
   * @param {Object} bot - Bot instance
   * @param {String} groupId - Group ID for announcements
   */
  static async announceWeeklyTopSharers(bot, groupId) {
    try {
      const topSharers = await this.getTopPictureSharersThisWeek(3);
      
      for (const sharer of topSharers) {
        const message = await this.createTopSharerMessage(sharer, 'en');
        if (message) {
          await this.broadcastCongratulatoryMessage({ telegram: bot.telegram }, message, groupId);
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Error in weekly top sharer announcement:', error);
      return false;
    }
  }

  /**
   * Automated monthly top contributor announcement
   * @param {Object} bot - Bot instance
   * @param {String} groupId - Group ID for announcements
   */
  static async announceMonthlyTopContributor(bot, groupId) {
    try {
      const topContributor = await this.getMonthlyTopMediaContributor();
      
      if (topContributor) {
        const message = await this.createMonthlyTopContributorMessage(topContributor, 'en');
        if (message) {
          await this.broadcastCongratulatoryMessage({ telegram: bot.telegram }, message, groupId);
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Error in monthly top contributor announcement:', error);
      return false;
    }
  }
}

module.exports = MediaPopularityService;
