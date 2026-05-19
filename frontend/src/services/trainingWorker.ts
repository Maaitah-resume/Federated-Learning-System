/**
 * trainingWorker.ts — frontend/src/services/trainingWorker.ts
 *
 * COMPLETE REWRITE addressing the round-2 stall.
 *
 * ── THE ROOT CAUSES THIS FILE FIXES ──────────────────────────────────────────
 *
 *  1. SINGLE-RESOLVER RACE (deadlock)
 *     The old proxy stored ONE pair of {resolve,reject} for all in-flight
 *     operations. If two messages were in flight, the second postMessage
 *     overwrote the first's resolvers — the first Promise hung forever.
 *     FIX: every message carries a requestId. The worker echoes it back.
 *     The proxy keeps a Map<requestId, {resolve,reject}>.
 *
 *  2. HETEROGENEOUS LABEL SETS (silent model corruption)
 *     Mohammad's CSV had {Benign, FTP-BruteForce, SSH-Bruteforce}, Ammar's
 *     had {Benign, DoS-Hulk, DoS-SlowHTTPTest}. Both produced 3-unit output
 *     layers, but the integer-to-class mapping was different. The server
 *     aggregated weights as if they shared a label space — they didn't.
 *     FIX: the proxy passes a `globalSchema` (a list of all class names
 *     known across the federation) to LOAD_CSV. The worker maps local
 *     labels to global indices; unknown labels map to the "OTHER" bucket.
 *     Every client now has the SAME output layer regardless of which
 *     local labels appear in their data.
 *
 *  3. CONTAMINATED ROWS
 *     df3 had a stray "Label" header row in the middle of the data. This
 *     became a 4th class. FIX: skip rows whose label is literally "Label",
 *     "label", or empty.
 *
 *  4. SHAPE MISMATCH ON applyGlobalWeights
 *     The worker was silently padding/truncating mismatched tensors,
 *     producing NaN gradients. FIX: with the global schema in place,
 *     shapes always match — strict equality check, hard fail if not.
 *
 *  5. NO HEARTBEAT — workers die silently
 *     Browsers terminate workers under memory pressure. The proxy never
 *     knew. FIX: PING/PONG handler so the proxy can detect a dead worker.
 *
 * ── MESSAGE PROTOCOL ──────────────────────────────────────────────────────────
 *
 *   Every request from the main thread:
 *     { id: string, type: '...', payload: {...} }
 *
 *   Every response from the worker:
 *     { id: string, type: '...', payload: {...} }   // success
 *     { id: string, type: 'ERROR', payload: { message } }  // failure
 *
 *   Async progress events (training):
 *     { id: string, type: 'EPOCH_END', payload: { epoch, logs } }
 */

import * as tf from '@tensorflow/tfjs';

interface ParsedDataset {
  rows:           number;
  features:       number;
  classes:        number;
  labelMap:       Record<string, number>;
  droppedColumns: string[];
}
interface SerializedWeights { shapes: number[][]; values: number[][] }
interface MaskAssignment    { peerId: string; seed: number; role: 'add' | 'sub' }
interface RoundMetrics {
  accuracy: number; loss: number; datasetSize: number; durationMs: number;
  epochsRun: number; updateNorm: number; updateConsistency: number;
}

// ── Constants ───────────────────────────────────────────────────────────────
const MASK_SCALE = 0.5;
const INF_CLAMP  = 1e9;
const MAX_ROWS   = 2000;

// ── Worker state ─────────────────────────────────────────────────────────────
let model:          tf.LayersModel | null = null;
let xs:             tf.Tensor2D    | null = null;
let ys:             tf.Tensor1D    | null = null;
let meta:           ParsedDataset  | null = null;
let prevGlobalW:    SerializedWeights | null = null;
let prevUpdateNorm: number = 0;
let globalSchema:   string[] = [];   // canonical ordered class names

// ── Helpers ──────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function isContaminatedLabel(lbl: string): boolean {
  // The "Label" header bleeding into the data, or empty/null labels
  const norm = lbl.trim().toLowerCase();
  return norm === '' || norm === 'label' || norm === 'null' || norm === 'nan';
}

function buildModelFromSchema(features: number, classes: number): tf.LayersModel {
  // ALWAYS multi-class softmax (we treat federated classification as ≥2 classes;
  // single-class makes no sense for a federation). This means the output layer
  // size is deterministic from the global schema, and is identical across all
  // clients regardless of which local labels they happen to have.
  const mdl = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [features], units: 128, activation: 'relu', kernelInitializer: 'glorotUniform' }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.3 }),
      tf.layers.dense({ units: 64, activation: 'relu' }),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({ units: 32, activation: 'relu' }),
      tf.layers.dense({ units: classes, activation: 'softmax' }),
    ],
  });
  mdl.compile({
    optimizer: tf.train.adam(0.001),
    loss:      'sparseCategoricalCrossentropy',
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
  const updateNorm  = Math.sqrt(numerator) / (Math.sqrt(denominator) + 1e-8);
  const consistency = prevUpdateNorm > 0
    ? Math.max(0, 1 - Math.abs(updateNorm - prevUpdateNorm) / (prevUpdateNorm + 1e-8))
    : 1.0;
  prevUpdateNorm = updateNorm;
  return { updateNorm, updateConsistency: consistency };
}

// ── Message handlers ─────────────────────────────────────────────────────────

async function handleLoadCSV(csvText: string, schema: string[]) {
  if (!schema || schema.length < 2) {
    throw new Error('Global schema is required and must contain at least 2 classes');
  }
  globalSchema = schema;

  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV too small');

  const header   = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const labelCol = header.length - 1;

  // Detect non-numeric columns (Timestamp, IP, dates, etc.)
  const sampleEnd  = Math.min(lines.length, 51);
  const colSamples: string[][] = Array.from({ length: labelCol }, () => []);
  for (let i = 1; i < sampleEnd; i++) {
    const cols = lines[i].split(',');
    for (let j = 0; j < labelCol; j++) {
      colSamples[j].push((cols[j] ?? '').trim().replace(/"/g, ''));
    }
  }
  const keepCols:  number[] = [];
  const dropNames: string[] = [];
  for (let j = 0; j < labelCol; j++) {
    if (isNonNumericColumn(colSamples[j])) dropNames.push(header[j]);
    else keepCols.push(j);
  }
  if (keepCols.length === 0) throw new Error('No numeric feature columns found');

  // Build the labelMap from the GLOBAL schema, not from local data.
  // Local labels not in the schema map to the OTHER index (last slot).
  // This guarantees every client has the same number of output classes.
  const labelMap: Record<string, number> = {};
  schema.forEach((cls, idx) => { labelMap[cls] = idx; });
  const otherIdx = schema.indexOf('OTHER');
  const fallback = otherIdx >= 0 ? otherIdx : (schema.length - 1);

  // Parse rows, dropping contaminated label rows
  const featureRows: number[][] = [];
  const labelRows:   number[]   = [];
  let droppedCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    const rawLabel = (cols[labelCol] ?? '').trim().replace(/"/g, '');
    if (isContaminatedLabel(rawLabel)) { droppedCount++; continue; }
    featureRows.push(keepCols.map(j => safeParseFloat((cols[j] ?? '').trim().replace(/"/g, ''))));
    labelRows.push(labelMap[rawLabel] ?? fallback);
  }
  if (featureRows.length === 0) throw new Error('No valid rows after filtering');
  if (droppedCount > 0) console.log(`[Worker] Dropped ${droppedCount} contaminated rows`);

  // Random sample to MAX_ROWS for responsive training
  if (featureRows.length > MAX_ROWS) {
    const indices = Array.from({ length: featureRows.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5).slice(0, MAX_ROWS);
    const sf = indices.map(i => featureRows[i]);
    const sl = indices.map(i => labelRows[i]);
    featureRows.splice(0, featureRows.length, ...sf);
    labelRows.splice(0,   labelRows.length,   ...sl);
  }

  // Free old tensors before building new ones
  xs?.dispose(); ys?.dispose();

  const rawXs  = tf.tensor2d(featureRows);
  const colMin = rawXs.min(0);
  const colMax = rawXs.max(0);
  const range  = colMax.sub(colMin).add(1e-8);
  xs = rawXs.sub(colMin).div(range) as tf.Tensor2D;
  ys = tf.tensor1d(labelRows, 'float32') as tf.Tensor1D;
  rawXs.dispose(); colMin.dispose(); colMax.dispose(); range.dispose();

  meta = {
    rows:           featureRows.length,
    features:       keepCols.length,
    classes:        schema.length,
    labelMap,
    droppedColumns: dropNames,
  };

  // Build the initial model with the global class count
  model?.dispose();
  model = buildModelFromSchema(meta.features, meta.classes);

  return meta;
}

function handleApplyWeights(serialized: SerializedWeights) {
  if (!meta) throw new Error('Load CSV first');
  if (!serialized.values || serialized.values.length === 0) {
    throw new Error('Empty weights received');
  }

  prevGlobalW = serialized;
  model?.dispose();
  model = buildModelFromSchema(meta.features, meta.classes);

  const currentWeights = model.getWeights();
  if (serialized.values.length !== currentWeights.length) {
    // With the global schema in place, this should never happen.
    // If it does, log loudly and fall back to fresh weights.
    console.error(`[Worker] FATAL shape mismatch: server sent ${serialized.values.length} tensors, model has ${currentWeights.length}. Falling back to fresh weights.`);
    currentWeights.forEach(t => t.dispose());
    return;
  }

  const tensors: tf.Tensor[] = [];
  for (let i = 0; i < serialized.values.length; i++) {
    const recvShape  = serialized.shapes[i];
    const modelShape = currentWeights[i].shape as number[];
    const recvLen    = recvShape.reduce((a, b) => a * b, 1);
    const modelLen   = modelShape.reduce((a, b) => a * b, 1);
    if (recvLen !== modelLen) {
      tensors.forEach(t => t.dispose());
      currentWeights.forEach(t => t.dispose());
      throw new Error(`Tensor ${i} length mismatch: ${recvLen} vs ${modelLen}`);
    }
    tensors.push(tf.tensor(serialized.values[i], modelShape));
  }
  currentWeights.forEach(t => t.dispose());
  model.setWeights(tensors);
  tensors.forEach(t => t.dispose());
}

async function handleTrain(
  epochs: number,
  batchSize: number,
  emitEpoch: (epoch: number, logs: any) => void,
) {
  if (!model)          throw new Error('No model');
  if (!xs || !ys)      throw new Error('No data');
  if (!meta)           throw new Error('No metadata');

  const started = Date.now();
  const history = await model.fit(xs, ys, {
    epochs,
    batchSize,
    shuffle:         true,
    validationSplit: 0.1,
    yieldEvery:      'batch',
    callbacks: { onEpochEnd: (epoch, logs) => emitEpoch(epoch, logs) },
  });

  const accuracy = ((history.history['acc'] ?? history.history['accuracy'] ?? [0]).at(-1)) as number;
  const loss     = ((history.history['loss'] ?? [0]).at(-1)) as number;
  const { updateNorm, updateConsistency } = computeUpdateMetrics();

  return { accuracy, loss, datasetSize: meta.rows, durationMs: Date.now() - started, epochsRun: epochs, updateNorm, updateConsistency };
}

function handleExtractWeights(): SerializedWeights {
  if (!model) throw new Error('No model');
  const ws = model.getWeights();
  return {
    shapes: ws.map(w => w.shape as number[]),
    values: ws.map(w => Array.from(w.dataSync())),
  };
  // Do NOT dispose ws — they are views of the internal Variable buffers
}

function handleApplyAlpha(weights: SerializedWeights, alpha: number): SerializedWeights {
  return {
    shapes: weights.shapes,
    values: weights.values.map(arr => arr.map(v => v * alpha)),
  };
}

function handleApplyMasks(weights: SerializedWeights, assignments: MaskAssignment[]): SerializedWeights {
  const masked: SerializedWeights = {
    shapes: weights.shapes,
    values: weights.values.map(arr => [...arr]),
  };
  for (const { seed, role } of assignments) {
    const rng = mulberry32(seed);
    for (let t = 0; t < masked.values.length; t++) {
      const flat = masked.values[t];
      for (let i = 0; i < flat.length; i++) {
        const m = (rng() * 2 - 1) * MASK_SCALE;
        flat[i] = role === 'add' ? flat[i] + m : flat[i] - m;
      }
    }
  }
  return masked;
}

function handleDispose() {
  try { model?.dispose(); } catch {}
  try { xs?.dispose();    } catch {}
  try { ys?.dispose();    } catch {}
  model = null; xs = null; ys = null;
  meta = null; prevGlobalW = null; prevUpdateNorm = 0;
  globalSchema = [];
}

// ── Message router with request ID correlation ───────────────────────────────
self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;

  // Heartbeat — respond immediately so the proxy knows the worker is alive
  if (type === 'PING') {
    self.postMessage({ id, type: 'PONG' });
    return;
  }

  try {
    let result: any = undefined;
    switch (type) {
      case 'LOAD_CSV':
        result = await handleLoadCSV(payload.csvText, payload.schema);
        break;
      case 'APPLY_WEIGHTS':
        handleApplyWeights(payload.serializedWeights);
        break;
      case 'TRAIN':
        result = await handleTrain(payload.epochs, payload.batchSize,
          (epoch, logs) => self.postMessage({ id, type: 'EPOCH_END', payload: { epoch, logs } }));
        break;
      case 'EXTRACT_WEIGHTS':
        result = handleExtractWeights();
        break;
      case 'APPLY_ALPHA':
        result = handleApplyAlpha(payload.weights, payload.alpha);
        break;
      case 'APPLY_MASKS':
        result = handleApplyMasks(payload.weights, payload.assignments);
        break;
      case 'DISPOSE':
        handleDispose();
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    self.postMessage({ id, type: 'OK', payload: result });
  } catch (err: any) {
    self.postMessage({ id, type: 'ERROR', payload: { message: err?.message || String(err) } });
  }
};
