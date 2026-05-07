/**
 * Queue.tsx
 * Place at: frontend/src/pages/Queue.tsx
 *
 * Full pairwise-masking FL flow:
 *  1. User loads CSV locally (never uploaded)
 *  2. WS event `round:started` triggers local training
 *  3. Node fetches its mask assignments from server
 *  4. Applies pairwise masks to weights (masks cancel on server sum)
 *  5. Submits MASKED weights + plain metrics to server
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, Loader2, CheckCircle2, Monitor, Shield,
  Upload, FileText, X, Zap, Brain, Send, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient }   from '../config/api';
import { useQueue }    from '../context/QueueContext';
import { useSocket }   from '../context/SocketContext';
import { localTrainer, MaskAssignment } from '../services/localTrainer';

// ─── Types ────────────────────────────────────────────────────────────────────

type TrainingPhase = 'idle' | 'loading' | 'waiting' | 'training' | 'masking' | 'submitting' | 'done';

interface TrainingStatus {
  phase:       TrainingPhase;
  round:       number;
  epoch:       number;
  totalEpochs: number;
  accuracy:    number | null;
  loss:        number | null;
  message:     string;
}

interface SubmissionTracker {
  received: number;
  expected: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Queue() {
  const { queue, inQueue, loading, refresh } = useQueue();
  const socket = useSocket();

  const [joining,     setJoining]     = useState(false);
  const [leaving,     setLeaving]     = useState(false);
  const [dragOver,    setDragOver]    = useState(false);
  const [file,        setFile]        = useState<File | null>(null);
  const [dataReady,   setDataReady]   = useState(false);
  const [dataInfo,    setDataInfo]    = useState<{ rows: number; features: number; classes: number } | null>(null);
  const [parseError,  setParseError]  = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionTracker | null>(null);

  const [status, setStatus] = useState<TrainingStatus>({
    phase: 'idle', round: 0, epoch: 0, totalEpochs: 3,
    accuracy: null, loss: null, message: '',
  });

  const isTrainingRef = useRef(false);

  const currentId: string | null = (() => {
    try { const s = localStorage.getItem('fl_participant'); return s ? JSON.parse(s) : null; }
    catch { return null; }
  })();

  const activeJob    = queue.activeJob;
  const isJobRunning = !!activeJob;
  const roundPct     = isJobRunning
    ? Math.round((activeJob.currentRound / activeJob.totalRounds) * 100) : 0;
  const MIN_REQUIRED = queue.minRequired || 2;
  const slotsLeft    = Math.max(0, MIN_REQUIRED - queue.count);

  // ── Parse CSV locally ──────────────────────────────────────────────────────
  const handleFileSelect = useCallback(async (selected: File) => {
    setFile(selected); setParseError(null); setDataReady(false); setDataInfo(null);
    setStatus((s) => ({ ...s, phase: 'loading', message: 'Parsing CSV in your browser…' }));
    try {
      const meta = await localTrainer.loadCSV(selected);
      localTrainer.buildModel();
      setDataReady(true);
      setDataInfo({ rows: meta.rows, features: meta.features, classes: meta.classes });
      setStatus((s) => ({ ...s, phase: 'idle', message: '' }));
    } catch (err: any) {
      setParseError(err.message || 'Failed to parse CSV');
      setStatus((s) => ({ ...s, phase: 'idle', message: '' }));
    }
  }, []);

  // ── Full round: train → fetch masks → mask weights → submit ───────────────
  const runLocalRound = useCallback(async (event: {
    jobId: string; round: number; totalRounds: number; globalWeights: any | null;
  }) => {
    if (isTrainingRef.current || !localTrainer.isReady) return;
    isTrainingRef.current = true;
    const EPOCHS = 3;

    try {
      // 1. Apply global weights from previous round (skip on round 1)
      if (event.globalWeights) {
        localTrainer.applyGlobalWeights(event.globalWeights);
      }

      // 2. Train locally
      setStatus({
        phase: 'training', round: event.round, epoch: 0, totalEpochs: EPOCHS,
        accuracy: null, loss: null,
        message: `Round ${event.round}/${event.totalRounds} — training on local data…`,
      });

      const metrics = await localTrainer.trainRound(EPOCHS, 32, (epoch, logs) => {
        setStatus((s) => ({
          ...s, epoch: epoch + 1,
          accuracy: logs?.acc  ?? null,
          loss:     logs?.loss ?? null,
          message: `Epoch ${epoch + 1}/${EPOCHS} — acc: ${((logs?.acc || 0) * 100).toFixed(1)}%`,
        }));
      });

      // 3. Extract raw weights
      const rawWeights = localTrainer.extractWeights();

      // 4. Fetch pairwise mask assignments from server
      setStatus((s) => ({ ...s, phase: 'masking', message: 'Fetching pairwise masks…' }));
      const maskRes = await apiClient.get<{ assignments: MaskAssignment[] }>('/api/federated/masks');
      const assignments = maskRes.data.assignments;

      // 5. Apply pairwise masks locally (masks cancel on server sum)
      const maskedWeights = localTrainer.applyPairwiseMasks(rawWeights, assignments);

      // 6. Submit masked weights + plain metrics
      setStatus((s) => ({ ...s, phase: 'submitting', message: 'Submitting masked weights…' }));
      await apiClient.post('/api/federated/submit', {
        jobId:         event.jobId,
        round:         event.round,
        maskedWeights,   // ← server never sees un-masked weights
        metrics,         // ← plain accuracy/loss/datasetSize (not sensitive)
      });

      setStatus((s) => ({
        ...s, phase: 'waiting',
        accuracy: metrics.accuracy, loss: metrics.loss,
        message: `Round ${event.round} submitted — waiting for other nodes…`,
      }));

    } catch (err: any) {
      console.error('[Queue] Round error:', err);
      setStatus((s) => ({ ...s, phase: 'idle', message: `Error: ${err.message}` }));
    } finally {
      isTrainingRef.current = false;
    }
  }, []);

  // ── WebSocket events ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onRoundStarted = (data: any) => {
      console.log('[Queue] round:started', data);
      if (inQueue) runLocalRound(data);
    };

    const onWeightsSub = (data: SubmissionTracker) => setSubmissions(data);

    const onComplete = () => {
      setStatus({ phase: 'done', round: 0, epoch: 0, totalEpochs: 3, accuracy: null, loss: null, message: 'Training complete!' });
      localTrainer.dispose();
      refresh();
    };

    socket.on('round:started',     onRoundStarted);
    socket.on('weights:submitted', onWeightsSub);
    socket.on('training:complete', onComplete);
    return () => {
      socket.off('round:started',     onRoundStarted);
      socket.off('weights:submitted', onWeightsSub);
      socket.off('training:complete', onComplete);
    };
  }, [socket, inQueue, runLocalRound, refresh]);

  // ── Queue join / leave ─────────────────────────────────────────────────────
  const joinQueue = async () => {
    if (!dataReady) return;
    setJoining(true);
    try {
      await apiClient.post('/api/queue/join');
      await refresh();
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.message || '';
      if (err.response?.status === 409 || msg.toLowerCase().includes('already')) { await refresh(); return; }
      alert(msg || 'Failed to join queue');
    } finally { setJoining(false); }
  };

  const leaveQueue = async () => {
    setLeaving(true);
    try { await apiClient.post('/api/queue/leave'); await refresh(); }
    catch (err) { console.error(err); }
    finally { setLeaving(false); }
  };

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation(); setFile(null); setDataReady(false);
    setDataInfo(null); setParseError(null); localTrainer.dispose();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  const phaseStyle: Record<TrainingPhase, string> = {
    idle:       'bg-slate-100 text-slate-500',
    loading:    'bg-amber-50 text-amber-600',
    waiting:    'bg-indigo-50 text-indigo-600',
    training:   'bg-emerald-50 text-emerald-700',
    masking:    'bg-violet-50 text-violet-700',
    submitting: 'bg-blue-50 text-blue-600',
    done:       'bg-emerald-100 text-emerald-800',
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Node Waiting Room</h1>
        <p className="text-slate-500 mt-1">Your data stays on your device. Only pairwise-masked weight updates are shared.</p>
      </header>

      {/* Active job banner */}
      <AnimatePresence>
        {isJobRunning && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="bg-gradient-to-r from-indigo-600 to-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-indigo-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                <Zap size={24} className="animate-pulse" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">🔐 Pairwise-Masked Federated Training</h3>
                <p className="text-sm text-white/80">Job <span className="font-mono">{activeJob.jobId.slice(0, 8)}</span> · <span className="font-bold uppercase">{activeJob.status}</span></p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/70 uppercase tracking-widest">Round</p>
                <p className="text-3xl font-black">{activeJob.currentRound}<span className="text-lg font-normal text-white/60"> / {activeJob.totalRounds}</span></p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-white/70"><span>Training Progress</span><span>{roundPct}%</span></div>
              <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
                <motion.div className="h-full bg-white rounded-full" animate={{ width: `${roundPct}%` }} transition={{ duration: 0.5 }} />
              </div>
              <div className="flex justify-between text-xs text-white/60 pt-1">
                {Array.from({ length: activeJob.totalRounds }, (_, i) => i + 1).map((r) => (
                  <span key={r} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${r <= activeJob.currentRound ? 'bg-white text-indigo-700' : 'bg-white/20 text-white/40'}`}>{r}</span>
                ))}
              </div>
            </div>

            {submissions && (
              <div className="mt-3 pt-3 border-t border-white/20 text-xs text-white/80 flex items-center gap-2">
                <Send size={12} /> Masked submissions received: <span className="font-bold">{submissions.received}/{submissions.expected}</span> nodes
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">

          {/* Step 1 — Load data locally */}
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">1</div>
              <h3 className="font-bold text-slate-900">Load Private Data</h3>
            </div>
            <div onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-colors cursor-pointer ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}
              onClick={() => document.getElementById('file-input')?.click()}>
              <input id="file-input" type="file" className="hidden" accept=".csv"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />

              {status.phase === 'loading' ? (
                <div className="flex flex-col items-center gap-2 text-indigo-600">
                  <Loader2 className="animate-spin" size={28} />
                  <p className="text-sm font-medium">Parsing locally…</p>
                  <p className="text-xs text-slate-400">Never leaves your device</p>
                </div>
              ) : file ? (
                <div className="space-y-2">
                  {dataReady && (
                    <div className="flex items-center justify-center gap-2 text-emerald-700 bg-emerald-50 rounded-xl px-3 py-1.5 text-xs font-semibold">
                      <CheckCircle2 size={13} /> Ready — stays local
                    </div>
                  )}
                  {parseError && <div className="text-red-500 bg-red-50 rounded-xl px-3 py-2 text-xs">⚠ {parseError}</div>}
                  <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-indigo-700">
                      <FileText size={18} />
                      <div className="text-left">
                        <span className="text-sm font-medium block truncate max-w-[130px]">{file.name}</span>
                        {dataInfo && <span className="text-xs text-indigo-400">{dataInfo.rows.toLocaleString()} rows · {dataInfo.features} features · {dataInfo.classes} classes</span>}
                      </div>
                    </div>
                    <button onClick={clearFile} className="text-slate-400 hover:text-red-500"><X size={16} /></button>
                  </div>
                </div>
              ) : (
                <><Upload size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm text-slate-500">Drop your CSV here</p>
                  <p className="text-xs text-slate-400 mt-1">Parsed in browser — never uploaded</p>
                </>
              )}
            </div>
          </div>

          {/* Step 2 — Join / training status */}
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 text-center relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 ${isJobRunning ? 'bg-gradient-to-r from-indigo-600 to-emerald-500' : 'bg-indigo-600'}`} />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">2</div>
              <h3 className="font-bold text-slate-900">{isJobRunning ? 'Training Active' : 'Join Waiting Room'}</h3>
            </div>

            {isJobRunning ? (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
                <p className="text-5xl font-black text-indigo-700">
                  {activeJob.currentRound}
                  <span className="text-2xl font-normal text-slate-400"> / {activeJob.totalRounds}</span>
                </p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Current Round</p>

                {/* Phase indicator */}
                {inQueue && status.phase !== 'idle' && (
                  <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${phaseStyle[status.phase]}`}>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      {status.phase === 'training'   && <Brain   size={15} className="animate-pulse" />}
                      {status.phase === 'masking'    && <Lock    size={15} className="animate-pulse" />}
                      {status.phase === 'submitting' && <Send    size={15} className="animate-pulse" />}
                      {status.phase === 'waiting'    && <Loader2 size={15} className="animate-spin" />}
                      <span>{status.message}</span>
                    </div>

                    {/* Epoch progress bar (only during training) */}
                    {status.phase === 'training' && status.totalEpochs > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs opacity-70 mb-1">
                          <span>Epoch {status.epoch}/{status.totalEpochs}</span>
                          {status.accuracy != null && <span>acc {(status.accuracy * 100).toFixed(1)}%</span>}
                        </div>
                        <div className="h-1.5 bg-black/10 rounded-full overflow-hidden">
                          <motion.div className="h-full bg-current rounded-full opacity-60"
                            animate={{ width: `${(status.epoch / status.totalEpochs) * 100}%` }}
                            transition={{ duration: 0.3 }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Round progress bar */}
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-indigo-600 to-emerald-500 rounded-full"
                    animate={{ width: `${roundPct}%` }} transition={{ duration: 0.5 }} />
                </div>
                <p className="text-xs text-slate-400">Weights are masked before leaving your device.</p>
              </motion.div>
            ) : (
              <>
                <motion.p key={queue.count} initial={{ scale: 1.2, color: '#4f46e5' }} animate={{ scale: 1, color: '#0f172a' }}
                  className="text-5xl font-black mb-1">
                  {loading ? '...' : `${queue.count} / ${MIN_REQUIRED}`}
                </motion.p>
                <p className="text-slate-500 font-medium uppercase tracking-widest text-xs mb-4">Active Participants</p>

                {inQueue && slotsLeft > 0 && (
                  <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
                    Need {slotsLeft} more {slotsLeft === 1 ? 'participant' : 'participants'} to start
                  </div>
                )}

                <AnimatePresence mode="wait">
                  {!inQueue ? (
                    <motion.button key="join"
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      onClick={joinQueue} disabled={joining || !dataReady}
                      title={!dataReady ? 'Load your CSV first' : ''}
                      className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                      {joining ? <span className="flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={20} /> Joining...</span> : 'Join Waiting Room'}
                    </motion.button>
                  ) : (
                    <motion.div key="waiting"
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      className="space-y-3">
                      <div className="flex items-center justify-center gap-3 text-emerald-600 font-bold bg-emerald-50 py-4 rounded-2xl">
                        <CheckCircle2 size={20} /> You are in the queue
                      </div>
                      <div className="flex items-center justify-center gap-2 text-slate-400 text-sm">
                        <Loader2 className="animate-spin" size={16} /> Waiting for {slotsLeft} more…
                      </div>
                      <button onClick={leaveQueue} disabled={leaving}
                        className="w-full border border-red-200 text-red-500 py-3 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-50">
                        {leaving ? 'Leaving…' : 'Leave Queue'}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                {!dataReady && !inQueue && <p className="text-xs text-slate-400 mt-3">⬆ Load your CSV first</p>}
              </>
            )}
          </div>

          {/* Privacy card */}
          <div className="bg-slate-900 p-6 rounded-[2rem] text-white">
            <Shield className="text-indigo-400 mb-3" size={28} />
            <h3 className="text-base font-bold mb-1">Pairwise Masking</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Before submission, your weights are masked using a shared random seed with each peer node.
              Masks cancel perfectly when the server sums all contributions — your individual weights are never visible.
            </p>
          </div>
        </div>

        {/* Connected nodes panel */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{isJobRunning ? 'Training Nodes' : 'Connected Nodes'}</h2>
                {isJobRunning && <p className="text-xs text-slate-400 mt-0.5">Round {activeJob.currentRound} of {activeJob.totalRounds} — {activeJob.status}</p>}
              </div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full animate-pulse ${isJobRunning ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
                {isJobRunning ? 'Training' : 'Live Feed'}
              </span>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-3" size={24} />Loading nodes…</div>
            ) : queue.companies.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Users size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">No nodes connected yet</p>
                <p className="text-sm mt-1">Load your data and join to be first!</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {queue.companies.map((node, i) => (
                  <motion.div key={node.companyId}
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className={`p-6 flex items-center justify-between ${node.companyId === currentId ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isJobRunning ? 'bg-indigo-100 text-indigo-500' : 'bg-slate-100 text-slate-400'}`}>
                        <Monitor size={24} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">
                          {node.companyName || node.companyId}
                          {node.companyId === currentId && <span className="ml-2 text-xs text-indigo-500 font-normal">(you)</span>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {isJobRunning ? `Round ${activeJob.currentRound} / ${activeJob.totalRounds}` : `Joined ${new Date(node.joinedAt).toLocaleTimeString()}`}
                        </p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${isJobRunning ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isJobRunning ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
                      {isJobRunning ? activeJob.status.toLowerCase() : 'ready'}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {isJobRunning ? (
              <div className="p-4 bg-indigo-50 border-t border-indigo-100">
                <div className="flex justify-between text-xs text-indigo-600 font-medium mb-2">
                  <span>Overall Progress</span>
                  <span>{roundPct}% · Round {activeJob.currentRound}/{activeJob.totalRounds}</span>
                </div>
                <div className="h-1.5 bg-indigo-200 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-indigo-600 rounded-full" animate={{ width: `${roundPct}%` }} transition={{ duration: 0.5 }} />
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 text-center text-xs text-slate-400">
                {queue.companies.length} nodes connected · refreshes every 3s
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
