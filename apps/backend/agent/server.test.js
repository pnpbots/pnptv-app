const request = require('supertest');
const AgentServer = require('./server');

// Minimal in-memory fake Redis client used to mock redis.createClient
class FakeRedis {
  constructor() {
    this.store = new Map();
    this.lists = new Map();
    this.closed = false;
  }
  async connect() { return; }
  on() { }
  async lPush(key, value) {
    const arr = this.lists.get(key) || [];
    arr.unshift(value);
    this.lists.set(key, arr);
    return arr.length;
  }
  async lRange(key, start, end) {
    const arr = this.lists.get(key) || [];
    return arr.slice(start, end + 1);
  }
  async set(key, value) { this.store.set(key, value); return 'OK'; }
  async get(key) { return this.store.get(key) || null; }
  async quit() { this.closed = true; }
}

// Mock the redis module used by server.js
jest.mock('redis', () => ({
  createClient: () => new FakeRedis(),
}));

describe('AgentServer', () => {
  let agent;

  beforeAll(async () => {
    agent = new AgentServer();
    // don't actually start network listener for faster tests
  });

  afterAll(async () => {
    await agent.stop();
  });

  test('should enqueue a payment task', async () => {
    const res = await request(agent.app)
      .post('/process-payment')
      .send({ userId: 'u1', amount: 10, currency: 'USD', paymentMethod: 'card' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.taskId).toBeDefined();

    // check stored queue
    const items = await agent.redisClient.lRange('payment_tasks', 0, -1);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  test('should return task status', async () => {
    const taskId = 'status-test-1';
    await agent.redisClient.set(`task:${taskId}:status`, 'completed');

    const res = await request(agent.app).get(`/task-status/${taskId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });
});
