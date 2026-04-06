/**
 * Events Controller
 * Handles scheduled Live Stream and Hangout events
 */

const EventModel = require('../../models/eventModel');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

// Only models/creators/admins can create live_stream events; anyone can create hangout_event
const LIVE_ROLES = ['model', 'creator', 'admin', 'superadmin'];

async function getUserRole(userId) {
  const result = await query(`SELECT role FROM users WHERE id = $1`, [String(userId)]);
  return result.rows[0]?.role || 'user';
}

const eventsController = {
  // POST /api/webapp/events
  async createEvent(req, res) {
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { type, title, description, coverImage, scheduledAt, durationMinutes, maxAttendees, hangoutGroupId, tags } = req.body;

    if (!type || !['live_stream', 'hangout_event'].includes(type)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }
    if (!title || title.trim().length < 3) {
      return res.status(400).json({ error: 'Title must be at least 3 characters' });
    }
    if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
      return res.status(400).json({ error: 'Invalid scheduled date' });
    }
    if (new Date(scheduledAt) < new Date()) {
      return res.status(400).json({ error: 'Event must be scheduled in the future' });
    }

    if (type === 'live_stream') {
      const role = await getUserRole(userId);
      if (!LIVE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Only models and creators can schedule live events' });
      }
    }

    const parsedDuration = parseInt(durationMinutes, 10) || 60;
    if (parsedDuration < 15 || parsedDuration > 2880) {
      return res.status(400).json({ error: 'Duration must be between 15 minutes and 48 hours' });
    }

    const event = await EventModel.create({
      creatorId: userId,
      type,
      title: title.trim(),
      description: description?.trim() || null,
      coverImage: coverImage || null,
      scheduledAt,
      durationMinutes: parsedDuration,
      maxAttendees: maxAttendees ? parseInt(maxAttendees, 10) : null,
      hangoutGroupId: hangoutGroupId || null,
      tags: Array.isArray(tags) ? tags : [],
    });

    logger.info(`Event created: ${event.id} (${event.type}) by ${userId}`);
    return res.status(201).json({ success: true, event });
  },

  // GET /api/proxy/events/upcoming
  async getUpcoming(req, res) {
    await EventModel.expirePastEvents();
    const { type, limit, hangout_group_id } = req.query;
    const viewerUserId = req.session?.user?.id || null;
    const events = await EventModel.getUpcoming({
      type: type || null,
      hangoutGroupId: hangout_group_id ? parseInt(hangout_group_id, 10) : null,
      limit: Math.min(parseInt(limit, 10) || 10, 50),
      viewerUserId,
    });
    return res.json({ success: true, events });
  },

  // GET /api/proxy/events/featured
  async getFeatured(req, res) {
    const viewerUserId = req.session?.user?.id || null;
    const events = await EventModel.getFeatured({ viewerUserId });
    return res.json({ success: true, events });
  },

  // GET /api/proxy/events/:id
  async getEvent(req, res) {
    const { id } = req.params;
    const viewerUserId = req.session?.user?.id || null;
    const event = await EventModel.getById(id, viewerUserId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    return res.json({ success: true, event });
  },

  // PUT /api/webapp/events/:id
  async updateEvent(req, res) {
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const { title, description, coverImage, scheduledAt, durationMinutes, maxAttendees, hangoutGroupId, tags, status } = req.body;

    if (scheduledAt && new Date(scheduledAt) < new Date()) {
      return res.status(400).json({ error: 'Scheduled date must be in the future' });
    }
    if (durationMinutes) {
      const parsedDur = parseInt(durationMinutes, 10);
      if (parsedDur < 15 || parsedDur > 2880) {
        return res.status(400).json({ error: 'Duration must be between 15 minutes and 48 hours' });
      }
    }

    const event = await EventModel.update(id, userId, {
      title: title?.trim(),
      description: description?.trim(),
      coverImage,
      scheduledAt,
      durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : undefined,
      maxAttendees: maxAttendees ? parseInt(maxAttendees, 10) : undefined,
      hangoutGroupId: hangoutGroupId !== undefined ? (hangoutGroupId ? parseInt(hangoutGroupId, 10) : null) : undefined,
      tags,
      status,
    });

    if (!event) return res.status(404).json({ error: 'Event not found or permission denied' });
    return res.json({ success: true, event });
  },

  // DELETE /api/webapp/events/:id
  async cancelEvent(req, res) {
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const cancelled = await EventModel.cancel(id, userId);
    if (!cancelled) return res.status(404).json({ error: 'Event not found, already cancelled, or permission denied' });
    return res.json({ success: true });
  },

  // POST /api/webapp/events/:id/rsvp
  async rsvpEvent(req, res) {
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const event = await EventModel.getById(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status !== 'upcoming') return res.status(400).json({ error: 'Cannot RSVP to a past or cancelled event' });
    if (event.maxAttendees && event.rsvpCount >= event.maxAttendees) {
      return res.status(400).json({ error: 'Event is full' });
    }

    const result = await EventModel.rsvp(id, userId);
    return res.json({ success: true, ...result });
  },

  // DELETE /api/webapp/events/:id/rsvp
  async unrsvpEvent(req, res) {
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const result = await EventModel.unrsvp(id, userId);
    return res.json({ success: true, ...result });
  },

  // GET /api/webapp/events/my-rsvps
  async myRsvps(req, res) {
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const events = await EventModel.getUserRsvps(userId);
    return res.json({ success: true, events });
  },

  // GET /api/webapp/events/mine
  async myEvents(req, res) {
    const userId = req.session?.user?.id || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const events = await EventModel.getByCreator(userId);
    return res.json({ success: true, events });
  },

  // PUT /api/webapp/admin/events/:id/feature  (admin only)
  async featureEvent(req, res) {
    const { id } = req.params;
    const { isFeatured } = req.body;
    await EventModel.setFeatured(id, !!isFeatured);
    return res.json({ success: true });
  },
};

module.exports = eventsController;
