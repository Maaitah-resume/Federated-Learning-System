export const FL_CONSTANTS = {
  MIN_CLIENTS: 3,
  MAX_ROUNDS: 10,
  DEFAULT_LEARNING_RATE: 0.01,
  DEFAULT_BATCH_SIZE: 32,
  TIMEOUT_SECONDS: 300,
  
  // Job Statuses
  STATUS: {
    IDLE: 'IDLE',
    WAITING: 'WAITING',
    TRAINING: 'TRAINING',
    AGGREGATING: 'AGGREGATING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED'
  },
  
  // Participant Roles
  ROLES: {
    ADMIN: 'admin',
    CLIENT: 'client'
  },
  
  // Socket Events
  EVENTS: {
    QUEUE_UPDATED: 'queue:updated',
    TRAINING_STARTING: 'training:starting',
    ROUND_STARTED: 'round:started',
    WEIGHTS_SUBMITTED: 'weights:submitted',
    TRAINING_COMPLETE: 'training:complete'
  }
};
