const express  = require('express');
const ModelDoc = require('../models/Models');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/models — returns models this user participated in
router.get('/', authenticate, async (req, res, next) => {
  try {
    const companyId = req.company.companyId;

    const models = await ModelDoc.find({
      participants: companyId,
      status: 'AVAILABLE',
    }).sort({ createdAt: -1 });

    return res.status(200).json(
      models.map((m) => ({
        modelId:      m.modelId,
        jobId:        m.jobId,
        version:      m.version,
        status:       m.status,
        architecture: m.architecture || 'IDSNet_v2',
        sizeBytes:    m.sizeBytes    || 0,
        checksum:     m.checksum,
        participants: m.participants || [],
        metrics: {
          finalAccuracy:     m.trainingMetrics?.finalAccuracy     || null,
          finalLoss:         m.trainingMetrics?.finalLoss         || null,
          roundsCompleted:   m.trainingMetrics?.roundsCompleted   || null,
          totalParticipants: m.trainingMetrics?.totalParticipants || null,
        },
        createdAt: m.createdAt,
      }))
    );
  } catch (err) { next(err); }
});

// GET /api/models/:modelId — single model detail
router.get('/:modelId', authenticate, async (req, res, next) => {
  try {
    const companyId = req.company.companyId;
    const model     = await ModelDoc.findOne({ modelId: req.params.modelId });

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // Only participants can access
    if (!model.participants.includes(companyId)) {
      return res.status(403).json({ error: 'You did not participate in this model\'s training' });
    }

    return res.status(200).json({
      modelId:      model.modelId,
      jobId:        model.jobId,
      version:      model.version,
      status:       model.status,
      architecture: model.architecture || 'IDSNet_v2',
      sizeBytes:    model.sizeBytes    || 0,
      checksum:     model.checksum,
      participants: model.participants || [],
      metrics: {
        finalAccuracy:     model.trainingMetrics?.finalAccuracy,
        finalLoss:         model.trainingMetrics?.finalLoss,
        roundsCompleted:   model.trainingMetrics?.roundsCompleted,
        totalParticipants: model.trainingMetrics?.totalParticipants,
      },
      createdAt: model.createdAt,
    });
  } catch (err) { next(err); }
});

// GET /api/models/:modelId/download
// Since model .pt files aren't stored on disk in simulation mode,
// we return the model metadata + weights info as a downloadable JSON
router.get('/:modelId/download', authenticate, async (req, res, next) => {
  try {
    const companyId = req.company.companyId;
    const model     = await ModelDoc.findOne({ modelId: req.params.modelId });

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    if (!model.participants.includes(companyId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build a downloadable model info package
    const modelPackage = {
      modelId:      model.modelId,
      jobId:        model.jobId,
      version:      model.version,
      architecture: model.architecture || 'IDSNet_v2',
      framework:    'PyTorch',
      inputDim:     25,
      outputDim:    1,
      classes:      ['BENIGN', 'ATTACK'],
      trainingMetrics: {
        finalAccuracy:     model.trainingMetrics?.finalAccuracy,
        finalLoss:         model.trainingMetrics?.finalLoss,
        roundsCompleted:   model.trainingMetrics?.roundsCompleted,
        totalParticipants: model.trainingMetrics?.totalParticipants,
      },
      participants:  model.participants,
      createdAt:     model.createdAt,
      note:          'This is the federated global model trained with differential privacy and secure aggregation.',
    };

    const filename = `${model.modelId}_${model.version}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).json(modelPackage);
  } catch (err) { next(err); }
});

module.exports = router;
