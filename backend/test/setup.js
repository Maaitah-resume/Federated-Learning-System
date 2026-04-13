const BASE = process.env.BASE_URL || 'http://localhost:4000';

const COMPANIES = {
  alpha: { token: null },
  beta:  { token: null },
  gamma: { token: null },
};

async function request(method, path, body = null, token = null) {
  const url = `${BASE}${path}`;
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  return { status: res.status, body: data };
}

async function post(path, body = {}, token = null) {
  const result = await request('POST', path, body, token);

  // If this is the demo seed endpoint, attempt to pre-login demo companies
  if (path === '/api/demo/seed' && result.status === 200) {
    await Promise.all([
      loginCompanyByEmail('alpha@demo.com', 'demo', COMPANIES.alpha),
      loginCompanyByEmail('beta@demo.com', 'demo', COMPANIES.beta),
      loginCompanyByEmail('gamma@demo.com', 'demo', COMPANIES.gamma),
    ]).catch(() => {});
  }

  return result;
}

async function get(path, token = null) {
  return request('GET', path, null, token);
}

async function loginCompanyByEmail(email, password, targetObj) {
  try {
    const res = await request('POST', '/api/auth/login', { email, password });
    if (res && res.status === 200 && res.body && res.body.token) {
      targetObj.token = res.body.token;
    }
  } catch (e) {
    // ignore
  }
}

// Simple test runner helpers
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
    failed++;
    throw err;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${a} === ${b}`);
}

async function seedDemoCompanies() {
  return post('/api/demo/seed', {});
}

function summary() {
  console.log('\nTest summary:', passed, 'passed,', failed, 'failed');
}

module.exports = {
  post,
  get,
  test,
  assert,
  assertEqual,
  seedDemoCompanies,
  COMPANIES,
  summary,
};
