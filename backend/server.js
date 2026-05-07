// backend/server.js
// ─────────────────────────────────────────────────────────────────────────────
// THE FIX: socket.io was never initialized in the old version.
// This file creates a proper HTTP server, attaches socket.io,
// calls setupWebSocket(io), and starts the queue polling loop.
// ─────────────────────────────────────────────────────────────────────────────

const http           = require('http');
const { Server }     = require('socket.io');
const app            = require('./src/app');
const { env }        = require('./src/config/env');
const { connectDB }  = require('./src/config/db');
const setupWebSocket = require('./src/websocket/socketHandler');
const queueService   = require('./src/services/queueService');

const PORT = env.PORT || 4000;

// 1. Wrap Express in a real HTTP server so socket.io can attach to it
const server = http.createServer(app);

// 2. Attach socket.io with permissive CORS (frontend is on a different domain)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Allow both WebSocket and HTTP long-polling
  pingInterval: 25000,
  pingTimeout:  120000,
  transports: ['websocket', 'polling'],
});

// 3. Wire up all WebSocket event handlers (round:started, weights:submitted, etc.)
setupWebSocket(io);

// 4. Connect to MongoDB, then start listening
connectDB()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend listening on http://localhost:${PORT}`);

      // 5. Start the queue polling loop (checks threshold every 5s)
      queueService.startPolling();
      console.log('[Queue] Polling started');
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
