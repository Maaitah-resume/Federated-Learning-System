// src/models/Company.js
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema(
  {
    companyId: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
    },
    companyName: {
      type:     String,
      required: true,
      trim:     true,
    },
    email: {
      type:      String,
      required:  true,
      unique:    true,
      lowercase: true,
      trim:      true,
    },
    passwordHash: {
      type:     String,
      required: true,
    },
    role: {
      type:    String,
      enum:    ['client', 'admin', 'observer'],
      default: 'client',
    },
    apiKey: {
      type:   String,
      unique: true,
      sparse: true, // allows multiple null values
    },
    isActive: {
      type:    Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
    },
    metadata: {
      contactPerson:  { type: String },
      networkSegment: { type: String },
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
companySchema.index({ companyId: 1 }, { unique: true });
companySchema.index({ email: 1 },     { unique: true });

// ─── Instance method ──────────────────────────────────────────────────────────
// Strips sensitive fields before sending to the browser
companySchema.methods.toSafeJSON = function () {
  return {
    id:          this.companyId,
    name:        this.companyName,
    email:       this.email,
    role:        this.role,
    isActive:    this.isActive,
    lastLoginAt: this.lastLoginAt,
    createdAt:   this.createdAt,
  };
};

module.exports = mongoose.model('Company', companySchema);