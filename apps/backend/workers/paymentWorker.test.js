const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const PaymentWorker = require('./paymentWorker');

// Minimal fake redis client with brPop behavior
class FakeRedisWorker {
  constructor() {
    this.lists = new Map();
    this.store = new Map();
    this._blocked = [];
  }
  async connect() { return; }
  on() { }
  async lPush(key, value) {
    const arr = this.lists.get(key) || [];
    arr.unshift(value);
    this.lists.set(key, arr);
    // resolve any blocked brPop callers
    if (this._blocked.length) {
      const cb = this._blocked.shift();
      cb();
    }
    return arr.length;
  }
  async brPop(key, timeout) {
    const arr = this.lists.get(key) || [];
    if (arr.length) {
      const element = arr.pop();
      return { key, element };
    }

    // wait until lPush called
    await new Promise((resolve) => this._blocked.push(resolve));
    const arr2 = this.lists.get(key) || [];
    const element = arr2.pop();
    return { key, element };
  }
  async set(key, value) { this.store.set(key, value); return 'OK'; }
  async get(key) { return this.store.get(key) || null; }
  async quit() {}
}

jest.mock('redis', () => ({ createClient: () => new FakeRedisWorker() }));

describe('PaymentWorker', () => {
  let worker;
  let mockAxios;

  beforeAll(() => {
    mockAxios = new MockAdapter(axios);
    worker = new PaymentWorker();
  });

  afterAll(async () => {
    await worker.stop();
    mockAxios.restore();
  });

  test('processes a successful payment task', async () => {
    const payload = JSON.stringify({ taskId: 't1', userId: 'u1', amount: 10, currency: 'USD', paymentMethod: 'card' });
    // mock response
    mockAxios.onPost(/payments/).reply(200, { success: true, transactionId: 'tx-1' });

    await worker.redisClient.lPush('payment_tasks', payload);

    // allow worker to process
    await new Promise((r) => setTimeout(r, 300));

    const status = await worker.redisClient.get('task:t1:status');
    expect(status).toBe('completed');
  }, 10000);

  test('marks task failed on payment error', async () => {
    const payload = JSON.stringify({ taskId: 't2', userId: 'u2', amount: 20, currency: 'USD', paymentMethod: 'invalid' });
    mockAxios.onPost(/payments/).reply(400, { success: false, error: 'invalid' });

    await worker.redisClient.lPush('payment_tasks', payload);
    await new Promise((r) => setTimeout(r, 300));

    const status = await worker.redisClient.get('task:t2:status');
    expect(status).toBe('failed');
  }, 10000);
});
