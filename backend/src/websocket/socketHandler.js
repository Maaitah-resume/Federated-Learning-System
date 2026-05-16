// backend/src/websocket/socketHandler.js
//
// FIX: Forward the 'config:updated' event emitted by admin.routes.js so that
// all connected browser clients can immediately refresh their minRequired
// display and queue threshold without waiting for the next 3-second poll.
//
const emitter = require('./eventEmitter');
const { WS_EVENTS } = require('../config/constants');

function setupWebSocket(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // ── Replay current round to clients that connect / reconnect late ─────────
    try {
      const fedOrch       = require('../services/federatedOrchestrator');
      const activeJob     = fedOrch.getActiveJob();
      const globalWeights = fedOrch.getGlobalWeights();

      if (activeJob && activeJob.status === 'TRAINING') {
        console.log(`[WS] Replaying round ${activeJob.currentRound} to late-joining client ${socket.id}`);
        socket.emit(WS_EVENTS.ROUND_STARTED, {
          jobId:           activeJob.jobId,
          round:           activeJob.currentRound,
          totalRounds:     activeJob.totalRounds,
          globalWeights,
          adaptiveWeights: activeJob.adaptiveWeights || null,
        });
      }
    } catch (err) {
      console.warn('[WS] Could not replay round state:', err.message);
    }

    socket.on('join-session', (sessionId) => {
      socket.join(`session-${sessionId}`);
      console.log(`Client ${socket.id} joined session ${sessionId}`);
    });

    socket.on('leave-session', (sessionId) => {
      socket.leave(`session-${sessionId}`);
      console.log(`Client ${socket.id} left session ${sessionId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // ── Federated learning events → broadcast to ALL clients ──────────────────

  emitter.on(WS_EVENTS.TRAINING_STARTING, (data) => {
    console.log('[WS] training:starting →', data.jobId);
    io.emit(WS_EVENTS.TRAINING_STARTING, data);
  });

  emitter.on(WS_EVENTS.ROUND_STARTED, (data) => {
    console.log(`[WS] round:started → round ${data.round}/${data.totalRounds}`);
    io.emit(WS_EVENTS.ROUND_STARTED, data);
  });

  emitter.on(WS_EVENTS.WEIGHTS_SUBMITTED, (data) => {
    console.log(`[WS] weights:submitted → ${data.companyId} (${data.received}/${data.expected})`);
    io.emit(WS_EVENTS.WEIGHTS_SUBMITTED, data);
  });

  emitter.on('round:aggregated', (data) => {
    console.log(`[WS] round:aggregated → round ${data.round} acc=${(data.globalAccuracy * 100).toFixed(1)}%`);
    io.emit('round:aggregated', data);
  });

  emitter.on(WS_EVENTS.TRAINING_COMPLETE, (data) => {
    console.log('[WS] training:complete →', data.jobId);
    io.emit(WS_EVENTS.TRAINING_COMPLETE, data);
  });

  emitter.on(WS_EVENTS.QUEUE_UPDATED, (data) => {
    io.emit(WS_EVENTS.QUEUE_UPDATED, data);
  });

  // ── Admin config broadcast ─────────────────────────────────────────────────
  // Lets the Queue page refresh minRequired immediately after an admin saves.
  emitter.on('config:updated', (data) => {
    console.log('[WS] config:updated → MIN_CLIENTS=' + data.config?.MIN_CLIENTS);
    io.emit('config:updated', data);
  });

  // ── Legacy session-scoped events ───────────────────────────────────────────
  emitter.on('training-update',      (data) => { io.to(`session-${data.sessionId}`).emit('training-update', data); });
  emitter.on('queue-update',         (data) => { io.emit('queue-update', data); });
  emitter.on('client-update',        (data) => { io.to(`session-${data.sessionId}`).emit('client-update', data); });
  emitter.on('aggregation-complete', (data) => { io.to(`session-${data.sessionId}`).emit('aggregation-complete', data); });
}

module.exports = setupWebSocket;
