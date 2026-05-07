// backend/src/websocket/socketHandler.js
const emitter = require('./eventEmitter');
const { WS_EVENTS } = require('../config/constants');

function setupWebSocket(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

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

  // Fired by federatedOrchestrator when a job begins
  emitter.on(WS_EVENTS.TRAINING_STARTING, (data) => {
    console.log('[WS] training:starting →', data.jobId);
    io.emit(WS_EVENTS.TRAINING_STARTING, data);
  });

  // Fired at the start of every round — triggers local training on each node
  emitter.on(WS_EVENTS.ROUND_STARTED, (data) => {
    console.log(`[WS] round:started → round ${data.round}/${data.totalRounds}`);
    io.emit(WS_EVENTS.ROUND_STARTED, data);
  });

  // Fired each time a node submits its masked weights
  emitter.on(WS_EVENTS.WEIGHTS_SUBMITTED, (data) => {
    console.log(`[WS] weights:submitted → ${data.companyId} (${data.received}/${data.expected})`);
    io.emit(WS_EVENTS.WEIGHTS_SUBMITTED, data);
  });

  // Fired after meta-aggregation completes each round
  emitter.on('round:aggregated', (data) => {
    console.log(`[WS] round:aggregated → round ${data.round} acc=${(data.globalAccuracy * 100).toFixed(1)}%`);
    io.emit('round:aggregated', data);
  });

  // Fired when all rounds are done
  emitter.on(WS_EVENTS.TRAINING_COMPLETE, (data) => {
    console.log('[WS] training:complete →', data.jobId);
    io.emit(WS_EVENTS.TRAINING_COMPLETE, data);
  });

  // Fired when the queue changes (join / leave)
  emitter.on(WS_EVENTS.QUEUE_UPDATED, (data) => {
    io.emit(WS_EVENTS.QUEUE_UPDATED, data);
  });

  // ── Legacy session-scoped events (kept for backwards compatibility) ─────────
  emitter.on('training-update', (data) => {
    io.to(`session-${data.sessionId}`).emit('training-update', data);
  });

  emitter.on('queue-update', (data) => {
    io.emit('queue-update', data);
  });

  emitter.on('client-update', (data) => {
    io.to(`session-${data.sessionId}`).emit('client-update', data);
  });

  emitter.on('aggregation-complete', (data) => {
    io.to(`session-${data.sessionId}`).emit('aggregation-complete', data);
  });
}

module.exports = setupWebSocket;
