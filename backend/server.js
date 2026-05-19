// backend/server.js
// ─────────────────────────────────────────────────────────────────────────────
// THE FIX: socket.io was never initialized in the old version.
// This file creates a proper HTTP server, attaches socket.io,
// calls setupWebSocket(io), and starts the queue polling loop.
//
// ── FIX: Railway WebSocket keepalive ─────────────────────────────────────────
// Railway's load balancer has a ~60-second idle TCP timeout that is independent
// of Socket.IO's own ping mechanism.  During a long training round (model.fit
// on 5000 rows taks 30-90 s) no application-level messages are exchanged, so
// Railway sees an idle connection and silently closes it.  Socket.IO's client
// auto-reconnects, but the new socket session loses any in-flight training
// state (lastSubmittedRoundRef resets to 0, pendingRoundRef may get cleared).
//
// Two-layer fix:
//   1. HTTP keepAliveTimeout set to 75 s (above Railway's ~60 s TCP timeout)
//      so the underlying TCP connection is never considered idle long enough
//      for Railway to drop it.
//   2. Socket.IO pingInterval lowered to 10 s so an application-level ping
//      frame crosses the wire well within Railway's idle window even if the
//      HTTP keepalive alone isn't sufficient.
//   3. pingTimeout raised to 30 s so a temporarily slow client isn't evicted
//      just because it took a moment to respond to the ping during training.
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

// ── Railway keepalive: keep the underlying TCP connection alive ───────────────
// Railway's load balancer drops idle connections after ~60 s.
// Setting keepAliveTimeout above that threshold (75 s) prevents the drop.
// headersTimeout must always be > keepAliveTimeout.
server.keepAliveTimeout = 75000;   // 75 s  (above Railway's ~60 s idle timeout)
server.headersTimeout   = 80000;   // 80 s  (must be > keepAliveTimeout)

// 2. Attach socket.io with permissive CORS (frontend is on a different domain)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Allow both WebSocket and HTTP long-polling
  transports: ['websocket', 'polling'],

  // ── Socket.IO-level keepalive ──────────────────────────────────────────────
  // pingInterval: how often Socket.IO sends a ping frame to the client.
  // Lowered to 10 s so a ping always crosses the wire well within Railway's
  // idle window, even when no application messages are being sent (e.g. during
  // model.fit).
  pingInterval: 10000,   // 10 s  (was 25 s)

  // pingTimeout: how long to wait for the client's pong before disconnecting.
  // 30 s gives a training-busy browser tab enough time to respond without
  // being evicted mid-round.
  pingTimeout: 30000,    // 30 s  (was 120 s — unnecessarily long)
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
