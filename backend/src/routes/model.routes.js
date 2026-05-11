const express  = require('express');
const ModelDoc = require('../models/Models');
const { authenticate } = require('../middleware/authMiddleware');
const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const router = express.Router();

// ─── GET /api/models ──────────────────────────────────────────────────────────
// Returns models this user participated in
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

// ─── GET /api/models/:modelId ─────────────────────────────────────────────────
// Single model detail
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

// ─── GET /api/models/:modelId/download ───────────────────────────────────────
// Converts model weights → .pkl (Python pickle) and streams to client.
//
// Why .pkl?
//   The weights stored in MongoDB (weightsB64) are a base64-encoded JSON blob
//   of { shapes: [...], values: [...] } produced by TensorFlow.js on the
//   client.  Serving this raw JSON would require users to write their own
//   deserialiser.  By converting to pickle with NumPy arrays we give them a
//   file that loads with a single `pickle.load()` call in any Python ML stack.
//
// Conversion is done in a sandboxed temp directory so nothing persists.
router.get('/:modelId/download', authenticate, async (req, res, next) => {
  try {
    const companyId = req.company.companyId;

    // Fetch model with weights
    const model = await ModelDoc.findOne({ modelId: req.params.modelId });

    if (!model) return res.status(404).json({ error: 'Model not found' });

    if (!model.participants.includes(companyId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // ── No weights stored yet: return metadata JSON as fallback ──────────────
    if (!model.weightsB64) {
      const metadata = {
        modelId:      model.modelId,
        jobId:        model.jobId,
        version:      model.version,
        architecture: model.architecture || 'IDSNet_v2',
        framework:    'TensorFlow.js → Python pickle',
        note:         'Weights not available yet. Re-run training to generate a downloadable .pkl file.',
        trainingMetrics: {
          finalAccuracy:     model.trainingMetrics?.finalAccuracy,
          finalLoss:         model.trainingMetrics?.finalLoss,
          roundsCompleted:   model.trainingMetrics?.roundsCompleted,
          totalParticipants: model.trainingMetrics?.totalParticipants,
        },
        participants: model.participants,
        createdAt:    model.createdAt,
      };
      const filename = `${model.modelId}_metadata_v${model.version}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).json(metadata);
    }

    // ── Decode base64 → JSON weights ─────────────────────────────────────────
    const weightsJson = Buffer.from(model.weightsB64, 'base64').toString('utf8');

    // ── Convert JSON → .pkl via Python in a temp directory ───────────────────
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'flmodel-'));
    const jsonPath = path.join(tmpDir, 'weights.json');
    const pklPath  = path.join(tmpDir, 'model.pkl');

    try {
      fs.writeFileSync(jsonPath, weightsJson, 'utf8');

      // Build metadata to embed in the pickle
      const accuracy     = model.trainingMetrics?.finalAccuracy  || 0;
      const participants = (model.participants || []).join(',');
      const converterPath = path.join(__dirname, '../utils/model_converter.py');

      // Run Python converter (numpy required on server — available by default on Railway)
      execSync(
        `python3 "${converterPath}" "${jsonPath}" "${pklPath}" "${accuracy}" "${participants}"`,
        { timeout: 30000 }
      );

      // ── Stream .pkl to client ───────────────────────────────────────────────
      const pklBuffer  = fs.readFileSync(pklPath);
      const filename   = `${model.modelId}_v${model.version}.pkl`;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pklBuffer.length);
      res.setHeader('X-Model-Architecture', model.architecture || 'IDSNet_v2');
      res.setHeader('X-Model-Version', model.version);
      res.setHeader('X-Final-Accuracy', accuracy.toFixed ? accuracy.toFixed(4) : String(accuracy));
      res.setHeader('X-Model-Format', 'python-pickle-numpy');

      return res.end(pklBuffer);

    } finally {
      // Always clean up temp files
      try { fs.unlinkSync(jsonPath); } catch (_) {}
      try { fs.unlinkSync(pklPath);  } catch (_) {}
      try { fs.rmdirSync(tmpDir);    } catch (_) {}
    }

  } catch (err) {
    console.error('[model.routes] Download error:', err.message);
    // If Python conversion failed, fall back to raw JSON download
    try {
      const model = await ModelDoc.findOne({ modelId: req.params.modelId });
      if (model?.weightsB64) {
        const weightsJson = Buffer.from(model.weightsB64, 'base64').toString('utf8');
        const filename    = `${model.modelId}_v${model.version}_weights.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(weightsJson);
      }
    } catch (_) {}
    next(err);
  }
});

module.exports = router;
