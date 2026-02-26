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
const { resolveTelegramUser } = require('../services/telegramWebAppAuth');

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
function handleWebSocketConnection(socket, request) {
  try {
    // Extract userId from URL query params or auth header
    const url = new URL(request.url, `http://${request.headers.host}`);
    const userId = url.searchParams.get('userId');
    const token = url.searchParams.get('token');

    if (!userId) {
      logger.warn('WebSocket connection without userId');
      socket.close(1008, 'Missing userId');
      return;
    }

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
function handleWebSocketMessage(socket, userId, data) {
  try {
    const message = JSON.parse(data);
    const { action, roomId } = message;

    logger.debug('WebSocket message received', { userId, action, roomId });

    switch (action) {
      case 'JOIN_ROOM':
        handleRoomJoin(socket, userId, roomId);
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
function handleRoomJoin(socket, userId, roomId) {
  const registered = roomWebSocketService.registerClient(roomId, userId, socket);

  if (registered) {
    socket.send(JSON.stringify({
      type: 'ROOM_JOINED',
      roomId,
      userId,
      timestamp: new Date().toISOString(),
      message: `Joined room ${roomId}`,
    }));

    logger.info('User joined room via WebSocket', { userId, roomId });
  } else {
    socket.send(JSON.stringify({
      type: 'ERROR',
      error: 'Failed to join room',
      roomId,
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
