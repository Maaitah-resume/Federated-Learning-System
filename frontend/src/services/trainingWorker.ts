/**
 * trainingWorker.ts — frontend/src/services/trainingWorker.ts
 *
 * Runs TF.js entirely in a Web Worker (background thread).
 *
 * WHY THIS EXISTS:
 *   model.fit() on 5000 rows × 3 epochs holds the browser's JS main thread
 *   for 45-90 seconds with no yielding. During that freeze:
 *     • Socket.IO ping callbacks can't fire → Railway kills the TCP connection
 *     • setInterval(5000) poll callbacks queue up → fire all at once when
 *       the loop unfreezes → multiple simultaneous runLocalRound calls →
 *       model disposed mid-training → round never submits
 *
 *   A Web Worker runs on a SEPARATE OS thread. Training happens in the
 *   background; the main thread stays fully responsive throughout. Socket.IO
 *   pings fire normally. The 5-second poll fires on schedule. No disconnects,
 *   no poll storm, no disposed model — regardless of dataset size or epochs.
 *
 * PAPER FIDELITY (Chen et al. 2020):
 *   Nothing about the federated learning methodology changes. The same
 *   forward pass, backpropagation, weight extraction, pairwise masking and
 *   adaptive weight pre-scaling all happen — just on a different OS thread.
 *   Raw data still never leaves the device.
 *
 * MESSAGE PROTOCOL (main → worker):
 *   { type: 'LOAD_CSV',       payload: { csvText, fileName } }
 *   { type: 'APPLY_WEIGHTS',  payload: { serializedWeights } }
 *   { type: 'TRAIN',          payload: { epochs, batchSize } }
 *   { type: 'EXTRACT_WEIGHTS' }
 *   { type: 'APPLY_ALPHA',    payload: { weights, alpha } }
 *   { type: 'APPLY_MASKS',    payload: { weights, assignments } }
 *   { type: 'DISPOSE' }
 *
 * MESSAGE PROTOCOL (worker → main):
 *   { type: 'CSV_LOADED',     payload: ParsedDataset }
 *   { type: 'WEIGHTS_APPLIED' }
 *   { type: 'EPOCH_END',      payload: { epoch, logs } }
 *   { type: 'TRAIN_COMPLETE', payload: RoundMetrics }
 *   { type: 'WEIGHTS_READY',  payload: SerializedWeights }
 *   { type: 'ALPHA_APPLIED',  payload: SerializedWeights }
 *   { type: 'MASKS_APPLIED',  payload: SerializedWeights }
 *   { type: 'ERROR',          payload: { message } }
 */

import * as tf from '@tensorflow/tfjs';

// ─── Types (duplicated from localTrainer.ts to keep worker self-contained) ────
interface ParsedDataset {
  rows:           number;
  features:       number;
  classes:        number;
  labelMap:       Record<string, number>;
  droppedColumns: string[];
}

interface SerializedWeights {
  shapes: number[][];
  values: number[][];
}

interface MaskAssignment {
  peerId: string;
  seed:   number;
  role:   'add' | 'sub';
}

interface RoundMetrics {
  accuracy:          number;
  loss:              number;
  datasetSize:       number;
  durationMs:        number;
  epochsRun:         number;
  updateNorm:        number;
  updateConsistency: number;
}

// ─── Mulberry32 PRNG (identical to federatedOrchestrator.js) ─────────────────
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MASK_SCALE = 0.5;
const INF_CLAMP  = 1e9;
const MAX_ROWS   = 2000;

// ─── Worker state ─────────────────────────────────────────────────────────────
let model:          tf.LayersModel | null = null;
let xs:             tf.Tensor2D   | null = null;
let ys:             tf.Tensor1D   | null = null;
let meta:           ParsedDataset | null = null;
let prevGlobalW:    SerializedWeights | null = null;
let prevUpdateNorm: number = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isNonNumericColumn(values: string[]): boolean {
  const sample = values.filter(v => v !== '').slice(0, 20);
  if (sample.length === 0) return true;
  return sample.filter(v => isFinite(parseFloat(v))).length / sample.length < 0.5;
}

function safeParseFloat(raw: string): number {
  const v = parseFloat(raw);
  if (isNaN(v))     return 0;
  if (!isFinite(v)) return v > 0 ? INF_CLAMP : -INF_CLAMP;
  return v;
}

function buildModelFromMeta(m: ParsedDataset): tf.LayersModel {
  const isBinary = m.classes === 2;
  const mdl = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [m.features], units: 128, activation: 'relu', kernelInitializer: 'glorotUniform' }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.3 }),
      tf.layers.dense({ units: 64, activation: 'relu' }),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({ units: 32, activation: 'relu' }),
      tf.layers.dense({ units: isBinary ? 1 : m.classes, activation: isBinary ? 'sigmoid' : 'softmax' }),
    ],
  });
  mdl.compile({
    optimizer: tf.train.adam(0.001),
    loss:      isBinary ? 'binaryCrossentropy' : 'sparseCategoricalCrossentropy',
    metrics:   ['accuracy'],
  });
  return mdl;
}

function computeUpdateMetrics(): { updateNorm: number; updateConsistency: number } {
  if (!model || !prevGlobalW) return { updateNorm: 1.0, updateConsistency: 1.0 };
  const trainableWeights = model.trainableWeights;
  const prevValues       = prevGlobalW.values;
  let numerator = 0, denominator = 0;
  trainableWeights.forEach((w, tIdx) => {
    const curr = (w.val as tf.Tensor).dataSync();
    const prev = prevValues[tIdx] || [];
    for (let i = 0; i < curr.length; i++) {
      numerator   += (curr[i] - (prev[i] || 0)) ** 2;
      denominator += (prev[i] || 0) ** 2;
    }
  });
  const updateNorm    = Math.sqrt(numerator) / (Math.sqrt(denominator) + 1e-8);
  const consistency   = prevUpdateNorm > 0
    ? Math.max(0, 1 - Math.abs(updateNorm - prevUpdateNorm) / (prevUpdateNorm + 1e-8))
    : 1.0;
  prevUpdateNorm = updateNorm;
  return { updateNorm, updateConsistency: consistency };
}

// ─── Message handlers ─────────────────────────────────────────────────────────

async function handleLoadCSV(csvText: string, fileName: string) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV too small');

  const header   = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const labelCol = header.length - 1;

  // Detect non-numeric columns
  const sampleEnd  = Math.min(lines.length, 51);
  const colSamples: string[][] = Array.from({ length: labelCol }, () => []);
  for (let i = 1; i < sampleEnd; i++) {
    const cols = lines[i].split(',');
    for (let j = 0; j < labelCol; j++) {
      colSamples[j].push((cols[j] ?? '').trim().replace(/"/g, ''));
    }
  }
  const keepCols:  number[]  = [];
  const dropNames: string[]  = [];
  for (let j = 0; j < labelCol; j++) {
    if (isNonNumericColumn(colSamples[j])) dropNames.push(header[j]);
    else keepCols.push(j);
  }
  if (keepCols.length === 0) throw new Error('No numeric feature columns found');

  // Build label map
  const labelSet = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    labelSet.add((cols[labelCol] ?? '').trim().replace(/"/g, '') || 'UNKNOWN');
  }
  const labelMap: Record<string, number> = {};
  [...labelSet].sort().forEach((lbl, idx) => { labelMap[lbl] = idx; });

  // Parse rows
  const featureRows: number[][] = [];
  const labelRows:   number[]   = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    featureRows.push(keepCols.map(j => safeParseFloat((cols[j] ?? '').trim().replace(/"/g, ''))));
    labelRows.push(labelMap[(cols[labelCol] ?? '').trim().replace(/"/g, '') || 'UNKNOWN'] ?? 0);
  }
  if (featureRows.length === 0) throw new Error('No valid rows found');

  // Random sample to MAX_ROWS
  if (featureRows.length > MAX_ROWS) {
    const indices = Array.from({ length: featureRows.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5).slice(0, MAX_ROWS);
    featureRows.splice(0, featureRows.length, ...indices.map(i => featureRows[i]));
    labelRows.splice(0,   labelRows.length,   ...indices.map(i => labelRows[i]));
  }

  // Dispose old tensors
  xs?.dispose(); ys?.dispose();

  const rawXs = tf.tensor2d(featureRows);
  const colMin = rawXs.min(0);
  const colMax = rawXs.max(0);
  const range  = colMax.sub(colMin).add(1e-8);
  xs = rawXs.sub(colMin).div(range) as tf.Tensor2D;
  ys = tf.tensor1d(labelRows, 'float32') as tf.Tensor1D;
  rawXs.dispose(); colMin.dispose(); colMax.dispose(); range.dispose();

  meta = { rows: featureRows.length, features: keepCols.length, classes: Object.keys(labelMap).length, labelMap, droppedColumns: dropNames };

  // Build initial model
  model?.dispose();
  model = buildModelFromMeta(meta);

  self.postMessage({ type: 'CSV_LOADED', payload: meta });
}

function handleApplyWeights(serialized: SerializedWeights) {
  if (!meta) throw new Error('Load CSV first');
  prevGlobalW = serialized;
  model?.dispose();
  model = buildModelFromMeta(meta);

  const currentWeights = model.getWeights();
  if (serialized.values.length !== currentWeights.length) {
    console.warn('[Worker] Shape mismatch — using fresh weights');
    currentWeights.forEach(t => t.dispose());
    self.postMessage({ type: 'WEIGHTS_APPLIED' });
    return;
  }
  currentWeights.forEach(t => t.dispose());

  const tensors = serialized.values.map((flat, i) => tf.tensor(flat, serialized.shapes[i]));
  model.setWeights(tensors);
  tensors.forEach(t => t.dispose());
  self.postMessage({ type: 'WEIGHTS_APPLIED' });
}

async function handleTrain(epochs: number, batchSize: number) {
  if (!model) throw new Error('No model');
  if (!xs || !ys) throw new Error('No data');

  const started = Date.now();
  const history = await model.fit(xs, ys, {
    epochs,
    batchSize,
    shuffle:         true,
    validationSplit: 0.1,
    // In a Worker, there is no main thread to block — but we still yield
    // between batches so the worker message queue stays responsive and
    // EPOCH_END messages are sent promptly to the main thread.
    yieldEvery: 'batch',
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        self.postMessage({ type: 'EPOCH_END', payload: { epoch, logs } });
      },
    },
  });

  const accuracy = ((history.history['acc'] ?? history.history['accuracy'] ?? [0]).at(-1)) as number;
  const loss     = ((history.history['loss'] ?? [0]).at(-1)) as number;
  const { updateNorm, updateConsistency } = computeUpdateMetrics();

  self.postMessage({
    type: 'TRAIN_COMPLETE',
    payload: { accuracy, loss, datasetSize: meta!.rows, durationMs: Date.now() - started, epochsRun: epochs, updateNorm, updateConsistency },
  });
}

function handleExtractWeights() {
  if (!model) throw new Error('No model');
  const ws = model.getWeights();
  const result: SerializedWeights = { shapes: [], values: [] };
  for (const w of ws) {
    result.shapes.push(w.shape as number[]);
    result.values.push(Array.from(w.dataSync()));
  }
  // Do NOT dispose — same DataId refcount issue as main thread
  self.postMessage({ type: 'WEIGHTS_READY', payload: result });
}

function handleApplyAlpha(weights: SerializedWeights, alpha: number) {
  const scaled: SerializedWeights = {
    shapes: weights.shapes,
    values: weights.values.map(arr => arr.map(v => v * alpha)),
  };
  self.postMessage({ type: 'ALPHA_APPLIED', payload: scaled });
}

function handleApplyMasks(weights: SerializedWeights, assignments: MaskAssignment[]) {
  const masked: SerializedWeights = {
    shapes: weights.shapes,
    values: weights.values.map(arr => [...arr]),
  };
  for (const { seed, role } of assignments) {
    const rng = mulberry32(seed);
    for (let t = 0; t < masked.values.length; t++) {
      const flat = masked.values[t];
      for (let i = 0; i < flat.length; i++) {
        const maskVal = (rng() * 2 - 1) * MASK_SCALE;
        flat[i] = role === 'add' ? flat[i] + maskVal : flat[i] - maskVal;
      }
    }
  }
  self.postMessage({ type: 'MASKS_APPLIED', payload: masked });
}

function handleDispose() {
  model?.dispose(); xs?.dispose(); ys?.dispose();
  model = null; xs = null; ys = null;
  meta = null; prevGlobalW = null; prevUpdateNorm = 0;
}

// ─── Message router ───────────────────────────────────────────────────────────
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;
  try {
    switch (type) {
      case 'LOAD_CSV':       await handleLoadCSV(payload.csvText, payload.fileName); break;
      case 'APPLY_WEIGHTS':  handleApplyWeights(payload.serializedWeights);          break;
      case 'TRAIN':          await handleTrain(payload.epochs, payload.batchSize);   break;
      case 'EXTRACT_WEIGHTS':handleExtractWeights();                                  break;
      case 'APPLY_ALPHA':    handleApplyAlpha(payload.weights, payload.alpha);       break;
      case 'APPLY_MASKS':    handleApplyMasks(payload.weights, payload.assignments); break;
      case 'DISPOSE':        handleDispose();                                         break;
      default: console.warn('[Worker] Unknown message type:', type);
    }
  } catch (err: any) {
    self.postMessage({ type: 'ERROR', payload: { message: err.message } });
  }
};
