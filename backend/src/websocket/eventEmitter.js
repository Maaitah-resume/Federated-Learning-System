// backend/src/websocket/eventEmitter.js
const EventEmitter = require('events');

class TrainingEventEmitter extends EventEmitter {
  constructor() {
    super();
  }

  // Emit training session updates
  emitTrainingUpdate(sessionId, data) {
    this.emit('training-update', { sessionId, ...data });
  }

  // Emit queue updates
  emitQueueUpdate(data) {
    this.emit('queue-update', data);
  }

  // Emit client updates
  emitClientUpdate(sessionId, clientData) {
    this.emit('client-update', { sessionId, ...clientData });
  }

  // Emit aggregation completion
  emitAggregationComplete(sessionId, modelData) {
    this.emit('aggregation-complete', { sessionId, ...modelData });
  }
}

// Singleton instance
const trainingEvents = new TrainingEventEmitter();

module.exports = trainingEvents;
