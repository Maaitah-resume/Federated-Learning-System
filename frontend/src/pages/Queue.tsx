import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, Loader2, CheckCircle2, Monitor, Shield,
  Upload, FileText, X, Zap, Brain, Send, Lock, AlertTriangle, LogOut,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient }   from '../config/api';
import { useQueue }    from '../context/QueueContext';
import { useSocket }   from '../context/SocketContext';
import { localTrainer, MaskAssignment } from '../services/localTrainer';

type TrainingPhase = 'idle'|'loading'|'waiting'|'training'|'masking'|'submitting'|'done';
interface TrainingStatus { phase:TrainingPhase; round:number; epoch:number; totalEpochs:number; accuracy:number|null; loss:number|null; message:string; }
interface SubmissionTracker { received:number; expected:number; }

export default function Queue() {
  const { queue, inQueue, loading, refresh } = useQueue();
  const socket = useSocket();

  const [joining,    setJoining]    = useState(false);
  const [leaving,    setLeaving]    = useState(false);
  const [dragOver,   setDragOver]   = useState(false);
  const [file,       setFile]       = useState<File|null>(null);
  const [dataReady,  setDataReady]  = useState(false);
  const [dataInfo,   setDataInfo]   = useState<{rows:number;features:number;classes:number}|null>(null);
  const [parseError, setParseError] = useState<string|null>(null);
  const [submissions,setSubmissions]= useState<SubmissionTracker|null>(null);
  const [status, setStatus] = useState<TrainingStatus>({
    phase:'idle',round:0,epoch:0,totalEpochs:3,accuracy:null,loss:null,message:''
  });

  const inQueueRef            = useRef(false);
  const isTrainingRef         = useRef(false);
  const pendingRoundRef       = useRef<any>(null);
  const lastSubmittedRoundRef    = useRef(0);
  const currentlyTrainingRoundRef = useRef(0);  // tracks which round is actively in model.fit()
  const activeJobIdRef          = useRef<string|null>(null);  // FIX #1: track active job ID independently of inQueue
  const consecutive404Ref       = useRef(0);    // counts consecutive 404s to detect dead job
  const refreshRef            = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  const currentId: string|null = (() => {
    try { const s=localStorage.getItem('fl_participant'); return s?JSON.parse(s):null; }
    catch { return null; }
  })();

  const activeJob    = queue.activeJob;
  const isJobRunning = !!activeJob;
  const roundPct     = isJobRunning ? Math.round((activeJob.currentRound/activeJob.totalRounds)*100) : 0;
  const MIN_REQUIRED = queue.minRequired||2;
  const slotsLeft    = Math.max(0, MIN_REQUIRED-queue.count);
  const hasPendingRound = !!pendingRoundRef.current && !dataReady;

  // ── Rebuild model from sessionStorage CSV (used when model dies between rounds) ──
  const rebuildModelFromSession = useCallback(async () => {
    const savedText = sessionStorage.getItem('fl_csv_text');
    const savedName = sessionStorage.getItem('fl_csv_name');
    if (!savedText || !savedName) {
      console.warn('[Queue] Cannot rebuild model — no CSV in sessionStorage');
      return false;
    }
    try {
      console.log('[Queue] Rebuilding model from sessionStorage CSV:', savedName);
      const blob = new Blob([savedText], { type: 'text/csv' });
      await localTrainer.loadCSV(new File([blob], savedName, { type: 'text/csv' }));
      setDataReady(true);
      console.log('[Queue] Model rebuilt successfully, isReady=', localTrainer.isReady);
      return true;
    } catch (err: any) {
      console.error('[Queue] Failed to rebuild model:', err.message);
      return false;
    }
  }, []);

  // ── Core training function ─────────────────────────────────────────────────
  const runLocalRound = useCallback(async (event:{jobId:string;round:number;totalRounds:number;globalWeights:any|null;adaptiveWeights?:Record<string,number>}) => {
    if (event.round <= lastSubmittedRoundRef.current) {
      console.log('[Queue] Already submitted round', event.round, '— ignoring');
      return;
    }
    if (isTrainingRef.current) {
      // If we're already training THIS round, the replay is redundant — ignore it.
      // Only queue if it's a FUTURE round we haven't started yet.
      if (event.round === currentlyTrainingRoundRef.current) {
        console.log('[Queue] Already training round', event.round, '— ignoring replay');
        return;
      }
      console.log('[Queue] Round', event.round, 'queued (training round', currentlyTrainingRoundRef.current, 'in progress)');
      pendingRoundRef.current = event;
      return;
    }
    if (!localTrainer.isReady) {
      console.log('[Queue] Model not ready — attempting rebuild from sessionStorage for round', event.round);
      pendingRoundRef.current = event;
      setStatus(s=>({...s,phase:'loading',message:`Round ${event.round} started — restoring model…`}));
      const rebuilt = await rebuildModelFromSession();
      if (rebuilt && pendingRoundRef.current && !isTrainingRef.current) {
        const pending = pendingRoundRef.current;
        pendingRoundRef.current = null;
        console.log('[Queue] Model rebuilt — starting queued round', pending.round);
        runLocalRoundRef.current(pending);
      } else if (!rebuilt) {
        setStatus(s=>({...s,phase:'loading',message:`⚡ Round ${event.round} started — load your CSV NOW!`}));
      }
      return;
    }

    isTrainingRef.current = true;
    currentlyTrainingRoundRef.current = event.round;
    trainingStartTimeRef.current = Date.now();
    const EPOCHS = 3;
    try {
      if (event.globalWeights) await localTrainer.applyGlobalWeights(event.globalWeights);
      setStatus({phase:'training',round:event.round,epoch:0,totalEpochs:EPOCHS,accuracy:null,loss:null,
        message:`Round ${event.round}/${event.totalRounds} — training locally…`});

      const metrics = await localTrainer.trainRound(EPOCHS, 32, (epoch,logs) => {
        setStatus(s=>({...s,epoch:epoch+1,accuracy:logs?.acc??null,loss:logs?.loss??null,
          message:`Epoch ${epoch+1}/${EPOCHS} — acc: ${((logs?.acc||0)*100).toFixed(1)}%`}));
      });

      const rawWeights = await localTrainer.extractWeights();
      setStatus(s=>({...s,phase:'masking',message:'Applying adaptive weight + pairwise masks…'}));

      const myCompanyId = localStorage.getItem('fl_participant')
        ? JSON.parse(localStorage.getItem('fl_participant')!) : null;
      const alpha = event.adaptiveWeights?.[myCompanyId] ?? (1/2);
      const scaledWeights = await localTrainer.applyAdaptiveWeight(rawWeights, alpha);

      const maskRes = await apiClient.get<{assignments:MaskAssignment[]}>('/api/federated/masks');
      const maskedWeights = await localTrainer.applyPairwiseMasks(scaledWeights, maskRes.data.assignments);

      setStatus(s=>({...s,phase:'submitting',message:'Submitting masked weights…'}));

      try {
        await apiClient.post('/api/federated/submit',{jobId:event.jobId,round:event.round,maskedWeights,metrics});
        lastSubmittedRoundRef.current = event.round;
        setStatus(s=>({...s,phase:'waiting',accuracy:metrics.accuracy,loss:metrics.loss,
          message:`Round ${event.round} submitted — waiting for other nodes…`}));
      } catch (submitErr: any) {
        if (submitErr?.response?.status === 409) {
          console.warn(`[Queue] Submit round ${event.round} → 409 (server advanced). Skipping.`);
          // FIX #7: Update lastSubmittedRoundRef so we don't retry this round
          lastSubmittedRoundRef.current = event.round;
          setStatus(s=>({...s,phase:'waiting',message:`Round ${event.round} skipped — ready for next round`}));
        } else {
          throw submitErr;
        }
      }
    } catch (err:any) {
      console.error('[Queue] Round error:', err);
      console.error('[Queue] Round error stack:', err?.stack);
      setStatus(s=>({...s,phase:'idle',message:`Error: ${err.message}`}));
      // FIX BUG 2: do NOT set pendingRoundRef here.
      // Setting it would cause finally → setTimeout(runLocalRound,0) → same
      // error → catch → finally → ... a tight infinite 0ms retry loop that
      // never reaches GET /masks or POST /submit, so the server sees nothing.
      // The 5-second polling safety net already retries correctly.
    } finally {
      isTrainingRef.current = false;
      currentlyTrainingRoundRef.current = 0;
      if (pendingRoundRef.current && (inQueueRef.current || activeJobIdRef.current)) {
        const next = pendingRoundRef.current;
        pendingRoundRef.current = null;
        if (next.round > lastSubmittedRoundRef.current) {
          console.log('[Queue] Auto-starting queued round', next.round);
          setTimeout(() => runLocalRound(next), 0);
        } else {
          console.log('[Queue] Discarding stale pending round', next.round);
        }
      }
    }
  }, []);

  const runLocalRoundRef = useRef(runLocalRound);
  useEffect(() => { runLocalRoundRef.current = runLocalRound; }, [runLocalRound]);

  // ── Training watchdog ─────────────────────────────────────────────────────
  // If isTrainingRef is stuck true for >3 minutes something silently crashed.
  // Force-reset so the polling safety net can retrigger training.
  const trainingStartTimeRef = useRef<number>(0);
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (isTrainingRef.current) {
        const elapsed = Date.now() - trainingStartTimeRef.current;
        if (elapsed > 3 * 60 * 1000) {
          console.warn('[Queue] Watchdog: isTrainingRef stuck >3min — force resetting');
          isTrainingRef.current = false;
          currentlyTrainingRoundRef.current = 0;
          setStatus(s => ({ ...s, phase: 'idle', message: 'Training timed out — retrying…' }));
        }
      }
    }, 15000);
    return () => clearInterval(watchdog);
  }, []);

  // Prevents simultaneous poll callbacks (from a frozen/thawed event loop)
  // from all firing runLocalRound at the same time
  const isPollFiringRef = useRef(false);

  // ── POLLING SAFETY NET ────────────────────────────────────────────────────
  // Every 5 s: detect if we are behind on rounds and trigger training via HTTP.
  // This is completely independent of the socket event chain, so it catches
  // any scenario where onRoundStarted was missed or silently failed.
  //
  // Why this is the definitive fix for "works for N rounds then stops":
  //  - Socket event fires → handler runs → some guard returns early → no training
  //  - 5 s later: poll detects round N > lastSubmitted → triggers training ✓
  //  - No infinite loops: poll checks isTrainingRef before acting
  useEffect(() => {
    const poll = setInterval(async () => {
      if (isPollFiringRef.current) return;  // another poll callback is already running
      if (isTrainingRef.current)   return;  // already training
      // FIX #1: Accept if inQueue OR if we have a tracked active job ID
      if (!inQueueRef.current && !activeJobIdRef.current) return;

      // If model is not ready but CSV is in sessionStorage, rebuild it
      if (!localTrainer.isReady) {
        const savedText = sessionStorage.getItem('fl_csv_text');
        if (savedText) {
          console.log('[Queue] Poll: model not ready but CSV exists — rebuilding');
          const rebuilt = await rebuildModelFromSession();
          if (!rebuilt) return;  // rebuild failed, wait for next poll
        } else {
          return;  // no CSV available
        }
      }

      isPollFiringRef.current = true;

      try {
        const res = await apiClient.get<{
          hasWeights:       boolean;
          jobId:            string;
          currentRound:     number;
          totalRounds:      number;
          weights?:         any;
          adaptiveWeights?: Record<string,number> | null;
          alreadySubmitted: boolean;
        }>('/api/federated/weights');

        const { jobId, currentRound, totalRounds, weights, adaptiveWeights, alreadySubmitted } = res.data;

        // Successful response — reset 404 counter
        consecutive404Ref.current = 0;

        // ── Reconnect sync ──────────────────────────────────────────────────
        // If the server confirms we already submitted this round (from a
        // previous socket session before a page refresh), sync
        // lastSubmittedRoundRef so the dedup guard doesn't block us, and
        // stay in 'waiting' phase rather than re-triggering training.
        if (alreadySubmitted && currentRound > lastSubmittedRoundRef.current) {
          console.log(`[Queue] Poll: server confirms round ${currentRound} already submitted — syncing ref`);
          lastSubmittedRoundRef.current = currentRound;
          setStatus(s => ({
            ...s,
            phase:   'waiting',
            round:   currentRound,
            message: `Round ${currentRound} submitted — waiting for other nodes…`,
          }));
          return;
        }

        if (currentRound > lastSubmittedRoundRef.current) {
          console.log(
            `[Queue] Poll: round ${currentRound} > lastSubmitted ${lastSubmittedRoundRef.current}`,
            '— triggering training',
          );
          runLocalRoundRef.current({
            jobId,
            round:           currentRound,
            totalRounds,
            globalWeights:   weights ?? null,
            adaptiveWeights: adaptiveWeights ?? undefined,
          });
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          // 404 = no active job — count consecutive occurrences
          consecutive404Ref.current++;
          // After 6 consecutive 404s (~30s), assume job ended/crashed and reset state
          if (consecutive404Ref.current >= 6) {
            console.log('[Queue] Poll: 6 consecutive 404s — resetting state');
            consecutive404Ref.current = 0;
            isTrainingRef.current = false;
            currentlyTrainingRoundRef.current = 0;
            pendingRoundRef.current = null;
            activeJobIdRef.current = null;
            // Don't reset lastSubmittedRoundRef — if job restarted, we want to sync
            setStatus({ phase: 'idle', round: 0, epoch: 0, totalEpochs: 3, accuracy: null, loss: null, message: '' });
          }
        } else {
          // Non-404 error — reset 404 counter but log
          consecutive404Ref.current = 0;
          console.debug('[Queue] Poll error:', e?.message);
        }
      } finally {
        isPollFiringRef.current = false;
      }
    }, 5000);

    return () => clearInterval(poll);
  }, []); // stable: all mutable state is via refs

  // ── Warn before refresh during training ──────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isTrainingRef.current) {
        e.preventDefault();
        e.returnValue = 'Training is in progress — leaving will skip your round submission.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // ── inQueue sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    inQueueRef.current = inQueue;
    // FIX #1: When inQueue becomes true and there's an active job, sync the job ID
    if (inQueue && queue.activeJob?.jobId) {
      activeJobIdRef.current = queue.activeJob.jobId;
    }
    if (inQueue && pendingRoundRef.current && !isTrainingRef.current) {
      const pending = pendingRoundRef.current;
      if (pending.round > lastSubmittedRoundRef.current) {
        // If model is not ready, rebuild first
        if (!localTrainer.isReady) {
          console.log('[Queue] inQueue→true: model not ready — rebuilding before pending round', pending.round);
          rebuildModelFromSession().then((rebuilt) => {
            if (rebuilt) {
              pendingRoundRef.current = null;
              setTimeout(() => runLocalRoundRef.current(pending), 0);
            }
          });
        } else {
          console.log('[Queue] inQueue→true: processing pending round', pending.round);
          pendingRoundRef.current = null;
          setTimeout(() => runLocalRoundRef.current(pending), 0);
        }
      } else {
        pendingRoundRef.current = null;
      }
    }
  }, [inQueue, rebuildModelFromSession]);

  // ── Socket listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onTrainingStarting = (data:any) => {
      // FIX #1: Set activeJobIdRef immediately when training starts, BEFORE
      // the QueueContext poll updates inQueue. This closes the timing gap
      // where round:started events are ignored because inQueueRef is still false.
      activeJobIdRef.current = data.jobId;
      console.log('[Queue] training:starting → job', data.jobId);
    };

    const onRoundStarted = async (data:any) => {
      console.log('[Queue] round:started round=', data.round,
        'inQueue=', inQueueRef.current, 'isTraining=', isTrainingRef.current,
        'modelReady=', localTrainer.isReady, 'lastSubmitted=', lastSubmittedRoundRef.current,
        'activeJobId=', activeJobIdRef.current);

      // FIX #1: Accept the event if we're in the queue OR if the jobId matches
      // our tracked active job. This handles the timing gap where inQueueRef
      // hasn't been updated by the QueueContext poll yet.
      const isParticipant = inQueueRef.current || activeJobIdRef.current === data.jobId;
      if (!isParticipant) {
        console.log('[Queue] Not in queue — ignoring round:started for job', data.jobId);
        return;
      }

      if (data.round <= lastSubmittedRoundRef.current) {
        console.log('[Queue] Ignoring already-submitted round', data.round);
        return;
      }
      if (isTrainingRef.current) { pendingRoundRef.current = data; return; }

      // If model is not ready, try to rebuild from sessionStorage before queuing
      if (!localTrainer.isReady) {
        console.log('[Queue] Model not ready on round:started — attempting rebuild');
        pendingRoundRef.current = data;
        const rebuilt = await rebuildModelFromSession();
        if (rebuilt && pendingRoundRef.current && !isTrainingRef.current) {
          const pending = pendingRoundRef.current;
          pendingRoundRef.current = null;
          console.log('[Queue] Model rebuilt — starting round', pending.round);
          runLocalRoundRef.current(pending);
        }
        return;
      }

      runLocalRoundRef.current(data);
    };

    const onWeightsSub     = (data:SubmissionTracker) => setSubmissions(data);
    const onRoundAggregated = (data:any) => {
      console.log(`[Queue] round:aggregated round=${data.round} acc=${(data.globalAccuracy*100).toFixed(1)}%`);
      setSubmissions(null);
    };
    const onComplete = () => {
      setStatus({phase:'done',round:0,epoch:0,totalEpochs:3,accuracy:null,loss:null,message:'Training complete!'});
      pendingRoundRef.current       = null;
      isTrainingRef.current         = false;
      lastSubmittedRoundRef.current = 0;
      activeJobIdRef.current        = null;  // FIX #1: clear tracked job ID
      consecutive404Ref.current     = 0;
      sessionStorage.removeItem('fl_csv_text');
      sessionStorage.removeItem('fl_csv_name');
      localTrainer.dispose();
      refreshRef.current();
    };

    const onError = (data: any) => {
      console.error('[Queue] training:error:', data.message);
      setStatus({
        phase: 'idle', round: 0, epoch: 0, totalEpochs: 3,
        accuracy: null, loss: null,
        message: `Training error: ${data.message}`,
      });
      pendingRoundRef.current = null;
      isTrainingRef.current = false;
      currentlyTrainingRoundRef.current = 0;
      activeJobIdRef.current = null;
      consecutive404Ref.current = 0;
    };

    socket.on('training:starting',   onTrainingStarting);
    socket.on('round:started',       onRoundStarted);
    socket.on('weights:submitted',   onWeightsSub);
    socket.on('training:complete',   onComplete);
    socket.on('round:aggregated',    onRoundAggregated);
    socket.on('training:error',      onError);
    return () => {
      socket.off('training:starting',   onTrainingStarting);
      socket.off('round:started',       onRoundStarted);
      socket.off('weights:submitted',   onWeightsSub);
      socket.off('training:complete',   onComplete);
      socket.off('round:aggregated',    onRoundAggregated);
      socket.off('training:error',      onError);
    };
  }, [socket, rebuildModelFromSession]);

  // ── Restore CSV on mount / cleanup on unmount ────────────────────────────
  useEffect(() => {
    const savedText = sessionStorage.getItem('fl_csv_text');
    const savedName = sessionStorage.getItem('fl_csv_name');
    if (savedText && savedName) {
      console.log('[Queue] Restoring CSV from sessionStorage:', savedName);
      const blob = new Blob([savedText], {type:'text/csv'});
      handleFileSelectInternal(new File([blob], savedName, {type:'text/csv'}), savedText);
    }

    // Cleanup: only dispose the trainer if the user is NOT actively in a job.
    // Navigating away mid-training should not kill the model — the CSV is
    // preserved in sessionStorage and rebuilt on re-entry. Disposing here
    // when training is active would cause "Container already disposed" because
    // the socket replay fires applyGlobalWeights on a dead model.
    return () => {
      if (!isTrainingRef.current && !inQueueRef.current) {
        localTrainer.dispose();
      }
    };
  }, []);

  const handleFileSelectInternal = useCallback(async (selected:File, preloadedText?:string) => {
    setFile(selected); setParseError(null); setDataReady(false); setDataInfo(null);
    setStatus(s=>({...s,phase:'loading',message:'Parsing CSV in browser…'}));
    try {
      const text = preloadedText ?? await selected.text();
      sessionStorage.setItem('fl_csv_text', text);
      sessionStorage.setItem('fl_csv_name', selected.name);
      const meta = await localTrainer.loadCSV(selected);
      // Only build the model here if there is no pending round.
      // If a pending round exists, applyGlobalWeights() inside runLocalRound
      // will call buildModel() itself — calling it twice disposes the model
      // that was just built and causes "Container is already disposed".
      const hasPending = !!(pendingRoundRef.current && inQueueRef.current && !isTrainingRef.current
        && pendingRoundRef.current.round > lastSubmittedRoundRef.current);
      if (!hasPending) {
        localTrainer.buildModel();
      }
      setDataReady(true);
      setDataInfo({rows:meta.rows,features:meta.features,classes:meta.classes});
      setStatus(s=>({...s,phase:'idle',message:''}));
      if (hasPending) {
        const pending = pendingRoundRef.current!;
        pendingRoundRef.current = null;
        setTimeout(() => runLocalRoundRef.current(pending), 0);
      }
    } catch (err:any) {
      setParseError(err.message||'Failed to parse CSV');
      setStatus(s=>({...s,phase:'idle',message:''}));
    }
  }, []);

  const handleFileSelect = useCallback((f:File) => handleFileSelectInternal(f), [handleFileSelectInternal]);

  const joinQueue = async () => {
    if (!dataReady) return;
    setJoining(true);
    try { await apiClient.post('/api/queue/join'); await refresh(); }
    catch (err:any) {
      const msg = err.response?.data?.error?.message||err.response?.data?.message||'';
      if (err.response?.status===409||msg.toLowerCase().includes('already')) { await refresh(); return; }
      alert(msg||'Failed to join queue');
    } finally { setJoining(false); }
  };

  const leaveQueue = async () => {
    if (!confirm('Leave? If training is active your round will be skipped.')) return;
    setLeaving(true);
    try {
      await apiClient.post('/api/queue/leave');
      localTrainer.dispose();
      pendingRoundRef.current = null;
      isTrainingRef.current   = false;
      lastSubmittedRoundRef.current = 0;
      setStatus({phase:'idle',round:0,epoch:0,totalEpochs:3,accuracy:null,loss:null,message:''});
      await refresh();
    } catch(e){ console.error(e); }
    finally { setLeaving(false); }
  };

  const clearFile = (e:React.MouseEvent) => {
    e.stopPropagation();
    setFile(null); setDataReady(false); setDataInfo(null); setParseError(null);
    localTrainer.dispose(); pendingRoundRef.current = null;
    sessionStorage.removeItem('fl_csv_text'); sessionStorage.removeItem('fl_csv_name');
  };

  const handleDrop = (e:React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f=e.dataTransfer.files[0]; if(f) handleFileSelect(f);
  };

  const phaseStyle: Record<TrainingPhase,string> = {
    idle:'bg-slate-100 text-slate-500', loading:'bg-amber-50 text-amber-600',
    waiting:'bg-indigo-50 text-indigo-600', training:'bg-emerald-50 text-emerald-700',
    masking:'bg-violet-50 text-violet-700', submitting:'bg-blue-50 text-blue-600',
    done:'bg-emerald-100 text-emerald-800',
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Node Waiting Room</h1>
        <p className="text-slate-500 mt-1">Your data stays on your device. Only pairwise-masked weight updates are shared.</p>
      </header>
      <AnimatePresence>
        {hasPendingRound && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}
            className="bg-red-50 border-2 border-red-400 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={24}/>
            <div>
              <p className="font-bold text-red-700 text-lg">⚡ Round {pendingRoundRef.current?.round} is waiting!</p>
              <p className="text-red-600 text-sm mt-1"><strong>Load your CSV NOW</strong> to participate before the round times out.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isJobRunning && (
          <motion.div initial={{opacity:0,y:-20}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-20}}
            className="bg-gradient-to-r from-indigo-600 to-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-indigo-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center"><Zap size={24} className="animate-pulse"/></div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">🔐 Pairwise-Masked Federated Training</h3>
                <p className="text-sm text-white/80">Job <span className="font-mono">{activeJob.jobId.slice(0,8)}</span> · <span className="font-bold uppercase">{activeJob.status}</span></p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/70 uppercase tracking-widest">Round</p>
                <p className="text-3xl font-black">{activeJob.currentRound}<span className="text-lg font-normal text-white/60"> / {activeJob.totalRounds}</span></p>
              </div>
            </div>
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden mb-2">
              <motion.div className="h-full bg-white rounded-full" animate={{width:`${roundPct}%`}} transition={{duration:0.5}}/>
            </div>
            <div className="flex justify-between text-xs text-white/60 mt-1 mb-2">
              {Array.from({length:activeJob.totalRounds},(_,i)=>i+1).map(r=>(
                <span key={r} className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold
                  ${r<activeJob.currentRound?'bg-white text-indigo-700':r===activeJob.currentRound?'bg-white text-indigo-700 ring-2 ring-white/50':'bg-white/20 text-white/40'}`}>{r}</span>
              ))}
            </div>
            {submissions && (
              <div className="pt-3 border-t border-white/20 text-xs text-white/80 flex items-center gap-2">
                <Send size={12}/> Masked submissions: <span className="font-bold">{submissions.received}/{submissions.expected}</span> nodes
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className={`bg-white p-6 rounded-[2rem] shadow-sm border-2 transition-all ${hasPendingRound?'border-red-400':'border-slate-100'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center text-sm font-bold ${hasPendingRound?'bg-red-500':'bg-indigo-600'}`}>1</div>
              <h3 className="font-bold text-slate-900">Load Private Data{hasPendingRound&&<span className="text-red-500 text-xs font-bold ml-1 animate-pulse">← NOW!</span>}</h3>
            </div>
            <div onDrop={handleDrop} onDragOver={(e)=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors
                ${hasPendingRound?'border-red-400 bg-red-50':dragOver?'border-indigo-400 bg-indigo-50':'border-slate-200 hover:border-indigo-300'}`}
              onClick={()=>document.getElementById('file-input')?.click()}>
              <input id="file-input" type="file" className="hidden" accept=".csv" onChange={e=>e.target.files?.[0]&&handleFileSelect(e.target.files[0])}/>
              {status.phase==='loading'&&!file?(
                <div className="flex flex-col items-center gap-2 text-indigo-600"><Loader2 className="animate-spin" size={28}/><p className="text-sm">Parsing locally…</p></div>
              ):file?(
                <div className="space-y-2">
                  {dataReady&&<div className="flex items-center justify-center gap-2 text-emerald-700 bg-emerald-50 rounded-xl px-3 py-1.5 text-xs font-semibold"><CheckCircle2 size={13}/> Ready — stays local</div>}
                  {parseError&&<div className="text-red-500 bg-red-50 rounded-xl px-3 py-2 text-xs">⚠ {parseError}</div>}
                  <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-indigo-700">
                      <FileText size={18}/>
                      <div className="text-left">
                        <span className="text-sm font-medium block truncate max-w-[130px]">{file.name}</span>
                        {dataInfo&&<span className="text-xs text-indigo-400">{dataInfo.rows.toLocaleString()} rows · {dataInfo.features} features · {dataInfo.classes} classes</span>}
                      </div>
                    </div>
                    <button onClick={clearFile} className="text-slate-400 hover:text-red-500"><X size={16}/></button>
                  </div>
                </div>
              ):(
                <>
                  <Upload size={28} className={`mx-auto mb-2 ${hasPendingRound?'text-red-400':'text-slate-300'}`}/>
                  <p className={`text-sm font-medium ${hasPendingRound?'text-red-600':'text-slate-500'}`}>{hasPendingRound?'⚡ Drop CSV NOW!':'Drop your CSV here'}</p>
                  <p className="text-xs text-slate-400 mt-1">Parsed in browser — never uploaded</p>
                </>
              )}
            </div>
          </div>
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 text-center relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 ${isJobRunning?'bg-gradient-to-r from-indigo-600 to-emerald-500':'bg-indigo-600'}`}/>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">2</div>
              <h3 className="font-bold text-slate-900">{isJobRunning?'Training Active':'Join Waiting Room'}</h3>
            </div>
            {isJobRunning?(
              <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} className="space-y-4">
                <p className="text-5xl font-black text-indigo-700">{activeJob.currentRound}<span className="text-2xl font-normal text-slate-400"> / {activeJob.totalRounds}</span></p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Current Round</p>
                {inQueue && status.phase !== 'idle' && (
                  <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${phaseStyle[status.phase]}`}>
                    <div className="flex items-center justify-center gap-2">
                      {status.phase==='training'&&<Brain size={15} className="animate-pulse"/>}
                      {status.phase==='masking'&&<Lock size={15} className="animate-pulse"/>}
                      {status.phase==='submitting'&&<Send size={15} className="animate-pulse"/>}
                      {(status.phase==='waiting'||status.phase==='loading')&&<Loader2 size={15} className="animate-spin"/>}
                      {status.phase==='done'&&<CheckCircle2 size={15}/>}
                      <span>{status.message}</span>
                    </div>
                    {status.phase==='training'&&(
                      <div className="mt-2">
                        <div className="flex justify-between text-xs opacity-70 mb-1">
                          <span>Epoch {status.epoch}/{status.totalEpochs}</span>
                          {status.accuracy!=null&&<span>acc {(status.accuracy*100).toFixed(1)}%</span>}
                        </div>
                        <div className="h-1.5 bg-black/10 rounded-full overflow-hidden">
                          <motion.div className="h-full bg-current rounded-full opacity-60"
                            animate={{width:`${(status.epoch/status.totalEpochs)*100}%`}} transition={{duration:0.3}}/>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-indigo-600 to-emerald-500 rounded-full"
                    animate={{width:`${roundPct}%`}} transition={{duration:0.5}}/>
                </div>
                <p className="text-xs text-slate-400">Weights are masked before leaving your device.</p>
                {inQueue&&(
                  <button onClick={leaveQueue} disabled={leaving}
                    className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-500 py-2.5 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-50">
                    <LogOut size={14}/> {leaving?'Leaving…':'Leave Training'}
                  </button>
                )}
              </motion.div>
            ):(
              <>
                <motion.p key={queue.count} initial={{scale:1.2,color:'#4f46e5'}} animate={{scale:1,color:'#0f172a'}} className="text-5xl font-black mb-1">
                  {loading?'...':`${queue.count} / ${MIN_REQUIRED}`}
                </motion.p>
                <p className="text-slate-500 font-medium uppercase tracking-widest text-xs mb-4">Active Participants</p>
                {inQueue&&slotsLeft>0&&(
                  <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
                    Need {slotsLeft} more {slotsLeft===1?'participant':'participants'} to start
                  </div>
                )}
                <AnimatePresence mode="wait">
                  {!inQueue?(
                    <motion.button key="join" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}
                      onClick={joinQueue} disabled={joining||!dataReady}
                      className={`w-full py-4 rounded-2xl font-bold text-lg transition-all
                        ${dataReady?'bg-indigo-600 text-white shadow-xl shadow-indigo-100 hover:bg-indigo-700 cursor-pointer':'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                      {joining?<span className="flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={20}/> Joining...</span>
                        :dataReady?'Join Waiting Room':'🔒 Load CSV First'}
                    </motion.button>
                  ):(
                    <motion.div key="waiting" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-3">
                      <div className="flex items-center justify-center gap-3 text-emerald-600 font-bold bg-emerald-50 py-4 rounded-2xl">
                        <CheckCircle2 size={20}/> You are in the queue
                      </div>
                      {slotsLeft>0&&<div className="flex items-center justify-center gap-2 text-slate-400 text-sm"><Loader2 className="animate-spin" size={16}/> Waiting for {slotsLeft} more…</div>}
                      <button onClick={leaveQueue} disabled={leaving}
                        className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-500 py-3 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-50">
                        <LogOut size={14}/> {leaving?'Leaving…':'Leave Queue'}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
          <div className="bg-slate-900 p-6 rounded-[2rem] text-white">
            <Shield className="text-indigo-400 mb-3" size={28}/>
            <h3 className="text-base font-bold mb-1">Pairwise Masking</h3>
            <p className="text-slate-400 text-sm leading-relaxed">Your data never leaves your device. Only masked weight updates are shared using pairwise secure aggregation.</p>
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{isJobRunning?'Training Nodes':'Connected Nodes'}</h2>
                {isJobRunning&&<p className="text-xs text-slate-400 mt-0.5">Round {activeJob.currentRound} of {activeJob.totalRounds} — {activeJob.status}</p>}
              </div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full animate-pulse ${isJobRunning?'bg-indigo-500':'bg-emerald-500'}`}/>
                {isJobRunning?'Training':'Live Feed'}
              </span>
            </div>
            {loading?(<div className="p-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-3" size={24}/>Loading…</div>)
            :queue.companies.length===0?(<div className="p-12 text-center text-slate-400"><Users size={40} className="mx-auto mb-3 opacity-30"/><p>No nodes connected yet</p></div>)
            :(<div className="divide-y divide-slate-50">
              {queue.companies.map((node,i)=>(
                <motion.div key={node.companyId} initial={{opacity:0,x:-20}} animate={{opacity:1,x:0}} transition={{delay:i*0.08}}
                  className={`p-6 flex items-center justify-between ${node.companyId===currentId?'bg-indigo-50':'hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isJobRunning?'bg-indigo-100 text-indigo-500':'bg-slate-100 text-slate-400'}`}><Monitor size={24}/></div>
                    <div>
                      <p className="font-bold text-slate-900">{node.companyName||node.companyId}
                        {node.companyId===currentId&&<span className="ml-2 text-xs text-indigo-500">(you)</span>}</p>
                      <p className="text-xs text-slate-500">
                        {isJobRunning?`Round ${activeJob.currentRound} / ${activeJob.totalRounds}`:`Joined ${new Date(node.joinedAt).toLocaleTimeString()}`}
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider
                    ${isJobRunning?'bg-indigo-50 text-indigo-600':'bg-emerald-50 text-emerald-600'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isJobRunning?'bg-indigo-500':'bg-emerald-500'}`}/>
                    {isJobRunning?activeJob.status.toLowerCase():'ready'}
                  </div>
                </motion.div>
              ))}
            </div>)}
            {isJobRunning?(
              <div className="p-4 bg-indigo-50 border-t border-indigo-100">
                <div className="flex justify-between text-xs text-indigo-600 font-medium mb-2">
                  <span>Overall Progress</span><span>{roundPct}% · Round {activeJob.currentRound}/{activeJob.totalRounds}</span>
                </div>
                <div className="h-1.5 bg-indigo-200 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-indigo-600 rounded-full" animate={{width:`${roundPct}%`}} transition={{duration:0.5}}/>
                </div>
              </div>
            ):(<div className="p-4 bg-slate-50 text-center text-xs text-slate-400">{queue.companies.length} nodes · refreshes every 3s</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
