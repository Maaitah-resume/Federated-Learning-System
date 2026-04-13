// Lightweight server launcher for local development/tests
const app = require('./src/app');
const { env } = require('./src/config/env');

const PORT = env.PORT || 4000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
