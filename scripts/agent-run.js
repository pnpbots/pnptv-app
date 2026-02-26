#!/usr/bin/env node

const AgentServer = require('../src/agent/server');
const PaymentWorker = require('../src/workers/paymentWorker');
const workerConfig = require('../config/worker.config');

async function main() {
  const agent = new AgentServer();
  // give Redis a moment to connect
  setTimeout(() => agent.start(), 500);

  const workers = [];
  for (let i = 0; i < workerConfig.workerCount; i += 1) {
    const w = new PaymentWorker();
    workers.push(w);
    // small stagger
  }

  // graceful shutdown
  process.once('SIGINT', async () => {
    // eslint-disable-next-line no-console
    console.log('Shutting down agent and workers...');
    await Promise.all(workers.map((w) => w.stop()));
    await agent.stop();
    process.exit(0);
  });
}

main();
