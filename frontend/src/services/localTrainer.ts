/**
 * localTrainer.ts — frontend/src/services/localTrainer.ts
 *
 * Thin proxy to trainingWorker.ts.
 *
 * The PUBLIC API is identical to the old localTrainer — Queue.tsx requires
 * zero changes. All TF.js work (loadCSV, buildModel, trainRound, masking)
 * now runs in a Web Worker on a separate OS thread, keeping the main thread
 * fully responsive throughout training.
 *
 * See trainingWorker.ts for the full implementation and the explanation of
 * why offloading to a worker fixes the round-2 stall permanently.
 */

// Vite's ?worker suffix bundles trainingWorker.ts as a Web Worker module
import TrainingWorkerClass from './trainingWorker?worker';

// ─── Public types (unchanged — Queue.tsx imports these) ───────────────────────
export interface ParsedDataset {
  rows:           number;
  features:       number;
  classes:        number;
  labelMap:       Record<string, number>;
  droppedColumns: string[];
}

export interface RoundMetrics {
  accuracy:          number;
  loss:              number;
  datasetSize:       number;
  durationMs:        number;
  epochsRun:         number;
  updateNorm:        number;
  updateConsistency: number;
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

// ─── LocalTrainer (worker proxy) ──────────────────────────────────────────────
export class LocalTrainer {
  private worker:   Worker;
  private _isReady: boolean = false;
  private _meta:    ParsedDataset | null = null;

  // One pending promise slot per operation — operations are sequential
  private _resolve:    ((v: any) => void) | null = null;
  private _reject:     ((e: any) => void) | null = null;
  private _onEpochEnd: ((epoch: number, logs: any) => void) | null = null;

  constructor() {
    this.worker = new TrainingWorkerClass();
    this.worker.onmessage = this._handleMessage.bind(this);
    this.worker.onerror   = (e) => {
      console.error('[LocalTrainer] Worker error:', e.message);
      this._reject?.(new Error(e.message));
      this._resolve = null;
      this._reject  = null;
    };
  }

  private _handleMessage(e: MessageEvent) {
    const { type, payload } = e.data;
    switch (type) {
      case 'CSV_LOADED':
        this._meta    = payload;
        this._isReady = true;
        this._resolve?.(payload);
        break;
      case 'WEIGHTS_APPLIED':
        this._resolve?.(undefined);
        break;
      case 'EPOCH_END':
        this._onEpochEnd?.(payload.epoch, payload.logs);
        return; // don't clear resolver — training still in progress
      case 'TRAIN_COMPLETE':
        this._resolve?.(payload);
        break;
      case 'WEIGHTS_READY':
        this._resolve?.(payload);
        break;
      case 'ALPHA_APPLIED':
        this._resolve?.(payload);
        break;
      case 'MASKS_APPLIED':
        this._resolve?.(payload);
        break;
      case 'ERROR':
        this._reject?.(new Error(payload.message));
        break;
      default:
        return;
    }
    this._resolve    = null;
    this._reject     = null;
    this._onEpochEnd = null;
  }

  private _send<T>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject  = reject;
      this.worker.postMessage(msg);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async loadCSV(file: File): Promise<ParsedDataset> {
    const csvText = await file.text();
    this._isReady = false;
    const meta = await this._send<ParsedDataset>({
      type: 'LOAD_CSV',
      payload: { csvText, fileName: file.name },
    });
    this._meta = meta;
    return meta;
  }

  // buildModel is kept for API compatibility — the worker manages the model
  // lifecycle internally (builds after loadCSV and after applyGlobalWeights)
  buildModel(): void {}

  async applyGlobalWeights(serialized: SerializedWeights): Promise<void> {
    await this._send<void>({
      type: 'APPLY_WEIGHTS',
      payload: { serializedWeights: serialized },
    });
  }

  async trainRound(
    epochs    = 3,
    batchSize = 32,
    onEpochEnd?: (epoch: number, logs: any) => void,
  ): Promise<RoundMetrics> {
    this._onEpochEnd = onEpochEnd ?? null;
    return this._send<RoundMetrics>({
      type: 'TRAIN',
      payload: { epochs, batchSize },
    });
  }

  async extractWeights(): Promise<SerializedWeights> {
    return this._send<SerializedWeights>({ type: 'EXTRACT_WEIGHTS' });
  }

  async applyAdaptiveWeight(weights: SerializedWeights, alpha: number): Promise<SerializedWeights> {
    return this._send<SerializedWeights>({
      type: 'APPLY_ALPHA',
      payload: { weights, alpha },
    });
  }

  async applyPairwiseMasks(weights: SerializedWeights, assignments: MaskAssignment[]): Promise<SerializedWeights> {
    return this._send<SerializedWeights>({
      type: 'APPLY_MASKS',
      payload: { weights, assignments },
    });
  }

  dispose(): void {
    this.worker.postMessage({ type: 'DISPOSE' });
    this._isReady = false;
    this._meta    = null;
  }

  get isReady(): boolean { return this._isReady; }
  get datasetMeta(): ParsedDataset | null { return this._meta; }
}

export const localTrainer = new LocalTrainer();
