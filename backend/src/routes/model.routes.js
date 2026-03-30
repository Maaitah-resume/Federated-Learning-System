// src/routes/model.routes.js
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const ModelDoc     = require('../models/Model');
const jobManager   = require('../services/jobManager');
const { authenticate } = require('../middleware/authMiddleware');
const { MODEL_STATUS } = require('../config/constants');

const router = express.Router();

// GET /models
// Lists all AVAILABLE models for jobs the authenticated company participated in
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { companyId } = req.company;

    // Find all completed jobs where this company was a participant
    const completedJobs = await jobManager.getJobHistory();
    const participatedJobIds = completedJobs
      .filter((j) => j.participantIds.includes(companyId))
      .map((j) => j.jobId);

    const models = await ModelDoc.find({
      jobId:  { $in: participatedJobIds },
      status: MODEL_STATUS.AVAILABLE,
    }).sort({ createdAt: -1 });

    return res.status(200).json(
      models.map((m) => ({
        modelId:   m.modelId,
        jobId:     m.jobId,
        version:   m.version,
        status:    m.status,
        createdAt: m.createdAt,
        metrics:   m.trainingMetrics,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /models/:modelId
// Full metadata for a single model
router.get('/:modelId', authenticate, async (req, res, next) => {
  try {
    const { companyId } = req.company;
    const { modelId }   = req.params;

    const model = await ModelDoc.findOne({ modelId });
    if (!model) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Model not found' } });
    }

    // Gate on participation
    const job = await jobManager.getJobById(model.jobId);
    if (!job || !job.participantIds.includes(companyId)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant of the job that produced this model' },
      });
    }

    return res.status(200).json({
      modelId:     model.modelId,
      jobId:       model.jobId,
      version:     model.version,
      status:      model.status,
      checksum:    model.checksum,
      sizeBytes:   model.sizeBytes,
      architecture:model.architecture,
      metrics:     model.trainingMetrics,
      createdAt:   model.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// GET /models/:modelId/download
// Streams the .pt file to the client
router.get('/:modelId/download', authenticate, async (req, res, next) => {
  try {
    const { companyId } = req.company;
    const { modelId }   = req.params;

    const model = await ModelDoc.findOne({ modelId });
    if (!model) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Model not found' } });
    }

    if (model.status !== MODEL_STATUS.AVAILABLE) {
      return res.status(409).json({
        error: { code: 'NOT_READY', message: `Model is not ready for download (status: ${model.status})` },
      });
    }

    // Gate on participation
    const job = await jobManager.getJobById(model.jobId);
    if (!job || !job.participantIds.includes(companyId)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant of the job that produced this model' },
      });
    }

    if (!model.artifactPath || !fs.existsSync(model.artifactPath)) {
      return res.status(404).json({
        error: { code: 'FILE_NOT_FOUND', message: 'Model file not found on server' },
      });
    }

    const filename = `trained_model_${model.version}.pt`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Checksum-SHA256', model.checksum || '');
    if (model.sizeBytes) res.setHeader('Content-Length', model.sizeBytes);

    const stream = fs.createReadStream(model.artifactPath);
    stream.on('error', (streamErr) => {
      console.error('[ModelRoute] Stream error:', streamErr.message);
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'STREAM_ERROR', message: 'Failed to stream model file' } });
      }
    });

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;