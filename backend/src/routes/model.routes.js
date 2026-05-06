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
    })
      .select('-weightsB64') // never send weights in list — too large
      .sort({ createdAt: -1 });

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
        hasWeights:   !!m.weightsB64,
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
    const model     = await ModelDoc.findOne({ modelId: req.params.modelId }).select('-weightsB64');

    if (!model) return res.status(404).json({ error: 'Model not found' });

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
      hasWeights:   !!model.weightsB64,
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
// Returns the real .pt PyTorch model file if available, else metadata JSON
router.get('/:modelId/download', authenticate, async (req, res, next) => {
  try {
    const companyId = req.company.companyId;

    // Fetch with weights this time
    const model = await ModelDoc.findOne({ modelId: req.params.modelId });

    if (!model) return res.status(404).json({ error: 'Model not found' });

    if (!model.participants.includes(companyId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // If real weights exist → serve as .pt file
    if (model.weightsB64) {
      const weightBuffer = Buffer.from(model.weightsB64, 'base64');
      const filename     = `global_model_${model.modelId}_v${model.version}.pt`;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', weightBuffer.length);
      res.setHeader('X-Model-Architecture', model.architecture || 'IDSNet_v2');
      res.setHeader('X-Model-Version', model.version);
      res.setHeader('X-Final-Accuracy', model.trainingMetrics?.finalAccuracy?.toFixed(4) || '');

      return res.end(weightBuffer);
    }

    // Fallback: serve metadata JSON if no weights stored
    const metadata = {
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
      note:          'Weights not available. Re-run training to generate a downloadable .pt file.',
    };

    const filename = `${model.modelId}_metadata_v${model.version}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).json(metadata);

  } catch (err) { next(err); }
});

module.exports = router;
