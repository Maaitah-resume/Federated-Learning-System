// Lightweight server launcher for local development/tests
const app = require('./src/app');
const { env } = require('./src/config/env');
const { connectDB } = require('./src/config/db');

const PORT = env.PORT || 4000;

connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
