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
  TRAINING_COMPLETE:  'training:complete',
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

module.exports = { PARTICIPANT_STATUS, WS_EVENTS, JOB_STATUS, ROLES };
