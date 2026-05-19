/**
 * localTrainer.ts — frontend/src/services/localTrainer.ts
 *
 * Implements paper Section 3.3 + 3.4:
 *   - Pairwise masking for privacy
 *   - Pre-scaling weights by adaptive weight α (meta-aggregator requirement)
 *   - Computing update_consistency for meta-aggregator feature vector
 *
 * ADAPTIVE WEIGHT PRE-SCALING (paper Section 3.4):
 *   Server broadcasts α_i to each client at round start.
 *   Client scales all weight tensors by α_i BEFORE masking:
 *     send = α_i × w_i + mask_i
 *   Server sums: Σ(α_i × w_i) = quality-weighted global model
 *   (masks cancel, no /N needed since Σα = 1)
 *
 * UPDATE CONSISTENCY (paper Section 3.4):
 *   consistency = 1 − |updateNorm_t − updateNorm_{t−1}| / (updateNorm_{t−1} + ε)
 *   High consistency (≈1): stable updates → more trustworthy
 *   Low consistency (≈0): erratic updates → less trustworthy
 */

import * as tf from '@tensorflow/tfjs';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ParsedDataset {
  rows:     number;
  features: number;
  classes:  number;
  labelMap: Record<string, number>;
}

export interface RoundMetrics {
  accuracy:          number;
  loss:              number;
  datasetSize:       number;
  durationMs:        number;
  epochsRun:         number;
  updateNorm:        number;   // L2 norm of weight update (||w_t − global_t-1||)
  updateConsistency: number;   // stability across rounds [0,1]
}

export interface SerializedWeights {
  shapes: number[][];
  values: number[][];
}

export interface MaskAssignment {
  peerId: string;
  seed:   number;
  role:   'add' | 'sub';
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

// ─── LocalTrainer ─────────────────────────────────────────────────────────────
export class LocalTrainer {
  private model:        tf.LayersModel | null = null;
  private xs:           tf.Tensor2D   | null = null;
  private ys:           tf.Tensor1D   | null = null;
  private meta:         ParsedDataset | null = null;
  private prevGlobalW:  SerializedWeights | null = null; // for updateNorm
  private prevUpdateNorm: number = 0;                    // for consistency

  // ── CSV loading ─────────────────────────────────────────────────────────────
  async loadCSV(file: File): Promise<ParsedDataset> {
    const text  = await file.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV too small (need header + data rows)');

    const header   = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const labelCol = header.length - 1;

    // Detect non-numeric columns (Timestamp, IP addresses, dates) by sampling
    const sampleEnd = Math.min(lines.length, 21);
    const colSamples: string[][] = Array.from({ length: labelCol }, () => []);
    for (let i = 1; i < sampleEnd; i++) {
      const cols = lines[i].split(',');
      for (let j = 0; j < labelCol; j++) colSamples[j].push((cols[j]??'').trim());
    }
    const keepCols: number[] = [];
    for (let j = 0; j < labelCol; j++) {
      const sample = colSamples[j].filter(v => v !== '');
      const numericRatio = sample.filter(v => isFinite(parseFloat(v))).length / (sample.length||1);
      if (numericRatio >= 0.5) keepCols.push(j);
    }
    if (keepCols.length === 0) throw new Error('No numeric feature columns found');

    // Build label map — skip contaminated rows (e.g. "Label" header bleeding in)
    const labelSet = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const lbl = (cols[labelCol]??'').trim().replace(/"/g, '');
      if (lbl && lbl.toLowerCase() !== 'label') labelSet.add(lbl || 'UNKNOWN');
    }
    const labelMap: Record<string, number> = {};
    [...labelSet].sort().forEach((lbl, idx) => { labelMap[lbl] = idx; });

    const featureRows: number[][] = [];
    const labelRows:   number[]   = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < header.length) continue;
      const lbl = (cols[labelCol]??'').trim().replace(/"/g, '');
      if (!lbl || lbl.toLowerCase() === 'label') continue; // skip contaminated rows
      const feats = keepCols.map(j => {
        const v = parseFloat((cols[j]??'').trim());
        if (isNaN(v)) return 0;
        if (!isFinite(v)) return v > 0 ? 1e9 : -1e9;
        return v;
      });
      featureRows.push(feats);
      labelRows.push(labelMap[lbl] ?? 0);
    }

    if (featureRows.length === 0) throw new Error('No valid rows found in CSV');

    // Cap at 1500 rows for responsive training
    if (featureRows.length > 1500) {
      const idx = Array.from({length: featureRows.length}, (_,i) => i).sort(() => Math.random()-0.5).slice(0,1500);
      featureRows.splice(0, featureRows.length, ...idx.map(i => featureRows[i]));
      labelRows.splice(0, labelRows.length, ...idx.map(i => labelRows[i]));
    }

    this.xs?.dispose(); this.ys?.dispose();

    const rawXs  = tf.tensor2d(featureRows);
    const colMin = rawXs.min(0);
    const colMax = rawXs.max(0);
    const range  = colMax.sub(colMin).add(1e-8);
    this.xs      = rawXs.sub(colMin).div(range) as tf.Tensor2D;
    // FIX: cast labels to float32 (int32 breaks floor() in sparseCategoricalCrossentropy)
    this.ys      = tf.tensor1d(labelRows, 'float32') as tf.Tensor1D;
    rawXs.dispose(); colMin.dispose(); colMax.dispose(); range.dispose();

    this.meta = {
      rows:     featureRows.length,
      features: keepCols.length,
      classes:  Object.keys(labelMap).length,
      labelMap,
    };
    console.log(`[LocalTrainer] Loaded ${this.meta.rows} rows, ${this.meta.features} features, ${this.meta.classes} classes`);
    return this.meta;
  }

  // ── Model ────────────────────────────────────────────────────────────────────
  buildModel(): void {
    if (!this.meta) throw new Error('Call loadCSV before buildModel');
    this.model?.dispose();
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [this.meta.features], units: 128, activation: 'relu', kernelInitializer: 'glorotUniform' }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({ units: 64, activation: 'relu' }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 32, activation: 'relu' }),
        tf.layers.dense({ units: this.meta.classes, activation: this.meta.classes === 2 ? 'sigmoid' : 'softmax' }),
      ],
    });
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss:      this.meta.classes === 2 ? 'binaryCrossentropy' : 'sparseCategoricalCrossentropy',
      metrics:   ['accuracy'],
    });
    console.log(`[LocalTrainer] Model built — ${this.meta.features}→${this.meta.classes}`);
  }

  /** Apply global weights received from server at round start */
  applyGlobalWeights(serialized: SerializedWeights): void {
    if (!this.meta) throw new Error('Call loadCSV before applyGlobalWeights');
    // Store BEFORE rebuild — used by _computeUpdateMetrics after this round's training
    this.prevGlobalW = serialized;

    // FIX BUG 1 + FIX BUG 2 root-cause prevention:
    // Rebuild the model to (a) get a fresh Adam optimizer — stale momentum/
    // variance from prior local training is relative to a different weight
    // space and destabilises training from round 3 onward — and (b) ensure
    // any accumulated TF.js Variable refcount debt is cleared by disposing
    // the old model entirely before applying the new global weights.
    this.buildModel();

    // setWeights() copies data via Variable.assign() so our local tensor
    // handles can be safely disposed immediately after.
    const tensors = serialized.values.map((flat, i) =>
      tf.tensor(flat, serialized.shapes[i])
    );
    this.model!.setWeights(tensors);
    tensors.forEach(t => t.dispose());
    console.log('[LocalTrainer] Global weights applied — fresh optimizer ready');
  }

  // ── Training ─────────────────────────────────────────────────────────────────
  async trainRound(
    epochs    = 3,
    batchSize = 32,
    onEpochEnd?: (epoch: number, logs: tf.Logs) => void,
  ): Promise<RoundMetrics> {
    if (!this.model) throw new Error('No model');
    if (!this.xs || !this.ys) throw new Error('No data');

    const started = Date.now();
    const history = await this.model.fit(this.xs, this.ys, {
      epochs, batchSize, shuffle: true, validationSplit: 0.1,
      // Yield after every batch so Socket.IO pings and poll timers fire
      // during training — prevents Railway TCP idle timeout disconnects.
      yieldEvery: 'batch',
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`[LocalTrainer] Epoch ${epoch+1}/${epochs} loss=${logs?.loss?.toFixed(4)} acc=${logs?.acc?.toFixed(4)}`);
          onEpochEnd?.(epoch, logs as tf.Logs);
        },
      },
    });

    const accuracy = ((history.history['acc'] ?? history.history['accuracy'] ?? [0]).at(-1)) as number;
    const loss     = ((history.history['loss'] ?? [0]).at(-1)) as number;

    // ── Compute updateNorm and updateConsistency (paper Section 3.4) ──────────
    const { updateNorm, updateConsistency } = this._computeUpdateMetrics();

    return { accuracy, loss, datasetSize: this.meta!.rows, durationMs: Date.now()-started, epochsRun: epochs, updateNorm, updateConsistency };
  }

  /** Compute ||w_current − w_global|| / (||w_global|| + ε) and consistency */
  private _computeUpdateMetrics(): { updateNorm: number; updateConsistency: number } {
    if (!this.model || !this.prevGlobalW) {
      return { updateNorm: 1.0, updateConsistency: 1.0 }; // neutral for round 1
    }

    // FIX BUG 1 (cont): read via trainableWeights[].val.dataSync() —
    // no new Tensor object created, no refcount change, no dispose needed.
    const trainableWeights = this.model.trainableWeights;
    const prevValues       = this.prevGlobalW.values;

    let numerator = 0, denominator = 0;
    trainableWeights.forEach((w, tIdx) => {
      const curr = (w.val as tf.Tensor).dataSync();
      const prev = prevValues[tIdx] || [];
      for (let i = 0; i < curr.length; i++) {
        numerator   += (curr[i] - (prev[i] || 0)) ** 2;
        denominator += (prev[i] || 0) ** 2;
      }
    });
    // No dispose() needed — .val IS the Variable, not a copy.

    const updateNorm = Math.sqrt(numerator) / (Math.sqrt(denominator) + 1e-8);

    // Consistency: how stable is this norm compared to the previous round?
    const consistency = this.prevUpdateNorm > 0
      ? Math.max(0, 1 - Math.abs(updateNorm - this.prevUpdateNorm) / (this.prevUpdateNorm + 1e-8))
      : 1.0; // round 1: neutral

    this.prevUpdateNorm = updateNorm;
    return { updateNorm, updateConsistency: consistency };
  }

  // ── Weight extraction ────────────────────────────────────────────────────────
  extractWeights(): SerializedWeights {
    if (!this.model) throw new Error('No model');
    const ws = this.model.getWeights();
    const result: SerializedWeights = { shapes: [], values: [] };
    for (const w of ws) {
      result.shapes.push(w.shape as number[]);
      result.values.push(Array.from(w.dataSync()));
    }
    // FIX BUG 1: do NOT dispose these tensors.
    // In TF.js 4.x/WebGL getWeights() returns read-views of the internal
    // tf.Variable GPU buffers (same DataId). dispose() decrements the
    // buffer refcount; combined with the dispose() inside
    // _computeUpdateMetrics this double-decrements the refcount per round.
    // After 2 rounds the count hits 0, the GPU buffer is freed, and
    // model.fit() silently produces NaN — blocking all further submissions.
    return result;
  }

  // ── Pre-scale by adaptive weight (paper Section 3.4) ─────────────────────────
  /**
   * Multiplies all weight values by the adaptive weight α assigned by the
   * meta-aggregator. Must be called BEFORE applyPairwiseMasks.
   *
   * Mathematical effect:
   *   w_scaled = α × w
   *   After masking: send = α × w + mask
   *   Server sums: Σ(α_i × w_i + mask_i) = Σ(α_i × w_i)  [masks cancel]
   *   Since Σα = 1 (softmax): this equals the adaptive weighted average
   */
  applyAdaptiveWeight(weights: SerializedWeights, alpha: number): SerializedWeights {
    console.log(`[LocalTrainer] Pre-scaling weights by α=${alpha.toFixed(4)}`);
    return {
      shapes: weights.shapes,
      values: weights.values.map(arr => arr.map(v => v * alpha)),
    };
  }

  // ── Pairwise masking ──────────────────────────────────────────────────────────
  applyPairwiseMasks(weights: SerializedWeights, assignments: MaskAssignment[]): SerializedWeights {
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
    console.log(`[LocalTrainer] Applied ${assignments.length} pairwise mask(s)`);
    return masked;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  dispose(): void {
    this.model?.dispose(); this.xs?.dispose(); this.ys?.dispose();
    this.model = null; this.xs = null; this.ys = null;
    this.prevGlobalW = null; this.prevUpdateNorm = 0;
  }

  get isReady(): boolean { return !!this.model && !!this.xs && !!this.ys; }
  get datasetMeta(): ParsedDataset | null { return this.meta; }
}

export const localTrainer = new LocalTrainer();
