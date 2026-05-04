import React, { useState } from 'react';
import { Users, Loader2, CheckCircle2, Monitor, Shield, Upload, FileText, X, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient } from '../config/api';
import { useQueue } from '../context/QueueContext';

export default function Queue() {
  const { queue, inQueue, loading, refresh } = useQueue();
  const [joining,  setJoining]  = useState(false);
  const [leaving,  setLeaving]  = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);

  const currentId = (() => {
    const saved = localStorage.getItem('fl_participant');
    return saved ? JSON.parse(saved) : null;
  })();

  const [uploadedInfo, setUploadedInfo] = useState<{ name: string; size: number } | null>(() => {
    try {
      const saved = localStorage.getItem(`fl_uploaded_${currentId}`);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const hasData    = !!file || !!uploadedInfo;
  const activeJob  = queue.activeJob;
  const isTraining = !!activeJob;
  const roundProgress = isTraining
    ? Math.round(((activeJob.currentRound) / activeJob.totalRounds) * 100)
    : 0;

  const MIN_REQUIRED = 3;
  const slotsLeft    = Math.max(0, MIN_REQUIRED - queue.count);
  const displayName  = file ? file.name : uploadedInfo?.name;

  const joinQueue = async () => {
    if (!hasData) return;
    setJoining(true);
    try {
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        await apiClient.post('/api/data/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        const info = { name: file.name, size: file.size };
        localStorage.setItem(`fl_uploaded_${currentId}`, JSON.stringify(info));
        setUploadedInfo(info);
      }
      await apiClient.post('/api/queue/join');
      await refresh();
    } catch (err: any) {
      const status = err.response?.status;
      const msg    = err.response?.data?.error?.message || err.response?.data?.message || '';
      if (status === 409 || msg.toLowerCase().includes('already')) { await refresh(); return; }
      alert(msg || 'Failed to join queue');
    } finally { setJoining(false); }
  };

  const leaveQueue = async () => {
    setLeaving(true);
    try { await apiClient.post('/api/queue/leave'); await refresh(); }
    catch (err) { console.error('Leave queue error:', err); }
    finally { setLeaving(false); }
  };

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation(); setFile(null); setUploadedInfo(null);
    localStorage.removeItem(`fl_uploaded_${currentId}`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Node Waiting Room</h1>
        <p className="text-slate-500 mt-1">Upload your private data and join the federated learning cluster.</p>
      </header>

      {/* Training Banner */}
      <AnimatePresence>
        {isTraining && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="bg-gradient-to-r from-indigo-600 to-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-indigo-100"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                <Zap size={24} className="animate-pulse" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">🚀 Federated Training in Progress</h3>
                <p className="text-sm text-white/80">Job <span className="font-mono">{activeJob.jobId.slice(0, 8)}</span> · <span className="font-bold uppercase">{activeJob.status}</span></p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/70 uppercase tracking-widest">Round</p>
                <p className="text-3xl font-black">{activeJob.currentRound}<span className="text-lg font-normal text-white/60"> / {activeJob.totalRounds}</span></p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-white/70"><span>Training Progress</span><span>{roundProgress}%</span></div>
              <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
                <motion.div className="h-full bg-white rounded-full" animate={{ width: `${roundProgress}%` }} transition={{ duration: 0.5 }} />
              </div>
              <div className="flex justify-between text-xs text-white/60 pt-1">
                {Array.from({ length: activeJob.totalRounds }, (_, i) => i + 1).map((r) => (
                  <span key={r} className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${r <= activeJob.currentRound ? 'bg-white text-indigo-700' : 'bg-white/20 text-white/40'}`}>{r}</span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">

          {/* Step 1: Upload */}
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">1</div>
              <h3 className="font-bold text-slate-900">Upload Private Data</h3>
            </div>
            <div
              onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-colors cursor-pointer ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input id="file-input" type="file" className="hidden" accept=".csv,.json,.txt" onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
              {hasData ? (
                <div className="space-y-2">
                  {uploadedInfo && !file && (
                    <div className="flex items-center justify-center gap-2 text-emerald-700 bg-emerald-50 rounded-xl px-3 py-1.5 text-xs font-semibold">
                      <CheckCircle2 size={13} /> Previously uploaded — ready
                    </div>
                  )}
                  <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-indigo-700">
                      <FileText size={18} />
                      <div className="text-left">
                        <span className="text-sm font-medium block truncate max-w-[130px]">{displayName}</span>
                        {uploadedInfo && !file && <span className="text-xs text-indigo-400">from previous session</span>}
                        {file && <span className="text-xs text-indigo-400">ready to upload</span>}
                      </div>
                    </div>
                    <button onClick={clearFile} className="text-slate-400 hover:text-red-500"><X size={16} /></button>
                  </div>
                </div>
              ) : (
                <><Upload size={28} className="mx-auto mb-2 text-slate-300" /><p className="text-sm text-slate-500">Drop your CSV/JSON file here</p><p className="text-xs text-slate-400 mt-1">or click to browse</p></>
              )}
            </div>
          </div>

          {/* Step 2: Join / Training status */}
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 text-center relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 ${isTraining ? 'bg-gradient-to-r from-indigo-600 to-emerald-500' : 'bg-indigo-600'}`}></div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">2</div>
              <h3 className="font-bold text-slate-900">{isTraining ? 'Training Active' : 'Join Waiting Room'}</h3>
            </div>

            {isTraining ? (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
                <div className="text-center">
                  <p className="text-5xl font-black text-indigo-700">{activeJob.currentRound}<span className="text-2xl font-normal text-slate-400"> / {activeJob.totalRounds}</span></p>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Current Round</p>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-indigo-600 to-emerald-500 rounded-full" animate={{ width: `${roundProgress}%` }} transition={{ duration: 0.5 }} />
                </div>
                <div className="flex items-center justify-center gap-2 text-emerald-600 font-bold bg-emerald-50 py-3 rounded-2xl">
                  <Loader2 className="animate-spin" size={16} />
                  <span className="text-sm capitalize">{activeJob.status.toLowerCase()}...</span>
                </div>
                <p className="text-xs text-slate-400">Training completes after round {activeJob.totalRounds}. Check Overview for live metrics.</p>
              </motion.div>
            ) : (
              <>
                <motion.p key={queue.count} initial={{ scale: 1.2, color: '#4f46e5' }} animate={{ scale: 1, color: '#0f172a' }} className="text-5xl font-black mb-1">
                  {loading ? '...' : `${queue.count} / ${MIN_REQUIRED}`}
                </motion.p>
                <p className="text-slate-500 font-medium uppercase tracking-widest text-xs mb-4">Active Participants</p>
                {inQueue && slotsLeft > 0 && (
                  <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
                    Need {slotsLeft} more {slotsLeft === 1 ? 'participant' : 'participants'} to auto-start
                  </div>
                )}
                <AnimatePresence mode="wait">
                  {!inQueue ? (
                    <motion.button key="join" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      onClick={joinQueue} disabled={joining || !hasData} title={!hasData ? 'Upload your data first' : ''}
                      className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {joining ? <span className="flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={20} /> Joining...</span> : 'Join Waiting Room'}
                    </motion.button>
                  ) : (
                    <motion.div key="waiting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
                      <div className="flex items-center justify-center gap-3 text-emerald-600 font-bold bg-emerald-50 py-4 rounded-2xl">
                        <CheckCircle2 size={20} /> You are in the queue
                      </div>
                      <div className="flex items-center justify-center gap-2 text-slate-400 text-sm"><Loader2 className="animate-spin" size={16} /> Waiting for {slotsLeft} more...</div>
                      <button onClick={leaveQueue} disabled={leaving} className="w-full border border-red-200 text-red-500 py-3 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-50">
                        {leaving ? 'Leaving...' : 'Leave Queue'}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                {!hasData && !inQueue && <p className="text-xs text-slate-400 mt-3">⬆ Upload your data first to enable joining</p>}
              </>
            )}
          </div>

          <div className="bg-slate-900 p-6 rounded-[2rem] text-white">
            <Shield className="text-indigo-400 mb-3" size={28} />
            <h3 className="text-base font-bold mb-1">Secure Aggregation</h3>
            <p className="text-slate-400 text-sm leading-relaxed">Your data never leaves your device. Only model updates are shared using differential privacy.</p>
          </div>
        </div>

        {/* Connected Nodes */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{isTraining ? 'Training Nodes' : 'Connected Nodes'}</h2>
                {isTraining && <p className="text-xs text-slate-400 mt-0.5">Round {activeJob.currentRound} of {activeJob.totalRounds} — {activeJob.status}</p>}
              </div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full animate-pulse ${isTraining ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                {isTraining ? 'Training' : 'Live Feed'}
              </span>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-3" size={24} />Loading nodes...</div>
            ) : queue.companies.length === 0 ? (
              <div className="p-12 text-center text-slate-400"><Users size={40} className="mx-auto mb-3 opacity-30" /><p className="font-medium">No nodes connected yet</p><p className="text-sm mt-1">Upload your data and join to be the first!</p></div>
            ) : (
              <div className="divide-y divide-slate-50">
                {queue.companies.map((node, i) => (
                  <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} key={node.companyId}
                    className={`p-6 flex items-center justify-between transition-colors ${node.companyId === currentId ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isTraining ? 'bg-indigo-100 text-indigo-500' : 'bg-slate-100 text-slate-400'}`}>
                        <Monitor size={24} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">
                          {node.companyName || node.companyId}
                          {node.companyId === currentId && <span className="ml-2 text-xs text-indigo-500 font-normal">(you)</span>}
                        </p>
                        <p className="text-xs text-slate-500 font-medium">
                          {isTraining ? `Round ${activeJob.currentRound} / ${activeJob.totalRounds}` : `Joined ${new Date(node.joinedAt).toLocaleTimeString()}`}
                        </p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${isTraining ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isTraining ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                      {isTraining ? activeJob.status.toLowerCase() : 'ready'}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {isTraining ? (
              <div className="p-4 bg-indigo-50 border-t border-indigo-100">
                <div className="flex justify-between text-xs text-indigo-600 font-medium mb-2">
                  <span>Overall Progress</span><span>{roundProgress}% · Round {activeJob.currentRound}/{activeJob.totalRounds}</span>
                </div>
                <div className="h-1.5 bg-indigo-200 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-indigo-600 rounded-full" animate={{ width: `${roundProgress}%` }} transition={{ duration: 0.5 }} />
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 text-center text-xs text-slate-400">
                {queue.companies.length} of {queue.count} nodes shown · refreshes every 3s
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
