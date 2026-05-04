const mongoose = require('mongoose');

const userDataSchema = new mongoose.Schema({
  companyId:    { type: String, required: true, index: true },
  fileName:     { type: String, required: true },
  fileSize:     { type: Number, required: true },
  mimeType:     { type: String },
  data:         { type: Buffer, required: true },  // file content stored in DB
  uploadedAt:   { type: Date, default: Date.now },
});

module.exports = mongoose.model('UserData', userDataSchema);
