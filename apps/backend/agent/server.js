const express = require('express');
const crypto = require('crypto');
const { createClient } = require('redis');
const agentConfig = require('../../config/agent.config');
const { v4: uuidv4 } = require('uuid');

class AgentServer {
  constructor() {
    if (!process.env.AGENT_SHARED_SECRET) {
      throw new Error('FATAL: AGENT_SHARED_SECRET environment variable is not set.');
    }

    this.app = express();
    this.app.use(express.json());

    // Bearer token auth — all routes require AGENT_SHARED_SECRET
    this.app.use((req, res, next) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      const expected = process.env.AGENT_SHARED_SECRET;
      if (!token || token.length !== expected.length ||
          !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      next();
    });

    this.redisClient = createClient({
      url: `redis://${agentConfig.queue.host}:${agentConfig.queue.port}`,
      password: agentConfig.queue.password || undefined,
    });

    this.server = null;
    this.setupRedis();
    this.setupRoutes();
  }

  async setupRedis() {
    try {
      await this.redisClient.connect();
      this.redisClient.on('error', (err) => {
        // Keep simple logging here; apps using this class may hook into their logger
        // and handle reconnection policies externally
        // eslint-disable-next-line no-console
        console.error('Redis error (agent):', err);
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to connect to Redis (agent):', err);
      throw err;
    }
  }

  setupRoutes() {
    // Route to enqueue a payment task
    this.app.post('/process-payment', async (req, res) => {
      const { userId, amount, currency, paymentMethod } = req.body;
      if (!userId || !amount) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      const taskId = uuidv4();
      const payload = { taskId, userId, amount, currency, paymentMethod };

      try {
        await this.redisClient.lPush('payment_tasks', JSON.stringify(payload));
        // set initial status
        await this.redisClient.set(`task:${taskId}:status`, 'queued');

        return res.status(200).json({ success: true, taskId, message: 'Tarea encolada' });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error al encolar tarea:', error);
        return res.status(500).json({ success: false, error: 'internal_error' });
      }
    });

    // Route to query task status
    this.app.get('/task-status/:taskId', async (req, res) => {
      const { taskId } = req.params;
      try {
        const status = await this.redisClient.get(`task:${taskId}:status`);
        return res.status(200).json({ taskId, status: status || null });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error reading task status:', error);
        return res.status(500).json({ success: false, error: 'internal_error' });
      }
    });
  }

  start() {
    this.server = this.app.listen(agentConfig.port, () => {
      // eslint-disable-next-line no-console
      console.log(`AgentServer listening on port ${agentConfig.port}`);
    });
  }

  async stop() {
    if (this.server) {
      this.server.close();
    }
    try {
      await this.redisClient.quit();
    } catch (err) {
      // ignore
    }
  }
}

module.exports = AgentServer;
