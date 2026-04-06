import dotenv from 'dotenv';
dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET || 'fl-system-secret-key-2026',
  PYTHON_SERVER_URL: process.env.PYTHON_SERVER_URL || 'http://localhost:5000',
};
