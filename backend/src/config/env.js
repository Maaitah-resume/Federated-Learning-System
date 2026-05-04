require('dotenv').config();

const env = {
  NODE_ENV:           process.env.NODE_ENV           || 'development',
  PORT:               process.env.PORT               || 3000,
  MONGODB_URI:        process.env.MONGODB_URI,
  JWT_SECRET:         process.env.JWT_SECRET         || 'fl-system-secret-key-2026',
  PYTHON_SERVER_URL:  process.env.PYTHON_SERVER_URL  || 'http://localhost:5000',
};

const MIN_CLIENTS           = parseInt(process.env.MIN_CLIENTS           || '3',  10);
const DEFAULT_ROUNDS        = parseInt(process.env.DEFAULT_ROUNDS        || '10', 10);
const ROUND_TIMEOUT_MINUTES = parseInt(process.env.ROUND_TIMEOUT_MINUTES || '5',  10);

module.exports = {
  env,
  MIN_CLIENTS,
  DEFAULT_ROUNDS,
  ROUND_TIMEOUT_MINUTES,
};
