const { createClient } = require('redis');
const workerConfig = require('../../config/worker.config');
const paymentConfig = require('../../config/payment.config');
const axios = require('axios');

class PaymentWorker {
  constructor() {
    this.redisClient = createClient({
      url: `redis://${workerConfig.queue.host}:${workerConfig.queue.port}`,
      password: workerConfig.queue.password || undefined,
    });

    this.running = false;
    this.setup();
  }

  async setup() {
    try {
      await this.redisClient.connect();
      // start processing tasks
      this.running = true;
      this.processTasks();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Worker failed to connect to Redis:', err);
      throw err;
    }
  }

  async processTasks() {
    while (this.running) {
      try {
        // brPop returns { key, element } in redis v4 client
        const task = await this.redisClient.brPop('payment_tasks', 0);
        if (!task || !task.element) {
          continue; // no element
        }

        const payload = JSON.parse(task.element);
        const { taskId, userId, amount, currency, paymentMethod } = payload;

        // update status
        await this.redisClient.set(`task:${taskId}:status`, 'processing');

        // process payment (example with Daimo)
        const response = await this.processPaymentWithDaimo(userId, amount, currency, paymentMethod);

        await this.redisClient.set(
          `task:${taskId}:status`,
          response.success ? 'completed' : 'failed'
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error processing payment task:', err);
        // brief sleep to avoid busy loop on repeated errors
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  async processPaymentWithDaimo(userId, amount, currency, paymentMethod) {
    try {
      const resp = await axios.post(
        `${paymentConfig.daimoPayments.endpoint}/payments`,
        { userId, amount, currency, paymentMethod },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${paymentConfig.daimoPayments.apiKey}`,
          },
          timeout: 15000,
        }
      );

      return { success: true, data: resp.data };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Daimo payment error:', err.response?.data || err.message);
      return { success: false, error: err.message };
    }
  }

  async stop() {
    this.running = false;
    try {
      await this.redisClient.quit();
    } catch (err) {
      // ignore
    }
  }
}

module.exports = PaymentWorker;
