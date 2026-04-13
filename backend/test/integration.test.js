// tests/integration.test.js
// Run: node tests/integration.test.js
// Tests the full user journey: seed → login → join queue → check state
// Does NOT require the Python FL service — tests only the Node layer.

const { post, get, test, assert, assertEqual, seedDemoCompanies, COMPANIES, summary } = require('./setup');

async function run() {
  console.log('\n── Integration — full demo flow ─────────────────────');

  // Step 1: seed
  await test('seed endpoint creates demo companies', async () => {
    const { status, body } = await post('/api/demo/seed', {});
    assertEqual(status, 200, 'status');
    assert(Array.isArray(body.seeded), 'seeded array present');
  });

  // Step 2: login via FL-IDS auth route
  let alphaToken;
  await test('alpha company can log in via /api/auth/login', async () => {
    const { status, body } = await post('/api/auth/login', {
      email:    'alpha@demo.com',
      password: 'demo',
    });
    assertEqual(status, 200, 'status');
    assert(body.token,   'token present');
    alphaToken = body.token;
  });

  // Step 3: /me returns the right company
  await test('/api/auth/me returns alpha identity', async () => {
    const { status, body } = await get('/api/auth/me', alphaToken);
    assertEqual(status, 200, 'status');
    assertEqual(body.company.id, 'alpha', 'company id');
  });

  // Step 4: queue is empty at start
  await test('queue starts empty or with known state', async () => {
    const { status, body } = await get('/api/queue', alphaToken);
    assertEqual(status, 200, 'status');
    assert(typeof body.count === 'number', 'count is number');
    assert(typeof body.minRequired === 'number', 'minRequired is number');
  });

  // Step 5: alpha joins queue
  await post('/api/queue/leave', {}, COMPANIES.alpha.token).catch(() => {});
  let alphaPosition;
  await test('alpha joins queue successfully', async () => {
    const { status, body } = await post('/api/queue/join', {}, alphaToken);
    assertEqual(status, 200, 'status');
    assert(body.joined, 'joined flag true');
    alphaPosition = body.position;
  });

  // Step 6: queue count increases
  await test('queue count is at least 1 after alpha joins', async () => {
    const { status, body } = await get('/api/queue', alphaToken);
    assertEqual(status, 200, 'status');
    assert(body.count >= 1, 'count >= 1');
  });

  // Step 7: alpha cannot join twice
  await test('alpha cannot join queue twice', async () => {
    const { status, body } = await post('/api/queue/join', {}, alphaToken);
    assertEqual(status, 409, 'status');
    assertEqual(body.error.code, 'ALREADY_QUEUED', 'error code');
  });

  // Step 8: beta and gamma also join
  await post('/api/queue/leave', {}, COMPANIES.beta.token).catch(() => {});
  await post('/api/queue/leave', {}, COMPANIES.gamma.token).catch(() => {});

  await test('beta joins queue', async () => {
    const { status } = await post('/api/queue/join', {}, COMPANIES.beta.token);
    assertEqual(status, 200, 'status');
  });

  await test('gamma joins queue', async () => {
    const { status } = await post('/api/queue/join', {}, COMPANIES.gamma.token);
    assertEqual(status, 200, 'status');
  });

  // Step 9: queue has 3 participants now
  await test('queue shows 3 participants after all join', async () => {
    const { status, body } = await get('/api/queue', alphaToken);
    assertEqual(status, 200, 'status');
    assert(body.count >= 3, `count >= 3 (got ${body.count})`);
  });

  // Step 10: alpha can leave
  await test('alpha can leave the queue', async () => {
    const { status, body } = await post('/api/queue/leave', {}, alphaToken);
    assertEqual(status, 200, 'status');
    assert(body.left, 'left flag true');
  });

  // Step 11: training history is accessible
  await test('training history returns array', async () => {
    const { status, body } = await get('/api/training/history', alphaToken);
    assertEqual(status, 200, 'status');
    assert(Array.isArray(body), 'body is array');
  });

  // Step 12: models list is accessible
  await test('models list returns array', async () => {
    const { status, body } = await get('/api/models', alphaToken);
    assertEqual(status, 200, 'status');
    assert(Array.isArray(body), 'body is array');
  });

  // Step 13: demo login (frontend format)
  await test('frontend-format login works end-to-end', async () => {
    const { status, body } = await post('/api/v1/auth/login', {
      username: 'beta',
      password: 'demo',
    });
    assertEqual(status, 200, 'status');
    assertEqual(body.status, 'success', 'body.status');
    assert(body.data.token.startsWith('demo-token-'), 'token format correct');
  });

  // Cleanup
  await post('/api/queue/leave', {}, COMPANIES.beta.token).catch(() => {});
  await post('/api/queue/leave', {}, COMPANIES.gamma.token).catch(() => {});

  summary();
}

run().catch((err) => {
  console.error('Integration test crashed:', err);
  process.exit(1);
});