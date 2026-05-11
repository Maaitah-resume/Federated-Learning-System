/**
 * Model export endpoint - converts trained models to .pkl format
 * Add this to Federated.routes.js
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const router = express.Router();

/**
 * POST /api/federated/export-pkl
 * Convert a trained model from JSON to .pkl format
 * 
 * Request body:
 * {
 *   jobId: "53742802",
 *   accuracy: 95.3,
 *   participants: ["mohammad", "amer"]
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   filename: "model-job-53742802.pkl",
 *   downloadUrl: "/api/federated/download-model/model-job-53742802.pkl",
 *   filesize: 371200
 * }
 */
router.post('/export-pkl', async (req, res) => {
  try {
    const { jobId, accuracy, participants } = req.body;
    
    if (!jobId) {
      return res.status(400).json({ error: 'jobId required' });
    }
    
    // Paths
    const modelDir = path.join(__dirname, '../../storage/models');
    const jsonFile = path.join(modelDir, `model-job-${jobId}_v1_0_0.json`);
    const pklFile = path.join(modelDir, `model-job-${jobId}.pkl`);
    
    // Check if JSON exists
    if (!fs.existsSync(jsonFile)) {
      return res.status(404).json({ error: `Model ${jobId} not found` });
    }
    
    // Check if PKL already exists
    if (fs.existsSync(pklFile)) {
      const stats = fs.statSync(pklFile);
      return res.json({
        success: true,
        filename: path.basename(pklFile),
        downloadUrl: `/api/federated/download-model/${path.basename(pklFile)}`,
        filesize: stats.size,
        cached: true
      });
    }
    
    // Prepare Python conversion script
    const converterPath = path.join(__dirname, '../../utils/model_converter.py');
    
    // Build metadata JSON string
    const metadata = JSON.stringify({
      accuracy: accuracy || null,
      participants: participants || [],
      createdAt: new Date().toISOString(),
      jobId: jobId
    }).replace(/"/g, '\\"'); // Escape quotes for shell
    
    // Call Python converter
    return new Promise((resolve) => {
      const pythonProcess = spawn('python3', [
        converterPath,
        jsonFile,
        pklFile,
        accuracy || '',
        participants?.join(',') || ''
      ]);
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error('[export-pkl] Python error:', stderr);
          return res.status(500).json({ 
            error: 'Conversion failed',
            details: stderr 
          });
        }
        
        const stats = fs.statSync(pklFile);
        res.json({
          success: true,
          filename: path.basename(pklFile),
          downloadUrl: `/api/federated/download-model/${path.basename(pklFile)}`,
          filesize: stats.size,
          message: `✓ Model exported: ${stats.size} bytes`
        });
      });
    });
    
  } catch (error) {
    console.error('[export-pkl] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/federated/download-model/:filename
 * Download a .pkl model file
 */
router.get('/download-model/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    // Security: only allow .pkl files, prevent directory traversal
    if (!filename.endsWith('.pkl') || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filepath = path.join(__dirname, '../../storage/models', filename);
    
    // Verify file exists and is in models directory
    const realpath = fs.realpathSync(filepath);
    const modelDir = fs.realpathSync(path.join(__dirname, '../../storage/models'));
    
    if (!realpath.startsWith(modelDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(realpath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Send file
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(realpath);
    
  } catch (error) {
    console.error('[download-model] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/federated/model-info/:filename
 * Get model metadata without downloading (weights-free)
 */
router.get('/model-info/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename.endsWith('.pkl') || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filepath = path.join(__dirname, '../../storage/models', filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Read pickle header to extract metadata without loading weights
    // For simplicity, we'll use a small Python script to extract metadata
    
    const stats = fs.statSync(filepath);
    
    res.json({
      filename: filename,
      filesize: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime
    });
    
  } catch (error) {
    console.error('[model-info] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
