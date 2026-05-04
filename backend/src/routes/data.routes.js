const express  = require('express');
const multer   = require('multer');
const UserData = require('../models/UserData');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
});

// POST /api/data/upload — saves a new record (does NOT overwrite previous)
router.post('/upload', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const saved = await UserData.create({
      companyId: req.company.companyId,
      fileName:  req.file.originalname,
      fileSize:  req.file.size,
      mimeType:  req.file.mimetype,
      data:      req.file.buffer,
    });

    return res.status(200).json({
      uploaded:   true,
      id:         saved._id,
      fileName:   saved.fileName,
      fileSize:   saved.fileSize,
      uploadedAt: saved.uploadedAt,
    });
  } catch (err) { next(err); }
});

// GET /api/data — returns ALL uploaded files for current user (history)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const uploads = await UserData.find({ companyId: req.company.companyId })
      .select('fileName fileSize uploadedAt')
      .sort({ uploadedAt: -1 });
    return res.status(200).json({ uploads });
  } catch (err) { next(err); }
});

// GET /api/data/latest — returns the latest upload metadata
router.get('/latest', authenticate, async (req, res, next) => {
  try {
    const latest = await UserData.findOne({ companyId: req.company.companyId })
      .select('fileName fileSize uploadedAt')
      .sort({ uploadedAt: -1 });
    return res.status(200).json({ data: latest || null });
  } catch (err) { next(err); }
});

// DELETE /api/data/:id — remove a specific upload (optional)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await UserData.deleteOne({ _id: req.params.id, companyId: req.company.companyId });
    return res.status(200).json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
