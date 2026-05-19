/**
 * localTrainer.ts — frontend/src/services/localTrainer.ts
 *
 * COMPLETE REWRITE.
 *
 * The old proxy used a single _resolve/_reject pair, which caused deadlocks
 * when two messages were in flight. The new design uses request IDs so an
 * arbitrary number of operations can be in flight simultaneously (in practice
 * we only need 1, but the bug was that even 1 hung if the slot got overwritten
 * by a spurious message).
 *
 * Public API is identical to the previous version so Queue.tsx does not need
 * any code changes (only the new `globalSchema` parameter on loadCSV, which
 * has a sensible default for backwards compatibility).
 *
 * KEY ADDITIONS:
 *   - request ID correlation         (fixes deadlock)
 *   - heartbeat with auto-recovery   (fixes silent worker death)
 *   - operation timeout (90 s)       (fixes promises hanging forever)
 *   - globalSchema parameter         (fixes heterogeneous label sets)
 */

import TrainingWorkerClass from './trainingWorker?worker';

// ── Public types ─────────────────────────────────────────────────────────────
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
export interface SerializedWeights { shapes: number[][]; values: number[][] }
export interface MaskAssignment    { peerId: string; seed: number; role: 'add' | 'sub' }

// ── Pending request bookkeeping ──────────────────────────────────────────────
interface PendingRequest {
  resolve:   (v: any) => void;
  reject:    (e: any) => void;
  timer:     ReturnType<typeof setTimeout>;
  onEpoch?:  (epoch: number, logs: any) => void;
  type:      string;
}

const OP_TIMEOUT_MS    = 120_000;   // 2 minutes per operation
const HEARTBEAT_MS     = 15_000;    // ping the worker every 15 s
const HEARTBEAT_DEADLINE_MS = 30_000;  // expect a PONG within 30 s

export class LocalTrainer {
  private worker: Worker;
  private _isReady = false;
  private _meta: ParsedDataset | null = null;
  private _csvText: string | null = null;
  private _csvName: string | null = null;
  private _lastSchema: string[] | null = null;

  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private lastPongAt = Date.now();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private deadCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.worker = this._createWorker();
    this._startHeartbeat();
  }

  // ── Worker lifecycle ─────────────────────────────────────────────────────────
  private _createWorker(): Worker {
    const w = new TrainingWorkerClass();
    w.onmessage = (e) => this._handleMessage(e);
    w.onerror   = (e) => {
      console.error('[LocalTrainer] worker.onerror:', e.message);
      this._rejectAllPending(new Error(`Worker error: ${e.message}`));
    };
    this.lastPongAt = Date.now();
    return w;
  }

  private _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const id = this._nextId();
      try { this.worker.postMessage({ id, type: 'PING' }); }
      catch (e) { console.warn('[LocalTrainer] heartbeat post failed:', e); }
    }, HEARTBEAT_MS);

    this.deadCheckTimer = setInterval(() => {
      const since = Date.now() - this.lastPongAt;
      if (since > HEARTBEAT_DEADLINE_MS) {
        console.error(`[LocalTrainer] Worker unresponsive for ${since}ms — recreating`);
        this._recoverWorker();
      }
    }, HEARTBEAT_MS);
  }

  private async _recoverWorker() {
    this._rejectAllPending(new Error('Worker unresponsive — recreated'));
    try { this.worker.terminate(); } catch {}
    this._isReady = false;
    this.worker = this._createWorker();
    // Auto-restore the CSV if we have one cached
    if (this._csvText && this._csvName && this._lastSchema) {
      try {
        const blob = new Blob([this._csvText], { type: 'text/csv' });
        await this.loadCSV(new File([blob], this._csvName, { type: 'text/csv' }), this._lastSchema);
        console.log('[LocalTrainer] Worker recovered — CSV restored');
      } catch (e) {
        console.error('[LocalTrainer] CSV restore after recovery failed:', e);
      }
    }
  }

  private _rejectAllPending(err: Error) {
    for (const [id, p] of this.pending.entries()) {
      clearTimeout(p.timer);
      try { p.reject(err); } catch {}
      this.pending.delete(id);
    }
  }

  // ── Message handling ─────────────────────────────────────────────────────────
  private _handleMessage(e: MessageEvent) {
    const { id, type, payload } = e.data;

    // Heartbeat PONG — update liveness clock and exit (no pending entry)
    if (type === 'PONG') {
      this.lastPongAt = Date.now();
      return;
    }

    const p = this.pending.get(id);
    if (!p) {
      // Late message after timeout/recovery — safe to ignore
      return;
    }

    // Progress event during training — call the onEpoch callback but don't resolve
    if (type === 'EPOCH_END' && p.onEpoch) {
      try { p.onEpoch(payload.epoch, payload.logs); } catch {}
      return;
    }

    // Terminal message: OK or ERROR
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (type === 'ERROR') {
      p.reject(new Error(payload?.message || 'Unknown worker error'));
    } else {
      p.resolve(payload);
    }
  }

  // ── Request helper ───────────────────────────────────────────────────────────
  private _nextId(): string {
    return `r${this.nextId++}`;
  }

  private _send<T>(type: string, payload?: any, onEpoch?: (e: number, l: any) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this._nextId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Worker operation '${type}' timed out after ${OP_TIMEOUT_MS}ms`));
      }, OP_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer, onEpoch, type });
      try {
        this.worker.postMessage({ id, type, payload });
      } catch (err: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`postMessage failed: ${err?.message}`));
      }
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Load a CSV with a global label schema.
   * Every client in a federation must call this with the SAME schema so the
   * output layers match exactly.
   */
  async loadCSV(file: File, globalSchema?: string[]): Promise<ParsedDataset> {
    const csvText = await file.text();
    this._csvText = csvText;
    this._csvName = file.name;
    this._isReady = false;

    // If no schema provided, derive one from the local CSV (legacy behaviour).
    // This is only safe when all clients have the same labels — the new
    // schema endpoint provides one globally agreed list.
    const schema = globalSchema ?? this._deriveLocalSchema(csvText);
    this._lastSchema = schema;

    const meta = await this._send<ParsedDataset>('LOAD_CSV', { csvText, schema });
    this._meta = meta;
    this._isReady = true;
    return meta;
  }

  private _deriveLocalSchema(csvText: string): string[] {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return ['BENIGN', 'OTHER'];
    const header = lines[0].split(',');
    const labelCol = header.length - 1;
    const set = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const lbl = (cols[labelCol] ?? '').trim().replace(/"/g, '');
      const norm = lbl.toLowerCase();
      if (norm && norm !== 'label' && norm !== 'null' && norm !== 'nan') set.add(lbl);
    }
    const arr = [...set].sort();
    if (!arr.includes('OTHER')) arr.push('OTHER');
    return arr;
  }

  buildModel(): void { /* worker manages model lifecycle internally */ }

  async applyGlobalWeights(serialized: SerializedWeights): Promise<void> {
    await this._send<void>('APPLY_WEIGHTS', { serializedWeights: serialized });
  }

  async trainRound(
    epochs    = 3,
    batchSize = 32,
    onEpochEnd?: (epoch: number, logs: any) => void,
  ): Promise<RoundMetrics> {
    return this._send<RoundMetrics>('TRAIN', { epochs, batchSize }, onEpochEnd);
  }

  async extractWeights(): Promise<SerializedWeights> {
    return this._send<SerializedWeights>('EXTRACT_WEIGHTS');
  }

  async applyAdaptiveWeight(weights: SerializedWeights, alpha: number): Promise<SerializedWeights> {
    return this._send<SerializedWeights>('APPLY_ALPHA', { weights, alpha });
  }

  async applyPairwiseMasks(weights: SerializedWeights, assignments: MaskAssignment[]): Promise<SerializedWeights> {
    return this._send<SerializedWeights>('APPLY_MASKS', { weights, assignments });
  }

  dispose(): void {
    try { this.worker.postMessage({ id: this._nextId(), type: 'DISPOSE' }); } catch {}
    this._isReady = false;
    this._meta    = null;
  }

  get isReady(): boolean { return this._isReady; }
  get datasetMeta(): ParsedDataset | null { return this._meta; }
}

export const localTrainer = new LocalTrainer();
