// backend/src/websocket/socketHandler.js
const trainingEvents = require('./eventEmitter');

function setupWebSocket(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join a training session room
    socket.on('join-session', (sessionId) => {
      socket.join(`session-${sessionId}`);
      console.log(`Client ${socket.id} joined session ${sessionId}`);
    });

    // Leave a training session room
    socket.on('leave-session', (sessionId) => {
      socket.leave(`session-${sessionId}`);
      console.log(`Client ${socket.id} left session ${sessionId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // Listen to training events and broadcast via WebSocket
  trainingEvents.on('training-update', (data) => {
    io.to(`session-${data.sessionId}`).emit('training-update', data);
  });

  trainingEvents.on('queue-update', (data) => {
    io.emit('queue-update', data);
  });

  trainingEvents.on('client-update', (data) => {
    io.to(`session-${data.sessionId}`).emit('client-update', data);
  });

  trainingEvents.on('aggregation-complete', (data) => {
    io.to(`session-${data.sessionId}`).emit('aggregation-complete', data);
  });
}

module.exports = setupWebSocket;
