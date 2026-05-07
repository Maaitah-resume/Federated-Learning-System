/**
 * localTrainer.ts
 * Place at: frontend/src/services/localTrainer.ts
 *
 * Handles in-browser training (TensorFlow.js) + pairwise mask application.
 *
 * PAIRWISE MASKING PROTOCOL
 * ─────────────────────────
 * For N nodes indexed 0..N-1, for every pair (i, j) where i < j:
 *   - Server generates one shared random seed  s_ij
 *   - Node i  → ADDS    PRG(s_ij, weightShape)   to its weights  ("add" role)
 *   - Node j  → SUBTRACTS PRG(s_ij, weightShape) from its weights ("sub" role)
 *
 * When the meta-aggregator sums all N masked submissions:
 *   Sum = Σ w_k  +  Σ_{i<j} ( +mask_ij - mask_ij )
 *       = Σ w_k                ← masks cancel perfectly
 *   Global = Sum / N
 *
 * Raw data NEVER leaves the browser.
 * Only masked weight arrays reach the server.
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
  accuracy:    number;
  loss:        number;
  datasetSize: number;
  durationMs:  number;
  epochsRun:   number;
}

/** Serialised weight tensors — what we send over the wire */
export interface SerializedWeights {
  shapes: number[][];   // shape of every weight tensor
  values: number[][];   // flat Float32 values for every tensor
}

/** One pairwise mask assignment issued by the server for this node */
export interface MaskAssignment {
  peerId: string;       // the other node in this pair
  seed:   number;       // shared PRNG seed (same seed on both sides)
  role:   'add' | 'sub'; // 'add' if our index < peer index, else 'sub'
}

// ─── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────
//
// Deterministic, seedable PRNG — identical algorithm runs on the server
// (federatedOrchestrator.js) so both sides produce the exact same mask
// from the same seed without communicating the mask values themselves.

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a flat mask array of `length` values in the range
 * [-MASK_SCALE, +MASK_SCALE] using the seeded PRNG.
 * Using a small scale keeps masks the same order of magnitude as
 * typical neural network weights (no float32 overflow on sum).
 */
const MASK_SCALE = 0.5;

function generateFlatMask(seed: number, length: number): number[] {
  const rng  = mulberry32(seed);
  const mask = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    mask[i] = (rng() * 2 - 1) * MASK_SCALE; // uniform in [-0.5, +0.5]
  }
  return mask;
}

// ─── LocalTrainer ─────────────────────────────────────────────────────────────

export class LocalTrainer {
  private model: tf.LayersModel | null = null;
  private xs:    tf.Tensor2D   | null = null;
  private ys:    tf.Tensor1D   | null = null;
  private meta:  ParsedDataset | null = null;

  // ── CSV loading ─────────────────────────────────────────────────────────

  /** Parses a CSV File in-browser. Last column = label. Raw data never leaves. */
  async loadCSV(file: File): Promise<ParsedDataset> {
    const text  = await file.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV too small (need header + data rows)');

    const header   = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
    const labelCol = header.length - 1;

    // Build label → int map
    const labelSet = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      labelSet.add(cols[labelCol]?.trim().replace(/"/g, '') || 'UNKNOWN');
    }
    const labelMap: Record<string, number> = {};
    [...labelSet].sort().forEach((lbl, idx) => { labelMap[lbl] = idx; });

    // Build feature matrix + label vector
    const featureCols = labelCol;
    const featureRows: number[][] = [];
    const labelRows:   number[]   = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < header.length) continue;

      const feats: number[] = [];
      let valid = true;
      for (let j = 0; j < featureCols; j++) {
        const v = parseFloat(cols[j]);
        if (!isFinite(v)) { valid = false; break; }
        feats.push(v);
      }
      if (!valid) continue;

      const lbl = cols[labelCol]?.trim().replace(/"/g, '') || 'UNKNOWN';
      featureRows.push(feats);
      labelRows.push(labelMap[lbl] ?? 0);
    }

    if (featureRows.length === 0) throw new Error('No valid rows found in CSV');

    // Dispose old tensors
    this.xs?.dispose();
    this.ys?.dispose();

    // Min-max normalise per column
    const rawXs  = tf.tensor2d(featureRows);
    const colMin = rawXs.min(0);
    const colMax = rawXs.max(0);
    const range  = colMax.sub(colMin).add(1e-8);
    this.xs = rawXs.sub(colMin).div(range) as tf.Tensor2D;
    this.ys = tf.tensor1d(labelRows, 'int32') as tf.Tensor1D;
    rawXs.dispose(); colMin.dispose(); colMax.dispose(); range.dispose();

    this.meta = {
      rows:     featureRows.length,
      features: featureCols,
      classes:  Object.keys(labelMap).length,
      labelMap,
    };

    console.log(`[LocalTrainer] Loaded ${this.meta.rows} rows, ${this.meta.features} features, ${this.meta.classes} classes`);
    return this.meta;
  }

  // ── Model ───────────────────────────────────────────────────────────────

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

  /** Apply global weights from the server before local training */
  applyGlobalWeights(serialized: SerializedWeights): void {
    if (!this.model) throw new Error('Build model first');
    const tensors = serialized.values.map((flat, i) => tf.tensor(flat, serialized.shapes[i]));
    this.model.setWeights(tensors);
    tensors.forEach((t) => t.dispose());
  }

  // ── Training ─────────────────────────────────────────────────────────────

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
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`[LocalTrainer] Epoch ${epoch + 1}/${epochs} loss=${logs?.loss?.toFixed(4)} acc=${logs?.acc?.toFixed(4)}`);
          onEpochEnd?.(epoch, logs as tf.Logs);
        },
      },
    });

    return {
      accuracy:    history.history['acc'].at(-1)  as number,
      loss:        history.history['loss'].at(-1) as number,
      datasetSize: this.meta!.rows,
      durationMs:  Date.now() - started,
      epochsRun:   epochs,
    };
  }

  // ── Weight extraction ────────────────────────────────────────────────────

  /** Get raw (un-masked) weights as serialisable arrays */
  extractWeights(): SerializedWeights {
    if (!this.model) throw new Error('No model');
    const ws = this.model.getWeights();
    const result: SerializedWeights = { shapes: [], values: [] };
    for (const w of ws) {
      result.shapes.push(w.shape as number[]);
      result.values.push(Array.from(w.dataSync()));
    }
    ws.forEach((w) => w.dispose());
    return result;
  }

  // ── Pairwise masking ──────────────────────────────────────────────────────

  /**
   * Applies all pairwise masks to a set of weights and returns the
   * masked version ready for submission to the meta-aggregator.
   *
   * For each mask assignment:
   *   role='add' → masked[i] = w[i] + mask[i]     (our index < peer index)
   *   role='sub' → masked[i] = w[i] - mask[i]     (our index > peer index)
   *
   * Masks are generated deterministically from the shared seed using
   * the same Mulberry32 PRNG that runs on the server — so both sides
   * produce identical masks without ever transmitting them.
   */
  applyPairwiseMasks(
    weights:     SerializedWeights,
    assignments: MaskAssignment[],
  ): SerializedWeights {
    // Deep-copy values so we don't mutate the original
    const masked: SerializedWeights = {
      shapes: weights.shapes,
      values: weights.values.map((arr) => [...arr]),
    };

    for (const { seed, role } of assignments) {
      // Walk through each tensor's flat values and add/subtract the mask
      let tensorOffset = 0; // we use a single sequential PRNG pass across all tensors
      const rng = mulberry32(seed);

      for (let t = 0; t < masked.values.length; t++) {
        const flat = masked.values[t];
        for (let i = 0; i < flat.length; i++) {
          const maskVal = (rng() * 2 - 1) * MASK_SCALE;
          flat[i] = role === 'add' ? flat[i] + maskVal : flat[i] - maskVal;
        }
        tensorOffset += flat.length;
      }
    }

    console.log(`[LocalTrainer] Applied ${assignments.length} pairwise mask(s)`);
    return masked;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.model?.dispose(); this.xs?.dispose(); this.ys?.dispose();
    this.model = null; this.xs = null; this.ys = null;
  }

  get isReady(): boolean { return !!this.model && !!this.xs && !!this.ys; }
  get datasetMeta(): ParsedDataset | null { return this.meta; }
}

export const localTrainer = new LocalTrainer();
