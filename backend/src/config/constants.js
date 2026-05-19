const PARTICIPANT_STATUS = {
  QUEUED:      'QUEUED',
  TRAINING:    'TRAINING',
  COMPLETED:   'COMPLETED',
  FAILED:      'FAILED',
};

const WS_EVENTS = {
  QUEUE_UPDATED:      'queue:updated',
  TRAINING_STARTING:  'training:starting',
  ROUND_STARTED:      'round:started',
  WEIGHTS_SUBMITTED:  'weights:submitted',
  ROUND_AGGREGATED:   'round:aggregated',
  TRAINING_COMPLETE:  'training:complete',
  TRAINING_ERROR:     'training:error',
};

const JOB_STATUS = {
  IDLE:         'IDLE',
  WAITING:      'WAITING',
  TRAINING:     'TRAINING',
  AGGREGATING:  'AGGREGATING',
  COMPLETED:    'COMPLETED',
  FAILED:       'FAILED',
};

const ROLES = {
  ADMIN:  'admin',
  CLIENT: 'client',
};

const ROUND_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  AGGREGATING: 'AGGREGATING',
  COMPLETE:    'COMPLETE',
  FAILED:      'FAILED',
};

module.exports = { PARTICIPANT_STATUS, WS_EVENTS, JOB_STATUS, ROLES, ROUND_STATUS };
