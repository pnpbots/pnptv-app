/**
 * Room WebSocket Handler
 * Handles WebSocket connections for real-time room updates
 *
 * Routes:
 * - ws://localhost/ws/rooms - Connect to room updates
 * - Message format: { action, roomId, userId }
 */

const WebSocket = require('ws');
const logger = require('../../utils/logger');
const roomWebSocketService = require('../../services/websocket/roomWebSocketService');
// (resolveTelegramUser was destructured here but never called and the source
//  module doesn't export it — removing the dead import.)
const { getRedis } = require('../../config/redis');
const { query } = require('../../config/postgres');

/**
 * Setup WebSocket server for room updates
 * @param {http.Server} server - HTTP server instance
 */
function setupRoomWebSocketServer(server) {
  const wss = new WebSocket.Server({
    server,
    path: '/ws/rooms',
    perMessageDeflate: false,
  });

  wss.on('connection', (socket, request) => {
    handleWebSocketConnection(socket, request);
  });

  wss.on('error', (error) => {
    logger.error('WebSocket server error:', error);
  });

  logger.info('WebSocket server initialized at /ws/rooms');

  return wss;
}

/**
 * Handle new WebSocket connection
 * @param {WebSocket} socket - WebSocket connection
 * @param {http.IncomingMessage} request - HTTP request
 */
async function handleWebSocketConnection(socket, request) {
  try {
    // Authenticate via session cookie — do NOT trust userId from query string
    const cookieHeader = request.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)__pnptv_sid=([^;]+)/);
    if (!match) {
      logger.warn('WebSocket /ws/rooms: no session cookie', { ip: request.socket.remoteAddress });
      socket.close(1008, 'Unauthorized');
      return;
    }

    const raw = decodeURIComponent(match[1]);
    const sid = raw.startsWith('s:') ? raw.slice(2).split('.')[0] : raw.split('.')[0];

    const redis = getRedis();
    const sessionData = await redis.get(`sess:${sid}`);
    if (!sessionData) {
      logger.warn('WebSocket /ws/rooms: invalid or expired session', { ip: request.socket.remoteAddress });
      socket.close(1008, 'Unauthorized');
      return;
    }

    const session = JSON.parse(sessionData);
    const sessionUser = session?.user;
    if (!sessionUser || !sessionUser.id) {
      logger.warn('WebSocket /ws/rooms: session has no user', { ip: request.socket.remoteAddress });
      socket.close(1008, 'Unauthorized');
      return;
    }

    const userId = String(sessionUser.id);
    logger.info('WebSocket client connected', { userId, ip: request.socket.remoteAddress });

    // Handle incoming messages
    socket.on('message', (data) => {
      handleWebSocketMessage(socket, userId, data);
    });

    // Send initial connection confirmation
    socket.send(JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      userId,
      timestamp: new Date().toISOString(),
      message: 'Connected to room updates',
    }));
  } catch (error) {
    logger.error('Error handling WebSocket connection:', error);
    socket.close(1011, 'Internal server error');
  }
}

/**
 * Handle WebSocket message
 * @param {WebSocket} socket - WebSocket connection
 * @param {string} userId - User ID
 * @param {string} data - Message data
 */
async function handleWebSocketMessage(socket, userId, data) {
  try {
    if (data.length > 64 * 1024) {
      logger.warn('WebSocket /ws/rooms: oversized message rejected', { userId, size: data.length });
      socket.close(1009, 'Message too large');
      return;
    }
    const message = JSON.parse(data);
    const { action, roomId } = message;

    logger.debug('WebSocket message received', { userId, action, roomId });

    switch (action) {
      case 'JOIN_ROOM':
        await handleRoomJoin(socket, userId, roomId);
        break;

      case 'LEAVE_ROOM':
        handleRoomLeave(socket, userId, roomId);
        break;

      case 'PING':
        socket.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        break;

      case 'GET_ROOM_STATUS':
        handleGetRoomStatus(socket, roomId);
        break;

      default:
        logger.warn('Unknown WebSocket action:', { action });
        socket.send(JSON.stringify({
          type: 'ERROR',
          error: 'Unknown action',
          action,
        }));
    }
  } catch (error) {
    logger.error('Error handling WebSocket message:', error);
    socket.send(JSON.stringify({
      type: 'ERROR',
      error: 'Message processing error',
    }));
  }
}

/**
 * Handle room join
 * @param {WebSocket} socket - WebSocket connection
 * @param {string} userId - User ID
 * @param {number} roomId - Room ID
 */
async function handleRoomJoin(socket, userId, roomId) {
  // WS-CRIT-02: Verify the user is an active member of the requested hangout group
  // before granting access to the room's WebSocket updates.
  if (!roomId) {
    socket.send(JSON.stringify({ type: 'ERROR', error: 'roomId is required' }));
    return;
  }
  const parsedRoomId = parseInt(roomId, 10);
  if (!Number.isFinite(parsedRoomId)) {
    socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid roomId' }));
    return;
  }

  try {
    const membership = await query(
      `SELECT 1 FROM hangout_group_members
        WHERE group_id = $1 AND user_id = $2 AND (is_banned = false OR is_banned IS NULL)`,
      [parsedRoomId, userId]
    );
    if (membership.rows.length === 0) {
      logger.warn('WebSocket /ws/rooms JOIN_ROOM: access denied', { userId, roomId: parsedRoomId });
      socket.send(JSON.stringify({ type: 'ERROR', error: 'Access denied to this room' }));
      return;
    }
  } catch (err) {
    logger.error('WebSocket /ws/rooms JOIN_ROOM: membership check failed', { userId, roomId: parsedRoomId, error: err.message });
    socket.send(JSON.stringify({ type: 'ERROR', error: 'Unable to verify room membership' }));
    return;
  }

  const registered = roomWebSocketService.registerClient(parsedRoomId, userId, socket);

  if (registered) {
    socket.send(JSON.stringify({
      type: 'ROOM_JOINED',
      roomId: parsedRoomId,
      userId,
      timestamp: new Date().toISOString(),
      message: `Joined room ${parsedRoomId}`,
    }));

    logger.info('User joined room via WebSocket', { userId, roomId: parsedRoomId });
  } else {
    socket.send(JSON.stringify({
      type: 'ERROR',
      error: 'Failed to join room',
      roomId: parsedRoomId,
    }));
  }
}

/**
 * Handle room leave
 * @param {WebSocket} socket - WebSocket connection
 * @param {string} userId - User ID
 * @param {number} roomId - Room ID
 */
function handleRoomLeave(socket, userId, roomId) {
  roomWebSocketService.unregisterClient(roomId, userId, socket);

  socket.send(JSON.stringify({
    type: 'ROOM_LEFT',
    roomId,
    userId,
    timestamp: new Date().toISOString(),
    message: `Left room ${roomId}`,
  }));

  logger.info('User left room via WebSocket', { userId, roomId });
}

/**
 * Handle get room status
 * @param {WebSocket} socket - WebSocket connection
 * @param {number} roomId - Room ID
 */
function handleGetRoomStatus(socket, roomId) {
  const clientCount = roomWebSocketService.getClientCount(roomId);

  socket.send(JSON.stringify({
    type: 'ROOM_STATUS',
    roomId,
    connectedClients: clientCount,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Broadcast room update via WebSocket
 * Called from MainRoomController when a user joins/leaves
 * @param {number} roomId - Room ID
 * @param {string} participantName - Participant name
 * @param {number} currentCount - Current participant count
 * @param {number} maxCount - Max participants
 * @param {string} eventType - Event type (join/leave)
 */
function broadcastRoomUpdate(roomId, participantName, currentCount, maxCount, eventType) {
  if (eventType === 'join') {
    roomWebSocketService.notifyParticipantJoin(roomId, participantName, currentCount, maxCount);
  } else if (eventType === 'leave') {
    roomWebSocketService.notifyParticipantLeave(roomId, participantName, currentCount, maxCount);
  }
}

module.exports = {
  setupRoomWebSocketServer,
  handleWebSocketConnection,
  handleWebSocketMessage,
  broadcastRoomUpdate,
  roomWebSocketService,
};
