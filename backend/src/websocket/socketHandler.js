// backend/src/websocket/socketHandler.js
//
// ── FIX: Scoped round:started replay ─────────────────────────────────────────
// Previously every newly connected WebSocket client received a replay of the
// current round:started event regardless of job membership.  Ammar connecting
// while Mohammad+Amer were on round 4 received that replay, set
// pendingRoundRef, and showed "Round 4 is waiting!" — even though Ammar was
// never in that job.
//
// Fix: decode companyId from the socket handshake auth token
// (format: "demo-token-<companyId>") and only replay the event if that
// companyId is in activeJob.participantIds.
//
// The frontend SocketContext.tsx now passes the token in socket auth:
//   io(url, { auth: { token: 'demo-token-<id>' } })
// so socket.handshake.auth.token is always available here.
// ─────────────────────────────────────────────────────────────────────────────

const emitter = require('./eventEmitter');
const { WS_EVENTS } = require('../config/constants');

/** Extract companyId from the demo-token in the socket handshake */
function getCompanyIdFromSocket(socket) {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || '').replace('Bearer ', '');

    if (token && token.startsWith('demo-token-')) {
      return token.replace('demo-token-', '').trim() || null;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function setupWebSocket(io) {
  io.on('connection', (socket) => {
    const companyId = getCompanyIdFromSocket(socket);
    console.log(`Client connected: ${socket.id} (${companyId || 'unknown'})`);

    // ── Replay current round ONLY to participants ─────────────────────────────
    try {
      const fedOrch       = require('../services/federatedOrchestrator');
      const activeJob     = fedOrch.getActiveJob();
      const globalWeights = fedOrch.getGlobalWeights();

      if (activeJob && activeJob.status === 'TRAINING') {
        const isParticipant = companyId && activeJob.participantIds.includes(companyId);

        if (isParticipant) {
          console.log(
            `[WS] Replaying round ${activeJob.currentRound} to participant ${companyId} (${socket.id})`
          );
          socket.emit(WS_EVENTS.ROUND_STARTED, {
            jobId:           activeJob.jobId,
            round:           activeJob.currentRound,
            totalRounds:     activeJob.totalRounds,
            globalWeights,
            adaptiveWeights: activeJob.adaptiveWeights || null,
          });
        } else {
          // Non-participant connecting during a job — intentionally no replay.
          // They will see their own idle waiting room.
          console.log(
            `[WS] ${socket.id} (${companyId || 'unknown'}) is NOT in job ${activeJob.jobId} — skipping replay`
          );
        }
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
      console.log(`Client disconnected: ${socket.id} (${companyId || 'unknown'})`);
    });
  });

  // ── Federated learning events → broadcast to ALL clients ──────────────────
  // Broadcasts are fine because Queue.tsx guards every handler with
  // inQueueRef.current — a user not in the job silently ignores them.
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

  emitter.on(WS_EVENTS.TRAINING_ERROR, (data) => {
    console.log('[WS] training:error →', data.jobId, data.message);
    io.emit(WS_EVENTS.TRAINING_ERROR, data);
  });

  emitter.on(WS_EVENTS.QUEUE_UPDATED, (data) => {
    io.emit(WS_EVENTS.QUEUE_UPDATED, data);
  });

  // ── Admin config broadcast ─────────────────────────────────────────────────
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
