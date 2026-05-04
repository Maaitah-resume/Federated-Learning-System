const express = require('express');
const multer  = require('multer');
const UserData = require('../models/UserData');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// Store file in memory (then save to MongoDB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },  // 50 MB max
});

// POST /api/data/upload
router.post('/upload', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Replace any existing data for this company
    await UserData.deleteMany({ companyId: req.company.companyId });

    const saved = await UserData.create({
      companyId: req.company.companyId,
      fileName:  req.file.originalname,
      fileSize:  req.file.size,
      mimeType:  req.file.mimetype,
      data:      req.file.buffer,
    });

    return res.status(200).json({
      uploaded: true,
      fileName: saved.fileName,
      fileSize: saved.fileSize,
      uploadedAt: saved.uploadedAt,
    });
  } catch (err) { next(err); }
});

// GET /api/data — check if current user has uploaded data
router.get('/', authenticate, async (req, res, next) => {
  try {
    const data = await UserData.findOne({ companyId: req.company.companyId })
      .select('fileName fileSize uploadedAt'); // exclude binary data
    return res.status(200).json({ data: data || null });
  } catch (err) { next(err); }
});

// DELETE /api/data — remove uploaded data
router.delete('/', authenticate, async (req, res, next) => {
  try {
    await UserData.deleteMany({ companyId: req.company.companyId });
    return res.status(200).json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
