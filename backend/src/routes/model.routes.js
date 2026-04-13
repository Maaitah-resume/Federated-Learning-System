// src/routes/model.routes.js
const express       = require('express');
const modelRegistry = require('../services/modelRegistry');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/models
router.get('/', authenticate, async (req, res, next) => {
  try {
    const models = await modelRegistry.listForCompany(req.company.companyId);
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
  } catch (err) { next(err); }
});

// GET /api/models/:modelId
router.get('/:modelId', authenticate, async (req, res, next) => {
  try {
    const model = await modelRegistry.getForCompany(req.params.modelId, req.company.companyId);
    return res.status(200).json({
      modelId:      model.modelId,
      jobId:        model.jobId,
      version:      model.version,
      status:       model.status,
      checksum:     model.checksum,
      sizeBytes:    model.sizeBytes,
      architecture: model.architecture,
      metrics:      model.trainingMetrics,
      createdAt:    model.createdAt,
    });
  } catch (err) { next(err); }
});

// GET /api/models/:modelId/download
router.get('/:modelId/download', authenticate, async (req, res, next) => {
  try {
    const { stream, model } = await modelRegistry.getDownloadStream(
      req.params.modelId,
      req.company.companyId
    );

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="trained_model_${model.version}.pt"`);
    if (model.checksum)  res.setHeader('X-Checksum-SHA256', model.checksum);
    if (model.sizeBytes) res.setHeader('Content-Length', model.sizeBytes);

    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'STREAM_ERROR', message: 'Failed to stream model file' } });
      }
    });

    stream.pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;